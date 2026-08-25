use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const IGNORED: &[&str] = &[
    ".git",
    ".DS_Store",
    "Thumbs.db",
    ".gitignore",
    "__pycache__",
];

/// Canonical algorithm label for the strict, versioned foundation digest.
///
/// The legacy hash below remains byte-for-byte stable for update/diff callers.
/// E0/B0 inventory code opts into this algorithm explicitly instead.
pub const STRICT_DIRECTORY_DIGEST_ALGORITHM: &str = "scm-dir-v2";

/// Complete, fail-closed directory digest used to prove that Card Master owns
/// every entry before it removes or replaces a live directory.
///
/// Unlike [`STRICT_DIRECTORY_DIGEST_ALGORITHM`], this scope intentionally does
/// not ignore `.git`, `.gitignore`, generated files, or empty directories. A
/// content/update digest answers "is the Skill behavior the same?"; this one
/// answers the stricter question "would deleting this tree discard anything?".
pub const OWNERSHIP_DIRECTORY_DIGEST_ALGORITHM: &str = "scm-ownership-v2";

/// Canonical digest of the tree produced by copy-mode deployment.
///
/// Copy mode deliberately omits `.git` directories and materializes file
/// symlinks as ordinary files. This digest models those transformations for
/// source/target comparison without weakening the complete ownership digest
/// used to detect post-preview changes in the live target.
pub const COPY_PROJECTION_DIGEST_ALGORITHM: &str = "scm-copy-projection-v2";

const STRICT_HASH_BUFFER_SIZE: usize = 64 * 1024;

/// True for names excluded from a skill's content scope: the exact-match
/// [`IGNORED`] entries plus compiled-Python artifacts (`*.pyc`). These are
/// regenerated whenever a skill's Python scripts run, so without excluding
/// them a copy-mode deployment would read as permanently "changed" against
/// the library the first time the skill is used.
fn is_ignored(name: &str) -> bool {
    IGNORED.contains(&name) || name.ends_with(".pyc")
}

/// One file in the legacy managed-library content scope used by both
/// [`hash_directory`] and the source-diff command. The strict foundation
/// digest has a separate enumerator because it must preserve symlink kind and
/// propagate every filesystem error without changing legacy hash bytes.
pub struct ContentEntry {
    /// Path relative to the scanned directory, in the same lossy form the
    /// hash consumes (keeps the hashed byte stream stable).
    pub relative_path: String,
    pub path: PathBuf,
    /// `mode & 0o111` on unix when metadata is readable, else `None`.
    /// Always `None` on non-unix. `None` means "not folded into the hash".
    pub exec_bits: Option<u32>,
    /// Modification time in ms since the Unix epoch, captured during the walk
    /// so callers don't need a second `metadata()` syscall (or a separate
    /// recursive walk) just to learn when the content last changed.
    pub modified_ms: Option<i64>,
}

impl ContentEntry {
    pub fn is_executable(&self) -> bool {
        self.exec_bits.map_or(false, |bits| bits != 0)
    }
}

#[cfg(unix)]
fn exec_bits_of(path: &Path) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    path.metadata().ok().map(|m| m.permissions().mode() & 0o111)
}

#[cfg(not(unix))]
fn exec_bits_of(_path: &Path) -> Option<u32> {
    None
}

/// Enumerate the files that make up a skill's content, sorted by path and
/// filtered by the shared ignore-list. Single source of truth for "what is
/// skill content"; hashing and diffing both build on it.
pub fn list_content_files(dir: &Path) -> Vec<ContentEntry> {
    let mut entries: Vec<_> = WalkDir::new(dir)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !is_ignored(&name)
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .collect();

    entries.sort_by(|a, b| a.path().cmp(b.path()));

    entries
        .into_iter()
        .map(|entry| {
            let relative_path = entry
                .path()
                .strip_prefix(dir)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .into_owned();
            // Normalize Windows separators to `/` so the hashed byte
            // stream is identical across platforms — otherwise Windows
            // feeds `sub\c.md` into the hash and disagrees with every
            // other OS about the same content. Windows-only because `\`
            // is a legal filename character on unix.
            #[cfg(windows)]
            let relative_path = relative_path.replace('\\', "/");
            let exec_bits = exec_bits_of(entry.path());
            // Reuse WalkDir's already-fetched metadata for the mtime: no extra
            // stat, and no separate recursive walk to answer "last modified?".
            let modified_ms = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64);
            ContentEntry {
                relative_path,
                path: entry.into_path(),
                exec_bits,
                modified_ms,
            }
        })
        .collect()
}

/// Hash a prepared content-file list. Split out from [`hash_directory`] so a
/// caller that already walked the tree (via [`list_content_files`]) can hash
/// and inspect the same entries without walking again (#248).
pub fn hash_entries(entries: &[ContentEntry]) -> String {
    let mut hasher = Sha256::new();
    for entry in entries {
        hasher.update(entry.relative_path.as_bytes());
        if let Ok(content) = std::fs::read(&entry.path) {
            hasher.update(&content);
        }
        // Include executable bit so permission-only changes are detected.
        #[cfg(unix)]
        if let Some(bits) = entry.exec_bits {
            hasher.update(&bits.to_le_bytes());
        }
    }
    hex::encode(hasher.finalize())
}

