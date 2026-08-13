export interface DeckStageDefinition {
  id: string;
  titleKey: string;
  questionKey: string;
  purposeKey: string;
  preferredSkills: string[];
  keywords: string[];
  checkpoints?: { titleKey: string; purposeKey: string }[];
}

export interface DeckDefinition {
  id: string;
  titleKey: string;
  descriptionKey: string;
  outcomeKey: string;
  supervisionKey: string;
  stopRuleKey: string;
  stages: DeckStageDefinition[];
}

export const VIBE_CODING_DECK: DeckDefinition = {
  id: "vibe-coding",
  titleKey: "decks.catalog.vibeCoding.title",
  descriptionKey: "decks.catalog.vibeCoding.description",
  outcomeKey: "decks.catalog.vibeCoding.outcome",
  supervisionKey: "decks.catalog.vibeCoding.supervision",
  stopRuleKey: "decks.catalog.vibeCoding.stopRule",
  stages: [
    {
      id: "understand",
      titleKey: "decks.catalog.vibeCoding.stages.understand.title",
      questionKey: "decks.catalog.vibeCoding.stages.understand.question",
      purposeKey: "decks.catalog.vibeCoding.stages.understand.purpose",
      preferredSkills: ["brainstorming", "investigate", "diagnose"],
      keywords: ["brainstorm", "investigat", "diagnos", "debug"],
    },
    {
      id: "frame",
      titleKey: "decks.catalog.vibeCoding.stages.frame.title",
      questionKey: "decks.catalog.vibeCoding.stages.frame.question",
      purposeKey: "decks.catalog.vibeCoding.stages.frame.purpose",
      preferredSkills: ["gstack", "autoplan", "plan-eng-review", "gsd-plan-phase"],
      keywords: ["plan", "architect", "scope", "gstack"],
    },
    {
      id: "build",
      titleKey: "decks.catalog.vibeCoding.stages.build.title",
      questionKey: "decks.catalog.vibeCoding.stages.build.question",
      purposeKey: "decks.catalog.vibeCoding.stages.build.purpose",
      preferredSkills: ["test-driven-development", "design-html", "devex-review"],
      keywords: ["test-driven", "implement", "coding", "develop", "devex"],
    },
    {
      id: "supervise",
      titleKey: "decks.catalog.vibeCoding.stages.supervise.title",
      questionKey: "decks.catalog.vibeCoding.stages.supervise.question",
      purposeKey: "decks.catalog.vibeCoding.stages.supervise.purpose",
      preferredSkills: ["adversarial-review"],
      keywords: ["adversarial", "scope", "overengineering"],
      checkpoints: [{
        titleKey: "decks.cards.ipo.title",
        purposeKey: "decks.cards.ipo.purpose",
      }],
    },
    {
      id: "verify",
      titleKey: "decks.catalog.vibeCoding.stages.verify.title",
      questionKey: "decks.catalog.vibeCoding.stages.verify.question",
      purposeKey: "decks.catalog.vibeCoding.stages.verify.purpose",
      preferredSkills: ["design-review", "ship", "codex-review-loop"],
      keywords: ["review", "verify", "ship"],
    },
  ],
};

const BUSINESS_DECK: DeckDefinition = {
  id: "business",
  titleKey: "decks.catalog.business.title",
  descriptionKey: "decks.catalog.business.description",
  outcomeKey: "decks.catalog.business.outcome",
  supervisionKey: "decks.catalog.business.supervision",
  stopRuleKey: "decks.catalog.business.stopRule",
  stages: [
    {
      id: "opportunity",
      titleKey: "decks.catalog.business.stages.opportunity.title",
      questionKey: "decks.catalog.business.stages.opportunity.question",
      purposeKey: "decks.catalog.business.stages.opportunity.purpose",
      preferredSkills: ["demand-insight", "business-coach", "cso"],
      keywords: ["demand", "business", "market", "customer", "strategy"],
    },
    {
      id: "evidence",
      titleKey: "decks.catalog.business.stages.evidence.title",
      questionKey: "decks.catalog.business.stages.evidence.question",
      purposeKey: "decks.catalog.business.stages.evidence.purpose",
      preferredSkills: ["finance-analysis", "benchmark", "business-deal-control-tower"],
      keywords: ["finance", "benchmark", "deal", "sales", "competitive"],
    },
    {
      id: "decision",
      titleKey: "decks.catalog.business.stages.decision.title",
      questionKey: "decks.catalog.business.stages.decision.question",
      purposeKey: "decks.catalog.business.stages.decision.purpose",
      preferredSkills: ["devil-advocate", "high-order-modeling", "cso"],
      keywords: ["decision", "model", "strategy", "coach"],
    },
  ],
};

