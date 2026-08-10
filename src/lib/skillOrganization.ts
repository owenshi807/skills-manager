import type { ManagedSkill } from "./tauri";

export type SkillRelationKind = "exact_duplicate" | "name_collision" | "content_alias";

export interface SkillRelationGroup {
  id: string;
  kind: SkillRelationKind;
  label: string;
  skills: ManagedSkill[];
  requiresDecision: boolean;
}

export type SkillIssueKind = SkillRelationKind | "source_missing" | "sync_conflict" | "read_error";

export interface SkillIssue {
  id: string;
  kind: SkillIssueKind;
  skills: ManagedSkill[];
}

function normalizedName(name: string) {
  return name.normalize("NFKC").toLocaleLowerCase();
}

function groupBy<T>(items: T[], keyFor: (item: T) => string | null) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

export function buildSkillRelationGroups(skills: ManagedSkill[]): SkillRelationGroup[] {
  const relationGroups: SkillRelationGroup[] = [];
  const groupedSets = new Set<string>();
  const nameGroups = groupBy(skills, (skill) => normalizedName(skill.name));

  for (const [nameKey, members] of nameGroups) {
    if (members.length < 2) continue;
    const knownHashes = new Set(members.map((skill) => skill.content_hash).filter(Boolean));
    const exactDuplicate = knownHashes.size === 1 && members.every((skill) => !!skill.content_hash);
    const memberKey = members.map((skill) => skill.id).sort().join(":");
    groupedSets.add(memberKey);
    relationGroups.push({
      id: `name:${nameKey}`,
      kind: exactDuplicate ? "exact_duplicate" : "name_collision",
      label: members[0].name,
      skills: members,
      requiresDecision: !exactDuplicate,
    });
  }

  const contentGroups = groupBy(skills, (skill) => skill.content_hash);
  for (const [contentHash, members] of contentGroups) {
    if (members.length < 2) continue;
    const memberKey = members.map((skill) => skill.id).sort().join(":");
    if (groupedSets.has(memberKey)) continue;
    relationGroups.push({
      id: `content:${contentHash}`,
      kind: "content_alias",
      label: members.map((skill) => skill.name).join(" / "),
      skills: members,
      requiresDecision: false,
    });
  }

  return relationGroups.sort((a, b) => {
    if (a.requiresDecision !== b.requiresDecision) return a.requiresDecision ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
}

export function buildSkillIssues(
  skills: ManagedSkill[],
  relationGroups: SkillRelationGroup[],
  conflictIds: Set<string>,
): SkillIssue[] {
  const issues: SkillIssue[] = relationGroups.map((group) => ({
    id: group.id,
    kind: group.kind,
    skills: group.skills,
  }));

  for (const skill of skills) {
    if (conflictIds.has(skill.id)) {
      issues.push({ id: `conflict:${skill.id}`, kind: "sync_conflict", skills: [skill] });
    }
    if (skill.update_status === "source_missing") {
      issues.push({ id: `source:${skill.id}`, kind: "source_missing", skills: [skill] });
    }
    if (skill.update_status === "error") {
      issues.push({ id: `error:${skill.id}`, kind: "read_error", skills: [skill] });
    }
  }

  return issues;
}

export function countSkillsInRelations(relationGroups: SkillRelationGroup[]) {
  return new Set(relationGroups.flatMap((group) => group.skills.map((skill) => skill.id))).size;
}
