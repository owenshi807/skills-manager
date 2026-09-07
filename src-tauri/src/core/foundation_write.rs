//! Shared content-write boundary for desktop and CLI. Index refreshes observe
//! bytes but never grant permission to replace externally changed content.
use super::{
    content_hash,
    error::AppError,
    skill_store::{SkillRecord, SkillStore},
};
use std::path::Path;

fn key(id: &str) -> String {
    format!("foundation_committed_digest:{id}")
}

pub fn remember(store: &SkillStore, skill: &SkillRecord) -> anyhow::Result<()> {
    let path = Path::new(&skill.central_path);
    if path.is_dir() {
        let digest = content_hash::hash_directory_strict_v2(path)?;
        store.set_setting(&key(&skill.id), &digest)?;
        store.set_setting(
            &format!("foundation_committed_entries:{}", skill.id),
            &serde_json::to_string(&content_hash::ownership_snapshot(path)?)?,
        )?;
    }
    Ok(())
}

pub fn ensure_unchanged(store: &SkillStore, skill: &SkillRecord) -> Result<(), AppError> {
    ensure_targets_unchanged(store, &[skill.id.clone()])?;
    ensure_central_unchanged(store, skill)
}

fn ensure_central_unchanged(store: &SkillStore, skill: &SkillRecord) -> Result<(), AppError> {
    let path = Path::new(&skill.central_path);
    if let Some(saved) = store
        .get_setting(&format!("foundation_committed_entries:{}", skill.id))
        .map_err(AppError::db)?
    {
        let expected: std::collections::BTreeMap<String, String> =
            serde_json::from_str(&saved).map_err(AppError::db)?;
        if expected != content_hash::ownership_snapshot(path).map_err(AppError::io)? {
            return Err(AppError::invalid_input("Library content changed outside Manager; preserve and review external edits before retrying"));
        }
    }
    let observed = content_hash::hash_directory_strict_v2(path).map_err(AppError::io)?;
    let expected = store.get_setting(&key(&skill.id)).map_err(AppError::db)?;
    let changed = match expected {
        Some(expected) => expected != observed,
        None => skill.content_hash.as_deref().is_some_and(|expected| {
            content_hash::hash_directory(path).ok().as_deref() != Some(expected)
        }),
    };
    if changed {
        return Err(AppError::invalid_input(
            "Library content changed outside Manager. Review the directory comparison and preserve external edits before retrying; no content was overwritten.",
        ));
    }
    Ok(())
}

pub fn target_current(skill: &SkillRecord, target: &super::skill_store::SkillTargetRecord) -> bool {
    let path = Path::new(&target.target_path);
    let source = Path::new(&skill.central_path);
    if target.status != "ok" {
        return false;
    }
    match target.mode.as_str() {
        "symlink" => matches!(
            super::sync_engine::classify_target(path, Some(source)),
            Ok(super::sync_engine::TargetState::LinkToSource)
        ),
        "copy" => {
            if !std::fs::symlink_metadata(path)
                .is_ok_and(|meta| meta.is_dir() && !meta.file_type().is_symlink())
            {
                return false;
            }
            let expected = content_hash::hash_expected_copy_projection_v1(source);
            let observed = content_hash::hash_observed_copy_projection_v1(path);
            matches!((expected, observed), (Ok(a), Ok(b)) if a == b)
        }
        _ => false,
    }
}

pub fn ensure_targets_unchanged(store: &SkillStore, ids: &[String]) -> Result<(), AppError> {
    ensure_targets_with_removals(store, ids, &[])
}

