use anyhow::{bail, Context};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

use crate::core::{
    error::AppError, host_discovery, installer, scanner, skill_store::SkillStore, sync_metadata,
    tool_adapters,
};

fn canonicalize_lossy(path: &str) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path))
}

fn match_imported_skill_id(
    rec: &crate::core::skill_store::DiscoveredSkillRecord,
    managed_skills: &[crate::core::skill_store::SkillRecord],
) -> Option<String> {
    let found_path = canonicalize_lossy(&rec.found_path);
    if let Some(existing) = managed_skills.iter().find(|skill| {
        skill.source_ref.as_deref().map(canonicalize_lossy).as_ref() == Some(&found_path)
            || skill
                .source_ref_resolved
                .as_deref()
                .map(canonicalize_lossy)
                .as_ref()
                == Some(&found_path)
    }) {
        return Some(existing.id.clone());
    }

    if let Some(provenance) = rec.provenance.as_ref() {
        let source_ref = canonicalize_lossy(&provenance.source_ref);
        if let Some(existing) = managed_skills.iter().find(|skill| {
            let same_source = skill.source_ref.as_deref().map(canonicalize_lossy).as_ref()
                == Some(&source_ref)
                || skill
                    .source_ref_resolved
                    .as_deref()
                    .map(canonicalize_lossy)
                    .as_ref()
                    == Some(&source_ref);
            same_source
                && skill.source_subpath.as_deref()
                    == provenance
                        .source_subpath
                        .as_deref()
                        .filter(|value| *value != ".")
        }) {
            return Some(existing.id.clone());
        }
    }

    None
}

#[derive(Debug, Serialize)]
pub struct ScanResultDto {
    pub tools_scanned: usize,
    pub skills_found: usize,
    pub groups: Vec<scanner::DiscoveredGroup>,
    pub diagnostics: Vec<host_discovery::DiscoveryDiagnostic>,
}

#[derive(Debug)]
struct PreparedBulkImport {
    source_path: String,
    path: PathBuf,
    resolved_name: String,
}

/// Resolve and validate the complete Bulk Import batch before the first write.
///
/// Discovery identity is intentionally richer than the legacy managed-library
/// destination. If two candidates collapse to the same case/Unicode-folded
/// destination name, choosing one owner or inventing a suffix would silently
/// change identity. Fail the whole batch and let the user import explicitly.
fn prepare_bulk_imports(
    groups: Vec<scanner::DiscoveredGroup>,
) -> anyhow::Result<Vec<PreparedBulkImport>> {
    let mut prepared = Vec::new();
    let mut destinations: HashMap<String, String> = HashMap::new();

    for group in groups {
        if group.imported {
            continue;
        }
        let first = group
            .locations
            .first()
            .with_context(|| format!("Discovered group '{}' has no source location", group.name))?;
        let path = PathBuf::from(&first.found_path);
        // This first pass protects whole-batch all-or-nothing validation.
        // Installation intentionally repeats the source preflight immediately
        // before destination mutation because the source may change meanwhile.
        installer::preflight_copy_source(&path)
            .with_context(|| format!("Cannot import discovered Skill '{}'", group.name))?;
        let resolved_name = installer::resolve_local_skill_name(&path, Some(&group.name))?;
        // Managed destinations and sync/merge metadata must share one exact
        // case/Unicode identity contract or different devices can disagree.
        let destination_key = sync_metadata::path_key(&resolved_name);

        if let Some(existing_source) =
            destinations.insert(destination_key.clone(), first.found_path.clone())
        {
            bail!(
                "Bulk Import has multiple discovered owners for managed destination '{}': {} and {}. Import one explicitly.",
                resolved_name,
                existing_source,
                first.found_path
            );
        }

        prepared.push(PreparedBulkImport {
            source_path: first.found_path.clone(),
            path,
            resolved_name,
        });
    }

    Ok(prepared)
}

