// Browser acceptance for the two reviewed scene-card pilots. It uses only the
// archived identity/version metadata as local fixture input, never a real library.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalFixtureInit } from './portal-fixture.mjs';

const appRoot = process.cwd();
const reviewDirectory = join(appRoot, 'docs/reviews/scene-card-pilot-2026-09-09');
const [versions, snapshot] = await Promise.all([
  readFile(join(reviewDirectory, 'member-versions.json'), 'utf8').then(JSON.parse),
  readFile(join(reviewDirectory, 'source-snapshot.json'), 'utf8').then(JSON.parse),
]);
const sceneIds = { business: 'scene-36c2451fa91aad0e', knowledge: 'scene-5dceda2d4cfc9a10', ordinary: 'fixture-ordinary-scene' };
const sourceScenes = snapshot.scenes.filter(scene => [sceneIds.business, sceneIds.knowledge].includes(scene.id));
const versionById = new Map(versions.members.map(member => [member.id, member]));
const rows = sourceScenes.flatMap(scene => scene.members.map(({ id }) => {
  const member = versionById.get(id);
  assert.ok(member, `missing fixture version ${id}`);
  return {
    skill: { id, name: `Fixture ${member.name}`, description: '只用于试点卡页面验收，不含真实用户内容。', source_type: 'fixture', source_revision: member.sourceRevision, content_hash: member.recordedContentHash, status: 'ok', enabled: true },
    deployments: [], platform_agent_keys: [],
  };
}));
rows.push({ skill: { id: 'fixture-ordinary-skill', name: '普通场景材料', description: '仅用于未评定卡状态验收。', source_type: 'fixture', source_revision: 'fixture-ordinary-rev', content_hash: 'fixture-ordinary-hash', status: 'ok', enabled: true }, deployments: [], platform_agent_keys: [] });
const fixture = {
  library: [rows, []],
  scenes: [...sourceScenes.map(scene => ({ id: scene.id, name: scene.name, description: scene.description, createdAt: 1, updatedAt: 1 })), { id: sceneIds.ordinary, name: '普通整理场景', description: '这是未评定的页面 fixture。', createdAt: 1, updatedAt: 1 }],
  assignments: Object.fromEntries([
    ...sourceScenes.flatMap(scene => scene.members.map(({ id }) => [id, [{ sceneId: scene.id, reason: 'fixture identity', source: 'fixture', updatedAt: 1 }] ])),
    ['fixture-ordinary-skill', [{ sceneId: sceneIds.ordinary, reason: 'fixture ordinary', source: 'fixture', updatedAt: 1 }]],
  ]),
  tools: [{ key: 'fixture', display_name: 'Fixture', installed: true, enabled: true, category: 'fixture' }],
};
const taskHome = homedir();
const moduleFile = process.env.PLAYWRIGHT_MODULE_FILE || join(taskHome, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || join(taskHome, 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const { chromium } = await import(pathToFileURL(resolve(moduleFile)).href);
const baseURL = process.env.APP_URL || 'http://127.0.0.1:4186';
const output = process.env.PILOT_TEST_OUTPUT || '/private/tmp/scene-card-pilots';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, locale: 'zh-CN' });
const report = { fixtureOnly: true, nativeValidated: false, baseURL, checks: [], screenshots: [], errors: [] };
await context.addInitScript(portalFixtureInit);
await context.addInitScript(data => {
  const original = window.__TAURI_INTERNALS__.invoke;
  window.__PILOT_CARD_FIXTURE__ = { mutateKnowledgeHash: false };
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    if (command === 'get_skill_library') {
      const result = structuredClone(data.library);
      if (window.__PILOT_CARD_FIXTURE__.mutateKnowledgeHash) result[0].find(row => row.skill.id === '07e1973e-eea3-4682-b696-75b0928be2db').skill.content_hash = 'fixture-history-change';
      return result;
    }
    if (command === 'get_skill_scene_overview') return {
      scenes: structuredClone(data.scenes), assignments: structuredClone(data.assignments),
      pendingSkillIds: [], unknownSkillIds: [], errorSkillIds: [], perSkillErrors: {},
      classifiedSkillIds: data.library[0].map(row => row.skill.id), prioritySkillIds: [],
      autoClassifyEnabled: false, preferredAgent: 'fixture',
    };
    if (command === 'get_tool_status') return structuredClone(data.tools);
    return original(command, args);
  };
}, fixture);
await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
const card = id => page.locator(`#inventory-grid article[data-scene-id="${id}"]`);
const detail = page.locator('#inventory-detail');
const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()).equipmentBag);
async function shot(name, target = page) { const path = join(output, `${name}.png`); await target.screenshot({ path, animations: 'disabled' }); report.screenshots.push(path); }
async function check(name, fn) { await fn(); report.checks.push(name); console.log(`PASS ${name}`); }
async function refresh() { await page.locator('#inventory-refresh').click(); await page.waitForFunction(() => !document.querySelector('#inventory-refresh').disabled); }
try {
  await page.goto(`${baseURL}/scenes`);
  await page.locator('[data-testid="scene-portal"]').click();
  await page.waitForFunction(() => typeof window.render_game_to_text === 'function' && document.activeElement?.id === 'start');
  await page.keyboard.press('Enter'); await page.locator('#bag').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).equipmentBag.ready);
  await page.locator('#armory-tab').click();
  await check('two reviewed pilots and one ordinary unreviewed fixture render by stable scene identity', async () => {
    assert.equal(await page.locator('#inventory-grid article[data-reviewed=true]').count(), 2);
    assert.equal(await card(sceneIds.business).getAttribute('data-reviewed'), 'true');
    assert.equal(await card(sceneIds.knowledge).getAttribute('data-reviewed'), 'true');
    assert.equal(await card(sceneIds.ordinary).getAttribute('data-reviewed'), 'false');
    assert.match(await card(sceneIds.ordinary).textContent(), /未评定|待绘制/);
  });
  await check('both pilot images are complete 1024px assets and cards do not auto-flip', async () => {
    for (const id of [sceneIds.business, sceneIds.knowledge]) {
      const image = card(id).locator('.scene-card-art img');
      await page.waitForFunction(sceneId => {
        const node = document.querySelector(`#inventory-grid article[data-scene-id="${sceneId}"] .scene-card-art img`);
        return node?.complete && node.naturalWidth === 1024;
      }, id);
      assert.equal(await image.evaluate(node => node.naturalWidth), 1024);
      assert.equal(await image.evaluate(node => node.naturalHeight), 1536);
      assert.equal(await card(id).getAttribute('data-flipped'), 'false');
    }
    await page.waitForTimeout(650);
    assert.equal(await card(sceneIds.knowledge).getAttribute('data-flipped'), 'false');
    await shot('01-business-front', card(sceneIds.business)); await shot('02-knowledge-front', card(sceneIds.knowledge));
  });
  await check('SSR holo appears only while the knowledge art is pointed at, never on R art', async () => {
    const knowledgeArt = card(sceneIds.knowledge).locator('.scene-card-art');
    const opacity = target => target.evaluate(node => getComputedStyle(node, '::after').opacity);
    assert.equal(await opacity(knowledgeArt), '0');
    await knowledgeArt.scrollIntoViewIfNeeded(); const box = await knowledgeArt.boundingBox(); assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(sceneId => getComputedStyle(document.querySelector(`#inventory-grid article[data-scene-id="${sceneId}"] .scene-card-art`), '::after').opacity !== '0', sceneIds.knowledge);
    assert.notEqual(await opacity(knowledgeArt), '0');
    await page.mouse.move(2, 2); await page.waitForFunction(sceneId => getComputedStyle(document.querySelector(`#inventory-grid article[data-scene-id="${sceneId}"] .scene-card-art`), '::after').opacity === '0', sceneIds.knowledge);
    assert.equal(await opacity(card(sceneIds.business).locator('.scene-card-art')), '1');
  });
  await check('equip stores the scene identity only and detail exposes the SSR four-cell record', async () => {
    await card(sceneIds.business).locator('[data-action="add"]').click();
    assert.deepEqual((await state()).draftSceneIds, [sceneIds.business]);
    assert.equal(await page.locator('[data-skill-id]').count(), 0);
    await card(sceneIds.knowledge).locator('[data-action="detail"]').click();
    await detail.locator('.handbook-breakthrough summary').click();
    assert.equal(await detail.locator('.handbook-breakthrough-item').count(), 4);
    await shot('03-knowledge-handbook-ssr', detail);
    await page.keyboard.press('Escape');
    await card(sceneIds.knowledge).locator('[data-action="flip"]').click(); await shot('04-knowledge-back', card(sceneIds.knowledge));
    await card(sceneIds.knowledge).locator('[data-action="flip"]').click();
  });
  await check('hash refresh keeps the historical image and changes only the review freshness label', async () => {
    await page.evaluate(() => { window.__PILOT_CARD_FIXTURE__.mutateKnowledgeHash = true; }); await refresh();
    const knowledge = card(sceneIds.knowledge);
    assert.equal(await knowledge.getAttribute('data-freshness'), 'changed');
    assert.match(await knowledge.textContent(), /圣品 · 历史试绘/);
    assert.equal(await knowledge.locator('.scene-card-art img').evaluate(node => node.naturalWidth), 1024);
  });
  await check('knowledge card remains readable on mobile', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await card(sceneIds.knowledge).scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await shot('05-mobile-knowledge', card(sceneIds.knowledge));
  });
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.failure = error.stack; await shot('failure'); throw error; }
finally { await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); }
