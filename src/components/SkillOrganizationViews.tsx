import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  CircleAlert,
  GitCompareArrows,
  Layers3,
  Link2,
  ShieldCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ManagedSkill, ToolInfo } from "../lib/tauri";
import type { SkillIssue, SkillRelationGroup } from "../lib/skillOrganization";
import { countSkillsInRelations } from "../lib/skillOrganization";
import { cn } from "../utils";

interface SharedProps {
  skills: ManagedSkill[];
  search: string;
  displayNames: Map<string, string>;
  tools: ToolInfo[];
  onOpenSkill: (skillId: string) => void;
}

interface OrganizeProps extends SharedProps {
  groups: SkillRelationGroup[];
  onShowAll: () => void;
}

interface IssuesProps extends SharedProps {
  issues: SkillIssue[];
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
  groups,
  search,
  displayNames,
  tools,
  onOpenSkill,
  onShowAll,
}: OrganizeProps) {
  const { t } = useTranslation();
  const groupedSkillCount = countSkillsInRelations(groups);
  const visibleGroups = groups.filter((group) => matchesSearch(group.skills, group.label, search));

  return (
    <div className="space-y-4 pb-8">
      <div className="grid grid-cols-3 gap-2">
        <div className="app-panel px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-muted">
            <Layers3 className="h-3.5 w-3.5" />
            {t("mySkills.organization.summary.groups")}
          </div>
          <div className="mt-1 text-[22px] font-semibold text-primary">{groups.length}</div>
          <div className="text-[10px] text-faint">{t("mySkills.organization.summary.groupsHint")}</div>
        </div>
        <div className="app-panel px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-muted">
            <Boxes className="h-3.5 w-3.5" />
            {t("mySkills.organization.summary.grouped")}
          </div>
          <div className="mt-1 text-[22px] font-semibold text-primary">{groupedSkillCount}</div>
          <div className="text-[10px] text-faint">{t("mySkills.organization.summary.groupedHint")}</div>
        </div>
        <button type="button" onClick={onShowAll} className="app-panel px-4 py-3 text-left transition-colors hover:bg-surface-hover">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-muted">
            <CircleAlert className="h-3.5 w-3.5" />
            {t("mySkills.organization.summary.ungrouped")}
          </div>
          <div className="mt-1 text-[22px] font-semibold text-primary">{skills.length - groupedSkillCount}</div>
          <div className="text-[10px] text-faint">{t("mySkills.organization.summary.ungroupedHint")}</div>
        </button>
      </div>

      <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-accent-bg p-2 text-accent-light"><Layers3 className="h-4 w-4" /></div>
          <div>
            <h2 className="text-[14px] font-semibold text-primary">{t("mySkills.organization.organizeTitle")}</h2>
            <p className="mt-0.5 max-w-[760px] text-[12px] leading-5 text-muted">
              {t("mySkills.organization.organizeIntro")}
            </p>
          </div>
        </div>
      </div>

      {visibleGroups.length === 0 ? (
        <div className="app-panel py-16 text-center text-[13px] text-muted">{t("mySkills.organization.noGroups")}</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {visibleGroups.map((group) => {
            const copy = relationCopy(group.kind, t);
            return (
              <article key={group.id} className="app-panel flex flex-col p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-[15px] font-semibold text-primary">{group.label}</h3>
                      <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-medium text-muted">
                        {t("mySkills.organization.skillCount", { count: group.skills.length })}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-muted">{copy.fact}</p>
                  </div>
                  <span className={cn(
                    "shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold",
                    copy.tone === "safe"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-300",
                  )}>
                    {copy.tone === "safe"
                      ? t("mySkills.organization.direct")
                      : t("mySkills.organization.needsDecision")}
                  </span>
                </div>

                <div className="mt-3 space-y-1.5">
                  {group.skills.map((skill) => (
                    <MemberRow
                      key={skill.id}
                      skill={skill}
                      displayName={displayNames.get(skill.id) || skill.name}
                      tools={tools}
                      onOpen={() => onOpenSkill(skill.id)}
                    />
                  ))}
                </div>
                <div className="mt-3 rounded-lg border border-border-faint bg-bg-secondary/50 px-3 py-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                    {t("mySkills.organization.recommendation")}
                  </div>
                  <div className="mt-1 text-[12px] font-medium leading-5 text-secondary">
                    {copy.recommendation}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function issueCopy(kind: SkillIssue["kind"], t: ReturnType<typeof useTranslation>["t"]) {
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
  search,
  displayNames,
  tools,
  onOpenSkill,
}: IssuesProps) {
  const { t } = useTranslation();
  const visibleIssues = issues.filter((issue) => {
    const copy = issueCopy(issue.kind, t);
    return matchesSearch(issue.skills, copy.title, search);
  });
  const directCount = issues.filter((issue) => issue.kind === "exact_duplicate" || issue.kind === "content_alias").length;

  return (
    <div className="space-y-4 pb-8">
      <div className="rounded-xl border border-border-subtle bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold text-primary">{t("mySkills.organization.issuesTitle")}</h2>
            <p className="mt-1 text-[12px] leading-5 text-muted">{t("mySkills.organization.issuesIntro")}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-center">
              <div className="text-[17px] font-semibold text-emerald-600 dark:text-emerald-300">{directCount}</div>
              <div className="text-[10px] text-emerald-600/80 dark:text-emerald-300/80">{t("mySkills.organization.directCount")}</div>
            </div>
            <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-center">
              <div className="text-[17px] font-semibold text-amber-600 dark:text-amber-300">{issues.length - directCount}</div>
              <div className="text-[10px] text-amber-600/80 dark:text-amber-300/80">{t("mySkills.organization.decisionCount")}</div>
            </div>
          </div>
        </div>
      </div>

      {visibleIssues.length === 0 ? (
        <div className="app-panel py-16 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
          <div className="text-[13px] font-medium text-secondary">{t("mySkills.organization.noIssues")}</div>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleIssues.map((issue) => {
            const copy = issueCopy(issue.kind, t);
            return (
              <article key={issue.id} className="app-panel overflow-hidden shadow-card">
                <div className="flex items-start gap-4 p-4">
                  <div className={cn(
                    "mt-0.5 rounded-lg p-2",
                    copy.direct
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-300",
                  )}>
                    {copy.direct ? <ShieldCheck className="h-4 w-4" /> : <GitCompareArrows className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-primary">{copy.title}</h3>
                      <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-muted">
                        {t("mySkills.organization.skillCount", { count: issue.skills.length })}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-muted">{copy.fact}</p>
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
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
