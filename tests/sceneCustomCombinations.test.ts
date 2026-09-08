import assert from "node:assert/strict";
import test from "node:test";
import {
  applySceneCustomCombination, parseSceneCustomCombinations, saveCombinationAsScene,
  removeSkillFromCombination, restoreSkillToCombination, sceneCombinationExcludedSkillIds,
  type SceneCombinationSaveDependencies, type SceneCustomCombination,
} from "../src/lib/sceneCustomCombinations.ts";
import type { SceneCapabilityGroup } from "../src/lib/sceneCapabilities.ts";
import type { ManagedSkill } from "../src/lib/tauri.ts";
import { buildSceneGuideText, usableSceneCapabilities } from "../src/lib/sceneCapabilityGuide.ts";

const plan: SceneCustomCombination = {
  id: "custom-1", title: "验证业务机会", summary: "先访谈，再整理成决策。", goal: "验证新的业务机会并明确下一步", createdAt: 1,
  cards: [
    { skill_id: "interview", stage: "验证需求", role: "找出真实问题", reason: "把假设变成可验证的问题" },
    { skill_id: "decision", stage: "形成决策", role: "制定行动", reason: "根据访谈证据决定下一步" },
  ], gaps: ["还需要补充真实用户访谈"],
};

function fixture(initial: SceneCustomCombination[] = []) {
  let raw: string | null = JSON.stringify(initial);
  let creates = 0;
  let writes = 0;
  const assignments: string[] = [];
  const deps: SceneCombinationSaveDependencies = {
    read: async () => raw,
    write: async (value) => { raw = value; writes++; },
    createScene: async (name, description) => { creates++; return { id: "scene-1", name, description, createdAt: 1, updatedAt: 1 }; },
    assign: async (id) => { assignments.push(id); },
    changed: () => undefined,
  };
  return { deps, assignments, records: () => parseSceneCustomCombinations(raw), creates: () => creates, writes: () => writes };
}

test("legacy plans round-trip without dropping fields, and malformed storage cannot become an empty collection", () => {
  const legacy = { ...plan, unknownLegacyField: { keep: true } };
  assert.deepEqual(parseSceneCustomCombinations(JSON.stringify([legacy])), [legacy]);
  assert.deepEqual(parseSceneCustomCombinations(null), []);
  const explained = { ...plan, stages: [{ name: "验证需求", purpose: "验证真实需求", handoff: "提供决策依据", done_when: "形成可复核的访谈结论" }] };
  assert.deepEqual(parseSceneCustomCombinations(JSON.stringify([explained])), [explained]);
  for (const raw of ["", "{}", JSON.stringify([{ ...plan, cards: "bad" }]), JSON.stringify([plan, plan]), JSON.stringify([{ ...plan, stages: [{ name: "wrong shape" }] }]), JSON.stringify([{ ...plan, excludedSkillIds: [5] }]), JSON.stringify([{ ...plan, sceneSaveMode: "ambiguous" }])]) {
    assert.throws(() => parseSceneCustomCombinations(raw));
  }
});

test("organizing an existing scene never creates or assigns, even when the preview still lists a removed member", async () => {
  const state = fixture();
  const existingScenePlan = { ...plan, sceneId: "existing-scene", sceneSaveMode: "existing-scene" as const };
  const saved = await saveCombinationAsScene(existingScenePlan, ["decision"], () => undefined, state.deps);
  assert.equal(state.creates(), 0);
  assert.deepEqual(state.assignments, []);
  assert.equal(saved.sceneId, "existing-scene");
  assert.equal(saved.sceneSaveMode, "existing-scene");
});

test("an existing-scene save retry preserves manual cancellation and the durable membership-free mode", async () => {
  const state = fixture();
  let attempted = 0;
  const write = state.deps.write;
  state.deps.write = async (raw) => { if (++attempted === 2) throw new Error("save interrupted"); await write(raw); };
  state.deps.assign = async () => { throw new Error("must never rewrite membership"); };
  const existingScenePlan = { ...plan, sceneId: "existing-scene", sceneSaveMode: "existing-scene" as const };
  await assert.rejects(saveCombinationAsScene(existingScenePlan, ["interview", "decision"], () => undefined, state.deps), /save interrupted/);
  assert.equal(state.records()[0].sceneSaveMode, "existing-scene");
  // The UI has stale IDs after the user removed interview in another surface.
  // Retry must only finish settings; it cannot undo that membership decision.
  const staleRetry = { ...plan, sceneId: "existing-scene" };
  await saveCombinationAsScene(staleRetry, ["interview", "decision"], () => undefined, state.deps);
  assert.equal(state.records()[0].sceneImportStatus, "complete");
  assert.equal(state.creates(), 0);
});