fn ensure_targets_with_removals(
    store: &SkillStore,
    ids: &[String],
    removals: &[(String, String)],
) -> Result<(), AppError> {
    for row in store.get_all_targets().map_err(AppError::db)? {
        if !ids.contains(&row.skill_id) || row.mode != "copy" {
            continue;
        }
        let path = Path::new(&row.target_path);
        if !path.exists() {
            continue;
        }
        let saved = store
            .get_setting(&format!("foundation_target_entries:{}", row.target_path))
            .map_err(AppError::db)?;
        if let Some(saved) = saved {
            let mut expected: std::collections::BTreeMap<String, String> =
                serde_json::from_str(&saved).map_err(AppError::db)?;
            let mut observed = content_hash::ownership_snapshot(path).map_err(AppError::io)?;
            let approved = |path: &str| {
                removals.iter().any(|(location, removed)| {
                    location == &row.tool && Path::new(path).starts_with(removed)
                })
            };
            expected.retain(|path, _| !approved(path));
            observed.retain(|path, _| !approved(path));
            if expected == observed {
                continue;
            }
            return Err(AppError::target_conflict(
                "Agent copy changed outside Manager",
                vec![super::error::TargetConflictDetail {
                    path: row.target_path,
                    reason: "Unapproved external edits remain in this Agent copy".into(),
                }],
            ));
        }
        let expected = store
            .get_setting(&format!("foundation_target_digest:{}", row.target_path))
            .map_err(AppError::db)?;
        let current = content_hash::hash_directory_strict_v2(path).map_err(AppError::io)?;
        let changed = match expected {
            Some(expected) => expected != current,
            None => row.source_hash.as_deref().is_none_or(|expected| {
                content_hash::hash_directory(path).ok().as_deref() != Some(expected)
            }),
        };
        if changed {
            return Err(AppError::target_conflict(
                "Agent copy changed outside Manager",
                vec![super::error::TargetConflictDetail {
                    path: row.target_path,
                    reason:
                        "Externally modified copy; preserve and review its contents before retrying"
                            .into(),
                }],
            ));
        }
    }
    Ok(())
}

pub fn deploy(
    store: &SkillStore,
    ids: &[String],
    agents: &[String],
    add: bool,
) -> Result<(), AppError> {
    let _lock = super::repo_lock::RepoLock::acquire_foreground("Foundation Agent deployment")
        .map_err(AppError::db)?;
    super::scenario_service::apply_skills_to_tools(
        store,
        ids,
        agents,
        if add {
            super::scenario_service::BatchApplyMode::Add
        } else {
            super::scenario_service::BatchApplyMode::Remove
        },
    )
}

/// Seed old libraries before reindex can replace their observed content hash.
pub fn preserve_committed_evidence(store: &SkillStore) -> anyhow::Result<()> {
    for skill in store.get_all_skills()? {
        if store.get_setting(&key(&skill.id))?.is_some() {
            continue;
        }
        let path = Path::new(&skill.central_path);
        if !path.is_dir() {
            continue;
        }
        if skill.content_hash.as_deref().is_some_and(|expected| {
            content_hash::hash_directory(path).ok().as_deref() != Some(expected)
        }) {
            store.set_setting(&key(&skill.id), "unreviewed-external-change")?;
        } else {
            remember(store, &skill)?;
        }
    }
    Ok(())
}

/// A deletion approval grants only the listed paths, never edits to survivors.
pub fn ensure_replacement_approved(
    store: &SkillStore,
    skill: &SkillRecord,
    removals: &[(String, String)],
) -> Result<(), AppError> {
    ensure_targets_with_removals(store, &[skill.id.clone()], removals)?;
    if removals.is_empty() {
        return ensure_central_unchanged(store, skill);
    }
    let Some(saved) = store
        .get_setting(&format!("foundation_committed_entries:{}", skill.id))
        .map_err(AppError::db)?
    else {
        return ensure_central_unchanged(store, skill);
    };
    let mut expected: std::collections::BTreeMap<String, String> =
        serde_json::from_str(&saved).map_err(AppError::db)?;
    let mut observed =
        content_hash::ownership_snapshot(Path::new(&skill.central_path)).map_err(AppError::io)?;
    let approved = |path: &str| {
        removals.iter().any(|(location, removed)| {
            location == "library" && Path::new(path).starts_with(removed)
        })
    };
    expected.retain(|path, _| !approved(path));
    observed.retain(|path, _| !approved(path));
    if expected != observed {
        return Err(AppError::invalid_input(
            "Unapproved external edits remain outside the removal list; no content was overwritten",
        ));
    }
    Ok(())
}
