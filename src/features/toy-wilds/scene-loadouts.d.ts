export const SCENE_STORAGE: string;
export const LEGACY_STORAGE: string;
export interface LocalSceneAgent { id: string; name: string; lineage: string; createdAt?: string }
export interface SceneProfiles {
  version: 4;
  agents: LocalSceneAgent[];
  selectedAgentRef: string;
  sceneLoadouts: Record<string, string[]>;
  legacySkillIds: Record<string, string[]>;
}
export function migrateSceneProfiles(current: unknown, legacy: unknown, createFirst: () => LocalSceneAgent): SceneProfiles;
export function projectSceneSkillIds(scenes: { id: string; skillIds: string[] }[] | null | undefined, sceneIds: string[]): string[];

export function isSceneProfileRecord(raw: unknown): boolean;
