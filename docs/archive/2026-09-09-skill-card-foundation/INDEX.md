# Skill Card Foundation、品阶与 Portal 研究归档索引

归档日期：2026-09-09。研究冻结基线：`5d8b3d6bbe8e25a13b05df6c308bd10b0cdd3b0b`（2026-09-09 17:18 +08:00）。本索引建立于第一版 Portal 移植期间；当时正式 Portal 的集成验收尚在进行。

这里归档的是定位关系与历史状态：原文、原型、生成图、Blender/GLB 与验证证据留在原路径，没有复制大型资产或移动目录。表中 commit 是该入口在冻结基线之前的最近修改提交，不代表该目录内每个资产都出自同一提交；原文件之后可以继续更新，复核历史时使用该基线或表内 commit。

## 当前生效边界

- Skill Manager 保持默认 SaaS 界面；用户点击 Portal 后进入完整游戏 UI，返回恢复原页面。SaaS 在本阶段指交互形式，不代表新增云托管凭据服务。
- 普通库与游戏装备袋共用一份受管 Skill ID、来源版本、部署事实和评审记录。探索样卡属于演示，不与真实 Skill 自动合并、不凭动画授奖。
- 评级对象是 Skill；C/R/SR 为常规等级，SSR 是已核实的一次方法突破所形成的永久成就。凡、灵、天、圣是装备的视觉表达，未来个人 Profile 独立。
- 产品只管理当前账号拥有的 Agent 装备；外部 Agent 是对方授权的可调用服务，其装备由对方维护。服务端管理员权限不扩大本产品的操作范围。
- Multica 的真实只读连接已验证；装备写入、Skill 导入和新任务执行未验收。历史 completed 记录不等于本轮执行成功，广场仍为后续范围。

上述边界的优先入口是[品阶规则 v1](../../skill-rating-foundation-v1.md)、[凡灵天圣绘图内核](../../skill-cultivation-visual-foundation-v1.md)和[Portal / Multica 综合结论](../../../prototypes/toy-wilds/research/README.md)。旧文档中的“当前状态”保留其撰写时含义，不能覆盖这些后续明确修订。

## Foundation 与产品对象

| 日期 / 最近提交 | 入口 | 归档时状态 |
| --- | --- | --- |
| 2026-08-11 · `1e1b394` | [Foundation 产品表面](../../foundation-product-surface.md) | 定义统一技能库、整理与投放的基础对象；后续 Portal 沿用同一受管库 |
| 2026-08-12 · `3a51132` | [牌组 v0 产品合同](../../deck-v0-product-contract.md) | 工作阶段、监督点与组合结构的早期合同；不是人物装备或执行成功证明 |
| 2026-08-23 · `f32d26f` | [Foundation 阶段总结](../../foundation-phase-summary-2026-08-23.md) | 1.28.5 阶段交付与发布证据；其签名/公证状态仅属于当时记录 |
| 2026-09-07 · `8504432` | [Agent management 整合](../../integration/agent-management.md) | Foundation 与上游 Agent 管理的兼容 / 整合依据 |
| 2026-09-08 · `d157b31` | [技能库、场景与 MCP 合同](../../integration/skill-library-scenes-mcp-plan.md) | 单库、场景、投放与 MCP 的前序范围及当时未验收项 |
| 2026-09-08 · `53def54` | [场景能力整合计划](../../integration/scenes-capabilities-merge-plan.md)、[普通 Code Review](../../integration/scenes-capabilities-ordinary-review.md) | 场景与受管库合流的实施和审核证据，供 Portal 复用正式数据链 |

辅助基础规范：[Skill 整理判断规范](../../skill-organization-judgment-spec.md)、[Skill 格式检测规范](../../skill-format-detection-spec.md)。它们保存身份、来源、证据与格式边界；不能从“相似”“同名”或“已部署”推断可删除、可授奖或已被 Agent 加载。

## 品阶、证据与绘图内核

