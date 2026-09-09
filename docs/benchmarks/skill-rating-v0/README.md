# market-scale v0 calibration seeds

评级规则现以 [foundation v1](../../skill-rating-foundation-v1.md) 为准。目录名 `v0` 仅标记这批开发题版本；旧 20/40/80 题等数字不再定义 C/R/SR 等级。C 合并待验证入口；SSR 是一次有证据的 Skill 方法突破带来的永久成就，不由公开题分数或重复调用次数触发。本题集仍可校准证据、覆盖、判断和交付质量。

这是 Skill Card Master 当前场景 `scene-82935edd27b17fe4` 与 Skill `market-scale`（`3b694b18-5f5e-4eaa-ac48-76d65445008d`）的公开开发集。

`market-research-seeds.json` 含 12 道完整的、明确标注为虚构的 evidence packet 题目：

- `basic`：口径与算术（TAM/SAM/SOM、GMV/收入、年度/月度/币种）。
- `composite`：多源去重、多渠道用户、top-down 与 bottom-up 交叉核对。
- `constraints`：预算、时限、来源权限和不可逆外部动作边界。
- `adversarial`：旧数据、口径冲突、数据不足和不能虚构排名。

每题都包含 `task`、`input`、`evidence`、`requiredAssertions`、`criticalFailures` 和 `numericChecks`。`requiredAssertions.expected` 是公开答案，专门用于校准评分器和人工标注；它不是固定唯一话术。评分应奖励证据引用、口径正确、关键错误规避和对未知的诚实承认，不能因为套用某个分析框架或复述模板就给高分。

所有 evidence 都是合成内容，不代表真实公司、市场、金额、来源或行业事实。它们可以直接作为未来 benchmark 的输入格式样例，但本文件不是事实数据库，也不是行业排名依据。

## 使用边界

这是公开开发集，答案已经可见；它不是 holdout，也没有运行真实 `market-scale` Skill 的结果。不要用它正式发牌、宣布能力等级、比较模型排名或推断商业价值。正式评估必须另行锁定未见任务，并记录模型、harness、预算、日期、重复次数、失败类型和不确定性。

建议用 no-skill baseline 与 Skill-on 在相同任务、工具、模型和预算下做对照。每个 `skill × scene` 单元应报告成功数/总数、关键错误、成本/时延和置信区间；不要把 12 道公开题的表现外推成一般行业能力。

## 校验

只依赖 Python 标准库：

```bash
cd app && python3 docs/benchmarks/skill-rating-v0/verify_seeds.py
```

校验脚本会检查 JSON 可解析性、12 个唯一 ID、四个分层各 3 题、必填字段、合成 evidence 标记、evidence 引用完整性，以及每一项 `numericChecks` 的期望数值。它会真实计算加减乘除、比率、平均数、货币换算、年度化、集合并交集和预算余额；不要只把 expected 当作字符串存在性检查。

## 统计提示

Wilson 95% 区间（近似，二项成功率）：

- 16/20 = 80%，约 `58.4%–91.9%`；
- 34/40 = 85%，约 `70.9%–92.9%`；
- 72/80 = 90%，约 `81.5%–94.8%`。

小样本的百分比很不稳定，因此公开集通过率不能直接触发高等级。三次重复是同一道题的三个 trial，用来估计随机性；不能把同一道题重复三次当成三道独立题，也不能把有效样本量虚增三倍。正式 holdout 应按独立任务数和重复设计分别报告。
