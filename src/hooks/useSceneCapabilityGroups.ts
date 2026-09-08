import { useEffect, useMemo, useState } from "react";
import { getSettings } from "../lib/tauri";
import type { ManagedSkill } from "../lib/tauri";
import type { SceneOverview } from "../lib/skillScenes";
import { buildSceneCapabilities } from "../lib/sceneCapabilities";
import { DECK_OVERRIDES_KEY, type DeckOverride } from "../lib/deckDiscovery";

import { applySceneCustomCombination, loadSceneCustomCombinations, SCENE_COMBINATIONS_CHANGED_EVENT, type SceneCustomCombination } from "../lib/sceneCustomCombinations";

export function useSceneCapabilityGroups(overview: SceneOverview | null, skills: ManagedSkill[]) {
  const [overrides, setOverrides] = useState<Record<string, DeckOverride>>({});
  const [combinations, setCombinations] = useState<SceneCustomCombination[]>([]);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const [raw, saved] = await Promise.all([getSettings(DECK_OVERRIDES_KEY), loadSceneCustomCombinations()]);
        const parsed = raw ? JSON.parse(raw) : {};
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Invalid combinations");
        for (const value of Object.values(parsed)) {
          const row = value as DeckOverride;
          if (!Array.isArray(row?.removedSkillIds) || !row.removedSkillIds.every((id) => typeof id === "string")
            || !Array.isArray(row?.addedSkills) || !row.addedSkills.every((item) => item && typeof item.skillId === "string" && typeof item.stageId === "string")) throw new Error("Invalid combination");
        }
        if (!cancelled) { setOverrides(parsed); setCombinations(saved); setLoadError(false); }
      } catch { if (!cancelled) setLoadError(true); }
    };
    void refresh();
    window.addEventListener(SCENE_COMBINATIONS_CHANGED_EVENT, refresh);
    return () => { cancelled = true; window.removeEventListener(SCENE_COMBINATIONS_CHANGED_EVENT, refresh); };
  }, []);
  const groups = useMemo(() => new Map((overview?.scenes ?? []).map((scene) => [scene.id,
    applySceneCustomCombination(buildSceneCapabilities(scene, skills, overview?.assignments ?? {}, overrides), combinations, skills, overview?.assignments ?? {}),
  ])), [overview, skills, overrides, combinations]);
  return { groups, loadError };
}
