import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateSceneProfiles, projectSceneSkillIds, SCENE_STORAGE, LEGACY_STORAGE, isSceneProfileRecord } from '../scene-loadouts.js';

const first = { id: 'local:11111111-1111-4111-8111-111111111111', name: '观星者', lineage: 'sage', createdAt: '2026-09-01T00:00:00Z' };
const second = { id: 'local:22222222-2222-4222-8222-222222222222', name: '铸造师', lineage: 'maker', createdAt: '2026-09-02T00:00:00Z' };
const newCharacter = () => ({ ...first });

test('v3 migration preserves identity and old choices without equipping matching scene IDs', () => {
  const legacy = { version: 3, agents: [first, second], selectedAgentRef: second.id, loadouts: { [first.id]: ['knowledge-audit'], [second.id]: ['business-scene', 'grill-me'] } };
  const before = JSON.stringify(legacy);
  const result = migrateSceneProfiles(null, legacy, newCharacter);
  assert.deepEqual(result.agents, legacy.agents);
  assert.equal(result.selectedAgentRef, second.id);
  assert.deepEqual(result.sceneLoadouts, { [first.id]: [], [second.id]: [] });
  assert.deepEqual(result.legacySkillIds, legacy.loadouts);
  assert.equal(JSON.stringify(legacy), before);
  assert.notEqual(SCENE_STORAGE, LEGACY_STORAGE);
});

test('v4 has precedence and keeps missing scenes across reloads without reimporting v3', () => {
  const current = { version: 4, agents: [first], selectedAgentRef: first.id, sceneLoadouts: { [first.id]: ['scene:known', 'scene:missing'] }, legacySkillIds: { [first.id]: ['old-skill'] } };
  const result = migrateSceneProfiles(current, { version: 3, agents: [second] }, newCharacter);
  assert.deepEqual(result, current);
  assert.deepEqual(projectSceneSkillIds(null, result.sceneLoadouts[first.id]), []);
  assert.deepEqual(result.sceneLoadouts[first.id], ['scene:known', 'scene:missing']);
});

test('scene member projection deduplicates shared Skills and never includes legacy choices', () => {
  const scenes = [{ id: 'a', skillIds: ['shared', 'one'] }, { id: 'b', skillIds: ['shared', 'two'] }, { id: 'c', skillIds: ['not-selected'] }];
  assert.deepEqual(projectSceneSkillIds(scenes, ['a', 'b', 'missing']), ['shared', 'one', 'two']);
  assert.deepEqual(projectSceneSkillIds(scenes, ['shared']), []);
});

test('invalid records do not manufacture characters or import runtime targets and v2', () => {
  const legacy = { version: 3, agents: [null, { ...first, id: 'multica:foreign' }, first, first], loadouts: { [first.id]: [null, '', 'x', 'x'] } };
  const result = migrateSceneProfiles(null, legacy, newCharacter);
  assert.deepEqual(result.agents, [first]);
  assert.deepEqual(result.legacySkillIds[first.id], ['x']);
  const blank = migrateSceneProfiles(null, { version: 2, agents: [second], loadouts: { [second.id]: ['foreign'] } }, newCharacter);
  assert.deepEqual(blank.agents, [first]);
  assert.deepEqual(blank.legacySkillIds[first.id], []);
});

test('parseable but damaged v4 records cannot be persisted over their original bytes', () => {
  const current = { version: 4, agents: [first], selectedAgentRef: first.id, sceneLoadouts: { [first.id]: ['scene-a'] }, legacySkillIds: { [first.id]: [] } };
  assert.equal(isSceneProfileRecord(current), true);
  for (const value of [undefined, null, {}, 'scene-a', [null]]) {
    const bad = structuredClone(current); bad.sceneLoadouts[first.id] = value;
    assert.equal(isSceneProfileRecord(bad), false);
  }
  const bad = structuredClone(current); bad.selectedAgentRef = 'missing';
  assert.equal(isSceneProfileRecord(bad), false);
});
