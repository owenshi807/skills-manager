// Scene-card acceptance with explicit browser fixtures; no real business writes.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalFixtureInit } from './portal-fixture.mjs';
const taskHome = homedir();
const { chromium } = await import(pathToFileURL(join(taskHome, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const output = process.env.SCENE_TEST_OUTPUT || process.env.COPY_TEST_OUTPUT || '/private/tmp/scene-card-check';
const url = process.env.APP_URL || 'http://127.0.0.1:4186';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: join(taskHome, 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing') });
const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, locale: 'zh-CN' });
const report = { fixtureOnly: true, checks: [], errors: [], ipc: [] };
await context.exposeBinding('__portalRecordIPC', (_, entry) => report.ipc.push(entry));
await context.addInitScript(portalFixtureInit);
await context.addInitScript(() => {
  const old = { version: 3, agents: [{ id: 'local:11111111-1111-4111-8111-111111111111', name: '旧观星者', lineage: 'sage', createdAt: '2026-09-09' }], selectedAgentRef: 'local:11111111-1111-4111-8111-111111111111', loadouts: { 'local:11111111-1111-4111-8111-111111111111': ['fixture-skill-001', 'knowledge-1'] } };
  localStorage.setItem('skills-manager.toy-wilds.agent-loadouts.v3', JSON.stringify(old));
  const original = window.__TAURI_INTERNALS__.invoke;
  window.__SCENE_TEST__ = { fail: false, delay: 0, reads: 0, truncated: false, add: false, remove: false, badScene: false, failScene: false };
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    const result = await original(command, args), flags = window.__SCENE_TEST__;
    if (command === 'get_skill_library') {
      const extra = structuredClone(result[0][0]); extra.skill.id = 'unassigned-material'; extra.skill.name = '未归类材料'; result[0].push(extra);
    }
    if (command === 'get_skill_scene_overview') {
      if (flags.failScene) throw new Error('scene read failed');
      if (flags.badScene) result.scenes.push(result.scenes[0]);
      if (flags.add) result.assignments['fixture-skill-002'].push({ sceneId: 'knowledge-1', reason: 'fixture', source: 'user', updatedAt: 1 });
      if (flags.remove) delete result.assignments['fixture-skill-001'];
    }
    if (command === 'read_skill_publish_document') {
      flags.reads++;
      const delayed = flags.delay, fail = flags.fail;
      if (delayed) await new Promise(resolve => setTimeout(resolve, delayed));
      if (fail) throw new Error('fixture document failed');
      const content = '<script>window.__INJECTED__ = true</script>\n这是成员的完整说明，不作为独立卡片。';
      return { ...result, content, total_bytes: new TextEncoder().encode(content).length, truncated: flags.truncated };
    }
    return result;
  };
});
await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
const card = n => page.locator(`#inventory-grid article[data-scene-id="knowledge-${n}"]`);
const detail = page.locator('#inventory-detail');
const reads = () => page.evaluate(() => window.__SCENE_TEST__.reads);
const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()).equipmentBag);
async function shot(name) { await page.screenshot({ path: join(output, `${name}.png`), animations: 'disabled' }); }
async function check(name, fn) { await fn(); report.checks.push(name); console.log(`PASS ${name}`); }
async function refresh() { await page.locator('#inventory-refresh').click(); await page.waitForFunction(() => !document.querySelector('#inventory-refresh').disabled); }
try {
  await page.goto(url + '/scenes');
  const oldStorage = await page.evaluate(() => localStorage.getItem('skills-manager.toy-wilds.agent-loadouts.v3'));
  await page.locator('[data-testid="scene-portal"]').click();
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function' && document.activeElement?.id === 'start');
  await page.keyboard.press('Enter'); await page.locator('#bag').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).equipmentBag.ready);
  await check('Preserves v3 character and original Skill choices without automatic scene equipment', async () => {
    const profile = await state();
    assert.equal(profile.agentName, '旧观星者'); assert.equal(profile.lineage, 'sage');
    assert.deepEqual(profile.draftSceneIds, []);
    assert.equal(await page.locator('#equipped-cards article').count(), 0);
    assert.match(await page.locator('#profile-view').textContent(), /旧配装已保留/);
    assert.equal(await page.evaluate(() => localStorage.getItem('skills-manager.toy-wilds.agent-loadouts.v3')), oldStorage);
  });
  await page.locator('#armory-tab').click();
  await check('81 materials become 24 scene cards; unclassified material and members never become cards', async () => {
    assert.equal(await reads(), 0);
    const s = await state(); assert.equal(s.total, 81); assert.equal(s.sceneTotal, 24); assert.equal(s.unassignedSkillCount, 1);
    while (await page.locator('#inventory-more').isVisible()) await page.locator('#inventory-more').click();
    assert.equal(await page.locator('#inventory-grid [data-scene-id]').count(), 24);
    assert.equal(await page.locator('article[data-skill-id]').count(), 0);
    await card(1).locator('[data-action="flip"]').click();
    assert.match(await card(1).textContent(), /品阶未评定/);
    await shot('01-scene-cards');
    await page.locator('#inventory-search').fill('知识技能 025');
    assert.equal(await page.locator('#inventory-grid article').count(), 1);
    assert.equal(await card(1).count(), 1);
    await page.locator('#inventory-search').fill('');
  });
  await check('Scene handbook explains composition; member text is lazy, inert and keyboard accessible', async () => {
    await card(1).locator('[data-action="detail"]').click();
    assert.equal(await reads(), 0);
    assert.equal(await detail.locator('.handbook-member').count(), 4);
    assert.equal(await detail.locator('article').count(), 0);
    assert.equal(await page.locator('#armory-view').evaluate(el => el.inert), true);
    assert.ok((await detail.boundingBox()).y >= 82);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await detail.locator('.handbook-provenance summary').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await detail.locator('[data-action="close-detail"]').evaluate(el => el === document.activeElement), true);
    await shot('02-scene-handbook');
    await page.evaluate(() => { window.__SCENE_TEST__.truncated = true; });
    const member = detail.locator('[data-member-id="fixture-skill-001"]');
    await member.locator('summary').click(); await member.locator('pre').waitFor();
    assert.equal(await reads(), 1); assert.equal(await page.evaluate(() => window.__INJECTED__), undefined);
    assert.match(await member.textContent(), /尚未读完/);
    await page.keyboard.press('Escape');
    assert.equal(await card(1).locator('[data-action="detail"]').evaluate(el => el === document.activeElement), true);
    await page.evaluate(() => { window.__SCENE_TEST__.truncated = false; });
  });
  await check('Adding content updates the same equipped scene; grade and number of cards stay unchanged', async () => {
    await card(1).locator('[data-action="add"]').click();
    const initial = await state(); assert.deepEqual(initial.draftSceneIds, ['knowledge-1']); assert.equal(initial.draftSkillIds.length, 4);
    await page.evaluate(() => { window.__SCENE_TEST__.add = true; }); await refresh();
    assert.equal((await state()).sceneTotal, 24); assert.equal((await state()).draftSkillIds.length, 5);
    await card(1).locator('[data-action="detail"]').click(); assert.equal(await detail.locator('.handbook-member').count(), 5);
    assert.match(await detail.textContent(), /品阶未评定/); await page.keyboard.press('Escape');
    await card(2).locator('[data-action="add"]').click();
    assert.equal(new Set((await state()).draftSkillIds).size, (await state()).draftSkillIds.length);
    await page.evaluate(() => { window.__SCENE_TEST__.remove = true; }); await refresh();
    assert.deepEqual((await state()).draftSceneIds, ['knowledge-1', 'knowledge-2']);
    assert.ok(!(await state()).draftSkillIds.includes('fixture-skill-001'));
    assert.equal(await page.evaluate(() => localStorage.getItem('skills-manager.toy-wilds.agent-loadouts.v3')), oldStorage);
  });
  await check('Broken scene reads preserve the full card set and equipment; source retries and late responses stay scoped', async () => {
    for (const flag of ['badScene', 'failScene']) {
      await page.evaluate(flag => { window.__SCENE_TEST__[flag] = true; }, flag); await refresh();
      assert.equal((await state()).sceneTotal, 24); assert.equal((await state()).stale, true);
      await page.evaluate(flag => { window.__SCENE_TEST__[flag] = false; }, flag);
    }
    await refresh(); assert.equal((await state()).stale, false);
    await page.evaluate(() => { window.__SCENE_TEST__.fail = true; });
    await card(1).locator('[data-action="detail"]').click(); await detail.locator('.handbook-member summary').first().click();
    await detail.getByText('重新读取', { exact: true }).waitFor();
    await page.evaluate(() => { window.__SCENE_TEST__.fail = false; });
    await detail.getByText('重新读取', { exact: true }).click(); await detail.locator('pre').waitFor();
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__SCENE_TEST__.delay = 700; });
    await card(1).locator('[data-action="detail"]').click(); await detail.locator('.handbook-member summary').first().click();
    await page.keyboard.press('Escape'); await card(3).locator('[data-action="detail"]').click();
    await page.waitForTimeout(900); assert.equal(await detail.locator('pre').count(), 0); assert.match(await detail.locator('h2').textContent(), /03/);
    await page.keyboard.press('Escape'); await page.evaluate(() => { window.__SCENE_TEST__.delay = 0; });
  });
  await check('Mobile cards and handbook remain readable; long list closes at the same scroll position', async () => {
    while (await page.locator('#inventory-more').isVisible()) await page.locator('#inventory-more').click();
    await card(24).scrollIntoViewIfNeeded();
    const scroll = await page.locator('#inventory-panel').evaluate(el => el.scrollTop);
    await card(24).locator('[data-action="detail"]').click(); await page.keyboard.press('Escape');
    assert.ok(Math.abs(await page.locator('#inventory-panel').evaluate(el => el.scrollTop) - scroll) < 3);
    await page.setViewportSize({ width: 390, height: 844 });
    await card(1).scrollIntoViewIfNeeded();
    if (await card(1).getAttribute('data-flipped') !== 'true') await card(1).locator('[data-action="flip"]').click();
    const dims = await card(1).locator('.skill-card-copy').evaluate(el => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    assert.ok(dims.scroll <= dims.client + 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await shot('03-mobile-scene');
    await card(1).locator('[data-action="detail"]').click(); assert.ok((await detail.boundingBox()).y >= 82); await shot('04-mobile-handbook');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); assert.equal((await state()).view, 'profile');
  });
  await check('Manage scene exits Portal to the same official scene; no business writes or resource leaks', async () => {
    await page.setViewportSize({ width: 1280, height: 850 }); await page.locator('#armory-tab').click();
    await card(1).locator('[data-action="detail"]').click(); await detail.getByText('整理此场景 ↗', { exact: true }).click();
    await page.waitForURL('**/scenes?scene=knowledge-1');
    assert.equal(await page.locator('[data-testid="portal-game"]').count(), 0);
    assert.equal(await page.evaluate(() => document.querySelector('#saas-surface').inert), false);
    assert.deepEqual(report.ipc.filter(x => x.kind === 'unexpected'), []);
    const debug = await page.evaluate(() => window.__toyWildsDebug);
    for (const key of ['activeEngines', 'activeAnimationFrames', 'activeListeners', 'activeObservers', 'liveGeometries', 'liveMaterials', 'liveTextures']) assert.equal(debug[key], 0, key);
  });
  await check('Partially damaged v4 storage remains byte-for-byte intact after opening and equipping', async () => {
    const damaged = await page.evaluate(() => {
      const value = JSON.parse(localStorage.getItem('skills-manager.toy-wilds.agent-loadouts.v4'));
      value.sceneLoadouts[value.selectedAgentRef] = { damaged: ['knowledge-1'] };
      const raw = JSON.stringify(value); localStorage.setItem('skills-manager.toy-wilds.agent-loadouts.v4', raw); return raw;
    });
    await page.locator('[data-testid="scene-portal"]').click();
    await page.waitForFunction(() => document.activeElement?.id === 'start');
    await page.keyboard.press('Enter'); await page.locator('#bag').click();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).equipmentBag.ready);
    assert.match(await page.locator('#inventory-error').textContent(), /原记录已保留/);
    await page.locator('#armory-tab').click(); await card(1).locator('[data-action="add"]').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('skills-manager.toy-wilds.agent-loadouts.v4')), damaged);
    await page.locator('[data-testid="portal-exit"]').click();
  });
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.failure = error.stack; await shot('failure'); throw error; }
finally { await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
