use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};

use super::content_hash;
use super::host_discovery::{
    DiscoveryDiagnostic, DiscoveryInput, DiscoveryProvenance, DiscoveryRoot, DiscoverySourceKind,
    Traversal,
};
use super::skill_metadata;
use super::skill_store::DiscoveredSkillRecord;
use super::tool_adapters;

#[derive(Debug)]
pub struct ScanPlan {
    pub tools_scanned: usize,
    pub skills_found: usize,
    pub discovered: Vec<DiscoveredSkillRecord>,
    pub diagnostics: Vec<DiscoveryDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredGroup {
    pub name: String,
    pub fingerprint: Option<String>,
    pub locations: Vec<DiscoveredLocation>,
    pub imported: bool,
    pub found_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiscoveredLocation {
    pub id: String,
    pub tool: String,
    pub found_path: String,
    pub provenance: Option<DiscoveryProvenance>,
    pub content_error: Option<String>,
}

/// Directories to skip during recursive scans (internal/tool-specific metadata).
const RECURSIVE_SCAN_SKIP_DIRS: &[&str] = &[".hub", ".git", "node_modules"];

fn is_symlink_to_central(path: &Path) -> bool {
    if let Ok(target) = std::fs::read_link(path) {
        let central = super::central_repo::skills_dir();
        return target.starts_with(&central);
    }
    false
}

/// Recursively walk `dir` and return all subdirectories that contain SKILL.md.
/// Stops descending when a skill dir is found (skills don't nest). Skips
/// `.git` / `node_modules` / `.hub` and guards against symlink cycles.
pub fn collect_skill_dirs(dir: &Path) -> Vec<PathBuf> {
    let mut results = Vec::new();
    let mut visited = HashSet::new();
    collect_skill_dirs_recursive(dir, &mut visited, &mut results);
    results
}

fn collect_skill_dirs_recursive(
    dir: &Path,
    visited: &mut HashSet<PathBuf>,
    results: &mut Vec<PathBuf>,
) {
    let canonical = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    if !visited.insert(canonical) {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() && !path.is_symlink() {
            continue;
        }
        let dir_name = entry.file_name();
        let dir_name_str = dir_name.to_string_lossy();
        if RECURSIVE_SCAN_SKIP_DIRS.iter().any(|s| dir_name_str == *s) {
            continue;
        }
        if is_symlink_to_central(&path) {
            continue;
        }
        if skill_metadata::is_valid_skill_dir(&path) {
            results.push(path);
            continue;
        }
        collect_skill_dirs_recursive(&path, visited, results);
    }
}

#[allow(dead_code)]
pub fn scan_local_skills(managed_paths: &[String]) -> Result<ScanPlan> {
    scan_local_skills_with_adapters(managed_paths, &tool_adapters::default_tool_adapters())
}

pub fn scan_local_skills_with_adapters(
    managed_paths: &[String],
    adapters: &[tool_adapters::ToolAdapter],
) -> Result<ScanPlan> {
    let input = super::host_discovery::static_discovery_input(adapters)?;
    scan_discovery_roots(managed_paths, input)
}

/// Scan frozen host roots with strict, versioned content identity. Discovery
/// errors abort the snapshot; a known Skill whose content cannot be proven is
/// retained with no digest and an explicit diagnostic.
pub fn scan_discovery_roots(managed_paths: &[String], input: DiscoveryInput) -> Result<ScanPlan> {
    let managed = canonical_managed_paths(managed_paths)?;
    let DiscoveryInput {
        roots,
        mut diagnostics,
    } = input;
    let tools_scanned = roots
        .iter()
        .map(|root| root.host_key.as_str())
        .collect::<BTreeSet<_>>()
        .len();
    let mut discovered = Vec::new();

    for root in &roots {
        for path in collect_strict_skill_dirs(root)? {
            push_strict_discovered(root, path, &managed, &mut discovered, &mut diagnostics)?;
        }
    }

    let skills_found = discovered.len();
    Ok(ScanPlan {
        tools_scanned,
        skills_found,
        discovered,
        diagnostics,
    })
}

fn canonical_managed_paths(paths: &[String]) -> Result<HashSet<PathBuf>> {
    Ok(paths
        .iter()
        .map(PathBuf::from)
        .map(|path| std::fs::canonicalize(&path).unwrap_or(path))
        .collect())
}

fn collect_strict_skill_dirs(root: &DiscoveryRoot) -> Result<Vec<PathBuf>> {
    let metadata = std::fs::metadata(&root.path)
        .with_context(|| format!("Cannot inspect discovery root {}", root.path.display()))?;
    if !metadata.is_dir() {
        bail!("Discovery root is not a directory: {}", root.path.display());
    }
    if is_strict_skill_dir(&root.path)? {
        return Ok(vec![root.path.clone()]);
    }

    let mut results = Vec::new();
    let mut visited = HashSet::new();
    collect_strict_children(
        &root.path,
        root.traversal == Traversal::Recursive,
        root.provenance.source_kind == DiscoverySourceKind::CodexPlugin,
        &mut visited,
        &mut results,
    )?;
    Ok(results)
}

fn collect_strict_children(
    dir: &Path,
    recursive: bool,
    reject_directory_symlinks: bool,
    visited: &mut HashSet<PathBuf>,
    results: &mut Vec<PathBuf>,
) -> Result<()> {
    let canonical = std::fs::canonicalize(dir)
        .with_context(|| format!("Cannot resolve discovery directory {}", dir.display()))?;
    if !visited.insert(canonical) {
        return Ok(());
    }
    let entries = std::fs::read_dir(dir)
        .with_context(|| format!("Cannot enumerate discovery directory {}", dir.display()))?;
    for item in entries {
        let entry =
            item.with_context(|| format!("Cannot inspect entry under {}", dir.display()))?;
        let name = entry
            .file_name()
            .to_str()
            .context("Discovery entry name is not valid UTF-8")?
            .to_string();
        if RECURSIVE_SCAN_SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }
        let path = entry.path();
        let file_type = entry
            .file_type()
            .with_context(|| format!("Cannot inspect discovery entry {}", path.display()))?;
        if !file_type.is_dir() && !file_type.is_symlink() {
            continue;
        }
        if file_type.is_symlink() {
            let target = std::fs::metadata(&path)
                .with_context(|| format!("Broken discovery symlink {}", path.display()))?;
            // Manifest-owned roots are ownership boundaries. A directory
            // symlink can point outside that boundary, including to an
            // otherwise valid Skill, so reject it before Skill detection.
            // Loose roots still accept Agent-facing Skill projections even
            // when an adapter uses recursive discovery (for example Hermes).
            if reject_directory_symlinks && target.is_dir() {
                bail!(
                    "Recursive inventory rejects directory symlink: {}",
                    path.display()
                );
            }
        }
        if is_strict_skill_dir(&path)? {
            results.push(path);
            continue;
        }
        if file_type.is_symlink() {
            continue;
        }
        if recursive {
            collect_strict_children(&path, true, reject_directory_symlinks, visited, results)?;
        }
    }
    Ok(())
}

fn is_strict_skill_dir(path: &Path) -> Result<bool> {
    if !std::fs::metadata(path)
        .with_context(|| format!("Cannot inspect potential Skill {}", path.display()))?
        .is_dir()
    {
        return Ok(false);
    }
    for item in std::fs::read_dir(path)
        .with_context(|| format!("Cannot enumerate potential Skill {}", path.display()))?
    {
        let entry =
            item.with_context(|| format!("Cannot inspect entry under {}", path.display()))?;
        let name = entry
            .file_name()
            .to_str()
            .context("Potential Skill entry name is not valid UTF-8")?
            .to_string();
        if !matches!(name.as_str(), "SKILL.md" | "skill.md") {
            continue;
        }
        let file_type = entry
            .file_type()
            .with_context(|| format!("Cannot inspect Skill marker {}", entry.path().display()))?;
        if file_type.is_file() {
            return Ok(true);
        }
        if file_type.is_symlink() {
            // The exact marker symlink is itself enough to identify a broken
            // Skill projection. Content proof below determines whether the
            // Agent-readable target is complete and records Unknown if not.
            return Ok(true);
        }
    }
    Ok(false)
}

fn push_strict_discovered(
    root: &DiscoveryRoot,
    path: PathBuf,
    managed_paths: &HashSet<PathBuf>,
    discovered: &mut Vec<DiscoveredSkillRecord>,
    diagnostics: &mut Vec<DiscoveryDiagnostic>,
) -> Result<()> {
    let canonical = std::fs::canonicalize(&path)
        .with_context(|| format!("Cannot resolve discovered Skill {}", path.display()))?;
    if managed_paths.contains(&canonical) {
        return Ok(());
    }
    let path_text = path
        .to_str()
        .with_context(|| {
            format!(
                "Discovered Skill path is not valid UTF-8: {}",
                path.display()
            )
        })?
        .to_string();
    let source_root = Path::new(&root.provenance.source_ref);
    let subpath = path
        .strip_prefix(source_root)
        .with_context(|| {
            format!(
                "Discovered Skill {} is outside declared source {}",
                path.display(),
                source_root.display()
            )
        })?
        .to_str()
        .context("Discovery source subpath is not valid UTF-8")?;
    let mut provenance = root.provenance.clone();
    provenance.source_subpath = Some(if subpath.is_empty() {
        ".".to_string()
    } else {
        subpath.to_string()
    });
    let found_at = std::fs::metadata(&path)
        .with_context(|| format!("Cannot inspect discovered Skill {}", path.display()))?
        .modified()
        .with_context(|| format!("Cannot read modification time for {}", path.display()))?
        .duration_since(std::time::UNIX_EPOCH)
        .with_context(|| format!("Invalid modification time for {}", path.display()))?
        .as_millis() as i64;

    let (fingerprint, content_error) = match content_hash::hash_directory_strict_v2(&path) {
        Ok(digest) => (Some(digest), None),
        Err(error) => {
            let message = format!("Cannot prove complete Skill content at {path_text}: {error:#}");
            diagnostics.push(DiscoveryDiagnostic {
                code: "content_unverifiable".to_string(),
                owner_ref: Some(provenance.owner_ref.clone()),
                found_path: Some(path_text.clone()),
                message: message.clone(),
            });
            (None, Some(message))
        }
    };

    discovered.push(DiscoveredSkillRecord {
        id: uuid::Uuid::new_v4().to_string(),
        tool: root.host_key.clone(),
        found_path: path_text,
        name_guess: Some(skill_metadata::infer_skill_name_with_file_symlinks(&path)),
        fingerprint,
        content_error,
        found_at,
        imported_skill_id: None,
        provenance: Some(provenance),
    });
    Ok(())
}

pub fn group_discovered(records: &[DiscoveredSkillRecord]) -> Vec<DiscoveredGroup> {
    use std::collections::HashMap;
    #[derive(Hash, PartialEq, Eq)]
    enum GroupKey {
        Path(String),
        Lineage {
            owner_ref: String,
            source_ref: String,
            source_revision: Option<String>,
            source_subpath: Option<String>,
        },
    }
    let mut groups: HashMap<GroupKey, DiscoveredGroup> = HashMap::new();

    for rec in records {
        let name = rec.name_guess.clone().unwrap_or_else(|| "unknown".into());
        // Content equality is evidence, never ownership. Versioned package
        // sources group only by declared lineage; loose and legacy records
        // group by physical path because several Hosts can consume one shared
        // directory without creating another import candidate.
        let canonical_path = || {
            std::fs::canonicalize(&rec.found_path)
                .unwrap_or_else(|_| PathBuf::from(&rec.found_path))
                .to_string_lossy()
                .to_string()
        };
        let group_key = match rec.provenance.as_ref() {
            // A shared loose directory can be consumed by multiple Hosts. The
            // physical location is one import candidate even though every Host
            // observation remains visible in `locations`.
            Some(provenance) if provenance.source_kind == DiscoverySourceKind::Loose => {
                GroupKey::Path(canonical_path())
            }
            Some(provenance) => GroupKey::Lineage {
                owner_ref: provenance.owner_ref.clone(),
                source_ref: provenance.source_ref.clone(),
                source_revision: provenance.source_revision.clone(),
                source_subpath: provenance.source_subpath.clone(),
            },
            None => GroupKey::Path(canonical_path()),
        };
        let entry = groups.entry(group_key).or_insert_with(|| DiscoveredGroup {
            name,
            fingerprint: rec.fingerprint.clone(),
            locations: Vec::new(),
            imported: false,
            found_at: rec.found_at,
        });

        if rec.imported_skill_id.is_some() {
            entry.imported = true;
        }

        // Use the earliest found_at
        if rec.found_at < entry.found_at {
            entry.found_at = rec.found_at;
        }

        entry.locations.push(DiscoveredLocation {
            id: rec.id.clone(),
            tool: rec.tool.clone(),
            found_path: rec.found_path.clone(),
            provenance: rec.provenance.clone(),
            content_error: rec.content_error.clone(),
        });
    }

    let mut result: Vec<_> = groups.into_values().collect();
    result.sort_by(|a, b| a.name.cmp(&b.name));
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::host_discovery::DiscoverySourceKind;
    use std::fs;
    use tempfile::tempdir;

    fn write_skill(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("SKILL.md"), "---\nname: x\n---\n# x").unwrap();
    }