/// Latest content-file modification time (ms since epoch) from a prepared
/// entry list. Scoped to the same files the hash covers: dirs, `.git`,
/// `.DS_Store`, and `*.pyc` are excluded, so it reflects real content change.
pub fn latest_modified_ms(entries: &[ContentEntry]) -> Option<i64> {
    entries.iter().filter_map(|e| e.modified_ms).max()
}

pub fn hash_directory(dir: &Path) -> Result<String> {
    Ok(hash_entries(&list_content_files(dir)))
}

#[derive(Debug)]
struct StrictContentEntry {
    relative_path: String,
    path: PathBuf,
    link_target: Option<String>,
}

#[derive(Debug)]
enum OwnershipEntryKind {
    Directory,
    File,
    FileSymlink { target: String },
}

#[derive(Debug)]
struct OwnershipEntry {
    relative_path: String,
    path: PathBuf,
    kind: OwnershipEntryKind,
}

fn normalized_path_text(path: &Path, label: &str) -> Result<String> {
    let value = path
        .to_str()
        .with_context(|| format!("{label} is not valid UTF-8: {}", path.display()))?;

    #[cfg(windows)]
    let value = value.replace('\\', "/");

    Ok(value.to_string())
}

fn strict_field_header(hasher: &mut Sha256, tag: &[u8], value_len: u64) {
    hasher.update((tag.len() as u32).to_be_bytes());
    hasher.update(tag);
    hasher.update(value_len.to_be_bytes());
}

fn strict_field(hasher: &mut Sha256, tag: &[u8], value: &[u8]) {
    strict_field_header(hasher, tag, value.len() as u64);
    hasher.update(value);
}

#[cfg(unix)]
fn strict_exec_bits(metadata: &std::fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111
}

#[cfg(not(unix))]
fn strict_exec_bits(_metadata: &std::fs::Metadata) -> u32 {
    // Keep the encoding platform-neutral for ordinary files. A Unix file with
    // no executable bits and the same file on Windows must hash identically.
    0
}

#[cfg(unix)]
fn ownership_mode_bits(metadata: &std::fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o7777
}

#[cfg(not(unix))]
fn ownership_mode_bits(_metadata: &std::fs::Metadata) -> u32 {
    0
}

fn strict_content_entries(dir: &Path) -> Result<Vec<StrictContentEntry>> {
    // Canonicalizing only the entry root deliberately supports a Skill whose
    // directory itself is a symlink. Internal directory symlinks remain visible
    // to WalkDir and are rejected below.
    let root = std::fs::canonicalize(dir)
        .with_context(|| format!("Failed to resolve skill root {}", dir.display()))?;
    if !std::fs::metadata(&root)
        .with_context(|| format!("Failed to inspect skill root {}", root.display()))?
        .is_dir()
    {
        bail!("Skill root is not a directory: {}", dir.display());
    }

    strict_content_entries_at_root(&root)
}

fn strict_content_entries_at_root(root: &Path) -> Result<Vec<StrictContentEntry>> {
    let mut entries = Vec::new();
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0 || !is_ignored(&entry.file_name().to_string_lossy())
        });

    for item in walker {
        let entry = item.with_context(|| format!("Failed to walk {}", root.display()))?;
        if entry.depth() == 0 {
            continue;
        }

        let file_type = entry.file_type();
        if file_type.is_dir() {
            continue;
        }

        let relative = entry.path().strip_prefix(root).with_context(|| {
            format!(
                "Content path {} escaped skill root {}",
                entry.path().display(),
                root.display()
            )
        })?;
        let relative_path = normalized_path_text(relative, "Relative content path")?;

        if file_type.is_symlink() {
            let target = std::fs::read_link(entry.path()).with_context(|| {
                format!("Failed to read file symlink {}", entry.path().display())
            })?;
            let target_text = normalized_path_text(&target, "Symlink target")?;
            let target_metadata = std::fs::metadata(entry.path()).with_context(|| {
                format!(
                    "Broken or unreadable file symlink {} -> {}",
                    entry.path().display(),
                    target.display()
                )
            })?;
            if target_metadata.is_dir() {
                bail!(
                    "Directory symlinks are not supported by {}: {} -> {}",
                    STRICT_DIRECTORY_DIGEST_ALGORITHM,
                    entry.path().display(),
                    target.display()
                );
            }
            if !target_metadata.is_file() {
                bail!(
                    "Unsupported symlink target in skill content: {} -> {}",
                    entry.path().display(),
                    target.display()
                );
            }
            entries.push(StrictContentEntry {
                relative_path,
                path: entry.into_path(),
                link_target: Some(target_text),
            });
        } else if file_type.is_file() {
            entries.push(StrictContentEntry {
                relative_path,
                path: entry.into_path(),
                link_target: None,
            });
        } else {
            bail!(
                "Unsupported filesystem entry in skill content: {}",
                entry.path().display()
            );
        }
    }

    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(entries)
}

fn hash_strict_file_contents(hasher: &mut Sha256, path: &Path, expected_len: u64) -> Result<()> {
    let mut file = File::open(path)
        .with_context(|| format!("Failed to open skill content {}", path.display()))?;
    hash_strict_reader_contents(hasher, &mut file, path, expected_len)
}

