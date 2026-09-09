// Integration checks use the actual read-only inventory endpoint. Failure
// fixtures intercept browser responses only; no Skill Manager write is called.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_FILE || 'playwright');
const base = process.env.TOY_WILDS_URL || 'http://127.0.0.1:4185';
const output = process.env.TOY_WILDS_TEST_OUTPUT || join(tmpdir(), 'toy-wilds-verification');
const storageKey = 'toy-wilds.role-loadouts.v1';
const apiPattern = '**/api/inventory*';
const checks = [];
const scriptErrors = [];
const uiWrites = [];
const check = (label, condition) => { assert.ok(condition, label); checks.push(label); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = values => [...values].sort();
const state = page => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const bag = async page => (await state(page)).equipmentBag;
const renderedIds = page => page.locator('#inventory-grid article[data-skill-id]').evaluateAll(cards => cards.map(card => card.dataset.skillId));
const deployedCount = (snapshot, target) => snapshot.skills.filter(skill => skill.deployments.some(deployment => deployment.target === target && deployment.actualStatus === 'current')).length;
const deploymentSignature = snapshot => JSON.stringify(snapshot.skills.map(skill => ({
  id: skill.id,
  deployments: [...skill.deployments].sort((a, b) => a.target.localeCompare(b.target)),
})).sort((a, b) => a.id.localeCompare(b.id)));

await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
let failureContext;
let failingPage;

function observe(targetPage) {
  targetPage.on('pageerror', error => scriptErrors.push(String(error)));
  targetPage.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') {
      uiWrites.push({ method: request.method(), url: request.url() });
    }
  });
}
observe(page);

async function openBag(targetPage) {
  await targetPage.waitForFunction(() => {
    if (!window.render_game_to_text) return false;
    const current = JSON.parse(window.render_game_to_text());
    return current.ready && current.equipmentBag;
  });
  if ((await state(targetPage)).mode === 'welcome') await targetPage.locator('#start').click();
  if ((await state(targetPage)).mode !== 'inventory') await targetPage.locator('#bag').click();
  await targetPage.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === 'inventory');
}

async function waitForInventory(targetPage) {
  await targetPage.waitForFunction(() => {
    const current = JSON.parse(window.render_game_to_text()).equipmentBag;
    return current.ready && !current.loading;
  }, null, { timeout: 120_000 });
}

async function refreshInventory(targetPage) {
  const response = targetPage.waitForResponse(response => new URL(response.url()).pathname === '/api/inventory');
  await targetPage.locator('#inventory-refresh').click();
  await response;
  await targetPage.waitForFunction(() => !JSON.parse(window.render_game_to_text()).equipmentBag.loading);
}

async function api(path, options = {}) {
  return fetch(new URL(path, base), { ...options, signal: AbortSignal.timeout(120_000) });
}

