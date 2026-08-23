# Skill Card Manager Foundation 阶段总结

日期：2026-08-23
版本：1.28.5
阶段状态：功能与本地无签名安装包已就绪；代码审查中；Developer ID 签名与 Apple 公证尚未开始。

## 本阶段交付

本阶段把原始 Skills Manager 的基础能力收敛成 Skill Card Manager 的 Foundation：用户可以先看清本机和各 Agent 中有哪些 Skill，再处理重复、同名异内容、格式与可用性、来源和投放关系，最后把确认后的 Skill 分配给具体 Agent。

- 统一技能库：扫描并区分已纳管、可导入、需判断和 Plugin / Runtime 等外部内容。
- Agent 投放：在 Skill 详情中看见可用工作区、各 Agent 当前 Skill 数量，并调整投放关系。
- 健康治理：按问题类型聚合重复、同名异内容、格式与可用性问题，避免把大量事件平铺给用户。
- 判断与执行闭环：规则先确认事实；需要语义判断时可交给本机 Agent；结论对应明确、可预览、可撤销的文件动作。
- 已处理记录：处理后的关系和文件动作进入独立历史，支持恢复。
- 牌组边界：牌组继续作为独立能力组合层，不与技能库健康整理混用。
- 设计基础：建立语义 Token、默认 Skill Manager skin 和设计检查脚本；当前只提供默认皮肤，不新增 Linear、Airbnb 等主题。

## 阶段安装包

本地测试包：`Skill-Card-Manager-Foundation-1.28.5-arm64-unsigned.dmg`

- 架构：Apple Silicon (`arm64`)
- DMG 大小：约 20 MB
- SHA-256：`1b2a50b02baae693140ee128adccf75e10aaf4c05e12b08d53b0249be38568be`
- DMG 完整性：`hdiutil verify` 通过
- App 名称：`Skill Card Manager`
- App 版本：`1.28.5`
- 签名状态：仅 linker ad-hoc；没有 Developer ID 签名，没有 Apple 公证

这个 DMG 只用于当前阶段本机测试，不作为正式分发包。正式包必须等 PR 审查和自动检查全部通过后，重新执行 Developer ID 签名、公证、staple 与 Gatekeeper 验证。

## 发布门

1. 本地完整验证通过。
2. 当前阶段提交进入 PR #4。
3. Codex review 与仓库 required checks 对最新 commit 无有效阻塞项。
4. 重新生成 Developer ID 签名的 DMG。
5. `notarytool` 返回 `Accepted`，完成 staple，并由 `spctl` 验证为 `Notarized Developer ID`。

当前停在第 2–3 步之间；不得提前把无签名测试包当成正式版本发布。
