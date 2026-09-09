import type { GameInventorySnapshot } from "./inventory-types";
import type { SkillDocument } from "../../lib/skillPublishing";

export interface ToyWildsOptions {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  readInventory: () => Promise<GameInventorySnapshot>;
  readDocument: (skillId: string) => Promise<SkillDocument>;
  onManageScene?: (sceneId: string) => void;
  sceneId: string | null;
  sceneName: string;
}

export interface ToyWildsDebug {
  mounts: number;
  disposals: number;
  activeEngines: number;
  activeAnimationFrames: number;
  activeListeners: number;
  activeObservers: number;
  liveGeometries: number;
  liveMaterials: number;
  liveTextures: number;
}

export interface ToyWildsEngine {
  dispose(): void;
  resize(): void;
  pause(): void;
  resume(): void;
}

export function mountToyWilds(options: ToyWildsOptions): ToyWildsEngine;
export function readEngineDebug(): ToyWildsDebug;