| 日期 / 最近提交 | 入口 | 归档时状态 |
| --- | --- | --- |
| 2026-09-09 · `e0c78fb` | [评级 foundation v0](../../skill-rating-foundation-v0.md) | 已被 v1 取代；旧 U 卡、固定题量升级与个人成长规则不再生效 |
| 2026-09-09 · `0e2a288` | [评级 foundation v1](../../skill-rating-foundation-v1.md) | 当前基础规则；真实授奖与生产评级仍须独立实现 / 验收 |
| 2026-09-09 · `e0c78fb` | [哲学审计与案例参照](../../skill-rating-philosophy-audit-v1.md) | 方法突破的证据、反例、来源和 scope 记录；不是给用户或库内所有 Skill 发奖 |
| 2026-09-09 · `e0c78fb` | [开发题说明](../../benchmarks/skill-rating-v0/README.md)、[虚构 evidence packet](../../benchmarks/skill-rating-v0/market-research-seeds.json)、[验证脚本](../../benchmarks/skill-rating-v0/verify_seeds.py) | 开发 / 校准素材；目录中的 v0 是题集版本，分数不直接触发 SSR |
| 2026-09-09 · `0e2a288` | [凡、灵、天、圣 v1.1](../../skill-cultivation-visual-foundation-v1.md) | 固定品阶含义、开放器物和圣域创作；保留 v1 文件路径 |
| 2026-09-09 · `0e2a288` | [结构化视觉合同](../../visual-foundation/cultivation-contract.json)、[用户 Agent 主提示词](../../visual-foundation/agent-prompts.md)、[案例 prompt pack](../../visual-foundation/prompt-pack.md) | 审核、制图、同品迭代的参考合同；不是自动运行或自动授奖系统 |
| 2026-09-09 · `0e2a288` | [视觉与仪式系统 v1](../../skill-visual-system-v1.md) | 精灵冒险图鉴概念阶段与后续 3D 补充记录，作为方向演变资料保留 |

## 审核与制图 Skill

| 日期 / 最近提交 | 入口 | 归档时状态 |
| --- | --- | --- |
| 2026-09-09 · `b6062fd` | [skill-grade-review](../../../skills/skill-grade-review/SKILL.md)、[rating contract](../../../skills/skill-grade-review/references/rating-contract.md) | 评审 Skill 方法与证据，独立于画面；目录保留可用 Skill 源文件 |
| 2026-09-09 · `b6062fd` | [skill-card-forge](../../../skills/skill-card-forge/SKILL.md)、[art and evolution](../../../skills/skill-card-forge/references/art-and-evolution.md)、[production and 3D](../../../skills/skill-card-forge/references/production-and-3d.md) | 根据既有评审绘图与演变，可按需进入 3D 制作；不能由卡面反向推断品阶 |

本索引不复制或重新安装这些 Skill，不改变其工具调用、生成服务或授奖边界。

## 从概念图到可玩地图

| 日期 / 最近提交 | 入口与证据 | 归档时状态 |
| --- | --- | --- |
| 2026-09-09 · `f62c31f`（README） | [视觉概念与旧样机](../../../prototypes/skill-visual-system/README.md)、[验收记录](../../../prototypes/skill-visual-system/verification.md)、[概念图集](../../../prototypes/skill-visual-system/concepts.html) | 早期图集及 HTML/CSS 对照；未接生产评级 |
| 2026-09-09 · `d680e4e` | [3D 镭射卡制作说明](../../../prototypes/skill-holo-3d/README.md)、[验收记录](../../../prototypes/skill-holo-3d/verification.md)、[渲染报告](../../../prototypes/skill-holo-3d/renders/render-report.json) | Blender → glTF → Three.js 样卡与局部 SSR 神域；卡体有厚度，内部器物的贴图视差不等于完整体积模型 |
| 2026-09-09 · `b6062fd` | [四境 style lab](../../../prototypes/skill-style-lab/README.md)、[配方](../../../prototypes/skill-style-lab/recipes.json)、[资产来源与 hash](../../../prototypes/skill-style-lab/asset-manifest.json)、[清理记录](../../../prototypes/skill-style-lab/cleanup-report.json) | 同一装备的四种方向对比；用户选定 Bruno / 玩具旷野方向继续制作 |
| 2026-09-09 · `b96df74`（首次可玩） / `3792ab6`（真实库） | [玩具旷野 README](../../../prototypes/toy-wilds/README.md)、[过程与边界](../../../prototypes/toy-wilds/progress.md)、[美术方向](../../../prototypes/toy-wilds/art-direction.json)、[验证报告](../../../prototypes/toy-wilds/verification/report.json) | 独立 4185 原型：行走、拾取、实体卡、装备袋；原型验证不替代正式 Tauri Portal 验收 |

