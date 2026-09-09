# 场景卡合同 v1

## 决定与边界

场景卡的稳定单位是一个能由用户辨认、能以完整任务结果衡量的工作场景。一张卡对应一个稳定 `sceneId`；它汇集完成该场景所需的 Skill、资料、检查点和已知缺口。底层 Skill 及其摘要是可复用材料，不自动各自变成卡，也不应因库存有数百项而批量制卡。

- 同一 Skill 可被多个场景引用，引用不改变该 Skill 的来源、投放或自身摘要。
- 归类证据不足时保留为待归类材料，不自动创建“泛用”“其他”或新场景卡。
- 新内容若仍服务同一任务目标，补入原 `sceneId` 并更新原卡；只有任务目标独立、成功标准不同，才创建新场景。
- 不新增 rating engine、批量 AI pipeline 或通用工作流运行时。先让少量用户可读、可核验的场景卡闭环。

场景不是目录、Tag、Preset 或 Agent 投放状态。它表达“为了完成什么工作，如何组织能力并以什么证据判断结果”。

## 场景身份与卡片材料

`sceneId` 必须复用 Skill Manager 已有的持久 ID（当前正式格式为 `scene-<hash>`）；不得在制卡时按名称或当前成员重新生成。创建后不因新增成员、文案润色或美术迭代变更。下面的可读 ID 只用作独立 prompt 示例；实际运行须传正式 ID。名称变更必须保留原身份。

一张可生成的场景卡只需要下列最小输入，不建立冗长 schema：

```text
sceneId: validate-product-hypothesis
purpose: 为一个产品假设收集并评估足以决定下一步的证据
taskBoundary: 从提出假设到给出继续、调整或停止的建议
skillMaterials:
  - { skillRef, groundedSummary, sourceRefs }
  - { skillRef, groundedSummary, sourceRefs }
contentMaterials: [用户提供的项目背景、调研记录、已有产物]
gaps: [尚未取得目标用户证据]
resultEvidence: [访谈记录、验证结论、可复核决策]
reviewStatus: unreviewed | reviewed
sceneGrade: 未审 | 凡 | 灵 | 天 | 圣
```

`groundedSummary` 复用 card-copy 的来源、范围和缺失约束。它只说明一个方法能提供什么，不可代替场景完成证据。若材料未读全、来源失配或仅有宣传性描述，保留原文摘录 / 待整理状态；不要以流畅文案补全。

## 场景评级与视觉

评级对象是“该场景完成其任务目标的整体方法与结果证据”，不是成员数量、成员 Skill 的平均等级或最高等级。一个高等级成员不能抬高没有结果证据的场景；多个成员也不能靠数量加分。未审场景一律显示“未审”，不得从名字、美术、卡片复杂度或成员等级授级。

沿用既有视觉含义，并保持它们与个人能力无关：

| 标记 | 场景卡的独立视觉表达 |
| --- | --- |
| 凡 | 完整、精炼的普通装备，有一个清楚功能。 |
| 灵 | 可读的内部机制或方法路径。 |
| 天 | 装备对场景条件作出可见回应，具有明确结构与空间。 |
| 圣 | 装备与该场景的领域形成表达关系；领域可继续迭代。 |

凡、灵、天、圣是场景方法及证据的审核标记；美术风格是独立轴。品阶不是持卡人、团队成员或 Agent 的能力标签。圣的领域可以随场景理解和成果演进，但视觉演进不重复授予、撤销或自动升级标记。

## 场景卡文案

卡面从场景目的写起；背面说明能力组成、适用边界、当前缺口，以及已经取得的结果证据。不要把成员列表改写成能力宣称，也不要把计划、建议、分析说成已完成任务。

```text
你是场景卡编辑。根据给出的场景材料，输出一张场景卡的 JSON，不输出 Markdown。

卡片单位：一个稳定 sceneId 对应一张卡。Skill 与内容材料是该卡的组成，不分别生成卡；同一 skillRef 可在其它 sceneId 重复引用。材料归类不足时，在 gaps 或 pendingMaterials 说明原因，不得自动造新 sceneId。

写作：
- front.name 与 front.value 说明场景目的和选择价值。
- back 用短句说明：完成任务需要怎样的能力组成、当前缺口、以及已有结果证据。未发生的结果必须写成待验证或不写。
- details 说明任务边界、成员如何协作、输入、产物、证据和下一步；引用 Skill 时只复用已经有来源依据的摘要。
- 新材料仍服务同一 taskBoundary 时更新该 sceneId；目标独立且成功标准不同才建议一个新 sceneId。

真实性与评级：
- 不编造来源、数值、自动化、任务结果、个人能力或等级。
- sceneGrade 只照录 evidence-backed review；reviewStatus=unreviewed 时 sceneGrade 必须为“未审”。
- 不以 Skill 数量、平均等级或最高等级计算场景等级。
- 没有结果证据时明确 evidenceStatus=insufficient，不把完善计划写成完成。

美术联动：
- 输出 artDirection，供 holo-card-studio 选择性使用：equipment、domain（圣时可用）、relation、styleRecipe。
- 不要求为每个成员 Skill 单独生成图；默认只为场景卡生成一张静态主视觉。分层、动效或 3D 仅在明确请求后交给 holo-card-studio。
```

建议输出保持小而可核验：

```json
{
  "sceneId": "validate-product-hypothesis",
  "copyStatus": "grounded",
  "reviewStatus": "unreviewed",
  "sceneGrade": "未审",
  "front": {"name": "产品假设验证", "value": "把下一步建立在可复核的用户证据上"},
  "back": {
    "purpose": "判断产品假设是否值得继续投入",
    "composition": ["定义假设", "收集用户证据", "审视结论"],
    "gaps": ["尚无目标用户访谈"],
    "resultEvidence": []
  },
  "skillRefs": ["business-coach", "knowledge-audit"],
  "evidenceStatus": "insufficient",
  "artDirection": {"equipment": "可校准的取证罗盘", "domain": null, "relation": "指针只指向已验证的路径", "styleRecipe": "adventure field-guide"}
}
```

这不是运行时数据模型；它是生成与审核一张卡所需的最小交换格式。产品落地前仍须以真实来源、真实场景边界和可复核结果验证。
