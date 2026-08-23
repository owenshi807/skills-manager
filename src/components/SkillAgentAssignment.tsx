import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Circle, Library, Loader2, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ManagedSkill, ToolInfo } from "../lib/tauri";
import { cn } from "../utils";
import { AgentIcon } from "./AgentIcon";
import { SyncDots } from "./SyncDots";

interface Props {
  skill: ManagedSkill;
  tools: ToolInfo[];
  pendingKey?: string | null;
  onToggle: (toolKey: string, enabled: boolean) => void;
}

export function SkillAgentAssignment({ skill, tools, pendingKey, onToggle }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const assignedKeys = useMemo(() => new Set(skill.targets.map((target) => target.tool)), [skill.targets]);
  const availableTools = useMemo(
    () => tools.filter((tool) => tool.installed && tool.enabled),
    [tools],
  );
  const orphanTargets = useMemo(
    () => skill.targets.filter((target) => !availableTools.some((tool) => tool.key === target.tool)),
    [availableTools, skill.targets],
  );

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 300;
      const estimatedHeight = Math.min(420, 112 + availableTools.length * 44 + orphanTargets.length * 44);
      const roomBelow = window.innerHeight - rect.bottom;
      const top = roomBelow >= estimatedHeight + 12
        ? rect.bottom + 8
        : Math.max(12, rect.top - estimatedHeight - 8);
      const left = Math.min(
        Math.max(12, rect.right - width),
        Math.max(12, window.innerWidth - width - 12),
      );
      setPosition({ top, left });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [availableTools.length, open, orphanTargets.length]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={cn(
          "inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] transition-colors",
          "text-muted hover:bg-surface-hover hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        )}
        title={t("mySkills.assignment.manage")}
      >
        {skill.targets.length > 0 ? (
          <SyncDots skill={skill} tools={tools} limit={5} size="sm" includeOrphan onlySynced />
        ) : (
          <>
            <Library className="h-3.5 w-3.5" />
            <span>{t("mySkills.assignment.unassigned")}</span>
          </>
        )}
        <Plus className="h-3 w-3 text-faint" />
      </button>

      {open && createPortal(
        <>
          <button
            type="button"
            aria-label={t("common.close")}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <section
            role="dialog"
            aria-label={t("mySkills.assignment.title")}
            className="fixed z-50 w-[300px] overflow-hidden rounded-xl border border-border bg-bg-secondary shadow-2xl"
            style={{ top: position.top, left: position.left }}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="border-b border-border-subtle px-4 py-3">
              <h3 className="text-[13px] font-semibold text-primary">{t("mySkills.assignment.title")}</h3>
              <p className="mt-1 text-[11px] leading-4 text-muted">{t("mySkills.assignment.hint")}</p>
            </header>
            <div className="max-h-[300px] overflow-y-auto p-1.5">
              {availableTools.map((tool) => {
                const assigned = assignedKeys.has(tool.key);
                const loading = pendingKey === tool.key;
                return (
                  <button
                    type="button"
                    key={tool.key}
                    disabled={loading}
                    onClick={() => onToggle(tool.key, !assigned)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hover disabled:opacity-60"
                  >
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
                      {loading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
                      ) : assigned ? (
                        <Check className="h-3.5 w-3.5 text-accent-light" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 text-faint" />
                      )}
                    </span>
                    <AgentIcon agentKey={tool.key} displayName={tool.display_name} className="h-6 w-6 rounded-[5px]" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-secondary">
                      {tool.display_name}
                    </span>
                    <span className="text-[10px] text-faint">
                      {assigned ? t("mySkills.assignment.visible") : t("mySkills.assignment.notVisible")}
                    </span>
                  </button>
                );
              })}
              {orphanTargets.map((target) => (
                <div key={target.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 opacity-70">
                  <span className="h-4 w-4" />
                  <AgentIcon agentKey={target.tool} className="h-6 w-6 rounded-[5px]" />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-secondary">{target.tool}</span>
                  <span className="text-[10px] text-amber-500">{t("mySkills.assignment.unavailable")}</span>
                </div>
              ))}
            </div>
          </section>
        </>,
        document.body,
      )}
    </>
  );
}
