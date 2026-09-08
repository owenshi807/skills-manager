//! Manager-owned Skill editing and publishing.
//!
//! This module deliberately has no second database or content authority.  The
//! library remains the existing `SkillStore` + central repository; transient
//! Agent work is copied into an app-owned workspace and is committed through
//! the Foundation write boundary.
use super::{
    central_repo, content_hash, foundation_write, installer,
    repo_lock::RepoLock,
    skill_metadata,
    skill_store::{SkillRecord, SkillStore, SkillTargetRecord},
    sync_engine, sync_metadata,
};
use crate::commands::skills::{self, InstallSourceMetadata};
use crate::core::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

const STAGE_PREFIX: &str = "skill_publish:stage:";
const HISTORY_PREFIX: &str = "skill_publish:history:";
const CANONICAL_PREFIX: &str = "skill_publish:canonical:";
const MAX_DOCUMENT_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Deserialize)]
pub struct BeginEditRequest {
    pub skill_id: Option<String>,
    pub new_name: Option<String>,
    #[serde(default)]
    pub actor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishStage {
    pub stage_id: String,
    pub skill_id: Option<String>,
    pub name: String,
    pub workspace_path: String,
    pub base_digest: Option<String>,
    pub actor: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PublishRequest {
    pub stage_id: String,
    /// The exact strict digest shown by preview.  This prevents a caller from
    /// approving one set of staged bytes and publishing another.
    #[serde(alias = "expected_stage_digest")]
    pub candidate_digest: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublishPreview {
    pub stage: PublishStage,
    pub stage_digest: String,
    pub base_current: bool,
    pub changed: bool,
    pub target_conflicts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishHistoryEntry {
    pub id: String,
    /// Stored with new entries; older per-Skill history rows are completed
    /// from their settings key when read.
    #[serde(default)]
    pub skill_id: String,
    pub stage_id: String,
    pub action: String,
    pub actor: Option<String>,
    pub before_digest: Option<String>,
    pub after_digest: String,
    pub rollback_path: Option<String>,
    pub created_at: i64,
    #[serde(default = "published_outcome")]
    pub outcome: String,
    #[serde(default)]
    pub error: Option<String>,
}

fn published_outcome() -> String {
    "published".into()
}

#[derive(Debug, Clone, Serialize)]
pub struct PublishResult {
    pub skill_id: String,
    pub content_digest: String,
    pub history: PublishHistoryEntry,
    pub deployments: Vec<DeploymentView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeploymentView {
    pub tool: String,
    pub target_path: String,
    pub mode: String,
    pub recorded_status: String,
    pub actual_status: String,
    pub synced_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LibrarySkillView {
    pub skill: SkillRecord,
    /// The original frontmatter identity used for same-name grouping. Storage
    /// directory collision suffixes (for example `name-2`) are not identity.
    pub canonical_name: String,
    pub deployments: Vec<DeploymentView>,
    pub canonical: Option<CanonicalSelection>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CanonicalGroup {
    pub normalized_name: String,
    pub members: Vec<LibrarySkillView>,
    pub selected_skill_id: Option<String>,
    /// `confirmed`, `stale`, `missing`, or `unselected`. A stale choice stays
    /// recorded for audit, but is not presented as a current confirmation.
    pub canonical_status: String,
    pub selection_reason: Option<String>,
    /// A same-name group is never treated as equivalent merely because it has
    /// the same display name.  These members require an explicit decision.
    pub unresolved_alternatives: Vec<String>,
    pub divergent: bool,
    /// The explicit choice still points to this Skill, but its bytes changed
    /// since that choice was made. Surface this for a fresh human decision;
    /// never silently promote another same-name variant.
    pub selected_content_changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalSelection {
    pub normalized_name: String,
    pub skill_id: String,
    pub reason: String,
    pub selected_digest: Option<String>,
    pub selected_at: i64,
    #[serde(default)]
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CanonicalSelectionRequest {
    pub skill_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkillDocument {
    pub skill_id: String,
    pub relative_path: String,
    pub content: String,
    pub truncated: bool,
    pub total_bytes: usize,
    pub content_digest: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StageFileWriteRequest {
    pub stage_id: String,
    pub relative_path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StageFileWriteResult {
    pub stage: PublishStage,
    pub candidate_digest: String,
}

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
fn stage_key(id: &str) -> String {
    format!("{STAGE_PREFIX}{id}")
}
fn history_key(id: &str) -> String {
    format!("{HISTORY_PREFIX}{id}")
}
fn canonical_key(name: &str) -> String {
    format!("{CANONICAL_PREFIX}{name}")
}
fn stage_root() -> PathBuf {
    central_repo::base_dir().join(".publish-staging")
}
fn rollback_root() -> PathBuf {
    central_repo::base_dir().join(".publish-rollback")
}

fn normalized_name(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Group duplicate candidates by their declared Skill identity. The database
/// name may include a collision suffix allocated for a separate library
/// directory; stripping that suffix would conflate a legitimately named
/// `foo-2` with `foo`, so fall back to it only when frontmatter is absent.
fn canonical_identity(skill: &SkillRecord) -> String {
    let declared = skill_metadata::parse_skill_md(Path::new(&skill.central_path))
        .name
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| skill.name.clone());
    normalized_name(&declared)
}

fn selection_status(choice: &CanonicalSelection, selected: Option<&SkillRecord>) -> String {
    match selected {
        None => "missing".into(),
        Some(skill)
            if content_hash::hash_directory_strict_v2(Path::new(&skill.central_path))
                .ok()
                .as_deref()
                != choice.selected_digest.as_deref() =>
        {
            "stale".into()
        }
        Some(_) => "confirmed".into(),
    }
}

fn load_stage(store: &SkillStore, id: &str) -> Result<PublishStage, AppError> {
    let raw = store
        .get_setting(&stage_key(id))
        .map_err(AppError::db)?
        .ok_or_else(|| AppError::not_found("Publish workspace not found"))?;
    serde_json::from_str(&raw).map_err(AppError::db)
}
fn save_stage(store: &SkillStore, stage: &PublishStage) -> Result<(), AppError> {
    store
        .set_setting(
            &stage_key(&stage.stage_id),
            &serde_json::to_string(stage).map_err(AppError::db)?,
        )
        .map_err(AppError::db)
}
fn stage_failure(store: &SkillStore, mut stage: PublishStage, error: &AppError) {
    stage.status = "conflicted".into();
    stage.last_error = Some(error.message.clone());
    stage.updated_at = now();
    let _ = save_stage(store, &stage);
}

/// Resolves only a recorded Manager workspace.  The user/Agent never supplies
/// a filesystem path to preview or publish, and every path component is
/// rechecked so a replacement symlink cannot escape the staging root.
fn checked_workspace(stage: &PublishStage) -> Result<PathBuf, AppError> {
    let root = stage_root();
    let root_canon = std::fs::canonicalize(&root).map_err(AppError::io)?;
    let workspace = PathBuf::from(&stage.workspace_path);
    let workspace_canon = std::fs::canonicalize(&workspace).map_err(AppError::io)?;
    if !workspace_canon.starts_with(&root_canon) || workspace_canon == root_canon {
        return Err(AppError::invalid_input(
            "Publish workspace escaped the Manager staging directory",
        ));
    }
    if workspace_canon.file_name().and_then(|n| n.to_str()) != Some(stage.stage_id.as_str()) {
        return Err(AppError::invalid_input(
            "Publish workspace identity does not match its stage record",
        ));
    }
    installer::preflight_copy_source(&workspace_canon).map_err(AppError::io)?;
    if !skill_metadata::is_valid_skill_dir(&workspace_canon) {
        return Err(AppError::invalid_input(
            "Publish workspace must contain SKILL.md",
        ));
    }
    Ok(workspace_canon)
}

fn checked_relative_path(relative_path: &str) -> Result<&Path, AppError> {
    let path = Path::new(relative_path);
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AppError::invalid_input(
            "Path must be a relative file within the Manager workspace",
        ));
    }
    Ok(path)
}

fn target_views(skill: &SkillRecord, targets: &[SkillTargetRecord]) -> Vec<DeploymentView> {
    targets
        .iter()
        .filter(|target| target.skill_id == skill.id)
        .map(|target| DeploymentView {
            tool: target.tool.clone(),
            target_path: target.target_path.clone(),
            mode: target.mode.clone(),
            recorded_status: target.status.clone(),
            actual_status: if foundation_write::target_current(skill, target) {
                "current".into()
            } else {
                "needs_sync".into()
            },
            synced_at: target.synced_at,
        })
        .collect()
}

pub fn list_library(
    store: &SkillStore,
) -> Result<(Vec<LibrarySkillView>, Vec<CanonicalGroup>), AppError> {
    let skills = store.get_all_skills().map_err(AppError::db)?;
    let targets = store.get_all_targets().map_err(AppError::db)?;
    let mut views = Vec::with_capacity(skills.len());
    for skill in skills {
        let canonical_name = canonical_identity(&skill);
        let choice = store
            .get_setting(&canonical_key(&canonical_name))
            .map_err(AppError::db)?
            .and_then(|raw| serde_json::from_str::<CanonicalSelection>(&raw).ok());
        views.push(LibrarySkillView {
            canonical_name,
            deployments: target_views(&skill, &targets),
            skill,
            canonical: choice,
        });
    }
    // Compute choice state against the selected member once per declared name,
    // then project the same status to every member. A non-selected variant is
    // an alternative, not a missing canonical record.
    let mut status_by_name = BTreeMap::new();
    for view in &views {
        if let Some(choice) = &view.canonical {
            let selected = views
                .iter()
                .find(|candidate| candidate.skill.id == choice.skill_id);
            status_by_name.insert(
                view.canonical_name.clone(),
                selection_status(choice, selected.map(|candidate| &candidate.skill)),
            );
        }
    }
    for view in &mut views {
        if let Some(choice) = &mut view.canonical {
            choice.status = status_by_name
                .get(&view.canonical_name)
                .cloned()
                .unwrap_or_else(|| "missing".into());
        }
    }
    let mut grouped: BTreeMap<String, Vec<LibrarySkillView>> = BTreeMap::new();
    for view in &views {
        grouped
            .entry(view.canonical_name.clone())
            .or_default()
            .push(view.clone());
    }
    let mut groups = Vec::new();
    for (name, members) in grouped {
        if members.len() < 2 {
            continue;
        }
        let selected = members.first().and_then(|member| member.canonical.clone());
        let selected_id = selected
            .as_ref()
            .filter(|choice| members.iter().any(|m| m.skill.id == choice.skill_id))
            .map(|choice| choice.skill_id.clone());
        let canonical_status = selected
            .as_ref()
            .map(|choice| {
                selection_status(
                    choice,
                    members
                        .iter()
                        .find(|member| member.skill.id == choice.skill_id)
                        .map(|member| &member.skill),
                )
            })
            .unwrap_or_else(|| "unselected".into());
        let selected_content_changed = canonical_status == "stale";
        let hashes: BTreeSet<_> = members
            .iter()
            .map(|m| {
                m.skill
                    .content_hash
                    .clone()
                    .unwrap_or_else(|| "missing".into())
            })
            .collect();
        let unresolved = members
            .iter()
            .filter(|m| Some(&m.skill.id) != selected_id.as_ref())
            .map(|m| m.skill.id.clone())
            .collect();
        groups.push(CanonicalGroup {
            normalized_name: name,
            members,
            selected_skill_id: selected_id,
            canonical_status,
            selection_reason: selected.as_ref().map(|s| s.reason.clone()),
            unresolved_alternatives: unresolved,
            divergent: hashes.len() > 1,
            selected_content_changed,
        });
    }
    Ok((views, groups))
}

pub fn select_canonical(
    store: &SkillStore,
    request: CanonicalSelectionRequest,
) -> Result<CanonicalSelection, AppError> {
    let _lock = RepoLock::acquire_foreground("select canonical Skill").map_err(AppError::db)?;
    let skill = store
        .get_skill_by_id(&request.skill_id)
        .map_err(AppError::db)?
        .ok_or_else(|| AppError::not_found("Skill not found"))?;
    let reason = request.reason.trim();
    if reason.is_empty() {
        return Err(AppError::invalid_input(
            "A canonical selection requires a reason",
        ));
    }
    let name = canonical_identity(&skill);
    let peers = store
        .get_all_skills()
        .map_err(AppError::db)?
        .into_iter()
        .filter(|peer| canonical_identity(peer) == name)
        .count();
    if peers < 2 {
        return Err(AppError::invalid_input(
            "Canonical selection is only meaningful for same-name alternatives",
        ));
    }
    let choice = CanonicalSelection {
        normalized_name: name.clone(),
        skill_id: skill.id,
        reason: reason.into(),
        selected_digest: Some(
            content_hash::hash_directory_strict_v2(Path::new(&skill.central_path))
                .map_err(AppError::io)?,
        ),
        selected_at: now(),
        status: "confirmed".into(),
    };
    store
        .set_setting(
            &canonical_key(&name),
            &serde_json::to_string(&choice).map_err(AppError::db)?,
        )
        .map_err(AppError::db)?;
    Ok(choice)
}

pub fn begin_edit(store: &SkillStore, request: BeginEditRequest) -> Result<PublishStage, AppError> {
    if request.skill_id.is_some() == request.new_name.is_some() {
        return Err(AppError::invalid_input(
            "Specify exactly one of skill_id or new_name",
        ));
    }
    let _lock = RepoLock::acquire_foreground("begin Skill publish edit").map_err(AppError::db)?;
    std::fs::create_dir_all(stage_root()).map_err(AppError::io)?;
    let stage_id = uuid::Uuid::new_v4().to_string();
    let workspace = stage_root().join(&stage_id);
    let (skill_id, name, base_digest) = if let Some(id) = request.skill_id {
        let skill = store
            .get_skill_by_id(&id)
            .map_err(AppError::db)?
            .ok_or_else(|| AppError::not_found("Skill not found"))?;
        foundation_write::ensure_unchanged(store, &skill)?;
        let source = PathBuf::from(&skill.central_path);
        installer::install_skill_dir_to_destination(&source, &skill.name, &workspace)
            .map_err(AppError::io)?;
        (
            Some(skill.id),
            skill.name,
            Some(content_hash::hash_directory_strict_v2(&source).map_err(AppError::io)?),
        )
    } else {
        let name = skill_metadata::sanitize_skill_name(request.new_name.as_deref().unwrap())
            .ok_or_else(|| AppError::invalid_input("Invalid new Skill name"))?;
        std::fs::create_dir_all(&workspace).map_err(AppError::io)?;
        std::fs::write(
            workspace.join("SKILL.md"),
            format!(
                "---\nname: {name}\ndescription: Draft created by Agent publish workspace\n---\n\n"
            ),
        )
        .map_err(AppError::io)?;
        (None, name, None)
    };
    let stage = PublishStage {
        stage_id,
        skill_id,
        name,
        workspace_path: workspace.to_string_lossy().into_owned(),
        base_digest,
        actor: request.actor,
        status: "editing".into(),
        created_at: now(),
        updated_at: now(),
        last_error: None,
    };
    save_stage(store, &stage)?;
    Ok(stage)
}

pub fn preview_publish(store: &SkillStore, stage_id: &str) -> Result<PublishPreview, AppError> {
    let stage = load_stage(store, stage_id)?;
    let workspace = checked_workspace(&stage)?;
    let stage_digest = content_hash::hash_directory_strict_v2(&workspace).map_err(AppError::io)?;
    let mut base_current = true;
    let mut target_conflicts = Vec::new();
    if let Some(id) = &stage.skill_id {
        let skill = store
            .get_skill_by_id(id)
            .map_err(AppError::db)?
            .ok_or_else(|| AppError::not_found("Skill no longer exists"))?;
        let current = content_hash::hash_directory_strict_v2(Path::new(&skill.central_path))
            .map_err(AppError::io)?;
        base_current = stage.base_digest.as_deref() == Some(current.as_str());
        for target in store.get_targets_for_skill(id).map_err(AppError::db)? {
            if target.mode == "copy" && !foundation_write::target_current(&skill, &target) {
                target_conflicts.push(target.target_path);
            }
        }
    }
    Ok(PublishPreview {
        changed: stage.base_digest.as_deref() != Some(stage_digest.as_str()),
        stage,
        stage_digest,
        base_current,
        target_conflicts,
    })
}

/// Write a UTF-8 file into an existing Manager workspace.  This is the edit
/// transport for MCP clients that cannot access a local Finder/terminal path.
/// It is intentionally limited to the workspace recorded under `stage_id`;
/// validation happens before opening the destination, so a failed request
/// leaves every existing file unchanged.
pub fn write_stage_file(
    store: &SkillStore,
    request: StageFileWriteRequest,
) -> Result<StageFileWriteResult, AppError> {
    if request.content.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::invalid_input(
            "Stage file content exceeds the 256 KiB publish limit",
        ));
    }
    let mut stage = load_stage(store, &request.stage_id)?;
    if stage.status == "published" {
        return Err(AppError::invalid_input(
            "Published workspace is immutable; begin a new edit",
        ));
    }
    let workspace = checked_workspace(&stage)?;
    let relative = checked_relative_path(&request.relative_path)?;
    let destination = workspace.join(relative);
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::invalid_input("Stage file has no parent"))?;
    std::fs::create_dir_all(parent).map_err(AppError::io)?;
    let parent = std::fs::canonicalize(parent).map_err(AppError::io)?;
    if !parent.starts_with(&workspace) {
        return Err(AppError::invalid_input(
            "Stage file parent escaped the Manager workspace",
        ));
    }
    if std::fs::symlink_metadata(&destination).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err(AppError::invalid_input(
            "Refusing to write through a symlink in the Manager workspace",
        ));
    }
    // `write` truncates only after all path and ownership checks above passed.
    std::fs::write(&destination, request.content).map_err(AppError::io)?;
    // Revalidate after the write. A malformed or symlinked tree remains in
    // staging for inspection, but cannot be previewed/published.
    installer::preflight_copy_source(&workspace).map_err(AppError::io)?;
    let candidate_digest =
        content_hash::hash_directory_strict_v2(&workspace).map_err(AppError::io)?;
    stage.status = "editing".into();
    stage.updated_at = now();
    stage.last_error = None;
    save_stage(store, &stage)?;
    Ok(StageFileWriteResult {
        stage,
        candidate_digest,
    })
}

fn append_history(
    store: &SkillStore,
    skill_id: &str,
    entry: PublishHistoryEntry,
) -> Result<(), AppError> {
    let mut rows: Vec<PublishHistoryEntry> = store
        .get_setting(&history_key(skill_id))
        .map_err(AppError::db)?
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    rows.push(entry);
    store
        .set_setting(
            &history_key(skill_id),
            &serde_json::to_string(&rows).map_err(AppError::db)?,
        )
        .map_err(AppError::db)
}

fn record_deployment_rollback(
    store: &SkillStore,
    skill_id: &str,
    stage: &PublishStage,
    attempted_digest: String,
    restored_digest: String,
    rollback_path: String,
    error: &AppError,
) -> Result<(), AppError> {
    append_history(
        store,
        skill_id,
        PublishHistoryEntry {
            id: uuid::Uuid::new_v4().to_string(),
            skill_id: skill_id.into(),
            stage_id: stage.stage_id.clone(),
            action: "deployment_resync".into(),
            actor: stage.actor.clone(),
            before_digest: Some(attempted_digest),
            after_digest: restored_digest,
            rollback_path: Some(rollback_path),
            created_at: now(),
            outcome: "rolled_back".into(),
            error: Some(error.message.clone()),
        },
    )
}
fn history_for_skill(
    store: &SkillStore,
    skill_id: &str,
) -> Result<Vec<PublishHistoryEntry>, AppError> {
    let mut rows: Vec<PublishHistoryEntry> = store
        .get_setting(&history_key(skill_id))
        .map_err(AppError::db)?
        .map(|raw| serde_json::from_str(&raw).map_err(AppError::db))
        .transpose()?
        .unwrap_or_default();
    // Per-Skill settings keys were the first persistence format. Backfill the
    // ID at read time so old entries become useful in the all-library feed
    // without rewriting a user's settings during a read-only query.
    for entry in &mut rows {
        if entry.skill_id.is_empty() {
            entry.skill_id = skill_id.into();
        }
    }
    Ok(rows)
}

/// Recent publish changes across the one shared library. This reads only
/// persisted metadata, so polling it does not walk or hash every Skill tree.
pub fn recent_history(
    store: &SkillStore,
    skill_id: Option<&str>,
    limit: Option<usize>,
) -> Result<Vec<PublishHistoryEntry>, AppError> {
    let mut rows = if let Some(id) = skill_id {
        history_for_skill(store, id)?
    } else {
        let mut all = Vec::new();
        for skill in store.get_all_skills().map_err(AppError::db)? {
            all.extend(history_for_skill(store, &skill.id)?);
        }
        all
    };
    rows.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    rows.truncate(limit.unwrap_or(100).min(200));
    Ok(rows)
}

/// Backward-friendly public shape for MCP and UI: omit `skill_id` to query the
/// library's recent changes, or provide it to focus one Skill.
pub fn history(
    store: &SkillStore,
    skill_id: Option<&str>,
) -> Result<Vec<PublishHistoryEntry>, AppError> {
    recent_history(store, skill_id, None)
}

fn preflight_copy_targets(
    store: &SkillStore,
    skill_id: &str,
    source: &Path,
) -> Result<(), AppError> {
    for target in store
        .get_targets_for_skill(skill_id)
        .map_err(AppError::db)?
    {
        if target.mode == "copy" {
            sync_engine::preflight_replace(
                source,
                Path::new(&target.target_path),
                sync_engine::SyncMode::Copy,
                sync_engine::ReplacePolicy::Recorded { mode: &target.mode },
            )
            .map_err(AppError::io)?;
        }
    }
    Ok(())
}

pub fn publish_stage(
    store: &SkillStore,
    request: PublishRequest,
) -> Result<PublishResult, AppError> {
    let _lock =
        RepoLock::acquire_foreground("publish Agent Skill workspace").map_err(AppError::db)?;
    // Re-read after locking. Another Manager client may have published or
    // invalidated this stage while this caller was waiting for RepoLock.
    let mut stage = load_stage(store, &request.stage_id)?;
    let workspace = checked_workspace(&stage)?;
    let stage_digest = content_hash::hash_directory_strict_v2(&workspace).map_err(AppError::io)?;
    if stage_digest != request.candidate_digest {
        return Err(AppError::invalid_input(
            "Publish preview is stale; staged bytes changed after approval",
        ));
    }
    // RepoLock serializes Manager mutations, not an Agent editing its stage
    // directly. Seal the reviewed candidate before any central mutation, then
    // publish only from this Manager-owned immutable copy.
    let sealed = stage_root().join(format!(
        ".{}.sealed-{}",
        stage.stage_id,
        uuid::Uuid::new_v4()
    ));
    installer::install_skill_dir_to_destination(&workspace, &stage.name, &sealed)
        .map_err(AppError::io)?;
    if content_hash::hash_directory_strict_v2(&sealed).map_err(AppError::io)? != stage_digest {
        let _ = std::fs::remove_dir_all(&sealed);
        return Err(AppError::invalid_input(
            "Candidate cannot be preserved exactly for publish; workspace was left unchanged",
        ));
    }
    let result = (|| -> Result<PublishResult, AppError> {
        let (skill_id, before_digest, rollback_path, action) = if let Some(id) =
            stage.skill_id.clone()
        {
            let skill = store
                .get_skill_by_id(&id)
                .map_err(AppError::db)?
                .ok_or_else(|| AppError::not_found("Skill no longer exists"))?;
            let current = content_hash::hash_directory_strict_v2(Path::new(&skill.central_path))
                .map_err(AppError::io)?;
            if stage.base_digest.as_deref() != Some(current.as_str()) {
                return Err(AppError::invalid_input("Library changed since this Agent began editing; candidate workspace was preserved"));
            }
            foundation_write::ensure_unchanged(store, &skill)?;
            preflight_copy_targets(store, &id, &sealed)?;
            let rollback = rollback_root().join(&stage.stage_id);
            std::fs::create_dir_all(rollback_root()).map_err(AppError::io)?;
            installer::install_skill_dir_to_destination(
                Path::new(&skill.central_path),
                &skill.name,
                &rollback,
            )
            .map_err(AppError::io)?;
            let prepared = skills::staged_path_for(&skill.central_path);
            installer::install_skill_dir_to_destination(&sealed, &skill.name, &prepared)
                .map_err(AppError::io)?;
            if content_hash::hash_directory_strict_v2(&prepared).map_err(AppError::io)?
                != stage_digest
            {
                let _ = std::fs::remove_dir_all(&prepared);
                return Err(AppError::invalid_input(
                    "Prepared publish bytes no longer match the approved candidate",
                ));
            }
            skills::swap_skill_directory(&prepared, Path::new(&skill.central_path))?;
            if let Err(error) = skills::resync_copy_targets(store, &id) {
                // Restore the local canonical tree and attempt to put managed
                // copies back.  The candidate remains in its stage for review.
                let restore = skills::staged_path_for(&skill.central_path);
                installer::install_skill_dir_to_destination(&rollback, &skill.name, &restore)
                    .map_err(AppError::io)?;
                skills::swap_skill_directory(&restore, Path::new(&skill.central_path))?;
                let _ = skills::resync_copy_targets(store, &id);
                // The central bytes were restored, but a failed second target
                // recovery must never be hidden behind a success-looking
                // publish. Keep the rollback directory and an auditable event.
                record_deployment_rollback(
                    store,
                    &id,
                    &stage,
                    stage_digest.clone(),
                    current.clone(),
                    rollback.to_string_lossy().into_owned(),
                    &error,
                )?;
                return Err(AppError::invalid_input(format!(
                    "Publish rolled back because deployment resync failed: {}",
                    error.message
                )));
            }
            (
                id,
                Some(current),
                Some(rollback.to_string_lossy().into_owned()),
                "updated",
            )
        } else {
            let metadata = InstallSourceMetadata {
                source_type: "agent_workspace".into(),
                source_ref: None,
                source_ref_resolved: None,
                source_subpath: None,
                source_branch: None,
                source_revision: None,
                remote_revision: None,
                update_status: "up_to_date".into(),
            };
            let (id, _, _) = skills::install_directory_unlocked(
                store,
                &sealed,
                Some(&stage.name),
                None,
                &metadata,
            )?;
            (id, None, None, "created")
        };
        let skill = store
            .get_skill_by_id(&skill_id)
            .map_err(AppError::db)?
            .ok_or_else(|| AppError::not_found("Published Skill disappeared"))?;
        let meta = skill_metadata::parse_skill_md(Path::new(&skill.central_path));
        store
            .refresh_skill_facts(
                &skill_id,
                &meta.name.unwrap_or(skill.name.clone()),
                meta.description.as_deref(),
                Some(
                    &content_hash::hash_directory(Path::new(&skill.central_path))
                        .map_err(AppError::io)?,
                ),
                "ok",
            )
            .map_err(AppError::db)?;
        let refreshed = store
            .get_skill_by_id(&skill_id)
            .map_err(AppError::db)?
            .ok_or_else(|| AppError::not_found("Published Skill disappeared"))?;
        foundation_write::remember(store, &refreshed).map_err(AppError::db)?;
        sync_metadata::write_all_from_db_unlocked(store).map_err(AppError::db)?;
        let history = PublishHistoryEntry {
            id: uuid::Uuid::new_v4().to_string(),
            skill_id: skill_id.clone(),
            stage_id: stage.stage_id.clone(),
            action: action.into(),
            actor: stage.actor.clone(),
            before_digest,
            after_digest: stage_digest.clone(),
            rollback_path,
            created_at: now(),
            outcome: "published".into(),
            error: None,
        };
        append_history(store, &skill_id, history.clone())?;
        stage.status = "published".into();
        stage.updated_at = now();
        stage.last_error = None;
        stage.skill_id = Some(skill_id.clone());
        save_stage(store, &stage)?;
        let skill = store
            .get_skill_by_id(&skill_id)
            .map_err(AppError::db)?
            .ok_or_else(|| AppError::not_found("Published Skill disappeared"))?;
        let targets = store.get_all_targets().map_err(AppError::db)?;
        Ok(PublishResult {
            skill_id,
            content_digest: stage_digest,
            history,
            deployments: target_views(&skill, &targets),
        })
    })();
    let _ = std::fs::remove_dir_all(&sealed);
    if let Err(error) = &result {
        stage_failure(store, stage, error);
    }
    result
}

pub fn read_skill_document(
    store: &SkillStore,
    skill_id: &str,
    relative_path: Option<&str>,
    max_bytes: Option<usize>,
) -> Result<SkillDocument, AppError> {
    let skill = store
        .get_skill_by_id(skill_id)
        .map_err(AppError::db)?
        .ok_or_else(|| AppError::not_found("Skill not found"))?;
    let root = std::fs::canonicalize(&skill.central_path).map_err(AppError::io)?;
    let rel = relative_path.unwrap_or("SKILL.md");
    let candidate = checked_relative_path(rel)?;
    let path = root.join(candidate);
    let metadata = std::fs::symlink_metadata(&path).map_err(AppError::io)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AppError::invalid_input(
            "Skill document must be a regular file",
        ));
    }
    let resolved = std::fs::canonicalize(&path).map_err(AppError::io)?;
    if !resolved.starts_with(&root) {
        return Err(AppError::invalid_input("Document path escaped its Skill"));
    }
    let cap = max_bytes
        .unwrap_or(MAX_DOCUMENT_BYTES)
        .min(MAX_DOCUMENT_BYTES);
    let total_bytes = usize::try_from(metadata.len()).unwrap_or(usize::MAX);
    let truncated = total_bytes > cap;
    // Do not allocate an arbitrary Skill file merely to answer an MCP read.
    let mut bytes = Vec::with_capacity(total_bytes.min(cap));
    std::fs::File::open(&resolved)
        .map_err(AppError::io)?
        .take(cap as u64)
        .read_to_end(&mut bytes)
        .map_err(AppError::io)?;
    let end = match std::str::from_utf8(&bytes) {
        Ok(_) => bytes.len(),
        Err(error) if truncated && error.error_len().is_none() => error.valid_up_to(),
        Err(_) => return Err(AppError::invalid_input("Skill document is binary")),
    };
    let content = std::str::from_utf8(&bytes[..end])
        .map_err(|_| AppError::invalid_input("Skill document is binary"))?
        .to_owned();
    Ok(SkillDocument {
        skill_id: skill.id,
        relative_path: rel.into(),
        content,
        truncated,
        total_bytes,
        content_digest: content_hash::hash_directory_strict_v2(&root).map_err(AppError::io)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::skill_store::SkillTargetRecord;
    use tempfile::tempdir;

    fn write_skill(path: &Path, name: &str, body: &str) {
        std::fs::create_dir_all(path).unwrap();
        std::fs::write(
            path.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: test\n---\n{body}\n"),
        )
        .unwrap();
    }
    fn record(id: &str, name: &str, path: &Path) -> SkillRecord {
        let now = now();
        SkillRecord {
            id: id.into(),
            name: name.into(),
            description: Some("test".into()),
            source_type: "local".into(),
            source_ref: None,
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: path.to_string_lossy().into_owned(),
            content_hash: Some(content_hash::hash_directory(path).unwrap()),
            enabled: true,
            created_at: now,
            updated_at: now,
            status: "ok".into(),
            update_status: "up_to_date".into(),
            last_checked_at: Some(now),
            last_check_error: None,
        }
    }
    fn setup() -> (tempfile::TempDir, SkillStore) {
        let temp = tempdir().unwrap();
        central_repo::set_test_base_dir_override(Some(temp.path().join("library")));
        std::fs::create_dir_all(central_repo::skills_dir()).unwrap();
        let store = SkillStore::new(&temp.path().join("state.sqlite")).unwrap();
        (temp, store)
    }
    fn candidate(store: &SkillStore, stage: &PublishStage, body: &str) -> String {
        let written = write_stage_file(
            store,
            StageFileWriteRequest {
                stage_id: stage.stage_id.clone(),
                relative_path: "SKILL.md".into(),
                content: format!(
                    "---\nname: {}\ndescription: edited\n---\n{}\n",
                    stage.name, body
                ),
            },
        )
        .unwrap();
        written.candidate_digest
    }

    #[test]
    fn publish_new_skill_records_library_history_and_bounded_document() {
        let _serial = central_repo::test_base_dir_lock();
        let (_temp, store) = setup();
        let stage = begin_edit(
            &store,
            BeginEditRequest {
                skill_id: None,
                new_name: Some("new-published".into()),
                actor: Some("agent-a".into()),
            },
        )
        .unwrap();
        let digest = candidate(&store, &stage, "# New content");
        let result = publish_stage(
            &store,
            PublishRequest {
                stage_id: stage.stage_id,
                candidate_digest: digest,
            },
        )
        .unwrap();
        assert_eq!(result.history.action, "created");
        assert_eq!(history(&store, Some(&result.skill_id)).unwrap().len(), 1);
        let document = read_skill_document(&store, &result.skill_id, None, Some(32)).unwrap();
        assert!(document.content.contains("new-published"));
        central_repo::set_test_base_dir_override(None);
    }

    #[test]
    fn publish_stale_second_session_refuses_and_preserves_candidate() {
        let _serial = central_repo::test_base_dir_lock();
        let (_temp, store) = setup();
        let central = central_repo::skills_dir().join("shared");
        write_skill(&central, "shared", "old");
        store
            .insert_skill(&record("shared-id", "shared", &central))
            .unwrap();
        let first = begin_edit(
            &store,
            BeginEditRequest {
                skill_id: Some("shared-id".into()),
                new_name: None,
                actor: None,
            },
        )
        .unwrap();
        let second = begin_edit(
            &store,
            BeginEditRequest {
                skill_id: Some("shared-id".into()),
                new_name: None,
                actor: None,
            },
        )
        .unwrap();
        let first_digest = candidate(&store, &first, "first");
        publish_stage(
            &store,
            PublishRequest {
                stage_id: first.stage_id,
                candidate_digest: first_digest,
            },
        )
        .unwrap();
        let second_digest = candidate(&store, &second, "second");
        assert!(
            !preview_publish(&store, &second.stage_id)
                .unwrap()
                .base_current
        );
        assert!(publish_stage(
            &store,
            PublishRequest {
                stage_id: second.stage_id.clone(),
                candidate_digest: second_digest
            }
        )
        .is_err());
        assert!(Path::new(&second.workspace_path).join("SKILL.md").is_file());
        assert!(std::fs::read_to_string(central.join("SKILL.md"))
            .unwrap()
            .contains("first"));
        central_repo::set_test_base_dir_override(None);
    }

    #[test]
    fn publish_refuses_candidate_bytes_changed_after_preview() {
        let _serial = central_repo::test_base_dir_lock();
        let (_temp, store) = setup();
        let central = central_repo::skills_dir().join("candidate-race");
        write_skill(&central, "candidate-race", "old");
        store
            .insert_skill(&record("race-id", "candidate-race", &central))
            .unwrap();
        let stage = begin_edit(
            &store,
            BeginEditRequest {
                skill_id: Some("race-id".into()),
                new_name: None,
                actor: None,
            },
        )
        .unwrap();
        let approved = candidate(&store, &stage, "approved");
        // An Agent can write the workspace without RepoLock. The final
        // publish must refuse instead of swapping these unreviewed bytes.
        std::fs::write(
            Path::new(&stage.workspace_path).join("SKILL.md"),
            "---\nname: candidate-race\n---\nunreviewed\n",
        )
        .unwrap();
        assert!(publish_stage(
            &store,
            PublishRequest {
                stage_id: stage.stage_id,
                candidate_digest: approved
            }
        )
        .is_err());
        assert!(std::fs::read_to_string(central.join("SKILL.md"))
            .unwrap()
            .contains("old"));
        central_repo::set_test_base_dir_override(None);
    }

    #[test]
    fn publish_refuses_modified_copy_target_and_keeps_candidate() {
        let _serial = central_repo::test_base_dir_lock();
        let (_temp, store) = setup();
        let central = central_repo::skills_dir().join("protected");
        write_skill(&central, "protected", "old");
        store
            .insert_skill(&record("protected-id", "protected", &central))
            .unwrap();
        let target = central_repo::base_dir().join("agent-copy");
        sync_engine::sync_skill(
            &central,
            &target,
            sync_engine::SyncMode::Copy,
            sync_engine::ReplacePolicy::NoClobber,
        )
        .unwrap();
        store
            .insert_target(&SkillTargetRecord {
                id: "target-id".into(),
                skill_id: "protected-id".into(),
                tool: "test-agent".into(),
                target_path: target.to_string_lossy().into_owned(),
                mode: "copy".into(),
                status: "ok".into(),
                synced_at: Some(now()),
                last_error: None,
                source_hash: Some(content_hash::hash_directory(&central).unwrap()),
            })
            .unwrap();
        let stage = begin_edit(
            &store,
            BeginEditRequest {
                skill_id: Some("protected-id".into()),
                new_name: None,
                actor: None,
            },
        )
        .unwrap();
        let digest = candidate(&store, &stage, "candidate");
        std::fs::write(target.join("user-note.txt"), "do not lose").unwrap();
        assert!(publish_stage(
            &store,
            PublishRequest {
                stage_id: stage.stage_id,
                candidate_digest: digest
            }
        )
        .is_err());
        assert!(target.join("user-note.txt").is_file());
        assert!(Path::new(&stage.workspace_path).join("SKILL.md").is_file());
        central_repo::set_test_base_dir_override(None);
    }

    #[test]
    fn canonical_choice_preserves_distinct_same_name_variants() {
        let _serial = central_repo::test_base_dir_lock();
        let (_temp, store) = setup();
        let left = central_repo::skills_dir().join("platform");
        let right = central_repo::skills_dir().join("custom");
        write_skill(&left, "same", "platform");
        write_skill(&right, "same", "custom");
        store.insert_skill(&record("left", "same", &left)).unwrap();
        store
            .insert_skill(&record("right", "same-2", &right))
            .unwrap();
        let selection = select_canonical(
            &store,
            CanonicalSelectionRequest {
                skill_id: "left".into(),
                reason: "platform policy".into(),
            },
        )
        .unwrap();
        let (library, groups) = list_library(&store).unwrap();
        assert_eq!(library.len(), 2);
        assert_eq!(
            groups[0].selected_skill_id.as_deref(),
            Some(selection.skill_id.as_str())
        );
        assert!(groups[0].divergent);
        assert_eq!(groups[0].canonical_status, "confirmed");
        assert!(left.is_dir() && right.is_dir());
        central_repo::set_test_base_dir_override(None);
    }

    #[test]
    fn canonical_choice_turns_stale_when_selected_content_changes() {
        let _serial = central_repo::test_base_dir_lock();
        let (_temp, store) = setup();
        let left = central_repo::skills_dir().join("selected");
        let right = central_repo::skills_dir().join("alternative");
        write_skill(&left, "same", "old");
        write_skill(&right, "same", "other");
        store.insert_skill(&record("left", "same", &left)).unwrap();
        store
            .insert_skill(&record("right", "same-2", &right))
            .unwrap();
        select_canonical(
            &store,
            CanonicalSelectionRequest {
                skill_id: "left".into(),
                reason: "reviewed".into(),
            },
        )
        .unwrap();
        // This bypasses SkillStore on purpose: an external long-running MCP
        // session may change files before its DB facts are refreshed.
        write_skill(&left, "same", "new");
        let (_, groups) = list_library(&store).unwrap();
        assert_eq!(groups[0].canonical_status, "stale");
        assert!(groups[0].selected_content_changed);
        central_repo::set_test_base_dir_override(None);
    }

    #[test]
    fn recent_history_can_read_whole_library_without_hashing_content() {
        let _serial = central_repo::test_base_dir_lock();
        let (_temp, store) = setup();
        let stage = begin_edit(
            &store,
            BeginEditRequest {
                skill_id: None,
                new_name: Some("history-all".into()),
                actor: None,
            },
        )
        .unwrap();
        let digest = candidate(&store, &stage, "created");
        let result = publish_stage(
            &store,
            PublishRequest {
                stage_id: stage.stage_id,
                candidate_digest: digest,
            },
        )
        .unwrap();
        assert_eq!(
            recent_history(&store, None, Some(10)).unwrap()[0].id,
            result.history.id
        );
        assert_eq!(
            recent_history(&store, Some(&result.skill_id), Some(10))
                .unwrap()
                .len(),
            1
        );
        central_repo::set_test_base_dir_override(None);
    }

    #[test]
    fn legacy_history_rows_are_labeled_with_their_skill_id_on_read() {
        let _serial = central_repo::test_base_dir_lock();
        let (_temp, store) = setup();
        store.set_setting(
            &history_key("legacy-skill"),
            r#"[{"id":"old-entry","stage_id":"old-stage","action":"updated","actor":null,"before_digest":null,"after_digest":"digest","rollback_path":null,"created_at":1}]"#,
        ).unwrap();
        let rows = history(&store, Some("legacy-skill")).unwrap();
        assert_eq!(rows[0].skill_id, "legacy-skill");
        assert_eq!(rows[0].outcome, "published");
        central_repo::set_test_base_dir_override(None);
    }

    #[test]
    fn deployment_resync_failure_records_rollback_evidence() {
        let _serial = central_repo::test_base_dir_lock();
        let (_temp, store) = setup();
        let stage = PublishStage {
            stage_id: "failed-stage".into(),
            skill_id: Some("rollback-id".into()),
            name: "rollback-proof".into(),
            workspace_path: String::new(),
            base_digest: Some("old".into()),
            actor: Some("agent".into()),
            status: "conflicted".into(),
            created_at: now(),
            updated_at: now(),
            last_error: None,
        };
        let error = AppError::invalid_input("copy target became unavailable");
        record_deployment_rollback(
            &store,
            "rollback-id",
            &stage,
            "candidate".into(),
            "restored".into(),
            "/safe/rollback".into(),
            &error,
        )
        .unwrap();
        let entry = history(&store, Some("rollback-id")).unwrap().pop().unwrap();
        assert_eq!(entry.outcome, "rolled_back");
        assert!(entry.rollback_path.is_some());
        assert_eq!(entry.error.as_deref(), Some(error.message.as_str()));
        central_repo::set_test_base_dir_override(None);
    }

    #[cfg(unix)]
    #[test]
    fn publish_stage_rejects_workspace_symlink_escape() {
        use std::os::unix::fs::symlink;
        let _serial = central_repo::test_base_dir_lock();
        let (_temp, store) = setup();
        let stage = begin_edit(
            &store,
            BeginEditRequest {
                skill_id: None,
                new_name: Some("escape".into()),
                actor: None,
            },
        )
        .unwrap();
        let outside = tempdir().unwrap();
        std::fs::remove_dir_all(&stage.workspace_path).unwrap();
        symlink(outside.path(), &stage.workspace_path).unwrap();
        assert!(preview_publish(&store, &stage.stage_id).is_err());
        central_repo::set_test_base_dir_override(None);
    }
}
