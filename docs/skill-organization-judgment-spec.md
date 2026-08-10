# Card Master Skill 整理判断规范 v1

> 状态：Foundation 第一阶段的只读判断合同。它定义如何发现问题和形成建议，不授权修改、移动或删除 Skill。

## 1. 核心原则

1. **事实、判断、动作分层。** 名称、digest、来源和投影是事实；版本、分叉和能力重叠是判断；归档、合并和改名是动作。
2. **名称不是身份。** Skill 身份至少需要稳定的本地 ID；可靠血缘需要来源仓库、仓库内路径和 revision。
3. **内容相同不等于 owner 相同。** Digest 只能证明观测到的内容相同，不能证明谁拥有它、谁是上游。
4. **mtime 不是版本。** 文件时间和导入时间只能作为弱证据，不能单独确认新版。
5. **投放 Agent 不是上游 owner。** `.agents`、`.claude`、`.codex` 和 target tool 描述消费位置；除非有独立 provenance，不能据此推断作者或上游。
6. **语义相似不是删除证据。** Agent 负责提出可审计判断；真实淘汰需要行为评测或明确 lineage。
7. **当前阶段只读。** 所有输出都是 recommendation。Archive / Journal / Undo 完成前不得执行文件 mutation。

## 2. 固定检验方法

### Gate A — Format Health（确定性）

依据 Agent Skills specification 检查：

- 是否存在可读的 `SKILL.md`；
- YAML frontmatter 是否存在且可解析；
- `name` / `description` 是否存在且类型正确；
- `name` 是否满足 1–64 字符、小写字母/数字/连字符、无首尾或连续连字符；
- Agent-visible 目录名是否与 `name` 一致；
- `description` 是否超过 1024 字符；
- `compatibility` 是否超过 500 字符；
- `allowed-tools` 是否为字符串；
- 主 `SKILL.md` 是否超过建议的 500 行。

输出是 health issue，不参与重复判断。格式异常不得自动归档。

### Gate B — Artifact Integrity（确定性）

- 对完整目录使用有版本号的 strict directory digest；路径、文件内容、可执行位和 symlink 类型都进入证据。
- 无法完整枚举、读取或证明的目录为 `Unknown`，不得与任何项判等。
- strict digest 相同只产生 `exact_artifact_match`，后续仍需来源判断。

### Gate C — Provenance / Lineage（确定性优先）

证据从强到弱：

1. 同 repository + subpath，且 commit ancestry / immutable tag 可证明；
2. 明文 replacement 声明，或可验证的共同 base；
3. 严格内容包含关系与稳定来源线索；
4. 文件 mtime、导入时间、名称相同。

只有 1–2 级证据可以确认 `confirmed_newer_revision`。只有 3–4 级证据时最多是 `probable_newer_revision`，必须保留不确定性。

### Gate D — Variant Classification（Agent 辅助）

Agent 读取完整目录和 diff，将关系限定为：

- `confirmed_newer_revision`：可证明的同血缘后继；
- `probable_newer_revision`：像后继，但缺少可靠 revision/owner；
- `platform_variant`：核心意图与流程相同，差异主要是 Host 工具、路径、调用协议或兼容层；
- `user_customization`：存在共同基础，但加入了用户策略、质量门或领域内容；
- `different_purpose`：同名但解决不同任务；
- `exact_artifact_multi_source`：strict 内容相同、来源记录不同；
- `behavior_overlap_candidate`：名字可不同，但 trigger / 任务范围高度重叠；
- `needs_manual_compare`：证据不足或互相矛盾。

`platform_variant` 与 `user_customization` 必须分开。前者是同一能力的运行时实现，后者是能力或策略本身的改造。

### Gate E — Behavior Evaluation（评测）

只有 `behavior_overlap_candidate` 进入这一层。每个候选至少准备 3–5 个代表任务，覆盖：

- 应该触发；
- 不应该触发；
- 模糊边界。

先单独测试，再共存测试。记录：trigger precision / recall、抢触发、instruction following、输出质量和独有胜出场景。

- 一个 Skill 在共同任务上稳定占优，且另一个没有独有胜出场景：建议弃用较弱项；
- 两者互补：保留并收窄 description / trigger 边界；
- 结果随模型变化或不稳定：保留，标记继续评测。

### Gate F — Safe Action（后续写阶段）

任何真实动作必须先有 preview、precondition revalidation、archive、durable journal、crash recovery 和 undo。永久删除永不作为整理主按钮。

## 3. 证据与置信度合同

- `strong`：commit ancestry、immutable revision、明确 replacement、strict digest。
- `medium`：可验证共同 base、结构化 diff、仅 Host adapter 差异。
- `weak`：mtime、导入时间、名字、LLM 语义相似度。

规则：

- 缺少 strong lineage 时，不得输出“已确认新版”；
- 仅 weak evidence 时，置信度上限为 0.70；
- strict superset + 相同意图但无 lineage 时，最多输出“疑似新版”；
- 每个判断必须列出反证或仍需确认的问题；
- 置信度表示证据充分度，不表示语言模型的主观确信。

## 4. 79 组样本校准

Codex 首轮输出证明逐组阅读有价值，但不能原样成为 taxonomy：

- 72 组被迫落入 `local_customization`；其中约 71 组实际是 Claude/Codex 的 `platform_variant`，不是用户定制；
- 3 组 `newer_revision` 中，只有明文声明替代关系的一组可直接确认；另外两组缺少 Git lineage，应降级为 `probable_newer_revision`；
- 4 组内容几乎/完全一致但来自不同 Agent 位置，只能判为 `exact_artifact_multi_source` 或 mirror candidate，不能据 target tool 推断 owner；
- 所有接近 0.99 的置信度需要按上述证据上限重新校准。

这批样本验证的是分层方法，而不是原始五分类枚举。

## 5. 行业依据

- Agent Skills format 与 progressive disclosure：<https://agentskills.io/specification>
- GitHub CLI 的 source tracking、pin、tree SHA 与 dry-run：<https://cli.github.com/manual/gh_skill_install>、<https://cli.github.com/manual/gh_skill_update>
- Anthropic 企业 Skill 的 triggering / isolation / coexistence / instruction following / output quality 评测：<https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise>
- Skills Manager 的 keep mine / use remote / keep both、snapshot 与 restore：<https://github.com/xingkongliang/skills-manager>
- Agent Skills package manifest / lockfile 提案（非正式标准）：<https://github.com/agentskills/agentskills/discussions/210>
