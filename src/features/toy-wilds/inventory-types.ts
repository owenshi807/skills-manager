export interface GameInventoryTarget {
  key: string;
  name: string;
  detected: boolean;
  enabled: boolean;
  category?: string;
}

export interface GameSkillDeployment {
  target: string;
  actualStatus: string;
  recordedStatus: string;
  mode: string;
  lastSyncedAt: number | null;
}

export interface GameInventorySkill {
  cardCopy?: {
    kind: string;
    title: string;
    value: string;
    when: string;
    outcome: string;
    condition: string;
    steps: string[];
    input: string;
    evidenceNote: string;
  };
  id: string;
  name: string;
  description: string;
  sourceType: string;
  sourceRevision: string | null;
  recordedContentHash: string | null;
  status: string;
  enabled?: boolean;
  platformAgentKeys: string[];
  deployments: GameSkillDeployment[];
}

export interface GameInventorySnapshot {
  source: "Skill Card Manager";
  businessReadOnly: true;
  observedAt: string;
  total: number;
  stale: false;
  targets: GameInventoryTarget[];
  skills: GameInventorySkill[];
  scenes: GameSceneCard[];
  sceneTotal: number;
  unassignedSkillCount: number;
  multica: {
    connected: false;
    taskDispatchEnabled: false;
  };
}

/** One existing scene is one card. Members are source material, never subcards. */
export interface GameSceneCard {
  id: string;
  name: string;
  description: string;
  skillIds: string[];
  members: GameInventorySkill[];
  grade: null;
  review?: GameSceneReview | null;
}

/** A dated, scoped assessment. It is not a live evaluation or a personal award. */
export interface GameSceneReview {
  reviewId: string;
  reviewedAt: string;
  currentGrade: "C" | "R" | "SR";
  ssrStatus: "not_established" | "supported" | "recorded";
  visualGrade: "C" | "R" | "SR" | "SSR";
  gradeLabel: string;
  freshness: "matched" | "changed";
  title: string;
  value: string;
  useWhen: string;
  ability: string;
  boundary: string;
  basis: string;
  scope: string;
  evidenceSummary: string;
  nextStep: string | null;
  breakthrough: null | { before: string; after: string; example: string; boundary: string };
  art: { url: string; alt: string };
}
