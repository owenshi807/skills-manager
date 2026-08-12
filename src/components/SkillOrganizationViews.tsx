import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  GitCompareArrows,
  Layers3,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ManagedSkill,
  OrganizationAgentAssessment,
  OrganizationDisposition,
  ToolInfo,
} from "../lib/tauri";
import type { SkillIssue, SkillRelationGroup } from "../lib/skillOrganization";
import { cn } from "../utils";

interface SharedProps {
  skills: ManagedSkill[];
  search: string;
  displayNames: Map<string, string>;
  tools: ToolInfo[];
  onOpenSkill: (skillId: string) => void;
}

interface OrganizeProps extends SharedProps {
  relationshipGroups: SkillRelationGroup[];
  issues: SkillIssue[];
  resolvedIds: Set<string>;
  onShowIssues: () => void;
  onUndoDecision: (caseKey: string) => void;
}

interface IssuesProps extends SharedProps {
  issues: SkillIssue[];
  resolvedIds: Set<string>;
  executionMode: OrganizationExecutionMode;
  executionOptions: OrganizationExecutionOption[];
  onExecutionModeChange: (mode: OrganizationExecutionMode) => void;
  onExecuteBatch: (issues: SkillIssue[]) => void;
  onHandOff: (issue: SkillIssue) => void;
  agentAssessments: Map<string, OrganizationAgentDisplayAssessment>;
  agentError: string | null;
  processingBatch: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onDecide: (issue: SkillIssue, disposition: OrganizationDisposition) => void;
}

export type OrganizationExecutionMode = "codex" | "claude_code" | "hermes" | "copy_prompt";

export interface OrganizationExecutionOption {
  id: OrganizationExecutionMode;
  label: string;
  description: string;
}

export interface OrganizationAgentDisplayAssessment {
  agentName: string;
  assessment: OrganizationAgentAssessment;
  stale: boolean;
  createdAt: number;
}

function toolNames(skill: ManagedSkill, tools: ToolInfo[]) {
  const names = new Set(
    skill.targets.map((target) => tools.find((tool) => tool.key === target.tool)?.display_name ?? target.tool),
  );
  return [...names];
}

function sourceLabel(skill: ManagedSkill) {
  const source = skill.source_ref_resolved || skill.source_ref;
  if (!source) return skill.source_type;
  return source.split(/[\\/]/).filter(Boolean).slice(-2).join("/");
}

function matchesSearch(skills: ManagedSkill[], label: string, search: string) {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return true;
  return [label, ...skills.flatMap((skill) => [skill.name, skill.description ?? "", sourceLabel(skill)])]
    .some((value) => value.toLocaleLowerCase().includes(query));
}

function MemberRow({
  skill,
  displayName,
  tools,
  onOpen,
}: {
  skill: ManagedSkill;
  displayName: string;
  tools: ToolInfo[];
  onOpen: () => void;
}) {
  const agents = toolNames(skill, tools);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group/member flex w-full items-start gap-3 rounded-lg border border-border-faint bg-bg-secondary/60 px-3 py-2.5 text-left transition-colors hover:border-border-subtle hover:bg-surface-hover"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-secondary group-hover/member:text-primary">
            {displayName}
          </span>
          <span className="shrink-0 text-[10px] text-faint">{sourceLabel(skill)}</span>
        </div>
        <p className="mt-0.5 line-clamp-1 text-[12px] leading-4 text-muted">
          {skill.description || "—"}
        </p>
      </div>
      <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[10px] text-faint">
        <Link2 className="h-3 w-3" />
        {agents.length > 0 ? agents.join(" · ") : "—"}
      </span>
      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint transition-transform group-hover/member:translate-x-0.5" />
    </button>
  );
}

function relationCopy(kind: SkillRelationGroup["kind"], t: ReturnType<typeof useTranslation>["t"]) {
  if (kind === "exact_duplicate") {
    return {
      fact: t("mySkills.organization.relations.exactDuplicate.fact"),
      recommendation: t("mySkills.organization.relations.exactDuplicate.recommendation"),
      impact: t("mySkills.organization.relations.exactDuplicate.impact"),
      tone: "safe" as const,
    };
  }
  if (kind === "content_alias") {
    return {
      fact: t("mySkills.organization.relations.contentAlias.fact"),
      recommendation: t("mySkills.organization.relations.contentAlias.recommendation"),
      impact: t("mySkills.organization.relations.contentAlias.impact"),
      tone: "safe" as const,
    };
  }
  return {
    fact: t("mySkills.organization.relations.nameCollision.fact"),
    recommendation: t("mySkills.organization.relations.nameCollision.recommendation"),
    impact: t("mySkills.organization.relations.nameCollision.impact"),
    tone: "decision" as const,
  };
}

