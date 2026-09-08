import { invoke } from "@tauri-apps/api/core";

export type SceneMembershipSource = "ai" | "user";

export interface SkillScene {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface SceneMembership {
  sceneId: string;
  reason: string;
  source: SceneMembershipSource;
  updatedAt: number;
}

export interface SceneAgentCapability {
  key: "codex" | "claude_code" | "hermes";
  display_name: string;
  available: boolean;
  version: string | null;
  reason: string | null;
}

export interface SceneOverview {
  scenes: SkillScene[];
  assignments: Record<string, SceneMembership[]>;
  pendingSkillIds: string[];
  unknownSkillIds: string[];
  errorSkillIds: string[];
  perSkillErrors: Record<string, string>;
  classifiedSkillIds: string[];
  prioritySkillIds: string[];
  autoClassifyEnabled: boolean;
  preferredAgent: string | null;
}

export interface SceneApplyResult {
  appliedSkillIds: string[];
  staleSkillIds: string[];
  unknownSkillIds: string[];
  errorSkillIds: string[];
}

export const SKILL_SCENES_CHANGED_EVENT = "skill-scenes-changed";

function emitSkillScenesChanged() {
  window.dispatchEvent(new CustomEvent(SKILL_SCENES_CHANGED_EVENT));
}

async function sceneMutation<T>(operation: Promise<T>) {
  const result = await operation;
  emitSkillScenesChanged();
  return result;
}

export const getSceneOverview = () => invoke<SceneOverview>("get_skill_scene_overview");
export const getSceneAgentCapabilities = () => invoke<SceneAgentCapability[]>("get_skill_scene_agent_capabilities");
export const classifySkillScenes = (agentKey: string, skillIds?: string[]) =>
  sceneMutation(invoke<SceneApplyResult>("classify_skill_scenes", { agentKey, skillIds: skillIds ?? null }));
export const upsertSkillScene = (sceneId: string | null, name: string, description?: string) =>
  sceneMutation(invoke<SkillScene>("upsert_skill_scene", { sceneId, name, description: description || null }));
export const setSkillSceneAssignment = (skillId: string, sceneId: string, assigned: boolean, reason?: string, preserveExisting = false) =>
  sceneMutation(invoke<void>("set_skill_scene_assignment", { skillId, sceneId, assigned, reason: reason || null, preserveExisting }));
export const setSkillScenePreferences = (autoClassifyEnabled: boolean, preferredAgent: string | null) =>
  sceneMutation(invoke<void>("set_skill_scene_preferences", { autoClassifyEnabled, preferredAgent }));
export const setSkillScenePriorities = (skillIds: string[], priority: boolean) =>
  sceneMutation(invoke<void>("set_skill_scene_priorities", { skillIds, priority }));
