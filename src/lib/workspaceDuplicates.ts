import type { ProjectSkill } from "./tauri";

export interface WorkspaceDuplicateGroup {
  id: string;
  label: string;
  members: ProjectSkill[];
  exactContent: boolean;
  centerSkillIds: string[];
}

function normalizeName(name: string) {
  return name.normalize("NFKC").toLocaleLowerCase();
}

export function buildWorkspaceDuplicateGroups(skills: ProjectSkill[]): WorkspaceDuplicateGroup[] {
  const groups = new Map<string, ProjectSkill[]>();
  for (const skill of skills) {
    const key = normalizeName(skill.name);
    const members = groups.get(key) ?? [];
    members.push(skill);
    groups.set(key, members);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => {
      const hashes = new Set(members.map((member) => member.content_hash).filter(Boolean));
      return {
        id: `workspace-name:${key}:${members.map((member) => member.relative_path).sort().join("|")}`,
        label: members[0].name,
        members: [...members].sort((a, b) => a.relative_path.localeCompare(b.relative_path)),
        exactContent: hashes.size === 1 && members.every((member) => !!member.content_hash),
        centerSkillIds: [...new Set(
          members.map((member) => member.center_skill_id).filter((id): id is string => !!id),
        )],
      };
    })
    .sort((a, b) => Number(b.exactContent) - Number(a.exactContent) || a.label.localeCompare(b.label));
}
