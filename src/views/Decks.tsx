import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  Clipboard,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { writeText as clipboardWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { VIBE_CODING_DECK, type DeckCardDefinition } from "../lib/deckCatalog";
import * as api from "../lib/tauri";
import type { DeckSuggestionCard, ManagedSkill, OrganizationAgentCapability } from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import { cn } from "../utils";

const CUSTOM_DECKS_KEY = "card_master_custom_decks_v1";

interface CustomDeck {
  id: string;
  title: string;
  summary: string;
  goal: string;
  cards: DeckSuggestionCard[];
  gaps: string[];
  createdAt: number;
}

function normalizedName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function buildVibeCodingPrompt(t: (key: string) => string, matches: Map<string, ManagedSkill[]>) {
  const stages = VIBE_CODING_DECK.stages.map((stage, index) => {
    const cards = stage.cards.map((card) => {
      if (card.kind === "checkpoint") return `- [监督] ${t(card.titleKey)}：${t(card.purposeKey)}`;
      const count = matches.get(card.id)?.length ?? 0;
      const availability = count === 0 ? "当前技能库缺少" : count > 1 ? `${count} 个候选，先确认版本` : "可用";
      return `- [Skill] ${card.skillName}（${availability}）：${t(card.purposeKey)}`;
    }).join("\n");
    return `${index + 1}. ${t(stage.titleKey)} — ${t(stage.questionKey)}\n${cards}`;
  }).join("\n\n");
  return `你正在进行 Vibe Coding。按下面牌组推进，不要一次加载全部 Skill；只在对应阶段按 trigger 使用。每阶段结束回答监督问题。若任务已满足停止线，立即停止扩建。\n\n${stages}`;
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
        "group flex min-h-[108px] w-full flex-col rounded-lg border p-3 text-left transition-colors",
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
        <StatusIcon className={cn("h-3.5 w-3.5", checkpoint ? "text-violet-500" : available ? "text-emerald-500" : "text-amber-500")} />
      </div>
      <h3 className="mt-2 truncate text-[13px] font-semibold text-primary">{t(card.titleKey)}</h3>
      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted">{t(card.purposeKey)}</p>
      <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[10px]">
        <span className={checkpoint ? "text-violet-500" : available ? "text-emerald-500" : "text-amber-500"}>
          {checkpoint
            ? t("decks.status.builtIn")
            : available
              ? t("decks.status.ready")
              : ambiguous
                ? t("decks.status.ambiguous", { count: candidates.length })
                : t("decks.status.missing")}
        </span>
        {available && <ChevronRight className="h-3 w-3 text-faint" />}
      </div>
    </button>
  );
}

