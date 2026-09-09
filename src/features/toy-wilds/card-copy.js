// Human-edited copy is tied to the exact UTF-8 SKILL.md bytes in the real
// Skill Manager library, reviewed locally on 2026-09-09. No file reads or
// dependency discovery happen in this browser-safe module.
const REVIEWED = {
  'grill-me': {
    sha256: '74147eb6010a65957efef2b9e0f0b3ff935c1def7fc117697151b1d0f3610556',
    copy: {
      kind: 'reviewed',
      title: '方案追问',
      value: '一问一答拆清关键选择，弄明白方案为什么这样做。',
      when: '方案还含糊，或想在动手前接受追问',
      outcome: '关键问题、建议答案和更清楚的选择',
      condition: '需要你持续参与，一次回答一个问题',
      steps: ['逐个追问方案中的关键选择', '为每个问题给出推荐答案', '理顺选择之间的依赖；能查代码的先查代码'],
      input: '准备讨论的方案，以及你对逐题追问的回答。',
      evidenceNote: '2026-09-09 本机人工审校，依据真实库 grill-me/SKILL.md 第6、8、10行；当前完整正文与审校版本一致。文案核对不代表运行效果评级。',
    },
  },
  'business-coach': {
    sha256: 'fbabd4f0cbfcc53277d0fd90409b4691b0c74ba888010baa2edc6e64800bb24b',
    copy: {
      kind: 'reviewed',
      title: '商业项目推演',
      value: '从需求、赚钱到增长，找出最该先验证的项目风险。',
      when: '评估创业想法、梳理项目或设计验证时',
      outcome: '关键假设与验证路径，完整推演含项目画布',
      condition: '需说明项目与阶段，关键假设仍要实测',
      steps: ['梳理项目需求、方案与商业逻辑', '找出需要优先验证的高风险假设', '按所选模式形成诊断、项目画布或验证计划'],
      input: '项目或产品的一句话描述、当前阶段及已有证据。',
      evidenceNote: '2026-09-09 本机人工审校，依据真实库 business-coach/SKILL.md 第24–29、190–227、276–278、362–364行；当前完整正文与审校版本一致。产物依模式而定，不承诺商业结果或替用户作最终决定。',
    },
  },
  'knowledge-audit': {
    sha256: 'c7da04675dd96e9ecd4a0d63b013b5ef32efd58dbf374c67b8239bec9a5b8941',
    copy: {
      kind: 'reviewed',
      title: '资料入库把关',
      value: '在资料入库前先过一遍审核，判断该继续收录还是停下。',
      when: '向 Obsidian Wiki 收录资料前',
      outcome: '按知识库规则给出审核结论',
      condition: '需接通库内规则与完整原文；通过后继续收录',
      steps: ['接通当前知识库的审核规则', '完成收录前审核', '通过后交回收录流程；未通过则停止'],
      input: '准备收录的文章、链接、课程或文件，以及适用的 Obsidian Wiki。',
      evidenceNote: '2026-09-09 本机人工审校，入口依据真实库 knowledge-audit/SKILL.md 第4、14–18行。完整原文要求另据同日本机 adapter 第18行；运行时只核验此入口正文，未验证跨库规则或依赖是否可执行。',
    },
  },
};

const STRING_FIELDS = ['title', 'value', 'when', 'outcome', 'condition', 'input', 'evidenceNote'];
const KINDS = new Set(['reviewed', 'excerpt', 'missing']);
const HTML_TAG = /<\/?[a-z][^>]*>/i;
const hasPlainString = value => typeof value === 'string' && !HTML_TAG.test(value);

function validCopy(copy) {
  return copy !== null && typeof copy === 'object' && !Array.isArray(copy)
    && KINDS.has(copy.kind)
    && STRING_FIELDS.every(field => hasPlainString(copy[field]))
    && Boolean(copy.title.trim() && copy.value.trim() && copy.evidenceNote.trim())
    && Array.isArray(copy.steps) && copy.steps.every(hasPlainString);
}

function cloneCopy(copy) {
  return { kind: copy.kind, ...Object.fromEntries(STRING_FIELDS.map(field => [field, copy[field]])), steps: [...copy.steps] };
}

function fallback(skill, reason = '') {
  const title = typeof skill?.name === 'string' && skill.name.trim() ? skill.name : '未命名 Skill';
  const description = typeof skill?.description === 'string' ? skill.description.trim() : '';
  // Only carry an already short, complete original description. Taking the
  // first 80 characters or dropping later sentences can remove a condition or
  // turn an internal instruction into an unsupported capability promise.
  const excerpt = description && [...description].length <= 80
    && hasPlainString(description)
    && !/[\r\n`]|(?:^|\s)#{1,6}\s|\[[^\]]+\]\([^)]*\)/.test(description)
    && /[。！？.!?][”’"'」』）)]*$/.test(description);
  return {
    kind: excerpt ? 'excerpt' : 'missing', title,
    value: excerpt ? description : '这张卡的能力说明还在整理。',
    when: '', outcome: '', condition: '', steps: [], input: '',
    evidenceNote: `${reason}${excerpt ? '原说明摘录，未作人工能力讲解或运行效果验证。' : '暂无匹配的人工讲解，也没有可直接采用的完整短说明；未自动概括长文。'}`,
  };
}

/** Synchronous display accessor. Existing copy must already satisfy the plain-text shape. */
export function getCardCopy(skill) {
  return validCopy(skill?.cardCopy) ? cloneCopy(skill.cardCopy) : fallback(skill);
}

/** Verify complete document identity and content before selecting human-edited copy.
 * Never trust recordedContentHash, document-provided hashes, or cached cardCopy.
 */
export async function reviewCardCopy(skill, document) {
  const candidate = typeof skill?.name === 'string' && Object.hasOwn(REVIEWED, skill.name) ? REVIEWED[skill.name] : null;
  if (!candidate) return fallback(skill);
  if (typeof skill?.id !== 'string' || !skill.id || document?.skill_id !== skill.id
      || document?.truncated !== false || typeof document?.content !== 'string' || !document.content.length) {
    return fallback(skill, '未取得身份一致的完整正文。');
  }
  if (!globalThis.crypto?.subtle) return fallback(skill, '当前环境无法核验正文指纹。');
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(document.content));
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (sha256 !== candidate.sha256) return fallback(skill, '正文版本与人工审校版本不符。');
    return cloneCopy(candidate.copy);
  } catch {
    return fallback(skill, '正文指纹核验未完成。');
  }
}
