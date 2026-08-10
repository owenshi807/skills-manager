//! Debug-only, fail-closed filesystem isolation for product evaluation.
//!
//! B0-R must exercise the real Skills Manager UI without opening the user's
//! real database or discovering active Agent roots. A task-specific runtime
//! root keeps those reads and writes inside a frozen session copy. Release
//! builds reject the override instead of silently accepting test behavior.

use anyhow::{bail, Context, Result};
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use std::ffi::OsStr;
use std::fs;
use std::path::{Component, Path, PathBuf};

use super::{central_repo, path_guard, tool_adapters};

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
    if let Some(database) = checked_optional_regular_file(&root, "central/skills-manager.db")? {
        validate_persisted_paths(&database, &root, &base_dir.join("skills"))?;
    }

    Ok(EvaluationRuntime {
        root,
        base_dir,
        home_dir,
        sample: marker.sample,
    })
}

fn validate_persisted_paths(database: &Path, root: &Path, skills_root: &Path) -> Result<()> {
    let connection = Connection::open_with_flags(
        database,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .context("Cannot open evaluation database for path validation")?;

    for (table, column, allowed_root, allow_non_absolute) in [
        ("skills", "central_path", skills_root, false),
        ("skills", "source_ref", root, true),
        ("skills", "source_ref_resolved", root, true),
        ("skill_targets", "target_path", root, false),
        ("projects", "path", root, false),
        ("projects", "disabled_path", root, false),
        ("discovered_skills", "found_path", root, false),
        (
            "discovered_skills",
            "discovery_source_ref",
            root,
            true,
        ),
        ("pending_conflicts", "theirs_path", root, true),
    ] {
        validate_path_column(
            &connection,
            table,
            column,
            allowed_root,
            allow_non_absolute,
        )?;
    }
    Ok(())
}

fn validate_path_column(
    connection: &Connection,
    table: &str,
    column: &str,
    allowed_root: &Path,
    allow_non_absolute: bool,
) -> Result<()> {
    if !table_has_column(connection, table, column)? {
        return Ok(());
    }

    // Identifiers are compile-time constants supplied by validate_persisted_paths.
    let sql = format!(
        "SELECT rowid, \"{column}\" FROM \"{table}\" \
         WHERE \"{column}\" IS NOT NULL AND TRIM(\"{column}\") != ''"
    );
    let mut statement = connection
        .prepare(&sql)
        .with_context(|| format!("Cannot inspect evaluation database column {table}.{column}"))?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;

    for row in rows {
        let (rowid, raw_path) = row?;
        let path = Path::new(&raw_path);
        if allow_non_absolute && !path.is_absolute() {
            continue;
        }
        if !is_strictly_contained(allowed_root, path) {
            bail!(
                "Evaluation database path escapes runtime boundary: {table}.{column} row {rowid}"
            );
        }
    }
    Ok(())
}

fn table_has_column(connection: &Connection, table: &str, column: &str) -> Result<bool> {
    // The table name is one of the compile-time constants above.
    let mut statement = connection.prepare(&format!("PRAGMA table_info(\"{table}\")"))?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    for candidate in columns {
        if candidate? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn is_strictly_contained(root: &Path, path: &Path) -> bool {
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        || !path_guard::is_path_safe(root, path)
    {
        return false;
    }

    match (fs::canonicalize(root), fs::canonicalize(path)) {
        (Ok(canonical_root), Ok(canonical_path)) => canonical_path != canonical_root,
        _ => path != root,
    }
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
    use rusqlite::params;
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

    fn create_path_tables(runtime: &Path) -> Connection {
        let database = runtime.join("central/skills-manager.db");
        let connection = Connection::open(database).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE skills (id TEXT PRIMARY KEY, central_path TEXT NOT NULL, source_ref TEXT, source_ref_resolved TEXT);\
                 CREATE TABLE skill_targets (id TEXT PRIMARY KEY, target_path TEXT NOT NULL);\
                 CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT NOT NULL, disabled_path TEXT);\
                 CREATE TABLE discovered_skills (id TEXT PRIMARY KEY, found_path TEXT NOT NULL, discovery_source_ref TEXT);\
                 CREATE TABLE pending_conflicts (skill_id TEXT PRIMARY KEY, theirs_path TEXT);",
            )
            .unwrap();
        connection
    }

    #[test]
    fn contained_persisted_paths_are_accepted() {
        let temp = valid_runtime();
        let connection = create_path_tables(temp.path());
        let central_path = temp
            .path()
            .join("central/skills/skill")
            .to_string_lossy()
            .into_owned();
        let target_path = temp
            .path()
            .join("home/.codex/skills/skill")
            .to_string_lossy()
            .into_owned();
        let project_path = temp
            .path()
            .join("workspaces/project")
            .to_string_lossy()
            .into_owned();
        let disabled_path = temp
            .path()
            .join("workspaces/project-disabled")
            .to_string_lossy()
            .into_owned();
        connection
            .execute(
                "INSERT INTO skills (id, central_path) VALUES (?1, ?2)",
                params!["skill", central_path],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO skill_targets (id, target_path) VALUES (?1, ?2)",
                params!["target", target_path],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO projects (id, path, disabled_path) VALUES (?1, ?2, ?3)",
                params!["project", project_path, disabled_path],
            )
            .unwrap();
        drop(connection);

        assert!(resolve_runtime(temp.path().as_os_str()).is_ok());
    }

    #[test]
    fn external_persisted_target_is_rejected() {
        let temp = valid_runtime();
        let external = tempdir().unwrap();
        let connection = create_path_tables(temp.path());
        let target_path = external
            .path()
            .join("live-agent-skill")
            .to_string_lossy()
            .into_owned();
        connection
            .execute(
                "INSERT INTO skill_targets (id, target_path) VALUES (?1, ?2)",
                params!["target", target_path],
            )
            .unwrap();
        drop(connection);

        assert!(resolve_runtime(temp.path().as_os_str()).is_err());
    }

    #[test]
    fn external_persisted_project_is_rejected() {
        let temp = valid_runtime();
        let external = tempdir().unwrap();
        let connection = create_path_tables(temp.path());
        let project_path = external
            .path()
            .join("live-project")
            .to_string_lossy()
            .into_owned();
        let disabled_path = external
            .path()
            .join("live-project-disabled")
            .to_string_lossy()
            .into_owned();
        connection
            .execute(
                "INSERT INTO projects (id, path, disabled_path) VALUES (?1, ?2, ?3)",
                params!["project", project_path, disabled_path],
            )
            .unwrap();
        drop(connection);

        assert!(resolve_runtime(temp.path().as_os_str()).is_err());
    }

    #[test]
    fn external_persisted_central_skill_is_rejected() {
        let temp = valid_runtime();
        let external = tempdir().unwrap();
        let connection = create_path_tables(temp.path());
        let central_path = external
            .path()
            .join("live-central-skill")
            .to_string_lossy()
            .into_owned();
        connection
            .execute(
                "INSERT INTO skills (id, central_path) VALUES (?1, ?2)",
                params!["skill", central_path],
            )
            .unwrap();
        drop(connection);

        assert!(resolve_runtime(temp.path().as_os_str()).is_err());
    }

    #[test]
    fn external_absolute_source_and_discovery_paths_are_rejected() {
        let temp = valid_runtime();
        let external = tempdir().unwrap();
        let connection = create_path_tables(temp.path());
        let central_path = temp
            .path()
            .join("central/skills/skill")
            .to_string_lossy()
            .into_owned();
        let source_ref = external
            .path()
            .join("live-source")
            .to_string_lossy()
            .into_owned();
        connection
            .execute(
                "INSERT INTO skills (id, central_path, source_ref) VALUES (?1, ?2, ?3)",
                params!["skill", central_path, source_ref],
            )
            .unwrap();
        drop(connection);
        assert!(resolve_runtime(temp.path().as_os_str()).is_err());

        let temp = valid_runtime();
        let external = tempdir().unwrap();
        let connection = create_path_tables(temp.path());
        let found_path = external
            .path()
            .join("live-discovered-skill")
            .to_string_lossy()
            .into_owned();
        connection
            .execute(
                "INSERT INTO discovered_skills (id, found_path) VALUES (?1, ?2)",
                params!["discovered", found_path],
            )
            .unwrap();
        drop(connection);
        assert!(resolve_runtime(temp.path().as_os_str()).is_err());
    }
}
