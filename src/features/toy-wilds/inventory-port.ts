import { getSkillLibrary, readSkillDocument } from "../../lib/skillPublishing.ts";
import { getToolStatus } from "../../lib/tauri.ts";
import { getSceneOverview } from "../../lib/skillScenes.ts";
import type { GameInventorySnapshot } from "./inventory-types.ts";
import { getScenePilotReview } from "./scene-card-pilots.ts";

function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new Error("场景与能力库快照不完整，未替换当前装备袋。");
}

function record(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  requireValue(typeof value === "string");
  return value;
}

function nullableString(value: unknown): string | null {
  return value == null ? null : stringValue(value);
}

function booleanValue(value: unknown): boolean {
  requireValue(typeof value === "boolean");
  return value;
}

function uniqueIdentity(value: unknown, seen: Set<string>): string {
  const id = stringValue(value);
  requireValue(id.trim().length > 0 && !seen.has(id));
  seen.add(id);
  return id;
}

// The official command returns one complete library, not paginated MCP data.
// Validate the whole response before publishing any replacement snapshot.
export function mapGameInventory(
  library: unknown,
  tools: unknown,
  observedAt = new Date().toISOString(),
  sceneOverview: unknown = { scenes: [], assignments: {} },
): GameInventorySnapshot {
  requireValue(Array.isArray(library) && library.length === 2);
  requireValue(Array.isArray(library[0]) && Array.isArray(library[1]));
  requireValue(Array.isArray(tools) && Number.isFinite(Date.parse(observedAt)));
  const skillIds = new Set<string>();
  const targetKeys = new Set<string>();

  const skills = library[0].map((value: unknown) => {
    const row = record(value);
    const skill = record(row.skill);
    requireValue(Array.isArray(row.deployments));
    const platformKeys = row.platform_agent_keys ?? [];
    requireValue(Array.isArray(platformKeys));
    return {
      id: uniqueIdentity(skill.id, skillIds),
      name: stringValue(skill.name),
      description: nullableString(skill.description) ?? "",
      sourceType: stringValue(skill.source_type),
      sourceRevision: nullableString(skill.source_revision),
      recordedContentHash: nullableString(skill.content_hash),
      status: stringValue(skill.status),
      ...(skill.enabled === undefined ? {} : { enabled: booleanValue(skill.enabled) }),
      platformAgentKeys: platformKeys.map(stringValue),
      deployments: row.deployments.map((value: unknown) => {
        const deployment = record(value);
        const syncedAt = deployment.synced_at;
        requireValue(syncedAt === null || (typeof syncedAt === "number" && Number.isFinite(syncedAt)));
        return {
          target: stringValue(deployment.tool),
          actualStatus: stringValue(deployment.actual_status),
          recordedStatus: stringValue(deployment.recorded_status),
          mode: stringValue(deployment.mode),
          lastSyncedAt: syncedAt,
        };
      }),
    };
  });

  const targets = tools.map((value: unknown) => {
    const tool = record(value);
    return {
      key: uniqueIdentity(tool.key, targetKeys),
      name: stringValue(tool.display_name),
      detected: booleanValue(tool.installed),
      enabled: booleanValue(tool.enabled),
      ...(tool.category === undefined ? {} : { category: stringValue(tool.category) }),
    };
  });

  const overview = record(sceneOverview);
  requireValue(Array.isArray(overview.scenes));
  const assignments = record(overview.assignments);
  const sceneIds = new Set<string>();
  const scenes = overview.scenes.map((value: unknown) => {
    const scene = record(value);
    return {
      id: uniqueIdentity(scene.id, sceneIds),
      name: stringValue(scene.name),
      description: stringValue(scene.description),
      skillIds: [] as string[],
      members: [] as GameInventorySnapshot["skills"],
      grade: null,
    };
  });
  const byScene = new Map(scenes.map(scene => [scene.id, scene]));
  const bySkill = new Map(skills.map(skill => [skill.id, skill]));
  const assigned = new Set<string>();
  for (const [skillId, rows] of Object.entries(assignments)) {
    requireValue(Array.isArray(rows));
    const seen = new Set<string>();
    for (const value of rows) {
      const membership = record(value);
      const sceneId = stringValue(membership.sceneId);
      const skill = bySkill.get(skillId), scene = byScene.get(sceneId);
      // A deleted/stale member never creates a phantom card or capability.
      if (!skill || !scene || seen.has(sceneId)) continue;
      seen.add(sceneId); assigned.add(skillId);
      scene.skillIds.push(skillId); scene.members.push(skill);
    }
  }

  return {
    source: "Skill Card Manager",
    businessReadOnly: true,
    observedAt,
    total: skills.length,
    stale: false,
    targets,
    skills,
    scenes: scenes.map(scene => ({ ...scene, review: getScenePilotReview(scene) })),
    sceneTotal: scenes.length,
    unassignedSkillCount: skills.length - assigned.size,
    multica: { connected: false, taskDispatchEnabled: false },
  };
}

export async function readGameInventory(): Promise<GameInventorySnapshot> {
  const [library, tools, overview] = await Promise.all([getSkillLibrary(), getToolStatus(), getSceneOverview()]);
  // No per-Skill document reads or card generation during library entry.
  return mapGameInventory(library, tools, new Date().toISOString(), overview);
}

export async function readGameSkillDocument(skillId: string) {
  const result = await readSkillDocument(skillId);
  if (!result || result.skill_id !== skillId || result.relative_path !== "SKILL.md" ||
      typeof result.content !== "string" || typeof result.truncated !== "boolean" ||
      typeof result.content_digest !== "string" || !Number.isSafeInteger(result.total_bytes) || result.total_bytes < 0) {
    throw new Error("原始说明未完整返回，请重试。");
  }
  return result;
}
