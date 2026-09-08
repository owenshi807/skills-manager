import { useEffect, useState } from "react";
import { Check, ChevronDown, CircleAlert, History, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "../lib/error";
import { filterVersionGroups, isVersionDecisionCurrent } from "../lib/libraryGovernance";
import * as publishing from "../lib/skillPublishing";
import { cn } from "../utils";

export interface LibraryGovernanceSnapshot {
  library: publishing.LibrarySkillView[];
  groups: publishing.CanonicalGroup[];
  changes: publishing.PublishHistoryEntry[];
}

function agentName(key: string) {
  return key === "claude_code" ? "Claude Code" : key === "codex" ? "Codex" : key;
}

function dateTime(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function GovernanceStatus({ status }: { status: string }) {
  const labels: Record<string, string> = {
    variants_confirmed: "推荐适配已确认", confirmed: "主版本已确认", unselected: "待确认",
    missing: "原版本已缺失", stale: "需重新核对", current: "当前", needs_sync: "需同步",
    published: "已发布", rolled_back: "已回滚",
  };
  const current = ["variants_confirmed", "confirmed", "current", "published"].includes(status);
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", current ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400")}>{labels[status] ?? status}</span>;
}

export function VersionDecisionCard({ group, onOpenSkill, onChanged, editable = true }: {
  group: publishing.CanonicalGroup;
  onOpenSkill?: (id: string) => void;
  onChanged?: () => Promise<void>;
  editable?: boolean;
}) {
  const [candidateId, setCandidateId] = useState(group.selected_skill_id ?? group.members[0]?.skill.id ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const decisionReason = group.platform_resolution?.reason ?? group.selection_reason;
  const current = isVersionDecisionCurrent(group);
  const canChoose = editable && !group.platform_resolution && group.members.length > 1;
  const save = async () => {
    if (!reason.trim() || !group.members.some((member) => member.skill.id === candidateId)) return;
    setSaving(true);
    try {
      await publishing.selectSkillCanonical(candidateId, reason.trim());
      await onChanged?.();
      setEditing(false); setReason("");
      toast.success("已保存主版本及理由；其它版本仍保留。");
    } catch (error) { toast.error(getErrorMessage(error, "无法保存主版本")); }
    finally { setSaving(false); }
  };
  return <div className="space-y-3 p-4">
    <div className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-semibold text-primary">{group.normalized_name}</span><GovernanceStatus status={group.canonical_status} /></div>
    {decisionReason && <p className="whitespace-pre-wrap break-words text-[11px] leading-5 text-muted">{current ? "判断依据" : "上次判断依据"}：{decisionReason}</p>}
    {!current && <p className="flex items-start gap-1.5 text-[11px] leading-5 text-amber-600 dark:text-amber-400"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{group.canonical_status === "unselected" ? "先比较版本内容，再确认主版本或各助手的适配版本。" : "该组的内容或成员已变化，原判断不再作为当前推荐。"}</p>}
    {group.platform_resolution && <p className="text-[11px] leading-5 text-muted">{current ? "按助手推荐对应版本；实际使用哪份，以部署记录为准。" : "请让已连接的助手重新核对平台差异，再更新适配判断。"}</p>}
    {group.canonical_status === "confirmed" && group.unresolved_alternatives.length > 0 && <p className="text-[11px] leading-5 text-muted">已确定主版本；其余 {group.unresolved_alternatives.length} 份仍保留。主版本选择不代表其它版本等价或可以归档，副本比较继续使用原有待处理流程。</p>}
    <div className="space-y-2">{group.members.map((member) => {
      const recommended = current ? member.platform_agent_keys ?? [] : [];
      const directory = member.skill.central_path.split(/[\\/]/).filter(Boolean).at(-1);
      const label = directory && directory !== member.skill.name ? `${member.skill.name} · ${directory}` : member.skill.name;
      return <div key={member.skill.id} className="rounded-lg border border-border-subtle px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {onOpenSkill ? <button type="button" className="text-left text-[12px] font-medium text-secondary hover:text-accent" onClick={() => onOpenSkill(member.skill.id)}>{label}</button> : <span className="text-[12px] font-medium text-secondary">{label}</span>}
          {current && group.selected_skill_id === member.skill.id && <span className="text-[10px] text-emerald-600 dark:text-emerald-400">主版本</span>}
          {recommended.length > 0 && <span className="text-[10px] text-muted">推荐适配：{recommended.map(agentName).join(" / ")}</span>}
        </div>
        <p className="mt-1 break-all font-mono text-[10px] text-faint">{member.skill.central_path}</p>
      </div>;
    })}</div>
    {canChoose && (editing || !current) && <div className="space-y-2 border-t border-border-subtle pt-3">
      <label className="block text-[11px] text-secondary">主版本
        <select className="app-input mt-1 h-9 w-full text-[12px]" value={candidateId} disabled={saving} onChange={(event) => setCandidateId(event.target.value)}>
          {group.members.map((member) => <option key={member.skill.id} value={member.skill.id}>{member.skill.central_path.split(/[\\/]/).filter(Boolean).at(-1) ?? member.skill.name}</option>)}
        </select>
      </label>
      <label className="block text-[11px] text-secondary">选择依据
        <textarea className="app-input mt-1 min-h-16 w-full py-2 text-[12px]" value={reason} disabled={saving} onChange={(event) => setReason(event.target.value)} placeholder="说明核对过的差异及选择理由" />
      </label>
      <div className="flex items-center gap-2"><button type="button" className="app-button-secondary h-8" disabled={saving || !reason.trim() || !group.members.some((member) => member.skill.id === candidateId)} onClick={() => void save()}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}保存主版本</button>{current && <button type="button" className="text-[11px] text-muted" disabled={saving} onClick={() => setEditing(false)}>取消</button>}</div>
    </div>}
    {canChoose && current && !editing && <button type="button" className="text-[11px] text-accent hover:underline" onClick={() => setEditing(true)}>重新选择主版本</button>}
  </div>;
}