test("legacy linked records are upgraded conservatively without guessing import write authority", async () => {
  const legacy = { ...plan, sceneId: "legacy-scene", sceneImportStatus: "pending" as const };
  const state = fixture([legacy]);
  const saved = await saveCombinationAsScene(legacy, ["interview", "decision"], () => undefined, state.deps);
  assert.equal(saved.sceneSaveMode, "existing-scene");
  assert.deepEqual(state.assignments, []);
});

test("a failed settings read performs no write, scene creation, or assignment", async () => {
  const state = fixture([plan]);
  state.deps.read = async () => { throw new Error("storage unavailable"); };
  await assert.rejects(saveCombinationAsScene(plan, ["interview", "decision"], () => undefined, state.deps), /storage unavailable/);
  assert.equal(state.writes(), 0);
  assert.equal(state.creates(), 0);
  assert.deepEqual(state.assignments, []);
});

test("a partial assignment failure retains the scene ID and resumes it without replacing another saved plan", async () => {
  const previous = { ...plan, id: "prior-plan", title: "此前的方案" };
  const state = fixture([previous]);
  let fail = true;
  const assign = state.deps.assign;
  state.deps.assign = async (id, sceneId, reason) => {
    if (id === "decision" && fail) throw new Error("assignment failed");
    await assign(id, sceneId, reason);
  };
  let progress = plan;
  await assert.rejects(saveCombinationAsScene(plan, ["interview", "decision"], (value) => { progress = value; }, state.deps), /assignment failed/);
  assert.equal(progress.sceneId, "scene-1");
  assert.equal(progress.sceneSaveMode, "new-scene-import");
  assert.equal(state.records()[0].sceneImportStatus, "pending");
  assert.deepEqual(state.records()[1], previous);
  fail = false;
  // Even after remount, the persisted ID is recovered from the old record.
  const saved = await saveCombinationAsScene(plan, ["interview", "decision"], () => undefined, state.deps);
  assert.equal(saved.sceneImportStatus, "complete");
  assert.equal(saved.sceneId, "scene-1");
  assert.equal(saved.sceneSaveMode, "new-scene-import");
  assert.equal(state.creates(), 1);
  assert.deepEqual(state.records()[1], previous);
  assert.deepEqual(state.assignments, ["interview", "interview", "decision"]);
});

test("preview removals remain excluded through regeneration, saved plans, and copied instructions", async () => {
  const sceneId = "scene-1";
  const removed = removeSkillFromCombination({ ...plan, sceneId, sceneSaveMode: "existing-scene" }, "interview");
  assert.deepEqual(removed.excludedSkillIds, ["interview"]);
  assert.ok(!removed.cards.some((card) => card.skill_id === "interview"));
  const state = fixture();
  await saveCombinationAsScene(removed, ["interview", "decision"], () => undefined, state.deps);
  const exclusions = sceneCombinationExcludedSkillIds(sceneId, state.records(), ["old-deck-removal"]);
  assert.deepEqual(new Set(exclusions), new Set(["interview", "old-deck-removal"]));
  assert.deepEqual(sceneCombinationExcludedSkillIds("unrelated-scene", state.records()), []);
  // Even a regenerated suggestion containing the excluded ID cannot restore it.
  const regenerated = { ...plan, id: "custom-regenerated", createdAt: 2, sceneId, sceneSaveMode: "existing-scene" as const };
  await saveCombinationAsScene(regenerated, ["interview", "decision"], () => undefined, state.deps);
  assert.ok(state.records()[0].excludedSkillIds?.includes("interview"));
  const base: SceneCapabilityGroup = { sceneId, skillIds: ["interview", "decision", "automatic-omission"], capabilities: [], uncoveredSkillIds: [] };
  const skills = base.skillIds.map((id) => ({ id, name: id, description: "test skill" }) as ManagedSkill);
  const assignments = Object.fromEntries(base.skillIds.map((id) => [id, [{ sceneId, source: "user" as const, reason: "用户确认", updatedAt: 1 }]]));
  const result = applySceneCustomCombination(base, state.records(), skills, assignments);
  const excluded = result.capabilities.find((row) => row.excludedFromDeck)!;
  assert.deepEqual(excluded.skillIds, ["interview"]);
  assert.equal(excluded.evidence[0].excludedFromDeck, true);
  assert.deepEqual(usableSceneCapabilities(result, skills).flatMap((row) => row.skillIds), ["decision", "automatic-omission"]);
  const copied = buildSceneGuideText({ id: sceneId, name: "业务验证", description: "验证工作目标", createdAt: 1, updatedAt: 1 }, result, skills, (key) => key);
  assert.ok(!copied.includes("Skill ID: interview"));
  assert.ok(copied.includes("Skill ID: automatic-omission"));
  assert.deepEqual(state.assignments, []);
});

