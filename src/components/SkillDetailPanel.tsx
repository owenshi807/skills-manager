import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Folder,
  ChevronDown,
  GitCompareArrows,
  Github,
  HardDrive,
  Loader2,
  Globe,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../utils";
import {
  getSkillDocument,
  getSourceSkillDocument,
  getSkillSourceDiff,
  type ManagedSkill,
  type Project,
  type SkillDocument,
  type SourceSkillDocument,
  type SkillSourceDiff,
  type SkillToolToggle,
  type ToolInfo,
} from "../lib/tauri";
import { SkillSourceDiffViewer } from "./SkillSourceDiffViewer";
import { DetailSheet } from "./DetailSheet";
import { SkillMarkdown } from "./SkillMarkdown";
import { AgentToggleSection, type AgentToggleItem } from "./AgentToggleSection";
import { SkillProjectsSection } from "./SkillProjectsSection";
import { SyncDots } from "./SyncDots";

interface Props {
  skill: ManagedSkill | null;
  onClose: () => void;
  tools?: ToolInfo[];
  toolSkillCounts?: Record<string, number>;
  toolToggles?: SkillToolToggle[] | null;
  togglingTool?: string | null;
  onToggleTool?: (tool: string, enabled: boolean) => void;
  projects?: Project[];
  onProjectsChanged?: () => void;
  readOnly?: boolean;
  showTags?: boolean;
}

export function SkillDetailPanel({
  skill,
  onClose,
  tools,
  toolSkillCounts,
  toolToggles,
  togglingTool,
  onToggleTool,
  projects,
  onProjectsChanged,
  readOnly = false,
  showTags = true,
}: Props) {
  if (!skill) return null;

  const panelKey = [
    skill.id,
    skill.updated_at,
    skill.source_type,
    skill.source_ref ?? "",
    skill.source_revision ?? "",
    skill.remote_revision ?? "",
  ].join(":");

  return (
    <SkillDetailPanelContent
      key={panelKey}
      skill={skill}
      onClose={onClose}
      tools={tools}
      toolSkillCounts={toolSkillCounts}
      toolToggles={toolToggles}
      togglingTool={togglingTool}
      onToggleTool={onToggleTool}
      projects={projects}
      onProjectsChanged={onProjectsChanged}
      readOnly={readOnly}
      showTags={showTags}
    />
  );
}

