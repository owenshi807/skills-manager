export interface DeckMatchableSkill {
  name: string;
  description?: string | null;
}

export function normalizeDeckMatchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase();
}

export function deckSkillSearchText(skill: DeckMatchableSkill) {
  return normalizeDeckMatchText([skill.name, skill.description ?? ""].join(" "));
}