const RESEARCH_DECK: DeckDefinition = {
  id: "research",
  titleKey: "decks.catalog.research.title",
  descriptionKey: "decks.catalog.research.description",
  outcomeKey: "decks.catalog.research.outcome",
  supervisionKey: "decks.catalog.research.supervision",
  stopRuleKey: "decks.catalog.research.stopRule",
  stages: [
    {
      id: "question",
      titleKey: "decks.catalog.research.stages.question.title",
      questionKey: "decks.catalog.research.stages.question.question",
      purposeKey: "decks.catalog.research.stages.question.purpose",
      preferredSkills: ["investigate", "explosion-research", "huashu-research"],
      keywords: ["research", "investigat", "question", "insight"],
    },
    {
      id: "collect",
      titleKey: "decks.catalog.research.stages.collect.title",
      questionKey: "decks.catalog.research.stages.collect.question",
      purposeKey: "decks.catalog.research.stages.collect.purpose",
      preferredSkills: ["browse", "huashu-info-search", "huashu-material-search"],
      keywords: ["browse", "search", "source", "arxiv", "material"],
    },
    {
      id: "synthesize",
      titleKey: "decks.catalog.research.stages.synthesize.title",
      questionKey: "decks.catalog.research.stages.synthesize.question",
      purposeKey: "decks.catalog.research.stages.synthesize.purpose",
      preferredSkills: ["distill", "benchmark", "document-generate", "careful"],
      keywords: ["distill", "synth", "benchmark", "evidence", "report"],
    },
  ],
};

const RED_TEAM_DECK: DeckDefinition = {
  id: "red-team",
  titleKey: "decks.catalog.redTeam.title",
  descriptionKey: "decks.catalog.redTeam.description",
  outcomeKey: "decks.catalog.redTeam.outcome",
  supervisionKey: "decks.catalog.redTeam.supervision",
  stopRuleKey: "decks.catalog.redTeam.stopRule",
  stages: [
    {
      id: "challenge",
      titleKey: "decks.catalog.redTeam.stages.challenge.title",
      questionKey: "decks.catalog.redTeam.stages.challenge.question",
      purposeKey: "decks.catalog.redTeam.stages.challenge.purpose",
      preferredSkills: ["adversarial-review", "devil-advocate", "grill-me"],
      keywords: ["adversarial", "devil", "challenge", "grill"],
    },
    {
      id: "inspect",
      titleKey: "decks.catalog.redTeam.stages.inspect.title",
      questionKey: "decks.catalog.redTeam.stages.inspect.question",
      purposeKey: "decks.catalog.redTeam.stages.inspect.purpose",
      preferredSkills: ["guard", "careful", "graph-lint", "benchmark-models"],
      keywords: ["guard", "security", "risk", "lint", "benchmark"],
    },
    {
      id: "verify",
      titleKey: "decks.catalog.redTeam.stages.verify.title",
      questionKey: "decks.catalog.redTeam.stages.verify.question",
      purposeKey: "decks.catalog.redTeam.stages.verify.purpose",
      preferredSkills: ["codex-review-loop", "gsd-code-review", "gsd-secure-phase"],
      keywords: ["review", "verify", "audit", "secure"],
    },
  ],
};

const PRODUCT_DESIGN_DECK: DeckDefinition = {
  id: "product-design",
  titleKey: "decks.catalog.productDesign.title",
  descriptionKey: "decks.catalog.productDesign.description",
  outcomeKey: "decks.catalog.productDesign.outcome",
  supervisionKey: "decks.catalog.productDesign.supervision",
  stopRuleKey: "decks.catalog.productDesign.stopRule",
  stages: [
    {
      id: "define",
      titleKey: "decks.catalog.productDesign.stages.define.title",
      questionKey: "decks.catalog.productDesign.stages.define.question",
      purposeKey: "decks.catalog.productDesign.stages.define.purpose",
      preferredSkills: ["demand-insight", "design-consultation", "brainstorming"],
      keywords: ["demand", "product", "design consultation", "brainstorm"],
    },
    {
      id: "explore",
      titleKey: "decks.catalog.productDesign.stages.explore.title",
      questionKey: "decks.catalog.productDesign.stages.explore.question",
      purposeKey: "decks.catalog.productDesign.stages.explore.purpose",
      preferredSkills: ["design-shotgun", "design-an-interface", "figma"],
      keywords: ["design", "interface", "figma", "prototype", "wireframe"],
    },
    {
      id: "make",
      titleKey: "decks.catalog.productDesign.stages.make.title",
      questionKey: "decks.catalog.productDesign.stages.make.question",
      purposeKey: "decks.catalog.productDesign.stages.make.purpose",
      preferredSkills: ["design-html", "figma-implement-design", "figma-design-to-code"],
      keywords: ["design-html", "implement design", "design to code"],
    },
    {
      id: "review",
      titleKey: "decks.catalog.productDesign.stages.review.title",
      questionKey: "decks.catalog.productDesign.stages.review.question",
      purposeKey: "decks.catalog.productDesign.stages.review.purpose",
      preferredSkills: ["design-review", "ios-design-review", "devil-advocate"],
      keywords: ["design review", "ui review", "ux", "usability"],
    },
  ],
};

export const DEFAULT_DECKS: DeckDefinition[] = [
  BUSINESS_DECK,
  RESEARCH_DECK,
  RED_TEAM_DECK,
  PRODUCT_DESIGN_DECK,
  VIBE_CODING_DECK,
];