    fn discovery_root(path: &Path, owner: &str, traversal: Traversal) -> DiscoveryRoot {
        DiscoveryRoot {
            host_key: "codex".to_string(),
            path: path.to_path_buf(),
            traversal,
            provenance: DiscoveryProvenance {
                source_kind: DiscoverySourceKind::CodexPlugin,
                owner_ref: owner.to_string(),
                source_ref: path.to_string_lossy().to_string(),
                source_version: Some("1.0.0".to_string()),
                source_revision: Some("rev-1".to_string()),
                source_subpath: None,
                declared_repository: None,
                provenance_basis: "test".to_string(),
                digest_algorithm: content_hash::STRICT_DIRECTORY_DIGEST_ALGORITHM.to_string(),
            },
        }
    }

    fn run(root: &Path) -> Vec<PathBuf> {
        let mut results = Vec::new();
        let mut visited = HashSet::new();
        collect_skill_dirs_recursive(root, &mut visited, &mut results);
        results.sort();
        results
    }

    #[test]
    fn recursive_finds_nested_skills() {
        let tmp = tempdir().unwrap();
        write_skill(&tmp.path().join("devops/deploy-k8s"));
        write_skill(&tmp.path().join("software-development/super-dev"));

        let results = run(tmp.path());
        assert_eq!(results.len(), 2);
        let names: Vec<_> = results
            .iter()
            .filter_map(|p| p.file_name().and_then(|n| n.to_str()))
            .collect();
        assert!(names.contains(&"deploy-k8s"));
        assert!(names.contains(&"super-dev"));
    }

