import type {
  ManagedSkill,
  OrganizationCaseEvidence,
  OrganizationDecisionTier,
  OrganizationHealthInspection,
} from "./tauri";

export type SkillRelationKind = "exact_duplicate" | "name_collision" | "content_alias";

export interface SkillRelationGroup {
  id: string;
  kind: SkillRelationKind;
  label: string;
  skills: ManagedSkill[];
  requiresDecision: boolean;
}

export type SkillCapabilityGroupKind = "purpose" | "suite";

export interface SkillCapabilityGroup {
  id: string;
  kind: SkillCapabilityGroupKind;
  labelKey: string;
  basisKey: string;
  skills: ManagedSkill[];
}

export type SkillIssueKind = SkillRelationKind | "format_health" | "source_missing" | "sync_conflict" | "read_error";

export interface SkillIssue {
  id: string;
  kind: SkillIssueKind;
  skills: ManagedSkill[];
  details?: string[];
  decisionTier: OrganizationDecisionTier;
  caseRevision?: string;
  artifactStatus?: OrganizationCaseEvidence["artifact"]["status"];
  reasonCodes?: string[];
  unresolvedGates?: string[];
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
  healthInspections: OrganizationHealthInspection[] = [],
  caseEvidence: OrganizationCaseEvidence[] = [],
): SkillIssue[] {
  const evidenceByCase = new Map(caseEvidence.map((evidence) => [evidence.case_id, evidence]));
  const issues: SkillIssue[] = relationGroups.map((group) => {
    const evidence = evidenceByCase.get(group.id);
    return {
      id: group.id,
      kind: group.kind,
      skills: group.skills,
      decisionTier: evidence?.decision.tier
        ?? (group.kind === "name_collision" ? "needs_semantic" : "blocked"),
      caseRevision: evidence?.case_revision,
      artifactStatus: evidence?.artifact.status,
      reasonCodes: evidence?.decision.reason_codes,
      unresolvedGates: evidence?.decision.unresolved_gates,
      details: evidence?.artifact.diagnostics,
    };
  });

  for (const skill of skills) {
    if (conflictIds.has(skill.id)) {
      issues.push({ id: `conflict:${skill.id}`, kind: "sync_conflict", skills: [skill], decisionTier: "blocked" });
    }
    if (skill.update_status === "source_missing") {
      issues.push({ id: `source:${skill.id}`, kind: "source_missing", skills: [skill], decisionTier: "rule_diagnosed" });
    }
    if (skill.update_status === "error") {
      issues.push({ id: `error:${skill.id}`, kind: "read_error", skills: [skill], decisionTier: "blocked" });
    }
  }

  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  for (const inspection of healthInspections) {
    if (inspection.issues.length === 0) continue;
    const skill = skillsById.get(inspection.skill_id);
    if (!skill) continue;
    issues.push({
      id: `format:${skill.id}`,
      kind: "format_health",
      skills: [skill],
      details: inspection.issues.map((issue) => issue.detail),
      decisionTier: inspection.issues.some((issue) => issue.severity === "error")
        ? "blocked"
        : "rule_diagnosed",
    });
  }

  return issues;
}

export function countSkillsInRelations(relationGroups: SkillRelationGroup[]) {
  return new Set(relationGroups.flatMap((group) => group.skills.map((skill) => skill.id))).size;
}

const PURPOSE_GROUPS = [
  { id: "business", tokens: ["business", "market", "commercial", "finance", "sales", "deal", "customer", "brand", "marketing", "demand", "商业", "市场", "财务", "销售"] },
  { id: "research", tokens: ["research", "search", "browse", "investigate", "arxiv", "benchmark", "intelligence", "调研", "研究", "搜索", "洞察"] },
  { id: "documents", tokens: ["docx", "document", "pdf", "ppt", "slide", "presentation", "markdown", "article", "writing", "proofread", "文档", "文章", "写作", "演示"] },
  { id: "design", tokens: ["design", "figma", "image", "visual", "comic", "infographic", "creative", "设计", "图像", "视觉", "创意"] },
  { id: "engineering", tokens: ["code", "review", "test", "debug", "architecture", "security", "github", "git", "developer", "ios", "代码", "测试", "调试", "架构", "安全"] },
  { id: "agents", tokens: ["agent", "skill", "prompt", "workflow", "automation", "context", "claude", "codex", "智能体", "自动化", "工作流"] },
] as const;

const SUITE_GROUPS = [
  { id: "gstack", matches: (skill: ManagedSkill) => /(?:^|[\\/])gstack-|[\\/]gstack[\\/]/i.test(skill.source_ref_resolved || skill.source_ref || "") },
  { id: "gsd", matches: (skill: ManagedSkill) => /^gsd-/i.test(skill.name) },
  { id: "huashu", matches: (skill: ManagedSkill) => /^huashu-/i.test(skill.name) || /huashu/i.test(skill.source_ref_resolved || skill.source_ref || "") },
  { id: "ios", matches: (skill: ManagedSkill) => /^ios-/i.test(skill.name) },
] as const;

function searchableSkillText(skill: ManagedSkill) {
  return `${skill.name} ${skill.description || ""}`.normalize("NFKC").toLocaleLowerCase();
}

export function buildSkillCapabilityGroups(skills: ManagedSkill[]): SkillCapabilityGroup[] {
  const groups: SkillCapabilityGroup[] = [];
  const purposeMembers = new Map<string, ManagedSkill[]>();

  for (const skill of skills) {
    const text = searchableSkillText(skill);
    let best: { id: string; score: number } | null = null;
    for (const definition of PURPOSE_GROUPS) {
      const score = definition.tokens.reduce((total, token) => {
        const normalizedToken = token.toLocaleLowerCase();
        const inName = skill.name.toLocaleLowerCase().includes(normalizedToken);
        const inText = text.includes(normalizedToken);
        return total + (inName ? 3 : inText ? 1 : 0);
      }, 0);
      if (score > 0 && (!best || score > best.score)) best = { id: definition.id, score };
    }
    if (best) {
      const members = purposeMembers.get(best.id) ?? [];
      members.push(skill);
      purposeMembers.set(best.id, members);
    }
  }

  for (const definition of PURPOSE_GROUPS) {
    const members = purposeMembers.get(definition.id) ?? [];
    if (members.length < 2) continue;
    groups.push({
      id: `purpose:${definition.id}`,
      kind: "purpose",
      labelKey: definition.id,
      basisKey: "purpose",
      skills: members.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  for (const definition of SUITE_GROUPS) {
    const members = skills.filter(definition.matches).sort((a, b) => a.name.localeCompare(b.name));
    if (members.length < 2) continue;
    groups.push({
      id: `suite:${definition.id}`,
      kind: "suite",
      labelKey: definition.id,
      basisKey: "suite",
      skills: members,
    });
  }

  return groups;
}

export function countSkillsInCapabilityGroups(groups: SkillCapabilityGroup[]) {
  return new Set(groups.flatMap((group) => group.skills.map((skill) => skill.id))).size;
}