fn hash_strict_reader_contents<R: Read>(
    hasher: &mut Sha256,
    reader: &mut R,
    path: &Path,
    expected_len: u64,
) -> Result<()> {
    strict_field_header(hasher, b"content", expected_len);
    let mut buffer = [0u8; STRICT_HASH_BUFFER_SIZE];
    let mut total = 0u64;

    loop {
        let read = reader
            .read(&mut buffer)
            .with_context(|| format!("Failed to read skill content {}", path.display()))?;
        if read == 0 {
            break;
        }
        total = total
            .checked_add(read as u64)
            .context("Skill content length overflow while hashing")?;
        if total > expected_len {
            bail!("Skill content changed while hashing: {}", path.display());
        }
        hasher.update(&buffer[..read]);
    }

    if total != expected_len {
        bail!("Skill content changed while hashing: {}", path.display());
    }
    Ok(())
}

/// Strict, streaming whole-directory digest for foundation inventory.
///
/// Encoding contract (all fields are domain-tagged and length-prefixed):
///
/// ```text
/// format(scm-dir-v2)
///   └─ entry(kind, relative-path, [link-target], exec-bits, content-bytes)*
/// ```
///
/// Any walk, metadata, symlink, open or read error fails the whole digest. A
/// symlinked root is supported; file symlinks include both their target text
/// and target bytes; internal directory symlinks fail closed. Relative paths
/// and symlink target text must be valid UTF-8 or the digest fails closed.
pub fn hash_directory_strict_v2(dir: &Path) -> Result<String> {
    let entries = strict_content_entries(dir)?;
    let mut hasher = Sha256::new();
    strict_field(
        &mut hasher,
        b"format",
        STRICT_DIRECTORY_DIGEST_ALGORITHM.as_bytes(),
    );

    for entry in entries {
        strict_field(&mut hasher, b"entry", b"begin");
        strict_field(&mut hasher, b"path", entry.relative_path.as_bytes());

        if let Some(expected_target) = entry.link_target.as_deref() {
            let current_target = std::fs::read_link(&entry.path).with_context(|| {
                format!("Failed to re-read file symlink {}", entry.path.display())
            })?;
            let current_target = normalized_path_text(&current_target, "Symlink target")?;
            if current_target != expected_target {
                bail!(
                    "File symlink changed while hashing: {}",
                    entry.path.display()
                );
            }
            strict_field(&mut hasher, b"kind", b"file-symlink");
            strict_field(&mut hasher, b"link-target", expected_target.as_bytes());
        } else {
            strict_field(&mut hasher, b"kind", b"file");
        }

        let metadata = std::fs::metadata(&entry.path)
            .with_context(|| format!("Failed to inspect content {}", entry.path.display()))?;
        if !metadata.is_file() {
            bail!("Content is no longer a file: {}", entry.path.display());
        }

        let exec_bits = strict_exec_bits(&metadata);
        strict_field(&mut hasher, b"exec-bits", &exec_bits.to_be_bytes());

        hash_strict_file_contents(&mut hasher, &entry.path, metadata.len())?;
        strict_field(&mut hasher, b"entry", b"end");
    }

    Ok(hex::encode(hasher.finalize()))
}

fn ownership_entries(dir: &Path) -> Result<Vec<OwnershipEntry>> {
    let root = std::fs::canonicalize(dir)
        .with_context(|| format!("Failed to resolve ownership root {}", dir.display()))?;
    if !std::fs::metadata(&root)
        .with_context(|| format!("Failed to inspect ownership root {}", root.display()))?
        .is_dir()
    {
        bail!("Ownership root is not a directory: {}", dir.display());
    }

    let mut entries = Vec::new();
    for item in WalkDir::new(&root).follow_links(false) {
        let entry = item.with_context(|| format!("Failed to walk {}", root.display()))?;
        if entry.depth() == 0 {
            continue;
        }
        let relative = entry.path().strip_prefix(&root).with_context(|| {
            format!(
                "Ownership path {} escaped root {}",
                entry.path().display(),
                root.display()
            )
        })?;
        let relative_path = normalized_path_text(relative, "Relative ownership path")?;
        let file_type = entry.file_type();
        let kind = if file_type.is_dir() {
            OwnershipEntryKind::Directory
        } else if file_type.is_file() {
            OwnershipEntryKind::File
        } else if file_type.is_symlink() {
            let target = std::fs::read_link(entry.path()).with_context(|| {
                format!(
                    "Failed to read ownership symlink {}",
                    entry.path().display()
                )
            })?;
            let target_text = normalized_path_text(&target, "Ownership symlink target")?;
            let target_metadata = std::fs::metadata(entry.path()).with_context(|| {
                format!(
                    "Broken or unreadable ownership symlink {} -> {}",
                    entry.path().display(),
                    target.display()
                )
            })?;
            if target_metadata.is_dir() {
                bail!(
                    "Directory symlinks are not supported by {}: {} -> {}",
                    OWNERSHIP_DIRECTORY_DIGEST_ALGORITHM,
                    entry.path().display(),
                    target.display()
                );
            }
            if !target_metadata.is_file() {
                bail!(
                    "Unsupported ownership symlink target: {} -> {}",
                    entry.path().display(),
                    target.display()
                );
            }
            OwnershipEntryKind::FileSymlink {
                target: target_text,
            }
        } else {
            bail!(
                "Unsupported filesystem entry in ownership tree: {}",
                entry.path().display()
            );
        };
        entries.push(OwnershipEntry {
            relative_path,
            path: entry.into_path(),
            kind,
        });
    }
    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(entries)
}

