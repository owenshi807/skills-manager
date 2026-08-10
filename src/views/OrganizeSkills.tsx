import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleHelp,
  Copy,
  FolderInput,
  Library,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import * as api from "../lib/tauri";
import type { DiscoveredGroup, ScanResult } from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import { cn } from "../utils";

type Queue = "pending" | "issues" | "managed";
type IssueKind = "conflict" | "duplicate" | "unverified";

function groupKey(group: DiscoveredGroup) {
  return `${group.name}\u0000${group.fingerprint ?? "unknown"}\u0000${group.locations[0]?.found_path ?? ""}`;
}

function normalizedName(name: string) {
  return name.normalize("NFKC").toLocaleLowerCase();
}

export function OrganizeSkills() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { managedSkills, refreshManagedSkills, refreshPresets, openSkillDetailById } = useApp();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<Queue>("pending");
  const [query, setQuery] = useState("");
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [importNames, setImportNames] = useState<Record<string, string>>({});

  const scan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.scanLocalSkills());
    } catch (scanError: unknown) {
      const message = getErrorMessage(scanError, t("common.error"));
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void scan();
  }, [scan]);

  const analysis = useMemo(() => {
    const groups = result?.groups ?? [];
    const byName = new Map<string, DiscoveredGroup[]>();
    const byFingerprint = new Map<string, DiscoveredGroup[]>();

    for (const group of groups) {
      const name = normalizedName(group.name);
      byName.set(name, [...(byName.get(name) ?? []), group]);
      if (group.fingerprint) {
        byFingerprint.set(group.fingerprint, [
          ...(byFingerprint.get(group.fingerprint) ?? []),
          group,
        ]);
      }
    }

    const issueFor = (group: DiscoveredGroup): IssueKind | null => {
      const sameName = byName.get(normalizedName(group.name)) ?? [];
      if (sameName.length > 1) {
        const knownFingerprints = new Set(
          sameName.map((item) => item.fingerprint).filter((value): value is string => Boolean(value)),
        );
        if (sameName.some((item) => !item.fingerprint)) return "unverified";
        if (knownFingerprints.size > 1) return "conflict";
        return "duplicate";
      }
      if (group.fingerprint && (byFingerprint.get(group.fingerprint)?.length ?? 0) > 1) {
        return "duplicate";
      }
      if (!group.fingerprint) return "unverified";
      return null;
    };

    const rows = groups.map((group) => ({ group, issue: issueFor(group) }));
    return {
      pending: rows.filter((row) => !row.issue && !row.group.imported),
      issues: rows.filter((row) => Boolean(row.issue)),
      managed: rows.filter((row) => !row.issue && row.group.imported),
    };
  }, [result]);

  const discoveredRows = (queue === "managed" ? [] : analysis[queue]).filter(({ group }) => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) return true;
    return (
      group.name.toLocaleLowerCase().includes(search)
      || group.locations.some((location) =>
        `${location.tool} ${location.found_path}`.toLocaleLowerCase().includes(search),
      )
    );
  });

  const managedRows = managedSkills.filter((skill) => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) return true;
    return (
      skill.name.toLocaleLowerCase().includes(search)
      || (skill.description ?? "").toLocaleLowerCase().includes(search)
      || skill.central_path.toLocaleLowerCase().includes(search)
      || skill.targets.some((target) => `${target.tool} ${target.target_path}`.toLocaleLowerCase().includes(search))
    );
  });

  const importGroup = async (group: DiscoveredGroup) => {
    const key = groupKey(group);
    const sourcePath = group.locations[0]?.found_path;
    const name = (importNames[key] ?? group.name).trim();
    if (!sourcePath || !name) return;

    setImportingKey(key);
    try {
      await api.importExistingSkill(sourcePath, name);
      await Promise.all([refreshManagedSkills(), refreshPresets()]);
      toast.success(t("organize.imported", { name }));
      await scan();
    } catch (importError: unknown) {
      toast.error(getErrorMessage(importError, t("common.error")));
    } finally {
      setImportingKey(null);
    }
  };

  const queues: Array<{ id: Queue; label: string; count: number }> = [
    { id: "pending", label: t("organize.queues.pending"), count: analysis.pending.length },
    { id: "issues", label: t("organize.queues.issues"), count: analysis.issues.length },
    { id: "managed", label: t("organize.queues.managed"), count: managedSkills.length },
  ];

  return (
    <div className="app-page">
      <header className="app-page-header flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[720px]">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent-light">
            {t("organize.eyebrow")}
          </div>
          <h1 className="app-page-title">{t("organize.title")}</h1>
          <p className="app-page-subtitle">{t("organize.subtitle")}</p>
        </div>
        <button className="app-button-secondary" onClick={() => navigate("/my-skills")}>
          <Library className="h-4 w-4" />
          {t("organize.openLibrary")}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </header>

      <section className="grid gap-2 md:grid-cols-3">
        {[
          { step: "1", title: t("organize.steps.scan.title"), detail: t("organize.steps.scan.detail"), active: true },
          { step: "2", title: t("organize.steps.collect.title"), detail: t("organize.steps.collect.detail"), active: Boolean(result) },
          { step: "3", title: t("organize.steps.deliver.title"), detail: t("organize.steps.deliver.detail"), active: false },
        ].map((item) => (
          <div key={item.step} className="app-panel flex items-start gap-3 p-3.5">
            <span className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
              item.active ? "border-accent-border bg-accent-bg text-accent-light" : "border-border-subtle text-faint",
            )}>
              {item.step}
            </span>
            <div>
              <div className="text-[13px] font-semibold text-secondary">{item.title}</div>
              <p className="mt-0.5 text-[11px] leading-4 text-muted">{item.detail}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="app-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3.5">
          <div>
            <h2 className="text-[13px] font-semibold text-secondary">{t("organize.scanTitle")}</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              {result
                ? t("organize.scanSummary", {
                    agents: result.tools_scanned,
                    locations: result.skills_found,
                    skills: result.groups.length,
                  })
                : t("organize.scanBefore")}
            </p>
          </div>
          <button className="app-button-primary" onClick={() => void scan()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {loading ? t("organize.scanning") : t("organize.rescan")}
          </button>
        </div>

        {error ? (
          <div className="m-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-[12px] text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="app-segmented" role="tablist" aria-label={t("organize.queueLabel")}>
            {queues.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={queue === item.id}
                onClick={() => setQueue(item.id)}
                className={cn("app-segmented-button flex items-center gap-2", queue === item.id && "app-segmented-button-active")}
              >
                {item.label}
                <span className="rounded-full bg-bg-secondary px-1.5 text-[10px] tabular-nums text-muted">{item.count}</span>
              </button>
            ))}
          </div>
          <div className="relative w-full max-w-[280px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("organize.search")}
              className="app-input w-full pl-9"
            />
          </div>
        </div>

        <div className="min-h-[260px]">
          {loading && !result ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("organize.scanning")}
            </div>
          ) : queue === "managed" && managedRows.length > 0 ? (
            <div className="divide-y divide-border-subtle">
              {managedRows.map((skill) => {
                const targetTools = Array.from(new Set(skill.targets.map((target) => target.tool)));
                return (
                  <article key={skill.id} className="flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[13px] font-semibold text-primary">{skill.name}</h3>
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                          <Check className="h-3 w-3" />
                          {t("organize.managed")}
                        </span>
                        <span className="text-[11px] text-muted">
                          {skill.targets.length > 0
                            ? t("organize.deployedCount", { count: skill.targets.length })
                            : t("organize.libraryOnly")}
                        </span>
                      </div>
                      {skill.description ? <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted">{skill.description}</p> : null}
                      <code className="mt-2 block truncate text-[11px] text-tertiary" title={skill.central_path}>{skill.central_path}</code>
                      {targetTools.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {targetTools.map((tool) => (
                            <span key={tool} className="rounded border border-border-subtle bg-bg-secondary px-1.5 py-0.5 text-[10px] text-muted">{tool}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <button
                      className="app-button-secondary shrink-0 py-2"
                      onClick={() => {
                        openSkillDetailById(skill.id);
                        navigate("/my-skills");
                      }}
                    >
                      {t("organize.viewInLibrary")}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </article>
                );
              })}
            </div>
          ) : discoveredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-5 py-16 text-center">
              <Check className="mb-3 h-7 w-7 text-emerald-400" />
              <h3 className="text-[13px] font-semibold text-secondary">{t(`organize.empty.${queue}.title`)}</h3>
              <p className="mt-1 max-w-[480px] text-[12px] leading-5 text-muted">{t(`organize.empty.${queue}.detail`)}</p>
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {discoveredRows.map(({ group, issue }) => {
                const key = groupKey(group);
                const isImporting = importingKey === key;
                const uniquePaths = Array.from(new Set(group.locations.map((location) => location.found_path)));
                const tools = Array.from(new Set(group.locations.map((location) => location.tool)));
                const importName = importNames[key] ?? group.name;
                const IssueIcon = issue === "duplicate" ? Copy : issue === "unverified" ? CircleHelp : AlertTriangle;

                return (
                  <article key={key} className="px-4 py-3.5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-[13px] font-semibold text-primary">{group.name}</h3>
                          {issue ? (
                            <span className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                              issue === "conflict"
                                ? "border-red-500/20 bg-red-500/10 text-red-300"
                                : "border-amber-500/20 bg-amber-500/10 text-amber-300",
                            )}>
                              <IssueIcon className="h-3 w-3" />
                              {t(`organize.issue.${issue}`)}
                            </span>
                          ) : group.imported ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                              <Check className="h-3 w-3" />
                              {t("organize.managed")}
                            </span>
                          ) : null}
                          <span className="text-[11px] text-muted">{t("organize.pathCount", { count: uniquePaths.length })}</span>
                        </div>

                        {issue ? <p className="mt-1 text-[11px] leading-4 text-muted">{t(`organize.issueHelp.${issue}`)}</p> : null}

                        <div className="mt-2 space-y-1.5">
                          {uniquePaths.slice(0, 3).map((path) => (
                            <code key={path} className="block truncate text-[11px] text-tertiary" title={path}>{path}</code>
                          ))}
                          {uniquePaths.length > 3 ? (
                            <div className="text-[11px] text-faint">{t("organize.morePaths", { count: uniquePaths.length - 3 })}</div>
                          ) : null}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {tools.map((tool) => (
                            <span key={tool} className="rounded border border-border-subtle bg-bg-secondary px-1.5 py-0.5 text-[10px] text-muted">{tool}</span>
                          ))}
                        </div>
                      </div>

                      {!group.imported ? (
                        <div className="w-full shrink-0 rounded-lg border border-border-subtle bg-bg-secondary p-2.5 lg:w-[270px]">
                          <label className="block text-[10px] font-semibold text-muted">{t("organize.libraryName")}</label>
                          <input
                            value={importName}
                            onChange={(event) => setImportNames((current) => ({ ...current, [key]: event.target.value }))}
                            className="app-input mt-1.5 h-8 w-full bg-surface"
                          />
                          <button
                            className="app-button-primary mt-2 w-full py-2"
                            disabled={isImporting || !importName.trim()}
                            onClick={() => void importGroup(group)}
                          >
                            {isImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderInput className="h-3.5 w-3.5" />}
                            {t("organize.collect")}
                          </button>
                          <p className="mt-1.5 text-[10px] leading-4 text-faint">{t("organize.collectSafety")}</p>
                        </div>
                      ) : (
                        <button className="app-button-secondary shrink-0 py-2" onClick={() => navigate("/my-skills")}>
                          {t("organize.viewInLibrary")}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <p className="flex items-start gap-2 px-1 text-[11px] leading-5 text-faint">
        <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t("organize.scopeNote")}
      </p>
    </div>
  );
}