export function Decks() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { managedSkills, openSkillDetailById } = useApp();
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [agents, setAgents] = useState<OrganizationAgentCapability[]>([]);
  const [agentKey, setAgentKey] = useState("");
  const [generating, setGenerating] = useState(false);
  const [customDecks, setCustomDecks] = useState<CustomDeck[]>([]);

  useEffect(() => {
    void api.getSettings(CUSTOM_DECKS_KEY).then((raw) => {
      if (!raw) return;
      try { setCustomDecks(JSON.parse(raw) as CustomDeck[]); } catch { /* ignore corrupt optional setting */ }
    });
    void api.getOrganizationAgentCapabilities().then((rows) => {
      const available = rows.filter((row) => row.available);
      setAgents(available);
      setAgentKey(available[0]?.key ?? "");
    }).catch(() => setAgents([]));
  }, []);

  const matches = useMemo(() => {
    const byName = new Map<string, ManagedSkill[]>();
    for (const skill of managedSkills) {
      const key = normalizedName(skill.name);
      byName.set(key, [...(byName.get(key) ?? []), skill]);
    }
    const result = new Map<string, ManagedSkill[]>();
    for (const stage of VIBE_CODING_DECK.stages) {
      for (const card of stage.cards) {
        if (card.kind === "skill" && card.skillName) result.set(card.id, byName.get(normalizedName(card.skillName)) ?? []);
      }
    }
    return result;
  }, [managedSkills]);

  const skillById = useMemo(() => new Map(managedSkills.map((skill) => [skill.id, skill])), [managedSkills]);
  const selectedCustomDeck = customDecks.find((deck) => deck.id === selectedDeckId);
  const vibeSkillCount = VIBE_CODING_DECK.stages.flatMap((stage) => stage.cards).filter((card) => card.kind === "skill").length;

  const openSkill = (skill: ManagedSkill) => {
    openSkillDetailById(skill.id);
    navigate("/my-skills");
  };

  const saveDecks = async (next: CustomDeck[]) => {
    setCustomDecks(next);
    await api.setSettings(CUSTOM_DECKS_KEY, JSON.stringify(next));
  };

  const generateDeck = async () => {
    if (goal.trim().length < 8 || !agentKey) return;
    setGenerating(true);
    try {
      const suggestion = await api.suggestDeckFromLibrary(goal.trim(), agentKey);
      const deck: CustomDeck = {
        id: `custom-${Date.now()}`,
        title: suggestion.title,
        summary: suggestion.summary,
        goal: goal.trim(),
        cards: suggestion.cards,
        gaps: suggestion.gaps,
        createdAt: Date.now(),
      };
      await saveDecks([deck, ...customDecks]);
      setCreatorOpen(false);
      setGoal("");
      setSelectedDeckId(deck.id);
      toast.success(t("decks.creator.created", { count: deck.cards.length }));
    } catch (error) {
      toast.error(getErrorMessage(error, t("decks.creator.failed")));
    } finally {
      setGenerating(false);
    }
  };

  if (!selectedDeckId) {
    return (
      <div className="app-page">
        <div className="app-page-header flex items-start justify-between gap-4 pb-3">
          <div>
            <h1 className="app-page-title">{t("decks.libraryTitle")}</h1>
            <p className="mt-1.5 max-w-[720px] text-[13px] text-muted">{t("decks.libraryDescription")}</p>
          </div>
          <button type="button" className="app-button-primary" onClick={() => setCreatorOpen(true)}>
            <Plus className="h-4 w-4" />{t("decks.newDeck")}
          </button>
        </div>

        {creatorOpen && (
          <section className="rounded-xl border border-accent/25 bg-accent-bg/30 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-accent-bg p-2 text-accent-light"><Bot className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[14px] font-semibold text-primary">{t("decks.creator.title")}</h2>
                <p className="mt-0.5 text-[11.5px] text-muted">{t("decks.creator.description")}</p>
                <textarea
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  placeholder={t("decks.creator.placeholder")}
                  className="mt-3 min-h-[88px] w-full resize-y rounded-lg border border-border-subtle bg-bg-primary px-3 py-2.5 text-[12px] leading-5 text-primary outline-none focus:border-accent/50"
                />
                <div className="mt-2.5 flex items-center justify-between gap-3">
                  <select value={agentKey} onChange={(event) => setAgentKey(event.target.value)} className="app-input h-9 max-w-[220px] text-[12px]">
                    {agents.map((agent) => <option key={agent.key} value={agent.key}>{agent.display_name}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button type="button" className="app-button-secondary" onClick={() => setCreatorOpen(false)}>{t("common.cancel")}</button>
                    <button type="button" className="app-button-primary" disabled={generating || goal.trim().length < 8 || !agentKey} onClick={generateDeck}>
                      {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      {generating ? t("decks.creator.generating") : t("decks.creator.generate")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          <button type="button" onClick={() => setSelectedDeckId(VIBE_CODING_DECK.id)} className="group app-panel min-h-[142px] p-4 text-left transition-colors hover:border-accent/35 hover:bg-surface-hover">
            <div className="flex items-start justify-between">
              <span className="rounded bg-violet-500/10 px-2 py-1 text-[10px] font-semibold text-violet-500">{t("decks.builtIn")}</span>
              <ArrowRight className="h-4 w-4 text-faint transition-transform group-hover:translate-x-0.5" />
            </div>
            <h2 className="mt-5 text-[16px] font-semibold text-primary">{t(VIBE_CODING_DECK.titleKey)}</h2>
            <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted">{t(VIBE_CODING_DECK.descriptionKey)}</p>
            <div className="mt-3 text-[10.5px] text-faint">{t("decks.deckMeta", { stages: VIBE_CODING_DECK.stages.length, skills: vibeSkillCount })}</div>
          </button>
          {customDecks.map((deck) => (
            <button key={deck.id} type="button" onClick={() => setSelectedDeckId(deck.id)} className="group app-panel min-h-[142px] p-4 text-left transition-colors hover:border-accent/35 hover:bg-surface-hover">
              <div className="flex items-start justify-between">
                <span className="rounded bg-accent-bg px-2 py-1 text-[10px] font-semibold text-accent-light">{t("decks.aiBuilt")}</span>
                <ArrowRight className="h-4 w-4 text-faint transition-transform group-hover:translate-x-0.5" />
              </div>
              <h2 className="mt-5 truncate text-[16px] font-semibold text-primary">{deck.title}</h2>
              <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted">{deck.summary}</p>
              <div className="mt-3 text-[10.5px] text-faint">{t("decks.customMeta", { skills: deck.cards.length, gaps: deck.gaps.length })}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (selectedCustomDeck) {
    const stages = [...new Set(selectedCustomDeck.cards.map((card) => card.stage))];
    return (
      <div className="app-page">
        <button type="button" className="mb-2 flex items-center gap-1.5 text-[12px] text-muted hover:text-primary" onClick={() => setSelectedDeckId(null)}><ArrowLeft className="h-3.5 w-3.5" />{t("decks.back")}</button>
        <div className="app-page-header pb-3">
          <h1 className="app-page-title">{selectedCustomDeck.title}</h1>
          <p className="mt-1.5 max-w-[760px] text-[13px] text-muted">{selectedCustomDeck.summary}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {stages.map((stage, index) => (
            <section key={stage} className="rounded-xl border border-border-subtle bg-bg-secondary/60 p-3">
              <div className="mb-2 flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-bg text-[10px] font-semibold text-accent-light">{index + 1}</span><h2 className="text-[12px] font-semibold text-secondary">{stage}</h2></div>
              <div className="space-y-2">
                {selectedCustomDeck.cards.filter((card) => card.stage === stage).map((card) => {
                  const skill = skillById.get(card.skill_id);
                  return <button key={card.skill_id} type="button" disabled={!skill} onClick={() => skill && openSkill(skill)} className="w-full rounded-lg border border-border-subtle bg-surface p-3 text-left hover:bg-surface-hover"><div className="flex items-center justify-between"><span className="truncate text-[12px] font-semibold text-primary">{skill?.name ?? t("decks.missingSkill")}</span><ChevronRight className="h-3 w-3 text-faint" /></div><p className="mt-1 text-[11px] font-medium text-secondary">{card.role}</p><p className="mt-1 line-clamp-2 text-[10.5px] leading-4 text-muted">{card.reason}</p></button>;
                })}
              </div>
            </section>
          ))}
        </div>
        {selectedCustomDeck.gaps.length > 0 && <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 text-[11px] text-amber-500">{t("decks.gaps")}: {selectedCustomDeck.gaps.join("；")}</div>}
      </div>
    );
  }

  const skillCards = VIBE_CODING_DECK.stages.flatMap((stage) => stage.cards).filter((card) => card.kind === "skill");
  const readyCount = skillCards.filter((card) => (matches.get(card.id)?.length ?? 0) === 1).length;
  const copyPrompt = async () => {
    try { await clipboardWriteText(buildVibeCodingPrompt(t, matches)); toast.success(t("decks.promptCopied")); } catch { toast.error(t("common.error")); }
  };
  return (
    <div className="app-page">
      <button type="button" className="mb-2 flex items-center gap-1.5 text-[12px] text-muted hover:text-primary" onClick={() => setSelectedDeckId(null)}><ArrowLeft className="h-3.5 w-3.5" />{t("decks.back")}</button>
      <div className="app-page-header flex items-start justify-between gap-4 pb-2">
        <div><h1 className="app-page-title">{t(VIBE_CODING_DECK.titleKey)}</h1><p className="mt-1.5 text-[13px] text-muted">{t(VIBE_CODING_DECK.descriptionKey)}</p></div>
        <button type="button" onClick={copyPrompt} className="app-button-primary"><Clipboard className="h-4 w-4" />{t("decks.copyPrompt")}</button>
      </div>
      <div className="mb-3 flex items-center gap-4 text-[11px] text-muted"><span>{t("decks.stats.ready")}: <b className="text-primary">{readyCount}/{skillCards.length}</b></span><span>{t("decks.stats.library")}: <b className="text-primary">{managedSkills.length}</b></span></div>
      <div className="rounded-xl border border-border-subtle bg-bg-secondary/70 p-3.5">
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2.5"><Sparkles className="mt-0.5 h-4 w-4 text-amber-500" /><div><p className="text-[12px] font-semibold text-secondary">{t("decks.stopRule.title")}</p><p className="mt-0.5 text-[11px] text-muted">{t("decks.stopRule.description")}</p></div></div>
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
          {VIBE_CODING_DECK.stages.map((stage, index) => <section key={stage.id} className="min-w-0"><div className="mb-2 flex min-h-[42px] items-start gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-bg text-[10px] font-semibold text-accent-light">{index + 1}</span><div><h2 className="text-[12px] font-semibold text-secondary">{t(stage.titleKey)}</h2><p className="mt-0.5 line-clamp-2 text-[10px] leading-[14px] text-muted">{t(stage.questionKey)}</p></div></div><div className="space-y-2">{stage.cards.map((card) => <DeckCard key={card.id} card={card} candidates={matches.get(card.id) ?? []} onOpen={openSkill} />)}</div></section>)}
        </div>
      </div>
    </div>
  );
}
