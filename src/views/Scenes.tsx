import { useEffect, useMemo, useState } from "react";
import { Bot, Check, ChevronRight, CircleAlert, Loader2, Pencil, Plus, Search, Sparkles } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { useApp } from "../context/AppContext";
import { getErrorMessage } from "../lib/error";
import * as api from "../lib/skillScenes";
import { useTranslation } from "react-i18next";
import { SceneCapabilityGuide } from "../components/SceneCapabilityGuide";
import { SceneGoalComposer } from "../components/SceneGoalComposer";
import { useSceneCapabilityGroups } from "../hooks/useSceneCapabilityGroups";
import { cn } from "../utils";

import { ScenePortal } from "../features/portal/ScenePortal";

function StatusPill({ label, tone }: { label: string; tone: "amber" | "red" | "slate" }) {
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", tone === "red" ? "bg-red-500/10 text-red-500" : tone === "amber" ? "bg-amber-500/10 text-amber-500" : "bg-surface-active text-muted")}>{label}</span>;
}

function skillByIdName(skills: Array<{ id: string; name: string }>, skillId: string) {
  return skills.find((skill) => skill.id === skillId)?.name ?? skillId;
}

export function Scenes() {
  const { t } = useTranslation();
  const { managedSkills, openSkillDetailById } = useApp();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [overview, setOverview] = useState<api.SceneOverview | null>(null);
  const [agents, setAgents] = useState<api.SceneAgentCapability[]>([]);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probingAgents, setProbingAgents] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "priority" | "pending" | "unknown" | "error">("all");
  const [page, setPage] = useState(0);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [sceneName, setSceneName] = useState("");
  const [sceneDescription, setSceneDescription] = useState("");
  const [editingScene, setEditingScene] = useState<string | null>(null);
  const [sceneFormOpen, setSceneFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sceneSearch, setSceneSearch] = useState("");
  const [showSkillTools, setShowSkillTools] = useState(false);
  const { groups, loadError: combinationLoadError } = useSceneCapabilityGroups(overview, managedSkills);

  const refresh = async (silent = false) => {
    if (!silent) setLoading(true);
    try { setOverview(await api.getSceneOverview()); }
    catch (error) {
      if (silent) console.warn("Scene metadata refresh skipped:", error);
      else toast.error(getErrorMessage(error, "无法加载场景组织"));
    }
    finally { if (!silent) setLoading(false); }
  };
  const refreshAgentCapabilities = async () => {
    setProbingAgents(true);
    try {
      const detected = await api.getSceneAgentCapabilities();
      setAgents(detected);
      setProbeError(null);
    } catch (error) {
      setAgents([]);
      setProbeError(getErrorMessage(error, "无法调用 Agent 检测命令"));
    } finally {
      setProbingAgents(false);
    }
  };
  useEffect(() => {
    void refresh(); void refreshAgentCapabilities();
    const interval = window.setInterval(() => { void refresh(true); }, 15_000);
    const onScenesChanged = () => { void refresh(true); };
    window.addEventListener(api.SKILL_SCENES_CHANGED_EVENT, onScenesChanged);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(api.SKILL_SCENES_CHANGED_EVENT, onScenesChanged);
    };
  }, []);
  const availableAgents = agents.filter((agent) => agent.available);
  const preferredAgent = availableAgents.find((agent) => agent.key === overview?.preferredAgent)?.key ?? availableAgents[0]?.key ?? "";
  const classifierModel = preferredAgent === "codex" ? "Codex · gpt-5.6-luna" : preferredAgent === "claude_code" ? "Claude · Haiku" : preferredAgent === "hermes" ? "Hermes" : "选择 Agent";
  const sceneById = useMemo(() => new Map((overview?.scenes ?? []).map((scene) => [scene.id, scene])), [overview]);
  const requestedSceneId = searchParams.get("scene");
  const selectedScene = requestedSceneId && sceneById.has(requestedSceneId) ? requestedSceneId : null;
  const activeScene = selectedScene ? sceneById.get(selectedScene) ?? null : null;
  const missingScene = !!overview && !!requestedSceneId && !activeScene;
  const priorityIds = useMemo(() => new Set(overview?.prioritySkillIds ?? []), [overview?.prioritySkillIds]);
  const classifiedIds = useMemo(() => new Set(overview?.classifiedSkillIds ?? []), [overview?.classifiedSkillIds]);
  const priorityClassified = (overview?.prioritySkillIds ?? []).filter((id) => classifiedIds.has(id)).length;
  const priorityUnrecognized = (overview?.prioritySkillIds.length ?? 0) - priorityClassified;
  const selectScene = (sceneId: string | null) => {
    const next = new URLSearchParams(searchParams);
    next.delete("capability");
    if (sceneId) next.set("scene", sceneId);
    else next.delete("scene");
    setSearchParams(next);
  };
  const activeGroup = activeScene ? groups.get(activeScene.id) : undefined;
  const requestedCapabilityId = searchParams.get("capability");
  const selectedCapabilityId = activeGroup?.capabilities.some((item) => item.id === requestedCapabilityId) ? requestedCapabilityId : null;
  const selectCapability = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("capability", id); else next.delete("capability");
    setSearchParams(next);
  };
  const sceneResults = (overview?.scenes ?? []).filter((scene) => {
    const query = sceneSearch.trim().toLowerCase();
    const group = groups.get(scene.id);
    const names = managedSkills.filter((skill) => group?.skillIds.includes(skill.id)).map((skill) => skill.name).join(" ");
    return !query || `${scene.name} ${scene.description} ${names}`.toLowerCase().includes(query);
  }).sort((a, b) => {
    const hasPriority = (id: string) => groups.get(id)?.skillIds.some((skillId) => priorityIds.has(skillId)) ? 1 : 0;
    return hasPriority(b.id) - hasPriority(a.id) || a.name.localeCompare(b.name, "zh-CN");
  });
  const visibleSkills = useMemo(() => {
    if (!overview || missingScene) return [];
    const query = search.trim().toLowerCase();
    return managedSkills.filter((skill) => {
      const memberships = overview.assignments[skill.id] ?? [];
      if (selectedScene && !memberships.some((membership) => membership.sceneId === selectedScene)) return false;
      if (statusFilter === "priority" && !priorityIds.has(skill.id)) return false;
      if (statusFilter === "pending" && !overview.pendingSkillIds.includes(skill.id)) return false;
      if (statusFilter === "unknown" && !overview.unknownSkillIds.includes(skill.id)) return false;
      if (statusFilter === "error" && !overview.errorSkillIds.includes(skill.id)) return false;
      return !query || `${skill.name} ${skill.description ?? ""} ${memberships.map((membership) => sceneById.get(membership.sceneId)?.name ?? "").join(" ")}`.toLowerCase().includes(query);
    }).sort((left, right) => Number(priorityIds.has(right.id)) - Number(priorityIds.has(left.id)));
  }, [managedSkills, overview, sceneById, search, selectedScene, statusFilter, missingScene, priorityIds]);
  const pagedSkills = visibleSkills.slice(page * 50, page * 50 + 50);
  useEffect(() => { setPage(0); }, [search, selectedScene, statusFilter]);
  useEffect(() => {
    setShowSkillTools(false); setSearch(""); setStatusFilter("all"); setEditingSkillId(null); setSceneFormOpen(false);
  }, [selectedScene]);

  const runClassification = async () => {
    if (!preferredAgent) { toast.error("没有可用的 Agent；请先安装 Codex、Claude Code 或 Hermes。"); return; }
    setRunning(true);
    const progressTimer = window.setInterval(() => { void refresh(true); }, 2_000);
    try {
      const result = await api.classifySkillScenes(preferredAgent);
      toast.success(`已归类 ${result.appliedSkillIds.length} 个 Skill；未知 ${result.unknownSkillIds.length}，失败 ${result.errorSkillIds.length}`);
      await refresh();
    } catch (error) { toast.error(getErrorMessage(error, "场景归类失败")); }
    finally { window.clearInterval(progressTimer); setRunning(false); }
  };
  const savePreferences = async (auto: boolean, agent = (overview?.preferredAgent ?? preferredAgent) || null) => {
    if (!overview) return;
    try { await api.setSkillScenePreferences(auto, agent || null); await refresh(); }
    catch (error) { toast.error(getErrorMessage(error, "无法保存自动分类设置")); }
  };
  const saveScene = async () => {
    if (!sceneName.trim()) return;
    setSaving(true);
    try {
      const saved = await api.upsertSkillScene(editingScene, sceneName.trim(), sceneDescription.trim());
      setSceneName(""); setSceneDescription(""); setEditingScene(null); setSceneFormOpen(false); await refresh(); selectScene(saved.id);
    } catch (error) { toast.error(getErrorMessage(error, "无法保存场景")); }
    finally { setSaving(false); }
  };
  const toggleMembership = async (skillId: string, sceneId: string, currentlyAssigned: boolean) => {
    try { await api.setSkillSceneAssignment(skillId, sceneId, !currentlyAssigned, !currentlyAssigned ? "用户手动归入此场景" : undefined); await refresh(); }
    catch (error) { toast.error(getErrorMessage(error, "无法保存场景归属")); }
  };
  const togglePriority = async (skillId: string, priority: boolean) => {
    try { await api.setSkillScenePriorities([skillId], priority); await refresh(); }
    catch (error) { toast.error(getErrorMessage(error, "无法保存优先识别设置")); }
  };
  const openSkill = (skillId: string) => { openSkillDetailById(skillId); navigate("/my-skills"); };

  if (loading && !overview) return <div className="app-page flex min-h-[280px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-accent" /></div>;

  return <div className="app-page">
    {activeScene && <nav aria-label="当前位置" className="mb-5 flex items-center gap-2 text-[12px] text-muted"><button type="button" className="hover:text-primary" onClick={() => selectScene(null)}>使用场景</button><ChevronRight className="h-3.5 w-3.5" /><span className="text-primary">{activeScene.name}</span></nav>}
    <header className="app-page-header flex flex-wrap items-start justify-between gap-4 pb-5">
      <div><h1 className="app-page-title">{activeScene?.name ?? "使用场景"}</h1>{!activeScene && <p className="mt-2 max-w-[680px] text-[13px] leading-6 text-muted">从你要完成的工作出发，找到能配合使用的能力。选择场景，了解怎样做、用哪些 Skill，以及何时完成。</p>}</div>
      <div className="flex gap-2">{activeScene && <button type="button" className="app-button-secondary h-8" onClick={() => { setEditingScene(activeScene.id); setSceneName(activeScene.name); setSceneDescription(activeScene.description); setSceneFormOpen(true); }}><Pencil className="h-3.5 w-3.5" />编辑场景</button>}<button type="button" className="app-button-secondary h-8" onClick={() => { setEditingScene(null); setSceneName(""); setSceneDescription(""); setSceneFormOpen(true); }}><Plus className="h-3.5 w-3.5" />新建场景</button></div>
    </header>
    <ScenePortal sceneId={activeScene?.id ?? null} sceneName={activeScene?.name ?? "使用场景"} />
    {sceneFormOpen && <form onSubmit={(event) => { event.preventDefault(); void saveScene(); }} className="app-panel mb-5 grid gap-3 p-4"><label className="text-[12px] text-muted">场景名称<input required className="app-input mt-1.5 w-full" value={sceneName} onChange={(event) => setSceneName(event.target.value)} placeholder="例如：商业项目推演" /></label><label className="text-[12px] text-muted">要完成什么<textarea className="app-input mt-1.5 w-full" value={sceneDescription} onChange={(event) => setSceneDescription(event.target.value)} placeholder="描述这个场景的目标与期望结果" /></label><div className="flex gap-2"><button type="submit" className="app-button-primary h-8" disabled={saving || !sceneName.trim()}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}保存</button><button type="button" className="app-button-secondary h-8" onClick={() => setSceneFormOpen(false)}>取消</button></div></form>}
    {missingScene && <section className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4"><h2 className="text-[13px] font-semibold text-primary">这个使用场景已不存在</h2><p className="mt-1 text-[12px] text-muted">当前库中找不到这个场景。返回全库可以继续浏览已有场景。</p><button type="button" className="app-button-secondary mt-3 h-8" onClick={() => selectScene(null)}>返回全部场景</button></section>}

    {combinationLoadError && <p role="alert" className="mb-4 text-[12px] text-amber-500">组合设置加载失败，当前展示基础能力。<button type="button" className="ml-2 underline" onClick={() => window.dispatchEvent(new Event("scene-combinations-changed"))}>重试</button></p>}
    {activeScene && activeGroup && <>
      {requestedCapabilityId && !selectedCapabilityId && <p role="status" className="mb-4 text-[12px] text-muted">这个能力已调整，下面显示当前场景的完整组合。<button type="button" className="ml-2 underline" onClick={() => selectCapability(null)}>清除旧选择</button></p>}
      <SceneCapabilityGuide scene={activeScene} group={activeGroup} managedSkills={managedSkills} selectedCapabilityId={selectedCapabilityId} onSelectCapability={selectCapability} onOpenSkill={openSkill} />
      <SceneGoalComposer key={activeScene.id} scene={activeScene} skillIds={activeGroup.skillIds} excludedSkillIds={activeGroup.capabilities.filter((item) => item.excludedFromDeck).flatMap((item) => item.skillIds)} onCreated={(id) => { void refresh(); selectScene(id); }} />
    </>}
    {!activeScene && !missingScene && <>
      <div className="relative mb-5 max-w-xl"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input aria-label="搜索使用场景" className="app-input h-10 w-full pl-9" value={sceneSearch} onChange={(event) => setSceneSearch(event.target.value)} placeholder="想完成什么？也可以搜索 Business Coach 等 Skill" /></div>
      <p className="mb-3 text-[12px] text-muted">{sceneResults.length} 个场景 · 含优先 Skill 的场景排在前面</p>
      <div className="mb-6 grid gap-x-6 sm:grid-cols-2">{sceneResults.map((scene) => {
        const group = groups.get(scene.id);
        const capabilities = group?.capabilities.filter((item) => !item.missing && !item.excludedFromDeck) ?? [];
        const hasPriority = group?.skillIds.some((id) => priorityIds.has(id));
        return <button key={scene.id} type="button" onClick={() => selectScene(scene.id)} className="group border-b border-border-subtle py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <div className="flex items-center gap-2"><h2 className="text-[15px] font-semibold text-primary group-hover:text-accent-light">{scene.name}</h2>{hasPriority && <span className="rounded bg-accent-bg px-1.5 py-0.5 text-[10px] text-accent-light">优先</span>}<ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted" /></div>
          <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-muted">{scene.description || group?.summary || "查看这个场景中的能力与可用 Skill。"}</p>
          {capabilities.length > 1 && <p className="mt-2 truncate text-[12px] text-secondary">{capabilities.map((item) => item.titleKey ? t(item.titleKey) : item.title).join(" · ")}</p>}
          <p className="mt-2 text-[11px] text-faint">{group?.skillIds.length ?? 0} 个 Skill{capabilities.length > 1 ? ` · ${capabilities.length} 项能力` : ""}</p>
        </button>;
      })}</div>
      {sceneResults.length === 0 && <p className="py-8 text-[13px] text-muted">{sceneSearch ? "没有匹配场景。换个工作目标或 Skill 名称搜索。" : "还没有使用场景。新建一个，或在下方整理全库。"}</p>}
      <SceneGoalComposer onCreated={(id) => { void refresh(); selectScene(id); }} />
    </>}

    <details className="app-panel my-5 p-4">
      <summary className="cursor-pointer text-[13px] font-medium text-secondary">整理状态与设置<span className="ml-3 text-[11px] font-normal text-muted">优先识别 {priorityClassified}/{overview?.prioritySkillIds.length ?? 0} · 待归类 {overview?.pendingSkillIds.length ?? 0}{priorityUnrecognized > 0 ? ` · 优先待识别 ${priorityUnrecognized}` : ""}</span></summary>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-[12px] text-muted">{overview?.scenes.length ?? 0} 个场景 · {Object.values(overview?.assignments ?? {}).filter((rows) => rows.length > 0).length} 个 Skill 已归属。手动归属会保留。</p><button type="button" className="app-button-primary h-8" onClick={runClassification} disabled={running || !preferredAgent}>{running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{running ? "正在分批归类…" : "AI 整理全库"}</button></div>
    <section className="mb-4 app-panel p-3.5">
      <div className="flex flex-wrap items-center gap-3"><Bot className="h-4 w-4 text-accent" /><span className="text-[12px] font-medium text-primary">增量自动归类</span><ToggleSwitch checked={overview?.autoClassifyEnabled ?? false} onChange={() => void savePreferences(!(overview?.autoClassifyEnabled ?? false))} /><select className="app-input h-8 w-auto max-w-[260px] text-[12px]" value={preferredAgent} onChange={(event) => void savePreferences(overview?.autoClassifyEnabled ?? false, event.target.value || null)}><option value="">选择 Agent</option>{availableAgents.map((agent) => <option key={agent.key} value={agent.key}>{agent.display_name}</option>)}</select><button type="button" className="app-button-secondary h-8 text-[11px]" disabled={probingAgents} onClick={() => void refreshAgentCapabilities()}>{probingAgents && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{probingAgents ? "检测中" : "重新检测"}</button><span className="rounded bg-accent-bg px-1.5 py-0.5 text-[10px] text-accent-light">轻量分类：{classifierModel}</span><span className="text-[11px] text-muted">仅在 App 运行时处理新/变更项；失败项不会自动重试。</span></div>
      {probeError && <p className="mt-2 text-[11px] text-red-500">Agent 检测命令失败：{probeError}</p>}
      {!probingAgents && !probeError && availableAgents.length === 0 && <p className="mt-2 text-[11px] text-amber-500">没有检测到可用 Agent。点击“重新检测”后可查看每个 CLI 的具体原因。</p>}
      {!probingAgents && availableAgents.length === 0 && agents.length > 0 && <div className="mt-2 grid gap-1 text-[11px] text-red-500">{agents.map((agent) => <div key={agent.key}><span className="mr-2 font-medium">{agent.display_name}</span><span>{agent.reason || "不可用，未返回原因"}</span></div>)}</div>}
    </section>

    </details>
    <details className="my-5" open={showSkillTools} onToggle={(event) => setShowSkillTools(event.currentTarget.open)}>
      <summary className="mb-3 cursor-pointer text-[13px] font-medium text-secondary">{activeScene ? "查看与调整场景中的 Skill" : "查看全库识别结果与手动归属"}<span className="ml-2 text-[11px] font-normal text-muted">{activeScene ? `${activeGroup?.skillIds.length ?? 0} 个 Skill` : `未知 ${overview?.unknownSkillIds.length ?? 0} · 失败 ${overview?.errorSkillIds.length ?? 0}`}</span></summary>
    <section className="app-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-3.5 py-3"><div className="relative w-full max-w-md"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" /><input className="app-input h-8 w-full pl-8 text-[12px]" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 Skill、说明或场景" /></div><div className="flex flex-wrap gap-1"><button type="button" onClick={() => setStatusFilter("all")} className={cn("rounded px-2 py-1 text-[10px]", statusFilter === "all" ? "bg-accent-bg text-accent-light" : "text-muted")}>全部</button><button type="button" onClick={() => setStatusFilter("priority")} className={cn("rounded px-2 py-1 text-[10px]", statusFilter === "priority" ? "bg-violet-500/10 text-violet-400" : "text-muted")}>优先 {overview?.prioritySkillIds.length ?? 0}</button><button type="button" onClick={() => setStatusFilter("pending")} className={cn("rounded px-2 py-1 text-[10px]", statusFilter === "pending" ? "bg-amber-500/10 text-amber-500" : "text-muted")}>待归类 {overview?.pendingSkillIds.length ?? 0}</button><button type="button" onClick={() => setStatusFilter("unknown")} className={cn("rounded px-2 py-1 text-[10px]", statusFilter === "unknown" ? "bg-surface-active text-primary" : "text-muted")}>未知 {overview?.unknownSkillIds.length ?? 0}</button><button type="button" onClick={() => setStatusFilter("error")} className={cn("rounded px-2 py-1 text-[10px]", statusFilter === "error" ? "bg-red-500/10 text-red-500" : "text-muted")}>失败 {overview?.errorSkillIds.length ?? 0}</button></div><span className="text-[11px] text-muted">显示 {visibleSkills.length} / {managedSkills.length}</span></div>
      <div className="divide-y divide-border-subtle">{pagedSkills.map((skill) => { const memberships = overview?.assignments[skill.id] ?? []; const pending = overview?.pendingSkillIds.includes(skill.id); const unknown = overview?.unknownSkillIds.includes(skill.id); const failed = overview?.errorSkillIds.includes(skill.id); const priority = priorityIds.has(skill.id); return <div key={skill.id} className="p-3.5"><div className="flex items-start gap-3"><button type="button" className="min-w-0 flex-1 text-left" onClick={() => openSkill(skill.id)}><div className="flex items-center gap-2"><h3 className="truncate text-[13px] font-semibold text-primary">{skill.name}</h3><ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />{priority && <StatusPill label="优先识别" tone="slate" />}{pending && <StatusPill label="待归类" tone="amber" />}{unknown && <StatusPill label="未知" tone="slate" />}{failed && <StatusPill label="失败" tone="red" />}</div>{skill.description && <p className="mt-1 line-clamp-1 text-[11px] text-muted">{skill.description}</p>}</button><div className="flex shrink-0 gap-1.5"><button type="button" className={cn("app-button-secondary h-7 text-[10px]", priority && "border-violet-400/40 text-violet-400")} onClick={() => void togglePriority(skill.id, !priority)}>{priority ? "取消优先" : "优先识别"}</button><button type="button" className="app-button-secondary h-7 text-[10px]" onClick={() => setEditingSkillId(editingSkillId === skill.id ? null : skill.id)}>{editingSkillId === skill.id ? "完成" : "编辑归属"}</button></div></div><div className="mt-2.5 flex flex-wrap gap-1.5">{memberships.map((membership) => <span key={membership.sceneId} title={membership.reason} className={cn("rounded border px-2 py-1 text-[10.5px]", membership.source === "user" ? "border-violet-400/35 bg-violet-500/10 text-violet-400" : "border-accent/30 bg-accent-bg/60 text-accent-light")}>{sceneById.get(membership.sceneId)?.name ?? "已删除场景"}<span className="ml-1 opacity-70">{membership.source === "user" ? "手动" : "AI"}</span></span>)}{memberships.length === 0 && <span className="text-[10.5px] text-faint">尚未归属场景</span>}</div>{editingSkillId === skill.id && <div className="mt-2.5 rounded-lg border border-border-subtle bg-bg-primary p-2.5"><p className="mb-2 text-[10.5px] text-muted">选择这个 Skill 应服务的场景。取消会成为持久的手动排除。</p><div className="flex flex-wrap gap-1.5">{(overview?.scenes ?? []).map((scene) => { const membership = memberships.find((row) => row.sceneId === scene.id); return <button key={scene.id} type="button" onClick={() => void toggleMembership(skill.id, scene.id, !!membership)} className={cn("rounded border px-2 py-1 text-[10.5px]", membership ? "border-accent/30 bg-accent-bg text-accent-light" : "border-border-subtle text-muted hover:text-primary")}>{membership && <Check className="mr-1 inline h-2.5 w-2.5" />}{scene.name}</button>; })}</div></div>}</div>; })}{visibleSkills.length === 0 && <div className="px-4 py-12 text-center text-[12px] text-muted">没有匹配的 Skill。</div>}</div>
      {visibleSkills.length > 50 && <div className="flex items-center justify-between border-t border-border-subtle px-3.5 py-2.5 text-[11px] text-muted"><span>第 {page + 1} / {Math.ceil(visibleSkills.length / 50)} 页</span><div className="flex gap-2"><button className="app-button-secondary h-7" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一页</button><button className="app-button-secondary h-7" disabled={(page + 1) * 50 >= visibleSkills.length} onClick={() => setPage((value) => value + 1)}>下一页</button></div></div>}
    </section>
    {(overview?.errorSkillIds.length ?? 0) > 0 && <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-[11px] text-red-500"><div className="flex items-center gap-2"><CircleAlert className="h-3.5 w-3.5" />{overview?.errorSkillIds.length} 个归类失败项仍保留在列表中；修正 Agent 后可手动重试。</div><ul className="mt-2 space-y-1 text-red-400">{Object.entries(overview?.perSkillErrors ?? {}).map(([skillId, error]) => <li key={skillId}><button type="button" className="font-medium underline underline-offset-2" onClick={() => openSkill(skillId)}>{skillByIdName(managedSkills, skillId)}</button><span className="mx-1">—</span>{error}</li>)}</ul></div>}
    </details>
  </div>;
}
