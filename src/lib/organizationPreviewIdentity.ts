export interface OrganizationArchivePreviewIdentityInput {
  active: boolean;
  issueId: string | null | undefined;
  caseRevision: string | null | undefined;
  issueKind: string | null | undefined;
  memberIds: string[];
  keepSkillId: string | null | undefined;
  archiveSkillId: string | null | undefined;
}

function stableMemberIds(memberIds: string[]) {
  return [...memberIds].sort((left, right) => left.localeCompare(right));
}

export function organizationIssueSelectionIdentity(
  issueId: string | null | undefined,
  memberIds: string[],
  recommendedKeepSkillId: string | null | undefined,
) {
  if (!issueId) return null;
  return JSON.stringify([
    issueId,
    stableMemberIds(memberIds),
    recommendedKeepSkillId ?? null,
  ]);
}

export function organizationArchivePreviewIdentity({
  active,
  issueId,
  caseRevision,
  issueKind,
  memberIds,
  keepSkillId,
  archiveSkillId,
}: OrganizationArchivePreviewIdentityInput) {
  if (
    !active
    || !issueId
    || !caseRevision
    || !issueKind
    || !keepSkillId
    || !archiveSkillId
  ) {
    return null;
  }

  return JSON.stringify([
    issueId,
    caseRevision,
    issueKind,
    stableMemberIds(memberIds),
    keepSkillId,
    archiveSkillId,
  ]);
}
