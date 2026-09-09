// Browser-only Tauri fixture shared by Portal acceptance clients.
// Safe to serialize with portalFixtureInit.toString(); no imports or native calls.
export function portalFixtureInit() {
  const skills = Array.from({ length: 80 }, (_, i) => ({
    id: `fixture-skill-${String(i + 1).padStart(3, '0')}`, name: `知识技能 ${String(i + 1).padStart(3, '0')}`,
    description: '浏览器验收 fixture：标出来源与判断条件，不包含真实用户内容。', source_type: 'local', source_ref: null,
    source_ref_resolved: null, source_subpath: null, source_branch: null, source_revision: `fixture-rev-${i + 1}`,
    remote_revision: null, update_status: 'local_only', last_checked_at: null, last_check_error: null,
    central_path: '/fixture/skills', content_hash: `fixture-hash-${i + 1}`, enabled: true, created_at: 1,
    updated_at: 1, status: 'ok', targets: [], preset_ids: [], tags: [],
  }));
  const tools = [{ key: 'codex', display_name: 'Codex fixture', installed: true, enabled: true, category: 'coding',
    skills_dir: '/fixture/codex', is_custom: false, has_path_override: false, project_relative_skills_dir: null, has_project_path_override: false }];
  const scenes = Array.from({ length: 24 }, (_, i) => ({ id: `knowledge-${i + 1}`, name: `知识炼成 ${String(i + 1).padStart(2, '0')}`,
    description: '让资料沉淀为可追溯、可判断、可复用的方法。此处为页面状态和滚动验收。', createdAt: 1, updatedAt: 1 }));
  const overview = { scenes, assignments: Object.fromEntries(skills.map((s, i) => [s.id, [{ sceneId: scenes[i % scenes.length].id, reason: 'fixture', source: 'user', updatedAt: 1 }]])),
    pendingSkillIds: [], unknownSkillIds: [], errorSkillIds: [], perSkillErrors: {}, classifiedSkillIds: skills.map(s => s.id), prioritySkillIds: [], autoClassifyEnabled: false, preferredAgent: 'codex' };
  const library = [skills.map((skill, i) => ({ skill, canonical_name: skill.name, canonical: null, platform_agent_keys: ['codex'],
    deployments: i < 12 ? [{ tool: 'codex', actual_status: i === 0 ? 'needs_sync' : 'current', recorded_status: 'installed', mode: 'copy', synced_at: 1720000000000, target_path: '/fixture/deploy' }] : [] })), []];
  const values = { get_managed_skills: skills, get_skill_library: library, get_skill_scene_overview: overview,
    get_skill_scene_agent_capabilities: [{ key: 'codex', display_name: 'Codex fixture', available: true, version: 'fixture', reason: null }],
    get_organization_agent_capabilities: [{ key: 'codex', display_name: 'Codex fixture', available: true, version: 'fixture', reason: null }],
    get_presets: [], get_active_preset: null, get_tool_status: tools, get_projects: [],
    scan_local_skills: { tools_scanned: 1, skills_found: 0, observations_found: 0, groups_found: 0, groups: [] } };
  const callbacks = new Map(); let callbackId = 0;
  window.__PORTAL_FIXTURE__ = { failLibrary: false, failLibraryString: false, duplicateLibrary: false, webglContexts: 0, ipc: [] };
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
    if (/^webgl2?$/.test(kind)) window.__PORTAL_FIXTURE__.webglContexts += 1;
    return originalGetContext.call(this, kind, ...args);
  };
  const invoke = async (command, args = {}) => {
    const lifecycle = command.startsWith('plugin:event|') || command.startsWith('plugin:window|');
    const telemetry = command === 'log_startup_event';
    const read = command === 'read_skill_publish_document' || command === 'get_settings' || Object.hasOwn(values, command);
    const entry = { command, kind: lifecycle ? 'lifecycle' : telemetry ? 'telemetry' : read ? 'read' : 'unexpected', argumentKeys: Object.keys(args), settingKey: command === 'get_settings' ? args.key : undefined };
    window.__PORTAL_FIXTURE__.ipc.push(entry);
    await window.__portalRecordIPC?.(entry);
    if (lifecycle) return command.endsWith('|listen') ? ++callbackId : null;
    if (telemetry) return null;
    if (command === 'get_settings') return ({ language: 'zh', theme: 'light', text_size: 'default', backup_first_run_prompt: 'dismissed', auto_update_apply: 'off' })[args.key] ?? null;
    if (command === 'get_skill_library') {
      if (window.__PORTAL_FIXTURE__.failLibraryString) return Promise.reject('Fixture first library read failed (string)');
      if (window.__PORTAL_FIXTURE__.failLibrary) throw new Error('Fixture library read failed');
      if (window.__PORTAL_FIXTURE__.duplicateLibrary) return [[library[0][0], library[0][0]], []];
    }
    if (command === 'read_skill_publish_document') {
      return { skill_id: args.skillId, relative_path: 'SKILL.md', content: '# Fixture Skill\n\n原始能力说明，用于只读详情验收。', truncated: false, total_bytes: 77, content_digest: 'fixture-document-digest' };
    }
    if (Object.hasOwn(values, command)) return structuredClone(values[command]);
    throw new Error(`Unexpected fixture IPC: ${command}`);
  };
  window.__TAURI_INTERNALS__ = { invoke, transformCallback(fn) { const id = ++callbackId; callbacks.set(id, fn); return id; }, unregisterCallback(id) { callbacks.delete(id); },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } } };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
}
