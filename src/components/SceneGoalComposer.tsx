import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import * as api from "../lib/tauri";
import type { OrganizationAgentCapability } from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import type { SkillScene } from "../lib/skillScenes";
import {
  groupCombinationCards, loadSceneCustomCombinations, saveCombinationAsScene,
  removeSkillFromCombination, restoreSkillToCombination, latestSceneCustomCombination, sceneCombinationExcludedSkillIds,
  SCENE_COMBINATIONS_CHANGED_EVENT, type SceneCustomCombination,
} from "../lib/sceneCustomCombinations";

export function SceneGoalComposer({ onCreated, scene, skillIds, excludedSkillIds = [] }: {
  onCreated: (sceneId: string) => void;
  scene?: SkillScene;
  skillIds?: string[];
  excludedSkillIds?: string[];
}) {
  const { managedSkills } = useApp();
  const [goal, setGoal] = useState(scene ? `围绕「${scene.name}」，组织清楚各项能力如何配合。${scene.description}` : "");
  const [agents, setAgents] = useState<OrganizationAgentCapability[]>([]);
  const [agentKey, setAgentKey] = useState("");
  const [plans, setPlans] = useState<SceneCustomCombination[]>([]);
  const [plan, setPlan] = useState<SceneCustomCombination | null>(null);
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [loadError, setLoadError] = useState("");
  const [agentError, setAgentError] = useState("");
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const planRef = useRef<SceneCustomCombination | null>(null);
  const mounted = useRef(true);
  const skillsRef = useRef(managedSkills);
  skillsRef.current = managedSkills;
  const scopeRef = useRef({ scene, skillIds, excludedSkillIds });
  scopeRef.current = { scene, skillIds, excludedSkillIds };
  const skillNames = useMemo(() => new Map(managedSkills.map((skill) => [skill.id, skill.name])), [managedSkills]);
  const pendingPlans = plans.filter((row) => scene ? row.sceneId === scene.id && row.sceneImportStatus === "pending" : !row.sceneId || row.sceneImportStatus === "pending");
  const stages = useMemo(() => groupCombinationCards(plan?.cards ?? []), [plan]);
  const allowed = new Set(scene ? skillIds ?? [] : managedSkills.map((skill) => skill.id));
  const unavailable = plan?.cards.filter((card) => !skillNames.has(card.skill_id) || !allowed.has(card.skill_id)).length ?? 0;
  const effectiveExcluded = sceneCombinationExcludedSkillIds(scene?.id, plans, excludedSkillIds, plan ?? undefined)
    .filter((id) => allowed.has(id) && skillNames.has(id));
  const canSaveOnlyExclusions = !!plan?.sceneId && plan.sceneSaveMode !== "new-scene-import"
    && [...(plan.excludedSkillIds ?? []), ...(plan.restoredSkillIds ?? [])].some((id) => allowed.has(id));
  const resumeLocked = plan?.sceneImportStatus === "pending" && !!plan.sceneId;
  const selectPlan = (value: SceneCustomCombination | null) => { planRef.current = value; setPlan(value); setError(""); };
  const restoreSkill = (skillId: string) => {
    let current = planRef.current;
    if (!current && scene) {
      const previous = latestSceneCustomCombination(scene.id, plans);
      current = {
        ...(previous ?? { title: scene.name, summary: scene.description, goal, cards: [], gaps: [] }),
        id: `custom-${crypto.randomUUID()}`, createdAt: Date.now(), sceneId: scene.id,
        sceneSaveMode: "existing-scene", sceneImportStatus: undefined,
        excludedSkillIds: effectiveExcluded,
        restoredSkillIds: previous?.restoredSkillIds ?? [],
      };
    }
    if (current) selectPlan(restoreSkillToCombination(current, skillId));
  };
  const renameStage = (oldTitle: string, nextTitle: string) => {
    const current = planRef.current;
    if (!current || nextTitle === oldTitle) return true;
    if (groupCombinationCards(current.cards).some((item) => item.title === nextTitle)) {
      setError("已有同名能力，请使用不同名称，避免混淆两项能力的分工。");
      return false;
    }
    selectPlan({ ...current,
      cards: current.cards.map((card) => (card.stage.trim() || "共同完成目标") === oldTitle ? { ...card, stage: nextTitle } : card),
      stages: current.stages?.map((item) => item.name.trim() === oldTitle ? { ...item, name: nextTitle } : item),
    });
    return true;
  };

  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      void loadSceneCustomCombinations().then((rows) => {
        if (mounted.current) { setPlans(rows); setLoadError(""); }
      }).catch((cause) => { if (mounted.current) setLoadError(getErrorMessage(cause, "无法读取已有组合，恢复读取后再保存。")); });
    };
    refresh();
    void api.getOrganizationAgentCapabilities().then((rows) => {
      if (!mounted.current) return;
      const available = rows.filter((row) => row.available);
      setAgents(available);
      setAgentKey(available.find((row) => row.key === "codex")?.key ?? available[0]?.key ?? "");
    }).catch((cause) => { if (mounted.current) setAgentError(getErrorMessage(cause, "无法检查可用助手。")); });
    window.addEventListener(SCENE_COMBINATIONS_CHANGED_EVENT, refresh);
    return () => { mounted.current = false; window.removeEventListener(SCENE_COMBINATIONS_CHANGED_EVENT, refresh); };
  }, []);

  const generate = async () => {
    if (busyRef.current || !agentKey || goal.trim().length < 8) return;
    if (planRef.current?.sceneImportStatus === "pending" && planRef.current.sceneId) {
      setError("请先继续保存当前方案，完成后再生成新组合。");
      return;
    }
    busyRef.current = true; setBusy("generate"); setError("");
    const submittedGoal = goal.trim();
    const targetScene = scene;
    try {
      const savedPlans = await loadSceneCustomCombinations();
      const pending = savedPlans.find((row) => row.id === planRef.current?.id);
      if (pending?.sceneImportStatus === "pending" && pending.sceneId) {
        selectPlan(pending);
        throw new Error("请先继续保存当前方案，完成后再生成新组合。");
      }
      const snapshot = planRef.current ?? latestSceneCustomCombination(targetScene?.id, savedPlans);
      const restoredSkillIds = snapshot?.restoredSkillIds ?? [];
      const exclusions = sceneCombinationExcludedSkillIds(targetScene?.id, savedPlans, scopeRef.current.excludedSkillIds, snapshot);
      const excluded = new Set(exclusions);
      const scopeIds = targetScene ? skillIds ?? [] : exclusions.length ? skillsRef.current.map((skill) => skill.id) : undefined;
      const eligibleIds = scopeIds?.filter((id) => !excluded.has(id));
      if (eligibleIds?.length === 0) throw new Error("所有 Skill 都已从组合排除，请先从下方列表恢复需要的 Skill。");
      const suggestion = await api.suggestDeckFromLibrary(submittedGoal, agentKey, eligibleIds);
      if (!mounted.current) return;
      if (scopeRef.current.scene?.id !== targetScene?.id) return;
      if (suggestion.cards.some((card) => excluded.has(card.skill_id)
        || (scopeRef.current.excludedSkillIds.includes(card.skill_id) && !restoredSkillIds.includes(card.skill_id))
        || (targetScene && !scopeRef.current.skillIds?.includes(card.skill_id)))) {
        throw new Error("场景中的 Skill 已变化，请重新生成当前场景的分工。");
      }
      selectPlan({ ...suggestion, id: `custom-${crypto.randomUUID()}`, title: [...suggestion.title.replace(/[\r\n]+/g, " ")].slice(0, 80).join(""), summary: [...suggestion.summary].slice(0, 400).join(""), goal: submittedGoal, createdAt: Date.now(), excludedSkillIds: exclusions, restoredSkillIds, sceneSaveMode: targetScene ? "existing-scene" : "new-scene-import", ...(targetScene ? { sceneId: targetScene.id } : {}) });
    } catch (cause) { if (mounted.current) setError(getErrorMessage(cause, "组合建议未生成，请重试。")); }
    finally { busyRef.current = false; if (mounted.current) setBusy(null); }
  };

  const save = async () => {
    if (busyRef.current || !planRef.current) return;
    busyRef.current = true; setBusy("save"); setError("");
    try {
      const scope = scopeRef.current;
      const currentIds = skillsRef.current.filter((skill) => !scope.scene || scope.skillIds?.includes(skill.id)).map((skill) => skill.id);
      const currentPlan = { ...planRef.current, excludedSkillIds: [...new Set([
        ...(planRef.current.excludedSkillIds ?? []), ...scope.excludedSkillIds,
      ])].filter((id) => !planRef.current?.restoredSkillIds?.includes(id)) };
      const saved = await saveCombinationAsScene(currentPlan, currentIds, (progress) => {
        planRef.current = progress;
        if (mounted.current) setPlan(progress);
      });
      if (mounted.current) {
        selectPlan(null); if (!scope.scene) setGoal("");
        toast.success(scope.scene ? "已保存此场景的能力分工" : "已保存使用场景和确认的 Skill 组合");
        onCreated(saved.sceneId!);
      }
    } catch (cause) {
      if (mounted.current) setError(`${getErrorMessage(cause, "保存未完成。")}${planRef.current?.sceneId ? " 已创建的场景会保留，重试会继续完成同一场景。" : " 方案已保留时，可从已有方案继续。"}`);
    } finally { busyRef.current = false; if (mounted.current) setBusy(null); }
  };

  return (
    <details className="app-panel overflow-hidden">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-primary">
        <span className="ml-1">{scene ? "整理这个场景的能力分工" : "描述目标，组织一个场景"}</span>
      </summary>
      <div className="border-t border-border-subtle p-4">
        <p className="max-w-2xl text-sm leading-6 text-muted">{scene ? "助手会根据这个场景已有的 Skill，组织各项能力的分工，解释它们怎样配合。先看建议，再保存；没有纳入组合的 Skill 仍保留在此场景。" : "说明你要完成的工作。助手会从技能库中挑选合适的 Skill，解释它们如何配合；先看方案，再保存为使用场景。"}</p>
        <label className="mt-4 block text-sm font-medium text-secondary" htmlFor="scene-goal">这次想完成什么？</label>
        <textarea id="scene-goal" value={goal} disabled={busy !== null || resumeLocked} onChange={(event) => setGoal(event.target.value)} maxLength={2000} placeholder="例如：验证一个新业务机会，把访谈与数据整理成可执行的决策。" className="app-input mt-2 min-h-24 w-full resize-y px-3 py-2 text-sm leading-6" />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="scene-goal-agent">用于组织场景的助手</label>
          <select id="scene-goal-agent" className="app-input h-9 text-sm" value={agentKey} onChange={(event) => setAgentKey(event.target.value)} disabled={busy !== null || resumeLocked || !agents.length}>
            {!agents.length && <option value="">暂无可用助手</option>}
            {agents.map((agent) => <option key={agent.key} value={agent.key}>{agent.display_name}{agent.key === "codex" ? " · GPT-5.6 Luna" : ""}</option>)}
          </select>
          <button type="button" className="app-button-primary" disabled={busy !== null || resumeLocked || !agentKey || goal.trim().length < 8 || (!!scene && !skillIds?.length)} onClick={() => void generate()}>
            {busy === "generate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy === "generate" ? "正在组织能力…" : "生成组合建议"}
          </button>
          <span className="text-xs text-muted">{resumeLocked ? "先继续保存当前方案，完成后再生成新组合" : scene && !skillIds?.length ? "先把 Skill 加入此场景，再组织能力" : "目标至少 8 个字"}</span>
        </div>
        {agentError && <p role="alert" className="mt-3 text-sm text-danger">{agentError}</p>}
        {loadError && <div role="alert" className="mt-3 text-sm text-danger">{loadError}<button type="button" className="ml-2 underline" onClick={() => window.dispatchEvent(new CustomEvent(SCENE_COMBINATIONS_CHANGED_EVENT))}>重新读取</button></div>}
        {effectiveExcluded.length > 0 && <details className="mt-4 border-t border-border-subtle pt-3">
          <summary className="cursor-pointer text-sm text-secondary">已从组合中排除的 Skill（{effectiveExcluded.length}）</summary>
          <p className="mt-2 text-xs leading-6 text-muted">恢复只调整组合；保存后生效，场景归属保持不变。</p>
          <ul className="mt-2 space-y-2">{effectiveExcluded.map((id) => <li key={id} className="flex items-center justify-between gap-3 text-sm text-secondary">
            <span>{skillNames.get(id)}</span><button type="button" disabled={busy !== null || resumeLocked || !!loadError} className="app-button-secondary" onClick={() => restoreSkill(id)}>恢复到组合</button>
          </li>)}</ul>
        </details>}
        {pendingPlans.length > 0 && <details className="mt-4 border-t border-border-subtle pt-3">
          <summary className="cursor-pointer text-sm text-secondary">继续已有方案（{pendingPlans.length}）</summary>
          <div className="mt-2 flex flex-wrap gap-2">{pendingPlans.map((item) => <button type="button" disabled={busy !== null} key={item.id} className="app-button-secondary" onClick={() => selectPlan(item)}>{item.title}{item.sceneImportStatus === "pending" ? " · 待完成" : ""}</button>)}</div>
        </details>}
        {plan && <section className="mt-5 border-t border-border-subtle pt-4" aria-label="场景组合预览">
          <p className="text-xs font-medium text-accent-light">组合预览</p>
          <label className="mt-2 block text-xs text-muted" htmlFor="scene-plan-title">{scene ? "组合名称" : "场景名称"}</label>
          <input id="scene-plan-title" className="app-input mt-1 w-full text-base font-semibold" maxLength={80} value={plan.title} disabled={busy !== null || resumeLocked} onChange={(event) => selectPlan({ ...plan, title: event.target.value })} />
          <p className="mt-2 text-sm leading-6 text-secondary">{plan.summary}</p>
          <ol className="mt-4 space-y-4">{stages.map((stage, index) => {
            const explanation = plan.stages?.find((item) => item.name.trim() === stage.title);
            return <li key={stage.title} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-bg text-xs font-semibold text-accent-light">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor={`scene-plan-stage-${index}`}>第 {index + 1} 项能力名称</label>
              <input id={`scene-plan-stage-${index}`} className="app-input w-full text-sm font-semibold" defaultValue={stage.title} disabled={busy !== null || resumeLocked} onBlur={(event) => { const title = event.target.value.trim() || stage.title; event.target.value = renameStage(stage.title, title) ? title : stage.title; }} />
              <p className="mt-2 text-sm leading-6 text-secondary">{explanation?.purpose || [...new Set(stage.cards.map((card) => card.role).filter(Boolean))].join("；")}</p>
              {explanation?.handoff && <p className="mt-1 text-sm leading-6 text-muted"><span className="text-secondary">如何配合：</span>{explanation.handoff}</p>}
              {explanation?.done_when && <p className="mt-1 text-sm leading-6 text-muted"><span className="text-secondary">完成标准：</span>{explanation.done_when}</p>}
              <details className="mt-2"><summary className="cursor-pointer text-xs text-muted">采用 {stage.cards.length} 项 Skill，可展开调整</summary>
              <ul className="mt-2 space-y-2">{stage.cards.map((card, cardIndex) => <li key={`${card.skill_id}:${cardIndex}`} className="text-sm leading-6 text-secondary"><span className="font-medium">{card.role}</span>{card.reason && <>：{card.reason}</>}<span className="ml-2 text-xs text-muted">{skillNames.get(card.skill_id) ?? "Skill 已不在当前库"}</span>
                {!resumeLocked && <button type="button" disabled={busy !== null} className="ml-2 text-xs text-muted underline hover:text-primary" aria-label={`从组合移除 ${skillNames.get(card.skill_id) ?? "此 Skill"}`} onClick={() => selectPlan(removeSkillFromCombination(plan, card.skill_id))}>移除</button>}
              </li>)}</ul></details>
            </div>
          </li>; })}</ol>
          {!!plan.gaps.length && <div className="mt-4 rounded-lg bg-surface-hover p-3"><p className="text-sm font-medium text-secondary">本次组合未覆盖的事项</p><ul className="mt-1 list-inside list-disc space-y-1 text-sm leading-6 text-muted">{plan.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul></div>}
          {!!plan.excludedSkillIds?.length && <p className="mt-3 text-xs leading-6 text-muted">已保留 {plan.excludedSkillIds.length} 项手动排除；重新生成不会把它们加回组合。</p>}
          {!!plan.restoredSkillIds?.length && <p className="mt-3 text-xs leading-6 text-muted">恢复设置将在保存后生效；未指定分工的 Skill 会作为补充能力保留。</p>}
          {unavailable > 0 && <p className="mt-3 text-sm text-warning">{unavailable} 项 Skill 已不在{scene ? "当前场景" : "当前库"}，保存时仅使用仍可用的 Skill。</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="app-button-primary" disabled={busy !== null || !!loadError || !plan.title.trim() || (plan.cards.length === unavailable && !canSaveOnlyExclusions)} onClick={() => void save()}>{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}{busy === "save" ? "正在保存…" : plan.sceneImportStatus === "pending" ? "继续完成保存" : scene ? "保存此场景的能力分工" : "保存为使用场景"}</button>
            <button type="button" className="app-button-secondary" disabled={busy !== null} onClick={() => selectPlan(null)}>收起预览</button>
          </div>
        </section>}
        {error && <p role="alert" className="mt-3 text-sm leading-6 text-danger">{error}</p>}
      </div>
    </details>
  );
}