export function VersionDecisions({ groups, search, confirmed, onOpenSkill, onChanged }: {
  groups: publishing.CanonicalGroup[];
  search: string;
  confirmed: boolean;
  onOpenSkill: (id: string) => void;
  onChanged: () => Promise<void>;
}) {
  const visible = filterVersionGroups(groups, search);
  if (!visible.length) return null;
  return <details className="app-panel overflow-hidden" open={confirmed ? undefined : true}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[13px] font-semibold text-primary"><span>{confirmed ? "已确认的版本选择" : "版本需重新核对"}<span className="ml-2 text-[11px] font-normal text-muted">{visible.length} 组</span></span><ChevronDown className="h-4 w-4 text-muted" /></summary>
    <div className="border-t border-border-subtle px-4 py-3 text-[11px] leading-5 text-muted">{confirmed ? "保留各平台适配和主版本的判断依据。展开单组可查看版本；内容变化后会重新进入待处理。" : "原组成员已变化，请按当前内容重新确认。"}</div>
    <div className="max-h-[620px] divide-y divide-border-subtle overflow-y-auto">{visible.map((group) => confirmed ? <details key={group.normalized_name}><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[12px] text-secondary"><span>{group.normalized_name}</span><GovernanceStatus status={group.canonical_status} /></summary><VersionDecisionCard key={JSON.stringify(group)} group={group} onOpenSkill={onOpenSkill} onChanged={onChanged} /></details> : <VersionDecisionCard key={JSON.stringify(group)} group={group} onOpenSkill={onOpenSkill} onChanged={onChanged} />)}</div>
  </details>;
}

export function LibraryPublishHistory({ entries, library, onOpenSkill, title = "近期更新" }: {
  entries: publishing.PublishHistoryEntry[];
  library: publishing.LibrarySkillView[];
  onOpenSkill?: (id: string) => void;
  title?: string;
}) {
  const byId = new Map(library.map((member) => [member.skill.id, member]));
  return <details className="app-panel overflow-hidden">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[12px] font-semibold text-primary"><span className="flex items-center gap-2"><History className="h-4 w-4 text-muted" />{title}<span className="text-[11px] font-normal text-muted">{entries.length} 条</span></span><ChevronDown className="h-4 w-4 text-muted" /></summary>
    <div className="max-h-96 divide-y divide-border-subtle overflow-y-auto border-t border-border-subtle">{entries.length ? entries.map((entry) => {
      const skill = byId.get(entry.skill_id)?.skill;
      return <div key={entry.id} className="space-y-1.5 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">{skill && onOpenSkill ? <button type="button" className="text-[12px] font-medium text-secondary hover:text-accent" onClick={() => onOpenSkill(entry.skill_id)}>{skill.name}</button> : <span className="text-[12px] font-medium text-secondary">{skill?.name ?? "已移除 Skill"}</span>}<span className="text-[11px] text-muted">{entry.action === "create" ? "新建" : entry.action === "update" ? "更新" : entry.action}</span><GovernanceStatus status={entry.outcome} /></div>
        <p className="text-[11px] text-muted">{dateTime(entry.created_at)}{entry.actor ? ` · ${entry.actor}` : ""}</p>
        {entry.error && <p className="break-words text-[11px] text-amber-600 dark:text-amber-400">{entry.error}</p>}
        {entry.rollback_path && <p className="break-all font-mono text-[10px] text-faint">恢复点：{entry.rollback_path}</p>}
      </div>;
    }) : <p className="p-4 text-[12px] text-muted">尚无 Agent 发布记录。</p>}</div>
  </details>;
}

export function SkillGovernanceDetails({ skillId, snapshot, onOpenSkill, onChanged }: {
  skillId: string;
  snapshot?: LibraryGovernanceSnapshot | null;
  onOpenSkill?: (id: string) => void;
  onChanged?: () => Promise<void>;
}) {
  const [local, setLocal] = useState<LibraryGovernanceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<publishing.PublishHistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  // Other entry points (for example a scene) can open the same Skill detail.
  useEffect(() => {
    if (snapshot !== undefined) return;
    let cancelled = false;
    void publishing.getSkillLibrary().then(([library, groups]) => {
      if (!cancelled) { setLocal({ library, groups, changes: [] }); setError(null); }
    }).catch((cause) => { if (!cancelled) setError(getErrorMessage(cause, "无法读取版本与部署")); });
    return () => { cancelled = true; };
  }, [skillId, snapshot, revision]);
  useEffect(() => {
    let cancelled = false;
    void publishing.getSkillPublishHistory(skillId, 30).then((changes) => {
      if (!cancelled) { setHistory(changes); setHistoryError(null); }
    }).catch((cause) => { if (!cancelled) setHistoryError(getErrorMessage(cause, "无法读取此 Skill 的发布记录")); });
    return () => { cancelled = true; };
  }, [skillId, snapshot, revision]);
  const data = snapshot ?? local;
  const selected = data?.library.find((entry) => entry.skill.id === skillId);
  const group = data?.groups.find((entry) => entry.members.some((member) => member.skill.id === skillId));
  const refresh = async () => {
    if (onChanged) await onChanged();
    setRevision((value) => value + 1);
  };
  if (error && snapshot === undefined) return <div className="app-panel mb-4 p-3 text-[12px] text-amber-600">{error}<button type="button" onClick={() => void refresh()} className="ml-2 text-accent">重试</button></div>;
  if (!data) return <p className="mb-4 flex items-center gap-2 text-[12px] text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />读取版本与部署…</p>;
  if (!selected) return null;
  return <div className="mb-4 space-y-3">
    {group && <details className="app-panel overflow-hidden" open={!isVersionDecisionCurrent(group)}><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[12px] font-semibold text-primary"><span>版本选择与依据</span><GovernanceStatus status={group.canonical_status} /></summary><VersionDecisionCard key={JSON.stringify(group)} group={group} onOpenSkill={onOpenSkill} onChanged={refresh} /></details>}
    <details className="app-panel overflow-hidden"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[12px] font-semibold text-primary"><span>实际部署 <span className="ml-1 font-normal text-muted">{selected.deployments.length} 个目标{selected.deployments.some((deployment) => deployment.actual_status !== "current") ? " · 有部署需核对" : ""}</span></span><ChevronDown className="h-4 w-4 text-muted" /></summary><div className="border-t border-border-subtle"><div className="flex items-center justify-between gap-3 px-4 py-2"><p className="text-[11px] text-muted">读取受管目标的磁盘状态。</p><button type="button" className="text-muted hover:text-accent" title="刷新部署状态" onClick={() => void refresh()}><RefreshCw className="h-3.5 w-3.5" /></button></div>{selected.deployments.length ? selected.deployments.map((deployment) => <div key={`${deployment.tool}:${deployment.target_path}`} className="border-t border-border-subtle px-4 py-3"><div className="flex items-center justify-between gap-2"><span className="text-[12px] font-medium text-secondary">{agentName(deployment.tool)}</span><GovernanceStatus status={deployment.actual_status} /></div><p className="mt-1 break-all font-mono text-[10px] text-muted">{deployment.target_path}</p><p className="mt-1 text-[10px] text-faint">{deployment.mode === "symlink" ? "链接" : deployment.mode === "copy" ? "副本" : deployment.mode} · 记录状态 {deployment.recorded_status}</p></div>) : <p className="px-4 pb-3 text-[12px] text-muted">尚未部署到助手。可在此 Skill 的助手开关中设置。</p>}</div></details>
    {historyError ? <p className="text-[11px] text-amber-600">{historyError}<button type="button" className="ml-2 text-accent" onClick={() => void refresh()}>重试</button></p> : history ? <LibraryPublishHistory entries={history} library={data.library} title="此 Skill 的近期发布" /> : <p className="text-[11px] text-muted">读取发布记录…</p>}
  </div>;
}
