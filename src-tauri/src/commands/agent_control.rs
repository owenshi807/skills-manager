//! Dashboard authorization installs the build's own Skill, never remote prose.
use super::skills::{install_directory_unlocked, InstallSourceMetadata};
use crate::core::{
    cli_bridge, error::AppError, repo_lock::RepoLock, skill_store::SkillStore, tool_service,
};
use std::sync::Arc;
use tauri::State;

pub fn bundled_document() -> String {
    include_str!("../../../skills/manage-skills/SKILL.md")
        .replace("{{CONTRACT_VERSION}}", cli_bridge::CONTRACT_VERSION)
}

pub fn install_bundled(store: &SkillStore, agents: &[String]) -> Result<String, AppError> {
    if agents.is_empty() {
        return Err(AppError::invalid_input("Select at least one Agent"));
    }
    let available = tool_service::list_tool_info(store);
    for agent in agents {
        if !available
            .iter()
            .any(|item| item.key == *agent && item.installed && item.enabled)
        {
            return Err(AppError::invalid_input(format!(
                "Agent unavailable: {agent}"
            )));
        }
    }
    let document = bundled_document();
    let id = {
        let _lock = RepoLock::acquire_foreground("install bundled management skill")
            .map_err(AppError::db)?;
        let existing = store
            .get_all_skills()
            .map_err(AppError::db)?
            .into_iter()
            .find(|skill| skill.name == "manage-skills");
        if let Some(skill) = existing {
            if skill.source_type != "builtin" {
                return Err(AppError::invalid_input("Existing manage-skills is not the bundled Skill. Preserve it and remove it from the library before authorizing this version."));
            }
            let current = std::path::Path::new(&skill.central_path);
            if std::fs::read_to_string(current.join("SKILL.md"))
                .ok()
                .as_deref()
                != Some(document.as_str())
            {
                crate::core::foundation_write::ensure_unchanged(store, &skill)?;
                let parent = current
                    .parent()
                    .ok_or_else(|| AppError::invalid_input("Invalid built-in Skill path"))?;
                let staging = tempfile::tempdir_in(parent).map_err(AppError::io)?;
                let candidate = staging.path().join("manage-skills");
                std::fs::create_dir(&candidate).map_err(AppError::io)?;
                std::fs::write(candidate.join("SKILL.md"), &document).map_err(AppError::io)?;
                let hash =
                    crate::core::content_hash::hash_directory(&candidate).map_err(AppError::io)?;
                super::skills::swap_skill_directory(&candidate, current)?;
                store
                    .update_skill_after_install(
                        &skill.id,
                        &skill.name,
                        skill.description.as_deref(),
                        Some(cli_bridge::CONTRACT_VERSION),
                        None,
                        Some(&hash),
                        "up_to_date",
                    )
                    .map_err(AppError::db)?;
                super::skills::resync_copy_targets(store, &skill.id)?;
                crate::core::sync_metadata::write_all_from_db_unlocked(store)
                    .map_err(AppError::db)?;
            }
            skill.id
        } else {
            let staged = tempfile::tempdir().map_err(AppError::io)?;
            std::fs::write(staged.path().join("SKILL.md"), document).map_err(AppError::io)?;
            let metadata = InstallSourceMetadata {
                source_type: "builtin".into(),
                source_ref: Some("builtin:manage-skills".into()),
                source_ref_resolved: None,
                source_subpath: None,
                source_branch: None,
                source_revision: Some(cli_bridge::CONTRACT_VERSION.into()),
                remote_revision: None,
                update_status: "up_to_date".into(),
            };
            install_directory_unlocked(
                store,
                staged.path(),
                Some("manage-skills"),
                None,
                &metadata,
            )?
            .0
        }
    };
    crate::core::foundation_write::deploy(store, &[id.clone()], agents, true)?;
    Ok(id)
}

