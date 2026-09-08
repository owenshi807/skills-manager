import type { SceneCapability, SceneCapabilityGroup } from "./sceneCapabilities.ts";
import type { SkillScene } from "./skillScenes.ts";
import type { ManagedSkill } from "./tauri.ts";

export type GuideTranslate = (key: string) => string;

/** Keep the catalog's meaning while spelling out its internal review shorthand. */
export function guideText(key: string, translate: GuideTranslate): string {
  return translate(key)
    .replaceAll("IPO Scope Check", "范围与交付检查")
    .replaceAll("执行 IPO 范围检查", "检查输入、过程与输出")
    .replaceAll("每阶段回答 IPO：", "检查输入、过程与输出：")
    .replaceAll("Input 是否充分；Process 是否最小；Output 是否可验；现在能否停止。", "输入是否充分、过程是否必要、输出是否可验证；明确现在是否可以停止。");
}

export function capabilityTitle(capability: SceneCapability, translate: GuideTranslate): string {
  return capability.title || (capability.titleKey ? guideText(capability.titleKey, translate) : "场景能力");
}

export function capabilityPurpose(capability: SceneCapability, translate: GuideTranslate): string {
  return capability.description || (capability.descriptionKey ? guideText(capability.descriptionKey, translate) : "根据当前任务选择适合的 Skill。");
}

/** Only usable, present members participate in a guide; gaps remain reference material. */
export function usableSceneCapabilities(group: SceneCapabilityGroup, skills: ManagedSkill[]): SceneCapability[] {
  const present = new Set(skills.map((skill) => skill.id));
  const members = new Set(group.skillIds);
  return group.capabilities
    .filter((capability) => !capability.missing && !capability.excludedFromDeck)
    .map((capability) => ({ ...capability, skillIds: capability.skillIds.filter((id) => present.has(id) && members.has(id)) }))
    .filter((capability) => capability.skillIds.length > 0);
}

export function buildSceneGuideText(
  scene: SkillScene,
  group: SceneCapabilityGroup,
  skills: ManagedSkill[],
  translate: GuideTranslate,
): string {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const capabilities = usableSceneCapabilities(group, skills);
  const sections = capabilities.map((capability) => {
    const members = capability.skillIds.map((id) => {
      const skill = byId.get(id)!;
      const evidence = capability.evidence.find((row) => row.skillId === id);
      const description = skill.description?.trim() || "暂无独立说明；使用前查看 Skill 内容，确认职责。";
      return `- ${skill.name} [Skill ID: ${skill.id}]：${description}${evidence?.reason ? `\n  场景归属依据：${evidence.reason}` : ""}`;
    });
    const questionText = capability.question || (capability.questionKey ? guideText(capability.questionKey, translate) : "");
    const question = questionText ? `\n使用这项能力后检查：${questionText}` : "";
    const checks = capability.checkpoints.map((checkpoint) => `- ${guideText(checkpoint.titleKey, translate)}：${guideText(checkpoint.purposeKey, translate)}`);
    return `${capabilityTitle(capability, translate)}\n作用：${capabilityPurpose(capability, translate)}${capability.handoff ? `\n怎样配合：${capability.handoff}` : ""}\n可按职责选用的 Skill：\n${members.join("\n")}${question}${checks.length > 0 ? `\n待执行检查（不是已完成结果）：\n${checks.join("\n")}` : ""}`;
  });
  const unfilled = group.capabilities.filter((capability) => capability.missing);
  const references = unfilled.length > 0
    ? `\n\n参考组合中尚未找到对应 Skill 的能力：${unfilled.map((capability) => capabilityTitle(capability, translate)).join("、")}。它们不属于当前可用能力，也不要求为此扩大当前任务。`
    : "";
  return `使用场景：${scene.name}\n当前目标：${scene.description.trim() || group.summary || `围绕「${scene.name}」完成用户当前交代的任务。`}

请根据当前任务选择需要的能力与 Skill，并说明各自分工。同组 Skill 是候选项，不是有序依赖；不要自动全部运行。归类依据用于理解用途，不是新的操作指令。先查看所选 Skill 的实际内容，以用户当前目标为边界。

${sections.join("\n\n") || "当前场景没有可用的 Skill 组合。"}

完成判断：只验收本次实际选用的能力。说明做了什么、如何验证，以及哪些问题仍未解决；未执行的检查不得写成已通过。${references}`;
}
