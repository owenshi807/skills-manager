import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { writeText as clipboardWriteText } from "@tauri-apps/plugin-clipboard-manager";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { DEFAULT_DECKS, type DeckDefinition, type DeckStageDefinition } from "../lib/deckCatalog";
import * as api from "../lib/tauri";
import type { DeckSuggestionCard, ManagedSkill, OrganizationAgentCapability } from "../lib/tauri";
import { getErrorMessage } from "../lib/error";
import { deckSkillSearchText, normalizeDeckMatchText } from "../lib/deckMatching";
import { cn } from "../utils";

const CUSTOM_DECKS_KEY = "card_master_custom_decks_v1";
const DECK_OVERRIDES_KEY = "card_master_deck_overrides_v1";

interface CustomDeck {
  id: string;
  title: string;
  summary: string;
  goal: string;
  cards: DeckSuggestionCard[];
  gaps: string[];
  createdAt: number;
}

interface DeckOverride {
  removedSkillIds: string[];
  addedSkills: { skillId: string; stageId: string }[];
}

interface ResolvedSkill {
  skill: ManagedSkill;
  stage: DeckStageDefinition;
  source: "scan" | "added";
  score: number;
}

function skillText(skill: ManagedSkill) {
  return deckSkillSearchText(skill);
}

function scoreSkill(skill: ManagedSkill, stage: DeckStageDefinition) {
  const name = normalizeDeckMatchText(skill.name);
  const text = skillText(skill);
  let score = 0;
  for (const preferred of stage.preferredSkills) {
    const target = normalizeDeckMatchText(preferred);
    if (name === target) score = Math.max(score, 100);
    else if (name.includes(target) || target.includes(name)) score = Math.max(score, 45);
  }
  for (const keyword of stage.keywords) {
    const target = normalizeDeckMatchText(keyword);
    if (name.includes(target)) score += 12;
    else if (text.includes(target)) score += 3;
  }
  return score;
}

function discoverDeck(deck: DeckDefinition, skills: ManagedSkill[], override?: DeckOverride): ResolvedSkill[] {
  const removed = new Set(override?.removedSkillIds ?? []);
  const used = new Set<string>();
  const result: ResolvedSkill[] = [];

  // A user's explicit placement is the strongest relationship in a deck. Apply
  // it before discovery so a broad keyword cannot reclaim the Skill.
  for (const added of override?.addedSkills ?? []) {
    if (removed.has(added.skillId) || used.has(added.skillId)) continue;
    const skill = skills.find((candidate) => candidate.id === added.skillId);
    const stage = deck.stages.find((candidate) => candidate.id === added.stageId);
    if (!skill || !stage) continue;
    used.add(skill.id);
    result.push({ skill, stage, source: "added", score: 0 });
  }

  // Reserve exact catalog preferences across the whole deck before broad
  // keyword matching. This keeps e.g. design-review in Review instead of an
  // earlier stage that happens to contain the generic word "design".
  for (const stage of deck.stages) {
    for (const preferred of stage.preferredSkills) {
      const preferredName = normalizeDeckMatchText(preferred);
      const skill = skills.find((candidate) =>
        !removed.has(candidate.id)
        && !used.has(candidate.id)
        && normalizeDeckMatchText(candidate.name) === preferredName);
      if (!skill) continue;
      used.add(skill.id);
      result.push({ skill, stage, source: "scan", score: 100 });
    }
  }

  for (const stage of deck.stages) {
    const automaticSlots = Math.max(
      0,
      5 - result.filter((item) => item.stage.id === stage.id && item.source === "scan").length,
    );
    const candidates = skills
      .filter((skill) => !removed.has(skill.id) && !used.has(skill.id))
      .map((skill) => ({ skill, score: scoreSkill(skill, stage) }))
      .filter((candidate) => candidate.score >= 12)
      .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
      .slice(0, automaticSlots);
    for (const candidate of candidates) {
      used.add(candidate.skill.id);
      result.push({ ...candidate, stage, source: "scan" });
    }
  }
  return result;
}

