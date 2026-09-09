# 场景卡首轮管线归档

本轮只完成两张真实使用场景的识别、证据评级与卡面原画接入。稳定标准是：**每张完成度达标，等级决定器物机制和它与世界的关系，而不是画面是否更精细。** 本轮是两条有证据的试点评审与制卡记录，尚未实现全库自动评级或永久奖章写入服务。

| 真实场景 | 场景 ID | 当前评级 / SSR 状态 | 卡面与视觉表达 |
| --- | --- | --- | --- |
| 知识库与笔记治理 | `scene-5dceda2d4cfc9a10` | SR / `supported` | **溯源灵镜**：视觉按圣品呈现“审核支持”的方法突破；当前等级仍为 SR，永久奖章未写入。 |
| 商业项目推演 | `scene-36c2451fa91aad0e` | R / `not_established` | **试路罗盘**：灵品的可检查、可回退机制；没有 SSR 断言。 |

## 本轮管线与输出

1. **识别真实场景。** 使用正式 MCP 的场景/Skill 读取快照，而非按 Skill 自动发卡。公开版 [source-snapshot.json](source-snapshot.json) 仅保留场景身份、描述和成员 ID，[member-versions.json](member-versions.json) 仅保留版本匹配 metadata；不发布 26 份受管 Skill 的完整正文和本机 central path。原始两份输入保留在本地阶段归档与本地产品提交 `f099596`；公开文件记录原始 SHA-256。两份 review 中的原始输入 hash 和解码正文行号指向本地原件，不指向公开精简文件。公开回归只验证展示与版本匹配，不能独立重放私有知识方法评测。

2. **按场景范围审核方法、证据和边界。** [knowledge-review.md](knowledge-review.md) 与 [knowledge-review.json](knowledge-review.json) 只评知识治理的核心路由链，并把 SSR 约束为 `supported`，不等同于产品记录。 [business-review.md](business-review.md) 与 [business-review.json](business-review.json) 只确认三份可读取方法支持 R；一个 family 入口读取失败且没有端到端运行 receipt，因此不能升 SR，更没有 SSR。

3. **把评级翻译成视觉而非贴稀有度。** 知识场景用“三重开环、珊瑚重连、可重开水晶来源、同源支流与独立反证支流”表现方法与领域关系；商业场景用有刻度轨道、可移动标记、受阻路与低成本试验地图表现可检查的探索机制。原始艺术指令在 [knowledge-art-prompt.txt](knowledge-art-prompt.txt)、[knowledge-art-revision.txt](knowledge-art-revision.txt) 和 [business-art-prompt.txt](business-art-prompt.txt)。

4. **生成并修订原画。** 两张终稿均为内置 `image_gen` 生成的 1024×1536 原画：[知识场景](../../../public/scene-card-pilots/knowledge-sacred.png) 与 [商业场景](../../../public/scene-card-pilots/business-spirit.png)。知识首图品质高但偏写实，随后按 toy-world low-poly 的材质与尺度重绘；知识共两次调用、商业一次调用，合计三次图像调用，最终只覆盖这两个场景。

5. **接入卡面浏览器交互。** [scene-card-pilots.ts](../../../src/features/toy-wilds/scene-card-pilots.ts) 将两张图及已审核文字映射到稳定 scene ID；浏览器卡面遵循 holo-card-studio 的分层与交互约束，沿用产品自己的 pointer tilt 与 flip 实现。它实际是整张卡面图的 2.5D 呈现：本轮没有新增体积装备 `.glb`，没有真实晶体内动画，也没有声称图片本身是可拆分的三维资产。

## 已做与未做

两张卡均采用统一的精致 toy low-poly 语言：材质、光照、构图完成度对齐；等级只改变器物所承担的机制与世界关系。知识卡的圣品视觉只表达“本次审核支持一次突破”，不会把 SR 当前评级重写为 SSR，也不会创建个人奖章。

其余所有卡仍为**未评定、待绘制**。本轮没有全库生成、没有把成员评分继承给场景或其他 Skill、没有写入个人奖章、没有向远端 Agent 写入任何数据。

## 当前缺口与下一次最小验证

商业场景的 `business-coach-family` 家族入口在正式快照中读取失败，且该场景缺少一次真实的端到端输入、handoff、验证动作和观察 receipt。下一次先定位并接通该入口，再选一个真实项目走完整条推演链，保留判断、验证动作和实际观察。本轮只审核并记录这个缺口，没有修改受管 Skill 或替用户执行商业项目。

## 最终验收

18 项 Node 单测、场景卡 8 组、样卡 6 组、Portal 9 组通过；官方游戏动作客户端完成两轮地图输入。浏览器使用隔离身份 fixture，只验证产品交互，不替代真实 Skill 方法实跑。代表截图、浏览器结果及原生检查见 [verification](verification/report.json) 与 [native.json](verification/native.json)。

本机原生 App 已更新。实际查看确认两张最终原画、品阶、翻面、短能力说明与鉴定四格均可用；其他场景仍未评定。原始知识评测是历史证据，本轮没有将其宣称为重新运行。两张图是完整静态原画，镭射与轻转由鼠标驱动，不包含新的晶内时间动画。

本轮删除临时测试产物 6,389,068 bytes；保留最终原画、生成原始文件、prompt、审核依据及代表验收截图。
