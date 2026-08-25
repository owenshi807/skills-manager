---
sketch: 001-skill-content-source-clarity
date: 2026-08-23
mode: idea
status: ready-for-review
design_question: 如何让用户立即理解 Skill 的受管理版本、原始来源与两者差异，而不改变现有功能？
variants: 3
tags: [skill-detail, information-architecture, source-provenance, comparison]
---

# Skill 内容与来源表达草图

## 需要解决的问题

当前界面把两类不同概念都画成 pill：

- `本地 / 差异 / 来源` 实际是内容查看导航。
- `Imported · workspace` 实际是来源元数据。

视觉语言相同使用户无法判断哪些可点击、它们彼此是什么关系，以及“本地”究竟指 Agent 工作区还是 Skill Card Manager 的受管理副本。

## 三个方向

### A — 明确分层

把来源元数据放在独立摘要区，把内容查看做成清晰的 segmented navigation。建议文案：

- 本地 → 技能库版本
- 来源 → 原始来源
- 差异 → 比较差异
- Imported · workspace → 来源：本地文件夹导入

### B — Scan / Review

采用 CleanMyMac 式任务结构：先给健康结论和差异数量，用户点击 Review 后再查看具体版本或差异。适合普通用户的默认入口。

### C — 双版本并置

把“差异”从第三份内容改成两份版本之间的关系。适合重度比较，但长期占用空间较大。

## 当前推荐

用 **B 作为默认摘要入口，A 作为展开后的内容查看结构**。这不是新增第四个方案，而是两级信息层级：先回答“是否需要关注”，再回答“具体在看哪一份内容”。C 只适合专门的完整差异页面。

## 如何查看

直接打开 `index.html`。顶部可以切换 A / B / C；A 和 B 内部控件可交互。