function buildDeckPrompt(
  deck: DeckDefinition,
  resolved: ResolvedSkill[],
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const stages = deck.stages.map((stage, index) => {
    const cards = [
      ...resolved.filter((item) => item.stage.id === stage.id).map((item) => `- ${item.skill.name}`),
      ...(stage.checkpoints ?? []).map((checkpoint) => `- ${t(checkpoint.titleKey)}: ${t(checkpoint.purposeKey)}`),
    ];
    const names = cards.join("\n") || t("decks.copy.emptyStage");
    return `${t("decks.copy.stage", { index: index + 1, title: t(stage.titleKey), question: t(stage.questionKey) })}\n${names}`;
  }).join("\n\n");
  return `${t(deck.titleKey)}\n${t(deck.descriptionKey)}\n\n${stages}\n\n${t("decks.copy.supervision", { value: t(deck.supervisionKey) })}\n${t("decks.copy.stopLine", { value: t(deck.stopRuleKey) })}`;
}

function Metric({ label, value, tone = "normal" }: { label: string; value: string | number; tone?: "normal" | "good" | "warn" }) {
  return <div><p className={cn("text-[18px] font-semibold", tone === "good" ? "text-emerald-500" : tone === "warn" ? "text-amber-500" : "text-primary")}>{value}</p><p className="mt-0.5 text-[10px] text-muted">{label}</p></div>;
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
  const [overrides, setOverrides] = useState<Record<string, DeckOverride>>({});
  const [editing, setEditing] = useState(false);
  const [skillSearch, setSkillSearch] = useState("");
  const [addStageId, setAddStageId] = useState("");

  useEffect(() => {
    void api.getSettings(CUSTOM_DECKS_KEY).then((raw) => {
      if (!raw) return;
      try { setCustomDecks(JSON.parse(raw) as CustomDeck[]); } catch { /* optional local state */ }
    });
    void api.getSettings(DECK_OVERRIDES_KEY).then((raw) => {
      if (!raw) return;
      try { setOverrides(JSON.parse(raw) as Record<string, DeckOverride>); } catch { /* optional local state */ }
    });
    void api.getOrganizationAgentCapabilities().then((rows) => {
      const available = rows.filter((row) => row.available);
      setAgents(available);
      setAgentKey(available[0]?.key ?? "");
    }).catch(() => setAgents([]));
  }, []);

  const resolvedDecks = useMemo(() => new Map(DEFAULT_DECKS.map((deck) => [deck.id, discoverDeck(deck, managedSkills, overrides[deck.id])])), [managedSkills, overrides]);
  const selectedDefinition = DEFAULT_DECKS.find((deck) => deck.id === selectedDeckId);
  const selectedCustomDeck = customDecks.find((deck) => deck.id === selectedDeckId);
  const skillById = useMemo(() => new Map(managedSkills.map((skill) => [skill.id, skill])), [managedSkills]);

  const openSkill = (skill: ManagedSkill) => {
    openSkillDetailById(skill.id);
    navigate("/my-skills");
  };

  const saveCustomDecks = async (next: CustomDeck[]) => {
    setCustomDecks(next);
    await api.setSettings(CUSTOM_DECKS_KEY, JSON.stringify(next));
  };

  const saveOverrides = async (next: Record<string, DeckOverride>) => {
    setOverrides(next);
    await api.setSettings(DECK_OVERRIDES_KEY, JSON.stringify(next));
  };

  const generateDeck = async () => {
    if (goal.trim().length < 8 || !agentKey) return;
    setGenerating(true);
    try {
      const suggestion = await api.suggestDeckFromLibrary(goal.trim(), agentKey);
      const deck: CustomDeck = { id: `custom-${Date.now()}`, title: suggestion.title, summary: suggestion.summary, goal: goal.trim(), cards: suggestion.cards, gaps: suggestion.gaps, createdAt: Date.now() };
      await saveCustomDecks([deck, ...customDecks]);
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
          <div><h1 className="app-page-title">{t("decks.libraryTitle")}</h1><p className="mt-1.5 max-w-[760px] text-[13px] text-muted">{t("decks.libraryDescription", { count: managedSkills.length })}</p></div>
          <button type="button" className="app-button-primary" onClick={() => setCreatorOpen(true)}><Sparkles className="h-4 w-4" />{t("decks.newDeck")}</button>
        </div>

        {creatorOpen && (
          <section className="mb-3 rounded-xl border border-accent/25 bg-accent-bg/30 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-accent-bg p-2 text-accent-light"><Bot className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[14px] font-semibold text-primary">{t("decks.creator.title")}</h2>
                <p className="mt-0.5 text-[11.5px] text-muted">{t("decks.creator.description")}</p>
                <textarea value={goal} onChange={(event) => setGoal(event.target.value)} placeholder={t("decks.creator.placeholder")} className="mt-3 min-h-[80px] w-full resize-y rounded-lg border border-border-subtle bg-bg-primary px-3 py-2.5 text-[12px] leading-5 text-primary outline-none focus:border-accent/50" />
                <div className="mt-2.5 flex items-center justify-between gap-3">
                  <select value={agentKey} onChange={(event) => setAgentKey(event.target.value)} className="app-input h-9 max-w-[220px] text-[12px]">{agents.map((agent) => <option key={agent.key} value={agent.key}>{agent.display_name}</option>)}</select>
                  <div className="flex gap-2"><button type="button" className="app-button-secondary" onClick={() => setCreatorOpen(false)}>{t("common.cancel")}</button><button type="button" className="app-button-primary" disabled={generating || goal.trim().length < 8 || !agentKey} onClick={generateDeck}>{generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{generating ? t("decks.creator.generating") : t("decks.creator.generate")}</button></div>
                </div>
              </div>
            </div>
          </section>
        )}

        <div className="mb-2 flex items-center justify-between"><h2 className="text-[12px] font-semibold text-secondary">{t("decks.discoveredTitle")}</h2><span className="text-[10.5px] text-faint">{t("decks.scannedLibrary", { count: managedSkills.length })}</span></div>
        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-3 2xl:grid-cols-4">
          {DEFAULT_DECKS.map((deck) => {
            const resolved = resolvedDecks.get(deck.id) ?? [];
            const covered = new Set(resolved.map((item) => item.stage.id)).size;
            const gaps = deck.stages.length - covered;
            return (
              <button key={deck.id} type="button" onClick={() => { setSelectedDeckId(deck.id); setEditing(false); }} className="group app-panel min-h-[118px] p-3.5 text-left transition-colors hover:border-accent/35 hover:bg-surface-hover">
                <div className="flex items-start justify-between"><span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-500">{t("decks.discovered")}</span><ArrowRight className="h-4 w-4 text-faint transition-transform group-hover:translate-x-0.5" /></div>
                <h3 className="mt-3 text-[15px] font-semibold text-primary">{t(deck.titleKey)}</h3>
                <p className="mt-1 line-clamp-1 text-[11px] text-muted">{t(deck.descriptionKey)}</p>
                <div className="mt-3 flex items-center gap-3 text-[10px] text-faint"><span>{t("decks.coverage", { covered, total: deck.stages.length })}</span><span>{t("decks.skillCount", { count: resolved.length })}</span><span className={gaps ? "text-amber-500" : "text-emerald-500"}>{t("decks.gapCount", { count: gaps })}</span></div>
              </button>
            );
          })}
          {customDecks.map((deck) => (
            <button key={deck.id} type="button" onClick={() => setSelectedDeckId(deck.id)} className="group app-panel min-h-[118px] p-3.5 text-left transition-colors hover:border-accent/35 hover:bg-surface-hover">
              <div className="flex items-start justify-between"><span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-violet-500">{t("decks.aiBuilt")}</span><ArrowRight className="h-4 w-4 text-faint" /></div>
              <h3 className="mt-3 truncate text-[15px] font-semibold text-primary">{deck.title}</h3><p className="mt-1 line-clamp-1 text-[11px] text-muted">{deck.summary}</p>
              <div className="mt-3 text-[10px] text-faint">{t("decks.customMeta", { skills: deck.cards.length, gaps: deck.gaps.length })}</div>
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
        <button type="button" className="mb-3 flex items-center gap-1.5 text-[12px] text-muted hover:text-primary" onClick={() => setSelectedDeckId(null)}><ArrowLeft className="h-3.5 w-3.5" />{t("decks.back")}</button>
        <div className="app-page-header"><h1 className="app-page-title">{selectedCustomDeck.title}</h1><p className="mt-1.5 max-w-[760px] text-[13px] text-muted">{selectedCustomDeck.summary}</p></div>
        <div className="grid gap-3 lg:grid-cols-2">{stages.map((stage, index) => <section key={stage} className="app-panel p-4"><div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-bg text-[10px] font-semibold text-accent-light">{index + 1}</span><h2 className="text-[13px] font-semibold text-primary">{stage}</h2></div><div className="mt-3 space-y-2">{selectedCustomDeck.cards.filter((card) => card.stage === stage).map((card) => { const skill = skillById.get(card.skill_id); return <button key={card.skill_id} type="button" disabled={!skill} onClick={() => skill && openSkill(skill)} className="w-full rounded-lg border border-border-subtle bg-surface p-3 text-left hover:bg-surface-hover"><div className="flex justify-between"><span className="text-[12px] font-semibold text-primary">{skill?.name ?? t("decks.missingSkill")}</span><ChevronRight className="h-3.5 w-3.5 text-faint" /></div><p className="mt-1 text-[10.5px] font-medium text-secondary">{card.role}</p><p className="mt-1 text-[10.5px] text-muted">{card.reason}</p></button>; })}</div></section>)}</div>
        {selectedCustomDeck.gaps.length > 0 && <section className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4"><h2 className="text-[12px] font-semibold text-secondary">{t("decks.gaps")}</h2><ul className="mt-2 space-y-1.5 text-[11px] leading-5 text-muted">{selectedCustomDeck.gaps.map((gap) => <li key={gap}>· {gap}</li>)}</ul></section>}
      </div>
    );
  }

  if (!selectedDefinition) return null;
  const resolved = resolvedDecks.get(selectedDefinition.id) ?? [];
  const covered = new Set(resolved.map((item) => item.stage.id)).size;
  const gaps = selectedDefinition.stages.length - covered;
  const currentOverride = overrides[selectedDefinition.id] ?? { removedSkillIds: [], addedSkills: [] };
  const availableToAdd = managedSkills.filter((skill) => !resolved.some((item) => item.skill.id === skill.id) && skillText(skill).includes(normalizeDeckMatchText(skillSearch))).slice(0, 8);

  const updateOverride = async (next: DeckOverride) => saveOverrides({ ...overrides, [selectedDefinition.id]: next });
  const removeSkill = (skillId: string) => void updateOverride({ ...currentOverride, removedSkillIds: [...new Set([...currentOverride.removedSkillIds, skillId])], addedSkills: currentOverride.addedSkills.filter((item) => item.skillId !== skillId) });
  const addSkill = (skillId: string) => {
    const stageId = selectedDefinition.stages.some((stage) => stage.id === addStageId)
      ? addStageId
      : selectedDefinition.stages[0].id;
    void updateOverride({ ...currentOverride, removedSkillIds: currentOverride.removedSkillIds.filter((id) => id !== skillId), addedSkills: [...currentOverride.addedSkills.filter((item) => item.skillId !== skillId), { skillId, stageId }] });
    setSkillSearch("");
  };
  const resetDeck = () => void saveOverrides(Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== selectedDefinition.id)));
  const copyPrompt = async () => {
    try { await clipboardWriteText(buildDeckPrompt(selectedDefinition, resolved, t)); toast.success(t("decks.promptCopied")); } catch { toast.error(t("common.error")); }
  };

  return (
    <div className="app-page">
      <button type="button" className="mb-3 flex items-center gap-1.5 text-[12px] text-muted hover:text-primary" onClick={() => setSelectedDeckId(null)}><ArrowLeft className="h-3.5 w-3.5" />{t("decks.back")}</button>
      <div className="app-page-header flex items-start justify-between gap-4 pb-3">
        <div><div className="mb-1.5 flex items-center gap-2"><span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-500">{t("decks.discovered")}</span><span className="text-[10px] text-faint">{t("decks.editable")}</span></div><h1 className="app-page-title">{t(selectedDefinition.titleKey)}</h1><p className="mt-1.5 max-w-[760px] text-[13px] text-muted">{t(selectedDefinition.descriptionKey)}</p></div>
        <div className="flex gap-2"><button type="button" className="app-button-secondary" onClick={() => setEditing(!editing)}><Pencil className="h-4 w-4" />{editing ? t("decks.finishEditing") : t("decks.editDeck")}</button><button type="button" className="app-button-primary" onClick={copyPrompt}><Clipboard className="h-4 w-4" />{t("decks.copyPrompt")}</button></div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]">
        <section className="app-panel p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">{t("decks.solves")}</p><p className="mt-2 text-[14px] font-medium leading-6 text-primary">{t(selectedDefinition.outcomeKey)}</p></section>
        <section className="app-panel flex items-center justify-around p-4"><Metric label={t("decks.metrics.skills")} value={resolved.length} /><Metric label={t("decks.metrics.coverage")} value={`${covered}/${selectedDefinition.stages.length}`} tone="good" /><Metric label={t("decks.metrics.gaps")} value={gaps} tone={gaps ? "warn" : "good"} /></section>
      </div>

      <section className="mt-3 app-panel p-4">
        <div className="flex flex-wrap items-center gap-2">{selectedDefinition.stages.map((stage, index) => <div key={stage.id} className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-bg text-[10px] font-semibold text-accent-light">{index + 1}</span><span className="text-[11px] font-medium text-secondary">{t(stage.titleKey)}</span>{index < selectedDefinition.stages.length - 1 && <ArrowRight className="h-3 w-3 text-faint" />}</div>)}</div>
      </section>

      <div className="mt-3 grid gap-3 lg:grid-cols-2"><section className="rounded-xl border border-violet-500/20 bg-violet-500/[0.05] p-3.5"><div className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 text-violet-500" /><div><p className="text-[11px] font-semibold text-secondary">{t("decks.supervision")}</p><p className="mt-1 text-[11px] leading-5 text-muted">{t(selectedDefinition.supervisionKey)}</p></div></div></section><section className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-3.5"><div className="flex gap-2"><Check className="mt-0.5 h-4 w-4 text-amber-500" /><div><p className="text-[11px] font-semibold text-secondary">{t("decks.stopLine")}</p><p className="mt-1 text-[11px] leading-5 text-muted">{t(selectedDefinition.stopRuleKey)}</p></div></div></section></div>

      {editing && (
        <section className="mt-3 rounded-xl border border-accent/25 bg-accent-bg/20 p-4">
          <div className="flex items-center justify-between"><div><h2 className="text-[13px] font-semibold text-primary">{t("decks.editor.title")}</h2><p className="mt-1 text-[10.5px] text-muted">{t("decks.editor.description")}</p></div><button type="button" className="app-button-secondary" onClick={resetDeck}><RotateCcw className="h-3.5 w-3.5" />{t("decks.editor.reset")}</button></div>
          <div className="mt-3 flex gap-2"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-faint" /><input value={skillSearch} onChange={(event) => setSkillSearch(event.target.value)} placeholder={t("decks.editor.search")} className="app-input h-9 w-full pl-9 text-[11px]" /></div><select value={selectedDefinition.stages.some((stage) => stage.id === addStageId) ? addStageId : selectedDefinition.stages[0].id} onChange={(event) => setAddStageId(event.target.value)} className="app-input h-9 max-w-[190px] text-[11px]">{selectedDefinition.stages.map((stage) => <option key={stage.id} value={stage.id}>{t(stage.titleKey)}</option>)}</select></div>
          {skillSearch.trim() && <div className="mt-2 grid gap-1.5 md:grid-cols-2">{availableToAdd.map((skill) => <button key={skill.id} type="button" onClick={() => addSkill(skill.id)} className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface px-3 py-2 text-left hover:bg-surface-hover"><div className="min-w-0"><p className="truncate text-[11px] font-semibold text-primary">{skill.name}</p><p className="truncate text-[9.5px] text-muted">{skill.description}</p></div><Plus className="ml-2 h-3.5 w-3.5 text-accent-light" /></button>)}</div>}
        </section>
      )}

      <div className="mt-3 space-y-3">
        {selectedDefinition.stages.map((stage, index) => {
          const stageSkills = resolved.filter((item) => item.stage.id === stage.id);
          const checkpoints = stage.checkpoints ?? [];
          return <section key={stage.id} className="app-panel overflow-hidden"><div className="flex items-start gap-3 border-b border-border-subtle p-4"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-bg text-[11px] font-semibold text-accent-light">{index + 1}</span><div><h2 className="text-[13px] font-semibold text-primary">{t(stage.titleKey)}</h2><p className="mt-1 text-[11px] text-muted">{t(stage.purposeKey)}</p><p className="mt-1 text-[10.5px] font-medium text-secondary">{t(stage.questionKey)}</p></div></div><div className="p-3">{stageSkills.length === 0 && checkpoints.length === 0 ? <div className="rounded-lg border border-dashed border-amber-500/25 px-3 py-4 text-center text-[11px] text-amber-500">{t("decks.emptyStage")}</div> : <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{checkpoints.map((checkpoint) => <div key={checkpoint.titleKey} className="rounded-lg border border-violet-500/20 bg-violet-500/[0.05] p-3"><div className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-violet-500" /><p className="text-[12px] font-semibold text-primary">{t(checkpoint.titleKey)}</p></div><p className="mt-1 text-[10.5px] leading-5 text-muted">{t(checkpoint.purposeKey)}</p></div>)}{stageSkills.map(({ skill, source }) => <details key={skill.id} className="group rounded-lg border border-border-subtle bg-surface"><summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3"><div className="min-w-0"><p className="truncate text-[12px] font-semibold text-primary">{skill.name}</p><p className="mt-0.5 truncate text-[10px] text-muted">{source === "added" ? t("decks.reasons.added") : t("decks.reasons.matched", { stage: t(stage.titleKey) })}</p></div><div className="flex items-center gap-1.5">{editing && <button type="button" onClick={(event) => { event.preventDefault(); removeSkill(skill.id); }} className="rounded p-1 text-faint hover:bg-red-500/10 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>}<ChevronDown className="h-3.5 w-3.5 text-faint transition-transform group-open:rotate-180" /></div></summary><div className="border-t border-border-subtle px-3 pb-3 pt-2"><p className="text-[10.5px] leading-5 text-muted">{skill.description || t("decks.noDescription")}</p><button type="button" onClick={() => openSkill(skill)} className="mt-2 flex items-center gap-1 text-[10.5px] font-medium text-accent-light hover:underline">{t("decks.openSkill")}<ChevronRight className="h-3 w-3" /></button></div></details>)}</div>}</div></section>;
        })}
      </div>
    </div>
  );
}
