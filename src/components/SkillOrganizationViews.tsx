import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  FileWarning,
  GitCompareArrows,
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
  onUndoDecision: (caseKey: string) => void;
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

type IssueCategory = "duplicate" | "same_name" | "format" | "source";

function issueCategory(issue: SkillIssue): IssueCategory {
  if (issue.kind === "exact_duplicate" || issue.kind === "content_alias") return "duplicate";
  if (issue.kind === "name_collision") return "same_name";
  if (issue.kind === "format_health") return "format";
  return "source";
}

function issueMemberNames(issue: SkillIssue, displayNames: Map<string, string>) {
  return issue.skills.map((skill) => displayNames.get(skill.id) || skill.name).join(" / ");
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
  onUndoDecision,
  search,
  displayNames,
  tools,
  onOpenSkill,
}: IssuesProps) {
  const { t } = useTranslation();
  const [executionMenuOpen, setExecutionMenuOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<IssueCategory | null>(null);
  const [selectedHealthCode, setSelectedHealthCode] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
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
  const resolvedIssues = issues.filter((issue) => resolvedIds.has(issue.id));
  const searchedIssues = unresolvedIssues.filter((issue) => {
    const copy = issueCopy(issue.kind, t);
    return matchesSearch(issue.skills, copy.title, search);
  });
  const categoryDefinitions = [
    { id: "duplicate" as const, icon: Copy, tone: "text-emerald-500 bg-emerald-500/10" },
    { id: "same_name" as const, icon: GitCompareArrows, tone: "text-amber-500 bg-amber-500/10" },
    { id: "format" as const, icon: FileWarning, tone: "text-rose-500 bg-rose-500/10" },
    { id: "source" as const, icon: Link2, tone: "text-violet-500 bg-violet-500/10" },
  ];
  const categories = categoryDefinitions.map((definition) => {
    const categoryIssues = unresolvedIssues.filter((issue) => issueCategory(issue) === definition.id);
    return {
      ...definition,
      issues: categoryIssues,
      skillCount: new Set(categoryIssues.flatMap((issue) => issue.skills.map((skill) => skill.id))).size,
    };
  });
  const currentCategory = categories.find((category) => category.id === selectedCategory);
  const categoryIssues = searchedIssues.filter((issue) => issueCategory(issue) === selectedCategory);
  const formatBuckets = [...new Set(
    unresolvedIssues
      .filter((issue) => issueCategory(issue) === "format")
      .flatMap((issue) => issue.healthCodes ?? ["unknown"]),
  )].map((code) => {
    const bucketIssues = unresolvedIssues.filter((issue) =>
      issueCategory(issue) === "format" && (issue.healthCodes ?? ["unknown"]).includes(code));
    return {
      code,
      issues: bucketIssues,
      skillCount: new Set(bucketIssues.flatMap((issue) => issue.skills.map((skill) => skill.id))).size,
    };
  }).sort((a, b) => b.issues.length - a.issues.length || a.code.localeCompare(b.code));
  const narrowedIssues = categoryIssues.filter((issue) =>
    selectedCategory !== "format" || !selectedHealthCode || (issue.healthCodes ?? ["unknown"]).includes(selectedHealthCode));
  const activeIssue = narrowedIssues.find((issue) => issue.id === selectedIssueId) ?? narrowedIssues[0];
  const visibleIssues = activeIssue ? [activeIssue] : [];
  const semanticIssues = selectedCategory === "same_name"
    ? categoryIssues.filter((issue) => issue.decisionTier === "needs_semantic")
    : [];
  const selectedExecution = executionOptions.find((option) => option.id === executionMode) ?? executionOptions[0];

  const openCategory = (category: IssueCategory) => {
    const first = unresolvedIssues.find((issue) => issueCategory(issue) === category);
    setSelectedCategory(category);
    setSelectedHealthCode(null);
    setSelectedIssueId(first?.id ?? null);
  };

  const openHealthBucket = (code: string, bucketIssues: SkillIssue[]) => {
    setSelectedHealthCode(code);
    setSelectedIssueId(bucketIssues[0]?.id ?? null);
  };

  const returnToDirectory = () => {
    setSelectedCategory(null);
    setSelectedHealthCode(null);
    setSelectedIssueId(null);
  };

  return (
    <div className="space-y-4 pb-8">
      <div className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            {selectedCategory ? (
              <button
                type="button"
                onClick={selectedCategory === "format" && selectedHealthCode
                  ? () => {
                    setSelectedHealthCode(null);
                    setSelectedIssueId(null);
                  }
                  : returnToDirectory}
                className="mb-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted transition-colors hover:text-primary"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {selectedCategory === "format" && selectedHealthCode
                  ? t("mySkills.organization.issueDirectory.allFormatCauses")
                  : t("mySkills.organization.issueDirectory.allCategories")}
              </button>
            ) : null}
            <h2 className="text-[15px] font-semibold text-primary">
              {currentCategory
                ? t(`mySkills.organization.issueDirectory.categories.${currentCategory.id}.title`)
                : t("mySkills.organization.issueDirectory.title")}
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-muted">
              {currentCategory
                ? t(`mySkills.organization.issueDirectory.categories.${currentCategory.id}.hint`)
                : t("mySkills.organization.issueDirectory.intro")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="rounded-lg bg-bg-secondary px-3 py-2 text-center">
              <div className="text-[17px] font-semibold text-primary">{currentCategory?.issues.length ?? unresolvedIssues.length}</div>
              <div className="text-[10px] text-muted">{t("mySkills.organization.issueDirectory.events")}</div>
            </div>
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
        {!selectedCategory && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {categories.map((category) => {
              const Icon = category.icon;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => openCategory(category.id)}
                  disabled={category.issues.length === 0}
                  className="group rounded-xl border border-border-faint bg-bg-secondary/55 p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-border-subtle hover:shadow-sm disabled:pointer-events-none disabled:opacity-45"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className={cn("rounded-lg p-2", category.tone)}><Icon className="h-4 w-4" /></span>
                    <ChevronRight className="h-4 w-4 text-faint transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <div className="mt-4 text-[24px] font-semibold tracking-tight text-primary">{category.issues.length}</div>
                  <div className="mt-0.5 text-[13px] font-semibold text-secondary">
                    {t(`mySkills.organization.issueDirectory.categories.${category.id}.title`)}
                  </div>
                  <div className="mt-1 text-[11px] leading-4 text-muted">
                    {t("mySkills.organization.issueDirectory.affectedSkills", { count: category.skillCount })}
                  </div>
                </button>
              );
            })}
          </div>
        )}
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

      {selectedCategory === "format" && !selectedHealthCode ? (
        <section className="space-y-3">
          <div>
            <h3 className="text-[13px] font-semibold text-primary">{t("mySkills.organization.issueDirectory.formatCauses")}</h3>
            <p className="mt-0.5 text-[11px] text-muted">{t("mySkills.organization.issueDirectory.formatCausesHint")}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {formatBuckets.map((bucket) => (
              <button
                key={bucket.code}
                type="button"
                onClick={() => openHealthBucket(bucket.code, bucket.issues)}
                className="group flex items-center justify-between gap-3 rounded-xl border border-border-faint bg-surface p-3.5 text-left shadow-card transition-colors hover:border-border-subtle hover:bg-surface-hover"
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-secondary">
                    {t(`mySkills.organization.issueDirectory.healthCodes.${bucket.code}`, { defaultValue: bucket.code })}
                  </div>
                  <div className="mt-1 text-[11px] text-muted">
                    {t("mySkills.organization.issueDirectory.affectedSkills", { count: bucket.skillCount })}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[18px] font-semibold text-primary">{bucket.issues.length}</span>
                  <ChevronRight className="h-4 w-4 text-faint transition-transform group-hover:translate-x-0.5" />
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : selectedCategory ? (
        <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="app-panel max-h-[680px] overflow-y-auto p-2 shadow-card lg:sticky lg:top-4">
            <div className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-faint">
              {t("mySkills.organization.issueDirectory.caseList", { count: narrowedIssues.length })}
            </div>
            <div className="space-y-1">
              {narrowedIssues.map((issue, index) => (
                <button
                  key={issue.id}
                  type="button"
                  onClick={() => setSelectedIssueId(issue.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                    activeIssue?.id === issue.id ? "bg-accent-bg text-primary" : "text-secondary hover:bg-surface-hover",
                  )}
                >
                  <span className="w-6 shrink-0 text-[10px] tabular-nums text-faint">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold">{issueMemberNames(issue, displayNames)}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted">{issueCopy(issue.kind, t).title}</span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
                </button>
              ))}
            </div>
          </aside>
          {visibleIssues.length === 0 ? (
            <div className="app-panel py-16 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
              <div className="text-[13px] font-medium text-secondary">{t("mySkills.organization.noIssues")}</div>
            </div>
          ) : (
          <div className="min-w-0 space-y-3">
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
      ) : null}

      {resolvedIssues.length > 0 && (
        <section className="space-y-2 pt-2">
          <div>
            <h2 className="text-[13px] font-semibold text-primary">
              {t("mySkills.organization.confirmedRelations", { count: resolvedIssues.length })}
            </h2>
            <p className="mt-0.5 text-[10.5px] text-muted">{t("mySkills.organization.confirmedRelationsHint")}</p>
          </div>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {resolvedIssues.map((issue) => (
              <article key={issue.id} className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2.5">
                <div className="min-w-0">
                  <h3 className="truncate text-[12px] font-semibold text-primary">{issueCopy(issue.kind, t).title}</h3>
                  <p className="mt-0.5 truncate text-[10.5px] text-muted">
                    {issue.skills.map((skill) => displayNames.get(skill.id) || skill.name).join(" / ")}
                  </p>
                </div>
                <button type="button" onClick={() => onUndoDecision(issue.id)} className="app-button-secondary shrink-0">
                  {t("mySkills.organization.undoDecision")}
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
