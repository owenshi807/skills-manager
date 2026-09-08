import assert from "node:assert/strict";
import test from "node:test";
import { buildSceneGuideText, guideText, usableSceneCapabilities } from "../src/lib/sceneCapabilityGuide.ts";
import type { SceneCapability, SceneCapabilityGroup } from "../src/lib/sceneCapabilities.ts";
import type { ManagedSkill } from "../src/lib/tauri.ts";
import type { SkillScene } from "../src/lib/skillScenes.ts";

const scene: SkillScene = { id: "review", name: "代码审核", description: "审查本次改动，验证实际风险。", createdAt: 1, updatedAt: 1 };
const capability: SceneCapability = { id: "review", title: "审查改动", description: "审阅代码并验证发现。", skillIds: ["own-review", "peer-review"], checkpoints: [{ titleKey: "scope.title", purposeKey: "scope.purpose" }], source: "deck", missing: false, evidence: [{ skillId: "own-review", reason: "用户自建的审核方法", source: "user", excludedFromDeck: false }] };
const skills = [
  { id: "own-review", name: "codex-review-loop", description: "独立复审并收敛已确认的问题。" },
  { id: "peer-review", name: "project-code-review", description: "结合项目约束进行审核。" },
  { id: "excluded", name: "excluded-skill", description: "Excluded role" },
  { id: "foreign", name: "foreign-skill", description: "Foreign role" },
] as ManagedSkill[];
const group: SceneCapabilityGroup = {
  sceneId: scene.id,
  skillIds: ["own-review", "peer-review", "excluded"],
  uncoveredSkillIds: [],
  capabilities: [capability, { ...capability, id: "missing", title: "构建界面", skillIds: [], missing: true }, { ...capability, id: "excluded", skillIds: ["excluded"], excludedFromDeck: true }],
};
const translate = (key: string) => ({ "scope.title": "IPO Scope Check", "scope.purpose": "Input 是否充分；Process 是否最小；Output 是否可验；现在能否停止。" })[key] || key;

test("copy guide contains the scene goal and actual member duties without excluded or foreign Skills", () => {
  const text = buildSceneGuideText(scene, group, skills, translate);
  assert.match(text, /当前目标：审查本次改动，验证实际风险/);
  assert.match(text, /codex-review-loop \[Skill ID: own-review\]：独立复审/);
  assert.match(text, /project-code-review \[Skill ID: peer-review\]：结合项目约束/);
  assert.match(text, /用户自建的审核方法/);
  assert.doesNotMatch(text, /excluded-skill|foreign-skill/);
});

test("guides never promise checks have passed or impose ordered execution within a capability", () => {
  const text = buildSceneGuideText(scene, group, skills, translate);
  assert.match(text, /同组 Skill 是候选项，不是有序依赖；不要自动全部运行/);
  assert.match(text, /待执行检查（不是已完成结果）/);
  assert.match(text, /不属于当前可用能力/);
  assert.doesNotMatch(text, /IPO|Input|Process|Output/);
});

test("removed library members and accidental cross-scene IDs cannot enter the usable guide", () => {
  const staleGroup = { ...group, capabilities: [{ ...capability, skillIds: ["own-review", "no-longer-present", "foreign"] }] };
  assert.deepEqual(usableSceneCapabilities(staleGroup, skills).map((row) => row.skillIds), [["own-review"]]);
  const text = buildSceneGuideText(scene, staleGroup, skills, translate);
  assert.doesNotMatch(text, /foreign-skill|no-longer-present/);
});

test("empty scenes do not acquire the broad template's goal and missing content is reported plainly", () => {
  const text = buildSceneGuideText({ ...scene, description: "" }, { ...group, capabilities: [] }, skills, translate);
  assert.match(text, /当前目标：围绕「代码审核」完成用户当前交代的任务/);
  assert.match(text, /当前场景没有可用的 Skill 组合/);
  assert.equal(guideText("scope.title", translate), "范围与交付检查");
});
