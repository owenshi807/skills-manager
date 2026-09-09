import { invoke } from "@tauri-apps/api/core";

export interface McpControlStatus {
  enabled: boolean;
  allow_file_writes: boolean;
  command: string;
  available: boolean;
  library_path: string;
  codex_command: string;
  claude_command: string;
  desktop_config: unknown;
}

export interface McpConnectionResult {
  client: "codex" | "claude";
  connected: boolean;
  message: string;
}

export interface DeploymentView {
  tool: string;
  target_path: string;
  mode: string;
  recorded_status: string;
  actual_status: "current" | "needs_sync" | string;
  synced_at: number | null;
}

export interface LibrarySkill {
  id: string;
  name: string;
  description: string | null;
  source_type: string;
  source_revision?: string | null;
  central_path: string;
  content_hash: string | null;
  enabled?: boolean;
  status: string;
}

export interface CanonicalSelection {
  normalized_name: string;
  skill_id: string;
  reason: string;
  selected_digest: string | null;
  selected_at: number;
  status: "confirmed" | "stale" | "missing" | string;
}

export interface LibrarySkillView {
  skill: LibrarySkill;
  canonical_name: string;
  deployments: DeploymentView[];
  canonical: CanonicalSelection | null;
  platform_agent_keys?: string[];
}

export interface CanonicalGroup {
  normalized_name: string;
  members: LibrarySkillView[];
  selected_skill_id: string | null;
  canonical_status: "confirmed" | "stale" | "missing" | "unselected" | string;
  platform_resolution?: {
    reason: string;
    variants: { skill_id: string; agent_keys: string[] }[];
  } | null;
  selection_reason: string | null;
  unresolved_alternatives: string[];
  divergent: boolean;
  selected_content_changed: boolean;
}

export interface PublishHistoryEntry {
  id: string;
  skill_id: string;
  stage_id: string;
  action: string;
  actor: string | null;
  before_digest: string | null;
  after_digest: string;
  rollback_path: string | null;
  created_at: number;
  outcome: "published" | "rolled_back" | string;
  error: string | null;
}

export const getMcpControlStatus = () => invoke<McpControlStatus>("get_mcp_control_status");
export const setMcpControlSettings = (enabled: boolean, allowFileWrites: boolean) =>
  invoke<McpControlStatus>("set_mcp_control_settings", { enabled, allowFileWrites });
export const connectMcpClient = (client: "codex" | "claude") =>
  invoke<McpConnectionResult>("connect_mcp_client", { client });
export const getSkillLibrary = () => invoke<[LibrarySkillView[], CanonicalGroup[]]>("get_skill_library");
export interface SkillDocument {
  skill_id: string;
  relative_path: string;
  content: string;
  truncated: boolean;
  total_bytes: number;
  content_digest: string;
}
// The native reader confines this path to the managed Skill and caps the read.
export const readSkillDocument = (skillId: string) =>
  invoke<SkillDocument>("read_skill_publish_document", { skillId, relativePath: "SKILL.md", maxBytes: 131072 });
export const getSkillPublishHistory = (skillId?: string | null, limit = 30) =>
  invoke<PublishHistoryEntry[]>("get_skill_publish_history", { skillId: skillId ?? null, limit });
export const selectSkillCanonical = (skillId: string, reason: string) =>
  invoke<CanonicalSelection>("select_skill_canonical", { request: { skill_id: skillId, reason } });
