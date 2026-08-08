//! Debug-only, fail-closed filesystem isolation for product evaluation.
//!
//! B0-R must exercise the real Skills Manager UI without opening the user's
//! real database or discovering active Agent roots. A task-specific runtime
//! root keeps those reads and writes inside a frozen session copy. Release
//! builds reject the override instead of silently accepting test behavior.

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

use super::{central_repo, tool_adapters};

pub const EVALUATION_ROOT_ENV: &str = "SKILLS_MANAGER_EVAL_ROOT";
const MARKER_FILE: &str = ".skill-card-master-eval.json";
const MARKER_PURPOSE: &str = "skill-card-master-b0-r";
const MARKER_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
struct EvaluationMarker {
    schema_version: u32,
    purpose: String,
    sample: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvaluationRuntime {
    pub root: PathBuf,
    pub base_dir: PathBuf,
    pub home_dir: PathBuf,
    pub sample: String,
}

pub fn apply_from_env() -> Result<Option<EvaluationRuntime>> {
    let Some(raw_root) = std::env::var_os(EVALUATION_ROOT_ENV) else {
        return Ok(None);
    };

    #[cfg(not(debug_assertions))]
    {
        let _ = raw_root;
        bail!("{EVALUATION_ROOT_ENV} is accepted only by debug builds");
    }

    #[cfg(debug_assertions)]
    {
        let runtime = resolve_runtime(&raw_root)?;
        central_repo::set_runtime_base_dir_override(Some(runtime.base_dir.clone()));
        central_repo::set_runtime_skills_dir_override(None);
        central_repo::set_runtime_repo_config_disabled(true);
        tool_adapters::set_runtime_home_dir_override(Some(runtime.home_dir.clone()));
        Ok(Some(runtime))
    }
}

fn resolve_runtime(raw_root: &OsStr) -> Result<EvaluationRuntime> {
    let declared_root = PathBuf::from(raw_root);
    if !declared_root.is_absolute() {
        bail!("{EVALUATION_ROOT_ENV} must be an absolute path");
    }

    let root_metadata = fs::symlink_metadata(&declared_root)
        .with_context(|| format!("Evaluation root is unavailable: {}", declared_root.display()))?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        bail!("Evaluation root must be a real directory, not a symlink");
    }
    let root = fs::canonicalize(&declared_root).context("Cannot canonicalize evaluation root")?;
    reject_sensitive_overlap(&root)?;

    let marker_path = root.join(MARKER_FILE);
    let marker_metadata = fs::symlink_metadata(&marker_path)
        .with_context(|| format!("Missing evaluation marker: {}", marker_path.display()))?;
    if marker_metadata.file_type().is_symlink() || !marker_metadata.is_file() {
        bail!("Evaluation marker must be a regular file");
    }
    let marker: EvaluationMarker = serde_json::from_slice(
        &fs::read(&marker_path).context("Cannot read evaluation marker")?,
    )
    .context("Invalid evaluation marker JSON")?;
    if marker.schema_version != MARKER_SCHEMA_VERSION || marker.purpose != MARKER_PURPOSE {
        bail!("Evaluation marker contract does not match B0-R");
    }
    if marker.sample.trim().is_empty() {
        bail!("Evaluation marker sample cannot be empty");
    }

    let base_dir = checked_directory(&root, "central")?;
    let home_dir = checked_directory(&root, "home")?;
    checked_directory(&root, "central/skills")?;
    checked_directory(&root, "home/.codex")?;
    checked_directory(&root, "home/.codex/skills")?;
    checked_optional_regular_file(&root, "central/skills-manager.db")?;

    Ok(EvaluationRuntime {
        root,
        base_dir,
        home_dir,
        sample: marker.sample,
    })
}

fn checked_optional_regular_file(root: &Path, relative: &str) -> Result<Option<PathBuf>> {
    let declared = root.join(relative);
    let metadata = match fs::symlink_metadata(&declared) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(error).with_context(|| {
                format!("Cannot inspect evaluation file: {}", declared.display())
            });
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("Evaluation file must be regular: {}", declared.display());
    }
    let canonical = fs::canonicalize(&declared)
        .with_context(|| format!("Cannot canonicalize evaluation file: {relative}"))?;
    if !canonical.starts_with(root) {
        bail!("Evaluation file escapes runtime root: {relative}");
    }
    Ok(Some(canonical))
}

fn checked_directory(root: &Path, relative: &str) -> Result<PathBuf> {
    let declared = root.join(relative);
    let metadata = fs::symlink_metadata(&declared)
        .with_context(|| format!("Missing evaluation directory: {}", declared.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        bail!("Evaluation directory must be real: {}", declared.display());
    }
    let canonical = fs::canonicalize(&declared)
        .with_context(|| format!("Cannot canonicalize evaluation directory: {relative}"))?;
    if !canonical.starts_with(root) {
        bail!("Evaluation directory escapes runtime root: {relative}");
    }
    Ok(canonical)
}

fn reject_sensitive_overlap(root: &Path) -> Result<()> {
    let Some(real_home) = dirs::home_dir() else {
        return Ok(());
    };
    for relative in [".skills-manager", ".codex", ".agents", ".claude"] {
        let sensitive = real_home.join(relative);
        if root.starts_with(&sensitive) || sensitive.starts_with(root) {
            bail!(
                "Evaluation root overlaps a real runtime boundary: {}",
                sensitive.display()
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn valid_runtime() -> tempfile::TempDir {
        let temp = tempdir().unwrap();
        fs::create_dir_all(temp.path().join("central/skills")).unwrap();
        fs::create_dir_all(temp.path().join("home/.codex/skills")).unwrap();
        fs::write(
            temp.path().join(MARKER_FILE),
            r#"{"schema_version":1,"purpose":"skill-card-master-b0-r","sample":"C0-docx"}"#,
        )
        .unwrap();
        temp
    }

    #[test]
    fn resolves_only_a_marked_complete_runtime_tree() {
        let temp = valid_runtime();
        let runtime = resolve_runtime(temp.path().as_os_str()).unwrap();
        assert_eq!(runtime.root, fs::canonicalize(temp.path()).unwrap());
        assert_eq!(runtime.base_dir, fs::canonicalize(temp.path().join("central")).unwrap());
        assert_eq!(runtime.home_dir, fs::canonicalize(temp.path().join("home")).unwrap());
        assert_eq!(runtime.sample, "C0-docx");
    }

    #[test]
    fn missing_marker_fails_closed() {
        let temp = valid_runtime();
        fs::remove_file(temp.path().join(MARKER_FILE)).unwrap();
        assert!(resolve_runtime(temp.path().as_os_str()).is_err());
    }

    #[test]
    fn incomplete_runtime_tree_fails_closed() {
        let temp = valid_runtime();
        fs::remove_dir_all(temp.path().join("home/.codex/skills")).unwrap();
        assert!(resolve_runtime(temp.path().as_os_str()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_runtime_root_is_rejected() {
        let temp = valid_runtime();
        let alias_parent = tempdir().unwrap();
        let alias = alias_parent.path().join("alias");
        std::os::unix::fs::symlink(temp.path(), &alias).unwrap();
        assert!(resolve_runtime(alias.as_os_str()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_database_is_rejected() {
        let temp = valid_runtime();
        let external = tempdir().unwrap();
        let external_db = external.path().join("skills-manager.db");
        fs::write(&external_db, b"not-a-real-database").unwrap();
        std::os::unix::fs::symlink(
            &external_db,
            temp.path().join("central/skills-manager.db"),
        )
        .unwrap();

        assert!(resolve_runtime(temp.path().as_os_str()).is_err());
    }
}
