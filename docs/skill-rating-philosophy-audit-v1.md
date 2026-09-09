# 卡牌大师：哲学审计与自身知识库评级参照 v1

日期：2026-09-09。对象：Skill 的方法与成就。本文为评级示例和独立审计结论，**不代表已经给管理器中的某张卡发奖，也不对用户本人评级**。

## 1. 核心判断

采用 C 基础、R 成法、SR 通理三个常规等级；SSR 隐藏，认可一次已经进入 Skill 的方法突破，并永久保留。详见 [生效基础规则](skill-rating-foundation-v1.md)。

“更高级”应当能回答：它比此前多做出了哪一种有效判断？这项判断在哪个实例中改变了行动？更长的文本、更多工作流节点、更炫的理论名称和更多测试通过数，都不能自行回答这个问题。

四个关键区分：

- **方法与人：** 持有会做的工具，不等于人已经会做。人的能力评估属于未来独立 Profile 库。
- **突破与稳定性：** 一次突破可以确实发生，而跨任务稳定性仍待验证；SSR 记录前者，当前场景评估检查后者。
- **洞见与发布：** Shadow 是知识发布权限与状态，不是思想价值评分；未写入 canonical 不能反推没有 Skill 方法突破。
- **本地方法与行业位置：** 本地升级不等于全球原创。外部排名需要明确对照和证据，不能从作者名气或系统复杂度推导。

## 2. 《高手的黑箱》提供了哪把尺子

本轮读取的是用户知识库中的课程 source 摘要与概念整理，未将其冒充完整课程逐字原文。“评价”章节没有独立完整原文依据，因此不引用不存在的课程结论。以下等级映射是卡牌大师的产品推论。

| 知识库依据 | 转成 Skill 评价时意味着什么 |
|---|---|
| 导论把品味落在论证、洞见、注意力，并强调比照、识别落差、改进 | SR 必须能指出具体哪里更好、哪里应删、下一步怎么改；不能只说“更全面” |
| 导论强调质量判断和过程全局把控，知道何时结束 | 停止追查、缩短交付也能是高质量判断，复杂不自动高级 |
| 理解并非仅记住；分析既可以使用知识，也可以产生新知识 | 流畅摘要不是理解证明，概念连线不是创造证明 |
| 高阶建模要压缩决定性关系，再解压为工具并回到实践 | SSR 原则必须进入可调用的方法；取一个名字不算突破 |
| 全景指出分析框架与真实非线性创作有区别 | 不把 ingest→distill→collision 当作必然逐级成仙的流水线 |

证据：[导论的知止与品味](/Users/owen/Sync/Obsidian-Wiki/知识库/wiki/sources/2026-04-14-高手的黑箱-导论：创作中最重要的事.md:44)、[理解](/Users/owen/Sync/Obsidian-Wiki/知识库/wiki/sources/2026-04-16-高手的黑箱-3-理解：深度理解，穿透复杂.md:21)、[分析](/Users/owen/Sync/Obsidian-Wiki/知识库/wiki/sources/2026-04-16-高手的黑箱-4-分析：像哲学家一样解析事物.md:52)、[高阶建模四步法](/Users/owen/Sync/Obsidian-Wiki/知识库/wiki/concepts/一堂课程体系/个人地图/迭代层/高阶建模/高阶建模四步法.md:33)、[全景的非线性边界](/Users/owen/Sync/Obsidian-Wiki/知识库/wiki/concepts/panoramas/高手的黑箱-全景.md:215)。

## 3. 先校正 Karpathy 的参照

Karpathy 的 LLM Wiki 原始方案已经包含 Raw/Wiki/Schema、持续综合、关联与矛盾维护，以及 ingest/query/lint 活动。不能把它压成“只把资料放进文件夹”，再把我们增加综合功能写成原创跃迁。[原始 LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)

按方法结构作解释，它已经适合用作“R 成法”的参照；若某个具体实现能可靠辨别来源、冲突与适用边界，可以继续评 SR。原始 gist 是方法提案，未提供本产品场景协议下的实测，因而这里没有正式给它发 R/SR，也没有证明它高于多少市售产品。

