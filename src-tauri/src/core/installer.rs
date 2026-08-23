use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use super::central_repo;
use super::content_hash;
use super::skill_metadata::{self, sanitize_skill_name};
use super::sync_engine;

pub struct InstallResult {
    pub name: String,
    pub description: Option<String>,
    pub central_path: PathBuf,
    pub content_hash: String,
}

enum PreparedSource {
    Directory(PathBuf),
    Archive {
        _temp_dir: tempfile::TempDir,
        skill_dir: PathBuf,
    },
}

impl PreparedSource {
    fn open(source: &Path) -> Result<Self> {
        if source.is_dir() {
            Ok(PreparedSource::Directory(source.to_path_buf()))
        } else {
            Self::from_archive(source)
        }
    }

    fn from_archive(source: &Path) -> Result<Self> {
        let ext = source
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();
        if ext != "zip" && ext != "skill" {
            bail!("Unsupported archive format: {}", ext);
        }

        let temp_dir = tempfile::tempdir()?;
        let file = std::fs::File::open(source)?;
        let mut archive = zip::ZipArchive::new(file)?;
        safe_extract(&mut archive, temp_dir.path())?;

        // Find supported skill markers for local/archive import flows.
        let mut found = Vec::new();
        for entry in WalkDir::new(temp_dir.path()).max_depth(4) {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy();
            if name == "SKILL.md" || name == "skill.md" {
                if let Some(parent) = entry.path().parent() {
                    found.push(parent.to_path_buf());
                }
            }
        }

        found.dedup();

        let skill_dir = match found.len() {
            0 => temp_dir.path().to_path_buf(),
            1 => found.into_iter().next().unwrap(),
            _ => bail!("Multiple skill directories found in archive"),
        };

        Ok(PreparedSource::Archive {
            _temp_dir: temp_dir,
            skill_dir,
        })
    }

    fn skill_dir(&self) -> &Path {
        match self {
            PreparedSource::Directory(p) => p,
            PreparedSource::Archive { skill_dir, .. } => skill_dir,
        }
    }
}

pub fn install_from_local(source: &Path, name: Option<&str>) -> Result<InstallResult> {
    let prepared = PreparedSource::open(source)?;
    let skill_dir = prepared.skill_dir();
    preflight_copy_source(skill_dir)?;

    let sanitized_name = match name {
        Some(n) if !n.is_empty() => {
            sanitize_skill_name(n).ok_or_else(|| anyhow::anyhow!("Invalid skill name: '{}'", n))?
        }
        _ => skill_metadata::infer_skill_name(skill_dir),
    };

    let skills_dir = central_repo::skills_dir();
    let dest = unique_skill_dest(&skills_dir, &sanitized_name);
    let final_name = dest
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| sanitized_name.clone());

    install_skill_dir_to_destination(skill_dir, &final_name, &dest)
}

pub fn install_from_local_to_destination(
    source: &Path,
    name: Option<&str>,
    destination: &Path,
) -> Result<InstallResult> {
    let prepared = PreparedSource::open(source)?;
    let skill_dir = prepared.skill_dir();

    let skill_name = match name {
        Some(n) if !n.is_empty() => {
            sanitize_skill_name(n).ok_or_else(|| anyhow::anyhow!("Invalid skill name: '{}'", n))?
        }
        _ => skill_metadata::infer_skill_name(skill_dir),
    };
    install_skill_dir_to_destination(skill_dir, &skill_name, destination)
}

pub fn resolve_local_skill_name(source: &Path, name: Option<&str>) -> Result<String> {
    let prepared = PreparedSource::open(source)?;
    let skill_dir = prepared.skill_dir();

    Ok(match name {
        Some(n) if !n.is_empty() => {
            sanitize_skill_name(n).ok_or_else(|| anyhow::anyhow!("Invalid skill name: '{}'", n))?
        }
        _ => skill_metadata::infer_skill_name(skill_dir),
    })
}

