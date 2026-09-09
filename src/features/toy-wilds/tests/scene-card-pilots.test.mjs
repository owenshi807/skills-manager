import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getScenePilotReview } from '../scene-card-pilots.ts';

const reviewRoot = new URL('../../../../docs/reviews/scene-card-pilot-2026-09-09/', import.meta.url);
const [versions, snapshot] = await Promise.all([
  readFile(new URL('member-versions.json', reviewRoot), 'utf8').then(JSON.parse),
  readFile(new URL('source-snapshot.json', reviewRoot), 'utf8').then(JSON.parse),
]);
const versionById = new Map(versions.members.map(member => [member.id, member]));
const pilotIds = ['scene-36c2451fa91aad0e', 'scene-5dceda2d4cfc9a10'];

function pilotScene(id) {
  const scene = snapshot.scenes.find(candidate => candidate.id === id);
  assert.ok(scene, `fixture contains ${id}`);
  return {
    id: scene.id,
    name: scene.name,
    description: scene.description,
    members: scene.members.map(({ id }) => {
      const member = versionById.get(id);
      assert.ok(member, `fixture contains version for ${id}`);
      return { id, recordedContentHash: member.recordedContentHash, sourceRevision: member.sourceRevision };
    }),
  };
}

test('only the two stable pilot scene IDs receive dated reviews', () => {
  const reviews = pilotIds.map(id => getScenePilotReview(pilotScene(id)));
  assert.equal(reviews.filter(Boolean).length, 2);
  assert.deepEqual(reviews.map(review => review.reviewId), [
    'scene-business-review-20260909-v1',
    'scene-knowledge-review-20260909-v1',
  ]);
  const sameNameDifferentIdentity = { ...pilotScene(pilotIds[0]), id: 'scene-fixture-same-name' };
  assert.equal(getScenePilotReview(sameNameDifferentIdentity), null);
});

test('registered members and versions remain matched without granting a personal award', () => {
  for (const id of pilotIds) {
    const review = getScenePilotReview(pilotScene(id));
    assert.equal(review.freshness, 'matched');
    assert.equal(typeof review.art.url, 'string');
    assert.equal(review.art.url.startsWith('/scene-card-pilots/'), true);
    for (const forbidden of ['badge', 'achievement', 'person', 'owner', 'agentId']) assert.equal(forbidden in review, false);
  }
  const knowledge = getScenePilotReview(pilotScene(pilotIds[1]));
  assert.equal(knowledge.ssrStatus, 'supported');
  assert.match(knowledge.breakthrough.boundary, /永久奖章尚未入库/);
});

test('member, description, and recorded hash changes retain historical art but mark the review changed', () => {
  const expectedArt = getScenePilotReview(pilotScene(pilotIds[1])).art;
  const cases = [
    { label: 'member', mutate: scene => { scene.members.pop(); } },
    { label: 'description', mutate: scene => { scene.description = '新的场景说明'; } },
    { label: 'hash', mutate: scene => { scene.members[0].recordedContentHash = 'changed-hash'; } },
  ];
  for (const { label, mutate } of cases) {
    const scene = structuredClone(pilotScene(pilotIds[1])); mutate(scene);
    const review = getScenePilotReview(scene);
    assert.equal(review.freshness, 'changed', label);
    assert.equal(review.gradeLabel, '圣品 · 历史试绘', label);
    assert.deepEqual(review.art, expectedArt, label);
  }
});

test('review responses are deep copies and cannot be polluted by UI state', () => {
  const first = getScenePilotReview(pilotScene(pilotIds[1]));
  first.title = '污染的标题'; first.art.url = '/changed.png'; first.breakthrough.before = '污染的突破';
  const second = getScenePilotReview(pilotScene(pilotIds[1]));
  assert.equal(second.title, '溯源灵镜');
  assert.equal(second.art.url, '/scene-card-pilots/knowledge-sacred.png');
  assert.notEqual(second.breakthrough.before, '污染的突破');
});