我们早期 [“知识库作为思考发生的场地” Question](/Users/owen/Sync/Obsidian-Wiki/知识库/wiki/questions/app-3.0/knowledge-management-as-thinking-venue.md:104) 对该起点的描述偏窄；本文纠正使用方式，未修改这份历史探索记录。它的记录/检索/分析/组织与评价/创造缺口仍可启发问题，但不能作 2026 年 9 月的工程状态。

## 4. 用我们自己的链路看各级差异

以下是**方法层的评级参照**。从文档推断的能力与实际测评证据分列，避免把“有某个模块”直接换成等级。

| 自身案例 | 用它理解什么层次 | 真正新增的判断 | 证据与限制 |
|---|---|---|---|
| 原件入库、基础摘要、能检索 | C 到 R 的分界 | 从保存资料走向可复用的编译、检索与交付方法 | C 是基础入口，不按时间先后给原始系统贬级 |
| Ingest → Audit → Distill → source publication / completion | R 的典型参照 | 分清原件、审核、蒸馏稿与已发布产物；能恢复、能追溯 | 真实课程有 publication 与 completion 记录；证明内容链闭合，不证明创造新知识 |
| Distill 的选择与压缩；Query 的条件路由、原文重开和反证保留 | SR 的典型参照 | 判断什么决定当前结论、何时沿关系找、何时返回来源、何时停止 | 局部方法与实测分别存在；不把工程链完整等同于判断质量 |
| Collision 的第三对象、双侧消融、后果与可推翻条件 | SR 方法中寻找 SSR 的机制 | 区分“两个概念相似”与“二者共同产生一个新增可用原则” | 有候选和独立筛选；当前 Shadow，不等于所有候选已成立或已进入长期知识 |
| Epistemic Dependence Lens 的条件判断改造 | **SSR 资格审计示例：方法突破成立，尚未发牌** | 分清情境判断与机械保证，纠正“重要原则必须全量字段化”的前提 | 已进入知识库的共享规则和多个 Activity，存在对照与回归；不扩张为全库或个人 SSR |
| 能持续产生、迁移并修订新方法，连问题选择和评价前提也接受现实纠正 | SSSR 的远期思想参照 | 方法生成方式本身可修正 | 当前证据不足；不创建产品级别，也不把未来研究自动排入开发 |

真实 Ingest 闭环例：[一堂 AI 知识管理课程 publication](/Users/owen/Sync/Obsidian-Wiki/知识库/wiki/.distill/publications/2026/distill-request-20260819-yitang-ai-knowledge-management-exploration-1.json:1) 与 [completion](/Users/owen/Sync/Obsidian-Wiki/知识库/wiki/.distill/course-completions/2026/yitang-ai-knowledge-management-exploration-1.json:1)。

当前生效状态以 [runtime config](/Users/owen/Sync/Obsidian-Wiki/知识库/.claude/schema/distill-v2-runtime.json:4) 与 [模块状态](/Users/owen/Sync/Obsidian-Wiki/项目库/projects/obsidian-wiki/modules/semantic-governance/_status.md:16) 为依据：`collision_release_mode=shadow`、`semantic_auto_accept=false`。本轮只读核查未找到 applied receipt 目录；不能把候选写成已进入长期知识的第三对象。模块页 frontmatter 停留在 8 月，但正文含 9 月更新，本报告采用具体条目而非仅看 frontmatter 日期。

### 为什么“检索更强”还不够自动升级

项目记录中的 18 题 KPM 盲测显示，证据召回从 30.6% 提升到 100%，但答案评分仅从 176/180 到 179/180，只有 3/18 strict wins，未通过预注册的答案增益门。这是有价值的检索改进，不能直接称为判断能力突破。[盲测状态记录](/Users/owen/Sync/Obsidian-Wiki/项目库/projects/obsidian-wiki/modules/semantic-governance/_status.md:26)

同样，商业方法图 v0.8 的 14 个任务，盲答要点从 39/57 到 50/57，支持特定方法优先级、上下游和跳步阻断的价值。后续 v0.12 检索通过而端到端仍 NO-GO，进一步说明“多找到关系”与“实际会用关系”是两项能力。这些是历史项目证据，本轮未重新运行，也不外推全商业领域。[商业方法图与后续限制](/Users/owen/Sync/Obsidian-Wiki/项目库/projects/obsidian-wiki/modules/semantic-governance/_status.md:75)

