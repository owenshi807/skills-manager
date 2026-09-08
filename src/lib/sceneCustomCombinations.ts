import type { DeckSuggestionCard, DeckSuggestionStage, ManagedSkill } from "./tauri.ts";
import type { SceneCapabilityGroup } from "./sceneCapabilities.ts";
import type { SceneMembership, SkillScene } from "./skillScenes.ts";

export const CUSTOM_DECKS_KEY = "card_master_custom_decks_v1";
export const SCENE_COMBINATIONS_CHANGED_EVENT = "scene-combinations-changed";

/** Scene names are single-line; normalize previews without changing stored plans. */
export function sceneCombinationTitle(title: string): string {
  return [...title.replace(/[\r\n]+/g, " ")].slice(0, 80).join("");
}

/** Retains the original custom-deck record so older saved plans remain usable. */
export interface SceneCustomCombination {
  id: string;
  title: string;
  summary: string;
  goal: string;
  cards: DeckSuggestionCard[];
  stages?: DeckSuggestionStage[];
  gaps: string[];
  createdAt: number;
  sceneId?: string;
  /** Existing-scene plans must never rewrite scene membership, including retries. */
  sceneSaveMode?: "existing-scene" | "new-scene-import";
  sceneImportStatus?: "pending" | "complete";
  /** User exclusions are distinct from Skills the automatic suggestion omitted. */
  excludedSkillIds?: string[];
  /** Explicit restorations override older custom-plan and catalog exclusions. */
  restoredSkillIds?: string[];
}

export function parseSceneCustomCombinations(raw: string | null): SceneCustomCombination[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  const record = (item: unknown): item is Record<string, unknown> => typeof item === "object" && item !== null;
  if (!Array.isArray(value) || !value.every((item) => record(item)
    && ["id", "title", "summary", "goal"].every((key) => typeof item[key] === "string")
    && typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
    && Array.isArray(item.cards) && item.cards.every((card: unknown) => record(card)
      && ["skill_id", "stage", "role", "reason"].every((key) => typeof card[key] === "string"))
    && Array.isArray(item.gaps) && item.gaps.every((gap: unknown) => typeof gap === "string")
    && (item.stages === undefined || (Array.isArray(item.stages) && item.stages.every((stage: unknown) => record(stage)
      && ["name", "purpose", "handoff", "done_when"].every((key) => typeof stage[key] === "string"))))
    && (item.sceneId === undefined || typeof item.sceneId === "string")
    && (item.sceneSaveMode === undefined || item.sceneSaveMode === "existing-scene" || item.sceneSaveMode === "new-scene-import")
    && (item.excludedSkillIds === undefined || (Array.isArray(item.excludedSkillIds) && item.excludedSkillIds.every((id: unknown) => typeof id === "string")))
    && (item.restoredSkillIds === undefined || (Array.isArray(item.restoredSkillIds) && item.restoredSkillIds.every((id: unknown) => typeof id === "string")))
    && (item.sceneImportStatus === undefined || item.sceneImportStatus === "pending" || item.sceneImportStatus === "complete"))) {
    throw new Error("已有组合记录格式异常，未覆盖原始数据。");
  }
  const ids = value.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("已有组合记录 ID 重复，未覆盖原始数据。");
  return value as SceneCustomCombination[];
}

export async function loadSceneCustomCombinations(): Promise<SceneCustomCombination[]> {
  const api = await import("./tauri.ts");
  return parseSceneCustomCombinations(await api.getSettings(CUSTOM_DECKS_KEY));
}

export function groupCombinationCards(cards: DeckSuggestionCard[]) {
  const stages = new Map<string, DeckSuggestionCard[]>();
  for (const card of cards) {
    const stage = card.stage.trim() || "共同完成目标";
    stages.set(stage, [...(stages.get(stage) ?? []), card]);
  }
  return [...stages].map(([title, members]) => ({ title, cards: members }));
}

function cardExplanation(card: DeckSuggestionCard) {
  return [card.role.trim(), card.reason.trim()].filter(Boolean).join("：");
}

export function removeSkillFromCombination(combination: SceneCustomCombination, skillId: string): SceneCustomCombination {
  return {
    ...combination,
    cards: combination.cards.filter((card) => card.skill_id !== skillId),
    excludedSkillIds: [...new Set([...(combination.excludedSkillIds ?? []), skillId])],
    restoredSkillIds: combination.restoredSkillIds?.filter((id) => id !== skillId),
  };
}

export function restoreSkillToCombination(combination: SceneCustomCombination, skillId: string): SceneCustomCombination {
  return {
    ...combination,
    excludedSkillIds: (combination.excludedSkillIds ?? []).filter((id) => id !== skillId),
    restoredSkillIds: [...new Set([...(combination.restoredSkillIds ?? []), skillId])],
  };
}

