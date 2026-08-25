import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  AgentDuplicateAliasPreview,
  ManagedSkill,
  OrganizationArchivePreview,
  OrganizationCaseEvidence,
} from "../lib/tauri";
import * as api from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import { cn } from "../utils";
import type { WorkspaceDuplicateGroup } from "../lib/workspaceDuplicates";

function sourceLabel(skill: ManagedSkill | undefined) {
  const source = skill?.source_ref_resolved || skill?.source_ref;
  return source?.replace(/^\/Users\/[^/]+/, "~") || "—";
}

function chooseCanonical(skills: ManagedSkill[]) {
  return [...skills].sort((a, b) => {
    const score = (skill: ManagedSkill) =>
      (skill.update_status !== "source_missing" && skill.update_status !== "error" ? 4 : 0)
      + (skill.source_revision ? 2 : 0)
      + (skill.source_ref ? 1 : 0);
    return score(b) - score(a) || a.created_at - b.created_at;
  })[0];
}

export function WorkspaceDuplicatePanel({
  agentKey,
  agentName,
  groups,
  managedSkills,
  selectedGroupId,
  onSelectedGroupChange,
  refreshing,
  onRefresh,
  onApplied,
}: {
  agentKey: string;
  agentName: string;
  groups: WorkspaceDuplicateGroup[];
  managedSkills: ManagedSkill[];
  selectedGroupId: string | null;
  onSelectedGroupChange: (id: string | null) => void;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onApplied: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [aliasPreview, setAliasPreview] = useState<AgentDuplicateAliasPreview | null>(null);
  const [archivePreview, setArchivePreview] = useState<OrganizationArchivePreview | null>(null);
  const [caseEvidence, setCaseEvidence] = useState<OrganizationCaseEvidence | null>(null);
  const [working, setWorking] = useState(false);
  const [selectedKeepId, setSelectedKeepId] = useState<string | null>(null);

  const selected = groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
  const detailsId = `workspace-duplicates-${agentKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const exactCount = groups.filter((group) => group.exactContent).length;
  const judgmentCount = groups.length - exactCount;
  const selectedManaged = useMemo(
    () => selected?.centerSkillIds
      .map((id) => managedSkills.find((skill) => skill.id === id))
      .filter((skill): skill is ManagedSkill => !!skill) ?? [],
    [managedSkills, selected],
  );

  useEffect(() => {
    if (!selected) return;
    const canonical = chooseCanonical(selectedManaged);
    setSelectedKeepId(canonical?.id ?? selected.centerSkillIds[0] ?? null);
    setAliasPreview(null);
    setArchivePreview(null);
    setCaseEvidence(null);
  }, [selected, selectedManaged]);

  useEffect(() => {
    if (selectedGroupId) setExpanded(true);
  }, [selectedGroupId]);

  const preview = async () => {
    if (!selected || !selected.exactContent || selected.members.length !== 2) return;
    setWorking(true);
    try {
      if (selected.centerSkillIds.length === 1) {
        const skillId = selected.centerSkillIds[0];
        const managed = managedSkills.find((skill) => skill.id === skillId);
        const targetPath = managed?.targets.find((target) => target.tool === agentKey)?.target_path;
        const redundant = selected.members.find((member) => member.path !== targetPath);
        if (!redundant) throw new Error(t("globalWorkspace.duplicates.noRedundantAlias"));
        setAliasPreview(await api.previewAgentDuplicateAlias(agentKey, skillId, redundant.relative_path));
        return;
      }
      if (selected.centerSkillIds.length === 2) {
        const issueKind = "exact_duplicate";
        const caseRequest: api.OrganizationCaseRequest = {
          case_id: `workspace:${agentKey}:${selected.centerSkillIds.slice().sort().join(":")}`,
          issue_kind: issueKind,
          member_ids: selected.centerSkillIds,
          verify_strict_artifact: true,
        };
        const [evidence] = await api.inspectOrganizationCases([caseRequest]);
        if (!evidence || evidence.artifact.status !== "verified_match") {
          throw new Error(t("globalWorkspace.duplicates.contentChanged"));
        }
        const keepId = selectedKeepId ?? chooseCanonical(selectedManaged)?.id;
        const archiveId = selected.centerSkillIds.find((id) => id !== keepId);
        if (!keepId || !archiveId) throw new Error(t("globalWorkspace.duplicates.noSafeAction"));
        setCaseEvidence(evidence);
        setArchivePreview(await api.previewOrganizationArchive({
          case: caseRequest,
          evidence_fingerprint: evidence.case_revision,
          keep_skill_id: keepId,
          archive_skill_id: archiveId,
        }));
        return;
      }
      throw new Error(t("globalWorkspace.duplicates.noSafeAction"));
    } catch (error) {
      toast.error(getErrorMessage(error, t("globalWorkspace.duplicates.previewFailed")));
    } finally {
      setWorking(false);
    }
  };

  const apply = async () => {
    if (!selected) return;
    setWorking(true);
    try {
      if (aliasPreview) {
        const result = await api.applyAgentDuplicateAlias(
          agentKey,
          aliasPreview.skill_id,
          aliasPreview.redundant_relative_path,
        );
        await onApplied();
        toast.success(t("globalWorkspace.duplicates.aliasApplied", { agent: agentName }), {
          action: {
            label: t("mySkills.organization.undo"),
            onClick: () => void api.undoAgentDuplicateAlias(result.operation_id)
              .then(onApplied)
              .then(() => toast.success(t("globalWorkspace.duplicates.undone")))
              .catch((error) => toast.error(getErrorMessage(error, t("globalWorkspace.duplicates.undoFailed")))),
          },
        });
      } else if (archivePreview && caseEvidence) {
        const result = await api.applyOrganizationArchive({
          case: {
            case_id: caseEvidence.case_id,
            issue_kind: caseEvidence.issue_kind,
            member_ids: caseEvidence.member_ids,
            verify_strict_artifact: true,
          },
          evidence_fingerprint: caseEvidence.case_revision,
          keep_skill_id: archivePreview.keep_skill_id,
          archive_skill_id: archivePreview.archive_skill_id,
          ownership_revision: archivePreview.ownership_revision,
        });
        await onApplied();
        toast.success(t("globalWorkspace.duplicates.archiveApplied", { agent: agentName }), {
          action: {
            label: t("mySkills.organization.undo"),
            onClick: () => void api.undoOrganizationArchive(result.operation_id)
              .then(onApplied)
              .then(() => toast.success(t("globalWorkspace.duplicates.undone")))
              .catch((error) => toast.error(getErrorMessage(error, t("globalWorkspace.duplicates.undoFailed")))),
          },
        });
      }
      setAliasPreview(null);
      setArchivePreview(null);
      setCaseEvidence(null);
    } catch (error) {
      toast.error(getErrorMessage(error, t("globalWorkspace.duplicates.applyFailed")));
    } finally {
      setWorking(false);
    }
  };

  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-300">
        <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" />{t("globalWorkspace.duplicates.clean", { agent: agentName })}</span>
        <button type="button" onClick={() => void onRefresh()} className="text-muted transition-colors hover:text-primary"><RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} /></button>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-amber-500/25 bg-amber-500/[0.045] shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-lg bg-amber-500/12 p-2 text-amber-600 dark:text-amber-300"><CircleAlert className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-primary">{t("globalWorkspace.duplicates.found", { agent: agentName, count: groups.length })}</h2>
            <p className="mt-0.5 text-[11px] text-muted">{t("globalWorkspace.duplicates.summary", { exact: exactCount, judgment: judgmentCount })}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void onRefresh()} className="app-button-secondary h-8" disabled={refreshing}><RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />{t("mySkills.organization.refresh")}</button>
          {!expanded && (
            <button type="button" onClick={() => setExpanded(true)} className="app-button-primary h-8">
              {t("globalWorkspace.duplicates.viewAndHandle")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label={t(expanded ? "globalWorkspace.duplicates.collapseDetails" : "globalWorkspace.duplicates.expandDetails")}
            title={t(expanded ? "globalWorkspace.duplicates.collapseDetails" : "globalWorkspace.duplicates.expandDetails")}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle bg-bg-secondary text-muted transition-colors hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
          </button>
        </div>
      </div>

      {expanded && selected && (
        <div id={detailsId} className="grid border-t border-amber-500/15 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="max-h-[480px] overflow-y-auto border-b border-border-faint p-2 lg:border-b-0 lg:border-r">
            {groups.map((group) => (
              <button key={group.id} type="button" onClick={() => onSelectedGroupChange(group.id)} className={cn("mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors", selected.id === group.id ? "bg-accent-bg" : "hover:bg-surface-hover")}>
                <Copy className={cn("h-3.5 w-3.5 shrink-0", group.exactContent ? "text-emerald-500" : "text-amber-500")} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-secondary">{group.label}</span><span className="mt-0.5 block text-[10px] text-muted">{group.exactContent ? t("globalWorkspace.duplicates.exact") : t("globalWorkspace.duplicates.needsJudgment")} · {group.members.length}</span></span>
                <ChevronRight className="h-3.5 w-3.5 text-faint" />
              </button>
            ))}
          </aside>

          <div className="min-w-0 p-4">
            <div className="flex items-start gap-3">
              <span className={cn("rounded-lg p-2", selected.exactContent ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600")}>{selected.exactContent ? <ShieldCheck className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}</span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[14px] font-semibold text-primary">{selected.label}</h3>
                <p className="mt-1 text-[12px] leading-5 text-muted">
                  {selected.exactContent
                    ? selected.centerSkillIds.length === 1
                      ? t("globalWorkspace.duplicates.sameSkillFact", { agent: agentName })
                      : t("globalWorkspace.duplicates.exactCopiesFact", { agent: agentName })
                    : t("globalWorkspace.duplicates.collisionFact")}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {selected.members.map((member) => {
                const managed = member.center_skill_id ? managedSkills.find((skill) => skill.id === member.center_skill_id) : undefined;
                const isKeep = selected.centerSkillIds.length > 1 && member.center_skill_id === selectedKeepId;
                return (
                  <button key={member.relative_path} type="button" disabled={selected.centerSkillIds.length < 2} onClick={() => { setSelectedKeepId(member.center_skill_id); setArchivePreview(null); setCaseEvidence(null); }} className={cn("rounded-lg border px-3 py-3 text-left", isKeep ? "border-accent/45 bg-accent-bg" : "border-border-faint bg-bg-secondary/55")}>
                    <span className="flex items-center justify-between gap-2"><span className="truncate text-[12px] font-semibold text-secondary">{member.relative_path}</span>{isKeep && <span className="rounded-full bg-accent px-2 py-0.5 text-[9px] text-white">{t("globalWorkspace.duplicates.keep")}</span>}</span>
                    <span className="mt-1 block truncate text-[10px] text-muted">{sourceLabel(managed)}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-border-faint bg-bg-secondary/40 p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{t("mySkills.organization.recommendation")}</div><p className="mt-1 text-[11px] leading-4 text-secondary">{selected.exactContent ? t("globalWorkspace.duplicates.exactRecommendation") : t("globalWorkspace.duplicates.collisionRecommendation")}</p></div>
              <div className="rounded-lg border border-border-faint bg-bg-secondary/40 p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{t("mySkills.organization.impact")}</div><p className="mt-1 text-[11px] leading-4 text-muted">{t("globalWorkspace.duplicates.impact")}</p></div>
            </div>

            {(aliasPreview || archivePreview) && (
              <div className="mt-3 rounded-lg border border-accent/25 bg-accent-bg p-3 text-[11px] leading-5 text-secondary">
                {aliasPreview
                  ? t("globalWorkspace.duplicates.aliasPreview", { keep: aliasPreview.keep_relative_path, remove: aliasPreview.redundant_relative_path })
                  : t("globalWorkspace.duplicates.archivePreview", { keep: archivePreview?.keep_name, archive: archivePreview?.archive_name, agents: archivePreview?.target_effects.length })}
                <span className="ml-1 text-muted">{t("globalWorkspace.duplicates.undoable")}</span>
              </div>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {!selected.exactContent ? (
                <button type="button" onClick={() => navigate(`/my-skills?view=issues&search=${encodeURIComponent(selected.label)}`)} className="app-button-primary">{t("globalWorkspace.duplicates.compareAndHandle")}<ArrowRight className="h-3.5 w-3.5" /></button>
              ) : aliasPreview || archivePreview ? (
                <button type="button" onClick={() => void apply()} disabled={working} className="app-button-primary">{working && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{aliasPreview ? t("globalWorkspace.duplicates.applyAlias", { keep: aliasPreview.keep_relative_path }) : t("globalWorkspace.duplicates.applyArchive", { keep: archivePreview?.keep_name })}</button>
              ) : (
                <button type="button" onClick={() => void preview()} disabled={working || selected.members.length !== 2 || selected.centerSkillIds.length === 0} className="app-button-primary">{working && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t("globalWorkspace.duplicates.previewAction")}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
