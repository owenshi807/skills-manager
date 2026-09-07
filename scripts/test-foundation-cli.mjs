import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const binary = resolve('src-tauri/target/debug/skills-manager-cli');
const root = mkdtempSync(join(tmpdir(), 'foundation-cli-'));
const env = { ...process.env, SKILLS_MANAGER_EVAL_ROOT: root };
for (const dir of ['central/skills', 'home/.codex/skills', 'source']) mkdirSync(join(root, dir), { recursive: true });
writeFileSync(join(root, '.skill-card-master-eval.json'), JSON.stringify({ schema_version: 1, purpose: 'skill-card-master-b0-r', sample: 'agent-integration' }));
function cli(args, success = true) {
  const result = spawnSync(binary, ['--json', ...args], { env, encoding: 'utf8' });
  assert.equal(result.status === 0, success, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse((result.stdout.trim() || result.stderr.trim()));
}
try {
  const refused = cli(['presets', 'list'], false);
  assert.equal(refused.ok, false);
  assert(!existsSync(join(root, 'central/skills-manager.db')), 'hidden command must fail before initialization');
  const source = join(root, 'source');
  writeFileSync(join(source, 'SKILL.md'), '---\nname: cli-lifecycle\n---\nv1\n');
  const installed = cli(['skills', 'install', source, '--local']);
  assert.equal(installed.ok, true);
  assert(!('preset_id' in installed));
  const id = installed.skill_id;
  writeFileSync(join(source, 'SKILL.md'), '---\nname: cli-lifecycle\n---\nv2\n');
  cli(['skills', 'update', id]);
  cli(['skills', 'deploy', id, '--agent', 'codex']);
  let status = cli(['skills', 'status', id]);
  assert(status.agents.find(a => a.key === 'codex').deployed);
  assert(!('tags' in status));
  assert(!('presets' in status));
  const target = status.agents.find(a => a.key === 'codex').target_path;
  assert(readFileSync(join(target, 'SKILL.md'), 'utf8').includes('v2'));
  // Replacing our symlink with an independent directory must never grant ownership.
  rmSync(target, { recursive: true });
  mkdirSync(target);
  writeFileSync(join(target, 'private.txt'), 'external ownership');
  status = cli(['skills', 'status', id]);
  assert.equal(status.agents.find(a => a.key === 'codex').deployed, false);
  const conflict = cli(['skills', 'deploy', id, '--agent', 'codex'], false);
  assert.equal(conflict.ok, false);
  assert.equal(readFileSync(join(target, 'private.txt'), 'utf8'), 'external ownership');
  // A separate CLI launch reindexes observations but cannot bless external edits.
  writeFileSync(join(installed.central_path, 'SKILL.md'), '---\nname: cli-lifecycle\n---\nexternal library content\n');
  writeFileSync(join(source, 'SKILL.md'), '---\nname: cli-lifecycle\n---\nv3\n');
  cli(['skills', 'update', id], false);
  assert(readFileSync(join(installed.central_path, 'SKILL.md'), 'utf8').includes('external library content'));
  console.log('Foundation CLI integration passed: install → update → deploy → disk status; hidden state, unowned target and external reindex overwrite refused.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