## 5. 一张具体的 SSR 突破参照：依赖镜头

**拟议成就名：会分辨的依赖治理。**对象是承载共享 Epistemic Dependence Lens 的 Skill 工作法或明确组合；不是 Owen，不是整个知识库，也不是所有参与过讨论的 Skill。此处给出授奖理由示范，尚未映射管理器中的确切卡片和发放记录。

本节“已生效”“已接入”“系统保证”均指本机 Obsidian-Wiki / semantic-governance 的规则与历史实施证据，不能解读为卡牌大师 App 已实现该方法、评级或授奖。

### 旧方法与新原则

旧方案把“原则必须影响行为”推进成“每项原则都要变成强制字段、检测器或常驻流程”。这样把关系判断伪装成固定属性，并给无关任务增加审查负担。

新原则是：**共同信念进 Prompt，高代价不变量进机械门禁。**模型在具体任务中判断依赖何时影响结论；系统保证原件、locator、版本和写权限等可客观检验的边界。专用工具须由真实失败证明必要性。[设计记录](/Users/owen/Sync/Obsidian-Wiki/项目库/projects/obsidian-wiki/modules/semantic-governance/raw/2026-08-29-dependency-governance-as-shared-constitution.md:35)

它重新定义了治理目标：重要中介失效后，仍能重开证据、修正判断、退出中介、接近对象。于是“什么都查”不再是理想结果，“该查的查、无关时安静、硬边界可靠”成为方法。[目标与三层分工](/Users/owen/Sync/Obsidian-Wiki/项目库/projects/obsidian-wiki/modules/semantic-governance/raw/2026-08-29-dependency-governance-as-shared-constitution.md:48)

### 看得到的差别

下表第一项是冻结旧工作法中的行为；其余项说明新方法要防止的误判，不声称旧系统在每种情境都曾发生该错误。行为实例与机械边界的证据分别核验。

| 情境 | 旧行为或所要防止的误判 | 新方法的外部表现 |
|---|---|---|
| 一手材料已完整，无影响结论的依赖问题 | 仍强制输出五维合同 | 保持安静，无额外镜头话语、搜索或交付延迟 |
| 四篇报道共享同一个上游，另有独立反证 | 把多份材料误当多份独立佐证，或只有空泛风险提示 | 将四篇归为一个 evidence family，保留独立反证并给重开证据的路径 |
| 中介曾带来真实启发，但原文尚未取得 | 在否定来源与给来源过度背书之间摇摆 | 保留第一人称经验，限制归属推断，不推测用户心理或中介动机 |
| 准备把新结论写入长期知识 | 将“模型理解了理念”误当写入资格 | 继续执行证据、版本与发布权限边界 |

按 v1 的方法条件，这个案例符合 SSR 突破资格：它形成了**辨认何处需要情境判断、何处需要机械保证**的有效区分，且该区分已经改变知识库 Skill 的实际工作法。这是资格审计结论，未生成任何卡牌成就记录。取消所有门禁、改一句口号、单纯少输出一些字，都达不到同一判断。

### 证据强度和不能推出的结论

- 效果合同包含 4 个冻结案例：Standard、Boundary、Adversarial、Consumer，覆盖多个 Activity；Before 为冻结的 working-tree 旧行为，其中强制 Audit v3 是被否决的中间方案，不能称为“此前稳定生产版本”。[对照与案例](/Users/owen/Sync/Obsidian-Wiki/项目库/projects/obsidian-wiki/modules/semantic-governance/raw/2026-08-29-epistemic-dependence-lens-v0.1-effect-evaluation.md:43)
- 记录报告两次独立 fresh-context 行为复测与 110/110 runtime 回归。45→96 是五维 rubric 总分，**不是成功率、行业百分位或 SSR 门槛**；grader 记录不能证明是人工专家。[评分记录](/Users/owen/Sync/Obsidian-Wiki/知识库/.claude/skill-adapters/knowledge-audit/evals/epistemic-dependence-lens-v1.json:226)
- 原则已进入共享 schema 并接入 Audit、Ingest、Distill/Collision、Query、Panorama 的可复用工作法。[落地记录](/Users/owen/Sync/Obsidian-Wiki/项目库/projects/obsidian-wiki/modules/semantic-governance/raw/2026-08-29-epistemic-dependence-lens-v0.1-effect-evaluation.md:126)、[现行共享规则](/Users/owen/Sync/Obsidian-Wiki/知识库/.claude/schema/epistemic-dependence-lens.md:13)。
- 共享 Distill 文件同时包含另一项 Tension Compass 变化；本案例只归因于 lens 的断言，不能把其他改进一起计分。这里证明一次有边界的方法突破，不证明一般商业能力、全球领先、所有新版本有效或人的长期认知改变。