fn import_all_discovered_unlocked(store: &SkillStore) -> anyhow::Result<()> {
    let discovered = store.get_all_discovered()?;
    let groups = scanner::group_discovered(&discovered);
    let pending = prepare_bulk_imports(groups)?;
    let mut changed = false;

    for item in pending {
        let result = installer::install_from_local(&item.path, Some(&item.resolved_name))?;
        if store
            .get_skill_by_central_path(&result.central_path.to_string_lossy())?
            .is_some()
        {
            continue;
        }

        let now = chrono::Utc::now().timestamp_millis();
        let id = uuid::Uuid::new_v4().to_string();
        let record = crate::core::skill_store::SkillRecord {
            id,
            name: result.name,
            description: result.description,
            source_type: "import".to_string(),
            source_ref: Some(item.source_path),
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: result.central_path.to_string_lossy().to_string(),
            content_hash: Some(result.content_hash),
            enabled: true,
            created_at: now,
            updated_at: now,
            status: "ok".to_string(),
            update_status: "local_only".to_string(),
            last_checked_at: Some(now),
            last_check_error: None,
        };
        store.insert_skill(&record)?;
        changed = true;
    }

    if changed {
        sync_metadata::write_all_from_db_unlocked(store)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn scan_local_skills(
    store: State<'_, Arc<SkillStore>>,
) -> Result<ScanResultDto, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let all_targets = store.get_all_targets().map_err(AppError::db)?;
        let managed_paths: Vec<String> =
            all_targets.iter().map(|t| t.target_path.clone()).collect();
        let managed_skills = store.get_all_skills().map_err(AppError::db)?;

        let adapters = tool_adapters::all_tool_adapters(&store);
        let input =
            host_discovery::discovery_input_for_adapters(&adapters).map_err(AppError::io)?;
        let mut plan =
            scanner::scan_discovery_roots(&managed_paths, input).map_err(AppError::io)?;

        for rec in &mut plan.discovered {
            rec.imported_skill_id = match_imported_skill_id(rec, &managed_skills);
        }

        let groups = scanner::group_discovered(&plan.discovered);
        store
            .replace_discovered(&plan.discovered)
            .map_err(AppError::db)?;

        Ok(ScanResultDto {
            tools_scanned: plan.tools_scanned,
            skills_found: plan.skills_found,
            groups,
            diagnostics: plan.diagnostics,
        })
    })
    .await?
}

#[tauri::command]
pub async fn import_existing_skill(
    source_path: String,
    name: Option<String>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        sync_metadata::with_repo_lock("import existing skill", || {
            let path = PathBuf::from(&source_path);
            let resolved_name = installer::resolve_local_skill_name(&path, name.as_deref())?;

            let result = installer::install_from_local(&path, Some(&resolved_name))?;

            if store
                .get_skill_by_central_path(&result.central_path.to_string_lossy())?
                .is_some()
            {
                return Ok(());
            }

            let now = chrono::Utc::now().timestamp_millis();
            let id = uuid::Uuid::new_v4().to_string();

            let record = crate::core::skill_store::SkillRecord {
                id: id.clone(),
                name: result.name,
                description: result.description,
                source_type: "import".to_string(),
                source_ref: Some(source_path),
                source_ref_resolved: None,
                source_subpath: None,
                source_branch: None,
                source_revision: None,
                remote_revision: None,
                central_path: result.central_path.to_string_lossy().to_string(),
                content_hash: Some(result.content_hash),
                enabled: true,
                created_at: now,
                updated_at: now,
                status: "ok".to_string(),
                update_status: "local_only".to_string(),
                last_checked_at: Some(now),
                last_check_error: None,
            };

            store.insert_skill(&record)?;

            sync_metadata::write_all_from_db_unlocked(&store)
        })
        .map_err(AppError::io)?;

        Ok(())
    })
    .await?
}

