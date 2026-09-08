# 场景与技能库整合：普通 Code Review

日期：2026-09-08

审核者：独立普通 Code Review context `/root/unified_code_review`。

结论：**通过。此次普通审核发现的 3 项问题全部关闭，当前已审范围没有未解决的 P0–P2 发现。**

## 审核范围

首次完整审核覆盖 `d157b31` 至当前实现的技能库治理迁移、场景与牌组合并、能力解释、场景内 AI 组合建议、保存重试、旧数据兼容及相关 Rust 修改，包括当时未跟踪的新源码与测试。后续仅复核发现修复及修复引入的恢复路径问题，没有重复整轮审核。

本次最终复核覆盖 `src/lib/sceneCustomCombinations.ts`、`src/components/SceneGoalComposer.tsx`、`tests/sceneCustomCombinations.test.ts` 的恢复操作 delta，并只读审核待发布 Codex Review Loop Skill 候选补丁。

## 发现闭环

| 发现 | 验证后的行为 | 状态 |
| --- | --- | --- |
| P1：整理已有场景会重新写归属，覆盖保存期间的手动排除及理由 | 已有场景只保存组合配置，不执行归属写入。新建场景导入持久化明确模式，重试通过 `set_assignment_with_preservation` 在 `RepoLock` 内保留既有归属和排除。 | 已关闭 |
| P2：从组合移除后仍作为补充能力进入可用组合及复制说明 | 手动排除与自动未选择项分开记录；可用能力及复制说明过滤明确排除，旧 Deck 排除得到保留。 | 已关闭 |
| P2：历史排除永久累加，移除全部后没有恢复入口 | 使用最新已完成的组合快照；排除列表提供“恢复到组合”，形成预览并在保存后生效。`restoredSkillIds` 可覆盖旧组合及旧 Deck 排除；再次移除会撤销恢复。全部排除后可恢复任意现有成员，再保存或生成。 | 已关闭 |

## 独立验证

最终执行：

```sh
node --test tests/sceneCustomCombinations.test.ts tests/sceneCapabilityGuide.test.ts
```

结果：18 项通过，0 项失败。其中 14 项组合测试覆盖只保存已有场景、失败重试、手动排除、全部移除、保存后恢复、旧 Deck 排除恢复及复制说明；4 项使用说明测试覆盖可用成员、跨场景过滤及检查语义。前两次审核分别独立运行了当时相关的 24 项及 16 项测试，均通过，并以纯内存依赖复现了原始缺陷。

最终审阅文件 SHA-256：

```text
f04bd80cfffcf102f74e4d836a2505f6adfe3eb485e0917763d25a4e2376bf5c  src/lib/sceneCustomCombinations.ts
fdbd031886375d437bfbc0941c18d30b391556fd497763f6137636edaaa38ae9  src/components/SceneGoalComposer.tsx
f9da050282ef5b078031645160f30e37e3fcd86238d7799aa58c6246e2d65e77  tests/sceneCustomCombinations.test.ts
```

## Codex Review Loop Skill 候选

审核文件位于 `/Users/owen/Projects/Skill_card_master/_local_backups/before-scene-combinations-20260908-135352/`：`review-loop-before.md`、`review-loop-reviewed-candidate.md`、`review-loop-proposed.patch`。

候选仅在原文件第 19 行后新增 10 行：要求先完成约定实现、统一普通审核、有效发现修复及验证，再启动外部 Review Loop；受管 Skill 修改使用 Manager 的稳定 ID、编辑、预览和发布流程，并核对部署所用来源。内容与用户指定执行顺序及权威来源闭环一致。

逐字节验证：移除这 10 行后，候选与原始文件完全一致。既有 Scope Gate、Proof Budget Gate 及其余全部条款未更改。候选补丁没有发现 P0–P2 问题。

```text
原始 SHA-256：de7d7d1f972d826b940c31731fa92c029fb76bbeede25224fe9f04679aa3a99e
候选 SHA-256：a36b68fa0c744617a5855f99163628a9481320e0e2419ee0158a7d4afebefc0c
```

本审核执行了本地源码审阅、纯内存测试和候选文件比较。未执行真实库写入、Skill 发布、外部 bot 审核或 PR 操作；正式 Review Loop 和发布结果需由后续真实工具回执记录。

## 真实验收发现后的增量复核

结论：**pass。以下两项后端补充修复及限定的归档索引修复脚本未发现 P0–P2 问题。此前 3 项已关闭发现保持关闭。**

此次只审实际验收暴露的两个缺口：MCP 读取重建中的临时路径，以及组合建议没有接收用户优先标记与 Skill 正文依据。未重新审核此前已通过的前端范围。