test("old Deck exclusions stay outside a custom combination and its copied guide", () => {
  const sceneId = "scene-1";
  const base: SceneCapabilityGroup = { sceneId, skillIds: ["interview", "decision"], capabilities: [{
    id: "legacy-excluded", title: "旧牌组排除", skillIds: ["interview"], checkpoints: [], source: "scene", missing: false,
    excludedFromDeck: true, evidence: [{ skillId: "interview", source: "user", reason: "旧排除", excludedFromDeck: true }],
  }], uncoveredSkillIds: ["interview"] };
  const skills = base.skillIds.map((id) => ({ id, name: id, description: "test skill" }) as ManagedSkill);
  const assignments = Object.fromEntries(base.skillIds.map((id) => [id, [{ sceneId, source: "user" as const, reason: "用户确认", updatedAt: 1 }]]));
  const result = applySceneCustomCombination(base, [{ ...plan, sceneId }], skills, assignments);
  assert.deepEqual(usableSceneCapabilities(result, skills).flatMap((row) => row.skillIds), ["decision"]);
  assert.deepEqual(result.capabilities.find((row) => row.excludedFromDeck)?.skillIds, ["interview"]);
  const copied = buildSceneGuideText({ id: sceneId, name: "业务验证", description: "", createdAt: 1, updatedAt: 1 }, result, skills, (key) => key);
  assert.ok(!copied.includes("Skill ID: interview"));
  assert.equal(result.summary, plan.summary);
});

test("removing every Skill from an existing combination saves an explicit empty combination", async () => {
  const state = fixture();
  const start = { ...plan, sceneId: "scene-1", sceneSaveMode: "existing-scene" as const };
  const removed = removeSkillFromCombination(removeSkillFromCombination(start, "interview"), "decision");
  await saveCombinationAsScene(removed, ["interview", "decision"], () => undefined, state.deps);
  assert.deepEqual(state.records()[0].cards, []);
  assert.deepEqual(new Set(state.records()[0].excludedSkillIds), new Set(["interview", "decision"]));
  assert.deepEqual(state.assignments, []);
});

test("after excluding every Skill, an explicit restoration takes effect only after save and survives regeneration", async () => {
  const sceneId = "scene-1";
  const state = fixture();
  const excluded = removeSkillFromCombination(removeSkillFromCombination({ ...plan, sceneId, sceneSaveMode: "existing-scene" }, "interview"), "decision");
  await saveCombinationAsScene(excluded, ["interview", "decision"], () => undefined, state.deps);
  const base: SceneCapabilityGroup = { sceneId, skillIds: ["interview", "decision"], capabilities: [], uncoveredSkillIds: [] };
  const skills = base.skillIds.map((id) => ({ id, name: id, description: "test" }) as ManagedSkill);
  const assignments = Object.fromEntries(base.skillIds.map((id) => [id, [{ sceneId, source: "user" as const, reason: "已归入", updatedAt: 1 }]]));
  const draft = restoreSkillToCombination({ ...excluded, id: "restored", createdAt: 2 }, "interview");
  assert.deepEqual(usableSceneCapabilities(applySceneCustomCombination(base, state.records(), skills, assignments), skills), []);
  await saveCombinationAsScene(draft, base.skillIds, () => undefined, state.deps);
  const result = applySceneCustomCombination(base, state.records(), skills, assignments);
  assert.deepEqual(usableSceneCapabilities(result, skills).flatMap((row) => row.skillIds), ["interview"]);
  assert.deepEqual(sceneCombinationExcludedSkillIds(sceneId, state.records()), ["decision"]);
  assert.deepEqual(result.capabilities.find((row) => row.excludedFromDeck)?.skillIds, ["decision"]);
  assert.deepEqual(result.capabilities.find((row) => row.title === "补充能力")?.skillIds, ["interview"]);
  const removedAgain = removeSkillFromCombination(draft, "interview");
  assert.deepEqual(removedAgain.restoredSkillIds, []);
  assert.ok(removedAgain.excludedSkillIds?.includes("interview"));
  assert.deepEqual(state.assignments, []);
});