/// Hash the complete live tree before a destructive ownership operation.
///
/// Every entry is framed with its kind and relative path. Directories are
/// included so empty directories remain observable. Files include executable
/// bits and exact bytes. File symlinks include their target text and target
/// bytes; broken links, directory links, special entries, non-UTF-8 paths, and
/// every walk/metadata/open/read error fail the digest closed.
pub fn hash_directory_ownership_v1(dir: &Path) -> Result<String> {
    let entries = ownership_entries(dir)?;
    let mut hasher = Sha256::new();
    strict_field(
        &mut hasher,
        b"format",
        OWNERSHIP_DIRECTORY_DIGEST_ALGORITHM.as_bytes(),
    );

    for entry in entries {
        strict_field(&mut hasher, b"entry", b"begin");
        strict_field(&mut hasher, b"path", entry.relative_path.as_bytes());
        match &entry.kind {
            OwnershipEntryKind::Directory => {
                let metadata = std::fs::symlink_metadata(&entry.path).with_context(|| {
                    format!("Failed to inspect directory {}", entry.path.display())
                })?;
                if !metadata.is_dir() {
                    bail!("Ownership directory changed: {}", entry.path.display());
                }
                strict_field(&mut hasher, b"kind", b"directory");
                let mode_bits = ownership_mode_bits(&metadata);
                strict_field(&mut hasher, b"mode-bits", &mode_bits.to_be_bytes());
            }
            OwnershipEntryKind::File | OwnershipEntryKind::FileSymlink { .. } => {
                if let OwnershipEntryKind::FileSymlink {
                    target: expected_target,
                } = &entry.kind
                {
                    let current_target = std::fs::read_link(&entry.path).with_context(|| {
                        format!(
                            "Failed to re-read ownership symlink {}",
                            entry.path.display()
                        )
                    })?;
                    let current_target =
                        normalized_path_text(&current_target, "Ownership symlink target")?;
                    if current_target != *expected_target {
                        bail!("Ownership symlink changed: {}", entry.path.display());
                    }
                    strict_field(&mut hasher, b"kind", b"file-symlink");
                    strict_field(&mut hasher, b"link-target", expected_target.as_bytes());
                } else {
                    strict_field(&mut hasher, b"kind", b"file");
                }
                let metadata = std::fs::metadata(&entry.path).with_context(|| {
                    format!("Failed to inspect ownership file {}", entry.path.display())
                })?;
                if !metadata.is_file() {
                    bail!(
                        "Ownership content is no longer a file: {}",
                        entry.path.display()
                    );
                }
                let mode_bits = ownership_mode_bits(&metadata);
                strict_field(&mut hasher, b"mode-bits", &mode_bits.to_be_bytes());
                hash_strict_file_contents(&mut hasher, &entry.path, metadata.len())?;
            }
        }
        strict_field(&mut hasher, b"entry", b"end");
    }

    Ok(hex::encode(hasher.finalize()))
}

#[derive(Clone, Copy)]
enum CopyProjectionView {
    ExpectedSource,
    ObservedTarget,
}

fn copy_projection_entries(
    dir: &Path,
    view: CopyProjectionView,
) -> Result<Vec<OwnershipEntry>> {
    let root = std::fs::canonicalize(dir)
        .with_context(|| format!("Failed to resolve copy projection root {}", dir.display()))?;
    if !std::fs::metadata(&root)
        .with_context(|| format!("Failed to inspect copy projection root {}", root.display()))?
        .is_dir()
    {
        bail!("Copy projection root is not a directory: {}", dir.display());
    }

    let walker = WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0
                || !matches!(view, CopyProjectionView::ExpectedSource)
                || !(entry.file_type().is_dir() && entry.file_name() == ".git")
        });
    let mut entries = Vec::new();
    for item in walker {
        let entry = item.with_context(|| format!("Failed to walk {}", root.display()))?;
        if entry.depth() == 0 {
            continue;
        }
        let relative = entry.path().strip_prefix(&root).with_context(|| {
            format!(
                "Copy projection path {} escaped root {}",
                entry.path().display(),
                root.display()
            )
        })?;
        let relative_path = normalized_path_text(relative, "Relative copy projection path")?;
        let file_type = entry.file_type();
        let kind = if file_type.is_dir() {
            OwnershipEntryKind::Directory
        } else if file_type.is_file() {
            OwnershipEntryKind::File
        } else if file_type.is_symlink() {
            let target = std::fs::read_link(entry.path()).with_context(|| {
                format!(
                    "Failed to read copy projection symlink {}",
                    entry.path().display()
                )
            })?;
            let target_metadata = std::fs::metadata(entry.path()).with_context(|| {
                format!(
                    "Broken or unreadable copy projection symlink {} -> {}",
                    entry.path().display(),
                    target.display()
                )
            })?;
            if !target_metadata.is_file() {
                bail!(
                    "Copy projection symlink does not resolve to a file: {} -> {}",
                    entry.path().display(),
                    target.display()
                );
            }
            match view {
                // `std::fs::copy` follows a file symlink, so the deployed
                // entry is an ordinary file containing the target bytes.
                CopyProjectionView::ExpectedSource => OwnershipEntryKind::File,
                CopyProjectionView::ObservedTarget => OwnershipEntryKind::FileSymlink {
                    target: normalized_path_text(&target, "Copy projection symlink target")?,
                },
            }
        } else {
            bail!(
                "Unsupported filesystem entry in copy projection: {}",
                entry.path().display()
            );
        };
        entries.push(OwnershipEntry {
            relative_path,
            path: entry.into_path(),
            kind,
        });
    }
    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(entries)
}