pub fn hash_local_source(source: &Path) -> Result<String> {
    let prepared = PreparedSource::open(source)?;
    content_hash::hash_directory(prepared.skill_dir())
}

pub fn install_from_git_dir(source: &Path, name: Option<&str>) -> Result<InstallResult> {
    install_from_local(source, name)
}

/// Fail closed when the legacy copier cannot preserve the source tree.
///
/// `copy_skill_dir` intentionally skips symlinks to prevent exfiltration. A
/// silent skip is not a valid Import, though: it can create a managed Skill
/// without its linked `SKILL.md` or another required file. This read-only
/// preflight therefore runs before any destination deletion/creation.
pub fn preflight_copy_source(source: &Path) -> Result<()> {
    let root_metadata = std::fs::symlink_metadata(source)
        .with_context(|| format!("Failed to inspect import source {}", source.display()))?;
    if root_metadata.file_type().is_symlink() {
        bail!(
            "Import source is a symlink and current copy mode cannot preserve it: {}",
            source.display()
        );
    }
    if !root_metadata.is_dir() {
        bail!("Import source is not a directory: {}", source.display());
    }

    for item in WalkDir::new(source)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| entry.depth() == 0 || !is_ignored_copy_entry(entry.file_name()))
    {
        let entry =
            item.with_context(|| format!("Failed to inspect import source {}", source.display()))?;
        if entry.depth() == 0 {
            continue;
        }
        let file_type = entry.file_type();
        if file_type.is_symlink() {
            bail!(
                "Import source contains a symlink that current copy mode cannot preserve: {}",
                entry.path().display()
            );
        }
        if !file_type.is_dir() && !file_type.is_file() {
            bail!(
                "Import source contains an unsupported filesystem entry that current copy mode cannot preserve: {}",
                entry.path().display()
            );
        }
    }
    Ok(())
}

pub fn install_skill_dir_to_destination(
    source: &Path,
    name: &str,
    destination: &Path,
) -> Result<InstallResult> {
    preflight_copy_source(source)?;
    let meta = skill_metadata::parse_skill_md(source);

    sync_engine::ensure_dst_not_inside_src(source, destination)?;

    if destination.exists() {
        std::fs::remove_dir_all(destination)
            .with_context(|| format!("Failed to remove existing {:?}", destination))?;
    }

    copy_skill_dir(source, destination)?;

    let hash = content_hash::hash_directory(destination)?;

    Ok(InstallResult {
        name: name.to_string(),
        description: meta.description,
        central_path: destination.to_path_buf(),
        content_hash: hash,
    })
}

/// Extract a ZIP archive into `dest`, skipping any entry whose path would
/// escape the destination directory (Zip Slip defence).
fn safe_extract(archive: &mut zip::ZipArchive<std::fs::File>, dest: &Path) -> Result<()> {
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;

        if entry
            .unix_mode()
            .map(|mode| mode & 0o170000 == 0o120000)
            .unwrap_or(false)
        {
            bail!(
                "Archive contains a symlink that current copy mode cannot preserve: {}",
                entry.name()
            );
        }

        // enclosed_name() returns None for absolute paths and entries that
        // contain `..` components, so those are silently skipped.
        let entry_path = match entry.enclosed_name() {
            Some(name) => dest.join(name),
            None => continue,
        };

        // Belt-and-suspenders: verify the resolved path stays inside dest.
        if !entry_path.starts_with(dest) {
            continue;
        }

        if entry.is_dir() {
            std::fs::create_dir_all(&entry_path)?;
        } else {
            if let Some(parent) = entry_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut outfile = std::fs::File::create(&entry_path)?;
            std::io::copy(&mut entry, &mut outfile)?;

            // Restore Unix file permissions (especially executable bits)
            // from the ZIP entry metadata.
            #[cfg(unix)]
            {
                if let Some(mode) = entry.unix_mode() {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(
                        &entry_path,
                        std::fs::Permissions::from_mode(mode),
                    );
                }
            }
        }
    }
    Ok(())
}

