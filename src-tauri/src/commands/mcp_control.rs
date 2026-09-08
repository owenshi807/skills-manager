use crate::core::{
    central_repo, error::AppError, mcp_bridge, organization_agent, skill_store::SkillStore,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

pub const MCP_ENABLED_KEY: &str = "foundation_mcp_enabled";
pub const MCP_WRITES_KEY: &str = "foundation_mcp_file_writes";

#[derive(Debug, Serialize)]
pub struct McpControlStatus {
    pub enabled: bool,
    pub allow_file_writes: bool,
    pub command: String,
    pub available: bool,
    pub library_path: String,
    pub codex_command: String,
    pub claude_command: String,
    pub desktop_config: serde_json::Value,
}

pub fn setting_enabled(store: &SkillStore, key: &str) -> Result<bool, AppError> {
    Ok(store.get_setting(key).map_err(AppError::db)?.as_deref() == Some("true"))
}

pub fn resolve_server_path() -> PathBuf {
    mcp_bridge::bridge_path()
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn control_status(store: &SkillStore) -> Result<McpControlStatus, AppError> {
    let server = resolve_server_path();
    let command = server.to_string_lossy().to_string();
    let quoted = shell_quote(&command);
    Ok(McpControlStatus {
        enabled: setting_enabled(store, MCP_ENABLED_KEY)?,
        allow_file_writes: setting_enabled(store, MCP_WRITES_KEY)?,
        available: mcp_bridge::ready(),
        library_path: central_repo::skills_dir().to_string_lossy().to_string(),
        codex_command: format!("codex mcp add skill-manager -- {quoted}"),
        claude_command: format!(
            "claude mcp add --transport stdio --scope user skill-manager -- {quoted}"
        ),
        desktop_config: serde_json::json!({"mcpServers": {"skill-manager": {"command": command, "args": []}}}),
        command,
    })
}

#[tauri::command]
pub async fn get_mcp_control_status(
    store: State<'_, Arc<SkillStore>>,
) -> Result<McpControlStatus, AppError> {
    control_status(&store)
}

#[tauri::command]
pub async fn set_mcp_control_settings(
    enabled: bool,
    allow_file_writes: bool,
    store: State<'_, Arc<SkillStore>>,
) -> Result<McpControlStatus, AppError> {
    if enabled {
        tauri::async_runtime::spawn_blocking(mcp_bridge::ensure_bridge)
            .await?
            .map_err(AppError::io)?;
    }
    // Disable first when revoking access. Enabling writes is never implied by
    // enabling read/organization access.
    if !enabled {
        store
            .set_setting(MCP_ENABLED_KEY, "false")
            .map_err(AppError::db)?;
    }
    store
        .set_setting(
            MCP_WRITES_KEY,
            if allow_file_writes { "true" } else { "false" },
        )
        .map_err(AppError::db)?;
    store
        .set_setting(MCP_ENABLED_KEY, if enabled { "true" } else { "false" })
        .map_err(AppError::db)?;
    control_status(&store)
}

#[derive(Debug, Serialize)]
pub struct McpClientConnection {
    pub client: String,
    pub connected: bool,
    pub message: String,
}

async fn client_command(client: &str, args: &[&str]) -> Result<std::process::Output, AppError> {
    let binary = match client {
        "codex" => "codex",
        "claude" => "claude",
        _ => return Err(AppError::invalid_input("Supported clients: codex, claude")),
    };
    let mut command = tokio::process::Command::new(organization_agent::executable_path(binary));
    command
        .args(args)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    tokio::time::timeout(std::time::Duration::from_secs(20), command.output())
        .await
        .map_err(|_| AppError::invalid_input("Assistant configuration command timed out"))?
        .map_err(AppError::io)
}

fn configured_command(client: &str, output: &std::process::Output) -> Option<String> {
    if !output.status.success() {
        return None;
    }
    if client == "codex" {
        let value: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
        value["transport"]["command"].as_str().map(str::to_string)
    } else {
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .find_map(|line| {
                line.trim()
                    .strip_prefix("Command:")
                    .map(|s| s.trim().to_string())
            })
    }
}

#[tauri::command]
pub async fn connect_mcp_client(
    client: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<McpClientConnection, AppError> {
    if std::env::var_os("SKILLS_MANAGER_EVAL_ROOT").is_some() {
        return Err(AppError::invalid_input(
            "Assistant configuration changes are disabled in the isolated evaluation runtime.",
        ));
    }
    if !setting_enabled(&store, MCP_ENABLED_KEY)? {
        return Err(AppError::invalid_input(
            "Enable MCP before connecting an assistant",
        ));
    }
    let path = tauri::async_runtime::spawn_blocking(mcp_bridge::ensure_bridge)
        .await?
        .map_err(AppError::io)?;
    let command = path.to_string_lossy().to_string();
    let get_args: &[&str] = match client.as_str() {
        "codex" => &["mcp", "get", "skill-manager", "--json"],
        "claude" => &["mcp", "get", "skill-manager"],
        _ => return Err(AppError::invalid_input("Supported clients: codex, claude")),
    };
    let before = client_command(&client, get_args).await?;
    if before.status.success() {
        if configured_command(&client, &before).as_deref() != Some(command.as_str()) {
            return Err(AppError::invalid_input("This assistant already has a different server named skill-manager. Its configuration was preserved; resolve that name collision before connecting."));
        }
    } else {
        let detail = format!(
            "{}{}",
            String::from_utf8_lossy(&before.stdout),
            String::from_utf8_lossy(&before.stderr)
        );
        let absent = if client == "codex" {
            detail.contains("No MCP server named 'skill-manager' found")
        } else {
            detail.contains("No MCP server found with name: skill-manager")
        };
        if !absent {
            return Err(AppError::invalid_input(format!(
                "Cannot inspect assistant MCP configuration: {}",
                detail.chars().take(2000).collect::<String>()
            )));
        }
        let add_args: Vec<&str> = if client == "codex" {
            vec!["mcp", "add", "skill-manager", "--", &command]
        } else {
            vec![
                "mcp",
                "add",
                "--transport",
                "stdio",
                "--scope",
                "user",
                "skill-manager",
                "--",
                &command,
            ]
        };
        let added = client_command(&client, &add_args).await?;
        if !added.status.success() {
            return Err(AppError::invalid_input(format!(
                "Assistant rejected the MCP configuration: {}",
                String::from_utf8_lossy(&added.stderr)
                    .chars()
                    .take(2000)
                    .collect::<String>()
            )));
        }
    }
    let checked = client_command(&client, get_args).await?;
    if configured_command(&client, &checked).as_deref() != Some(command.as_str()) {
        return Err(AppError::invalid_input(
            "Assistant configuration could not be verified",
        ));
    }
    Ok(McpClientConnection {
        client,
        connected: true,
        message:
            "Configuration verified. Start a new assistant session to load the Skill Manager tools."
                .into(),
    })
}
