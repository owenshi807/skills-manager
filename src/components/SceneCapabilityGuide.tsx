import { useId, useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, Clipboard, Loader2 } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "../utils";
import {
  buildSceneGuideText,
  capabilityPurpose,
  capabilityTitle,
  guideText,
  usableSceneCapabilities,
  type GuideTranslate,
} from "../lib/sceneCapabilityGuide";
import type { SceneCapability, SceneCapabilityGroup } from "../lib/sceneCapabilities";
import type { SkillScene } from "../lib/skillScenes";
import type { ManagedSkill } from "../lib/tauri";

export interface SceneCapabilityGuideProps {
  scene: SkillScene;
  group: SceneCapabilityGroup;
  managedSkills: ManagedSkill[];
  selectedCapabilityId: string | null;
  onSelectCapability: (id: string | null) => void;
  onOpenSkill: (id: string) => void;
}

function CapabilitySkills({ capability, skillsById, onOpenSkill }: {
  capability: SceneCapability;
  skillsById: Map<string, ManagedSkill>;
  onOpenSkill: (id: string) => void;
}) {
  const skills = capability.skillIds.flatMap((id) => {
    const skill = skillsById.get(id);
    return skill ? [skill] : [];
  });
  return <div className="mt-3">
    <p className="mb-2 text-[12px] leading-5 text-muted">{skills.length > 1 ? "按具体任务择用；同组 Skill 不需要依次全部运行。展开查看各自作用和归类依据。" : "展开查看这个 Skill 的作用和归类依据。"}</p>
    <div className="divide-y divide-border-subtle border-y border-border-subtle">
      {skills.map((skill) => {
        const evidence = capability.evidence.find((row) => row.skillId === skill.id);
        const sameName = skills.filter((row) => row.name === skill.name).length > 1;
        return <details key={skill.id} className="group/skill py-2.5">
          <summary className="flex cursor-pointer list-none items-start gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
            <ChevronDown aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 -rotate-90 text-faint transition-transform group-open/skill:rotate-0" />
            <span className="min-w-0 flex-1"><span className="break-words text-[12.5px] font-medium text-primary">{skill.name}</span>{sameName && <span className="ml-2 text-[10px] text-muted">同名项 {skill.id.slice(0, 8)}</span>}<span className="mt-0.5 block line-clamp-1 text-[11.5px] leading-5 text-muted">{skill.description?.trim() || evidence?.reason || "尚未补充说明"}</span></span>
          </summary>
          <div className="ml-5 mt-2 space-y-2 text-[12px] leading-6 text-muted">
            {skill.description?.trim() && <p className="whitespace-pre-wrap break-words">{skill.description}</p>}
            <p><span className="font-medium text-secondary">为什么在这个场景：</span>{evidence?.reason || "尚未记录归类依据。"}{evidence?.source === "user" && <span className="ml-1 text-[11px] text-faint">（手动归入）</span>}</p>
            <button type="button" className="inline-flex items-center gap-1 text-[11.5px] font-medium text-accent-light hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={() => onOpenSkill(skill.id)}>查看完整 Skill<ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" /></button>
          </div>
        </details>;
      })}
    </div>
  </div>;
}

function Checkpoints({ capability, translate }: { capability: SceneCapability; translate: GuideTranslate }) {
  if (capability.checkpoints.length === 0) return null;
  return <div className="mt-3 border-l-2 border-border-subtle pl-3 text-[12px] leading-6 text-muted"><p className="font-medium text-secondary">使用时需要检查</p>{capability.checkpoints.map((checkpoint) => <p key={checkpoint.titleKey}>{guideText(checkpoint.purposeKey, translate)}</p>)}<p className="text-[11px] text-faint">这是待执行的判断标准，尚未代表检查通过。</p></div>;
}

