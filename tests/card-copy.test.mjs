import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getCardCopy, reviewCardCopy } from '../src/features/toy-wilds/card-copy.js';

// A small exact source fixture keeps the hash/identity regressions independent
// of an installed local Skill library. Do not normalize its whitespace.
const GRILL = `---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.
`;
const skill = { id: 'fixture-real-skill-1', name: 'grill-me', description: '逐题追问方案中的关键选择。' };
const document = { skill_id: skill.id, content: GRILL, truncated: false };

test('exact complete source yields human copy and independent result objects', async () => {
  const first = await reviewCardCopy(skill, document);
  assert.equal(first.kind, 'reviewed');
  assert.equal(first.title, '方案追问');
  assert.match(first.condition, /一次回答一个问题/);
  assert.ok(first.steps.some(step => step.includes('推荐答案')));
  first.steps.push('not reviewed'); first.value = 'not reviewed';
  const second = await reviewCardCopy(skill, document);
  assert.equal(second.kind, 'reviewed');
  assert.ok(!second.steps.includes('not reviewed'));
  assert.notEqual(second.value, 'not reviewed');
});

test('same name and claimed old hashes cannot authenticate changed document bytes', async () => {
  const claimed = '74147eb6010a65957efef2b9e0f0b3ff935c1def7fc117697151b1d0f3610556';
  for (const content of [`${GRILL}\n`, GRILL.replace('one at a time', 'all at once'), GRILL.replaceAll('\n', '\r\n')]) {
    const result = await reviewCardCopy({ ...skill, recordedContentHash: claimed }, { ...document, content, content_hash: claimed, sha256: claimed });
    assert.notEqual(result.kind, 'reviewed');
    assert.equal(result.title, skill.name);
    assert.match(result.evidenceNote, /版本.*不符/);
  }
});

test('truncated, unspecified-completeness and mismatched-identity documents fail closed', async () => {
  for (const update of [{ truncated: true }, { truncated: undefined }, { skill_id: 'another-skill' }, { skill_id: undefined }, { content: '' }]) {
    assert.notEqual((await reviewCardCopy(skill, { ...document, ...update })).kind, 'reviewed');
  }
  assert.notEqual((await reviewCardCopy({ ...skill, id: '' }, { ...document, skill_id: '' })).kind, 'reviewed');
});

test('exact content cannot confer another name or reuse previously reviewed copy', async () => {
  assert.notEqual((await reviewCardCopy({ ...skill, name: 'business-coach' }, document)).kind, 'reviewed');
  assert.notEqual((await reviewCardCopy({ ...skill, name: 'Grill-me' }, document)).kind, 'reviewed');
  const cardCopy = await reviewCardCopy(skill, document);
  const result = await reviewCardCopy({ ...skill, cardCopy }, { ...document, content: 'Changed source.' });
  assert.equal(result.kind, 'excerpt');
  assert.equal(result.title, skill.name);
});

test('short complete original descriptions remain unchanged excerpts', () => {
  for (const description of ['逐题追问方案中的关键选择。', 'Review a plan. Ask one question at a time.', '先读取资料。只处理可验证的原文。']) {
    const copy = getCardCopy({ name: 'original-name', description });
    assert.equal(copy.kind, 'excerpt'); assert.equal(copy.value, description); assert.equal(copy.title, 'original-name');
    assert.deepEqual([copy.when, copy.outcome, copy.condition, copy.input], ['', '', '', '']);
    assert.deepEqual(copy.steps, []); assert.match(copy.evidenceNote, /原说明摘录/);
  }
});

test('long engineering descriptions, unfinished clauses and markup are not pseudo-summarized', () => {
  const descriptions = [
    '读取 schema 与 runtime，并解析候选状态、跨库适配器、临时收据和部署元数据。'.repeat(8),
    `整理项目。${'必须先核验所有未解决的权限和输入条件，'.repeat(8)}`,
    '帮助分析你的方案，但只有在',
    '## Core workflow\nRead source.md and invoke the adapter.',
    '<strong>保证项目成功。</strong>',
    '[Read more](https://example.invalid).',
    '', undefined,
  ];
  for (const description of descriptions) {
    const copy = getCardCopy({ name: 'source-name', description });
    assert.equal(copy.kind, 'missing'); assert.equal(copy.title, 'source-name');
    assert.equal(copy.value, '这张卡的能力说明还在整理。');
    assert.equal(copy.when + copy.outcome + copy.condition, ''); assert.match(copy.evidenceNote, /未自动概括长文/);
  }
});

test('sync accessor accepts the full plain-text shape and rejects partial or HTML payloads', async () => {
  const copy = await reviewCardCopy(skill, document);
  assert.deepEqual(getCardCopy({ ...skill, cardCopy: copy }), copy);
  for (const invalid of [{ title: '只有标题' }, { ...copy, kind: 'curated' }, { ...copy, steps: [42] }, { ...copy, value: '<b>extra power</b>' }, { ...copy, evidenceNote: '' }]) {
    assert.equal(getCardCopy({ ...skill, cardCopy: invalid }).kind, 'excerpt');
  }
});

test('hash service errors fail closed rather than displaying stale reviewed content', async t => {
  t.mock.method(globalThis.crypto.subtle, 'digest', async () => { throw new Error('crypto unavailable'); });
  const result = await reviewCardCopy(skill, document);
  assert.notEqual(result.kind, 'reviewed'); assert.match(result.evidenceNote, /核验未完成/);
});

// Optional local integration: these read the real library, never the Codex
// installation. Core identity/hash tests above still run on a clean checkout.
for (const name of ['grill-me', 'business-coach', 'knowledge-audit']) {
  test(`reviewed copy matches the installed real-library source: ${name}`, async t => {
    const directory = process.env.SKILL_CARD_COPY_LIBRARY || join(homedir(), '.skills-manager', 'skills');
    let content;
    try { content = await readFile(join(directory, name, 'SKILL.md'), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') { t.skip('real local Skill library is not installed'); return; } throw error; }
    const result = await reviewCardCopy({ id: name, name }, { skill_id: name, content, truncated: false });
    assert.equal(result.kind, 'reviewed', 'source changed: re-review wording and fingerprint before updating the curated entry');
    assert.ok([...result.value].length >= 20 && [...result.value].length <= 30);
    assert.ok([...result.when].length <= 25 && [...result.outcome].length <= 30 && [...result.condition].length <= 30);
    assert.ok([...result.value + result.when + result.outcome + result.condition].length <= 110);
    if (name === 'knowledge-audit') {
      assert.match(result.condition, /接通库内规则.*完整原文.*通过后继续收录/);
      assert.match(result.evidenceNote, /未验证跨库规则或依赖/);
      assert.doesNotMatch(result.value + result.outcome, /可信度|反证|知识增量|来源核验/);
    }
    if (name === 'business-coach') assert.match(result.outcome, /完整推演含项目画布/);
  });
}
