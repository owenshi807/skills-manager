import type { DeckDefinition, DeckStageDefinition } from "./deckCatalog.ts";
import { deckSkillSearchText, normalizeDeckMatchText } from "./deckMatching.ts";
import type { ManagedSkill } from "./tauri.ts";

export const CUSTOM_DECKS_KEY = "card_master_custom_decks_v1";
export const DECK_OVERRIDES_KEY = "card_master_deck_overrides_v1";

export interface DeckOverride {
  removedSkillIds: string[];
  addedSkills: { skillId: string; stageId: string }[];
}

export interface ResolvedSkill {
  skill: ManagedSkill;
  stage: DeckStageDefinition;
  source: "scan" | "added";
  score: number;
}

export function scoreDeckSkill(skill: ManagedSkill, stage: DeckStageDefinition): number {
  const name = normalizeDeckMatchText(skill.name);
  const text = deckSkillSearchText(skill);
  let score = 0;
  for (const preferred of stage.preferredSkills) {
    const target = normalizeDeckMatchText(preferred);
    if (!name || !target) continue;
    if (name === target) score = Math.max(score, 100);
    else if (name.includes(target) || target.includes(name)) score = Math.max(score, 45);
  }
  for (const keyword of stage.keywords) {
    const target = normalizeDeckMatchText(keyword);
    if (!target) continue;
    if (name.includes(target)) score += 12;
    else if (text.includes(target)) score += 3;
  }
  return score;
}

/** A presentation recipe only: neither discovery nor overrides change library membership. */
export function discoverDeck(
  deck: DeckDefinition,
  skills: ManagedSkill[],
  override?: DeckOverride,
): ResolvedSkill[] {
  const removed = new Set(override?.removedSkillIds ?? []);
  const used = new Set<string>();
  const result: ResolvedSkill[] = [];
  const orderedSkills = [...skills].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  // Explicit placements precede every automatic relationship. Removal wins
  // when a saved override contains both operations for the same Skill.
  for (const added of override?.addedSkills ?? []) {
    if (removed.has(added.skillId) || used.has(added.skillId)) continue;
    const skill = orderedSkills.find((candidate) => candidate.id === added.skillId);
    const stage = deck.stages.find((candidate) => candidate.id === added.stageId);
    if (!skill || !stage) continue;
    used.add(skill.id);
    result.push({ skill, stage, source: "added", score: 0 });
  }

  // Reserve exact preferences throughout the recipe before broad keyword
  // matching. Same-name platform variants remain separate library identities.
  for (const stage of deck.stages) {
    for (const preferred of stage.preferredSkills) {
      const preferredName = normalizeDeckMatchText(preferred);
      for (const skill of orderedSkills) {
        if (removed.has(skill.id) || used.has(skill.id)
          || normalizeDeckMatchText(skill.name) !== preferredName) continue;
        used.add(skill.id);
        result.push({ skill, stage, source: "scan", score: 100 });
      }
    }
  }

  for (const stage of deck.stages) {
    const automaticSlots = Math.max(0, 5 - result.filter((item) => item.stage.id === stage.id && item.source === "scan").length);
    const candidates = orderedSkills
      .filter((skill) => !removed.has(skill.id) && !used.has(skill.id))
      .map((skill) => ({ skill, score: scoreDeckSkill(skill, stage) }))
      .filter((candidate) => candidate.score >= 12)
      .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name) || a.skill.id.localeCompare(b.skill.id))
      .slice(0, automaticSlots);
    for (const candidate of candidates) {
      used.add(candidate.skill.id);
      result.push({ ...candidate, stage, source: "scan" });
    }
  }
  return result;
}
