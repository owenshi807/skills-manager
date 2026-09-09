export const SCENE_STORAGE = 'skills-manager.toy-wilds.agent-loadouts.v4';
export const LEGACY_STORAGE = 'skills-manager.toy-wilds.agent-loadouts.v3';

const LOCAL_REF = /^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINEAGES = new Set(['explorer', 'maker', 'sage', 'ranger']);
const ids = value => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 200))] : [];

// A readable JSON object can still be damaged. Never overwrite its original
// bytes with a normalized empty loadout during automatic startup migration.
export function isSceneProfileRecord(raw) {
  if (raw?.version !== 4 || !Array.isArray(raw.agents) || !raw.agents.length) return false;
  const seen = new Set();
  for (const agent of raw.agents) {
    if (!agent || !LOCAL_REF.test(agent.id) || seen.has(agent.id) || typeof agent.name !== 'string' || !agent.name.trim() || !LINEAGES.has(agent.lineage)) return false;
    seen.add(agent.id);
    for (const field of ['sceneLoadouts', 'legacySkillIds']) {
      const list = raw[field]?.[agent.id];
      if (!Array.isArray(list) || list.some(id => typeof id !== 'string' || !id || id.length > 200)) return false;
    }
  }
  return seen.has(raw.selectedAgentRef);
}

function characters(raw) {
  if (!Array.isArray(raw?.agents)) return [];
  const seen = new Set();
  return raw.agents.filter(agent => {
    if (!agent || !LOCAL_REF.test(agent.id) || seen.has(agent.id) || typeof agent.name !== 'string' || !agent.name.trim() || !LINEAGES.has(agent.lineage)) return false;
    seen.add(agent.id); return true;
  }).map(agent => ({ id: agent.id, name: agent.name, lineage: agent.lineage, createdAt: agent.createdAt }));
}

/** A version boundary, never an inference from a Skill ID to a scene ID. */
export function migrateSceneProfiles(current, legacy, createFirst) {
  const source = current?.version === 4 ? current : legacy?.version === 3 ? legacy : null;
  let agents = characters(source);
  if (!agents.length) agents = [createFirst()];
  const sceneLoadouts = {}, legacySkillIds = {};
  for (const agent of agents) {
    sceneLoadouts[agent.id] = source?.version === 4 ? ids(source.sceneLoadouts?.[agent.id]) : [];
    legacySkillIds[agent.id] = ids(source?.version === 4 ? source.legacySkillIds?.[agent.id] : source?.loadouts?.[agent.id]);
  }
  return {
    version: 4, agents,
    selectedAgentRef: agents.some(agent => agent.id === source?.selectedAgentRef) ? source.selectedAgentRef : agents[0].id,
    sceneLoadouts, legacySkillIds,
  };
}

/** Selected IDs survive a missing/failed snapshot. Only the member projection changes. */
export function projectSceneSkillIds(scenes, sceneIds) {
  const selected = new Set(sceneIds);
  return [...new Set((scenes || []).filter(scene => selected.has(scene.id)).flatMap(scene => scene.skillIds))];
}
