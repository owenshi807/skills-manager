import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DECKS, VIBE_CODING_DECK } from "../src/lib/deckCatalog.ts";
import { discoverDeck } from "../src/lib/deckDiscovery.ts";
import { buildSceneCapabilities } from "../src/lib/sceneCapabilities.ts";
import type { ManagedSkill } from "../src/lib/tauri.ts";
import type { SceneMembership, SkillScene } from "../src/lib/skillScenes.ts";

const scene: SkillScene = { id: "owned-business", name: "商业项目推演", description: "把商业判断组织成可检验的行动。", createdAt: 1, updatedAt: 1 };
function skill(id: string, name: string, description = ""): ManagedSkill {
  return { id, name, description, source_type: "local", status: "active", tags: [] } as unknown as ManagedSkill;
}
function memberships(skills: ManagedSkill[], sceneId = scene.id): Record<string, SceneMembership[]> {
  return Object.fromEntries(skills.map((row) => [row.id, [{ sceneId, reason: `实际归类依据：${row.name}`, source: "ai", updatedAt: 1 }]]));
}
function allIds(result: ReturnType<typeof buildSceneCapabilities>) {
  return result.capabilities.flatMap((capability) => capability.skillIds).sort();
}

test("capabilities use actual scene membership, including manual members, and do not mutate inputs", () => {
  const inside = skill("business", "business-coach");
  const outside = skill("outside", "finance-analysis");
  const assignments = { ...memberships([inside]), ...memberships([outside], "another-scene") };
  assignments[inside.id][0].source = "user";
  const before = JSON.stringify({ scene, assignments });
  const result = buildSceneCapabilities(scene, [inside, outside], assignments);
  assert.deepEqual(allIds(result), [inside.id]);
  assert.equal(result.deck?.id, "business");
  assert.equal(result.capabilities.flatMap((capability) => capability.evidence)[0].source, "user");
  assert.equal(JSON.stringify({ scene, assignments }), before);
});

test("own Business Coach and Review Loop remain visible alongside every uncapped custom Skill", () => {
  const skills = [skill("own-coach", "business-coach"), ...Array.from({ length: 9 }, (_, i) => skill(`own-${i}`, `business-workflow-${i}`)), skill("own-review", "codex-review-loop")];
  const result = buildSceneCapabilities(scene, skills, memberships(skills));
  assert.equal(result.deck?.id, "business");
  assert.deepEqual(allIds(result), skills.map((row) => row.id).sort());
  assert.equal(new Set(allIds(result)).size, skills.length);
  const supporting = result.capabilities.find((capability) => capability.id === `scene:${scene.id}:supporting`)!;
  assert.ok(supporting.skillIds.length > 1);
  assert.ok(supporting.skillIds.includes("own-review"));
  assert.equal(supporting.evidence.find((row) => row.skillId === "own-review")?.reason, "实际归类依据：codex-review-loop");
  assert.ok(result.capabilities.some((capability) => capability.source === "deck" && capability.missing));
});

test("generic words without a catalog anchor do not invent a workflow", () => {
  const skills = [skill("custom", "custom-review-method"), skill("custom2", "own-review-playbook")];
  const result = buildSceneCapabilities(scene, skills, memberships(skills));
  assert.equal(result.deck, undefined);
  assert.equal(result.capabilities.length, 1);
  assert.equal(result.capabilities[0].description, scene.description);
  assert.equal(result.capabilities[0].source, "scene");
  assert.deepEqual(allIds(result), ["custom", "custom2"]);
});

test("a lone catalog match does not force an unrelated majority into its recipe", () => {
  const skills = [skill("anchor", "business-coach"), ...Array.from({ length: 4 }, (_, i) => skill(`other-${i}`, `drawing-${i}`))];
  const result = buildSceneCapabilities(scene, skills, memberships(skills));
  assert.equal(result.deck, undefined);
  assert.equal(result.capabilities.length, 1);
  assert.equal(result.capabilities[0].skillIds.length, 5);
});

test("manual placement precedes discovery while excluded Skills stay visibly in their scene", () => {
  const skills = [skill("coach", "business-coach"), skill("finance", "finance-analysis"), skill("own", "private-synthesis")];
  const result = buildSceneCapabilities(scene, skills, memberships(skills), {
    business: { removedSkillIds: ["finance"], addedSkills: [{ skillId: "coach", stageId: "decision" }, { skillId: "own", stageId: "evidence" }] },
  });
  assert.equal(result.deck?.id, "business");
  assert.deepEqual(result.capabilities.find((row) => row.stageId === "decision")?.skillIds, ["coach"]);
  assert.deepEqual(result.capabilities.find((row) => row.stageId === "evidence")?.skillIds, ["own"]);
  const excluded = result.capabilities.find((row) => row.excludedFromDeck)!;
  assert.deepEqual(excluded.skillIds, ["finance"]);
  assert.equal(excluded.evidence[0].excludedFromDeck, true);
  assert.deepEqual(allIds(result), ["coach", "finance", "own"]);
});

test("exclusion overrides an addition and an entirely excluded recipe is not silently re-filled", () => {
  const skills = [skill("coach", "business-coach")];
  const result = buildSceneCapabilities(scene, skills, memberships(skills), {
    business: { removedSkillIds: ["coach"], addedSkills: [{ skillId: "coach", stageId: "decision" }] },
  });
  assert.equal(result.deck?.id, "business");
  assert.ok(result.capabilities.filter((row) => row.source === "deck").every((row) => row.missing));
  assert.deepEqual(result.capabilities.find((row) => row.excludedFromDeck)?.skillIds, ["coach"]);
});

test("same-name platform IDs stay distinct in the correct stage and IDs are stable across input order", () => {
  const skills = [skill("claude", "codex-review-loop"), skill("codex", "codex-review-loop"), skill("design", "design-review")];
  const resolved = discoverDeck(VIBE_CODING_DECK, skills);
  assert.deepEqual(resolved.map((row) => row.skill.id).sort(), ["claude", "codex", "design"]);
  assert.ok(resolved.every((row) => row.stage.id === "verify"));
  const first = buildSceneCapabilities(scene, skills, memberships(skills));
  const second = buildSceneCapabilities(scene, [...skills].reverse(), memberships(skills));
  assert.deepEqual(first, second);
  assert.deepEqual(allIds(first), ["claude", "codex", "design"]);
});

test("empty scenes and stale override references cannot fabricate members or capabilities", () => {
  const outside = skill("outside", "business-coach");
  const result = buildSceneCapabilities(scene, [outside], memberships([outside], "elsewhere"), {
    business: { removedSkillIds: [], addedSkills: [{ skillId: outside.id, stageId: "opportunity" }] },
  });
  assert.deepEqual(result.skillIds, []);
  assert.deepEqual(result.capabilities, []);
  assert.equal(result.deck, undefined);
  const business = DEFAULT_DECKS.find((row) => row.id === "business")!;
  assert.deepEqual(discoverDeck(business, [], { removedSkillIds: [], addedSkills: [{ skillId: "missing", stageId: "bad-stage" }] }), []);
});
