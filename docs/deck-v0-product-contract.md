# Card Master 牌组 v0 产品合同

## 定义

牌组是：**围绕一类真实工作，把 Skill、阶段顺序和监督检查点组织成一张可理解、可质疑、可交给 Agent 的工作结构。**

牌组回答“这类工作需要哪些能力、何时使用、哪里缺失、何时停止”。它不回答 Skill 存在哪里，也不直接改变 Agent 可见性。

牌组与技能库整理是并列产品区域：整理负责查重、格式、来源和投放健康；牌组只消费已纳管 Skill，负责工作组合与策略。整理不得生成牌组，牌组不得冒充整理结果。

## 与上游对象边界

| 对象 | 定义 | 是否复用为牌组 |
|---|---|---|
| Preset | 一组 Agent 投放期望状态 | 否。未来可作为牌组的“投放”动作，但不是牌组本身 |
| Tag | 用户自定义检索标签 | 否。可辅助搜索候选，不表达流程或监督关系 |
| Project | 本地工作路径与项目内投放范围 | 否。可成为一次牌组运行的上下文，不定义牌组 |
| Process | 工作阶段与顺序 | 复用概念，不复用旧数据结构 |
| Deck | 阶段 + Skill 槽位 + 监督检查点 + 停止线 | 新增独立产品对象 |

## Vibe Coding v0

首始牌组使用五阶段、十张卡：

1. 理解问题：`brainstorming`、`investigate`
2. 收敛方案：`gstack`、`plan-eng-review`
3. 小步实现：`design-html`、`test-driven-development`
4. 监督纠偏：`IPO Scope Check`、`adversarial-review`
5. 验证交付：`design-review`、`ship`

`IPO Scope Check` 是牌组内置监督检查点，不伪装成 Skill：Input 是否充分；Process 是否最小；Output 是否可验证；现在能否停止。

## v0 边界

- 内置牌组只读匹配真实 managed Skill；同名多项显示冲突，缺少显示缺口。
- 用户可以描述工作目标，由本机 Codex / Claude Code / Hermes 从当前技能库元数据生成牌组；返回的每张牌必须引用真实 Skill ID。
- AI 生成结果先保存为可审查的牌组 metadata；不得发明 Skill，不得写 Skill 内容，不得自动改变 Agent 投放。
- 不新建 Skill，不修改 Skill/Harness，不自动投放。
- 不把全牌组常驻 Agent Prompt；用户只在本次工作需要时复制结构化指引。
- 不先做工作流运行时或自动编排；自定义牌组暂存既有 settings store，不为 V0 新增通用 Deck schema。
- 第一验收：一屏能看见 8–10 张卡；用户能在 30 秒内回答“流程是什么、有什么、缺什么、哪里监督过度工程化”。

## 下一步门

先用 Vibe Coding 实际任务验证。若结构帮助用户形成判断，再新增：

1. 从技能库添加/替换槽位；
2. 保存用户改版；
3. 选择 Agent 投放方案；
4. 运行记录与复盘。

若它只是静态收藏夹，停止扩建。