fn hash_copy_projection_entries(entries: Vec<OwnershipEntry>) -> Result<String> {
    let mut hasher = Sha256::new();
    strict_field(
        &mut hasher,
        b"format",
        COPY_PROJECTION_DIGEST_ALGORITHM.as_bytes(),
    );
    for entry in entries {
        strict_field(&mut hasher, b"entry", b"begin");
        strict_field(&mut hasher, b"path", entry.relative_path.as_bytes());
        match &entry.kind {
            OwnershipEntryKind::Directory => {
                // `copy_dir_recursive` creates directories and does not copy
                // their permission metadata. Their paths remain significant,
                // including empty directories, but their mode does not.
                strict_field(&mut hasher, b"kind", b"directory");
            }
            OwnershipEntryKind::File | OwnershipEntryKind::FileSymlink { .. } => {
                if let OwnershipEntryKind::FileSymlink { target } = &entry.kind {
                    strict_field(&mut hasher, b"kind", b"file-symlink");
                    strict_field(&mut hasher, b"link-target", target.as_bytes());
                } else {
                    strict_field(&mut hasher, b"kind", b"file");
                }
                let metadata = std::fs::metadata(&entry.path).with_context(|| {
                    format!("Failed to inspect copy projection file {}", entry.path.display())
                })?;
                if !metadata.is_file() {
                    bail!(
                        "Copy projection content is no longer a file: {}",
                        entry.path.display()
                    );
                }
                let mode_bits = ownership_mode_bits(&metadata);
                strict_field(&mut hasher, b"mode-bits", &mode_bits.to_be_bytes());
                hash_strict_file_contents(&mut hasher, &entry.path, metadata.len())?;
            }
        }
        strict_field(&mut hasher, b"entry", b"end");
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Digest the tree that copy-mode deployment is expected to create from a
/// managed Skill source.
pub fn hash_expected_copy_projection_v1(dir: &Path) -> Result<String> {
    hash_copy_projection_entries(copy_projection_entries(
        dir,
        CopyProjectionView::ExpectedSource,
    )?)
}

/// Digest the tree actually present at a copy-mode Agent target.
pub fn hash_observed_copy_projection_v1(dir: &Path) -> Result<String> {
    hash_copy_projection_entries(copy_projection_entries(
        dir,
        CopyProjectionView::ObservedTarget,
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::{self, Cursor};
    use tempfile::tempdir;

    /// Project-workspace skills may now be symlinks to the central library
    /// (#225). Sync-status classification hashes the project path directly,
    /// so hashing through a symlinked root must see the real content.
    #[cfg(unix)]
    #[test]
    fn hash_through_symlinked_root_matches_real_directory() {
        let tmp = tempdir().unwrap();
        let real = tmp.path().join("skill");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("SKILL.md"), "# hello").unwrap();
        let link = tmp.path().join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        assert_eq!(
            hash_directory(&link).unwrap(),
            hash_directory(&real).unwrap()
        );
    }

    #[test]
    fn hash_deterministic_same_content() {
        let tmp1 = tempdir().unwrap();
        fs::write(tmp1.path().join("a.txt"), "hello").unwrap();
        fs::write(tmp1.path().join("b.txt"), "world").unwrap();

        let tmp2 = tempdir().unwrap();
        fs::write(tmp2.path().join("a.txt"), "hello").unwrap();
        fs::write(tmp2.path().join("b.txt"), "world").unwrap();

        let h1 = hash_directory(tmp1.path()).unwrap();
        let h2 = hash_directory(tmp2.path()).unwrap();
        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_differs_with_different_content() {
        let tmp1 = tempdir().unwrap();
        fs::write(tmp1.path().join("a.txt"), "hello").unwrap();

        let tmp2 = tempdir().unwrap();
        fs::write(tmp2.path().join("a.txt"), "world").unwrap();

        let h1 = hash_directory(tmp1.path()).unwrap();
        let h2 = hash_directory(tmp2.path()).unwrap();
        assert_ne!(h1, h2);
    }

    #[test]
    fn hash_ignores_dot_git() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "content").unwrap();
        let h1 = hash_directory(tmp.path()).unwrap();

        // Add .git directory — hash should not change
        fs::create_dir_all(tmp.path().join(".git")).unwrap();
        fs::write(tmp.path().join(".git/config"), "git stuff").unwrap();
        let h2 = hash_directory(tmp.path()).unwrap();

        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_ignores_ds_store() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "content").unwrap();
        let h1 = hash_directory(tmp.path()).unwrap();

        fs::write(tmp.path().join(".DS_Store"), "binary stuff").unwrap();
        let h2 = hash_directory(tmp.path()).unwrap();

        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_ignores_pycache() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("run.py"), "print('hi')").unwrap();
        let h1 = hash_directory(tmp.path()).unwrap();

        // Running the script generates a __pycache__ dir — hash must not change.
        fs::create_dir_all(tmp.path().join("__pycache__")).unwrap();
        fs::write(
            tmp.path().join("__pycache__/run.cpython-311.pyc"),
            "bytecode",
        )
        .unwrap();
        let h2 = hash_directory(tmp.path()).unwrap();

        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_ignores_loose_pyc() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("a.py"), "x = 1").unwrap();
        let h1 = hash_directory(tmp.path()).unwrap();

        // A .pyc sitting next to its source (not under __pycache__) is excluded too.
        fs::write(tmp.path().join("a.pyc"), "bytecode").unwrap();
        let h2 = hash_directory(tmp.path()).unwrap();

        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_empty_directory() {
        let tmp = tempdir().unwrap();
        let h = hash_directory(tmp.path()).unwrap();
        // SHA256 of empty input
        assert_eq!(
            h,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn hash_includes_subdirectories() {
        let tmp = tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("sub")).unwrap();
        fs::write(tmp.path().join("sub/file.md"), "nested").unwrap();

        let h1 = hash_directory(tmp.path()).unwrap();

        // Different subdir name → different hash
        let tmp2 = tempdir().unwrap();
        fs::create_dir_all(tmp2.path().join("other")).unwrap();
        fs::write(tmp2.path().join("other/file.md"), "nested").unwrap();

        let h2 = hash_directory(tmp2.path()).unwrap();
        assert_ne!(h1, h2);
    }

    #[test]
    fn list_content_files_sorted_with_relative_paths_and_ignores() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("b.txt"), "b").unwrap();
        fs::write(tmp.path().join("a.txt"), "a").unwrap();
        fs::create_dir_all(tmp.path().join("sub")).unwrap();
        fs::write(tmp.path().join("sub/c.md"), "c").unwrap();
        fs::write(tmp.path().join(".DS_Store"), "junk").unwrap();

        let entries = list_content_files(tmp.path());
        let rels: Vec<_> = entries.iter().map(|e| e.relative_path.clone()).collect();
        // Sorted by path, ignore-listed files excluded, subdirs included.
        assert_eq!(rels, vec!["a.txt", "b.txt", "sub/c.md"]);
    }

    #[test]
    fn latest_modified_ms_reflects_content_files_and_ignores_empty() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "a").unwrap();
        fs::create_dir_all(tmp.path().join("sub")).unwrap();
        fs::write(tmp.path().join("sub/b.md"), "b").unwrap();
        fs::write(tmp.path().join(".DS_Store"), "junk").unwrap();

        let entries = list_content_files(tmp.path());
        // Matches the max mtime over exactly the enumerated (non-ignored)
        // content files, computed from the same single walk with no extra stat.
        assert_eq!(
            latest_modified_ms(&entries),
            entries.iter().filter_map(|e| e.modified_ms).max()
        );
        assert!(latest_modified_ms(&entries).is_some());

        // No content files → no timestamp.
        let empty = tempdir().unwrap();
        assert_eq!(latest_modified_ms(&list_content_files(empty.path())), None);
    }

    #[test]
    fn hash_entries_matches_hash_directory() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "hello").unwrap();
        fs::create_dir_all(tmp.path().join("sub")).unwrap();
        fs::write(tmp.path().join("sub/c.md"), "nested").unwrap();

        // The split-out entry hasher must agree with the whole-directory hash.
        assert_eq!(
            hash_entries(&list_content_files(tmp.path())),
            hash_directory(tmp.path()).unwrap()
        );
    }

    #[cfg(unix)]
    #[test]
    fn list_content_files_reports_executable_bit() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempdir().unwrap();
        let script = tmp.path().join("run.sh");
        fs::write(&script, "#!/bin/sh\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        fs::write(tmp.path().join("plain.txt"), "x").unwrap();

        let entries = list_content_files(tmp.path());
        let by_name = |name: &str| entries.iter().find(|e| e.relative_path == name).unwrap();
        assert!(by_name("run.sh").is_executable());
        assert!(!by_name("plain.txt").is_executable());
    }

    #[test]
    fn strict_v2_is_framed_against_path_content_collisions() {
        let first = tempdir().unwrap();
        fs::write(first.path().join("a"), "bc").unwrap();
        let second = tempdir().unwrap();
        fs::write(second.path().join("ab"), "c").unwrap();

        // The legacy stream concatenates path+content and therefore collides.
        assert_eq!(
            hash_directory(first.path()).unwrap(),
            hash_directory(second.path()).unwrap()
        );
        assert_ne!(
            hash_directory_strict_v2(first.path()).unwrap(),
            hash_directory_strict_v2(second.path()).unwrap()
        );
    }

    #[test]
    fn strict_v2_is_deterministic_and_ignores_ephemeral_files() {
        let first = tempdir().unwrap();
        fs::create_dir(first.path().join("nested")).unwrap();
        fs::write(first.path().join("SKILL.md"), "# demo").unwrap();
        fs::write(first.path().join("nested/run.py"), "print('ok')").unwrap();

        let second = tempdir().unwrap();
        fs::create_dir(second.path().join("nested")).unwrap();
        fs::write(second.path().join("SKILL.md"), "# demo").unwrap();
        fs::write(second.path().join("nested/run.py"), "print('ok')").unwrap();
        fs::write(second.path().join(".DS_Store"), "ignored").unwrap();
        fs::create_dir(second.path().join("__pycache__")).unwrap();
        fs::write(second.path().join("__pycache__/run.pyc"), "ignored").unwrap();

        assert_eq!(
            hash_directory_strict_v2(first.path()).unwrap(),
            hash_directory_strict_v2(second.path()).unwrap()
        );
        assert_ne!(
            hash_directory_ownership_v1(first.path()).unwrap(),
            hash_directory_ownership_v1(second.path()).unwrap()
        );
    }

    #[test]
    fn ownership_v1_includes_ignored_files_and_empty_directories() {
        let first = tempdir().unwrap();
        fs::write(first.path().join("SKILL.md"), "# demo").unwrap();

        let second = tempdir().unwrap();
        fs::write(second.path().join("SKILL.md"), "# demo").unwrap();
        fs::write(second.path().join(".gitignore"), "private/\n").unwrap();
        fs::create_dir(second.path().join("empty")).unwrap();

        assert_eq!(
            hash_directory_strict_v2(first.path()).unwrap(),
            hash_directory_strict_v2(second.path()).unwrap()
        );
        assert_ne!(
            hash_directory_ownership_v1(first.path()).unwrap(),
            hash_directory_ownership_v1(second.path()).unwrap()
        );
    }

    #[test]
    fn ownership_v1_is_framed_against_path_content_collisions() {
        let first = tempdir().unwrap();
        fs::write(first.path().join("a"), "bc").unwrap();
        let second = tempdir().unwrap();
        fs::write(second.path().join("ab"), "c").unwrap();

        assert_eq!(
            hash_directory(first.path()).unwrap(),
            hash_directory(second.path()).unwrap()
        );
        assert_ne!(
            hash_directory_ownership_v1(first.path()).unwrap(),
            hash_directory_ownership_v1(second.path()).unwrap()
        );
    }

    #[cfg(unix)]
    #[test]
    fn copy_projection_digest_models_git_omission_and_symlink_materialization() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempdir().unwrap();
        let source = tmp.path().join("source");
        let target = tmp.path().join("target");
        fs::create_dir_all(source.join(".git")).unwrap();
        fs::create_dir_all(source.join("empty")).unwrap();
        fs::create_dir_all(target.join("empty")).unwrap();
        fs::write(source.join("SKILL.md"), "# demo\n").unwrap();
        fs::copy(source.join("SKILL.md"), target.join("SKILL.md")).unwrap();
        fs::write(source.join(".git/config"), "private metadata\n").unwrap();

        let script_target = tmp.path().join("run-source.sh");
        fs::write(&script_target, "#!/bin/sh\necho ok\n").unwrap();
        fs::set_permissions(&script_target, fs::Permissions::from_mode(0o755)).unwrap();
        std::os::unix::fs::symlink(&script_target, source.join("run.sh")).unwrap();
        fs::copy(&script_target, target.join("run.sh")).unwrap();

        assert_eq!(
            hash_expected_copy_projection_v1(&source).unwrap(),
            hash_observed_copy_projection_v1(&target).unwrap()
        );
        assert_ne!(
            hash_directory_ownership_v1(&source).unwrap(),
            hash_directory_ownership_v1(&target).unwrap()
        );

        // Extra target data is still visible even when it uses a name that is
        // intentionally omitted from the source-side copy transformation.
        fs::create_dir_all(target.join(".git")).unwrap();
        fs::write(target.join(".git/config"), "unexpected\n").unwrap();
        assert_ne!(
            hash_expected_copy_projection_v1(&source).unwrap(),
            hash_observed_copy_projection_v1(&target).unwrap()
        );
    }

    #[cfg(unix)]
    #[test]
    fn ownership_and_copy_digests_include_full_unix_permission_bits() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempdir().unwrap();
        let file = tmp.path().join("SKILL.md");
        fs::write(&file, "# demo\n").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();

        let ownership_before = hash_directory_ownership_v1(tmp.path()).unwrap();
        let copy_before = hash_observed_copy_projection_v1(tmp.path()).unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();

        assert_ne!(
            hash_directory_ownership_v1(tmp.path()).unwrap(),
            ownership_before
        );
        assert_ne!(
            hash_observed_copy_projection_v1(tmp.path()).unwrap(),
            copy_before
        );
    }

    #[cfg(unix)]
    #[test]
    fn strict_v2_hashes_file_symlink_target_and_content() {
        let tmp = tempdir().unwrap();
        let first_target = tmp.path().join("first.md");
        let second_target = tmp.path().join("second.md");
        fs::write(&first_target, "same bytes").unwrap();
        fs::write(&second_target, "same bytes").unwrap();
        let skill = tmp.path().join("skill");
        fs::create_dir(&skill).unwrap();
        let marker = skill.join("SKILL.md");
        std::os::unix::fs::symlink(&first_target, &marker).unwrap();

        let original = hash_directory_strict_v2(&skill).unwrap();
        let ownership_original = hash_directory_ownership_v1(&skill).unwrap();
        fs::write(&first_target, "changed bytes").unwrap();
        let content_changed = hash_directory_strict_v2(&skill).unwrap();
        assert_ne!(original, content_changed);
        assert_ne!(
            ownership_original,
            hash_directory_ownership_v1(&skill).unwrap()
        );

        fs::write(&first_target, "same bytes").unwrap();
        fs::remove_file(&marker).unwrap();
        std::os::unix::fs::symlink(&second_target, &marker).unwrap();
        let target_changed = hash_directory_strict_v2(&skill).unwrap();
        assert_ne!(original, target_changed);
    }

    #[cfg(unix)]
    #[test]
    fn strict_v2_rejects_broken_and_directory_symlinks() {
        let tmp = tempdir().unwrap();
        let skill = tmp.path().join("skill");
        fs::create_dir(&skill).unwrap();
        let broken = skill.join("SKILL.md");
        std::os::unix::fs::symlink(tmp.path().join("missing.md"), &broken).unwrap();
        assert!(hash_directory_strict_v2(&skill).is_err());
        assert!(hash_directory_ownership_v1(&skill).is_err());

        fs::remove_file(&broken).unwrap();
        fs::write(skill.join("SKILL.md"), "# demo").unwrap();
        let directory = tmp.path().join("linked-dir");
        fs::create_dir(&directory).unwrap();
        std::os::unix::fs::symlink(&directory, skill.join("nested")).unwrap();
        let error = hash_directory_strict_v2(&skill).unwrap_err();
        assert!(
            error.to_string().contains("Directory symlinks"),
            "unexpected error: {error}"
        );

        assert!(hash_directory_ownership_v1(&skill).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn strict_v2_supports_symlinked_root_and_hashes_exec_bits() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempdir().unwrap();
        let real = tmp.path().join("skill");
        fs::create_dir(&real).unwrap();
        let script = real.join("run.sh");
        fs::write(&script, "#!/bin/sh\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o644)).unwrap();
        let link = tmp.path().join("linked-skill");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let initial = hash_directory_strict_v2(&real).unwrap();
        assert_eq!(initial, hash_directory_strict_v2(&link).unwrap());

        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        assert_ne!(initial, hash_directory_strict_v2(&real).unwrap());
    }

    #[test]
    fn strict_v2_rejects_missing_or_non_directory_roots() {
        let tmp = tempdir().unwrap();
        let file = tmp.path().join("not-a-directory");
        fs::write(&file, "content").unwrap();

        assert!(hash_directory_strict_v2(&file).is_err());
        assert!(hash_directory_strict_v2(&tmp.path().join("missing")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn strict_v2_rejects_non_utf8_relative_paths() {
        use std::os::unix::ffi::OsStringExt;

        let invalid_name = std::ffi::OsString::from_vec(vec![b'n', b'a', b'm', b'e', 0xff]);
        let invalid_path = PathBuf::from(invalid_name);
        let error = normalized_path_text(&invalid_path, "Relative path").unwrap_err();
        assert!(
            error.to_string().contains("not valid UTF-8"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn strict_v2_propagates_open_and_read_errors() {
        let tmp = tempdir().unwrap();
        let missing = tmp.path().join("missing.md");
        let open_error = hash_strict_file_contents(&mut Sha256::new(), &missing, 1).unwrap_err();
        assert!(
            open_error
                .to_string()
                .contains("Failed to open skill content"),
            "unexpected error: {open_error}"
        );

        struct FailingReader {
            returned_bytes: bool,
        }

        impl Read for FailingReader {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                if self.returned_bytes {
                    return Err(io::Error::other("injected read failure"));
                }
                self.returned_bytes = true;
                buffer[..3].copy_from_slice(b"abc");
                Ok(3)
            }
        }

        let mut reader = FailingReader {
            returned_bytes: false,
        };
        let read_error = hash_strict_reader_contents(
            &mut Sha256::new(),
            &mut reader,
            Path::new("injected.md"),
            4,
        )
        .unwrap_err();
        assert!(
            read_error
                .to_string()
                .contains("Failed to read skill content"),
            "unexpected error: {read_error}"
        );
    }

    #[test]
    fn strict_v2_propagates_directory_walk_errors() {
        let tmp = tempdir().unwrap();
        let removed_root = tmp.path().join("removed-before-walk");
        fs::create_dir(&removed_root).unwrap();
        let canonical_root = fs::canonicalize(&removed_root).unwrap();
        fs::remove_dir(&removed_root).unwrap();

        let error = strict_content_entries_at_root(&canonical_root).unwrap_err();
        assert!(
            error.to_string().contains("Failed to walk"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn strict_streaming_matches_direct_framing_across_buffer_boundaries() {
        for size in [
            0,
            STRICT_HASH_BUFFER_SIZE - 1,
            STRICT_HASH_BUFFER_SIZE,
            STRICT_HASH_BUFFER_SIZE + 1,
            STRICT_HASH_BUFFER_SIZE * 2 + 1,
        ] {
            let bytes = vec![0x5a; size];
            let mut reader = Cursor::new(bytes.as_slice());
            let mut streamed = Sha256::new();
            hash_strict_reader_contents(
                &mut streamed,
                &mut reader,
                Path::new("boundary.bin"),
                size as u64,
            )
            .unwrap();

            let mut direct = Sha256::new();
            strict_field(&mut direct, b"content", &bytes);
            assert_eq!(
                streamed.finalize(),
                direct.finalize(),
                "stream framing differed at {size} bytes"
            );
        }
    }
}
