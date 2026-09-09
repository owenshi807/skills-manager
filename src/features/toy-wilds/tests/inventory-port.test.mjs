import assert from "node:assert/strict";
import test from "node:test";
import { mapGameInventory, readGameInventory, readGameSkillDocument } from "../inventory-port.ts";

const tool = { key: "codex", display_name: "Codex", installed: true, enabled: true, category: "coding", skills_dir: "/private/tool" };
const skill = {
  skill: { id: "skill-1", name: "Research", description: null, source_type: "git", source_revision: "abc123", content_hash: "hash-1", enabled: false, status: "ok", central_path: "/private/skill" },
  deployments: [{ tool: "codex", actual_status: "needs_sync", recorded_status: "installed", mode: "copy", synced_at: 1720000000000, target_path: "/private/target" }],
  platform_agent_keys: ["codex"],
};

test("projects real identity, source versions and deployment facts without local paths", () => {
  const result = mapGameInventory([[skill], []], [tool], "2026-09-09T08:00:00.000Z");
  assert.equal(result.total, 1);
  assert.equal(result.skills[0].id, "skill-1");
  assert.equal(result.skills[0].description, "");
  assert.equal(result.skills[0].sourceRevision, "abc123");
  assert.equal(result.skills[0].recordedContentHash, "hash-1");
  assert.equal(result.skills[0].enabled, false);
  assert.deepEqual(result.skills[0].deployments, [{ target: "codex", actualStatus: "needs_sync", recordedStatus: "installed", mode: "copy", lastSyncedAt: 1720000000000 }]);
  assert.equal(result.targets[0].detected, true);
  assert.deepEqual(result.multica, { connected: false, taskDispatchEnabled: false });
  assert.equal(JSON.stringify(result).includes("/private/"), false);
  assert.equal("rank" in result.skills[0], false);
});

test("rejects duplicate IDs and malformed/incomplete responses instead of publishing a partial library", () => {
  for (const library of [null, [], [[skill]], [[skill, skill], []], [[{ ...skill, deployments: undefined }], []], [[{ ...skill, skill: { ...skill.skill, id: "" } }], []]]) {
    assert.throws(() => mapGameInventory(library, [tool]), /快照不完整/);
  }
  assert.throws(() => mapGameInventory([[skill], []], [tool, tool]), /快照不完整/);
  assert.throws(() => mapGameInventory([[skill], []], null), /快照不完整/);
  assert.equal(mapGameInventory([[], []], []).total, 0);
});

test("preserves unknown versions and missing optional fields without manufacturing evidence", () => {
  const older = structuredClone(skill);
  delete older.skill.source_revision;
  delete older.skill.enabled;
  delete older.platform_agent_keys;
  older.skill.content_hash = null;
  older.deployments[0].synced_at = null;
  const mapped = mapGameInventory([[older], []], [tool]).skills[0];
  assert.equal(mapped.sourceRevision, null);
  assert.equal(mapped.recordedContentHash, null);
  assert.equal("enabled" in mapped, false);
  assert.deepEqual(mapped.platformAgentKeys, []);
  assert.equal(mapped.deployments[0].lastSyncedAt, null);
});

test("uses only the three official Tauri reads and rejects command failures", async () => {
  const previousWindow = globalThis.window;
  const commands = [];
  let fail = false;
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command) => {
    commands.push(command);
    if (fail && command === "get_skill_library") throw new Error("read failed");
    if (command === "get_skill_library") return [[skill], []];
    if (command === "get_tool_status") return [tool];
    if (command === "get_skill_scene_overview") return { scenes: [{ id: "scene-a", name: "研究", description: "围绕研究目标组织资料。" }], assignments: { "skill-1": [{ sceneId: "scene-a" }] } };
    throw new Error("unexpected command");
  } } };
  try {
    assert.equal((await readGameInventory()).total, 1);
    assert.deepEqual(commands, ["get_skill_library", "get_tool_status", "get_skill_scene_overview"]);
    fail = true;
    await assert.rejects(readGameInventory(), /read failed/);
    assert.deepEqual(commands, ["get_skill_library", "get_tool_status", "get_skill_scene_overview", "get_skill_library", "get_tool_status", "get_skill_scene_overview"]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});


