import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const binary = fileURLToPath(new URL('../src-tauri/target/debug/skills-manager-mcp', import.meta.url));
const root = realpathSync(mkdtempSync(join(tmpdir(), 'skill-manager-mcp-')));
const env = { ...process.env, SKILLS_MANAGER_EVAL_ROOT: root };
for (const dir of ['central/skills', 'home/.codex/skills', 'home/.claude/skills', 'source']) mkdirSync(join(root, dir), { recursive: true });
writeFileSync(join(root, '.skill-card-master-eval.json'), JSON.stringify({ schema_version: 1, purpose: 'skill-card-master-b0-r', sample: 'mcp-lifecycle' }));

const clients = [];
function client() {
  const process = spawn(binary, [], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  clients.push(process);
  const pending = new Map();
  let id = 0;
  let stderr = '';
  process.stderr.on('data', chunk => { stderr += chunk; });
  createInterface({ input: process.stdout }).on('line', line => {
    let response;
    try { response = JSON.parse(line); } catch { throw new Error(`Non-protocol stdout: ${line}`); }
    const entry = pending.get(response.id);
    assert(entry, `Unexpected response: ${line}`);
    pending.delete(response.id);
    clearTimeout(entry.timer);
    entry.resolve(response);
  });
  process.on('exit', code => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(`Server exited ${code}: ${stderr}`)); }
    pending.clear();
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timeout: ${method} ${stderr}`)); }, 45_000);
    pending.set(requestId, { resolve, reject, timer });
    process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
  });
  const tool = async (name, args = {}, success = true) => {
    const response = await request('tools/call', { name, arguments: args });
    assert(!response.error, JSON.stringify(response));
    assert.equal(response.result.isError, !success, JSON.stringify(response));
    assert(Array.isArray(response.result.content));
    if (success) {
      assert(response.result.structuredContent && !Array.isArray(response.result.structuredContent), 'structuredContent must be an object');
      return response.result.structuredContent;
    }
    return response.result;
  };
  const initialize = () => request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'integration-test', version: '1' } });
  return { request, tool, initialize, notify: method => process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n') };
}
function permissions(enabled, writes) {
  const result = spawnSync('python3', ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executemany("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [("foundation_mcp_enabled",sys.argv[2]),("foundation_mcp_file_writes",sys.argv[3])]); c.commit()', join(root, 'central/skills-manager.db'), String(enabled), String(writes)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
const skillText = (name, body) => `---\nname: ${name}\ndescription: Evidence-backed customer research and interview synthesis\n---\n${body}\n`;

try {
  const a = client();
  assert.equal((await a.request('tools/list')).error.code, -32002);
  assert.equal((await a.initialize()).result.protocolVersion, '2025-06-18');
  a.notify('notifications/initialized');
  const catalog = (await a.request('tools/list')).result.tools;
  assert.equal(new Set(catalog.map(t => t.name)).size, 19);
  assert.equal((await a.tool('skills_manager_status')).enabled, false);
  await a.tool('skills_list', {}, false);
  permissions(true, false);
  await a.tool('skills_begin_edit', { request: { new_name: 'mcp-research', actor: 'session-a' } }, false);
  const scene = await a.tool('scenes_create', { request: { name: '用户研究', description: '访谈、归纳与研究结论' } });
  permissions(true, true);

  const stage = await a.tool('skills_begin_edit', { request: { new_name: 'mcp-research', actor: 'session-a' } });
  assert(stage.workspace_path.startsWith(root));
  await a.tool('skills_stage_write', { stage_id: stage.stage_id, relative_path: 'SKILL.md', content: skillText('mcp-research', 'Version 1: organize user interviews.') });
  await a.tool('skills_stage_write', { stage_id: stage.stage_id, relative_path: '../escape.txt', content: 'No' }, false);
  const preview = await a.tool('skills_preview_publish', { stage_id: stage.stage_id });
  const published = await a.tool('skills_publish', { request: { stage_id: stage.stage_id, candidate_digest: preview.stage_digest } });
  const id = published.skill_id;
  assert.deepEqual((await a.tool('scenes_set_priorities', { skill_ids: [id], priority: true })).prioritySkillIds, [id]);
  await a.tool('scenes_set_priorities', { skill_ids: ['not-managed'], priority: true }, false);
  assert.equal((await a.tool('skills_list', { limit: 1 })).total, 1);
  assert.equal((await a.tool('skills_list', { limit: 1 })).next_cursor, null);
  assert.equal((await a.tool('skills_list', { query: 'absent' })).total, 0);
  await a.tool('skills_list', { limit: 0 }, false);
  assert((await a.tool('skills_read', { skill_id: id })).content.includes('Version 1'));
  await a.tool('skills_read', { skill_id: id, relative_path: '../../escape' }, false);

  const snapshot = await a.tool('scenes_classification_snapshot', { skill_ids: [id] });
  assert.equal(snapshot.skills[0].priority, true);
  const proposal = { schemaVersion: 1, assignments: [{ skillId: id, contentHash: snapshot.skills[0].contentHash, scenes: [{ sceneName: '用户研究', reason: '说明包含访谈整理与研究归纳。' }] }], unknownSkillIds: [], errors: [] };
  assert.deepEqual((await a.tool('scenes_apply_classification', { snapshot, proposal })).appliedSkillIds, [id]);
  assert.equal((await a.tool('scenes_list')).assignments[id][0].sceneId, scene.id);
  await a.tool('scenes_assign', { request: { skill_id: id, scene_id: scene.id, assigned: false, reason: '用户排除此归属' } });
  await a.tool('scenes_apply_classification', { snapshot, proposal });
  assert.equal((await a.tool('scenes_list')).assignments[id].length, 0, 'AI must preserve manual exclusions');

  await a.tool('skills_deploy', { skill_ids: [id], agents: ['codex'] });
  const b = client();
  await b.initialize();
  const editA = await a.tool('skills_begin_edit', { request: { skill_id: id, actor: 'session-a' } });
  const editB = await b.tool('skills_begin_edit', { request: { skill_id: id, actor: 'session-b' } });
  await a.tool('skills_stage_write', { stage_id: editA.stage_id, relative_path: 'SKILL.md', content: skillText('mcp-research', 'Version 2: accepted update from session A.') });
  const nextPreview = await a.tool('skills_preview_publish', { stage_id: editA.stage_id });
  await a.tool('skills_publish', { request: { stage_id: editA.stage_id, candidate_digest: nextPreview.stage_digest } });
  assert((await b.tool('skills_read', { skill_id: id })).content.includes('Version 2'), 'second session must see published bytes');
  assert(readFileSync(join(root, 'home/.codex/skills/mcp-research/SKILL.md'), 'utf8').includes('Version 2'), 'Agent deployment must reflect publication');
  const stalePreview = await b.tool('skills_preview_publish', { stage_id: editB.stage_id });
  assert.equal(stalePreview.base_current, false);
  await b.tool('skills_publish', { request: { stage_id: editB.stage_id, candidate_digest: stalePreview.stage_digest } }, false);
  assert.equal((await b.tool('skills_changes')).items.length, 2);
  await a.tool('skills_undeploy', { skill_ids: [id], agents: ['codex'] });
  permissions(false, false);
  await b.tool('scenes_list', {}, false);
  assert.equal((await b.tool('skills_manager_status')).enabled, false);
  console.log('MCP integration passed: protocol/permissions → create → bounded read → scene proposal/correction → deploy → two-session publish → stale rejection → history → revocation.');
} finally {
  for (const process of clients) { process.stdin.end(); process.kill(); }
  rmSync(root, { recursive: true, force: true });
}
