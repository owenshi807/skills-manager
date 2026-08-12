export type DeckCardKind = "skill" | "checkpoint";

export interface DeckCardDefinition {
  id: string;
  kind: DeckCardKind;
  skillName?: string;
  titleKey: string;
  purposeKey: string;
}

export interface DeckStageDefinition {
  id: string;
  titleKey: string;
  questionKey: string;
  cards: DeckCardDefinition[];
}

export interface DeckDefinition {
  id: string;
  titleKey: string;
  descriptionKey: string;
  stages: DeckStageDefinition[];
}

export const WEB_CODING_DECK: DeckDefinition = {
  id: "web-coding-v0",
  titleKey: "decks.webCoding.title",
  descriptionKey: "decks.webCoding.description",
  stages: [
    {
      id: "understand",
      titleKey: "decks.stages.understand.title",
      questionKey: "decks.stages.understand.question",
      cards: [
        { id: "brainstorming", kind: "skill", skillName: "brainstorming", titleKey: "decks.cards.brainstorming.title", purposeKey: "decks.cards.brainstorming.purpose" },
        { id: "investigate", kind: "skill", skillName: "investigate", titleKey: "decks.cards.investigate.title", purposeKey: "decks.cards.investigate.purpose" },
      ],
    },
    {
      id: "frame",
      titleKey: "decks.stages.frame.title",
      questionKey: "decks.stages.frame.question",
      cards: [
        { id: "gstack", kind: "skill", skillName: "gstack", titleKey: "decks.cards.gstack.title", purposeKey: "decks.cards.gstack.purpose" },
        { id: "plan-eng-review", kind: "skill", skillName: "plan-eng-review", titleKey: "decks.cards.planEngReview.title", purposeKey: "decks.cards.planEngReview.purpose" },
      ],
    },
    {
      id: "build",
      titleKey: "decks.stages.build.title",
      questionKey: "decks.stages.build.question",
      cards: [
        { id: "design-html", kind: "skill", skillName: "design-html", titleKey: "decks.cards.designHtml.title", purposeKey: "decks.cards.designHtml.purpose" },
        { id: "test-driven-development", kind: "skill", skillName: "test-driven-development", titleKey: "decks.cards.tdd.title", purposeKey: "decks.cards.tdd.purpose" },
      ],
    },
    {
      id: "supervise",
      titleKey: "decks.stages.supervise.title",
      questionKey: "decks.stages.supervise.question",
      cards: [
        { id: "ipo-checkpoint", kind: "checkpoint", titleKey: "decks.cards.ipo.title", purposeKey: "decks.cards.ipo.purpose" },
        { id: "adversarial-review", kind: "skill", skillName: "adversarial-review", titleKey: "decks.cards.adversarial.title", purposeKey: "decks.cards.adversarial.purpose" },
      ],
    },
    {
      id: "verify",
      titleKey: "decks.stages.verify.title",
      questionKey: "decks.stages.verify.question",
      cards: [
        { id: "design-review", kind: "skill", skillName: "design-review", titleKey: "decks.cards.designReview.title", purposeKey: "decks.cards.designReview.purpose" },
        { id: "ship", kind: "skill", skillName: "ship", titleKey: "decks.cards.ship.title", purposeKey: "decks.cards.ship.purpose" },
      ],
    },
  ],
};
