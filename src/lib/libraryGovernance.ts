import type { SkillIssue } from "./skillOrganization";
import type { CanonicalGroup } from "./skillPublishing";

export function isVersionDecisionCurrent(group: CanonicalGroup) {
  return group.canonical_status === "confirmed" || group.canonical_status === "variants_confirmed";
}

export function filterVersionGroups(groups: CanonicalGroup[], search: string) {
  const query = search.trim().toLocaleLowerCase();
  return groups.filter((group) => !query || [
    group.normalized_name, group.selection_reason ?? "", group.platform_resolution?.reason ?? "",
    ...group.members.flatMap((member) => [member.skill.name, member.skill.central_path]),
  ].some((value) => value.toLocaleLowerCase().includes(query)));
}

function memberIdentity(ids: string[]) {
  return JSON.stringify([...new Set(ids)].sort());
}

/** Match exact member IDs: labels and overlapping sets are not identity. */
export function reconcileLibraryGovernance(
  issues: SkillIssue[],
  groups: CanonicalGroup[],
  resolvedIds: Set<string>,
) {
  const groupsByMembers = new Map(groups.map((group) => [
    memberIdentity(group.members.map((member) => member.skill.id)), group,
  ]));
  const groupsByIssue = new Map<string, CanonicalGroup>();
  const matchedGroups = new Set<string>();
  const nextResolvedIds = new Set(resolvedIds);
  const remainingIssues = issues.filter((issue) => {
    if (issue.kind !== "name_collision" && issue.kind !== "exact_duplicate") return true;
    const group = groupsByMembers.get(memberIdentity(issue.skills.map((skill) => skill.id)));
    if (!group) return true;
    groupsByIssue.set(issue.id, group);
    matchedGroups.add(group.normalized_name);
    if (!isVersionDecisionCurrent(group)) {
      // A previous organization decision cannot bless changed version evidence.
      nextResolvedIds.delete(issue.id);
      return true;
    }
    // A canonical choice does not prove other variants equivalent or disposable.
    // Keep that comparison in the existing organization workflow.
    return group.canonical_status !== "variants_confirmed"
      && group.unresolved_alternatives.length > 0;
  });
  return {
    issues: remainingIssues,
    resolvedIds: nextResolvedIds,
    groupsByIssue,
    pendingGroups: groups.filter((group) => !isVersionDecisionCurrent(group) && !matchedGroups.has(group.normalized_name)),
    confirmedGroups: groups.filter(isVersionDecisionCurrent),
  };
}
