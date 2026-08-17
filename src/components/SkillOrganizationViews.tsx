import {
  ArrowLeft,
  ArrowRight,
  ArchiveRestore,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleHelp,
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
  OrganizationArchivePreview,
  OrganizationDisposition,
  OrganizationOperationSummary,
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
  onApplyBatchConclusions: (issues: SkillIssue[]) => void;
  onHandOff: (issue: SkillIssue) => void;
  agentAssessments: Map<string, OrganizationAgentDisplayAssessment>;
  agentError: string | null;
  processingBatch: boolean;
  processingConclusions: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onDecide: (issue: SkillIssue, disposition: OrganizationDisposition) => void;
  onPreviewArchive: (issue: SkillIssue, keepSkillId: string, archiveSkillId: string) => Promise<OrganizationArchivePreview>;
  onApplyArchive: (issue: SkillIssue, keepSkillId: string, archiveSkillId: string) => Promise<void>;
}

interface ProcessedProps {
  issues: SkillIssue[];
  resolvedIds: Set<string>;
  operations: OrganizationOperationSummary[];
  search: string;
  displayNames: Map<string, string>;
  onUndoDecision: (caseKey: string) => void;
  onUndoOperation: (operationId: string) => Promise<void>;
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

function RecommendationTag({
  label,
  reason,
  helpLabel,
}: {
  label: string;
  reason: string;
  helpLabel: string;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-bg px-2 py-1 text-[10px] font-semibold text-accent-light">
      {label}
      <span
        className="group/reason relative inline-flex"
        tabIndex={0}
        aria-label={`${helpLabel}：${reason}`}
        title={reason}
        onClick={(event) => event.preventDefault()}
      >
        <CircleHelp className="h-3 w-3" aria-hidden="true" />
        <span
          role="tooltip"
          className="pointer-events-none invisible absolute bottom-full right-0 z-20 mb-2 w-72 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-left text-[10px] font-normal leading-4 text-secondary opacity-0 shadow-lg transition-opacity group-hover/reason:visible group-hover/reason:opacity-100 group-focus/reason:visible group-focus/reason:opacity-100"
        >
          {reason}
        </span>
      </span>
    </span>
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
  onApplyBatchConclusions,
  onHandOff,
  agentAssessments,
  agentError,
  processingBatch,
  processingConclusions,
  refreshing,
  onRefresh,
  onDecide,
  onPreviewArchive,
  onApplyArchive,
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
  const [keepSkillId, setKeepSkillId] = useState<string | null>(null);
  const [archivePreview, setArchivePreview] = useState<OrganizationArchivePreview | null>(null);
  const [previewingArchive, setPreviewingArchive] = useState(false);
  const [applyingArchive, setApplyingArchive] = useState(false);
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
    const categoryIssues = searchedIssues.filter((issue) => issueCategory(issue) === definition.id);
    return {
      ...definition,
      issues: categoryIssues,
      skillCount: new Set(categoryIssues.flatMap((issue) => issue.skills.map((skill) => skill.id))).size,
    };
  }).filter((category) => category.issues.length > 0);
  const currentCategory = categories.find((category) => category.id === selectedCategory);
  const categoryIssues = searchedIssues.filter((issue) => issueCategory(issue) === selectedCategory);
  const formatBuckets = [...new Set(
    searchedIssues
      .filter((issue) => issueCategory(issue) === "format")
      .flatMap((issue) => issue.healthCodes ?? ["unknown"]),
  )].map((code) => {
    const bucketIssues = searchedIssues.filter((issue) =>
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
  const assessedSemanticIssues = semanticIssues.filter((issue) => {
    const assessment = agentAssessments.get(issue.id);
    return assessment && !assessment.stale;
  });
  const actionableSemanticIssues = assessedSemanticIssues.filter((issue) => {
    const recommendation = agentAssessments.get(issue.id)?.assessment;
    if (!recommendation) return false;
    if (recommendation.recommended_action === "keep_both") return true;
    return recommendation.recommended_action === "archive_one"
      && issue.skills.length === 2
      && issue.skills.some((skill) => skill.id === recommendation.recommended_keep_skill_id);
  });
  const batchArchiveCount = actionableSemanticIssues.filter((issue) =>
    agentAssessments.get(issue.id)?.assessment.recommended_action === "archive_one").length;
  const batchKeepBothCount = actionableSemanticIssues.length - batchArchiveCount;
  const batchNeedsEvidenceCount = semanticIssues.length - actionableSemanticIssues.length;
  const hasBatchAssessments = assessedSemanticIssues.length > 0;
  const selectedExecution = executionOptions.find((option) => option.id === executionMode) ?? executionOptions[0];
  const activeAgentAssessment = activeIssue ? agentAssessments.get(activeIssue.id) : undefined;
  const recommendedKeepSkillId = activeAgentAssessment?.assessment.recommended_action === "archive_one"
    ? activeAgentAssessment.assessment.recommended_keep_skill_id
    : null;
  const activeDeterministicArchive = !!activeIssue
    && activeIssue.decisionTier === "rule_diagnosed"
    && (activeIssue.kind === "exact_duplicate" || activeIssue.kind === "content_alias")
    && activeIssue.skills.length === 2;
  const activeArchiveRecommended = activeDeterministicArchive
    || (!!activeIssue
      && activeIssue.decisionTier === "needs_semantic"
      && !!activeAgentAssessment
      && !activeAgentAssessment.stale
      && activeAgentAssessment.assessment.recommended_action === "archive_one");

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

  const selectedCategoryStillExists = !selectedCategory
    || unresolvedIssues.some((issue) => issueCategory(issue) === selectedCategory);

  useEffect(() => {
    if (selectedCategoryStillExists) return;
    setSelectedCategory(null);
    setSelectedHealthCode(null);
    setSelectedIssueId(null);
  }, [selectedCategoryStillExists]);

  useEffect(() => {
    const recommendedId = activeIssue?.skills.some((skill) => skill.id === recommendedKeepSkillId)
      ? recommendedKeepSkillId
      : null;
    setKeepSkillId(recommendedId ?? activeIssue?.skills[0]?.id ?? null);
    setArchivePreview(null);
  }, [activeIssue?.id, activeIssue?.skills, recommendedKeepSkillId]);

  useEffect(() => {
    if (!activeIssue || !activeArchiveRecommended || !keepSkillId) return;
    if (!activeIssue.skills.some((skill) => skill.id === keepSkillId)) return;
    const archiveId = activeIssue.skills.find((skill) => skill.id !== keepSkillId)?.id;
    if (!archiveId) return;
    let cancelled = false;
    setPreviewingArchive(true);
    setArchivePreview(null);
    onPreviewArchive(activeIssue, keepSkillId, archiveId)
      .then((preview) => {
        if (!cancelled) setArchivePreview(preview);
      })
      .catch(() => {
        // The parent owns the user-facing error toast. A retry action remains visible.
      })
      .finally(() => {
        if (!cancelled) setPreviewingArchive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeArchiveRecommended, activeIssue, keepSkillId, onPreviewArchive]);

  const previewArchivePlan = async (issue: SkillIssue) => {
    const keepId = keepSkillId ?? issue.skills[0]?.id;
    const archiveId = issue.skills.find((skill) => skill.id !== keepId)?.id;
    if (!keepId || !archiveId) return;
    setPreviewingArchive(true);
    try {
      setArchivePreview(await onPreviewArchive(issue, keepId, archiveId));
    } catch {
      // The parent owns the user-facing error toast.
    } finally {
      setPreviewingArchive(false);
    }
  };

  const applyArchivePlan = async (issue: SkillIssue) => {
    if (!archivePreview) return;
    setApplyingArchive(true);
    try {
      await onApplyArchive(issue, archivePreview.keep_skill_id, archivePreview.archive_skill_id);
      setArchivePreview(null);
    } catch {
      // The parent owns the user-facing error toast.
    } finally {
      setApplyingArchive(false);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <div className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="min-w-[54px] shrink-0 pt-0.5">
              <div className="text-[24px] font-semibold leading-none tracking-tight text-primary">
                {currentCategory?.issues.length ?? unresolvedIssues.length}
              </div>
              <div className="mt-1 text-[10px] text-muted">{t("mySkills.organization.issueDirectory.events")}</div>
            </div>
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
          </div>
          <div className="flex shrink-0 items-center gap-2">
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
                  className="group rounded-xl border border-border-faint bg-bg-secondary/55 p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-border-subtle hover:shadow-sm"
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
          <div className="scm-support-section mt-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-[12px] font-semibold text-secondary">
                {hasBatchAssessments
                  ? t("mySkills.organization.batchResultsTitle", {
                      assessed: assessedSemanticIssues.length,
                      total: semanticIssues.length,
                    })
                  : t("mySkills.organization.batchTitle", { count: semanticIssues.length })}
              </div>
              <div className="mt-0.5 text-[11px] text-muted">
                {hasBatchAssessments
                  ? t("mySkills.organization.batchResultsHint", {
                      archive: batchArchiveCount,
                      keep: batchKeepBothCount,
                      pending: batchNeedsEvidenceCount,
                    })
                  : t("mySkills.organization.batchHint")}
              </div>
            </div>
            <div className="flex shrink-0 items-stretch gap-2">
              {actionableSemanticIssues.length > 0 && (
                <button
                  type="button"
                  onClick={() => onApplyBatchConclusions(actionableSemanticIssues)}
                  disabled={processingConclusions || processingBatch}
                  className="flex min-w-[230px] items-center gap-3 rounded-lg bg-emerald-600 px-4 py-2.5 text-left text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
                >
                  {processingConclusions
                    ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                    : <CheckCircle2 className="h-5 w-5 shrink-0" />}
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold leading-5">
                      {processingConclusions
                        ? t("mySkills.organization.applyingBatchConclusions")
                        : t("mySkills.organization.applyBatchConclusions", { count: actionableSemanticIssues.length })}
                    </span>
                    <span className="block truncate text-[10px] leading-4 text-white/75">
                      {t("mySkills.organization.batchActionImpact", {
                        archive: batchArchiveCount,
                        keep: batchKeepBothCount,
                      })}
                    </span>
                  </span>
                </button>
              )}
              <div
                ref={executionMenuRef}
                className={cn(
                  "relative flex items-stretch rounded-lg",
                  hasBatchAssessments
                    ? "border border-border-subtle bg-surface text-secondary"
                    : "bg-emerald-600 text-white",
                )}
              >
              <button
                type="button"
                onClick={() => onExecuteBatch(semanticIssues)}
                disabled={processingBatch || processingConclusions}
                className={cn(
                  "flex min-w-[210px] items-center gap-3 rounded-l-lg px-4 py-2.5 text-left transition-colors disabled:opacity-60",
                  hasBatchAssessments ? "hover:bg-surface-hover" : "hover:bg-white/10",
                )}
              >
                {processingBatch
                  ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                  : <CheckCircle2 className="h-5 w-5 shrink-0" />}
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold leading-5">
                    {processingBatch
                      ? t("mySkills.organization.processingBatch")
                      : hasBatchAssessments
                        ? t("mySkills.organization.compareAgainBatch", { count: semanticIssues.length })
                        : t("mySkills.organization.batchAction", { count: semanticIssues.length })}
                  </span>
                  <span className={cn(
                    "block truncate text-[10px] leading-4",
                    hasBatchAssessments ? "text-muted" : "text-white/75",
                  )}>
                    {selectedExecution?.description}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setExecutionMenuOpen((open) => !open)}
                disabled={processingBatch || processingConclusions}
                className={cn(
                  "flex w-10 items-center justify-center rounded-r-lg border-l transition-colors disabled:opacity-60",
                  hasBatchAssessments
                    ? "border-border-subtle hover:bg-surface-hover"
                    : "border-white/20 hover:bg-white/10",
                )}
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
        <div className="app-panel grid items-start overflow-hidden shadow-card lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="max-h-[680px] overflow-y-auto border-b border-border-faint bg-bg-secondary/35 p-2 lg:sticky lg:top-4 lg:border-b-0 lg:border-r">
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
            <div className="py-16 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
              <div className="text-[13px] font-medium text-secondary">{t("mySkills.organization.noIssues")}</div>
            </div>
          ) : (
          <div className="min-w-0">
          {visibleIssues.map((issue) => {
            const copy = issueCopy(issue.kind, t);
            const agentAssessment = agentAssessments.get(issue.id);
            const currentAgentAssessment = agentAssessment && !agentAssessment.stale
              ? agentAssessment
              : undefined;
            const deterministicArchive = issue.decisionTier === "rule_diagnosed"
              && (issue.kind === "exact_duplicate" || issue.kind === "content_alias")
              && issue.skills.length === 2;
            const agentRecommendation = deterministicArchive
              ? "archive_one"
              : agentAssessment?.assessment.recommended_action;
            const recommendedKeep = issue.skills.find(
              (skill) => skill.id === agentAssessment?.assessment.recommended_keep_skill_id,
            );
            const actionKeepSkill = issue.skills.find((skill) => skill.id === keepSkillId)
              ?? recommendedKeep
              ?? issue.skills[0];
            const actionArchiveSkill = actionKeepSkill
              ? issue.skills.find((skill) => skill.id !== actionKeepSkill.id)
              : undefined;
            const showActionPlan = deterministicArchive
              || (issue.decisionTier === "needs_semantic" && !!agentAssessment && !agentAssessment.stale);
            const archiveRecommendationReason = deterministicArchive
              ? t("mySkills.organization.actionPlan.exactConclusion")
              : agentAssessment?.assessment.recommendation_reason
                || t("mySkills.organization.actionPlan.legacyConclusion");
            const hasAgentArchiveRecommendation = !deterministicArchive
              && agentRecommendation === "archive_one"
              && !!recommendedKeep;
            return (
              <article key={issue.id} className="overflow-hidden">
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
                    {agentAssessment?.stale && (
                      <div className="scm-agent-assessment flex items-start gap-2">
                        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                        <p className="text-[11px] font-medium leading-4 text-amber-700 dark:text-amber-300">
                          {t("mySkills.organization.agentResultStale")}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid border-t border-border-faint bg-bg-secondary/40 md:grid-cols-2">
                  <div className="border-b border-border-faint px-4 py-3 md:border-b-0 md:border-r">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                        {currentAgentAssessment
                          ? t("mySkills.organization.agentReviewedOpinion", { agent: currentAgentAssessment.agentName })
                          : t("mySkills.organization.recommendation")}
                      </div>
                      {currentAgentAssessment && (
                        <span className="shrink-0 text-[10px] tabular-nums text-faint">
                          {Math.round(currentAgentAssessment.assessment.confidence * 100)}%
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[12px] font-medium leading-5 text-secondary">
                      {currentAgentAssessment
                        ? currentAgentAssessment.assessment.difference_summary
                        : copy.recommendation}
                    </div>
                    {currentAgentAssessment && (
                      <div className="mt-1 text-[10px] text-faint">
                        {t(`mySkills.organization.agentRelations.${currentAgentAssessment.assessment.relation_hypothesis}`)}
                      </div>
                    )}
                  </div>
                  <div className="px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                      {currentAgentAssessment
                        ? t("mySkills.organization.agentReviewedRecommendation", { agent: currentAgentAssessment.agentName })
                        : t("mySkills.organization.impact")}
                    </div>
                    <div className="mt-1 text-[12px] leading-5 text-muted">
                      {currentAgentAssessment
                        ? currentAgentAssessment.assessment.recommendation_reason
                        : copy.impact}
                    </div>
                  </div>
                </div>
                {showActionPlan && (
                  <section className="border-t border-border-faint bg-surface px-4 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                          {t("mySkills.organization.actionPlan.title")}
                        </div>
                        {agentRecommendation !== "archive_one" && (
                          <>
                            <h4 className="mt-1 text-[13px] font-semibold text-primary">
                              {agentRecommendation === "keep_both"
                              ? t("mySkills.organization.actionPlan.keepBothConclusion")
                              : t("mySkills.organization.actionPlan.moreEvidenceConclusion")}
                            </h4>
                            <p className="mt-1 text-[11px] leading-4 text-muted">
                              {agentAssessment?.assessment.recommendation_reason
                                || t("mySkills.organization.actionPlan.legacyConclusion")}
                            </p>
                          </>
                        )}
                      </div>
                      <span className="shrink-0 text-[10px] font-medium text-muted">
                        {t("mySkills.organization.actionPlan.notApplied")}
                      </span>
                    </div>
                    {agentRecommendation === "archive_one"
                    && actionKeepSkill
                    && actionArchiveSkill
                    && issue.skills.length === 2 ? (
                      <>
                        <fieldset
                          className="scm-radio-group"
                          aria-label={t("mySkills.organization.actionPlan.archiveConclusion", {
                            keep: displayNames.get(actionKeepSkill.id) || actionKeepSkill.name,
                            archive: displayNames.get(actionArchiveSkill.id) || actionArchiveSkill.name,
                          })}
                        >
                          {issue.skills.map((skill) => {
                            const selected = keepSkillId === skill.id;
                            const agentRecommendsKeeping = hasAgentArchiveRecommendation
                              && skill.id === recommendedKeep.id;
                            const showRecommendation = hasAgentArchiveRecommendation
                              ? agentRecommendsKeeping
                              : selected;
                            const recommendationLabel = hasAgentArchiveRecommendation
                              ? t("mySkills.organization.actionPlan.agentKeepThis", { agent: agentAssessment?.agentName })
                              : t("mySkills.organization.actionPlan.keepThis");
                            return (
                              <label
                                key={skill.id}
                                className="scm-radio-option"
                              >
                                <input
                                  type="radio"
                                  name={`organization-keep-${issue.id}`}
                                  value={skill.id}
                                  checked={selected}
                                  onChange={() => {
                                    setKeepSkillId(skill.id);
                                    setArchivePreview(null);
                                    setPreviewingArchive(true);
                                  }}
                                  className="scm-radio-control"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[12px] font-semibold text-secondary">
                                    {displayNames.get(skill.id) || skill.name}
                                  </span>
                                  <span className="mt-0.5 block truncate text-[10px] text-muted">{sourceLabel(skill)}</span>
                                </span>
                                {showRecommendation && (
                                  <RecommendationTag
                                    label={recommendationLabel}
                                    reason={archiveRecommendationReason}
                                    helpLabel={t("mySkills.organization.actionPlan.whyRecommended")}
                                  />
                                )}
                              </label>
                            );
                          })}
                        </fieldset>
                        {(archivePreview || previewingArchive) && (
                          <div className="scm-execution-summary">
                            {archivePreview ? (
                              <>
                                <div className="text-[11px] font-semibold text-secondary">
                                  {t("mySkills.organization.actionPlan.previewTitle")}
                                </div>
                                <ul className="mt-2 space-y-1 text-[11px] leading-4 text-muted">
                                  <li>· {t("mySkills.organization.actionPlan.keepNamed", { name: archivePreview.keep_name })}</li>
                                  <li>· {t("mySkills.organization.actionPlan.archiveNamed", { name: archivePreview.archive_name })}</li>
                                  {archivePreview.source_effect && (
                                    <li>· {t("mySkills.organization.actionPlan.sourceRewired", {
                                      agent: archivePreview.source_effect.tool,
                                      path: archivePreview.source_effect.source_path,
                                    })}</li>
                                  )}
                                  {archivePreview.target_effects.map((effect) => (
                                    <li key={`${effect.tool}:${effect.target_path}`}>
                                      · {effect.action === "rewire_to_keep"
                                        ? t("mySkills.organization.actionPlan.rewireAgent", { agent: effect.tool })
                                        : t("mySkills.organization.actionPlan.removeRedundant", { agent: effect.tool })}
                                    </li>
                                  ))}
                                  {archivePreview.source_preserved && (
                                    <li>· {t("mySkills.organization.actionPlan.sourcePreserved")}</li>
                                  )}
                                  <li>· {t("mySkills.organization.actionPlan.undoable")}</li>
                                </ul>
                              </>
                            ) : (
                              <div className="flex min-h-20 items-center gap-2 text-[11px] text-muted">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                {t("mySkills.organization.actionPlan.checkingImpact")}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="mt-3 flex min-h-10 items-center justify-between gap-3">
                          {issue.decisionTier === "needs_semantic" ? (
                            <button
                              type="button"
                              onClick={() => onHandOff(issue)}
                              className="scm-button-tertiary h-10"
                            >
                              {t("mySkills.organization.compareAgain")}
                            </button>
                          ) : <span />}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onDecide(issue, "related")}
                              className="app-button-secondary h-10"
                            >
                              {t("mySkills.organization.actionPlan.overrideKeepBoth")}
                            </button>
                            {!archivePreview ? (
                              <button
                                type="button"
                                onClick={() => previewArchivePlan(issue)}
                                disabled={previewingArchive}
                                className="app-button-primary h-10"
                              >
                                {previewingArchive && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                {previewingArchive
                                  ? t("mySkills.organization.actionPlan.checkingImpact")
                                  : t("mySkills.organization.actionPlan.retryImpactCheck")}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => applyArchivePlan(issue)}
                                disabled={applyingArchive}
                                className="app-button-primary h-10"
                              >
                                {applyingArchive && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                {t("mySkills.organization.actionPlan.executeKeepNamed", {
                                  keep: archivePreview.keep_name,
                                })}
                              </button>
                            )}
                          </div>
                        </div>
                      </>
                    ) : agentRecommendation === "keep_both" ? (
                      <div className="mt-3 flex min-h-10 items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => onHandOff(issue)}
                          className="scm-button-tertiary h-10"
                        >
                          {t("mySkills.organization.compareAgain")}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDecide(issue, "related")}
                          className="app-button-primary h-10"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {t("mySkills.organization.actionPlan.applyKeepBoth")}
                        </button>
                      </div>
                    ) : (
                      <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                        {t("mySkills.organization.actionPlan.noSafeAction")}
                      </p>
                    )}
                  </section>
                )}
                <div className="flex items-center justify-end gap-2 border-t border-border-faint px-4 py-3">
                  {issue.decisionTier === "needs_semantic" && !showActionPlan && (
                    <button type="button" onClick={() => onHandOff(issue)} className={agentAssessment ? "app-button-secondary" : "app-button-primary"}>
                      <Bot className="h-3.5 w-3.5" />
                      {agentAssessment
                        ? t("mySkills.organization.compareAgain")
                        : t("mySkills.organization.compareItems")}
                    </button>
                  )}
                  {issue.decisionTier === "rule_diagnosed" && issue.caseRevision && !deterministicArchive && (
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

    </div>
  );
}

export function SkillProcessedView({
  issues,
  resolvedIds,
  operations,
  search,
  displayNames,
  onUndoDecision,
  onUndoOperation,
}: ProcessedProps) {
  const { t } = useTranslation();
  const resolvedIssues = issues.filter((issue) =>
    resolvedIds.has(issue.id) && matchesSearch(issue.skills, issueCopy(issue.kind, t).title, search));
  const query = search.trim().toLocaleLowerCase();
  const visibleOperations = operations.filter((operation) => !query || [
    operation.keep_name,
    operation.archive_name,
    operation.status,
  ].some((value) => value.toLocaleLowerCase().includes(query)));
  const processedCount = resolvedIssues.length + visibleOperations.length;

  return (
    <div className="space-y-4 pb-8">
      <section className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
        <div className="flex items-start gap-3">
          <div className="min-w-[54px] shrink-0 pt-0.5">
            <div className="text-[24px] font-semibold leading-none tracking-tight text-primary">{processedCount}</div>
            <div className="mt-1 text-[10px] text-muted">{t("mySkills.organization.processed.records")}</div>
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-primary">{t("mySkills.organization.processed.title")}</h2>
            <p className="mt-1 text-[12px] leading-5 text-muted">{t("mySkills.organization.processed.intro")}</p>
          </div>
        </div>
      </section>

      <section className="rounded-xl bg-bg-secondary p-4">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-surface p-2 text-muted">
            <ArchiveRestore className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-primary">{t("mySkills.organization.processed.trashTitle")}</h3>
            <p className="mt-1 text-[11px] leading-5 text-muted">{t("mySkills.organization.processed.trashHint")}</p>
            <p className="mt-1 break-all font-mono text-[10px] text-faint">{t("mySkills.organization.processed.trashPath")}</p>
          </div>
        </div>
      </section>

      {resolvedIssues.length > 0 && (
        <section className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
          <div>
            <h2 className="text-[13px] font-semibold text-primary">
              {t("mySkills.organization.confirmedRelations", { count: resolvedIssues.length })}
            </h2>
            <p className="mt-0.5 text-[10.5px] text-muted">{t("mySkills.organization.confirmedRelationsHint")}</p>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2">
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

      {visibleOperations.length > 0 && (
        <section className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
          <div>
            <h2 className="text-[13px] font-semibold text-primary">
              {t("mySkills.organization.operationHistory.title", { count: visibleOperations.length })}
            </h2>
            <p className="mt-0.5 text-[10.5px] text-muted">{t("mySkills.organization.operationHistory.hint")}</p>
          </div>
          <div className="mt-3 space-y-2">
            {visibleOperations.map((operation) => (
              <article key={operation.operation_id} className="flex items-center justify-between gap-3 rounded-lg border border-border-faint bg-bg-secondary/45 px-3 py-2.5">
                <div className="min-w-0">
                  <h3 className="truncate text-[12px] font-semibold text-primary">
                    {operation.status === "undone"
                      ? t("mySkills.organization.operationHistory.undone", { archive: operation.archive_name })
                      : t("mySkills.organization.operationHistory.archived", {
                          keep: operation.keep_name,
                          archive: operation.archive_name,
                        })}
                  </h3>
                  <p className="mt-0.5 text-[10.5px] text-muted">
                    {operation.status === "needs_recovery"
                      ? t("mySkills.organization.operationHistory.needsRecovery")
                      : new Date(operation.updated_at).toLocaleString()}
                  </p>
                </div>
                {operation.status === "complete" && (
                  <button
                    type="button"
                    onClick={() => void onUndoOperation(operation.operation_id)}
                    className="app-button-secondary shrink-0"
                  >
                    {t("mySkills.organization.undo")}
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {processedCount === 0 && (
        <section className="rounded-xl border border-dashed border-border-subtle bg-surface/60 py-14 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-faint" />
          <p className="text-[13px] font-medium text-secondary">{t("mySkills.organization.processed.empty")}</p>
        </section>
      )}
    </div>
  );
}
