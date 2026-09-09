/* Real browser acceptance with explicit, isolated Tauri fixtures.
 * No native IPC, Multica connection, dependency download or business write runs.
 * APP_URL may address Vite or preview. Override cached tools with
 * PLAYWRIGHT_MODULE_FILE / PLAYWRIGHT_EXECUTABLE_PATH and output with PORTAL_TEST_OUTPUT.
 */
import assert from 'node:assert/strict';
import { portalFixtureInit } from './portal-fixture.mjs';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleFile = process.env.PLAYWRIGHT_MODULE_FILE || join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || join(homedir(), 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
assert.ok(existsSync(moduleFile), 'Set PLAYWRIGHT_MODULE_FILE to an installed Playwright module; this script never downloads it.');
assert.ok(existsSync(executablePath), 'Set PLAYWRIGHT_EXECUTABLE_PATH to an installed Chrome binary.');
const { chromium } = await import(pathToFileURL(resolve(moduleFile)).href);
const baseURL = process.env.APP_URL || 'http://127.0.0.1:1420';
const output = resolve(process.env.PORTAL_TEST_OUTPUT || '/tmp/skill-card-portal-check');
await mkdir(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), baseURL, fixtureOnly: true, nativeValidated: false, checks: [], screenshots: [], ipc: [], browserErrors: [], blockedRequests: [], diagnostics: {}, zoom: [] };
const browser = await chromium.launch({ headless: true, executablePath });
let page;
let phase = 'startup';
const activeKeys = ['activeEngines', 'activeAnimationFrames', 'activeListeners', 'activeObservers', 'liveGeometries', 'liveMaterials', 'liveTextures'];

async function fixtureContext(label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'zh-CN', colorScheme: 'light' });
  await context.exposeBinding('__portalRecordIPC', (_, entry) => report.ipc.push({ context: label, phase, ...entry }));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL).origin) return route.continue();
    report.blockedRequests.push({ context: label, url: url.href });
    return route.abort('blockedbyclient');
  });
  await context.addInitScript(portalFixtureInit);
  context.on('page', current => {
    current.on('pageerror', error => report.browserErrors.push({ context: label, phase, message: error.message }));
    current.on('console', message => { if (message.type() === 'error') report.browserErrors.push({ context: label, phase, console: true, message: message.text() }); });
  });
  return context;
}

const portal = '[data-testid="scene-portal"]';
const game = '[data-testid="portal-game"]';
const exit = '[data-testid="portal-exit"]';
const surface = '[data-testid="portal-surface"]';
const readState = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const advance = ms => page.evaluate(value => window.advanceTime(value), ms);
async function waitReady() {
  await page.locator(game).waitFor();
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function' && typeof window.advanceTime === 'function' && JSON.parse(window.render_game_to_text()).ready === true);
  const state = await readState();
  assert.equal(state.resources.activeEngines, 1);
  assert.ok(state.resources.liveGeometries > 0 && state.resources.liveMaterials > 0, 'engine resources were not initialized');
  assert.ok(state.viewport.width > 0 && state.viewport.height > 0);
}
async function enter({ keyboard = false } = {}) {
  if (keyboard) { await page.locator(portal).evaluate(el => el.focus({ preventScroll: true })); await page.keyboard.press('Enter'); }
  else await page.locator(portal).click();
  await waitReady();
}
async function assertDisposed() {
  await page.locator(surface).waitFor({ state: 'detached' });
  await page.waitForFunction(() => !window.render_game_to_text && !window.advanceTime);
  const debug = await page.evaluate(() => ({ ...window.__toyWildsDebug }));
  for (const key of activeKeys) assert.equal(debug[key], 0, `${key} leaked`);
  assert.equal(await page.locator(`${game} canvas`).count(), 0);
  return debug;
}
async function leave() { await page.locator(exit).click(); return assertDisposed(); }
async function shot(name) { const path = join(output, `${name}.png`); await page.screenshot({ path, animations: 'disabled' }); report.screenshots.push(path); }
async function check(name, fn) {
  phase = name; const started = Date.now();
  try { await fn(); report.checks.push({ name, passed: true, durationMs: Date.now() - started }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, passed: false, error: error.stack, durationMs: Date.now() - started }); throw error; }
}
async function collectRelic({ marker = false } = {}) {
  if ((await readState()).mode === 'welcome') await page.locator('#start').click();
  await advance(0);
  const before = await readState(), target = before.pickup.approachScreen;
  assert.ok(target.visible, 'pickup approach point must be visible');
  if (marker) {
    await page.locator('#marker').click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'game', 'marker approach must focus the game for E pickup');
  } else await page.mouse.click(target.x, target.y);
  for (let i = 0; i < 12 && !(await readState()).pickup.near; i += 1) await advance(1000);
  const arrived = await readState();
  assert.ok(arrived.pickup.near, `ground click did not approach relic: ${JSON.stringify(arrived.player)}`);
  assert.ok(Math.hypot(arrived.player.x - before.player.x, arrived.player.z - before.player.z) > 1, 'click did not move player');
  await page.keyboard.press('e');
  await page.waitForFunction(() => { const state = JSON.parse(window.render_game_to_text()); return state.mode === 'inventory' && state.pickup.collected && state.equipmentBag.ready; });
}