#[tauri::command]
pub async fn authorize_agent_control(
    agents: Vec<String>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<String, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        cli_bridge::ensure_bridge_inner(cli_bridge::CONTRACT_VERSION).map_err(AppError::io)?;
        install_bundled(&store, &agents)
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::skills;
    use crate::core::{central_repo, foundation_write, sync_metadata};
    use std::fs;

    #[test]
    fn foundation_authorize_install_update_deploy_status_and_external_edits() {
        let _lock = central_repo::test_base_dir_lock();
        let tmp = tempfile::tempdir().unwrap();
        central_repo::set_test_base_dir_override(Some(tmp.path().join("central")));
        struct Reset;
        impl Drop for Reset {
            fn drop(&mut self) {
                central_repo::set_test_base_dir_override(None);
            }
        }
        let _reset = Reset;
        fs::create_dir_all(central_repo::skills_dir()).unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        let agent_root = tmp.path().join("agent");
        fs::create_dir_all(&agent_root).unwrap();
        store
            .set_setting(
                "custom_tools",
                &serde_json::json!([{
                    "key":"integration_agent", "display_name":"Integration Agent",
                    "skills_dir":agent_root, "project_relative_skills_dir":null
                }])
                .to_string(),
            )
            .unwrap();
        store.set_setting("sync_mode", "copy").unwrap();
        let agents = vec!["integration_agent".to_string()];
        let control = install_bundled(&store, &agents).unwrap();
        let control_skill = store.get_skill_by_id(&control).unwrap().unwrap();
        assert_eq!(control_skill.source_type, "builtin");
        assert_eq!(
            fs::read_to_string(agent_root.join("manage-skills/SKILL.md")).unwrap(),
            bundled_document()
        );
        assert!(store.get_all_scenarios().unwrap().is_empty());
        assert_eq!(install_bundled(&store, &agents).unwrap(), control);
        // Simulate an untouched builtin from an earlier App/CLI contract.
        let control_path = std::path::Path::new(&control_skill.central_path);
        fs::write(
            control_path.join("SKILL.md"),
            "---\nname: manage-skills\n---\nprevious build\n",
        )
        .unwrap();
        let old_hash = crate::core::content_hash::hash_directory(control_path).unwrap();
        store
            .update_skill_after_install(
                &control,
                "manage-skills",
                None,
                Some("previous-contract"),
                None,
                Some(&old_hash),
                "up_to_date",
            )
            .unwrap();
        super::super::skills::resync_copy_targets(&store, &control).unwrap();
        assert_eq!(install_bundled(&store, &agents).unwrap(), control);
        assert_eq!(
            fs::read_to_string(control_path.join("SKILL.md")).unwrap(),
            bundled_document()
        );

        let source = tmp.path().join("source");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("SKILL.md"), "---\nname: lifecycle\n---\nv1\n").unwrap();
        let metadata = InstallSourceMetadata {
            source_type: "local".into(),
            source_ref: Some(source.to_string_lossy().into()),
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            update_status: "local_only".into(),
        };
        let (id, _, library) = {
            let _repo = RepoLock::acquire_foreground("integration install").unwrap();
            install_directory_unlocked(&store, &source, None, None, &metadata).unwrap()
        };
        assert!(store.get_targets_for_skill(&id).unwrap().is_empty());
        fs::write(source.join("SKILL.md"), "---\nname: lifecycle\n---\nv2\n").unwrap();
        skills::reimport_local_skill_internal(&store, &id, None).unwrap();
        foundation_write::deploy(&store, &[id.clone()], &agents, true).unwrap();
        let skill = store.get_skill_by_id(&id).unwrap().unwrap();
        let target = store.get_targets_for_skill(&id).unwrap().remove(0);
        assert!(foundation_write::target_current(&skill, &target));
        assert!(fs::read_to_string(agent_root.join("lifecycle/SKILL.md"))
            .unwrap()
            .contains("v2"));

        fs::write(agent_root.join("lifecycle/SKILL.md"), "external Agent work").unwrap();
        assert!(!foundation_write::target_current(&skill, &target));
        assert!(foundation_write::deploy(&store, &[id.clone()], &agents, true).is_err());
        assert!(foundation_write::deploy(&store, &[id.clone()], &agents, false).is_err());
        assert_eq!(
            fs::read_to_string(agent_root.join("lifecycle/SKILL.md")).unwrap(),
            "external Agent work"
        );
        fs::write(
            agent_root.join("lifecycle/SKILL.md"),
            fs::read(std::path::Path::new(&library).join("SKILL.md")).unwrap(),
        )
        .unwrap();

        fs::write(
            std::path::Path::new(&library).join("SKILL.md"),
            "---\nname: lifecycle\n---\nexternal library work\n",
        )
        .unwrap();
        sync_metadata::reindex_from_metadata(&store).unwrap();
        fs::write(source.join("SKILL.md"), "---\nname: lifecycle\n---\nv3\n").unwrap();
        assert!(skills::reimport_local_skill_internal(&store, &id, None).is_err());
        assert!(
            fs::read_to_string(std::path::Path::new(&library).join("SKILL.md"))
                .unwrap()
                .contains("external library work")
        );

        // A fresh deployment must never take ownership of an unrelated folder.
        let collision_source = tmp.path().join("collision-source");
        fs::create_dir_all(&collision_source).unwrap();
        fs::write(
            collision_source.join("SKILL.md"),
            "---\nname: collision\n---\n",
        )
        .unwrap();
        let collision = {
            let _repo = RepoLock::acquire_foreground("integration conflict install").unwrap();
            install_directory_unlocked(&store, &collision_source, None, None, &metadata)
                .unwrap()
                .0
        };
        fs::create_dir_all(agent_root.join("collision")).unwrap();
        fs::write(
            agent_root.join("collision/private.txt"),
            "not Manager owned",
        )
        .unwrap();
        assert!(foundation_write::deploy(&store, &[collision.clone()], &agents, true).is_err());
        assert!(store.get_targets_for_skill(&collision).unwrap().is_empty());
        assert_eq!(
            fs::read_to_string(agent_root.join("collision/private.txt")).unwrap(),
            "not Manager owned"
        );
    }
}

#[tauri::command]
pub fn agent_control_version() -> &'static str {
    cli_bridge::CONTRACT_VERSION
}
