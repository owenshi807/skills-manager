import { useEffect, useMemo, useState } from "react";
import { Bot, Check, ChevronRight, CircleAlert, Loader2, Pencil, Plus, Search, Sparkles } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { useApp } from "../context/AppContext";
import { getErrorMessage } from "../lib/error";
import * as api from "../lib/skillScenes";
import { cn } from "../utils";

function StatusPill({ label, tone }: { label: string; tone: "amber" | "red" | "slate" }) {
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", tone === "red" ? "bg-red-500/10 text-red-500" : tone === "amber" ? "bg-amber-500/10 text-amber-500" : "bg-surface-active text-muted")}>{label}</span>;
}

function skillByIdName(skills: Array<{ id: string; name: string }>, skillId: string) {
  return skills.find((skill) => skill.id === skillId)?.name ?? skillId;
}

export function Scenes() {
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
  const classifierModel = preferredAgent === "codex" ? "Codex · gpt-5.4-mini" : preferredAgent === "claude_code" ? "Claude · Haiku" : preferredAgent === "hermes" ? "Hermes" : "选择 Agent";
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
    if (sceneId) next.set("scene", sceneId);
    else next.delete("scene");
    setSearchParams(next);
  };
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
    setSearch(""); setStatusFilter("all"); setEditingSkillId(null); setSceneFormOpen(false);
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
      await api.upsertSkillScene(editingScene, sceneName.trim(), sceneDescription.trim());
      setSceneName(""); setSceneDescription(""); setEditingScene(null); setSceneFormOpen(false); await refresh();
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
    <header className="app-page-header flex flex-wrap items-start justify-between gap-4 pb-4">
      <div><h1 className="app-page-title">{activeScene?.name ?? "使用场景"}</h1><p className="mt-1.5 max-w-[740px] text-[13px] text-muted">{activeScene?.description || (activeScene ? "这个场景中的 Skill 可以共同完成相关工作。你的手动判断会保留。" : "按真实工作目标组织你的 Skill 库，快速找到一组能一起完成任务的能力。一个 Skill 可以服务多个场景；你的手动判断会保留。")}</p></div>
      <button type="button" className="app-button-primary" onClick={runClassification} disabled={running || !preferredAgent}>{running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{running ? "正在分批归类…" : "AI 整理全库"}</button>
    </header>

    {missingScene && <section className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4"><h2 className="text-[13px] font-semibold text-primary">这个使用场景已不存在</h2><p className="mt-1 text-[12px] text-muted">当前库中找不到这个场景。返回全库可以继续浏览已有场景。</p><button type="button" className="app-button-secondary mt-3 h-8" onClick={() => selectScene(null)}>返回全部场景</button></section>}

    <section className="mb-4 grid gap-2 sm:grid-cols-5">
      <div className="app-panel p-3"><p className="text-[20px] font-semibold text-primary">{overview?.scenes.length ?? 0}</p><p className="text-[11px] text-muted">命名场景</p></div>
      <div className="app-panel p-3"><p className="text-[20px] font-semibold text-primary">{Object.values(overview?.assignments ?? {}).filter((rows) => rows.length > 0).length}</p><p className="text-[11px] text-muted">已归属 Skill</p></div>
      <div className="app-panel p-3"><p className="text-[20px] font-semibold text-primary">{priorityClassified}/{overview?.prioritySkillIds.length ?? 0}</p><p className="text-[11px] text-muted">优先识别覆盖</p></div>
      <div className="app-panel p-3"><p className="text-[20px] font-semibold text-amber-500">{overview?.pendingSkillIds.length ?? 0}</p><p className="text-[11px] text-muted">等待增量归类</p></div>
      <div className="app-panel p-3"><p className="text-[20px] font-semibold text-muted">{priorityUnrecognized}</p><p className="text-[11px] text-muted">优先待识别</p></div>
    </section>

    <section className="mb-4 app-panel p-3.5">
      <div className="flex flex-wrap items-center gap-3"><Bot className="h-4 w-4 text-accent" /><span className="text-[12px] font-medium text-primary">增量自动归类</span><ToggleSwitch checked={overview?.autoClassifyEnabled ?? false} onChange={() => void savePreferences(!(overview?.autoClassifyEnabled ?? false))} /><select className="app-input h-8 min-w-[160px] text-[12px]" value={preferredAgent} onChange={(event) => void savePreferences(overview?.autoClassifyEnabled ?? false, event.target.value || null)}><option value="">选择 Agent</option>{availableAgents.map((agent) => <option key={agent.key} value={agent.key}>{agent.display_name}{agent.version ? ` · ${agent.version}` : ""}</option>)}</select><button type="button" className="app-button-secondary h-8 text-[11px]" disabled={probingAgents} onClick={() => void refreshAgentCapabilities()}>{probingAgents && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{probingAgents ? "检测中" : "重新检测"}</button><span className="rounded bg-accent-bg px-1.5 py-0.5 text-[10px] text-accent-light">轻量分类：{classifierModel}</span><span className="text-[11px] text-muted">仅在 App 运行时处理新/变更项；失败项不会自动重试。</span></div>
      {probeError && <p className="mt-2 text-[11px] text-red-500">Agent 检测命令失败：{probeError}</p>}
      {!probeError && availableAgents.length === 0 && <p className="mt-2 text-[11px] text-amber-500">没有检测到可用 Agent。点击“重新检测”后可查看每个 CLI 的具体原因。</p>}
      {agents.length > 0 && <div className="mt-2 grid gap-1 text-[11px]">{agents.map((agent) => <div key={agent.key} className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5", agent.available ? "text-muted" : "text-red-500")}><span className="font-medium">{agent.display_name}</span><span>{agent.available ? `可用${agent.version ? ` · ${agent.version}` : ""}` : `不可用：${agent.reason || "未返回原因"}`}</span></div>)}</div>}
    </section>

    <section className="mb-4 app-panel p-3.5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-[13px] font-semibold text-primary">{activeScene ? "当前场景" : "管理场景"}</h2><p className="mt-0.5 text-[11px] text-muted">{activeScene ? "修改当前场景的名称或说明；左侧面板用于切换场景。" : "从左侧面板选择场景，或创建一个新的工作目标。"}</p></div><div className="flex gap-2">{activeScene && <button type="button" className="app-button-secondary h-8" onClick={() => selectScene(null)}>全部</button>}{activeScene && <button type="button" className="app-button-secondary h-8" onClick={() => { setEditingScene(activeScene.id); setSceneName(activeScene.name); setSceneDescription(activeScene.description); setSceneFormOpen(true); }}><Pencil className="h-3.5 w-3.5" />改名</button>}<button type="button" className="app-button-secondary h-8" onClick={() => { setEditingScene(null); setSceneName(""); setSceneDescription(""); setSceneFormOpen(true); }}><Plus className="h-3.5 w-3.5" />新建场景</button></div></div>
      {sceneFormOpen && <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]"><input className="app-input h-9 text-[12px]" value={sceneName} onChange={(event) => setSceneName(event.target.value)} placeholder="场景名称，例如：产品设计" /><input className="app-input h-9 text-[12px]" value={sceneDescription} onChange={(event) => setSceneDescription(event.target.value)} placeholder="可选说明" /><button type="button" className="app-button-primary h-9" disabled={saving || !sceneName.trim()} onClick={saveScene}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}保存</button></div>}
    </section>

    <section className="app-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-3.5 py-3"><div className="relative w-full max-w-md"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" /><input className="app-input h-8 w-full pl-8 text-[12px]" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 Skill、说明或场景" /></div><div className="flex flex-wrap gap-1"><button type="button" onClick={() => setStatusFilter("all")} className={cn("rounded px-2 py-1 text-[10px]", statusFilter === "all" ? "bg-accent-bg text-accent-light" : "text-muted")}>全部</button><button type="button" onClick={() => setStatusFilter("priority")} className={cn("rounded px-2 py-1 text-[10px]", statusFilter === "priority" ? "bg-violet-500/10 text-violet-400" : "text-muted")}>优先 {overview?.prioritySkillIds.length ?? 0}</button><button type="button" onClick={() => setStatusFilter("pending")} className={cn("rounded px-2 py-1 text-[10px]", statusFilter === "pending" ? "bg-amber-500/10 text-amber-500" : "text-muted")}>待归类 {overview?.pendingSkillIds.length ?? 0}</button><button type="button" onClick={() => setStatusFilter("unknown")} className={cn("rounded px-2 py-1 text-[10px]", statusFilter === "unknown" ? "bg-surface-active text-primary" : "text-muted")}>未知 {overview?.unknownSkillIds.length ?? 0}</button><button type="button" onClick={() => setStatusFilter("error")} className={cn("rounded px-2 py-1 text-[10px]", statusFilter === "error" ? "bg-red-500/10 text-red-500" : "text-muted")}>失败 {overview?.errorSkillIds.length ?? 0}</button></div><span className="text-[11px] text-muted">显示 {visibleSkills.length} / {managedSkills.length}</span></div>
      <div className="divide-y divide-border-subtle">{pagedSkills.map((skill) => { const memberships = overview?.assignments[skill.id] ?? []; const pending = overview?.pendingSkillIds.includes(skill.id); const unknown = overview?.unknownSkillIds.includes(skill.id); const failed = overview?.errorSkillIds.includes(skill.id); const priority = priorityIds.has(skill.id); return <div key={skill.id} className="p-3.5"><div className="flex items-start gap-3"><button type="button" className="min-w-0 flex-1 text-left" onClick={() => openSkill(skill.id)}><div className="flex items-center gap-2"><h3 className="truncate text-[13px] font-semibold text-primary">{skill.name}</h3><ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />{priority && <StatusPill label="优先识别" tone="slate" />}{pending && <StatusPill label="待归类" tone="amber" />}{unknown && <StatusPill label="未知" tone="slate" />}{failed && <StatusPill label="失败" tone="red" />}</div>{skill.description && <p className="mt-1 line-clamp-1 text-[11px] text-muted">{skill.description}</p>}</button><div className="flex shrink-0 gap-1.5"><button type="button" className={cn("app-button-secondary h-7 text-[10px]", priority && "border-violet-400/40 text-violet-400")} onClick={() => void togglePriority(skill.id, !priority)}>{priority ? "取消优先" : "优先识别"}</button><button type="button" className="app-button-secondary h-7 text-[10px]" onClick={() => setEditingSkillId(editingSkillId === skill.id ? null : skill.id)}>{editingSkillId === skill.id ? "完成" : "编辑归属"}</button></div></div><div className="mt-2.5 flex flex-wrap gap-1.5">{memberships.map((membership) => <span key={membership.sceneId} title={membership.reason} className={cn("rounded border px-2 py-1 text-[10.5px]", membership.source === "user" ? "border-violet-400/35 bg-violet-500/10 text-violet-400" : "border-accent/30 bg-accent-bg/60 text-accent-light")}>{sceneById.get(membership.sceneId)?.name ?? "已删除场景"}<span className="ml-1 opacity-70">{membership.source === "user" ? "手动" : "AI"}</span></span>)}{memberships.length === 0 && <span className="text-[10.5px] text-faint">尚未归属场景</span>}</div>{editingSkillId === skill.id && <div className="mt-2.5 rounded-lg border border-border-subtle bg-bg-primary p-2.5"><p className="mb-2 text-[10.5px] text-muted">选择这个 Skill 应服务的场景。取消会成为持久的手动排除。</p><div className="flex flex-wrap gap-1.5">{(overview?.scenes ?? []).map((scene) => { const membership = memberships.find((row) => row.sceneId === scene.id); return <button key={scene.id} type="button" onClick={() => void toggleMembership(skill.id, scene.id, !!membership)} className={cn("rounded border px-2 py-1 text-[10.5px]", membership ? "border-accent/30 bg-accent-bg text-accent-light" : "border-border-subtle text-muted hover:text-primary")}>{membership && <Check className="mr-1 inline h-2.5 w-2.5" />}{scene.name}</button>; })}</div></div>}</div>; })}{visibleSkills.length === 0 && <div className="px-4 py-12 text-center text-[12px] text-muted">没有匹配的 Skill。</div>}</div>
      {visibleSkills.length > 50 && <div className="flex items-center justify-between border-t border-border-subtle px-3.5 py-2.5 text-[11px] text-muted"><span>第 {page + 1} / {Math.ceil(visibleSkills.length / 50)} 页</span><div className="flex gap-2"><button className="app-button-secondary h-7" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一页</button><button className="app-button-secondary h-7" disabled={(page + 1) * 50 >= visibleSkills.length} onClick={() => setPage((value) => value + 1)}>下一页</button></div></div>}
    </section>
    {(overview?.errorSkillIds.length ?? 0) > 0 && <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-[11px] text-red-500"><div className="flex items-center gap-2"><CircleAlert className="h-3.5 w-3.5" />{overview?.errorSkillIds.length} 个归类失败项仍保留在列表中；修正 Agent 后可手动重试。</div><ul className="mt-2 space-y-1 text-red-400">{Object.entries(overview?.perSkillErrors ?? {}).map(([skillId, error]) => <li key={skillId}><button type="button" className="font-medium underline underline-offset-2" onClick={() => openSkill(skillId)}>{skillByIdName(managedSkills, skillId)}</button><span className="mx-1">—</span>{error}</li>)}</ul></div>}
  </div>;
}