可复核脚本：[地图与卡片检查](../../../prototypes/toy-wilds/tests/verify.mjs)、[原型装备袋检查](../../../prototypes/toy-wilds/tests/inventory.mjs)。截图留在原型 `verification/`；资产与依赖留在原目录，不为归档重新下载或复制。

## Portal 与 Multica 调研及实际连接证据

| 日期 / 最近提交 | 入口 | 归档时状态 |
| --- | --- | --- |
| 2026-09-09 · `5d8b3d6` | [综合结论与自有 / 外部 Agent 边界](../../../prototypes/toy-wilds/research/README.md) | 本阶段主要接入合同：默认 SaaS、主动 Portal、自有角色配装与外部服务调用 |
| 2026-09-09 · `1498a21` | [Portal 代码级接入调研](../../../prototypes/toy-wilds/research/portal-integration.md) | 路由保留、生命周期、懒加载、Tauri 数据链与验收设计；其“尚未实施”对应研究冻结时点 |
| 2026-09-09 · `5d8b3d6` | [Multica 认证与权限源码研究](../../../prototypes/toy-wilds/research/multica-auth-permissions.md) | PAT / task token、workspace / Agent / runtime 权限、Plugin API 边界；写权限为源码推断，未发写请求 |
| 2026-09-09 · `5d8b3d6` | [早期 Multica 安装与接口核查](../../../prototypes/toy-wilds/MULTICA-INTEGRATION.md) | 保留 0.4.39 安装证据、三域身份和版本映射；早期连接失败已被下行成功探针覆盖 |
| 2026-09-09 17:11 +08:00 · `1498a21` | [脱敏连接证据](../../../prototypes/toy-wilds/research/connection-evidence.json)、[固定只读探针](../../../prototypes/toy-wilds/research/multica-readonly-probe.mjs)、[探针测试](../../../prototypes/toy-wilds/tests/multica-probe.test.mjs) | 1 workspace、10 Agents、16 Skills、24 runtimes（18 online）、抽样 7 个启用绑定及 85 条历史 run；均为该次读取快照，不写死为产品事实 |

真实读取与源码推断应分开使用。登录和资源可见已经建立证据；本阶段没有通过装备写入、新任务端到端运行或结果验收。进一步执行需明确对象与范围，不以探针曾经成功或管理员权限替代产品授权。

## 后续实现接续点

第一版正式 Portal 的代码入口位于 `src/features/toy-wilds/`，归档建立时正在实施。正式库存使用 `readGameInventory()` → `getSkillLibrary()` + `getToolStatus()`，返回完整只读快照；任何读取或结构错误均由 UI 保留旧快照，不能回退成伪空库。该迁移不带入原型的 Node / MCP bridge 或 localhost HTTP server。

本次归档不变更评级规则、不授奖、不公开角色、不迁移用户数据、不调用 Multica 执行。未来广场、远端装备同步、任务派发和成长回流依各自的产品范围与验收推进。

## 后续开发落地

- [Portal v1 主程序交付](../../../prototypes/toy-wilds/PORTAL-V1.md)：默认工作台＋显式 Portal、同一 Skill 库的原生只读装备袋、地图样卡和完整返回；附浏览器与原生分层验收。
- [角色与独立卡库修订](../../../prototypes/toy-wilds/CHARACTER-CARDS-V2.md)：泉水/台座物理分层、按角色隔离的Skill卡片、四种角色族系和原生验证；含[所有权补充核验](../../../prototypes/toy-wilds/research/multica-owned-agent-probe.md)。

- [卡片能力讲解 v0.1](../../../prototypes/toy-wilds/CARD-COPY-V1.md)：三份真实范例、卡背精简标准、生成prompt与审校合同、本领手册及只读原文；未承诺全库已整理。

- 当前卡片单位更新：[场景卡v1](../../../prototypes/toy-wilds/SCENE-CARDS-V1.md)；以稳定场景为一张卡，底层Skill为组成材料。此前单Skill卡片/文案范例保留为历史，不继续全库逐项制卡。