/// Return a collision-safe destination directory for an install.
///
/// Rules:
/// - Prefer `<name>` if missing.
/// - Never reuse an existing directory. Content equality is evidence of a
///   duplicate, not proof that two source locations share identity/ownership.
/// - Allocate `<name>-2`, `<name>-3`, ... when needed.
fn unique_skill_dest(parent: &Path, sanitized_name: &str) -> PathBuf {
    for i in 1u32.. {
        let candidate = if i == 1 {
            parent.join(sanitized_name)
        } else {
            parent.join(format!("{}-{}", sanitized_name, i))
        };

        if !candidate.exists() {
            return candidate;
        }
    }

    parent.join(sanitized_name)
}

fn is_ignored_copy_entry(name: &std::ffi::OsStr) -> bool {
    name == ".git" || name == ".DS_Store"
}

fn copy_skill_dir(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let name = entry.file_name();
        if is_ignored_copy_entry(&name) {
            continue;
        }

        // Skip symlinks to prevent exfiltration of files outside the skill directory
        if ft.is_symlink() {
            continue;
        }

        let dest_path = dst.join(&name);
        if ft.is_dir() {
            copy_skill_dir(&entry.path(), &dest_path)?;
        } else {
            std::fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;

    fn make_skill_dir(parent: &Path, dir_name: &str, meta_name: Option<&str>) -> PathBuf {
        let dir = parent.join(dir_name);
        std::fs::create_dir_all(&dir).unwrap();
        if let Some(name) = meta_name {
            std::fs::write(dir.join("SKILL.md"), format!("---\nname: {}\n---\n", name)).unwrap();
        }
        dir
    }

    #[test]
    fn unique_dest_returns_base_when_free() {
        let tmp = tempdir().unwrap();
        let _source = make_skill_dir(tmp.path(), "source", Some("a-b"));
        let dest = unique_skill_dest(tmp.path(), "a-b");
        assert_eq!(dest, tmp.path().join("a-b"));
    }

    #[test]
    fn unique_dest_never_reuses_base_for_same_content() {
        let tmp = tempdir().unwrap();
        let existing = make_skill_dir(tmp.path(), "a-b", Some("A B"));
        let source = make_skill_dir(tmp.path(), "source", Some("A B"));
        std::fs::write(existing.join("body.md"), "same").unwrap();
        std::fs::write(source.join("body.md"), "same").unwrap();

        let dest = unique_skill_dest(tmp.path(), "a-b");
        assert_eq!(dest, tmp.path().join("a-b-2"));
    }

    #[cfg(unix)]
    #[test]
    fn equal_content_install_creates_distinct_destination_without_replacing_existing() {
        let _lock = central_repo::test_base_dir_lock();
        let tmp = tempdir().unwrap();
        let base = tmp.path().join("center");
        std::fs::create_dir_all(&base).unwrap();
        central_repo::set_test_base_dir_override(Some(base.clone()));

        let source = make_skill_dir(tmp.path(), "source", Some("same"));
        let destination = central_repo::skills_dir().join("same");
        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
        copy_skill_dir(&source, &destination).unwrap();
        let original_hash = content_hash::hash_directory(&destination).unwrap();

        let result = install_from_local(&source, Some("same")).unwrap();
        let preserved_hash = content_hash::hash_directory(&destination).unwrap();
        let expected_destination = central_repo::skills_dir().join("same-2");
        central_repo::set_test_base_dir_override(None);

        assert_eq!(result.central_path, expected_destination);
        assert_eq!(preserved_hash, original_hash);
    }

    #[test]
    fn unique_dest_uses_suffix_for_different_content_even_if_name_matches() {
        let tmp = tempdir().unwrap();
        let existing = make_skill_dir(tmp.path(), "a-b", Some("A-B"));
        let _source = make_skill_dir(tmp.path(), "source", Some("A-B"));
        std::fs::write(existing.join("body.md"), "old").unwrap();
        std::fs::write(_source.join("body.md"), "new").unwrap();

        let dest = unique_skill_dest(tmp.path(), "a-b");
        assert_eq!(dest, tmp.path().join("a-b-2"));
    }

    #[test]
    fn unique_dest_skips_existing_suffix_even_for_same_content() {
        let tmp = tempdir().unwrap();
        let first = make_skill_dir(tmp.path(), "a-b", Some("A-B"));
        let second = make_skill_dir(tmp.path(), "a-b-2", Some("A-B"));
        let source = make_skill_dir(tmp.path(), "source", Some("A-B"));
        std::fs::write(first.join("body.md"), "first").unwrap();
        std::fs::write(second.join("body.md"), "second").unwrap();
        std::fs::write(source.join("body.md"), "second").unwrap();

        let dest = unique_skill_dest(tmp.path(), "a-b");
        assert_eq!(dest, tmp.path().join("a-b-3"));
    }

    #[test]
    fn install_skill_dir_refuses_destination_inside_source() {
        let tmp = tempdir().unwrap();
        let source = make_skill_dir(tmp.path(), "skills", Some("skills"));
        std::fs::write(source.join("body.md"), "data").unwrap();
        let destination = source.join("skills");

        let err = install_skill_dir_to_destination(&source, "skills", &destination)
            .err()
            .expect("expected refusal");
        assert!(
            err.to_string().contains("infinite recursion"),
            "unexpected error: {err}"
        );
        // The source must not be touched, and no nested copy must exist.
        assert!(source.join("body.md").exists());
        assert!(!destination.exists());
    }

    #[cfg(unix)]
    #[test]
    fn install_rejects_symlink_source_before_destination_mutation() {
        let tmp = tempdir().unwrap();
        let target = tmp.path().join("marker.md");
        std::fs::write(&target, "---\nname: linked\n---\n").unwrap();
        let source = tmp.path().join("source");
        std::fs::create_dir(&source).unwrap();
        std::os::unix::fs::symlink(&target, source.join("SKILL.md")).unwrap();

        let destination = tmp.path().join("destination");
        std::fs::create_dir(&destination).unwrap();
        std::fs::write(destination.join("sentinel.txt"), "keep me").unwrap();

        let error = install_skill_dir_to_destination(&source, "linked", &destination)
            .err()
            .expect("expected symlink refusal");
        assert!(
            error.to_string().contains("cannot preserve"),
            "unexpected error: {error}"
        );
        assert_eq!(
            std::fs::read_to_string(destination.join("sentinel.txt")).unwrap(),
            "keep me"
        );
        assert!(!destination.join("SKILL.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn preflight_rejects_symlinked_root_and_nested_symlink() {
        let tmp = tempdir().unwrap();
        let source = make_skill_dir(tmp.path(), "source", Some("source"));
        let source_link = tmp.path().join("source-link");
        std::os::unix::fs::symlink(&source, &source_link).unwrap();
        assert!(preflight_copy_source(&source_link).is_err());

        let nested_target = tmp.path().join("nested-target.txt");
        std::fs::write(&nested_target, "target").unwrap();
        std::fs::create_dir(source.join("nested")).unwrap();
        std::os::unix::fs::symlink(&nested_target, source.join("nested/link.txt")).unwrap();
        assert!(preflight_copy_source(&source).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn install_rejects_special_entry_before_destination_mutation() {
        let tmp = tempdir().unwrap();
        let source = make_skill_dir(tmp.path(), "source", Some("source"));
        let fifo = source.join("runtime.fifo");
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap();
        assert!(status.success());
        let destination = tmp.path().join("destination");
        std::fs::create_dir(&destination).unwrap();
        std::fs::write(destination.join("sentinel.txt"), "keep me").unwrap();

        let error = install_skill_dir_to_destination(&source, "source", &destination)
            .err()
            .expect("expected special-file refusal");
        assert!(
            error.to_string().contains("unsupported filesystem entry"),
            "unexpected error: {error}"
        );
        assert_eq!(
            std::fs::read_to_string(destination.join("sentinel.txt")).unwrap(),
            "keep me"
        );
    }

    #[cfg(unix)]
    #[test]
    fn preflight_and_copy_share_the_same_ignored_entry_scope() {
        let tmp = tempdir().unwrap();
        let source = make_skill_dir(tmp.path(), "source", Some("source"));
        let git_dir = source.join(".git");
        std::fs::create_dir(&git_dir).unwrap();
        let outside = tmp.path().join("outside.txt");
        std::fs::write(&outside, "outside").unwrap();
        std::os::unix::fs::symlink(&outside, git_dir.join("linked-object")).unwrap();
        std::fs::write(source.join(".DS_Store"), "ignored").unwrap();

        let destination = tmp.path().join("destination");
        install_skill_dir_to_destination(&source, "source", &destination).unwrap();

        assert!(destination.join("SKILL.md").is_file());
        assert!(!destination.join(".git").exists());
        assert!(!destination.join(".DS_Store").exists());
    }

    #[test]
    fn unique_dest_does_not_reuse_legacy_no_metadata_base() {
        let tmp = tempdir().unwrap();
        let existing = make_skill_dir(tmp.path(), "legacy", None);
        let source = make_skill_dir(tmp.path(), "source", None);
        std::fs::write(existing.join("body.md"), "same").unwrap();
        std::fs::write(source.join("body.md"), "same").unwrap();

        let dest = unique_skill_dest(tmp.path(), "legacy");
        assert_eq!(dest, tmp.path().join("legacy-2"));
    }

    fn write_skill_archive(path: &Path, body: &str) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        zip.start_file("demo-skill/SKILL.md", options).unwrap();
        zip.write_all(b"---\nname: Demo Skill\n---\n").unwrap();
        zip.start_file("demo-skill/body.md", options).unwrap();
        zip.write_all(body.as_bytes()).unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn hash_local_source_matches_extracted_archive_representation() {
        let tmp = tempdir().unwrap();
        let archive = tmp.path().join("demo.skill");
        write_skill_archive(&archive, "same content");

        let extracted = tmp.path().join("extracted");
        std::fs::create_dir_all(&extracted).unwrap();
        std::fs::write(extracted.join("SKILL.md"), "---\nname: Demo Skill\n---\n").unwrap();
        std::fs::write(extracted.join("body.md"), "same content").unwrap();

        let archive_hash = hash_local_source(&archive).unwrap();
        let dir_hash = content_hash::hash_directory(&extracted).unwrap();

        assert_eq!(archive_hash, dir_hash);
    }

    #[test]
    fn hash_local_source_detects_archive_content_changes() {
        let tmp = tempdir().unwrap();
        let archive = tmp.path().join("demo.zip");
        write_skill_archive(&archive, "v1");
        let first_hash = hash_local_source(&archive).unwrap();

        write_skill_archive(&archive, "v2");
        let second_hash = hash_local_source(&archive).unwrap();

        assert_ne!(first_hash, second_hash);
    }

    #[test]
    fn archive_import_rejects_symlink_entries() {
        let tmp = tempdir().unwrap();
        let archive_path = tmp.path().join("linked.skill");
        let file = std::fs::File::create(&archive_path).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        archive
            .add_symlink(
                "demo-skill/SKILL.md",
                "../outside.md",
                SimpleFileOptions::default(),
            )
            .unwrap();
        archive.finish().unwrap();

        let error = install_from_local(&archive_path, None)
            .err()
            .expect("expected archive symlink refusal");
        assert!(
            error.to_string().contains("Archive contains a symlink"),
            "unexpected error: {error}"
        );
    }
}
