import type { GameInventorySkill } from "./inventory-types";
import type { SkillDocument } from "../../lib/skillPublishing";

type CardCopy = NonNullable<GameInventorySkill["cardCopy"]>;
export function getCardCopy(skill: GameInventorySkill): CardCopy;
export function reviewCardCopy(skill: GameInventorySkill, document: SkillDocument): Promise<CardCopy>;
