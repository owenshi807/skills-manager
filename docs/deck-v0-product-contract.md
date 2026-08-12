# Card Master 牌组 v0 产品合同

## 定义

牌组是：**围绕一类真实工作，把 Skill、阶段顺序和监督检查点组织成一张可理解、可质疑、可交给 Agent 的工作结构。**

牌组回答“这类工作需要哪些能力、何时使用、哪里缺失、何时停止”。它不回答 Skill 存在哪里，也不直接改变 Agent 可见性。

## 与上游对象边界

| 对象 | 定义 | 是否复用为牌组 |
|---|---|---|
| Preset | 一组 Agent 投放期望状态 | 否。未来可作为牌组的“投放”动作，但不是牌组本身 |
| Tag | 用户自定义检索标签 | 否。可辅助搜索候选，不表达流程或监督关系 |
| Project | 本地工作路径与项目内投放范围 | 否。可成为一次牌组运行的上下文，不定义牌组 |
| Process | 工作阶段与顺序 | 复用概念，不复用旧数据结构 |
| Deck | 阶段 + Skill 槽位 + 监督检查点 + 停止线 | 新增最薄只读产品对象 |

## Web Coding v0

首始牌组使用五阶段、十张卡：

1. 理解问题：`brainstorming`、`investigate`
2. 收敛方案：`gstack`、`plan-eng-review`
3. 小步实现：`design-html`、`test-driven-development`
4. 监督纠偏：`IPO Scope Check`、`adversarial-review`
5. 验证交付：`design-review`、`ship`

`IPO Scope Check` 是牌组内置监督检查点，不伪装成 Skill：Input 是否充分；Process 是否最小；Output 是否可验证；现在能否停止。

## v0 边界

- 只读匹配真实 managed Skill；同名多项显示冲突，缺少显示缺口。
- 不新建 Skill，不修改 Skill/Harness，不自动投放。
- 不把全牌组常驻 Agent Prompt；用户只在本次工作需要时复制结构化指引。
- 不先做通用 Deck DB、编辑器、运行时或自动编排。
- 第一验收：一屏能看见 8–10 张卡；用户能在 30 秒内回答“流程是什么、有什么、缺什么、哪里监督过度工程化”。

## 下一步门

先用 Web Coding 实际任务验证。若结构帮助用户形成判断，再新增：

1. 从技能库添加/替换槽位；
2. 保存用户改版；
3. 选择 Agent 投放方案；
4. 运行记录与复盘。

若它只是静态收藏夹，停止扩建。