test("document port uses a bounded fixed path and rejects a different Skill response", async () => {
  const previousWindow = globalThis.window;
  let wrong = false;
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
    assert.equal(command, "read_skill_publish_document");
    assert.deepEqual(args, { skillId: "skill-1", relativePath: "SKILL.md", maxBytes: 131072 });
    return { skill_id: wrong ? "someone-else" : "skill-1", relative_path: "SKILL.md", content: "原文", truncated: false, total_bytes: 6, content_digest: "digest" };
  } } };
  try {
    assert.equal((await readGameSkillDocument("skill-1")).content, "原文");
    wrong = true;
    await assert.rejects(readGameSkillDocument("skill-1"), /未完整返回/);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

test("scene entry never reads or generates individual Skill card documents", async () => {
  const previousWindow = globalThis.window, commands = [];
  const pilot = structuredClone(skill); pilot.skill.name = "grill-me";
  const other = structuredClone(skill); other.skill.id = "skill-2";
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async command => {
    commands.push(command);
    if (command === "get_skill_library") return [[pilot, other], []];
    if (command === "get_tool_status") return [tool];
    if (command === "get_skill_scene_overview") return { scenes: [{ id: "scene-a", name: "研究", description: "围绕研究目标组织资料。" }], assignments: { "skill-1": [{ sceneId: "scene-a" }] } };
    if (command === "read_skill_publish_document") throw new Error("cannot read");
    throw new Error("unexpected write");
  } } };
  try {
    const result = await readGameInventory();
    assert.equal(result.total, 2);
    assert.equal(result.skills[0].cardCopy, undefined);
    assert.equal(result.sceneTotal, 1);
    assert.deepEqual(result.scenes[0].skillIds, ["skill-1"]);
    assert.equal(result.unassignedSkillCount, 1);
    assert.deepEqual(commands, ["get_skill_library", "get_tool_status", "get_skill_scene_overview"]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

const scene = (id, name = id) => ({ id, name, description: "同一任务目标下的能力组成。" });
const member = id => ({ sceneId: id });

test("one existing scene is one card; shared members and same names preserve identities", () => {
  const second = structuredClone(skill); second.skill.id = "skill-2";
  const overview = { scenes: [scene("scene-a", "同名"), scene("scene-b", "同名"), scene("empty")], assignments: {
    "skill-1": [member("scene-a"), member("scene-a"), member("scene-b")],
    "skill-2": [member("scene-a")], "deleted": [member("scene-a")],
  }};
  const result = mapGameInventory([[skill, second], []], [], undefined, overview);
  assert.equal(result.sceneTotal, 3);
  assert.deepEqual(result.scenes.map(x => x.skillIds), [["skill-1", "skill-2"], ["skill-1"], []]);
  assert.equal(result.unassignedSkillCount, 0);
  assert.ok(result.scenes.every(x => x.grade === null));
  assert.equal(result.scenes[0].members[0].name, result.scenes[0].members[1].name);
});

test("adding content updates the same scene; unclassified or deleted links create no new card", () => {
  const second = structuredClone(skill); second.skill.id = "skill-2";
  const overview = { scenes: [scene("scene-a")], assignments: { "skill-1": [member("scene-a")] } };
  const before = mapGameInventory([[skill], []], [], undefined, overview);
  const unassigned = mapGameInventory([[skill, second], []], [], undefined, overview);
  assert.equal(unassigned.sceneTotal, 1); assert.equal(unassigned.unassignedSkillCount, 1);
  overview.assignments["skill-2"] = [member("scene-a")];
  const after = mapGameInventory([[skill, second], []], [], undefined, overview);
  assert.equal(before.scenes[0].id, after.scenes[0].id);
  assert.equal(after.scenes[0].members.length, 2);
  overview.assignments["skill-1"] = [member("removed-scene")];
  const removed = mapGameInventory([[skill, second], []], [], undefined, overview);
  assert.deepEqual(removed.scenes[0].skillIds, ["skill-2"]);
  assert.equal(removed.unassignedSkillCount, 1);
});

test("scene failures reject the replacement instead of silently showing individual Skill cards", () => {
  for (const overview of [null, {}, { scenes: [], assignments: [] }, { scenes: [scene("a"), scene("a")], assignments: {} }, { scenes: [scene("a")], assignments: { x: null } }]) {
    assert.throws(() => mapGameInventory([[skill], []], [], undefined, overview), /快照不完整/);
  }
});
