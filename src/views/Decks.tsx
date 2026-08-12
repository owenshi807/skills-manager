import { useMemo, useState } from "react";
import { ArrowRight, Check, ChevronRight, Clipboard, Layers3, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { writeText as clipboardWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { WEB_CODING_DECK, type DeckCardDefinition } from "../lib/deckCatalog";
import type { ManagedSkill } from "../lib/tauri";
import { cn } from "../utils";

function normalizedName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function buildDeckPrompt(
  t: (key: string) => string,
  matches: Map<string, ManagedSkill[]>,
) {
  const stages = WEB_CODING_DECK.stages.map((stage, index) => {
    const cards = stage.cards.map((card) => {
      if (card.kind === "checkpoint") {
        return `- [监督] ${t(card.titleKey)}：${t(card.purposeKey)}`;
      }
      const count = matches.get(card.id)?.length ?? 0;
      const availability = count === 0 ? "当前技能库缺少" : count > 1 ? `${count} 个候选，先确认版本` : "可用";
      return `- [Skill] ${card.skillName}（${availability}）：${t(card.purposeKey)}`;
    }).join("\n");
    return `${index + 1}. ${t(stage.titleKey)} — ${t(stage.questionKey)}\n${cards}`;
  }).join("\n\n");

  return `你正在进行 Web Coding。按下面牌组推进，不要一次加载全部 Skill；只在对应阶段按 trigger 使用。每阶段结束回答监督问题。若任务已满足停止线，立即停止扩建。\n\n${stages}`;
}

function DeckCard({
  card,
  candidates,
  onOpen,
}: {
  card: DeckCardDefinition;
  candidates: ManagedSkill[];
  onOpen: (skill: ManagedSkill) => void;
}) {
  const { t } = useTranslation();
  const available = candidates.length === 1;
  const ambiguous = candidates.length > 1;
  const checkpoint = card.kind === "checkpoint";
  const StatusIcon = checkpoint ? ShieldCheck : available ? Check : TriangleAlert;

  return (
    <button
      type="button"
      onClick={() => available && onOpen(candidates[0])}
      disabled={!available}
      className={cn(
        "group flex min-h-[118px] w-full flex-col rounded-lg border p-3 text-left transition-colors",
        checkpoint
          ? "border-violet-500/25 bg-violet-500/[0.06]"
          : available
            ? "border-border-subtle bg-surface hover:border-accent/35 hover:bg-surface-hover"
            : "border-dashed border-amber-500/30 bg-amber-500/[0.04]",
        !available && !checkpoint && "cursor-default",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
          checkpoint ? "bg-violet-500/12 text-violet-500" : "bg-surface-active text-muted",
        )}>
          {checkpoint ? t("decks.types.checkpoint") : t("decks.types.skill")}
        </span>
        <StatusIcon className={cn(
          "h-3.5 w-3.5",
          checkpoint ? "text-violet-500" : available ? "text-emerald-500" : "text-amber-500",
        )} />
      </div>

      <h3 className="mt-2 truncate text-[13px] font-semibold text-primary" title={t(card.titleKey)}>
        {t(card.titleKey)}
      </h3>
      <p className="mt-1 line-clamp-2 text-[11.5px] leading-[17px] text-muted">
        {t(card.purposeKey)}
      </p>

      <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[10.5px]">
        <span className={cn(
          "truncate",
          checkpoint ? "text-violet-500" : available ? "text-emerald-500" : "text-amber-500",
        )}>
          {checkpoint
            ? t("decks.status.builtIn")
            : available
              ? t("decks.status.ready")
              : ambiguous
                ? t("decks.status.ambiguous", { count: candidates.length })
                : t("decks.status.missing")}
        </span>
        {available && <ChevronRight className="h-3 w-3 text-faint transition-transform group-hover:translate-x-0.5" />}
      </div>
    </button>
  );
}

export function Decks() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { managedSkills, openSkillDetailById } = useApp();
  const [copying, setCopying] = useState(false);

  const matches = useMemo(() => {
    const byName = new Map<string, ManagedSkill[]>();
    for (const skill of managedSkills) {
      const key = normalizedName(skill.name);
      const values = byName.get(key) ?? [];
      values.push(skill);
      byName.set(key, values);
    }
    const result = new Map<string, ManagedSkill[]>();
    for (const stage of WEB_CODING_DECK.stages) {
      for (const card of stage.cards) {
        if (card.kind === "skill" && card.skillName) {
          result.set(card.id, byName.get(normalizedName(card.skillName)) ?? []);
        }
      }
    }
    return result;
  }, [managedSkills]);

  const skillCards = WEB_CODING_DECK.stages.flatMap((stage) => stage.cards).filter((card) => card.kind === "skill");
  const readyCount = skillCards.filter((card) => (matches.get(card.id)?.length ?? 0) === 1).length;
  const gapCount = skillCards.length - readyCount;

  const openSkill = (skill: ManagedSkill) => {
    openSkillDetailById(skill.id);
    navigate("/my-skills");
  };

  const copyPrompt = async () => {
    setCopying(true);
    try {
      await clipboardWriteText(buildDeckPrompt(t, matches));
      toast.success(t("decks.promptCopied"));
    } catch {
      toast.error(t("common.error"));
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="app-page">
      <div className="app-page-header flex flex-wrap items-start justify-between gap-4 pb-2">
        <div className="min-w-0 max-w-[720px]">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
            <Layers3 className="h-3.5 w-3.5" />
            {t("decks.eyebrow")}
          </div>
          <h1 className="app-page-title mt-2">{t(WEB_CODING_DECK.titleKey)}</h1>
          <p className="mt-1.5 text-[13px] leading-5 text-muted">{t(WEB_CODING_DECK.descriptionKey)}</p>
        </div>
        <button
          type="button"
          onClick={copyPrompt}
          disabled={copying}
          className="app-button-primary shrink-0"
        >
          <Clipboard className="h-4 w-4" />
          {t("decks.copyPrompt")}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <div className="app-panel px-3.5 py-3">
          <div className="text-[11px] text-muted">{t("decks.stats.ready")}</div>
          <div className="mt-1 text-lg font-semibold text-primary">{readyCount}/{skillCards.length}</div>
        </div>
        <div className="app-panel px-3.5 py-3">
          <div className="text-[11px] text-muted">{t("decks.stats.gaps")}</div>
          <div className="mt-1 text-lg font-semibold text-amber-500">{gapCount}</div>
        </div>
        <div className="app-panel px-3.5 py-3">
          <div className="text-[11px] text-muted">{t("decks.stats.library")}</div>
          <div className="mt-1 text-lg font-semibold text-primary">{managedSkills.length}</div>
        </div>
      </div>

      <div className="rounded-xl border border-border-subtle bg-bg-secondary/70 p-3.5">
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2.5">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <p className="text-[12px] font-semibold text-secondary">{t("decks.stopRule.title")}</p>
            <p className="mt-0.5 text-[11.5px] leading-[17px] text-muted">{t("decks.stopRule.description")}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
          {WEB_CODING_DECK.stages.map((stage, index) => (
            <section key={stage.id} className="min-w-0">
              <div className="mb-2 flex min-h-[46px] items-start gap-2 px-0.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-bg text-[10px] font-semibold text-accent-light">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <h2 className="text-[12px] font-semibold text-secondary">{t(stage.titleKey)}</h2>
                  <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-[15px] text-muted">{t(stage.questionKey)}</p>
                </div>
                {index < WEB_CODING_DECK.stages.length - 1 && <ArrowRight className="ml-auto mt-1 hidden h-3 w-3 text-faint xl:block" />}
              </div>
              <div className="space-y-2">
                {stage.cards.map((card) => (
                  <DeckCard
                    key={card.id}
                    card={card}
                    candidates={matches.get(card.id) ?? []}
                    onOpen={openSkill}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <p className="px-1 text-[11px] leading-4 text-faint">
        {t("decks.boundaryNote")}
      </p>
    </div>
  );
}