独立哲学审计判断上述设计与效果记录支持一次 Skill 方法层的 SSR 资格；事实核验确认知识库内实施与记录存在。实际产品授奖还需绑定持有这套方法的确切卡片，当前无发放记录，不能批量把库内卡片全部改成 SSR。

## 6. 商业场景：同一问题，怎样看出不同层次

示例问题：“要不要做这项获客活动？”以下是依据知识库商业材料抽象的评级示例，不是对一个真实项目的经营建议，也没有正式给 `business-coach` 评级。

| 等级参照 | Skill 给出的判断 | 审美落差 |
|---|---|---|
| C | 能列投入与回报，或引用 ROI 模板；尚未证明方法完整 | 有没有关键遗漏，结果能不能检查？ |
| R | 纳入技术、运营、设计等完整成本；统一口径，列不确定项，形成可复用比较 | 方法是否完整可用，而非只看到显眼成本？ |
| SR | 判断瓶颈是渠道、转化、复购还是窗口；识别机会成本；按决策重要性控制分析深度 | 同样的数字，在不同条件下为何应有不同动作？ |
| SSR | 某次发现原来比较“渠道便宜与否”的框架遮蔽了真正约束，形成新的可用模型，并通过实例改变资源分配或实验设计；新模型已进入 Skill | 有没有一次实质方法突破？不能把“换个问题问”这句话直接当证据 |

R/SR 的参照来自知识库中“完整成本→先建模型→打磨投入产出”的案例，以及机会成本、时间窗口和分析深度匹配重要性的原则。SSR 一行是待具体实例支持的示意，不声称课程或我们的现行 Skill 已完成这次商业突破。[科学决策审美篇](/Users/owen/Sync/Obsidian-Wiki/知识库/wiki/sources/2026-05-14-全员必修-科学决策审美篇.md:41)

“更本质”的可观察含义是：抓住的关系改变了选择，并明确哪些情况不应照用。术语更玄、图更大、分析更久，都不构成更本质。

## 7. 哲学 AI 的审计角色

本轮以独立 Agent 承担该角色；以下是可复用的角色约束，尚未额外安装一个新 Skill 或创建常驻 Agent。

> 你审阅的是 Skill 方法突破。先重开旧方法、变更和实例，指出新增的有效区分。检验它是否改变现实判断，是否进入可调用方法，是否保留边界与可修正性。用一个好坏对照解释成就。单次成立即可认可 SSR，不要求用户学会或持续产出突破。不要以名人、抽象词、数量、复杂度、分数代替判断；不要把审计结论自动写成奖章、个人画像或 canonical 知识。

角色输出保持简短：所评对象；突破成立/证据不足及具体理由；一个前后对照；边界；证据入口。哲学角色不能取代算术、来源、权限与身份核验，也不负责给人诊断“是否悟道”。

## 8. 决策记录与独立 Scope Gate

用户通过 Grill me 明确：SSR 属于 Skill，一次突破永久解锁；当前 Skill Card 库与未来 Profile 库分离。此前审计中“重复表现才授 Skill SSR”的要求已被这项用户决策取代，不保留为隐藏条件。

独立 scope audit 在首次规范写入前给出 `pass_with_deferrals`：评级规范、案例与 v0 澄清属于用户目标；生产实现、Profile、知识库写入、实际授奖继续延期。审核对 `.planning` 记录提出条件性延期；用户 AGENTS 已明确要求多步骤任务清单及偏好写入记忆，本轮仅据该直接授权更新既有项目任务/决策记录，没有新增常驻记录系统。

本轮只读知识库，不执行 ingest、distill、知识发布、用户画像修改或原文纠错写回。证据链接指向本机知识库，未复制整份私人来源进应用仓库；本地产品文档包含完成本任务所需的摘要，尚未推送。