export function SceneCapabilityGuide({ scene, group, managedSkills, selectedCapabilityId, onSelectCapability, onOpenSkill }: SceneCapabilityGuideProps) {
  const { t } = useTranslation();
  const translate: GuideTranslate = (key) => t(key);
  const regionId = useId();
  const [copying, setCopying] = useState(false);
  const skillsById = useMemo(() => new Map(managedSkills.map((skill) => [skill.id, skill])), [managedSkills]);
  const capabilities = useMemo(() => usableSceneCapabilities(group, managedSkills), [group, managedSkills]);
  const missing = group.capabilities.filter((capability) => capability.missing);
  const excluded = group.capabilities.filter((capability) => capability.excludedFromDeck && capability.skillIds.some((id) => skillsById.has(id)));
  const checks = capabilities.filter((capability) => capability.questionKey || capability.question);
  const copyGuide = async () => {
    setCopying(true);
    try {
      await writeText(buildSceneGuideText(scene, group, managedSkills, translate));
      toast.success("已复制场景使用说明，可以交给助手按当前任务选用。");
    } catch {
      toast.error("复制失败，剪贴板当前不可用。请重试。");
    } finally {
      setCopying(false);
    }
  };

  return <section aria-label={`${scene.name}的能力组合`} className="app-panel mb-5 overflow-hidden">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border-subtle px-5 py-5 sm:px-6">
      <div className="max-w-[760px]"><h2 className="text-[13px] font-semibold text-primary">这个场景要完成什么</h2><p className="mt-2 text-[15px] leading-7 text-secondary">{scene.description.trim() || group.summary || `围绕「${scene.name}」选择适合当前任务的能力。`}</p></div>
      <button type="button" className="app-button-secondary shrink-0" disabled={copying || capabilities.length === 0} onClick={() => void copyGuide()}>{copying ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Clipboard aria-hidden="true" className="h-3.5 w-3.5" />}复制使用说明</button>
    </div>

    <div className="px-5 py-5 sm:px-6">
      <h3 className="text-[13px] font-semibold text-primary">{capabilities.length > 1 ? "这些能力如何配合" : "可以用到的能力"}</h3>
      <p className="mt-1 text-[12px] leading-6 text-muted">{capabilities.length > 1 ? "按当前任务组合选用，不要求全部执行。点击一项能力，查看可承担这项工作的 Skill。" : capabilities.length === 1 ? "先确认它是否符合当前任务，再展开选择适合的 Skill。" : excluded.length > 0 ? "此场景的 Skill 当前未纳入组合；可以在下方查看保留的归属。" : "这个场景尚未形成可用组合；可以先把相关 Skill 归入此场景。"}</p>

      <div className="mt-3 divide-y divide-border-subtle">
        {capabilities.map((capability, index) => {
          const selected = selectedCapabilityId === capability.id;
          const singleSceneGroup = capabilities.length === 1 && capability.source === "scene";
          const title = singleSceneGroup ? "这组 Skill 的分工" : capabilityTitle(capability, translate);
          const purpose = capabilityPurpose(capability, translate);
          const contentId = `${regionId}-${index}`;
          return <div key={capability.id} className="py-1">
            <button type="button" aria-expanded={selected} aria-controls={contentId} onClick={() => onSelectCapability(selected ? null : capability.id)} className={cn("flex w-full items-start gap-3 rounded-md px-2 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60", selected ? "bg-accent-bg/35" : "hover:bg-surface-hover")}>
              {capabilities.length > 1 && <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-border-subtle" />}
              <span className="min-w-0 flex-1"><span className="text-[13px] font-semibold text-primary">{title}</span>{(!singleSceneGroup || purpose !== scene.description.trim()) && <span className="mt-1 block text-[12.5px] leading-6 text-muted">{purpose}</span>}{capability.handoff && <span className="mt-1 block text-[12px] leading-6 text-secondary">配合：{capability.handoff}</span>}</span>
              <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[11px] text-faint"><span>{capability.skillIds.length} 个 Skill</span><ChevronDown aria-hidden="true" className={cn("h-3.5 w-3.5 transition-transform", selected && "rotate-180")} /></span>
            </button>
            <div id={contentId} hidden={!selected} className={cn("px-2 pb-4 pt-1", capabilities.length > 1 && "sm:pl-9")}>
              {(capability.questionKey || capability.question) && <p className="text-[12.5px] leading-6 text-secondary"><span className="font-medium">使用后确认：</span>{capability.question || guideText(capability.questionKey!, translate)}</p>}
              <CapabilitySkills capability={capability} skillsById={skillsById} onOpenSkill={onOpenSkill} />
              <Checkpoints capability={capability} translate={translate} />
              {capability.source === "scene" && <p className="mt-3 text-[11px] leading-5 text-faint">这组能力依据现有场景归属整理，具体分工以 Skill 说明为准。</p>}
            </div>
          </div>;
        })}
      </div>
    </div>

    {capabilities.length > 0 && <div className="border-t border-border-subtle px-5 py-5 sm:px-6">
      <h3 className="text-[13px] font-semibold text-primary">怎样判断这次工作完成了</h3>
      <p className="mt-1 text-[12px] leading-6 text-muted">只检查本次实际用到的能力；列出验证结果和仍未解决的问题。</p>
      {checks.length > 0 ? <ul className="mt-2 space-y-1.5 text-[12.5px] leading-6 text-secondary">{checks.map((capability) => <li key={capability.id}><span className="mr-2 text-faint">·</span>{checks.length > 1 && <span className="mr-1 font-medium">{capabilityTitle(capability, translate)}：</span>}{capability.question || guideText(capability.questionKey!, translate)}</li>)}</ul> : <p className="mt-2 text-[12.5px] leading-6 text-secondary">对照上面的场景目标，说明交付结果如何满足本次需求。具体标准需结合所选 Skill 确认。</p>}
    </div>}

    {(missing.length > 0 || excluded.length > 0 || group.deck) && <div className="border-t border-border-subtle px-5 py-3 text-[12px] sm:px-6">
      {missing.length > 0 && <details className="group/gaps py-2" open={missing.some((capability) => capability.id === selectedCapabilityId) || undefined}><summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><ChevronDown aria-hidden="true" className="h-3.5 w-3.5 -rotate-90 transition-transform group-open/gaps:rotate-0" />本次组合未覆盖的事项</summary><div className="ml-5 mt-2 space-y-2 leading-6 text-muted"><p>按本次任务决定是否补充；也可以到其他使用场景查找相关能力。</p>{missing.map((capability) => <div key={capability.id}><p className="font-medium text-secondary">{capabilityTitle(capability, translate)}</p><p>{capabilityPurpose(capability, translate)}</p><Checkpoints capability={capability} translate={translate} /></div>)}</div></details>}
      {excluded.map((capability) => <details key={capability.id} className="group/excluded py-2" open={selectedCapabilityId === capability.id || undefined}><summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><ChevronDown aria-hidden="true" className="h-3.5 w-3.5 -rotate-90 transition-transform group-open/excluded:rotate-0" />仍在此场景、未纳入本次组合的 Skill</summary><div className="ml-5 mt-2"><p className="leading-6 text-muted">这些 Skill 已按你的设置从组合中排除，原有场景归属保留。</p><CapabilitySkills capability={capability} skillsById={skillsById} onOpenSkill={onOpenSkill} /></div></details>)}
      {group.deck && <details className="group/reference py-2"><summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><ChevronDown aria-hidden="true" className="h-3.5 w-3.5 -rotate-90 transition-transform group-open/reference:rotate-0" />查看参考组合的边界与检查建议</summary><div className="ml-5 mt-2 space-y-2 leading-6 text-muted"><p>说明来自现有「{guideText(group.deck.titleKey, translate)}」组合，范围比当前场景更宽；仅作参考。</p><p><span className="font-medium text-secondary">参考目标：</span>{guideText(group.deck.outcomeKey, translate)}</p><p><span className="font-medium text-secondary">执行中检查：</span>{guideText(group.deck.supervisionKey, translate)}</p><p><span className="font-medium text-secondary">何时停止：</span>{guideText(group.deck.stopRuleKey, translate)}</p></div></details>}
    </div>}
  </section>;
}