#[tauri::command]
pub async fn import_all_discovered(store: State<'_, Arc<SkillStore>>) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        sync_metadata::with_repo_lock("import all discovered skills", || {
            import_all_discovered_unlocked(&store)
        })
        .map_err(AppError::io)?;

        Ok(())
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::{import_all_discovered_unlocked, match_imported_skill_id};
    use crate::core::{
        central_repo,
        host_discovery::{DiscoveryProvenance, DiscoverySourceKind},
        skill_store::{DiscoveredSkillRecord, SkillRecord, SkillStore},
    };
    use std::path::{Path, PathBuf};
    use tempfile::{tempdir, TempDir};

    struct BaseDirReset;

    impl Drop for BaseDirReset {
        fn drop(&mut self) {
            central_repo::set_test_base_dir_override(None);
        }
    }

    struct BulkImportTestEnv {
        _reset: BaseDirReset,
        store: SkillStore,
        base: PathBuf,
        tmp: TempDir,
        _lock: std::sync::MutexGuard<'static, ()>,
    }

    impl BulkImportTestEnv {
        fn new() -> Self {
            let lock = central_repo::test_base_dir_lock();
            let tmp = tempdir().unwrap();
            let base = tmp.path().join("center");
            std::fs::create_dir_all(&base).unwrap();
            central_repo::set_test_base_dir_override(Some(base.clone()));
            let store = SkillStore::new(&base.join("test.db")).unwrap();
            Self {
                _reset: BaseDirReset,
                store,
                base,
                tmp,
                _lock: lock,
            }
        }

        fn source(&self, name: &str) -> PathBuf {
            self.tmp.path().join(name)
        }
    }

    fn managed_skill(
        id: &str,
        name: &str,
        source_ref: Option<&str>,
        source_ref_resolved: Option<&str>,
        content_hash: Option<&str>,
    ) -> SkillRecord {
        SkillRecord {
            id: id.to_string(),
            name: name.to_string(),
            description: None,
            source_type: "import".to_string(),
            source_ref: source_ref.map(str::to_string),
            source_ref_resolved: source_ref_resolved.map(str::to_string),
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: format!("/central/{name}"),
            content_hash: content_hash.map(str::to_string),
            enabled: true,
            created_at: 0,
            updated_at: 0,
            status: "ok".to_string(),
            update_status: "local_only".to_string(),
            last_checked_at: None,
            last_check_error: None,
        }
    }

    fn discovered(path: &str, name: &str, fingerprint: Option<&str>) -> DiscoveredSkillRecord {
        DiscoveredSkillRecord {
            id: "discovered-1".to_string(),
            tool: "cursor".to_string(),
            found_path: path.to_string(),
            name_guess: Some(name.to_string()),
            fingerprint: fingerprint.map(str::to_string),
            content_error: None,
            found_at: 0,
            imported_skill_id: None,
            provenance: None,
        }
    }

    fn discovered_with_id(
        id: &str,
        path: &Path,
        name: &str,
        fingerprint: &str,
    ) -> DiscoveredSkillRecord {
        DiscoveredSkillRecord {
            id: id.to_string(),
            tool: "codex".to_string(),
            found_path: path.to_string_lossy().to_string(),
            name_guess: Some(name.to_string()),
            fingerprint: Some(fingerprint.to_string()),
            content_error: None,
            found_at: 0,
            imported_skill_id: None,
            provenance: None,
        }
    }

    fn write_skill(path: &Path, name: &str, body: &str) {
        std::fs::create_dir_all(path).unwrap();
        std::fs::write(
            path.join("SKILL.md"),
            format!("---\nname: {name}\n---\n{body}"),
        )
        .unwrap();
    }

    fn assert_no_managed_imports(store: &SkillStore) {
        assert!(store.get_all_skills().unwrap().is_empty());
        let skills_dir = central_repo::skills_dir();
        if skills_dir.exists() {
            assert!(std::fs::read_dir(skills_dir).unwrap().next().is_none());
        }
    }

    #[test]
    fn does_not_mark_same_name_as_imported_without_path_or_hash_match() {
        let rec = discovered("/tmp/local/foo", "same-name", None);
        let managed = vec![managed_skill(
            "skill-1",
            "same-name",
            Some("/tmp/other/foo"),
            None,
            None,
        )];

        assert_eq!(match_imported_skill_id(&rec, &managed), None);
    }

    #[test]
    fn does_not_mark_same_fingerprint_as_imported_without_lineage() {
        let rec = discovered("/tmp/local/foo", "same-name", Some("abc123"));
        let managed = vec![managed_skill(
            "skill-1",
            "different-name",
            Some("/tmp/other/foo"),
            None,
            Some("abc123"),
        )];

        assert_eq!(match_imported_skill_id(&rec, &managed), None);
    }

    #[test]
    fn marks_same_source_path_as_imported() {
        let rec = discovered("/tmp/local/foo", "same-name", None);
        let managed = vec![managed_skill(
            "skill-1",
            "different-name",
            Some("/tmp/local/foo"),
            None,
            None,
        )];

        assert_eq!(
            match_imported_skill_id(&rec, &managed),
            Some("skill-1".to_string())
        );
    }

    #[test]
    fn marks_same_known_source_lineage_as_imported() {
        let mut rec = discovered("/tmp/projected/foo", "foo", Some("new-digest"));
        rec.provenance = Some(DiscoveryProvenance {
            source_kind: DiscoverySourceKind::CodexPlugin,
            owner_ref: "plugin@market".to_string(),
            source_ref: "/tmp/plugin-revision".to_string(),
            source_version: Some("1.0.0".to_string()),
            source_revision: Some("rev-1".to_string()),
            source_subpath: Some("skills/foo".to_string()),
            declared_repository: None,
            provenance_basis: "test".to_string(),
            digest_algorithm: "scm-dir-v2".to_string(),
        });
        let mut managed = managed_skill(
            "skill-1",
            "foo",
            Some("/tmp/plugin-revision"),
            None,
            Some("old-digest"),
        );
        managed.source_subpath = Some("skills/foo".to_string());
        assert_eq!(
            match_imported_skill_id(&rec, &[managed]),
            Some("skill-1".to_string())
        );
    }

    #[cfg(unix)]
    #[test]
    fn bulk_import_symlink_preflight_happens_before_any_write() {
        let env = BulkImportTestEnv::new();

        let valid = env.source("valid");
        write_skill(&valid, "valid", "valid");
        env.store
            .insert_discovered(&discovered_with_id("valid", &valid, "valid", "fp-valid"))
            .unwrap();

        let marker_target = env.source("linked-marker.md");
        std::fs::write(&marker_target, "---\nname: linked\n---\n").unwrap();
        let linked = env.source("linked");
        std::fs::create_dir(&linked).unwrap();
        std::os::unix::fs::symlink(&marker_target, linked.join("SKILL.md")).unwrap();
        env.store
            .insert_discovered(&discovered_with_id(
                "linked",
                &linked,
                "linked",
                "fp-linked",
            ))
            .unwrap();

        let error = import_all_discovered_unlocked(&env.store).unwrap_err();
        let message = format!("{error:#}");
        assert!(
            message.contains("cannot preserve"),
            "unexpected error: {message}"
        );
        assert_no_managed_imports(&env.store);
    }

    #[test]
    fn bulk_import_destination_collision_happens_before_any_write() {
        let env = BulkImportTestEnv::new();

        let first = env.source("first");
        let second = env.source("second");
        write_skill(&first, "duplicate", "first");
        write_skill(&second, "duplicate", "second");
        env.store
            .insert_discovered(&discovered_with_id("first", &first, "duplicate", "fp-1"))
            .unwrap();
        env.store
            .insert_discovered(&discovered_with_id("second", &second, "duplicate", "fp-2"))
            .unwrap();

        let error = import_all_discovered_unlocked(&env.store).unwrap_err();
        assert!(
            error.to_string().contains("multiple discovered owners"),
            "unexpected error: {error}"
        );
        assert_no_managed_imports(&env.store);
    }

    #[test]
    fn bulk_import_case_and_unicode_folded_collision_happens_before_any_write() {
        let env = BulkImportTestEnv::new();

        let first = env.source("first");
        let second = env.source("second");
        write_skill(&first, "Café", "first");
        write_skill(&second, "CAFE\u{301}", "second");
        env.store
            .insert_discovered(&discovered_with_id("first", &first, "Café", "fp-1"))
            .unwrap();
        env.store
            .insert_discovered(&discovered_with_id(
                "second",
                &second,
                "CAFE\u{301}",
                "fp-2",
            ))
            .unwrap();

        let error = import_all_discovered_unlocked(&env.store).unwrap_err();
        assert!(
            error.to_string().contains("multiple discovered owners"),
            "unexpected error: {error}"
        );
        assert_no_managed_imports(&env.store);
    }

    #[test]
    fn bulk_import_valid_batch_writes_complete_library_and_metadata() {
        let env = BulkImportTestEnv::new();
        let alpha = env.source("alpha-source");
        let beta = env.source("beta-source");
        write_skill(&alpha, "alpha", "alpha body");
        write_skill(&beta, "beta", "beta body");
        env.store
            .insert_discovered(&discovered_with_id("alpha", &alpha, "alpha", "fp-alpha"))
            .unwrap();
        env.store
            .insert_discovered(&discovered_with_id("beta", &beta, "beta", "fp-beta"))
            .unwrap();

        import_all_discovered_unlocked(&env.store).unwrap();

        let mut imported = env.store.get_all_skills().unwrap();
        imported.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(
            imported
                .iter()
                .map(|skill| skill.name.as_str())
                .collect::<Vec<_>>(),
            vec!["alpha", "beta"]
        );
        assert_eq!(imported[0].source_ref.as_deref(), alpha.to_str());
        assert_eq!(imported[1].source_ref.as_deref(), beta.to_str());
        for skill in &imported {
            let central_path = Path::new(&skill.central_path);
            assert!(central_path.join("SKILL.md").is_file());
            assert!(skill
                .content_hash
                .as_deref()
                .is_some_and(|hash| !hash.is_empty()));
        }

        let metadata = env.base.join("skills/.skills-manager");
        assert!(metadata.join("schema.json").is_file());
        let skill_metadata_count = std::fs::read_dir(metadata.join("skills")).unwrap().count();
        assert_eq!(skill_metadata_count, 2);
    }

    #[test]
    fn bulk_import_empty_or_already_imported_batch_is_a_noop() {
        let env = BulkImportTestEnv::new();
        import_all_discovered_unlocked(&env.store).unwrap();
        assert_no_managed_imports(&env.store);

        let source = env.source("already-imported");
        write_skill(&source, "already-imported", "body");
        let existing = managed_skill(
            "managed-id",
            "already-imported",
            source.to_str(),
            None,
            Some("fp-imported"),
        );
        env.store.insert_skill(&existing).unwrap();
        let mut record = discovered_with_id(
            "already-imported",
            &source,
            "already-imported",
            "fp-imported",
        );
        record.imported_skill_id = Some("managed-id".to_string());
        env.store.insert_discovered(&record).unwrap();

        import_all_discovered_unlocked(&env.store).unwrap();
        let skills = env.store.get_all_skills().unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "managed-id");
        assert!(!env.base.join("skills/.skills-manager").exists());
    }
}