- `build_deck_inventory` 保留请求范围内全部稳定 Skill ID，增加真实优先标记、受限正文和截断标记。证据复用 `skill_scenes::evidence` 的已有根文件、符号链接和大小检查；总证据最多 120,000 个字符，单个优先项最多 4,000 个字符。Prompt 将正文作为不可信用途数据，明确普通审核、条件性最终复核等职责可以互补；没有改变权限或执行 Skill 内嵌命令。
- `replace_skills_from_metadata` 将活跃行删除、临时路径占位、最终 upsert、tags 更新放入同一个 SQLite transaction。同连接读者受互斥锁保护，其他进程只能看到已提交状态；任何错误使整个事务回滚。归档行不参与路径占位或活跃快照删除。
- 构建者报告 `cargo test --lib sync_metadata` 的 13 项测试通过，包括路径换位及归档保留、SQL 失败时路径/tags/删行整体回滚、独立 SQLite 连接并发读取不见占位路径；组合构建相关 13 项测试也已通过。独立审核逐项检查了这些新增用例与实现，本次没有重复执行构建者刚完成的相同测试。

### 限定的归档索引修复脚本

只读审核对象：`/private/tmp/skill-manager-restore-archived-paths.py`。此脚本仅将固定 8 个已归档 Skill 的占位 `central_path` 改回已有归档操作记录指向的目录；不改变归档状态、enabled、其他行字段、文件内容或部署记录。

已核对：默认不写入；`--apply` 先创建独占且权限为 0600 的 SQLite 备份，再在 `BEGIN IMMEDIATE` 中重新核验完整 8 行集合、Skill ID、当前占位值、归档状态、最新完成操作及其与既有备份完全一致的 payload。还验证目标目录、归档根边界和路径冲突。每行使用 ID、状态和旧路径作条件更新，并断言其他字段完全不变；任一失败回滚整个事务。

主执行者已运行默认只读预览。本审核读取 `/private/tmp/skill-manager-archived-path-repair-preview.json`，确认 `applied=false` 且计划仅包含固定 8 行。审核者未执行真实修复。后续应用仍必须遵守脚本注明的前提：停止旧 App/MCP 进程并安装已修复的 reindex 版本，避免旧版本再次写入占位路径。

本次增量审阅对象 SHA-256：

```text
498cddecfb2e8d4a475e73e8ae386149934e60ce7d3ea91bd29db77b86fea80e  src-tauri/src/commands/skills.rs
41536a688c7a29ee5013abe933d9432dd0a17dfa58967f3b822d660b7c30f46e  src-tauri/src/core/skill_scenes.rs
23dfea94395669678064e8ad1962add72358f722e7b07d689fec145628343720  src-tauri/src/core/sync_metadata.rs
01872a913f2fb7994e0f61306e9bab8d12abeee21c120adbb58da00b5186f634  src-tauri/src/core/skill_store.rs
4955bbb2a1bfa92c6f72b797a6a4d7278de1b86d00a43f50f0900b5e70be343e  /private/tmp/skill-manager-restore-archived-paths.py
```

### 恢复执行方式的限定调整

结论：**pass。已完成启动的旧 MCP 服务进程可以保留，无需打断其他会话。** 此结论替代上文“停止所有旧 App/MCP 进程”的保守前提；旧 GUI 仍应退出，后续新启动必须使用已替换的修复版二进制。

独立源码复核确认：MCP 在进入 `serve_stdio` 前仅调用一次 `initialize_cli_store`；启动完成后没有再次 reindex 的工具入口或后台重建循环。这些入口文件相对本次基线未变化。旧 MCP 已完成启动、新 GUI 使用修复版、稳定入口已替换的进程事实由主执行者核实。

恢复时使用 Python `fcntl.flock(..., LOCK_EX)` 持有 `/Users/owen/.skills-manager/.skills-manager.lock` 的同一现有文件，覆盖备份、guard 验证、8 行 CAS、提交或回滚的整个过程。项目 `RepoLock` 在 macOS 使用 `fs2` 的原生 `flock`，与该锁兼容。不得删除或替换锁文件，也不在持锁期间启动会再次申请该锁的 CLI。既有 MCP 读操作可继续；需要仓库锁的并发写入将等待恢复事务完成。8 行修复内容和原有 SQLite 事务 guard 均不变。

### 组合输出约束与拒绝说明的增量复核

结论：**pass，未发现 P0–P2。** 本次仅审核 `skills.rs` 的输出约束 Prompt 与 `organization_agent.rs` 的卡片校验报错 delta。

Prompt 明确原样复制 ID、每个 ID 仅选一次、主职责与跨能力配合的表达方式，并列出既有字段、数量及 Unicode 字符上限。Parser 保留原有全部拒绝条件：未知 ID、重复 ID、空白字段及原始 Unicode 长度上限；仅将原笼统错误拆成带一基序号的中文原因。没有放宽边界、自动纠错、重试或增加原始输出日志。新增测试逐项覆盖未知与重复 ID，以及 stage/role/reason 在上限、超限和空白时的行为；构建者报告相关 15 项测试通过。

真实调用曾被旧笼统校验拒绝，但当时没有保留原始模型输出，因此本审核不将任何具体 ID 或字段错误认定为该次失败根因。本 delta 通过表示约束提示与诊断变更正确；新构建的真实调用结果仍由后续验收记录。

```text
9cc09ae7cfa46295157bbf5addc36c3136baa4f47aff47dca8466c2951e68ba1  src-tauri/src/commands/skills.rs
45fc705a7a4547c8ecdd5c3889faffb24fdd126fbf8b8f587b93fc54b1ecf3f0  src-tauri/src/core/organization_agent.rs
```