test("a saved restoration can override an old Deck exclusion without AI or membership writes", async () => {
  const sceneId = "scene-1";
  const state = fixture();
  const base: SceneCapabilityGroup = { sceneId, skillIds: ["interview"], capabilities: [{
    id: "old-exclusion", title: "旧排除", skillIds: ["interview"], checkpoints: [], source: "scene", missing: false,
    excludedFromDeck: true, evidence: [{ skillId: "interview", source: "user", reason: "旧排除", excludedFromDeck: true }],
  }], uncoveredSkillIds: ["interview"] };
  const skills = [{ id: "interview", name: "interview", description: "test" }] as ManagedSkill[];
  const assignments = { interview: [{ sceneId, source: "user" as const, reason: "原有理由", updatedAt: 1 }] };
  const draft = restoreSkillToCombination({ ...plan, cards: [], sceneId, sceneSaveMode: "existing-scene", excludedSkillIds: ["interview"] }, "interview");
  assert.deepEqual(usableSceneCapabilities(applySceneCustomCombination(base, state.records(), skills, assignments), skills), []);
  await saveCombinationAsScene(draft, base.skillIds, () => undefined, state.deps);
  assert.deepEqual(sceneCombinationExcludedSkillIds(sceneId, state.records(), ["interview"]), []);
  const result = applySceneCustomCombination(base, state.records(), skills, assignments);
  assert.deepEqual(usableSceneCapabilities(result, skills).flatMap((row) => row.skillIds), ["interview"]);
  const copied = buildSceneGuideText({ id: sceneId, name: "业务验证", description: "", createdAt: 1, updatedAt: 1 }, result, skills, (key) => key);
  assert.ok(copied.includes("Skill ID: interview"));
  assert.equal(result.capabilities[0].evidence[0].reason, "原有理由");
  assert.equal(result.summary, plan.summary);
  assert.equal(state.creates(), 0);
  assert.deepEqual(state.assignments, []);
});

test("failure to persist the returned scene ID retains it in progress for a same-session retry", async () => {
  const state = fixture();
  const write = state.deps.write;
  let attempted = 0;
  state.deps.write = async (raw) => { if (++attempted === 2) throw new Error("disk full"); await write(raw); };
  let progress = plan;
  await assert.rejects(saveCombinationAsScene(plan, ["interview"], (value) => { progress = value; }, state.deps), /disk full/);
  assert.equal(progress.sceneId, "scene-1");
  await saveCombinationAsScene(progress, ["interview"], () => undefined, state.deps);
  assert.equal(state.creates(), 1);
});

test("removed library IDs are never assigned and long reasons respect the backend limit", async () => {
  const state = fixture();
  const reasons: string[] = [];
  state.deps.assign = async (id, _scene, reason) => { state.assignments.push(id); reasons.push(reason); };
  await saveCombinationAsScene({ ...plan, cards: plan.cards.map((card) => ({ ...card, reason: "长".repeat(1000) })) }, ["interview"], () => undefined, state.deps);
  assert.deepEqual(state.assignments, ["interview"]);
  assert.equal([...reasons[0]].length, 500);
  assert.equal(state.records()[0].cards[0].reason.length, 1000);
});

test("custom capabilities retain manual membership corrections, supplementary skills, and saved gaps", () => {
  const saved = { ...plan, sceneId: "scene-1", sceneImportStatus: "complete" as const };
  const base: SceneCapabilityGroup = { sceneId: "scene-1", skillIds: ["decision", "extra"], capabilities: [], uncoveredSkillIds: [] };
  const skills = ["interview", "decision", "extra"].map((id) => ({ id }) as ManagedSkill);
  const assignments = Object.fromEntries(["decision", "extra"].map((id) => [id, [{ sceneId: "scene-1", source: "user" as const, reason: "用户确认", updatedAt: 1 }]]));
  const result = applySceneCustomCombination(base, [saved], skills, assignments);
  assert.deepEqual(result.capabilities.flatMap((row) => row.skillIds), ["decision", "extra"]);
  assert.equal(result.capabilities[0].title, "形成决策");
  assert.match(result.capabilities[0].description!, /制定行动：根据访谈证据决定下一步/);
  assert.equal(result.capabilities[0].evidence[0].reason, "用户确认");
  assert.equal(result.capabilities[1].title, "补充能力");
  assert.equal(result.capabilities[2].missing, true);
  assert.equal(result.capabilities[2].description, plan.gaps[0]);
  assert.equal(applySceneCustomCombination(base, [{ ...saved, sceneImportStatus: "pending" }], skills, assignments), base);
  const withExplanation = { ...saved, stages: [{ name: "形成决策", purpose: "把经过验证的证据转成可执行选择", handoff: "将取舍和下一步交给执行者", done_when: "每个选择都有证据、负责人和检查时间" }] };
  const explained = applySceneCustomCombination(base, [withExplanation], skills, assignments).capabilities[0];
  assert.equal(explained.description, withExplanation.stages[0].purpose);
  assert.equal(explained.handoff, withExplanation.stages[0].handoff);
  assert.equal(explained.question, withExplanation.stages[0].done_when);
});