export function latestSceneCustomCombination(sceneId: string | undefined, combinations: SceneCustomCombination[]) {
  return combinations.filter((row) => sceneId !== undefined && row.sceneId === sceneId && row.sceneImportStatus !== "pending")
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))[0];
}

/** A confirmed snapshot preserves exclusions until the user explicitly restores them. */
export function sceneCombinationExcludedSkillIds(
  sceneId: string | undefined,
  combinations: SceneCustomCombination[],
  additionalIds: string[] = [],
  snapshot?: SceneCustomCombination,
): string[] {
  const current = snapshot ?? latestSceneCustomCombination(sceneId, combinations);
  const restored = new Set(current?.restoredSkillIds ?? []);
  return [...new Set([
    ...additionalIds,
    ...(current?.excludedSkillIds ?? []),
  ])].filter((id) => !restored.has(id));
}

/** Explicitly confirmed work plans take precedence; actual scene membership still wins. */
export function applySceneCustomCombination(
  group: SceneCapabilityGroup,
  combinations: SceneCustomCombination[],
  managedSkills: ManagedSkill[],
  assignments: Record<string, SceneMembership[]>,
): SceneCapabilityGroup {
  const combination = latestSceneCustomCombination(group.sceneId, combinations);
  if (!combination) return group;
  const excluded = new Set(sceneCombinationExcludedSkillIds(group.sceneId, combinations, group.capabilities.flatMap((capability) => [
    ...(capability.excludedFromDeck ? capability.skillIds : []),
    ...capability.evidence.filter((row) => row.excludedFromDeck).map((row) => row.skillId),
  ])));
  const active = new Set(managedSkills.map((skill) => skill.id));
  const members = new Set(group.skillIds);
  const used = new Set<string>();
  const cards = combination.cards.filter((card) => {
    if (!active.has(card.skill_id) || !members.has(card.skill_id) || used.has(card.skill_id) || excluded.has(card.skill_id)) return false;
    used.add(card.skill_id);
    return true;
  });
  const evidence = (skillId: string) => {
    const membership = assignments[skillId]?.find((row) => row.sceneId === group.sceneId);
    return { skillId, reason: membership?.reason ?? "", source: membership?.source ?? "user" as const, excludedFromDeck: excluded.has(skillId) };
  };
  const capabilities: SceneCapabilityGroup["capabilities"] = groupCombinationCards(cards).map((stage) => {
    const explanation = combination.stages?.find((item) => item.name.trim() === stage.title);
    return {
      id: `custom:${combination.id}:${encodeURIComponent(stage.title)}`,
      title: stage.title,
      description: explanation?.purpose || [...new Set(stage.cards.map(cardExplanation).filter(Boolean))].join("；"),
      question: explanation?.done_when,
      handoff: explanation?.handoff,
      skillIds: stage.cards.map((card) => card.skill_id),
      checkpoints: [],
      source: "scene",
      missing: false,
      evidence: stage.cards.map((card) => evidence(card.skill_id)),
    };
  });
  const uncoveredSkillIds = group.skillIds.filter((id) => !used.has(id));
  const supplementary = uncoveredSkillIds.filter((id) => !excluded.has(id));
  const excludedMembers = uncoveredSkillIds.filter((id) => excluded.has(id));
  if (supplementary.length) capabilities.push({
    id: `scene:${group.sceneId}:supporting`,
    title: "补充能力",
    description: "这些 Skill 也属于此场景，可按实际需要补充到工作中。",
    skillIds: supplementary,
    checkpoints: [], source: "scene", missing: false,
    evidence: supplementary.map(evidence),
  });
  if (excludedMembers.length) capabilities.push({
    id: `scene:${group.sceneId}:not-in-combination`,
    title: "未纳入此组合",
    description: "这些 Skill 已按你的设置从组合中排除，原有场景归属保留。",
    skillIds: excludedMembers,
    checkpoints: [], source: "scene", missing: false, excludedFromDeck: true,
    evidence: excludedMembers.map(evidence),
  });
  for (const gap of [...new Set(combination.gaps.filter((value) => value.trim()))]) capabilities.push({
    id: `custom:${combination.id}:gap:${encodeURIComponent(gap)}`,
    title: "需要补足的能力",
    description: gap,
    skillIds: [], checkpoints: [], source: "scene", missing: true, evidence: [],
  });
  return { ...group, summary: combination.summary, deck: undefined, capabilities, uncoveredSkillIds };
}

export interface SceneCombinationSaveDependencies {
  read: () => Promise<string | null>;
  write: (raw: string) => Promise<void>;
  /** Creation atomically binds the scene ID to this persisted pending plan. */
  createScene: (name: string, description: string, pendingCombinationId: string) => Promise<SkillScene>;
  assign: (skillId: string, sceneId: string, reason: string) => Promise<void>;
  changed: () => void;
}