    #[test]
    fn recursive_stops_descending_into_skill_dir() {
        // A skill dir's own subdirectories must not be reported as separate skills,
        // even if they happen to contain their own SKILL.md.
        let tmp = tempdir().unwrap();
        write_skill(&tmp.path().join("my-skill"));
        write_skill(&tmp.path().join("my-skill/nested"));

        let results = run(tmp.path());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].file_name().unwrap(), "my-skill");
    }

    #[test]
    fn recursive_skips_internal_dirs() {
        let tmp = tempdir().unwrap();
        write_skill(&tmp.path().join(".git/bogus"));
        write_skill(&tmp.path().join("node_modules/pkg"));
        write_skill(&tmp.path().join(".hub/hidden"));
        write_skill(&tmp.path().join("real-category/real-skill"));

        let results = run(tmp.path());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].file_name().unwrap(), "real-skill");
    }

    #[test]
    fn recursive_finds_deeply_nested_skill() {
        let tmp = tempdir().unwrap();
        let mut deep = tmp.path().to_path_buf();
        for _ in 0..16 {
            deep = deep.join("lvl");
        }
        write_skill(&deep);

        let results = run(tmp.path());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].file_name().unwrap(), "lvl");
    }

    #[cfg(unix)]
    #[test]
    fn recursive_survives_symlink_cycle() {
        use std::os::unix::fs::symlink;

        let tmp = tempdir().unwrap();
        write_skill(&tmp.path().join("category/real-skill"));
        // Self-referential loop: `category/loop -> category`
        symlink(
            tmp.path().join("category"),
            tmp.path().join("category/loop"),
        )
        .unwrap();

        let results = run(tmp.path());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].file_name().unwrap(), "real-skill");
    }

    #[test]
    fn flat_scan_requires_skill_marker() {
        let tmp = tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("not-a-skill")).unwrap();
        write_skill(&tmp.path().join("real-skill"));

        let adapter = tool_adapters::ToolAdapter {
            key: "test".into(),
            display_name: "Test".into(),
            relative_skills_dir: String::new(),
            relative_detect_dir: String::new(),
            additional_scan_dirs: vec![],
            override_skills_dir: Some(tmp.path().to_string_lossy().to_string()),
            is_custom: true,
            recursive_scan: false,
            project_relative_skills_dir: None,
            category: Default::default(),
        };

        let plan = scan_local_skills_with_adapters(&[], &[adapter]).unwrap();
        assert_eq!(plan.skills_found, 1);
        assert_eq!(
            plan.discovered[0].found_path,
            tmp.path().join("real-skill").to_string_lossy()
        );
    }

    #[test]
    fn additional_scan_dirs_scan_concrete_skills_roots() {
        let tmp = tempdir().unwrap();
        let primary = tmp.path().join("skills");
        let plugin_skills = tmp.path().join("plugins").join("vendor").join("skills");
        fs::create_dir_all(&primary).unwrap();
        write_skill(&plugin_skills.join("packaged-skill"));

        let adapter = tool_adapters::ToolAdapter {
            key: "test".into(),
            display_name: "Test".into(),
            relative_skills_dir: String::new(),
            relative_detect_dir: String::new(),
            additional_scan_dirs: vec![],
            override_skills_dir: Some(primary.to_string_lossy().to_string()),
            is_custom: true,
            recursive_scan: false,
            project_relative_skills_dir: None,
            category: Default::default(),
        };

        let adapter_with_extra = tool_adapters::ToolAdapter {
            additional_scan_dirs: vec![plugin_skills.to_string_lossy().to_string()],
            ..adapter
        };

        let plan = scan_local_skills_with_adapters(&[], &[adapter_with_extra]).unwrap();
        assert_eq!(plan.skills_found, 1);
        assert_eq!(
            plan.discovered[0].found_path,
            plugin_skills.join("packaged-skill").to_string_lossy()
        );
    }

    #[test]
    fn strict_scan_preserves_owner_and_versioned_digest_provenance() {
        let tmp = tempdir().unwrap();
        write_skill(&tmp.path().join("skills/alpha"));
        let input = DiscoveryInput {
            roots: vec![discovery_root(
                tmp.path(),
                "plugin@market",
                Traversal::Recursive,
            )],
            diagnostics: Vec::new(),
        };
        let plan = scan_discovery_roots(&[], input).unwrap();
        assert_eq!(plan.skills_found, 1);
        let provenance = plan.discovered[0].provenance.as_ref().unwrap();
        assert_eq!(provenance.owner_ref, "plugin@market");
        assert_eq!(provenance.source_subpath.as_deref(), Some("skills/alpha"));
        assert_eq!(provenance.digest_algorithm, "scm-dir-v2");
        assert!(plan.discovered[0].fingerprint.is_some());
    }

    #[cfg(unix)]
    #[test]
    fn strict_scan_accepts_skill_marker_file_symlink() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("root");
        let skill = root.join("linked-marker");
        fs::create_dir_all(&skill).unwrap();
        let marker = tmp.path().join("marker.md");
        fs::write(&marker, "---\nname: linked-name\n---\n").unwrap();
        std::os::unix::fs::symlink(&marker, skill.join("SKILL.md")).unwrap();
        let plan = scan_discovery_roots(
            &[],
            DiscoveryInput {
                roots: vec![discovery_root(&root, "plugin@market", Traversal::Flat)],
                diagnostics: Vec::new(),
            },
        )
        .unwrap();
        assert_eq!(plan.skills_found, 1);
        assert_eq!(
            plan.discovered[0].name_guess.as_deref(),
            Some("linked-name")
        );
    }

    #[cfg(unix)]
    #[test]
    fn strict_recursive_scan_rejects_non_skill_directory_symlink() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("root");
        let target = tmp.path().join("target");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&target).unwrap();
        std::os::unix::fs::symlink(&target, root.join("linked-category")).unwrap();
        let error = scan_discovery_roots(
            &[],
            DiscoveryInput {
                roots: vec![discovery_root(&root, "plugin@market", Traversal::Recursive)],
                diagnostics: Vec::new(),
            },
        )
        .unwrap_err();
        assert!(error.to_string().contains("directory symlink"));
    }

    #[cfg(unix)]
    #[test]
    fn strict_recursive_scan_rejects_skill_directory_symlink_before_acceptance() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("root");
        let external_skill = tmp.path().join("external-skill");
        fs::create_dir_all(&root).unwrap();
        write_skill(&external_skill);
        std::os::unix::fs::symlink(&external_skill, root.join("escaped-skill")).unwrap();

        let error = scan_discovery_roots(
            &[],
            DiscoveryInput {
                roots: vec![discovery_root(&root, "plugin@market", Traversal::Recursive)],
                diagnostics: Vec::new(),
            },
        )
        .unwrap_err();

        assert!(error.to_string().contains("directory symlink"));
        assert!(error.to_string().contains("escaped-skill"));
    }

    #[cfg(unix)]
    #[test]
    fn strict_recursive_loose_scan_accepts_agent_skill_projection() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("root");
        let external_skill = tmp.path().join("external-skill");
        fs::create_dir_all(&root).unwrap();
        write_skill(&external_skill);
        let projection = root.join("projected-skill");
        std::os::unix::fs::symlink(&external_skill, &projection).unwrap();
        let mut loose_root = discovery_root(&root, "hermes:root", Traversal::Recursive);
        loose_root.provenance.source_kind = DiscoverySourceKind::Loose;

        let plan = scan_discovery_roots(
            &[],
            DiscoveryInput {
                roots: vec![loose_root],
                diagnostics: Vec::new(),
            },
        )
        .unwrap();

        assert_eq!(plan.skills_found, 1);
        assert_eq!(plan.discovered[0].found_path, projection.to_string_lossy());
        assert!(plan.discovered[0].fingerprint.is_some());
    }

    #[cfg(unix)]
    #[test]
    fn known_skill_with_unverifiable_content_is_retained_as_unknown() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("root");
        let skill = root.join("linked-content");
        let target = tmp.path().join("external-bin");
        write_skill(&skill);
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("tool"), "binary").unwrap();
        std::os::unix::fs::symlink(&target, skill.join("bin")).unwrap();

        let plan = scan_discovery_roots(
            &[],
            DiscoveryInput {
                roots: vec![discovery_root(&root, "plugin@market", Traversal::Flat)],
                diagnostics: Vec::new(),
            },
        )
        .unwrap();
        assert_eq!(plan.skills_found, 1);
        assert_eq!(plan.discovered[0].fingerprint, None);
        assert!(plan.discovered[0].content_error.is_some());
        assert_eq!(plan.diagnostics.len(), 1);
        assert_eq!(plan.diagnostics[0].code, "content_unverifiable");
        assert_eq!(plan.diagnostics[0].found_path.as_deref(), skill.to_str());
    }

    #[cfg(unix)]
    #[test]
    fn broken_marker_projection_is_retained_as_unknown() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("root");
        let skill = root.join("broken-marker");
        fs::create_dir_all(&skill).unwrap();
        std::os::unix::fs::symlink(tmp.path().join("missing-skill.md"), skill.join("SKILL.md"))
            .unwrap();
        let plan = scan_discovery_roots(
            &[],
            DiscoveryInput {
                roots: vec![discovery_root(&root, "plugin@market", Traversal::Flat)],
                diagnostics: Vec::new(),
            },
        )
        .unwrap();
        assert_eq!(plan.skills_found, 1);
        assert_eq!(plan.discovered[0].fingerprint, None);
        assert!(plan.discovered[0].content_error.is_some());
        assert_eq!(plan.diagnostics[0].code, "content_unverifiable");
    }

    #[test]
    fn grouping_keeps_same_name_different_fingerprint_separate() {
        let records = vec![
            DiscoveredSkillRecord {
                id: "1".into(),
                tool: "a".into(),
                found_path: "/tmp/one".into(),
                name_guess: Some("shared".into()),
                fingerprint: Some("hash-a".into()),
                content_error: None,
                found_at: 10,
                imported_skill_id: None,
                provenance: None,
            },
            DiscoveredSkillRecord {
                id: "2".into(),
                tool: "b".into(),
                found_path: "/tmp/two".into(),
                name_guess: Some("shared".into()),
                fingerprint: Some("hash-b".into()),
                content_error: None,
                found_at: 20,
                imported_skill_id: None,
                provenance: None,
            },
        ];

        let groups = group_discovered(&records);
        assert_eq!(groups.len(), 2);
    }

    #[test]
    fn grouping_does_not_merge_same_name_same_fingerprint_without_lineage() {
        let records = vec![
            DiscoveredSkillRecord {
                id: "1".into(),
                tool: "a".into(),
                found_path: "/tmp/one".into(),
                name_guess: Some("shared".into()),
                fingerprint: Some("hash-a".into()),
                content_error: None,
                found_at: 10,
                imported_skill_id: None,
                provenance: None,
            },
            DiscoveredSkillRecord {
                id: "2".into(),
                tool: "b".into(),
                found_path: "/tmp/two".into(),
                name_guess: Some("shared".into()),
                fingerprint: Some("hash-a".into()),
                content_error: None,
                found_at: 20,
                imported_skill_id: None,
                provenance: None,
            },
        ];

        let groups = group_discovered(&records);
        assert_eq!(groups.len(), 2);
    }

    #[test]
    fn grouping_keeps_equal_content_from_different_owners_separate() {
        let tmp = tempdir().unwrap();
        let mut first = DiscoveredSkillRecord {
            id: "1".into(),
            tool: "codex".into(),
            found_path: "/tmp/one".into(),
            name_guess: Some("shared".into()),
            fingerprint: Some("same-digest".into()),
            content_error: None,
            found_at: 10,
            imported_skill_id: None,
            provenance: Some(discovery_root(tmp.path(), "one@market", Traversal::Flat).provenance),
        };
        first.provenance.as_mut().unwrap().source_subpath = Some("skills/shared".into());
        let mut second = first.clone();
        second.id = "2".into();
        second.found_path = "/tmp/two".into();
        second.provenance.as_mut().unwrap().owner_ref = "two@market".into();
        assert_eq!(group_discovered(&[first, second]).len(), 2);
    }

    #[test]
    fn grouping_merges_shared_loose_path_across_host_observations() {
        let tmp = tempdir().unwrap();
        let skill = tmp.path().join("shared");
        write_skill(&skill);
        let mut first = DiscoveredSkillRecord {
            id: "1".into(),
            tool: "codex".into(),
            found_path: skill.to_string_lossy().to_string(),
            name_guess: Some("shared".into()),
            fingerprint: Some("same-digest".into()),
            content_error: None,
            found_at: 10,
            imported_skill_id: None,
            provenance: Some(
                discovery_root(tmp.path(), "codex:shared", Traversal::Flat).provenance,
            ),
        };
        first.provenance.as_mut().unwrap().source_kind = DiscoverySourceKind::Loose;
        first.provenance.as_mut().unwrap().source_subpath = Some("shared".into());
        let mut second = first.clone();
        second.id = "2".into();
        second.tool = "github_copilot".into();
        second.provenance.as_mut().unwrap().owner_ref = "github_copilot:shared".into();

        let groups = group_discovered(&[first, second]);

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].locations.len(), 2);
    }

    /// Explicit live gate: reads the current Codex/Agent roots but persists
    /// only into a temporary database. It never imports, syncs, deletes, or
    /// opens the real Skills Manager database.
    #[test]
    #[ignore = "read-only live E0 acceptance; invoke explicitly"]
    fn e0_live_acceptance() {
        use crate::core::host_discovery::DiscoverySourceKind;
        use crate::core::skill_store::SkillStore;

        let adapters = tool_adapters::default_tool_adapters()
            .into_iter()
            .filter(|adapter| matches!(adapter.key.as_str(), "claude_code" | "codex"))
            .collect::<Vec<_>>();
        assert_eq!(adapters.len(), 2);
        let input = crate::core::host_discovery::discovery_input_for_adapters(&adapters).unwrap();
        let enabled_owners = input
            .roots
            .iter()
            .filter(|root| root.provenance.source_kind == DiscoverySourceKind::CodexPlugin)
            .map(|root| root.provenance.owner_ref.as_str())
            .collect::<BTreeSet<_>>()
            .len();
        let plan = scan_discovery_roots(&[], input).unwrap();
        let loose =
            plan.discovered
                .iter()
                .filter(|record| {
                    record.provenance.as_ref().is_some_and(|provenance| {
                        provenance.source_kind == DiscoverySourceKind::Loose
                    })
                })
                .count();
        let plugin = plan.skills_found - loose;
        let loose_by_source = plan
            .discovered
            .iter()
            .filter_map(|record| record.provenance.as_ref())
            .filter(|provenance| provenance.source_kind == DiscoverySourceKind::Loose)
            .fold(
                std::collections::BTreeMap::new(),
                |mut counts, provenance| {
                    *counts
                        .entry(provenance.source_ref.clone())
                        .or_insert(0usize) += 1;
                    counts
                },
            );

        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("acceptance.db")).unwrap();
        store.replace_discovered(&plan.discovered).unwrap();
        let persisted = store.get_all_discovered().unwrap();
        assert_eq!(persisted.len(), plan.skills_found);
        eprintln!("E0 live diagnostics: {:#?}", plan.diagnostics);
        assert_eq!(enabled_owners, 16);
        assert_eq!(loose, 493);
        assert_eq!(plugin, 66);
        let home = dirs::home_dir().unwrap();
        assert_eq!(
            loose_by_source.get(&home.join(".agents/skills").to_string_lossy().to_string()),
            Some(&110)
        );
        assert_eq!(
            loose_by_source.get(&home.join(".claude/skills").to_string_lossy().to_string()),
            Some(&168)
        );
        assert_eq!(
            loose_by_source.get(&home.join(".codex/skills").to_string_lossy().to_string()),
            Some(&215)
        );
        assert_eq!(plan.diagnostics.len(), 11);
        assert!(plan
            .diagnostics
            .iter()
            .all(|diagnostic| diagnostic.code == "content_unverifiable"));
        assert_eq!(
            persisted
                .iter()
                .filter(|record| record.content_error.is_some())
                .count(),
            11
        );
        eprintln!(
            "E0 live acceptance: {loose} loose + {plugin} plugin projections from {enabled_owners} owners"
        );
    }
}