try {
  const context = await fixtureContext('main');
  page = await context.newPage();
  await check('cold Portal URL returns to SaaS without loading game resources', async () => {
    await page.goto(`${baseURL}/play/toy-wilds`);
    await page.waitForURL('**/scenes');
    await page.locator(portal).waitFor();
    assert.ok(await page.locator('#saas-surface').isVisible());
    assert.equal(await page.locator(surface).count(), 0);
    const cold = await page.evaluate(() => ({ contexts: window.__PORTAL_FIXTURE__.webglContexts, canvases: document.querySelectorAll('canvas').length,
      resources: performance.getEntriesByType('resource').map(r => r.name).filter(name => /\/toy-wilds\/|\/three(?:[._/])|\/GameShell[-.]/i.test(name)) }));
    assert.deepEqual(cold.resources, []); assert.equal(cold.contexts, 0); assert.equal(cold.canvases, 0);
    report.coldResources = cold;
    await shot('01-saas-cold');
  });
  await check('scene search, expanded list, page, scroll and focus survive Portal', async () => {
    await page.getByRole('textbox', { name: '搜索使用场景' }).fill('知识');
    await page.getByText('查看全库识别结果与手动归属', { exact: false }).click();
    await page.getByPlaceholder('搜索 Skill、说明或场景').fill('知识');
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.getByText('第 2 / 2 页').waitFor();
    await page.locator('[data-testid="saas-scroll"]').evaluate(el => { el.scrollTop = 100; });
    const before = await page.locator('[data-testid="saas-scroll"]').evaluate(el => el.scrollTop);
    assert.ok(before >= 90, 'fixture did not create a real scroll range');
    await enter({ keyboard: true });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'start', 'keyboard entry focus must be on the game start button');
    assert.deepEqual(await page.locator('#saas-surface').evaluate(el => ({ hidden: el.hidden, inert: el.inert })), { hidden: true, inert: true });
    await page.keyboard.press('Meta+,');
    assert.ok(page.url().endsWith('/play/toy-wilds'), 'SaaS shortcut escaped the game');
    await shot('02-game-welcome');
    await page.keyboard.press('Enter');
    assert.equal((await readState()).mode, 'world', 'Enter on the focused start button must begin the world');
    await leave();
    assert.equal(await page.getByRole('textbox', { name: '搜索使用场景' }).inputValue(), '知识');
    assert.equal(await page.getByPlaceholder('搜索 Skill、说明或场景').inputValue(), '知识');
    assert.ok(await page.getByText('第 2 / 2 页').isVisible() || await page.getByText('第 2 / 2 页').count() === 1);
    assert.equal(await page.getByPlaceholder('搜索 Skill、说明或场景').evaluate(el => el.closest('details').open), true);
    const after = await page.locator('[data-testid="saas-scroll"]').evaluate(el => el.scrollTop);
    assert.ok(Math.abs(after - before) <= 1, `scroll changed: ${before} -> ${after}`);
    assert.equal(await page.locator(portal).evaluate(el => document.activeElement === el), true);
    report.restoredScroll = { before, after };
  });
  await check('browser Back exits and Forward cannot re-enter an expired Portal', async () => {
    await enter(); await page.goBack(); await assertDisposed();
    await page.goForward(); await page.waitForURL('**/scenes');
    assert.equal(await page.locator(surface).count(), 0);
    assert.ok(await page.locator('#saas-surface').isVisible());
  });
  await check('ground interaction, real fixture bag, failed refresh retention and card chain', async () => {
    await enter();
    await page.evaluate(() => { window.__PORTAL_FIXTURE__.failLibraryString = true; });
    await page.locator('#start').click(); await page.locator('#bag').click();
    await page.waitForFunction(() => !JSON.parse(window.render_game_to_text()).equipmentBag.loading && Boolean(JSON.parse(window.render_game_to_text()).equipmentBag.error));
    assert.equal((await readState()).equipmentBag.ready, false, 'a failed first read must not create an empty snapshot');
    assert.equal(await page.locator('#inventory-library-count').textContent(), '—');
    assert.ok(await page.locator('#inventory-error').isVisible());
    assert.ok((await page.locator('#inventory-error').textContent()).includes('Fixture first library read failed (string)'));
    await shot('03-first-library-string-error');
    await page.evaluate(() => { window.__PORTAL_FIXTURE__.failLibraryString = false; });
    await page.locator('#inventory-refresh').click();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).equipmentBag.ready);
    assert.equal((await readState()).equipmentBag.total, 80);
    assert.equal((await readState()).equipmentBag.sceneTotal, 24);
    await page.locator('#inventory-close').click();
    await collectRelic({ marker: true });
    report.firstLibraryStringError = { visible: true, readyAfterFailure: false, recoveredTotal: 80, recoveredSceneTotal: 24 };
    const state = await readState();
    assert.equal(state.equipmentBag.total, 80);
    assert.equal(state.equipmentBag.sceneTotal, 24);
    assert.equal(await page.locator('#inventory-library-count').textContent(), '24');
    assert.equal(state.equipmentBag.multicaBound, false);
    await page.locator('#armory-tab').click();
    const first = page.locator('[data-scene-id="knowledge-1"]');
    await first.locator('[data-action="detail"]').click();
    await page.locator('#inventory-detail').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#inventory-detail').textContent()).includes('场景手册'));
    await page.keyboard.press('Escape');
    await first.locator('[data-action="add"]').click();
    assert.ok((await readState()).equipmentBag.draftSceneIds.includes('knowledge-1'));
    await page.evaluate(() => { window.__PORTAL_FIXTURE__.failLibrary = true; });
    await page.locator('#inventory-refresh').click();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).equipmentBag.stale);
    assert.equal((await readState()).equipmentBag.total, 80);
    assert.equal((await readState()).equipmentBag.sceneTotal, 24);
    await page.evaluate(() => { window.__PORTAL_FIXTURE__.failLibrary = false; window.__PORTAL_FIXTURE__.duplicateLibrary = true; });
    await page.locator('#inventory-refresh').click();
    await page.waitForFunction(() => !JSON.parse(window.render_game_to_text()).equipmentBag.loading);
    assert.equal((await readState()).equipmentBag.total, 80);
    assert.equal((await readState()).equipmentBag.sceneTotal, 24);
    assert.equal((await readState()).equipmentBag.stale, true);
    await page.evaluate(() => { window.__PORTAL_FIXTURE__.duplicateLibrary = false; });
    await page.locator('#inventory-refresh').click();
    await page.waitForFunction(() => !JSON.parse(window.render_game_to_text()).equipmentBag.stale && !JSON.parse(window.render_game_to_text()).equipmentBag.loading);
    await shot('03-equipment-bag');
    await page.locator('#profile-tab').click();
    await page.locator('#inventory-demo-card').click();
    assert.equal((await readState()).mode, 'card');
    await advance(500);
    const rect = await page.locator('#game').boundingBox();
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    assert.equal((await readState()).card.flipped, true, 'physical canvas click missed the card');
    await advance(500); await shot('04-card-back');
    await page.keyboard.press('Enter'); await advance(500);
    assert.equal((await readState()).card.flipped, false);
    await shot('05-card-front');
    await page.locator('#return').click(); assert.equal((await readState()).mode, 'inventory');
    await page.locator('#inventory-close').click(); assert.equal((await readState()).mode, 'world');
    await shot('06-world');
    await leave();
  });
  await check('20 initialized Portal cycles dispose listeners, hooks, frames and GPU resources', async () => {
    const initial = await page.evaluate(() => ({ ...window.__toyWildsDebug }));
    for (let i = 0; i < 20; i += 1) { await enter(); await leave(); }
    const final = await page.evaluate(() => ({ ...window.__toyWildsDebug }));
    assert.ok(final.mounts - initial.mounts >= 20);
    assert.equal(final.mounts - initial.mounts, final.disposals - initial.disposals);
    assert.equal(final.mounts, final.disposals);
    for (const key of activeKeys) assert.equal(final[key], 0, `${key} leaked`);
    report.diagnostics = { initial, final, initializedCycles: 20 };
  });
  await check('text scale 90–120% preserves canvas bounds and physical click mapping', async () => {
    for (const scale of [0.9, 1, 1.1, 1.2]) {
      await page.setViewportSize({ width: 1100, height: 640 });
      await page.evaluate(value => { document.documentElement.style.zoom = String(value); document.documentElement.style.setProperty('--app-scale', String(value)); }, scale);
      await enter(); await collectRelic();
      await page.locator('#inventory-demo-card').click(); await advance(0);
      const rect = await page.locator('#game').boundingBox(), state = await readState();
      assert.ok(rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= 1101 && rect.y + rect.height <= 641, `canvas outside viewport at ${scale}: ${JSON.stringify(rect)}`);
      for (const [key, expected] of Object.entries({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })) assert.ok(Math.abs(state.viewport[key] - expected) < 1, `render/input rect mismatch ${key} at ${scale}`);
      await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
      assert.equal((await readState()).card.flipped, true, `zoom ${scale} card hit test failed`);
      await advance(500); await shot(`07-scale-${Math.round(scale * 100)}`);
      report.zoom.push({ scale, rect, renderer: state.viewport, groundClick: 'passed', cardClick: 'passed' });
      await leave();
    }
    await page.evaluate(() => { document.documentElement.style.zoom = '1'; document.documentElement.style.setProperty('--app-scale', '1'); });
  });
  await check('900–1280 widths keep the bag, renderer and exit usable', async () => {
    for (const width of [900, 1100, 1280]) {
      await page.setViewportSize({ width, height: 640 }); await enter(); await collectRelic();
      assert.equal((await readState()).equipmentBag.total, 80);
      assert.equal((await readState()).equipmentBag.sceneTotal, 24);
      await page.locator('#armory-tab').click();
      while (await page.locator('#inventory-more').isVisible()) await page.locator('#inventory-more').click();
      const lastCard = page.locator('#inventory-grid [data-scene-id="knowledge-24"]');
      await lastCard.scrollIntoViewIfNeeded();
      const scrolling = await lastCard.evaluate(el => {
        const parents = []; for (let current = el.parentElement; current; current = current.parentElement) {
          if (current.scrollHeight > current.clientHeight + 1) parents.push({ id: current.id, className: current.className, top: current.scrollTop, height: current.clientHeight, scrollHeight: current.scrollHeight });
        }
        return { parents, lastCard: el.getBoundingClientRect().toJSON() };
      });
      assert.ok(scrolling.parents.some(parent => parent.top > 0), `short window library cannot scroll at ${width}`);
      assert.ok(scrolling.lastCard.y >= 82 && scrolling.lastCard.bottom <= 641, `last library card is clipped at ${width}: ${JSON.stringify(scrolling)}`);
      await shot(`08-bag-bottom-${width}`);
      await lastCard.locator('[data-action="detail"]').click();
      await page.locator('#inventory-detail').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await page.locator('#profile-tab').click();
      await page.locator('#inventory-demo-card').scrollIntoViewIfNeeded();
      const demo = await page.locator('#inventory-demo-card').boundingBox();
      assert.ok(demo && demo.y >= 82 && demo.y + demo.height <= 641, `demo remains clipped at ${width}`);
      await shot(`08-bag-demo-${width}`);
      await page.locator('#inventory-demo-card').click();
      assert.equal((await readState()).mode, 'card', `scrolled demo is not clickable at ${width}`);
      await page.locator('#return').click();
      await page.locator('#inventory-close').click();
      report.bagScroll ??= []; report.bagScroll.push({ width, ...scrolling, demo, demoClick: 'passed' });
      await leave();
    }
  });
  await check('fresh-context aborted lazy module exposes real failure and return action', async () => {
    const failureContext = await fixtureContext('lazy-failure');
    let aborted = 0;
    await failureContext.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (/\/src\/features\/toy-wilds\/GameShell\.tsx$|\/assets\/GameShell-[^/]+\.js$/.test(url.pathname)) { aborted += 1; return route.abort('failed'); }
      return route.fallback();
    });
    const oldPage = page; page = await failureContext.newPage();
    await page.goto(`${baseURL}/scenes`); await page.locator(portal).waitFor();
    await page.locator(portal).click();
    await page.locator(`${surface} [role="alert"]`).waitFor();
    assert.ok(aborted > 0, 'lazy module was not actually aborted');
    await shot('09-real-load-error');
    await page.locator(exit).click(); await page.locator(surface).waitFor({ state: 'detached' });
    assert.ok(await page.locator('#saas-surface').isVisible());
    assert.ok(page.url().endsWith('/scenes'));
    report.lazyModuleAborts = aborted;
    await failureContext.close(); page = oldPage;
  });
  await check('Portal emits only inventory reads and no business writes', async () => {
    const unexpected = report.ipc.filter(entry => entry.kind === 'unexpected');
    assert.deepEqual(unexpected, []);
    assert.ok(report.ipc.some(entry => entry.command === 'get_skill_library'));
    const errors = report.browserErrors.filter(entry => entry.context === 'main');
    assert.deepEqual(errors, [], 'main browser reported an error');
    assert.deepEqual(report.blockedRequests, [], 'app attempted an unexpected network request');
    report.ipcSummary = Object.fromEntries(['read', 'telemetry', 'lifecycle', 'unexpected'].map(kind => [kind, report.ipc.filter(entry => entry.kind === kind).length]));
    report.businessWrites = 0;
  });
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.stack;
  if (page && !page.isClosed()) { try { await shot('failure'); report.failureBody = (await page.locator('body').innerText()).slice(0, 4000); } catch {} }
  console.error(error.stack); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  console.log(`Portal ${report.passed ? 'passed' : 'failed'}: ${report.checks.filter(c => c.passed).length}/${report.checks.length}; ${join(output, 'report.json')}`);
}