async function defaultSaveDependencies(): Promise<SceneCombinationSaveDependencies> {
  const [api, scenes] = await Promise.all([import("./tauri.ts"), import("./skillScenes.ts")]);
  return {
    read: () => api.getSettings(CUSTOM_DECKS_KEY),
    write: (raw) => api.setSettings(CUSTOM_DECKS_KEY, raw),
    createScene: (name, description, planId) => scenes.upsertSkillScene(null, name, description, planId),
    assign: (skillId, sceneId, reason) => scenes.setSkillSceneAssignment(skillId, sceneId, true, reason, true),
    changed: () => window.dispatchEvent(new CustomEvent(SCENE_COMBINATIONS_CHANGED_EVENT)),
  };
}

// Serialize writes in this window, and re-read before each update. A failed read
// must never be interpreted as an empty collection and destroy previous plans.
let saveQueue: Promise<unknown> = Promise.resolve();

export function saveCombinationAsScene(
  combination: SceneCustomCombination,
  currentSkillIds: string[],
  onProgress: (saved: SceneCustomCombination) => void,
  dependencies?: SceneCombinationSaveDependencies,
): Promise<SceneCustomCombination> {
  const task = saveQueue.catch(() => undefined).then(async () => {
    const deps = dependencies ?? await defaultSaveDependencies();
    const records = parseSceneCustomCombinations(await deps.read());
    const existing = records.find((row) => row.id === combination.id);
    const sceneId = combination.sceneId ?? existing?.sceneId;
    // All new callers persist an explicit mode before scene creation. Legacy
    // linked records are conservatively migrated to membership-free saves;
    // their IDs cannot prove that an old import is still allowed to add members.
    const sceneSaveMode = existing?.sceneSaveMode ?? combination.sceneSaveMode ?? (sceneId ? "existing-scene" : "new-scene-import");
    if (sceneSaveMode === "existing-scene" && !sceneId) throw new Error("当前场景不存在，请刷新后重试。");
    const previous = latestSceneCustomCombination(sceneId, records);
    const restoredSkillIds = combination.restoredSkillIds ?? existing?.restoredSkillIds ?? previous?.restoredSkillIds ?? [];
    const excludedSkillIds = (combination.excludedSkillIds ?? existing?.excludedSkillIds ?? previous?.excludedSkillIds ?? [])
      .filter((id) => !restoredSkillIds.includes(id));
    const excluded = new Set(excludedSkillIds);
    const current = new Set(currentSkillIds);
    const cards = combination.cards.filter((card) => current.has(card.skill_id) && !excluded.has(card.skill_id));
    if (!cards.length && !(sceneSaveMode === "existing-scene" && [...excludedSkillIds, ...restoredSkillIds].some((id) => current.has(id)))) {
      throw new Error("方案中的 Skill 已不在当前技能库，请重新生成组合。");
    }
    let saved: SceneCustomCombination = { ...existing, ...combination, sceneId, sceneSaveMode, excludedSkillIds, restoredSkillIds, sceneImportStatus: "pending" };
    const persist = async () => {
      const records = parseSceneCustomCombinations(await deps.read());
      const index = records.findIndex((row) => row.id === saved.id);
      if (index < 0) records.unshift(saved);
      else records[index] = { ...records[index], ...saved };
      await deps.write(JSON.stringify(records));
      onProgress(saved);
      deps.changed();
    };
    // Preserve the plan before attempting any scene operation, including retries.
    await persist();
    if (!saved.sceneId) {
      const scene = await deps.createScene(saved.title.trim(), saved.summary.trim(), saved.id);
      saved = { ...saved, sceneId: scene.id };
      // The backend commits this association with scene creation, so reloads
      // recover it even when the response or a later import operation fails.
      onProgress(saved);
    }
    if (saved.sceneSaveMode === "new-scene-import") {
      const reasons = new Map<string, string[]>();
      for (const card of cards) reasons.set(card.skill_id, [...(reasons.get(card.skill_id) ?? []), `${card.stage}：${cardExplanation(card)}`]);
      for (const [skillId, explanations] of reasons) {
        const reason = `已确认用于「${saved.title}」。${[...new Set(explanations)].join("；")}`;
        // Conditional backend assignment preserves any membership or manual
        // exclusion already present when the mutation lock is acquired.
        await deps.assign(skillId, saved.sceneId!, [...reason].slice(0, 500).join(""));
      }
    }
    saved = { ...saved, sceneImportStatus: "complete" };
    await persist();
    return saved;
  });
  saveQueue = task;
  return task;
}