try {
  const apiResponse = await api('/api/inventory');
  check('actual inventory endpoint succeeds', apiResponse.status === 200);
  const snapshot = await apiResponse.json();
  check('actual snapshot is complete and has stable unique IDs',
    Array.isArray(snapshot.skills) && snapshot.total > 0 && snapshot.skills.length === snapshot.total
    && new Set(snapshot.skills.map(skill => skill.id)).size === snapshot.total);
  check('actual snapshot supplies deployment targets', Array.isArray(snapshot.targets) && snapshot.targets.length > 0);

  await page.goto(base);
  await openBag(page);
  await waitForInventory(page);
  let current = await bag(page);
  check('uncollected explorer can open the real inventory', (await state(page)).mode === 'inventory' && !(await state(page)).pickup.collected);
  check('UI total matches the complete actual API snapshot', current.total === snapshot.total
    && Number(await page.locator('#inventory-library-count').textContent()) === snapshot.total);
  check('initial visible cards all resolve to actual Skill IDs', (await renderedIds(page)).every(id => snapshot.skills.some(skill => skill.id === id)));
  check('local explorer is not represented as a bound Multica Agent', current.roleRef === 'local:explorer' && current.multicaBound === false);
  check('task dispatch remains disabled', await page.locator('#inventory-dispatch').isDisabled());
  check('actual deployed count matches the selected target', current.actualDeployed === deployedCount(snapshot, current.runtimeTarget));

  const frozen = await state(page);
  await page.locator('#inventory-search').fill('');
  await page.locator('#inventory-search').pressSequentially('wasdfep');
  await page.evaluate(() => window.advanceTime(1000));
  check('typing game hotkeys in bag leaves player and mode unchanged', same((await state(page)).player, frozen.player) && (await state(page)).worldTime === frozen.worldTime && (await state(page)).mode === 'inventory' && !await page.evaluate(() => !!document.fullscreenElement));
  await page.locator('#inventory-search').fill('');
  await page.locator('#inventory-tab-library').focus();
  await page.keyboard.press('ArrowRight');
  check('arrow key switches inventory tabs and focus', await page.locator('#inventory-tab-loadout').evaluate(el => el === document.activeElement && el.tabIndex === 0));
  await page.keyboard.press('Home');
  check('Home returns to the library tab with matching panel label', await page.locator('#inventory-grid').getAttribute('aria-labelledby') === 'inventory-tab-library');
  await page.locator('#inventory-close').focus();
  await page.keyboard.press('Shift+Tab');
  check('modal focus remains within the equipment bag', await page.evaluate(() => document.querySelector('#inventory-panel').contains(document.activeElement)));
  await page.screenshot({path: join(output, 'inventory-desktop.png')});
  const firstId = (await renderedIds(page))[0];
  const firstSkill = snapshot.skills.find(skill => skill.id === firstId);
  assert.ok(firstSkill, 'the first visible skill must belong to the actual snapshot');
  await page.locator('#inventory-search').fill(firstSkill.name);
  const query = firstSkill.name.toLowerCase();
  const expectedSearch = snapshot.skills.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(query)).slice(0, 24).map(skill => skill.id);
  check('search filters real names and descriptions without inventing entries', same(await renderedIds(page), expectedSearch));
  await page.locator('#inventory-search').fill('__toy_wilds_no_such_skill_7b15f40b__');
  check('unmatched search shows an empty result', (await renderedIds(page)).length === 0 && await page.locator('#inventory-grid .inventory-empty').isVisible());
  await page.locator('#inventory-search').fill('');
  if (snapshot.total > 24) {
    await page.locator('#inventory-more').click();
    check('show more reveals another actual inventory page', (await renderedIds(page)).length === Math.min(48, snapshot.total));
  }

  const targetA = current.runtimeTarget;
  const firstCard = page.locator('article[data-skill-id]').filter({ has: page.locator(`[data-action="add"]`) });
  const knownCard = page.locator(`#inventory-grid article[data-skill-id="${firstId}"]`);
  assert.ok(await firstCard.count(), 'a fresh browser context has an addable skill');
  await knownCard.locator('[data-action="add"]').click();
  current = await bag(page);
  check('adding to the local draft records only the chosen stable ID', same(current.draftSkillIds, [firstId]));
  check('draft selection does not alter actual deployment count', current.actualDeployed === deployedCount(snapshot, targetA));
  let saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  check('local draft persists to browser storage under its runtime key', saved.target === targetA && same(saved.loadouts[targetA], [firstId]));
  await page.locator('#inventory-tab-loadout').click();
  check('loadout tab contains only the prepared real skill', same(await renderedIds(page), [firstId])
    && await page.locator('#inventory-tab-loadout').getAttribute('aria-selected') === 'true');

  await page.locator(`#inventory-grid article[data-skill-id="${firstId}"] .skill-info`).click();
  check('real skill details open in a native modal dialog', await page.locator('dialog#inventory-detail[open]').isVisible());
  check('detail identifies the actual selected skill', (await page.locator('#inventory-detail').textContent()).includes(firstId));
  await page.keyboard.press('Escape');
  check('detail Escape closes only details and keeps inventory open', !(await page.locator('#inventory-detail').evaluate(dialog => dialog.open)) && (await state(page)).mode === 'inventory');

  const availableTargets = await page.locator('#inventory-target option').evaluateAll(options => options.map(option => option.value));
  const targetB = availableTargets.find(key => key && key !== targetA);
  assert.ok(targetB, 'the actual library must expose a second target for runtime isolation coverage');
  await page.locator('#inventory-target').selectOption(targetB);
  current = await bag(page);
  check('another runtime begins with its own empty local draft', current.runtimeTarget === targetB && current.draftSkillIds.length === 0);
  check('changing runtime recomputes actual deployment count', current.actualDeployed === deployedCount(snapshot, targetB));
  await page.locator('#inventory-tab-library').click();
  const secondId = (await renderedIds(page)).find(id => id !== firstId) || firstId;
  await page.locator(`#inventory-grid article[data-skill-id="${secondId}"] [data-action="add"]`).click();
  await page.locator('#inventory-target').selectOption(targetA);
  check('switching back restores the first runtime draft independently', same((await bag(page)).draftSkillIds, [firstId]));
  saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  check('both runtime drafts coexist in local storage', same(saved.loadouts[targetA], [firstId]) && same(saved.loadouts[targetB], [secondId]));

  await page.reload();
  await openBag(page);
  await waitForInventory(page);
  current = await bag(page);
  check('reload preserves runtime selection and local draft', current.runtimeTarget === targetA && same(current.draftSkillIds, [firstId]));
  await page.locator('#inventory-tab-loadout').click();
  await page.locator(`#inventory-grid article[data-skill-id="${firstId}"] [data-action="remove"]`).click();
  check('removing a draft item updates the loadout and storage only', (await bag(page)).draftSkillIds.length === 0
    && (await page.evaluate(key => JSON.parse(localStorage.getItem(key)).loadouts, storageKey))[targetA].length === 0
    && (await bag(page)).actualDeployed === deployedCount(snapshot, targetA));
  await page.locator('#inventory-tab-library').click();

  const prior = await bag(page);
  const priorCards = await renderedIds(page);
  await page.route(apiPattern, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '只读测试：模拟暂时不可用' }) }));
  await refreshInventory(page);
  current = await bag(page);
  check('refresh failure retains the complete previous snapshot as stale', current.ready && current.stale && current.total === prior.total
    && current.actualDeployed === prior.actualDeployed && same(await renderedIds(page), priorCards));
  check('stale failure is visible and can be retried', await page.locator('#inventory-error').isVisible()
    && (await page.locator('#inventory-source-state').textContent()).includes('上次完整快照')
    && !(await page.locator('#inventory-refresh').isDisabled()));
  await page.unroute(apiPattern);
  await refreshInventory(page);
  check('successful retry replaces stale status with a verified snapshot', (await bag(page)).ready && !(await bag(page)).stale && !((await bag(page)).error));

  failureContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  failingPage = await failureContext.newPage();
  observe(failingPage);
  await failingPage.route(apiPattern, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '只读测试：首次加载不可用' }) }));
  await failingPage.goto(base);
  await openBag(failingPage);
  await failingPage.waitForFunction(() => {
    const current = JSON.parse(window.render_game_to_text()).equipmentBag;
    return !current.loading && Boolean(current.error);
  });
  const failed = await bag(failingPage);
  check('initial load failure is explicit and does not fabricate a ready inventory', !failed.ready && failed.total === 0 && await failingPage.locator('#inventory-error').isVisible());
  check('initial failure retains a usable retry control and disabled dispatch', !(await failingPage.locator('#inventory-refresh').isDisabled()) && await failingPage.locator('#inventory-dispatch').isDisabled());
  await failingPage.unroute(apiPattern);
  await refreshInventory(failingPage);
  check('initial failure recovers through the actual read-only API', (await bag(failingPage)).ready && (await bag(failingPage)).total === snapshot.total);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.advanceTime(1));
  const mobile = await page.evaluate(() => {
    const panel = document.querySelector('#inventory-panel');
    const traveler = document.querySelector('.inventory-traveler').getBoundingClientRect();
    const workspace = document.querySelector('.inventory-workspace').getBoundingClientRect();
    const character = document.querySelector('#inventory-character');
    const slot = character.getBoundingClientRect();
    const ancestors = [];
    for (let element = character; element && element !== document.body; element = element.parentElement) ancestors.push(getComputedStyle(element).backgroundColor);
    const elements = [panel, ...panel.querySelectorAll('article[data-skill-id], #inventory-target, #inventory-search, #inventory-dispatch')];
    return {
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      panelWidth: panel.clientWidth,
      panelScrollWidth: panel.scrollWidth,
      stacked: workspace.top >= traveler.bottom - 1,
      slotHeight: slot.height,
      transparentAncestors: ancestors.every(value => value === 'rgba(0, 0, 0, 0)' || value === 'transparent'),
      contained: elements.every(element => { const rect = element.getBoundingClientRect(); return rect.left >= -1 && rect.right <= innerWidth + 1; }),
      installedHeight: document.querySelector('#inventory-installed').getBoundingClientRect().height,
    };
  });
  check('390px inventory stacks the traveler above the skill library', mobile.viewport === 390 && mobile.stacked && mobile.slotHeight >= 280);
  check('390px layout keeps cards and controls inside the viewport', mobile.documentWidth === 390 && mobile.panelScrollWidth <= mobile.panelWidth + 1 && mobile.contained);
  check('avatar slot ancestors stay transparent for the underlying Three canvas', mobile.transparentAncestors);
  check('installed skill summary remains bounded on mobile', mobile.installedHeight <= 101);
  await page.screenshot({ path: join(output, 'inventory-mobile-top.png') });
  await page.locator('#inventory-search').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'inventory-mobile-library.png') });
  await page.locator('#inventory-dispatch').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'inventory-mobile-footer.png') });

  // These intentional negative requests are issued outside the browser UI;
  // the write monitor above remains reserved for accidental app mutations.
  const post = await api('/api/inventory', { method: 'POST' });
  check('inventory rejects POST with 405 and Allow GET', post.status === 405 && post.headers.get('allow') === 'GET');
  const unknown = await api('/api/no-such-inventory-endpoint');
  check('unknown API routes return 404', unknown.status === 404);
  const crossOrigin = await api('/api/inventory', { headers: { Origin: 'https://inventory-test.invalid' } });
  check('cross-origin inventory access returns 403', crossOrigin.status === 403);
  const crossSite = await api('/api/inventory', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  check('cross-site inventory requests return 403', crossSite.status === 403);

  const finalResponse = await api('/api/inventory');
  assert.equal(finalResponse.status, 200);
  const finalSnapshot = await finalResponse.json();
  check('all local draft operations preserve actual deployment records', deploymentSignature(finalSnapshot) === deploymentSignature(snapshot));
  check('inventory UI made no deployment or other write requests', uiWrites.length === 0);
  check('inventory flows produced no uncaught browser script errors', scriptErrors.length === 0);
  const report = { passed: checks.length, checks, scriptErrors, uiWrites, actualTotal: snapshot.total, targetA, targetB, mobile, final: await state(page) };
  await fs.writeFile(join(output, 'inventory-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  await page.screenshot({ path: join(output, 'inventory-failure.png') }).catch(() => {});
  const report = { checks, scriptErrors, uiWrites, error: String(error), final: await state(page).catch(() => null) };
  await fs.writeFile(join(output, 'inventory-report.json'), JSON.stringify(report, null, 2));
  console.error(error);
  console.log(JSON.stringify(report));
  process.exitCode = 1;
} finally {
  await failureContext?.close();
  await context.close();
  await browser.close();
}
