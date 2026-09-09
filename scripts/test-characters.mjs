/* Browser-only character acceptance. Uses the same isolated Tauri fixture as
 * test-portal.mjs; no native writes, remote Agent access or dependency installs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalFixtureInit } from './portal-fixture.mjs';

const moduleFile = process.env.PLAYWRIGHT_MODULE_FILE || join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || join(homedir(), 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
assert.ok(existsSync(moduleFile) && existsSync(executablePath), 'Provide installed Playwright and Chrome paths; this script never downloads dependencies.');
const { chromium } = await import(pathToFileURL(resolve(moduleFile)).href);
const baseURL = process.env.APP_URL || 'http://127.0.0.1:1420';
const output = resolve(process.env.CHARACTER_TEST_OUTPUT || '/tmp/skill-card-characters-check');
await mkdir(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), baseURL, fixtureOnly: true, nativeValidated: false, checks: [], screenshots: [], ipc: [], browserErrors: [], blockedRequests: [], dynamicFrames: [], responsive: [] };
const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'zh-CN', colorScheme: 'light', reducedMotion: 'no-preference' });
let phase = 'startup';
await context.exposeBinding('__portalRecordIPC', (_, entry) => report.ipc.push({ phase, ...entry }));
await context.addInitScript(portalFixtureInit);
await context.addInitScript(() => {
  // Legacy Skill IDs must not be inferred into the scene loadout namespace.
  localStorage.setItem('skills-manager.toy-wilds.agent-loadouts.v3', JSON.stringify({ version: 3, loadouts: { codex: ['fixture-skill-080'] } }));
});
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin === new URL(baseURL).origin) return route.continue();
  report.blockedRequests.push(url.href); return route.abort('blockedbyclient');
});
const page = await context.newPage();
page.on('pageerror', error => report.browserErrors.push({ phase, message: error.message }));
page.on('console', message => { if (message.type() === 'error') report.browserErrors.push({ phase, message: message.text() }); });
const storageKey = 'skills-manager.toy-wilds.agent-loadouts.v4';
const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const bag = async () => (await state()).equipmentBag;
const advance = ms => page.evaluate(value => window.advanceTime(value), ms);
const cards = container => page.locator(`${container} article.skill-card[data-scene-id]`);
const card = (container, id) => page.locator(`${container} article.skill-card[data-scene-id="${id}"]`);
const scene = n => `knowledge-${n}`;
async function shot(name) { const path = join(output, `${name}.png`); const bytes = await page.screenshot({ path, animations: 'disabled' }); report.screenshots.push(path); return createHash('sha256').update(bytes).digest('hex'); }
async function check(name, fn) {
  phase = name; const started = Date.now();
  try { await fn(); report.checks.push({ name, passed: true, durationMs: Date.now() - started }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, passed: false, error: error.stack, durationMs: Date.now() - started }); throw error; }
}
async function noDuplicateIDs() {
  const duplicates = await page.evaluate(() => { const counts = new Map(); for (const el of document.querySelectorAll('[id]')) counts.set(el.id, (counts.get(el.id) || 0) + 1); return [...counts].filter(([, count]) => count > 1); });
  assert.deepEqual(duplicates, [], 'duplicate DOM IDs');
}
async function enterProfile() {
  await page.locator('[data-testid="scene-portal"]').click();
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function' && JSON.parse(window.render_game_to_text()).ready);
  await page.locator('#start').click(); await page.locator('#bag').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).equipmentBag.ready);
}
async function switchView(view) {
  await page.locator(view === 'profile' ? '#profile-tab' : '#armory-tab').click();
  assert.equal((await bag()).view, view);
}
async function chooseAgent(ref) {
  await switchView('profile');
  await page.locator(`button.agent-portrait[data-agent-ref="${ref}"]`).click();
  assert.equal((await bag()).selectedAgentRef, ref);
}
async function openCreateForm() {
  const details = page.locator('#agent-create-form').locator('..');
  if (!(await details.evaluate(el => el.open))) await details.locator('summary').click();
}
async function assertCarried(ids) {
  await switchView('profile');
  assert.deepEqual((await cards('#equipped-cards').evaluateAll(els => els.map(el => el.dataset.sceneId))).sort(), [...ids].sort());
  assert.equal(await page.locator('#armory-view').isVisible(), false, 'full library must not appear in Profile');
}
let agentA, agentB;

try {
  await page.goto(`${baseURL}/scenes`);
  await check('local role A carries only explicitly equipped cards', async () => {
    await enterProfile();
    const initial = await bag(); agentA = initial.selectedAgentRef;
    assert.ok(agentA.startsWith('local:')); assert.equal(initial.localAgentCount, 1); assert.equal(initial.multicaBound, false);
    assert.equal(initial.total, 80); assert.equal(initial.sceneTotal, 24); await assertCarried([]); await noDuplicateIDs();
    await switchView('armory'); assert.equal(await cards('#inventory-grid').count(), 24);
    for (const id of [scene(1), scene(2)]) await card('#inventory-grid', id).locator('[data-action="add"]').click();
    await assertCarried([scene(1), scene(2)]); await shot('01-profile-a-two-carried');
  });
  await check('every library card supports independent flip and equip controls', async () => {
    await switchView('armory');
    while (await page.locator('#inventory-more').isVisible()) await page.locator('#inventory-more').click();
    assert.equal(await cards('#inventory-grid').count(), 24);
    const ids = await cards('#inventory-grid').evaluateAll(els => els.map(el => el.dataset.sceneId));
    assert.equal(new Set(ids).size, 24);
    for (const id of ids) {
      const current = card('#inventory-grid', id);
      assert.equal(await current.locator('[data-action="add"], [data-action="remove"]').count(), 1);
      await current.locator('[data-action="flip"]').click();
      assert.equal(await current.getAttribute('data-flipped'), 'true', `${id} did not flip`);
      if (id === scene(1)) await shot('02-card-back');
      await current.locator('[data-action="flip"]').click();
      assert.equal(await current.getAttribute('data-flipped'), 'false', `${id} did not flip back`);
    }
    const tiltCard = card('#inventory-grid', scene(1));
    await tiltCard.scrollIntoViewIfNeeded(); const rect = await tiltCard.boundingBox();
    await page.mouse.move(rect.x + rect.width * 0.84, rect.y + rect.height * 0.25);
    const tilt = await tiltCard.locator('.skill-card-tilt').evaluate(el => ({ x: getComputedStyle(el).getPropertyValue('--card-tilt-x').trim(), y: getComputedStyle(el).getPropertyValue('--card-tilt-y').trim() }));
    assert.ok([tilt.x, tilt.y].some(value => Math.abs(parseFloat(value)) > 0.1), `pointer produced no tilt: ${JSON.stringify(tilt)}`);
    await shot('02-card-tilt');
    await tiltCard.locator('[data-action="detail"]').click(); await page.locator('#inventory-detail').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#inventory-detail').textContent()).includes('知识炼成 01'));
    await noDuplicateIDs(); await page.keyboard.press('Escape');
    assert.equal((await state()).mode, 'inventory'); assert.equal(await page.locator('#inventory-detail').isVisible(), false);
    await card('#inventory-grid', scene(2)).locator('[data-action="remove"]').click();
    await assertCarried([scene(1)]);
    await switchView('armory');
    await card('#inventory-grid', scene(2)).locator('[data-action="add"]').click();
    report.cardControls = { verifiedFlipCount: ids.length, independentEquip: true, tilt };
    await shot('02-armory-cards');
  });
  await check('new local role B has an isolated saved loadout and lineage', async () => {
    await switchView('profile'); await openCreateForm(); await page.locator('#agent-name').fill('验收角色 B');
    await page.locator('#agent-lineage').selectOption('sage'); await page.locator('#agent-create-submit').click();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).equipmentBag.localAgentCount === 2);
    const created = await bag(); agentB = created.selectedAgentRef;
    assert.ok(agentB.startsWith('local:') && agentB !== agentA); assert.equal(created.lineage, 'sage');
    assert.equal(created.appearance.lineage, 'sage'); await assertCarried([]);
    await switchView('armory'); await card('#inventory-grid', scene(3)).locator('[data-action="add"]').click();
    await assertCarried([scene(3)]); await shot('03-profile-b-sage');
    assert.equal((await state()).player.lineage, 'sage', 'the actual world actor did not change lineage');
    assert.equal((await state()).player.equippedCount, (await bag()).draftSceneIds.length, 'the actual world actor did not receive the local scene loadout');
    await chooseAgent(agentA); await assertCarried([scene(1), scene(2)]);
    await chooseAgent(agentB); await assertCarried([scene(3)]);
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    assert.equal(saved.version, 4); assert.equal(saved.selectedAgentRef, agentB); assert.equal(saved.agents.length, 2);
    assert.equal(new Set(saved.agents.map(agent => agent.id)).size, saved.agents.length);
    assert.deepEqual([...saved.sceneLoadouts[agentA]].sort(), [scene(1), scene(2)]); assert.deepEqual(saved.sceneLoadouts[agentB], [scene(3)]);
    report.saved = { version: saved.version, localAgentCount: saved.agents.length, isolatedLoadouts: true };
  });
  await check('reload restores both local identities, selection and independent loadouts', async () => {
    await page.locator('[data-testid="portal-exit"]').click(); await page.reload(); await enterProfile();
    assert.equal((await bag()).selectedAgentRef, agentB); await assertCarried([scene(3)]);
    assert.equal(await page.locator('#inventory-role-title').textContent(), '验收角色 B');
    await chooseAgent(agentA); await assertCarried([scene(1), scene(2)]);
    await chooseAgent(agentB); await assertCarried([scene(3)]); await noDuplicateIDs();
  });
  await check('failed and duplicate inventory reads preserve complete snapshot and per-role choices', async () => {
    for (const fixtureKey of ['failLibrary', 'duplicateLibrary']) {
      await page.evaluate(key => { window.__PORTAL_FIXTURE__[key] = true; }, fixtureKey);
      await page.locator('#inventory-refresh').click();
      await page.waitForFunction(() => { const bag = JSON.parse(window.render_game_to_text()).equipmentBag; return !bag.loading && bag.stale; });
      assert.equal((await bag()).total, 80); assert.equal((await bag()).sceneTotal, 24); assert.ok(await page.locator('#inventory-error').isVisible());
      await assertCarried([scene(3)]); await chooseAgent(agentA); await assertCarried([scene(1), scene(2)]); await chooseAgent(agentB);
      await page.evaluate(key => { window.__PORTAL_FIXTURE__[key] = false; }, fixtureKey);
    }
    await shot('04-retained-library-error'); await page.locator('#inventory-refresh').click();
    await page.waitForFunction(() => { const bag = JSON.parse(window.render_game_to_text()).equipmentBag; return bag.ready && !bag.loading && !bag.stale && !bag.error; });
    await assertCarried([scene(3)]);
  });
  await check('phone and short window scroll to role creation and library bottom with contained keyboard focus', async () => {
    for (const viewport of [{ width: 390, height: 740 }, { width: 900, height: 640 }]) {
      await page.setViewportSize(viewport); await switchView('profile'); await openCreateForm();
      await page.locator('#agent-create-submit').scrollIntoViewIfNeeded();
      const form = await page.locator('#agent-create-submit').boundingBox();
      assert.ok(form && form.y >= 0 && form.y + form.height <= viewport.height + 1, 'role creation remains clipped');
      await shot(`05-profile-${viewport.width}`);
      await page.locator('#inventory-close').focus();
      const focusTrail = [];
      for (const key of ['Tab', 'Shift+Tab']) {
        for (let i = 0; i < 36; i += 1) {
          await page.keyboard.press(key);
          const focused = await page.evaluate(() => ({ contained: !!document.activeElement?.closest('#inventory-panel'), tag: document.activeElement?.tagName, id: document.activeElement?.id }));
          assert.equal(focused.contained, true, `${key} focus escaped the role dialog`);
          focusTrail.push({ key, tag: focused.tag, id: focused.id });
        }
      }
      assert.ok(focusTrail.some(item => item.tag === 'SUMMARY'), 'keyboard navigation skipped role creation summary');
      assert.ok(focusTrail.some(item => item.id === 'agent-name'), 'keyboard navigation skipped role creation form');
      await switchView('armory');
      while (await page.locator('#inventory-more').isVisible()) await page.locator('#inventory-more').click();
      const last = card('#inventory-grid', scene(24)); await last.scrollIntoViewIfNeeded();
      const beforeEquip = await last.boundingBox();
      await last.locator('[data-action="add"]').click(); assert.deepEqual((await bag()).draftSceneIds.sort(), [scene(3), scene(24)].sort());
      const afterEquip = await last.boundingBox();
      assert.ok(Math.abs(afterEquip.y - beforeEquip.y) <= 2, `equipping at the library bottom jumped the viewport: ${JSON.stringify({ beforeEquip, afterEquip })}`);
      await shot(`06-armory-bottom-${viewport.width}`);
      await last.locator('[data-action="remove"]').click(); await assertCarried([scene(3)]);
      await noDuplicateIDs();
      const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, panel: document.querySelector('#inventory-panel').getBoundingClientRect().toJSON() }));
      assert.ok(overflow.document <= viewport.width + 1, `horizontal overflow: ${JSON.stringify(overflow)}`);
      report.responsive.push({ ...viewport, creationButton: form, beforeEquip, afterEquip, bottomCardInteractable: true, containedFocus: true, focusTrail });
    }
  });
  await check('dynamic world screenshots cover two complete water ripple cycles and selected character appearance', async () => {
    await page.setViewportSize({ width: 1280, height: 800 }); await switchView('profile');
    assert.equal((await bag()).selectedAgentRef, agentB); await page.locator('#inventory-close').click();
    assert.equal((await state()).mode, 'world');
    await advance(2000); // Let the camera settle before measuring water movement.
    // world.js ripple phase is (time * 0.24 + phase) % 1: two cycles = 8.333 s.
    for (let frame = 0; frame <= 8; frame += 1) {
      if (frame) await advance(1000 / 0.96);
      const current = await state();
      assert.equal(current.mode, 'world');
      assert.equal(current.equipmentBag.selectedAgentRef, agentB); assert.equal(current.equipmentBag.appearance.lineage, 'sage');
      assert.equal(current.player.lineage, 'sage');
      assert.equal(current.player.equippedCount, current.equipmentBag.draftSceneIds.length);
      report.dynamicFrames.push({ simulatedMs: Math.round(frame * 1000 / 0.96), worldTime: current.worldTime, hash: await shot(`07-world-dynamic-${frame}`) });
    }
    assert.ok(new Set(report.dynamicFrames.map(frame => frame.hash)).size > 2, 'world frames remained visually static');
    assert.ok(report.dynamicFrames.at(-1).worldTime - report.dynamicFrames[0].worldTime >= 8.332, 'did not advance two complete ripple cycles');
  });
  await check('no native business writes, external calls, duplicate IDs or browser errors', async () => {
    await page.locator('[data-testid="portal-exit"]').click();
    assert.deepEqual(report.ipc.filter(entry => entry.kind === 'unexpected'), []);
    assert.deepEqual(report.blockedRequests, []); assert.deepEqual(report.browserErrors, []);
    report.businessWrites = 0; report.ipcSummary = Object.fromEntries(['read', 'telemetry', 'lifecycle', 'unexpected'].map(kind => [kind, report.ipc.filter(entry => entry.kind === kind).length]));
    await noDuplicateIDs();
  });
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack; process.exitCode = 1; console.error(error.stack);
  try { await shot('failure'); report.failureBody = (await page.locator('body').innerText()).slice(0, 4000); } catch {}
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close(); console.log(`Characters ${report.passed ? 'passed' : 'failed'}: ${report.checks.filter(c => c.passed).length}/${report.checks.length}; ${join(output, 'report.json')}`);
}