function SkillDetailPanelContent({
  skill,
  onClose,
  tools,
  toolSkillCounts,
  toolToggles,
  togglingTool,
  onToggleTool,
  projects,
  onProjectsChanged,
  readOnly,
  showTags,
}: {
  skill: ManagedSkill;
  onClose: () => void;
  tools?: ToolInfo[];
  toolSkillCounts?: Record<string, number>;
  toolToggles?: SkillToolToggle[] | null;
  togglingTool?: string | null;
  onToggleTool?: (tool: string, enabled: boolean) => void;
  projects?: Project[];
  onProjectsChanged?: () => void;
  readOnly: boolean;
  showTags: boolean;
}) {
  const { t } = useTranslation();
  const [doc, setDoc] = useState<SkillDocument | null>(null);
  const [sourceDoc, setSourceDoc] = useState<SourceSkillDocument | null>(null);
  const [sourceDiff, setSourceDiff] = useState<SkillSourceDiff | null>(null);
  const [sourceDiffFailed, setSourceDiffFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isMetadataExpanded, setIsMetadataExpanded] = useState(false);
  const [isContentReviewOpen, setIsContentReviewOpen] = useState(false);
  const [contentTab, setContentTab] = useState<"local" | "diff" | "source">("local");
  const localRequestIdRef = useRef(0);
  const sourceRequestIdRef = useRef(0);
  const diffRequestedRef = useRef(false);
  const contentTabsRef = useRef<HTMLDivElement | null>(null);
  const contentTabPillRef = useRef<HTMLSpanElement | null>(null);
  const skillId = skill.id;
  const supportsSourceDiff =
    skill.source_type === "builtin"
    || skill.source_type === "git"
    || skill.source_type === "skillssh"
    || ((skill.source_type === "local" || skill.source_type === "import") && !!skill.source_ref);
  const [sourceLoading, setSourceLoading] = useState(supportsSourceDiff);
  const localDocVersion = `${skill.id}:${skill.updated_at}`;
  const sourceDocVersion = [
    skill.id,
    skill.source_type,
    skill.source_ref ?? "",
    skill.source_ref_resolved ?? "",
    skill.source_revision ?? "",
    skill.remote_revision ?? "",
  ].join(":");

  useEffect(() => {
    localRequestIdRef.current += 1;
    const requestId = localRequestIdRef.current;

    getSkillDocument(skillId)
      .then((nextDoc) => {
        if (requestId === localRequestIdRef.current) {
          setDoc(nextDoc);
        }
      })
      .catch(() => {
        if (requestId === localRequestIdRef.current) {
          setDoc(null);
        }
      })
      .finally(() => {
        if (requestId === localRequestIdRef.current) {
          setLoading(false);
        }
      });
  }, [skillId, localDocVersion]);

  useEffect(() => {
    if (!supportsSourceDiff) {
      return;
    }

    sourceRequestIdRef.current += 1;
    const requestId = sourceRequestIdRef.current;

    getSourceSkillDocument(skillId)
      .then((nextDoc) => {
        if (requestId === sourceRequestIdRef.current) {
          setSourceDoc(nextDoc);
        }
      })
      .catch(() => {
        if (requestId === sourceRequestIdRef.current) {
          setSourceDoc(null);
        }
      })
      .finally(() => {
        if (requestId === sourceRequestIdRef.current) {
          setSourceLoading(false);
        }
      });
  }, [skillId, supportsSourceDiff, sourceDocVersion]);

  // Lazily load the whole-directory diff only when the user opens the Diff
  // tab. For git/skills.sh skills this clones the repo, so we avoid paying
  // that cost (and a second clone alongside the source doc) up front.
  useEffect(() => {
    if (contentTab !== "diff" || !supportsSourceDiff) return;
    if (diffRequestedRef.current) return;
    diffRequestedRef.current = true;

    getSkillSourceDiff(skillId)
      .then((diff) => setSourceDiff(diff))
      .catch(() => setSourceDiffFailed(true));
  }, [contentTab, supportsSourceDiff, skillId]);

  const sourceIcon = (type: string) => {
    switch (type) {
      case "git":
      case "skillssh":
        return <Github className="h-3.5 w-3.5" />;
      case "local":
      case "import":
        return <HardDrive className="h-3.5 w-3.5" />;
      default:
        return <Globe className="h-3.5 w-3.5" />;
    }
  };

  const sourceTypeLabel = (type: string) => (type === "builtin" ? t("mySkills.contentSource.kind.builtin") : type === "skillssh" ? "skills.sh" : type);

  const sourceKindLabel = (type: string) => {
    switch (type) {
      case "git":
        return t("mySkills.contentSource.kind.git");
      case "skillssh":
        return t("mySkills.contentSource.kind.skillssh");
      case "local":
        return t("mySkills.contentSource.kind.local");
      case "import":
        return t("mySkills.contentSource.kind.import");
      default:
        return sourceTypeLabel(type);
    }
  };

  const metadataItems = [
    { label: t("mySkills.sourceType"), value: sourceTypeLabel(skill.source_type) },
    { label: t("mySkills.sourceRef"), value: skill.source_ref },
    { label: t("mySkills.sourceResolved"), value: skill.source_ref_resolved },
    { label: t("mySkills.sourceBranch"), value: skill.source_branch },
    { label: t("mySkills.sourceSubpath"), value: skill.source_subpath },
    { label: t("mySkills.sourceRevision"), value: skill.source_revision },
  ].filter((item) => Boolean(item.value));

  const activeDoc = doc?.skill_id === skill.id ? doc : null;
  const activeSourceDoc = sourceDoc?.skill_id === skill.id ? sourceDoc : null;
  const activeSourceDiff = sourceDiff?.skill_id === skill.id ? sourceDiff : null;
  const sourceDiffLoading =
    contentTab === "diff" && supportsSourceDiff && !activeSourceDiff && !sourceDiffFailed;
  const sourcePath = skill.source_ref_resolved || skill.source_ref;
  const sourceKind = sourceKindLabel(skill.source_type);
  const sourceDiffCount = activeSourceDiff?.entries.length;
  const sourceRevision = activeSourceDoc?.revision;
  const sourceRevisionLabel = sourceRevision && sourceRevision !== "workspace"
    ? t("mySkills.contentSource.revision", { revision: sourceRevision.slice(0, 7) })
    : t("mySkills.contentSource.liveSource");

  const syncContentTabPill = useCallback((animate: boolean) => {
    const bar = contentTabsRef.current;
    const pill = contentTabPillRef.current;
    const activeTab = bar?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!bar || !pill || !activeTab) return;

    if (!animate) {
      const previousTransition = pill.style.transition;
      pill.style.transition = "none";
      pill.style.transform = `translateX(${activeTab.offsetLeft}px)`;
      pill.style.width = `${activeTab.offsetWidth}px`;
      void pill.offsetWidth;
      pill.style.transition = previousTransition;
      return;
    }

    pill.style.transform = `translateX(${activeTab.offsetLeft}px)`;
    pill.style.width = `${activeTab.offsetWidth}px`;
  }, []);

  useLayoutEffect(() => {
    if (!isContentReviewOpen || !supportsSourceDiff) return;

    const frame = requestAnimationFrame(() => syncContentTabPill(false));
    const bar = contentTabsRef.current;
    if (!bar || typeof ResizeObserver === "undefined") {
      return () => cancelAnimationFrame(frame);
    }

    const observer = new ResizeObserver(() => syncContentTabPill(false));
    observer.observe(bar);
    bar.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab) => observer.observe(tab));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [isContentReviewOpen, supportsSourceDiff, syncContentTabPill]);

  useEffect(() => {
    if (!isContentReviewOpen || !supportsSourceDiff) return;
    const frame = requestAnimationFrame(() => syncContentTabPill(true));
    return () => cancelAnimationFrame(frame);
  }, [contentTab, isContentReviewOpen, sourceDiffCount, supportsSourceDiff, syncContentTabPill]);

  const contentSourceSummary = sourceLoading
    ? {
        title: t("mySkills.contentSource.checkingTitle"),
        hint: t("mySkills.contentSource.checkingHint"),
        tone: "text-muted",
      }
    : !activeSourceDoc
      ? {
          title: t("mySkills.contentSource.unavailableTitle"),
          hint: t("mySkills.contentSource.unavailableHint"),
          tone: "text-amber-500",
        }
      : sourceDiffCount === 0
        ? {
            title: t("mySkills.contentSource.identicalTitle"),
            hint: t("mySkills.contentSource.identicalHint"),
            tone: "text-accent-light",
          }
        : typeof sourceDiffCount === "number"
          ? {
              title: t("mySkills.contentSource.differencesTitle", { count: sourceDiffCount }),
              hint: t("mySkills.contentSource.differencesHint"),
              tone: "text-amber-500",
            }
          : {
              title: t("mySkills.contentSource.readyTitle"),
              hint: t("mySkills.contentSource.readyHint"),
              tone: "text-accent-light",
            };

  const contentViewCopy = contentTab === "local"
    ? {
        title: t("mySkills.contentSource.view.managedTitle"),
        hint: t("mySkills.contentSource.view.managedHint"),
      }
    : contentTab === "source"
      ? {
          title: t("mySkills.contentSource.view.sourceTitle"),
          hint: t("mySkills.contentSource.view.sourceHint"),
        }
      : {
          title: t("mySkills.contentSource.view.diffTitle"),
          hint: t("mySkills.contentSource.view.diffHint"),
        };
  const toggleItems: AgentToggleItem[] = (toolToggles ?? []).map((toggle) => ({
    key: toggle.tool,
    displayName: toggle.display_name,
    enabled: toggle.enabled,
    isAvailable: toggle.installed && toggle.globally_enabled,
    skillCount: toggle.installed && toggle.globally_enabled
      ? toolSkillCounts?.[toggle.tool] ?? 0
      : undefined,
    disabled: !toggle.installed || !toggle.globally_enabled,
    badgeLabel: !toggle.installed
      ? t("mySkills.agentToggleNotInstalled")
      : !toggle.globally_enabled
        ? t("mySkills.agentToggleDisabledGlobally")
        : null,
  }));

  const meta = (
    <>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        {tools && <SyncDots skill={skill} tools={tools} size="sm" includeOrphan />}
        {showTags && skill.tags.length > 0 && (
          <>
            {tools && <span className="mx-0.5 h-3 w-px bg-border-subtle" />}
            {skill.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-secondary"
              >
                {tag}
              </span>
            ))}
          </>
        )}
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-2 text-[13px] text-muted">
        <Folder className="h-3.5 w-3.5 shrink-0" />
        <span className="font-mono truncate" title={skill.central_path}>
          {skill.central_path}
        </span>
      </div>
      {metadataItems.length > 0 && (
        <div
          className="t-acc mt-4 rounded-xl border border-border-subtle bg-surface/70"
          data-open={isMetadataExpanded ? "true" : "false"}
        >
          <button
            type="button"
            onClick={() => setIsMetadataExpanded((prev) => !prev)}
            aria-expanded={isMetadataExpanded}
            aria-controls="skill-source-metadata"
            className="t-acc-head flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-bg text-accent-light">
                {sourceIcon(skill.source_type)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-secondary">
                  {t("mySkills.contentSource.sourceTitle", { source: sourceKind })}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-muted" title={sourcePath ?? undefined}>
                  {sourcePath || t("mySkills.contentSource.sourceUnknown")}
                </span>
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-3 text-[12px] text-muted">
              {activeSourceDoc && (
                <span className="hidden items-center gap-1.5 text-accent-light sm:inline-flex">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("mySkills.contentSource.readable")}
                </span>
              )}
              <span>
                {isMetadataExpanded
                  ? t("mySkills.contentSource.hideMetadata")
                  : t("mySkills.contentSource.showMetadata")}
              </span>
              <span className="t-acc-chevron">
                <ChevronDown className="h-3.5 w-3.5" />
              </span>
            </span>
          </button>
          <div className="t-acc-panel">
            <div className="t-acc-panel-inner">
              <div id="skill-source-metadata" className="border-t border-border-subtle px-4 py-3">
                <div className="grid gap-2 md:grid-cols-2">
                  {metadataItems.map((item) => (
                    <div key={item.label} className="min-w-0">
                      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
                        {item.label}
                      </div>
                      <div
                        className="mt-0.5 truncate font-mono text-[12.5px] text-secondary"
                        title={item.value ?? undefined}
                      >
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const contentBody = loading ? (
    <div className="flex min-h-56 items-center justify-center gap-2 text-[13px] text-muted">
      <Loader2 className="h-4 w-4 animate-spin" />
      {t("common.loading")}
    </div>
  ) : contentTab === "diff" ? (
    sourceDiffLoading ? (
      <div className="flex min-h-56 items-center justify-center gap-2 text-[13px] text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("mySkills.contentSource.comparing")}
      </div>
    ) : activeSourceDiff ? (
      <SkillSourceDiffViewer entries={activeSourceDiff.entries} />
    ) : sourceDiffFailed ? (
      <div className="flex min-h-56 items-center justify-center text-[13px] text-muted">
        {t("mySkills.sourceDiffUnavailable")}
      </div>
    ) : (
      <div className="flex min-h-56 items-center justify-center gap-2 text-[13px] text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("common.loading")}
      </div>
    )
  ) : contentTab === "source" ? (
    sourceLoading ? (
      <div className="flex min-h-56 items-center justify-center gap-2 text-[13px] text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("common.loading")}
      </div>
    ) : activeSourceDoc ? (
      <SkillMarkdown content={activeSourceDoc.content} />
    ) : (
      <div className="flex min-h-56 items-center justify-center text-[13px] text-muted">
        {t("mySkills.sourceDiffUnavailable")}
      </div>
    )
  ) : activeDoc ? (
    <SkillMarkdown content={activeDoc.content} />
  ) : (
    <div className="flex min-h-56 items-center justify-center text-[13px] text-muted">
      {t("common.documentMissing")}
    </div>
  );

  return (
    <DetailSheet
      open={true}
      title={skill.name}
      description={skill.description ? <p className="line-clamp-3">{skill.description}</p> : undefined}
      meta={meta}
      onClose={onClose}
    >
      {!readOnly && toolToggles && onToggleTool && (
        <AgentToggleSection
          items={toggleItems}
          togglingKey={togglingTool}
          onToggle={onToggleTool}
          className="mb-4"
        />
      )}

      {!readOnly && projects && projects.length > 0 && (
        <SkillProjectsSection
          skill={skill}
          projects={projects}
          onChanged={onProjectsChanged}
        />
      )}

      {supportsSourceDiff ? (
        <section
          className="t-acc overflow-hidden rounded-xl border border-border-subtle bg-surface"
          data-open={isContentReviewOpen ? "true" : "false"}
          aria-labelledby="skill-content-source-title"
        >
          <button
            type="button"
            onClick={() => setIsContentReviewOpen((open) => !open)}
            aria-expanded={isContentReviewOpen}
            aria-controls="skill-content-source-review"
            className="t-acc-head flex w-full flex-col gap-4 px-4 py-4 text-left transition-colors hover:bg-surface-hover sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="flex min-w-0 items-start gap-3">
              <span className={cn("mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-hover", contentSourceSummary.tone)}>
                {sourceLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : !activeSourceDoc ? (
                  <AlertCircle className="h-5 w-5" />
                ) : (
                  <GitCompareArrows className="h-5 w-5" />
                )}
              </span>
              <span className="min-w-0">
                <h3 id="skill-content-source-title" className="text-[14px] font-semibold text-primary">
                  {contentSourceSummary.title}
                </h3>
                <p className="mt-1 text-[12px] leading-5 text-muted">{contentSourceSummary.hint}</p>
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-2 self-end text-[12.5px] font-medium text-secondary sm:self-auto">
              {isContentReviewOpen
                ? t("mySkills.contentSource.collapse")
                : t("mySkills.contentSource.review")}
              <span className="t-acc-chevron">
                <ChevronDown className="h-4 w-4" />
              </span>
            </span>
          </button>

          <div className="t-acc-panel">
            <div
              id="skill-content-source-review"
              className="t-acc-panel-inner"
              aria-hidden={!isContentReviewOpen}
              inert={!isContentReviewOpen}
            >
              <div className="flex flex-col gap-3 border-t border-border-subtle bg-surface-hover px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <h3 className="text-[13px] font-semibold text-primary">{contentViewCopy.title}</h3>
                  <p className="mt-0.5 text-[11px] leading-5 text-muted">{contentViewCopy.hint}</p>
                </div>
                <div ref={contentTabsRef} className="t-tabs shrink-0" role="tablist" aria-label={t("mySkills.contentSource.contentVersions")}>
                  <span ref={contentTabPillRef} className="t-tabs-pill" aria-hidden="true" />
                  {(["local", "source", "diff"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={contentTab === tab}
                      className="t-tab"
                      onClick={() => setContentTab(tab)}
                      disabled={!isContentReviewOpen || (tab === "source" && sourceLoading)}
                    >
                      {tab === "local"
                        ? t("mySkills.docTabs.local")
                        : tab === "source"
                          ? t("mySkills.docTabs.source")
                          : typeof sourceDiffCount === "number"
                            ? t("mySkills.docTabs.diffCount", { count: sourceDiffCount })
                            : t("mySkills.docTabs.diff")}
                    </button>
                  ))}
                </div>
              </div>

              {contentTab !== "local" && activeSourceDoc && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-faint bg-surface-hover px-4 py-2 text-[11px] text-muted">
                  <span>{t("mySkills.contentSource.sourceTitle", { source: sourceKind })}</span>
                  <span aria-hidden="true">·</span>
                  <span>{sourceRevisionLabel}</span>
                </div>
              )}

              <div className="min-h-56 px-5 py-5">{contentBody}</div>
            </div>
          </div>
        </section>
      ) : (
        contentBody
      )}
    </DetailSheet>
  );
}
