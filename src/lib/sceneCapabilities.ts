import { DEFAULT_DECKS, type DeckDefinition } from "./deckCatalog.ts";
import { discoverDeck, scoreDeckSkill, type DeckOverride, type ResolvedSkill } from "./deckDiscovery.ts";
import { normalizeDeckMatchText } from "./deckMatching.ts";
import type { SceneMembership, SceneMembershipSource, SkillScene } from "./skillScenes.ts";
import type { ManagedSkill } from "./tauri.ts";

export interface SceneCapabilityEvidence {
  skillId: string;
  reason: string;
  source: SceneMembershipSource;
  excludedFromDeck: boolean;
}

export interface SceneCapability {
  id: string;
  titleKey?: string;
  title?: string;
  descriptionKey?: string;
  description?: string;
  questionKey?: string;
  question?: string;
  handoff?: string;
  skillIds: string[];
  deckId?: string;
  stageId?: string;
  checkpoints: { titleKey: string; purposeKey: string }[];
  source: "deck" | "scene";
  missing: boolean;
  excludedFromDeck?: boolean;
  evidence: SceneCapabilityEvidence[];
}

export interface SceneCapabilityGroup {
  sceneId: string;
  skillIds: string[];
  summary?: string;
  /** Existing recipe text is source material, never a new AI classification. */
  deck?: DeckDefinition;
  capabilities: SceneCapability[];
  /** Scene members not placed in this recipe, still visible in capabilities. */
  uncoveredSkillIds: string[];
}

interface Candidate {
  deck: DeckDefinition;
  resolved: ResolvedSkill[];
  explicit: number;
  exact: number;
  coverage: number;
  quality: number;
}

function findRecipe(skills: ManagedSkill[], overrides: Record<string, DeckOverride>): Candidate | undefined {
  if (skills.length === 0) return undefined;
  const candidates = DEFAULT_DECKS.map((deck): Candidate => {
    const override = overrides[deck.id];
    const removed = new Set(override?.removedSkillIds ?? []);
    const resolved = discoverDeck(deck, skills, override);
    const eligible = skills.filter((skill) => !removed.has(skill.id));
    const exactNames = new Set(deck.stages.flatMap((stage) => stage.preferredSkills.map(normalizeDeckMatchText)));
    const exact = eligible.filter((skill) => exactNames.has(normalizeDeckMatchText(skill.name))).length;
    const scores = eligible.map((skill) => Math.max(...deck.stages.map((stage) => scoreDeckSkill(skill, stage)), 0));
    // Coverage is uncapped: a five-card display limit must not make a relevant
    // recipe appear unrelated to a large collection of matching custom Skills.
    const coverage = eligible.length > 0 ? scores.filter((score) => score >= 12).length / eligible.length : 0;
    return {
      deck,
      resolved,
      explicit: resolved.filter((item) => item.source === "added").length
        + skills.filter((skill) => removed.has(skill.id)).length,
      exact,
      coverage,
      quality: scores.reduce((sum, score) => sum + Math.min(score, 100), 0) / Math.max(eligible.length, 1),
    };
  });
  return candidates
    // A generic word such as "review" is insufficient evidence to present an
    // entire workflow as this scene's capability. A real catalog anchor or
    // explicit placement is needed, together with meaningful scene coverage.
    .filter((item) => item.explicit > 0 || (item.exact >= 1 && item.coverage >= 0.5))
    .sort((a, b) => b.explicit - a.explicit || b.quality - a.quality || b.coverage - a.coverage || b.exact - a.exact || a.deck.id.localeCompare(b.deck.id))[0];
}

/** Build a scene → capabilities → Skills view without rewriting any scene data. */
export function buildSceneCapabilities(
  scene: SkillScene,
  managedSkills: ManagedSkill[],
  assignments: Record<string, SceneMembership[]>,
  overrides: Record<string, DeckOverride> = {},
): SceneCapabilityGroup {
  const membershipById = new Map<string, SceneMembership>();
  for (const skill of managedSkills) {
    const membership = assignments[skill.id]?.find((row) => row.sceneId === scene.id);
    if (membership) membershipById.set(skill.id, membership);
  }
  const skills = managedSkills.filter((skill) => membershipById.has(skill.id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const recipe = findRecipe(skills, overrides);
  const removed = new Set(recipe ? overrides[recipe.deck.id]?.removedSkillIds ?? [] : []);
  const evidence = (skillIds: string[]): SceneCapabilityEvidence[] => skillIds.map((skillId) => {
    const membership = membershipById.get(skillId)!;
    return { skillId, reason: membership.reason, source: membership.source, excludedFromDeck: removed.has(skillId) };
  });
  const capabilities: SceneCapability[] = recipe ? recipe.deck.stages.map((stage) => {
    const skillIds = recipe.resolved.filter((item) => item.stage.id === stage.id).map((item) => item.skill.id);
    return {
      id: `deck:${recipe.deck.id}:${stage.id}`,
      titleKey: stage.titleKey,
      descriptionKey: stage.purposeKey,
      questionKey: stage.questionKey,
      skillIds,
      deckId: recipe.deck.id,
      stageId: stage.id,
      checkpoints: stage.checkpoints ?? [],
      source: "deck",
      missing: skillIds.length === 0,
      evidence: evidence(skillIds),
    };
  }) : [];
  const placed = new Set(recipe?.resolved.map((item) => item.skill.id) ?? []);
  const uncoveredSkillIds = skills.filter((skill) => !placed.has(skill.id)).map((skill) => skill.id);
  const supporting = uncoveredSkillIds.filter((skillId) => !removed.has(skillId));
  const excluded = uncoveredSkillIds.filter((skillId) => removed.has(skillId));
  if (supporting.length > 0) {
    capabilities.push({
      id: `scene:${scene.id}:supporting`,
      title: recipe ? "补充能力" : "场景内的分工",
      description: scene.description.trim() || `这些 Skill 已归入「${scene.name}」，可以展开查看各自的作用与归类依据。`,
      skillIds: supporting,
      checkpoints: [],
      source: "scene",
      missing: false,
      evidence: evidence(supporting),
    });
  }
  if (excluded.length > 0) {
    capabilities.push({
      id: `scene:${scene.id}:not-in-combination`,
      title: "未纳入此组合",
      description: "这些 Skill 仍属于此使用场景，已按你的设置从当前组合中排除。",
      skillIds: excluded,
      checkpoints: [],
      source: "scene",
      missing: false,
      excludedFromDeck: true,
      evidence: evidence(excluded),
    });
  }
  return { sceneId: scene.id, skillIds: skills.map((skill) => skill.id), deck: recipe?.deck, capabilities, uncoveredSkillIds };
}
