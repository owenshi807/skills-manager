# 知识库与笔记治理：场景评级

> 发布说明：下文的原始 MCP 快照 SHA 和解码正文行号对应本地保留原件。公开 `source-snapshot.json` 已裁剪为身份 fixture，未包含受管 Skill 正文；原始 `member-versions.json` 的 central path 也仅在本地保存。历史方法评测并未在本次冻结中重跑。

这个场景的核心链路已经能在不同情境下决定何时安静、何时重开证据，并把共同上游从“多份佐证”改判为一个 evidence family，同时保留可复核的硬门。当前等级为 **SR / 天**；“共同信念进 Prompt，高代价不变量进机械门禁”构成一次已进入该场景核心链路的实质方法突破，因此 SSR 为 **supported**，但本次审核没有把任何奖章写入产品。它只绑定 `scene-5dceda2d4cfc9a10` 中承载该链路的成员，不能外推到其余成员、整个知识库或任何个人。

## 结论范围

- **受评对象：** `scene-5dceda2d4cfc9a10`（知识库与笔记治理），快照时 22 名成员；`source-snapshot.json` 捕获于 `2026-09-09T13:49:17.326Z`，SHA-256 `a36676fe6d5ced74634c60cfc299afe264b5c72c81d005027d917ec2797852ed`。
- **受评方法：** `wiki → knowledge-audit → ingest → distill → query`，并在需要全景或关系导航时使用 `knowledge-panorama` 与 `relationship-feature-graph`；每个 router 都要求读取当前 Obsidian-Wiki checkout 的 canonical adapter/schema，不能以 router 自身的短文本替代规范。
- **确认参与的核心成员：** `wiki` (`d8b2607e…`)、`knowledge-audit` (`49822923…`)、`ingest` (`7973c503…`)、`distill` (`adcd6795…`)、`query` (`2c1c1cca…`)、`knowledge-panorama` (`6aec1885…`) 和 `relationship-feature-graph` (`280c9e1e…`)。它们的 Manager tree hash、快照 `content_digest` 与 central path 记录于 `member-versions.json`（SHA-256 `3ed368354436a9fe5d086e01334afc61b22fc6c5b9bf2ab30d2ae5944e4f8dbe`）；tree hash 与单个 `SKILL.md` 内容 hash 不混用。
- **未验证范围：** 场景的其他 15 名成员（含 Apple Notes、Notion、通用 Obsidian、课程抓取、GSD graph 等）是否参与这条方法、是否产生相同效果；全库泛化、未来版本、市场排名、个人能力，以及任意 collision 的长期 canonical 写入。

## 评级依据

### SR：可按情境选择、处理边界并停止

当前 canonical `ingest` 把 audit、raw、source、distill、relation review、publication/projection 与验证串成完成链，并规定只有会改变准入、归属、证据强度或收录范围的依赖线索才落入现有字段，不能额外制造五项合同（本地证据 K01；本地证据 K01）。`distill` 要求区分原作者/中介/Owen 的贡献，共同上游不得计作独立证据，并让独立 reviewer 在边界、反证和双侧消融失败时拒绝（本地证据 K02；本地证据 K02）。`query` 仅在中介依赖会改变结论时外显最小边界，未知独立性不能包装成独立确认，并在无 material delta 时保持沉默（本地证据 K03；本地证据 K03）。

这不是成员数量或文档复杂度换来的等级：SR 来自同一方法在 Standard、Boundary、Adversarial、Consumer 四种条件中展示的“停止/限域/重开/改计数”选择。版本化评估记录了两次独立 fresh-context 复测：一手研究情境没有五项术语、没有额外确认；共享媒体上游情境把四篇支持材料合并为一个 evidence family，并保留一份独立反证（本地证据 K04）。历史评测记录的 `110/110 PASS` 是版本化 runtime 回归，证明当时的机制 binding；本次没有重跑它，也不把分数当成等级门槛或市场比较。

### SSR：方法突破成立，但未保存

| 突破要件 | 核验结果 |
| --- | --- |
| 旧限制 | 旧工作法把“原则必须影响行为”错误地推成每个来源强制字段、检测器或常驻流程；冻结行为为 Audit 对所有新来源要求 schema-v3 `epistemic_contract`，其他 Activity 没有共同条件镜头。(本地证据 K05；本地证据 K06) |
| 新有效区分 | 共同信念进入 Prompt/判断上下文，高代价的 provenance、locator/hash、状态与 release 权限继续由机械门禁保护；专用工具须由真实 material failure 续费。(本地证据 K05；本地证据 K07；本地证据 K07) |
| 改变的判断/行动 | S 情境不再为完整一手研究增加 checklist；B 情境保留 Owen 的体验但限制中介解释；A 情境识别共同罕见错误与借来的第一人称经历；C 情境把四篇报道折叠成一个 family。评估记录还验证 fresh v2 能 publish/replay、fresh v3 在写入前被阻断、既有 published v3 严格 replay。(本地证据 K06；本地证据 K06) |
| 可用边界 | Lens 不是来源/人物评分、永久档案或新状态；`unknown` 不等于独立/安全；它不产生新的写权限。当前 runtime 仍为 `collision_release_mode: shadow` 且 `semantic_auto_accept: false`，所以不得把 candidate/shadow 当长期知识或本次成就的已保存记录。(本地证据 K07；本地证据 K08；本地证据 K09) |

### 版本与证据强度

- 当前直接读取并 SHA-256 核验：共享 Lens `f0ec1a77…d8455dc`；当前 Audit adapter `42776a0c…e0f2`；Ingest `0cf2ad46…4fe67`；Distill `6730129a…a8f2b`；Query `54bdcc49…1d54b`；Panorama `bdff56bc…cfb1e`；Wiki `383c238b…e0bf2`；runtime `a19dbf0e…08071`。这是本次 review 的当前规范证据。
- 历史 before/after 评估的 Lens 与 Audit hash 恰与当前文件一致；Ingest/Distill/Query/Panorama 在之后有版本演进，因此不可声称 2026-08-29 的所有实跑精确复现为今日的同一 bytes。评级据此将历史实验视为**该方法的受控行为证据**，并以今日 adapter 中仍可读的条件规则与硬门界定当前 scope。
- `semantic-governance/_status.md` 是放行状态入口，明示状态与 schema 不一致时取最严格状态；它还把 production smoke、全库泛化、默认生产图、廉价模型写入等列为未证明/未实施（本地证据 K09；本地证据 K09）。

## 绘图建议

主器物画成一盏**双光源的校准灯**：柔和的内灯照亮一张可重开、带 locator 的来源纸卷，外侧由金属卡尺和封蜡门闩守住 hash/权限边界；背景是四条汇流成一条的细水脉，旁边保留一条反向支流。不要画人物、奖章或全库图谱。


公开版以本地证据编号替代私有知识库地址；原始文档定位与全文核验记录保留在本地归档。上述方法摘要用于解释评级，未发布知识库源文档。
