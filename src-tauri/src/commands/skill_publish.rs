//! Thin Tauri adapters for the shared Agent publishing service.
use crate::core::{error::AppError, skill_publish, skill_store::SkillStore};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_skill_library(
    store: State<'_, Arc<SkillStore>>,
) -> Result<
    (
        Vec<skill_publish::LibrarySkillView>,
        Vec<skill_publish::CanonicalGroup>,
    ),
    AppError,
> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || skill_publish::list_library(&store)).await?
}
#[tauri::command]
pub async fn begin_skill_edit(
    request: skill_publish::BeginEditRequest,
    store: State<'_, Arc<SkillStore>>,
) -> Result<skill_publish::PublishStage, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || skill_publish::begin_edit(&store, request)).await?
}
#[tauri::command]
pub async fn preview_skill_publish(
    stage_id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<skill_publish::PublishPreview, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || skill_publish::preview_publish(&store, &stage_id))
        .await?
}
#[tauri::command]
pub async fn write_skill_publish_stage_file(
    request: skill_publish::StageFileWriteRequest,
    store: State<'_, Arc<SkillStore>>,
) -> Result<skill_publish::StageFileWriteResult, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || skill_publish::write_stage_file(&store, request))
        .await?
}
#[tauri::command]
pub async fn publish_skill_stage(
    request: skill_publish::PublishRequest,
    store: State<'_, Arc<SkillStore>>,
) -> Result<skill_publish::PublishResult, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || skill_publish::publish_stage(&store, request))
        .await?
}
#[tauri::command]
pub async fn get_skill_publish_history(
    skill_id: Option<String>,
    limit: Option<usize>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<skill_publish::PublishHistoryEntry>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        skill_publish::recent_history(&store, skill_id.as_deref(), limit)
    })
    .await?
}
#[tauri::command]
pub async fn select_skill_canonical(
    request: skill_publish::CanonicalSelectionRequest,
    store: State<'_, Arc<SkillStore>>,
) -> Result<skill_publish::CanonicalSelection, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || skill_publish::select_canonical(&store, request))
        .await?
}
#[tauri::command]
pub async fn read_skill_publish_document(
    skill_id: String,
    relative_path: Option<String>,
    max_bytes: Option<usize>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<skill_publish::SkillDocument, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        skill_publish::read_skill_document(&store, &skill_id, relative_path.as_deref(), max_bytes)
    })
    .await?
}
