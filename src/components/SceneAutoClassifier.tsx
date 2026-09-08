import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import * as scenes from "../lib/skillScenes";

/**
 * Runtime-only incremental classification. It sends only current pending ids,
 * records an attempt before invoking, and never retries backend error ids.
 */
export function SceneAutoClassifier() {
  const { managedSkills, loading } = useApp();
  const attemptedRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  const rerunRef = useRef(false);
  const managedSkillsRef = useRef(managedSkills);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => { managedSkillsRef.current = managedSkills; }, [managedSkills]);

  const managedRevisionSignature = managedSkills.map((skill) => `${skill.id}:${skill.content_hash ?? skill.updated_at}`).sort().join("|");
  useEffect(() => {
    if (loading || managedSkills.length === 0) return;
    let cancelled = false;
    const attempt = async () => {
      if (runningRef.current) { rerunRef.current = true; return; }
      try {
        const overview = await scenes.getSceneOverview();
        if (cancelled || !overview.autoClassifyEnabled || !overview.preferredAgent || overview.pendingSkillIds.length === 0) return;
        const signature = overview.pendingSkillIds
          .slice()
          .sort()
          .map((id) => {
            const skill = managedSkillsRef.current.find((candidate) => candidate.id === id);
            return `${id}:${skill?.content_hash ?? skill?.updated_at ?? "missing"}:${overview.prioritySkillIds.includes(id) ? "priority" : "regular"}`;
          })
          .join("|");
        if (attemptedRef.current === signature) return;
        attemptedRef.current = signature;
        runningRef.current = true;
        await scenes.classifySkillScenes(overview.preferredAgent, overview.pendingSkillIds);
      } catch (error) {
        console.warn("Incremental scene classification skipped:", error);
      } finally {
        runningRef.current = false;
        if (rerunRef.current) {
          rerunRef.current = false;
          // A newer managed-library revision arrived while this batch was
          // running. Re-enter through the current effect, not this closure's
          // stale snapshot of managedSkills.
          setRetryTick((value) => value + 1);
        }
      }
    };
    void attempt();
    const onScenesChanged = () => { void attempt(); };
    window.addEventListener(scenes.SKILL_SCENES_CHANGED_EVENT, onScenesChanged);
    const interval = window.setInterval(() => { void attempt(); }, 30_000);
    return () => { cancelled = true; window.clearInterval(interval); window.removeEventListener(scenes.SKILL_SCENES_CHANGED_EVENT, onScenesChanged); };
  }, [loading, managedSkills.length, managedRevisionSignature, retryTick]);

  return null;
}
