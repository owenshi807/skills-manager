import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, Clipboard, History, Link2, Loader2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { writeText as clipboardWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { getErrorMessage } from "../lib/error";
import * as publishing from "../lib/skillPublishing";
import { cn } from "../utils";

const POLL_MS = 15_000;

function time(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

async function copy(value: string) {
  try { await clipboardWriteText(value); }
  catch { await navigator.clipboard.writeText(value); }
}

function Status({ status }: { status: string }) {
  const stale = status === "stale" || status === "needs_sync" || status === "rolled_back";
  const ok = status === "confirmed" || status === "current" || status === "published";
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", ok ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : stale ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-surface-active text-muted")}>{status === "needs_sync" ? "需同步" : status === "confirmed" ? "已确认" : status === "current" ? "当前" : status === "stale" ? "内容已变化" : status === "rolled_back" ? "已回滚" : status}</span>;
}

export function AssistantConnections() {
  const [control, setControl] = useState<publishing.McpControlStatus | null>(null);
  const [library, setLibrary] = useState<publishing.LibrarySkillView[]>([]);
  const [groups, setGroups] = useState<publishing.CanonicalGroup[]>([]);
  const [changes, setChanges] = useState<publishing.PublishHistoryEntry[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState<"codex" | "claude" | null>(null);
  const [reasonByGroup, setReasonByGroup] = useState<Record<string, string>>({});
  const [canonicalCandidateByGroup, setCanonicalCandidateByGroup] = useState<Record<string, string>>({});
  const historyFingerprint = useRef("");

  const refreshLibrary = useCallback(async () => {
    const [nextControl, [nextLibrary, nextGroups], nextChanges] = await Promise.all([
      publishing.getMcpControlStatus(), publishing.getSkillLibrary(), publishing.getSkillPublishHistory(null, 30),
    ]);
    setControl(nextControl); setLibrary(nextLibrary); setGroups(nextGroups); setChanges(nextChanges);
    setLoadError(null);
    historyFingerprint.current = nextChanges.map((entry) => entry.id).join(",");
    setSelectedSkillId((current) => current && nextLibrary.some((item) => item.skill.id === current) ? current : nextLibrary[0]?.skill.id ?? null);
  }, []);

  useEffect(() => {
    void refreshLibrary().catch((error) => {
      const message = getErrorMessage(error, "无法加载助手连接");
      setLoadError(message); toast.error(message);
    }).finally(() => setLoading(false));
  }, [refreshLibrary]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      // MCP publishes update this small settings-backed history. Only reload
      // deployment facts when it changes; never poll full tree hashes.
      void publishing.getSkillPublishHistory(null, 30).then((next) => {
        const fingerprint = next.map((entry) => entry.id).join(",");
        if (fingerprint !== historyFingerprint.current) void refreshLibrary();
        else setChanges(next);
      }).catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshLibrary]);

  const selected = useMemo(() => library.find((entry) => entry.skill.id === selectedSkillId) ?? null, [library, selectedSkillId]);
  const skillsById = useMemo(() => new Map(library.map((entry) => [entry.skill.id, entry])), [library]);
  const refresh = async () => {
    try { await refreshLibrary(); }
    catch (error) { const message = getErrorMessage(error, "无法刷新助手连接"); setLoadError(message); toast.error(message); }
  };
  const copyConfiguration = async (value: string, label: string) => {
    try { await copy(value); toast.success(`${label}已复制`); }
    catch (error) { toast.error(getErrorMessage(error, "无法复制配置")); }
  };
  const saveControl = async (enabled: boolean, writes: boolean) => {
    setSaving(true);
    try { setControl(await publishing.setMcpControlSettings(enabled, writes)); }
    catch (error) { toast.error(getErrorMessage(error, "无法保存 MCP 权限")); }
    finally { setSaving(false); }
  };
  const connect = async (client: "codex" | "claude") => {
    setConnecting(client);
    try {
      const result = await publishing.connectMcpClient(client);
      if (result.connected) toast.success(result.message);
      else toast.error(result.message);
    }
    catch (error) { toast.error(getErrorMessage(error, "无法连接助手")); }
    finally { setConnecting(null); }
  };
  const chooseCanonical = async (group: publishing.CanonicalGroup, skillId: string) => {
    const reason = reasonByGroup[group.normalized_name]?.trim();
    if (!reason) { toast.error("填写选择此版本的理由后再保存。"); return; }
    try { await publishing.selectSkillCanonical(skillId, reason); await refreshLibrary(); toast.success("已保存主版本选择；其它变体仍保留。"); }
    catch (error) { toast.error(getErrorMessage(error, "无法保存主版本选择")); }
  };

  if (loading) return <div className="app-page flex min-h-[280px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-accent" /></div>;
  return <div className="app-page">
    <header className="app-page-header flex flex-wrap items-start justify-between gap-4"><div><h1 className="app-page-title">连接助手</h1><p className="app-page-subtitle">通过 Manager 创建、更新 Skill，并调整 Agent 投放。Codex 和 Claude 使用同一个本机 Skill 库。</p></div><button type="button" className="app-button-secondary" onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />刷新</button></header>

    {loadError && <div className="app-panel flex items-start justify-between gap-3 border-red-500/30 bg-red-500/5 p-3.5"><div className="flex items-start gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" /><p className="text-[12px] text-red-600 dark:text-red-300">{loadError}</p></div><button type="button" className="scm-button-tertiary" onClick={() => void refresh()}>重试</button></div>}

    {!control?.available && <div className="app-panel flex items-start gap-3 border-amber-500/30 bg-amber-500/5 p-3.5"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /><div><p className="text-[13px] font-medium text-primary">MCP server 不可用</p><p className="mt-1 text-[12px] text-muted">当前构建未找到本机 server。打开或更新 Skill Card Manager 后重试；不会写入任何助手配置。</p></div></div>}

    <section className="app-panel p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-[13px] font-semibold text-primary">本机 MCP 权限</h2><p className="mt-1 text-[12px] text-muted">库路径：{control?.library_path ?? "不可用"}</p></div><ShieldCheck className="h-5 w-5 text-accent" /></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="app-panel-muted flex items-center justify-between gap-3 p-3"><span><span className="block text-[12px] font-medium text-primary">启用助手访问</span><span className="mt-0.5 block text-[11px] text-muted">允许查询、阅读和组织共享库。</span></span><ToggleSwitch checked={control?.enabled ?? false} disabled={saving || !control} onChange={() => void saveControl(!(control?.enabled ?? false), control?.allow_file_writes ?? false)} /></label><label className="app-panel-muted flex items-center justify-between gap-3 p-3"><span><span className="block text-[12px] font-medium text-primary">允许文件发布</span><span className="mt-0.5 block text-[11px] text-muted">允许 Agent 通过 Manager 创建和更新 Skill。</span></span><ToggleSwitch checked={control?.allow_file_writes ?? false} disabled={saving || !control?.enabled} onChange={() => void saveControl(control?.enabled ?? false, !(control?.allow_file_writes ?? false))} /></label></div>{!control?.enabled && <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-400">先启用助手访问，才能连接 Codex 或 Claude。</p>}</section>

    <section className="grid gap-4 lg:grid-cols-2"><div className="app-panel p-4"><div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold text-primary">Codex</h2><button type="button" title={!control?.enabled ? "请先启用助手访问" : undefined} className="app-button-primary h-9" disabled={!control?.available || !control?.enabled || connecting !== null} onClick={() => void connect("codex")}>{connecting === "codex" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}连接 Codex</button></div><p className="mt-2 break-all rounded-lg bg-bg-secondary p-2.5 font-mono text-[11px] text-muted">{control?.codex_command ?? "MCP server 不可用"}</p><button type="button" className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-light" onClick={() => control && void copyConfiguration(control.codex_command, "Codex 命令")}><Clipboard className="h-3 w-3" />复制命令</button></div><div className="app-panel p-4"><div className="flex items-center justify-between"><h2 className="text-[13px] font-semibold text-primary">Claude</h2><button type="button" title={!control?.enabled ? "请先启用助手访问" : undefined} className="app-button-primary h-9" disabled={!control?.available || !control?.enabled || connecting !== null} onClick={() => void connect("claude")}>{connecting === "claude" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}连接 Claude</button></div><p className="mt-2 break-all rounded-lg bg-bg-secondary p-2.5 font-mono text-[11px] text-muted">{control?.claude_command ?? "MCP server 不可用"}</p><button type="button" className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-light" onClick={() => control && void copyConfiguration(control.claude_command, "Claude 命令")}><Clipboard className="h-3 w-3" />复制命令</button></div></section>

    <section className="app-panel p-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-[13px] font-semibold text-primary">Desktop 配置</h2><p className="mt-1 text-[11px] text-muted">适用于支持标准 MCP JSON 配置的桌面客户端。</p></div><button type="button" className="app-button-secondary h-8" onClick={() => control && void copyConfiguration(JSON.stringify(control.desktop_config, null, 2), "配置")}><Clipboard className="h-3.5 w-3.5" />复制 JSON</button></div><pre className="mt-3 overflow-x-auto rounded-lg bg-bg-secondary p-3 text-[11px] text-muted">{JSON.stringify(control?.desktop_config ?? {}, null, 2)}</pre></section>

    <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]"><div className="app-panel overflow-hidden"><div className="border-b border-border-subtle px-4 py-3"><h2 className="text-[13px] font-semibold text-primary">同名变体与主版本</h2><p className="mt-1 text-[11px] text-muted">同名不代表等价。选择只保存理由和指针，不删除平台版或自定义版。</p></div><div className="divide-y divide-border-subtle">{groups.length === 0 ? <p className="p-4 text-[12px] text-muted">没有需要选择的同名变体。</p> : groups.map((group) => { const candidateId = canonicalCandidateByGroup[group.normalized_name] ?? group.selected_skill_id ?? group.members[0]?.skill.id; return <div key={group.normalized_name} className="p-4"><div className="flex flex-wrap items-center gap-2"><span className="text-[12px] font-medium text-primary">{group.normalized_name}</span><Status status={group.canonical_status} />{group.divergent && <span className="text-[10px] text-amber-600 dark:text-amber-400">内容不同</span>}</div>{group.selection_reason && <p className="mt-1 text-[11px] text-muted">已选理由：{group.selection_reason}</p>}{group.canonical_status === "stale" && <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"><CircleAlert className="h-3 w-3" />所选内容已变，需重新确认。</p>}<div className="mt-3 flex flex-wrap gap-2">{group.members.map((member) => <button key={member.skill.id} type="button" onClick={() => { setSelectedSkillId(member.skill.id); setCanonicalCandidateByGroup((current) => ({ ...current, [group.normalized_name]: member.skill.id })); }} className={cn("rounded border px-2 py-1 text-[11px]", candidateId === member.skill.id ? "border-accent/40 bg-accent-bg text-accent-light" : "border-border-subtle text-secondary hover:bg-surface-hover")}>{member.skill.name}</button>)}</div><div className="mt-3 flex gap-2"><input className="app-input h-8 flex-1 text-[11px]" value={reasonByGroup[group.normalized_name] ?? ""} onChange={(event) => setReasonByGroup((current) => ({ ...current, [group.normalized_name]: event.target.value }))} placeholder="为什么这个变体应作为主版本？" /><button type="button" className="app-button-secondary h-8 shrink-0" disabled={!reasonByGroup[group.normalized_name]?.trim()} onClick={() => { if (candidateId) void chooseCanonical(group, candidateId); }}><Check className="h-3.5 w-3.5" />确认选择</button></div></div>; })}</div></div>

      <div className="app-panel overflow-hidden"><div className="border-b border-border-subtle px-4 py-3"><h2 className="text-[13px] font-semibold text-primary">选中 Skill 的实际部署</h2><p className="mt-1 text-[11px] text-muted">基于受管目标的当前磁盘状态。</p></div><div className="divide-y divide-border-subtle">{selected ? <><div className="p-4"><select className="app-input h-8 w-full text-[12px]" value={selected.skill.id} onChange={(event) => setSelectedSkillId(event.target.value)}>{library.map((item) => <option key={item.skill.id} value={item.skill.id}>{item.skill.name}</option>)}</select><p className="mt-2 text-[11px] text-muted">{selected.skill.description ?? "无说明"}</p></div>{selected.deployments.length ? selected.deployments.map((deployment) => <div key={`${deployment.tool}:${deployment.target_path}`} className="p-4"><div className="flex items-center justify-between gap-2"><span className="text-[12px] font-medium text-primary">{deployment.tool}</span><Status status={deployment.actual_status} /></div><p className="mt-1 break-all font-mono text-[10px] text-muted">{deployment.target_path}</p><p className="mt-1 text-[10px] text-faint">{deployment.mode} · 记录状态 {deployment.recorded_status}</p></div>) : <p className="p-4 text-[12px] text-muted">尚未选择 Agent 部署。</p>}</> : <p className="p-4 text-[12px] text-muted">库中没有可显示的 Skill。</p>}</div></div></section>

    <section className="app-panel overflow-hidden"><div className="flex items-center justify-between border-b border-border-subtle px-4 py-3"><div><h2 className="text-[13px] font-semibold text-primary">全库近期更新</h2><p className="mt-1 text-[11px] text-muted">其它会话的更新会自动显示在这里。</p></div><History className="h-4 w-4 text-muted" /></div><div className="divide-y divide-border-subtle">{changes.length ? changes.map((entry) => { const skill = skillsById.get(entry.skill_id); return <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><div><div className="flex items-center gap-2"><button type="button" className="text-[12px] font-medium text-primary hover:text-accent" onClick={() => entry.skill_id && setSelectedSkillId(entry.skill_id)}>{skill?.skill.name ?? "已移除 Skill"}</button><span className="text-[11px] text-muted">{entry.action}</span><Status status={entry.outcome} /></div><p className="mt-1 text-[11px] text-muted">{time(entry.created_at)}{entry.actor ? ` · ${entry.actor}` : ""}{entry.error ? ` · ${entry.error}` : ""}</p></div>{entry.rollback_path && <span className="max-w-[320px] truncate font-mono text-[10px] text-muted" title={entry.rollback_path}>恢复点：{entry.rollback_path}</span>}</div>; }) : <p className="p-4 text-[12px] text-muted">尚无 Agent 更新记录。</p>}</div></section>
  </div>;
}
