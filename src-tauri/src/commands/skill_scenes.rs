//! Tauri boundary for scene organization. The core module is also directly
//! callable by the MCP server, avoiding recursive local MCP calls.

use crate::core::skill_store::SkillStore;
use crate::core::{
    error::AppError,
    skill_scenes::{
        self, SceneApplyResult, SceneOverview, SceneProposal, SceneSnapshot, SkillScene,
    },
};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_skill_scene_overview(
    store: State<'_, Arc<SkillStore>>,
) -> Result<SceneOverview, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || skill_scenes::get_overview(&store)).await?
}

/// Capability probing launches three external CLIs and is deliberately kept
/// off the overview polling path. The UI calls this on opening its agent menu.
#[tauri::command]
pub async fn get_skill_scene_agent_capabilities(
) -> Result<Vec<crate::core::organization_agent::AgentCapability>, AppError> {
    Ok(crate::core::organization_agent::probe_agents().await)
}

#[tauri::command]
pub async fn get_skill_scene_snapshot(
    skill_ids: Option<Vec<String>>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<SceneSnapshot, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        skill_scenes::build_snapshot(&store, skill_ids.as_deref())
    })
    .await?
}

#[tauri::command]
pub async fn apply_skill_scene_proposal(
    snapshot: SceneSnapshot,
    proposal: SceneProposal,
    store: State<'_, Arc<SkillStore>>,
) -> Result<SceneApplyResult, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        skill_scenes::apply_proposal(&store, &snapshot, proposal)
    })
    .await?
}

#[tauri::command]
pub async fn upsert_skill_scene(
    scene_id: Option<String>,
    name: String,
    description: Option<String>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<SkillScene, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        skill_scenes::upsert_scene(&store, scene_id, name, description)
    })
    .await?
}

/// `assigned: false` is a durable user exclusion and AI refreshes cannot
/// silently recreate that relationship.
#[tauri::command]
pub async fn set_skill_scene_assignment(
    skill_id: String,
    scene_id: String,
    assigned: bool,
    reason: Option<String>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        skill_scenes::set_assignment(&store, skill_id, scene_id, assigned, reason)
    })
    .await?
}

#[tauri::command]
pub async fn set_skill_scene_preferences(
    auto_classify_enabled: bool,
    preferred_agent: Option<String>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        skill_scenes::set_preferences(&store, auto_classify_enabled, preferred_agent)
    })
    .await?
}

#[tauri::command]
pub async fn set_skill_scene_priorities(
    skill_ids: Vec<String>,
    priority: bool,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        skill_scenes::set_priorities(&store, &skill_ids, priority)
    })
    .await?
}

/// Explicit foreground classification. It never runs without a user trigger;
/// the stored auto preference is only for a scheduler registered by the app.
#[tauri::command]
pub async fn classify_skill_scenes(
    agent_key: String,
    skill_ids: Option<Vec<String>>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<SceneApplyResult, AppError> {
    let store = store.inner().clone();
    skill_scenes::classify_batches_with_agent(&store, &agent_key, skill_ids).await
}