export function SkillOrganizeView({
  skills,
  relationshipGroups,
  issues,
  resolvedIds,
  search,
  onShowIssues,
  onUndoDecision,
}: OrganizeProps) {
  const { t } = useTranslation();
  const confirmedRelationshipGroups = relationshipGroups.filter((group) => resolvedIds.has(group.id));
  const pendingIssues = issues.filter((issue) => !resolvedIds.has(issue.id));
  const exactCandidates = pendingIssues.filter((issue) => issue.kind === "exact_duplicate" || issue.kind === "content_alias");
  const nameCollisions = pendingIssues.filter((issue) => issue.kind === "name_collision");
  const formatIssues = pendingIssues.filter((issue) => issue.kind === "format_health");
  const sourceIssues = pendingIssues.filter((issue) => ["source_missing", "sync_conflict", "read_error"].includes(issue.kind));
  const affectedSkillIds = new Set(pendingIssues.flatMap((issue) => issue.skills.map((skill) => skill.id)));
  const healthySkills = Math.max(0, skills.length - affectedSkillIds.size);
  const checks = [
    { id: "exact", icon: GitCompareArrows, count: exactCandidates.length, tone: "text-amber-500" },
    { id: "sameName", icon: Layers3, count: nameCollisions.length, tone: "text-amber-500" },
    { id: "format", icon: CircleAlert, count: formatIssues.length, tone: "text-rose-500" },
    { id: "source", icon: Link2, count: sourceIssues.length, tone: "text-rose-500" },
  ];

  return (
    <div className="space-y-3 pb-8">
      <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface px-3 py-2.5">
        <div>
          <h2 className="text-[13px] font-semibold text-primary">{t("mySkills.organization.healthTitle")}</h2>
          <p className="mt-0.5 text-[11px] text-muted">{t("mySkills.organization.healthIntro")}</p>
        </div>
        <div className="text-right"><div className="text-[18px] font-semibold text-primary">{healthySkills}/{skills.length}</div><div className="text-[10px] text-faint">{t("mySkills.organization.healthySkills")}</div></div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {checks.map((check) => {
          const Icon = check.icon;
          return <button key={check.id} type="button" onClick={onShowIssues} className="app-panel min-h-[104px] p-3 text-left transition-colors hover:bg-surface-hover"><div className="flex items-center justify-between"><Icon className={cn("h-4 w-4", check.tone)} /><ChevronRight className="h-3.5 w-3.5 text-faint" /></div><div className="mt-3 text-[18px] font-semibold text-primary">{check.count}</div><div className="text-[11px] font-medium text-secondary">{t(`mySkills.organization.healthChecks.${check.id}.title`)}</div><div className="mt-0.5 text-[10px] text-faint">{t(`mySkills.organization.healthChecks.${check.id}.hint`)}</div></button>;
        })}
      </div>

      {confirmedRelationshipGroups.length > 0 && (
        <section className="space-y-3 pt-2">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-primary">
                {t("mySkills.organization.confirmedRelations", { count: confirmedRelationshipGroups.length })}
              </h2>
              <p className="mt-0.5 text-[11px] text-muted">{t("mySkills.organization.confirmedRelationsHint")}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {confirmedRelationshipGroups
              .filter((group) => matchesSearch(group.skills, group.label, search))
              .map((group) => (
                <article key={group.id} className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-[13px] font-semibold text-primary">{group.label}</h3>
                        <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-muted">
                          {t("mySkills.organization.skillCount", { count: group.skills.length })}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted">
                        {group.kind === "name_collision"
                          ? t("mySkills.organization.confirmedKeepGrouped")
                          : t("mySkills.organization.confirmedRelation")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onUndoDecision(group.id)}
                      className="app-button-secondary shrink-0"
                    >
                      {t("mySkills.organization.undoDecision")}
                    </button>
                  </div>
                </article>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

function issueCopy(kind: SkillIssue["kind"], t: ReturnType<typeof useTranslation>["t"]) {
  if (kind === "format_health") return {
    title: t("mySkills.organization.issues.formatHealth.title"),
    fact: t("mySkills.organization.issues.formatHealth.fact"),
    recommendation: t("mySkills.organization.issues.formatHealth.recommendation"),
    impact: t("mySkills.organization.issues.formatHealth.impact"),
    direct: false,
  };
  if (kind === "source_missing") return {
    title: t("mySkills.organization.issues.sourceMissing.title"),
    fact: t("mySkills.organization.issues.sourceMissing.fact"),
    recommendation: t("mySkills.organization.issues.sourceMissing.recommendation"),
    impact: t("mySkills.organization.issues.sourceMissing.impact"),
    direct: false,
  };
  if (kind === "sync_conflict") return {
    title: t("mySkills.organization.issues.syncConflict.title"),
    fact: t("mySkills.organization.issues.syncConflict.fact"),
    recommendation: t("mySkills.organization.issues.syncConflict.recommendation"),
    impact: t("mySkills.organization.issues.syncConflict.impact"),
    direct: false,
  };
  if (kind === "read_error") return {
    title: t("mySkills.organization.issues.readError.title"),
    fact: t("mySkills.organization.issues.readError.fact"),
    recommendation: t("mySkills.organization.issues.readError.recommendation"),
    impact: t("mySkills.organization.issues.readError.impact"),
    direct: false,
  };
  const relation = relationCopy(kind, t);
  return {
    title: kind === "name_collision"
      ? t("mySkills.organization.issues.nameCollisionTitle")
      : t("mySkills.organization.issues.duplicateTitle"),
    fact: relation.fact,
    recommendation: relation.recommendation,
    impact: relation.impact,
    direct: relation.tone === "safe",
  };
}

export function SkillIssuesView({
  issues,
  resolvedIds,
  executionMode,
  executionOptions,
  onExecutionModeChange,
  onExecuteBatch,
  onHandOff,
  agentAssessments,
  agentError,
  processingBatch,
  refreshing,
  onRefresh,
  onDecide,
  search,
  displayNames,
  tools,
  onOpenSkill,
}: IssuesProps) {
  const { t } = useTranslation();
  const [executionMenuOpen, setExecutionMenuOpen] = useState(false);
  const executionMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!executionMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (!executionMenuRef.current?.contains(event.target as Node)) setExecutionMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [executionMenuOpen]);
  const unresolvedIssues = issues.filter((issue) => !resolvedIds.has(issue.id));
  const visibleIssues = unresolvedIssues.filter((issue) => {
    const copy = issueCopy(issue.kind, t);
    return matchesSearch(issue.skills, copy.title, search);
  });
  const ruleDiagnosedIssues = unresolvedIssues.filter((issue) => issue.decisionTier === "rule_diagnosed");
  const semanticIssues = unresolvedIssues.filter((issue) => issue.decisionTier === "needs_semantic");
  const blockedIssues = unresolvedIssues.filter((issue) => issue.decisionTier === "blocked");
  const selectedExecution = executionOptions.find((option) => option.id === executionMode) ?? executionOptions[0];

  return (
    <div className="space-y-4 pb-8">
      <div className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold text-primary">{t("mySkills.organization.issuesTitle")}</h2>
            <p className="mt-1 text-[12px] leading-5 text-muted">{t("mySkills.organization.issuesIntro")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-center">
              <div className="text-[17px] font-semibold text-emerald-600 dark:text-emerald-300">{ruleDiagnosedIssues.length}</div>
              <div className="text-[10px] text-emerald-600/80 dark:text-emerald-300/80">{t("mySkills.organization.ruleDiagnosedCount")}</div>
            </div>
            <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-center">
              <div className="text-[17px] font-semibold text-amber-600 dark:text-amber-300">{semanticIssues.length}</div>
              <div className="text-[10px] text-amber-600/80 dark:text-amber-300/80">{t("mySkills.organization.semanticCount")}</div>
            </div>
            {blockedIssues.length > 0 && (
              <div className="rounded-lg bg-violet-500/10 px-3 py-2 text-center">
                <div className="text-[17px] font-semibold text-red-600 dark:text-red-300">{blockedIssues.length}</div>
                <div className="text-[10px] text-red-600/80 dark:text-red-300/80">{t("mySkills.organization.blockedCount")}</div>
              </div>
            )}
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="app-button-secondary h-10"
              title={t("mySkills.organization.refreshHint")}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              {refreshing ? t("mySkills.organization.refreshing") : t("mySkills.organization.refresh")}
            </button>
          </div>
        </div>
        {semanticIssues.length > 1 && (
          <div className="mt-4 flex items-center justify-between rounded-lg border border-accent/20 bg-accent-bg px-3 py-2.5">
            <div>
              <div className="text-[12px] font-semibold text-secondary">
                {t("mySkills.organization.batchTitle", { count: semanticIssues.length })}
              </div>
              <div className="mt-0.5 text-[11px] text-muted">{t("mySkills.organization.batchHint")}</div>
            </div>
            <div ref={executionMenuRef} className="relative flex shrink-0 items-stretch rounded-xl bg-emerald-600 text-white shadow-sm transition-shadow hover:shadow-md">
              <button
                type="button"
                onClick={() => onExecuteBatch(semanticIssues)}
                disabled={processingBatch}
                className="flex min-w-[230px] items-center gap-3 rounded-l-xl px-4 py-2.5 text-left transition-colors hover:bg-white/10 disabled:opacity-60"
              >
                {processingBatch
                  ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                  : <CheckCircle2 className="h-5 w-5 shrink-0" />}
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold leading-5">
                    {processingBatch
                      ? t("mySkills.organization.processingBatch")
                      : t("mySkills.organization.batchAction", { count: semanticIssues.length })}
                  </span>
                  <span className="block truncate text-[10px] leading-4 text-white/75">
                    {selectedExecution?.description}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setExecutionMenuOpen((open) => !open)}
                disabled={processingBatch}
                className="flex w-10 items-center justify-center rounded-r-xl border-l border-white/20 transition-colors hover:bg-white/10 disabled:opacity-60"
                aria-label={t("mySkills.organization.chooseAgent")}
                aria-expanded={executionMenuOpen}
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", executionMenuOpen && "rotate-180")} />
              </button>
              {executionMenuOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 min-w-[260px] overflow-hidden rounded-xl border border-border bg-surface p-1.5 text-primary shadow-2xl">
                  {executionOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        onExecutionModeChange(option.id);
                        setExecutionMenuOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-hover",
                        option.id === executionMode && "bg-accent-bg",
                      )}
                    >
                      <span className="mt-0.5 flex h-4 w-4 items-center justify-center">
                        {option.id === executionMode && <CheckCircle2 className="h-4 w-4 text-accent-light" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-semibold text-secondary">{option.label}</span>
                        <span className="mt-0.5 block text-[10px] leading-4 text-muted">{option.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {agentError && (
        <section className="rounded-xl border border-red-500/25 bg-red-500/5 p-4 shadow-card">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-primary">
                  {t("mySkills.organization.agentErrorTitle")}
                </h3>
                <p className="mt-1 text-[11px] leading-4 text-muted">
                  {t("mySkills.organization.agentErrorHint")}
                </p>
              </div>
            </div>
          </div>
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-border-faint bg-bg-secondary/70 p-3 text-[11px] leading-5 text-secondary">
            {agentError}
          </pre>
        </section>
      )}

      {visibleIssues.length === 0 ? (
        <div className="app-panel py-16 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
          <div className="text-[13px] font-medium text-secondary">{t("mySkills.organization.noIssues")}</div>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleIssues.map((issue) => {
            const copy = issueCopy(issue.kind, t);
            const agentAssessment = agentAssessments.get(issue.id);
            return (
              <article key={issue.id} className="app-panel overflow-hidden shadow-card">
                <div className="flex items-start gap-4 p-4">
                  <div className={cn(
                    "mt-0.5 rounded-lg p-2",
                    issue.decisionTier === "rule_diagnosed"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                      : issue.decisionTier === "blocked"
                        ? "bg-red-500/10 text-red-600 dark:text-red-300"
                        : "bg-amber-500/10 text-amber-600 dark:text-amber-300",
                  )}>
                    {issue.decisionTier === "rule_diagnosed"
                      ? <ShieldCheck className="h-4 w-4" />
                      : issue.decisionTier === "blocked"
                        ? <CircleAlert className="h-4 w-4" />
                        : <GitCompareArrows className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-primary">{copy.title}</h3>
                      <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-muted">
                        {t("mySkills.organization.skillCount", { count: issue.skills.length })}
                      </span>
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        issue.decisionTier === "rule_diagnosed"
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : issue.decisionTier === "blocked"
                            ? "bg-red-500/10 text-red-700 dark:text-red-300"
                            : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                      )}>
                        {t(`mySkills.organization.tiers.${issue.decisionTier}`)}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-muted">{copy.fact}</p>
                    {issue.details && issue.details.length > 0 && (
                      <ul className="mt-2 space-y-1 text-[11px] leading-4 text-amber-700 dark:text-amber-200">
                        {issue.details.map((detail) => <li key={detail}>· {detail}</li>)}
                      </ul>
                    )}
                    <div className="mt-3 grid gap-2 lg:grid-cols-2">
                      {issue.skills.map((skill) => (
                        <MemberRow
                          key={skill.id}
                          skill={skill}
                          displayName={displayNames.get(skill.id) || skill.name}
                          tools={tools}
                          onOpen={() => onOpenSkill(skill.id)}
                        />
                      ))}
                    </div>
                    {agentAssessment && (
                      <div className={cn(
                        "mt-3 rounded-lg border px-3 py-3",
                        agentAssessment.stale
                          ? "border-amber-500/25 bg-amber-500/5"
                          : "border-accent/20 bg-accent-bg",
                      )}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-2">
                            <Bot className="mt-0.5 h-4 w-4 shrink-0 text-accent-light" />
                            <div>
                              <div className="text-[11px] font-semibold text-secondary">
                                {agentAssessment.agentName} · {t(`mySkills.organization.agentRelations.${agentAssessment.assessment.relation_hypothesis}`)}
                              </div>
                              <p className="mt-1 text-[12px] leading-5 text-secondary">
                                {agentAssessment.assessment.difference_summary}
                              </p>
                            </div>
                          </div>
                          <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[10px] text-muted">
                            {Math.round(agentAssessment.assessment.confidence * 100)}%
                          </span>
                        </div>
                        {agentAssessment.stale ? (
                          <p className="mt-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                            {t("mySkills.organization.agentResultStale")}
                          </p>
                        ) : (
                          <>
                            <ul className="mt-2 space-y-1 text-[11px] leading-4 text-muted">
                              {agentAssessment.assessment.evidence.slice(0, 3).map((item, index) => (
                                <li key={`${item.strength}-${index}`}>· {item.claim}</li>
                              ))}
                            </ul>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {agentAssessment.assessment.suggested_actions.map((action) => (
                                <span key={action} className="rounded-full bg-surface px-2 py-1 text-[10px] font-medium text-secondary">
                                  {t(`mySkills.organization.agentActions.${action}`)}
                                </span>
                              ))}
                            </div>
                            <p className="mt-2 text-[10px] text-faint">
                              {t("mySkills.organization.agentAssessmentHint")}
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid border-t border-border-faint bg-bg-secondary/40 md:grid-cols-2">
                  <div className="border-b border-border-faint px-4 py-3 md:border-b-0 md:border-r">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{t("mySkills.organization.recommendation")}</div>
                    <div className="mt-1 text-[12px] font-medium text-secondary">{copy.recommendation}</div>
                  </div>
                  <div className="px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{t("mySkills.organization.impact")}</div>
                    <div className="mt-1 text-[12px] text-muted">{copy.impact}</div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-border-faint px-4 py-3">
                  {issue.decisionTier === "needs_semantic" && (
                    <>
                      <button type="button" onClick={() => onDecide(issue, "intentional_distinct")} className="app-button-secondary">
                        {t("mySkills.organization.keepDistinct")}
                      </button>
                      <button type="button" onClick={() => onDecide(issue, "related")} className="app-button-secondary">
                        {t("mySkills.organization.confirmRelated")}
                      </button>
                      <button type="button" onClick={() => onHandOff(issue)} className="app-button-primary">
                        <Bot className="h-3.5 w-3.5" />
                        {t("mySkills.organization.compareItems")}
                      </button>
                    </>
                  )}
                  {issue.decisionTier === "rule_diagnosed" && issue.caseRevision && (
                    <button type="button" onClick={() => onDecide(issue, "related")} className="app-button-primary">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t("mySkills.organization.confirmRelation")}
                    </button>
                  )}
                  {issue.decisionTier === "blocked" && (
                    <button type="button" onClick={onRefresh} className="app-button-secondary">
                      <RefreshCw className="h-3.5 w-3.5" />
                      {t("mySkills.organization.recheck")}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
