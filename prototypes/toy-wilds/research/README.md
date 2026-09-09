# Portal 与 Multica 技术接入结论

本轮补充：[当前身份与 Agent 所有权核验](./multica-owned-agent-probe.md) 确认可见 10 个、自有 0 个；新角色面板只创建本机角色，不把他人的 Agent 纳入配装。

后续实现状态：用户已授权开发，[Portal v1](../PORTAL-V1.md) 已接入主程序。以下保留研究阶段的原始结论和验证边界；Multica 写入与新任务执行仍未验收。

核查时间：2026-09-09。产品约束来自用户本轮明确要求。结论：**Skill Manager 维持默认 SaaS 界面，点击 Portal 才进入游戏；Multica 通过外部执行适配器接入。真实只读链路已经通过，装备写入与新任务执行尚未验收。**

此处 SaaS 指默认界面风格。现有产品是 Tauri 桌面应用；本方案不新增云端托管用户凭据的服务。

## 1. Portal 的产品合同

- 默认打开、重启与普通导航继续使用已有 SaaS UI。Portal 放在场景内容中；只有明确点击才加载游戏代码和创建 WebGL 场景。
- 点击后游戏占满当前应用内容区域，原侧栏、SaaS 顶栏和页面内容隐藏并停止接受交互；这不是强制切换操作系统全屏。
- 游戏拥有自己的装备袋、卡片与操作方式。最外层返回恢复原场景、搜索、筛选、分页、展开、滚动和焦点。游戏失败也有返回入口。
- 普通库和游戏库引用同一受管 Skill ID/版本/评审，不生成第二个业务库。Multica 断连不影响库管理与卡面浏览。
- 首版不将整套 SaaS 换肤，不默认进入游戏，不给门户点击附加登录、装配或任务派发动作。

实现选择：背景路由保留原 SaaS 页面实例，同级 GameShell 懒加载；共用 AppProvider。仅保留 provider 不足以保住 Scenes 的局部状态。Three 引擎需改为可销毁实例，样式与事件限制在 game root；正式数据使用现有 Tauri get_skill_library，不带入原型的 localhost server。具体代码依据、缩放/内存风险与验收见 [Portal 接入调研](./portal-integration.md)。本轮尚未实施 Portal。

## 2. 实际验证到哪一步

[可复跑探针](./multica-readonly-probe.mjs) 调用安装版 Multica 0.4.39 的正式 CLI，CLI 使用其已认证 profile；探针不读取配置文件、不复制凭据，不打印原始响应。

| 检查层 | 本机实际结果 | 能证明什么 |
| --- | --- | --- |
| 默认终端 profile | 未配置 server | 默认 profile 不能代表 Desktop 登录状态 |
| Desktop profile | auth status 成功 | 该 profile 当前凭据可用 |
| Workspace | 返回唯一工作区「仙女座星系」 | 已取得真正可访问的工作区，之前的缺失信息已解决 |
| Agent 清单 | 10 个 Agent，均有 runtime 绑定 | 可构建真实人物选择器；不等于能调用每个 Agent |
| Workspace Skill 库 | 16 项 | 可读取外部可装配内容；不等同于本机 Manager 的 434 项库 |
| Agent 装备 | 抽样 Builder · Luna 返回 7 项绑定，均启用 | 人物装备可以从服务端真实读取 |
| Runtime | 24 个，18 online / 6 offline | 可显示目标执行环境；online 仍不能代替一次执行验收 |
| 本机 daemon | stopped | 该 profile 的本地 daemon 未运行，不代表其他电脑无法执行 |
| Agent 历史运行 | 抽样返回 85 条，含 completed/failed/cancelled | 可读取运行历史和结果状态；不代表本次已发起/验收任务 |
| 装备写入、导入与新任务 | 本轮未调用 | 写权限与端到端执行保持 unverified |

数量与在线状态是探针时刻的快照，不硬编码在产品逻辑。无用户资料、token、Agent instructions、MCP 配置或任务正文进入 [connection-evidence.json](./connection-evidence.json)。历史 completed 不能自动给 Skill 升级或为用户授予个人能力认证。

## 3. 接入路线与 Skill Manager 的角色

**首版选择：Skill Manager 的 Tauri 后端通过正式 Multica CLI 适配器调用用户选定的 profile/workspace，前端只接收结构化的最小数据。** 当前机器已验证这条路径。无需控制 Desktop 窗口，也无需把本机 daemon 健康端口当成通用任务 RPC。

```text
Skill Manager
  ├─ 默认 SaaS / Portal 游戏界面
  ├─ 受管 Skill、版本、评审与卡面
  └─ typed Multica adapter（Tauri 后端，固定命令/参数与返回字段）
       └─ 正式 Multica CLI：用户选定的已认证 profile
            └─ Multica 服务：workspace → Agent → 绑定/issue/run
                 └─ 对应机器的 daemon → AI 工具执行
```

这个适配器是产品连接层，不扮演 workspace owner、通用终端或新的 Agent 调度平台。它应完成：

1. 连接与能力探测，分开显示认证、工作区选择、可读、可装配、可调用及 runtime 在线状态。
2. 映射稳定身份：`serviceOrigin + workspaceId + agentId`，关联 Manager Skill ID 与远端 Skill ID/内容版本。名称相同不自动认领；同名导入冲突默认停止。
3. 按用户意图同步具体装备变化；增量添加使用 add，禁止把一件装备操作实现为整套 set。当前浏览器草稿迁入时先选真实角色，不以 Codex/Claude 名称自动认领。
4. 发起任务后保存服务端 issue/run ID，以运行记录驱动地图状态，再把可核验产出交给评审流程。断网或请求超时进入“待核实”，先对账，避免自动重发生成重复任务。
5. 在用户断开连接后停用后续调用并清理本产品映射会话；如果选用的是已有共享 Desktop profile，不能通过 logout 删除其他应用正在使用的登录。服务端 token 撤销需使用其正规撤销流程。

CLI profile 自己持有认证。首版不将 token 复制到 JS、localStorage、卡面提示词或 Agent 指令。新用户通过官方登录流程建立连接；`setup` 会同时启动 daemon，不能被隐藏在单纯“连接账户”按钮后。后续若改用直接 HTTP，应另做凭据生命周期与系统钥匙串集成，不能把现有 Desktop cookie 取出当作 API token。

后端命令应采用固定操作枚举，例如 listAgents / listBindings / addBindings / createIssue / listRuns，不给前端通用 shell 或任意路径执行入口。CLI 参数按 argv 传递，工作区与 Agent 使用已核验完整 ID；不透传包含敏感配置的原始 JSON。兼容层锁定经验证版本，升级后重跑契约检查。

## 自有角色与外部服务的产品边界 · 用户补充

用户明确：只为自己的 Agent 发放、更新和更换自己 Skill Manager 中的装备。自有 Agent 可以带着这些装备参与合作。别人提供的 Agent 是被调用的服务，其装备由对方负责，本产品不管理、不替换、不补发。

| 对象 | 产品提供的能力 | 装备控制权 |
| --- | --- | --- |
| 自有 Agent | 查看装备、从自己的受管库配装、派发自己的工作、参与合作 | 当前连接账号拥有该 Agent，由 Skill Manager 同步明确的装备变更 |
| 外部 Agent | 在对方授权范围内查看服务能力、发起委托、读取允许访问的交付 | 对方管理；产品不提供装备修改入口，也不从后台代发装备写请求 |

正式适配器先取得认证用户 ID 与 Agent.owner_id。只有身份已核验且 owner_id 匹配，才允许装备写操作；缺失所有权信息时保持不可写。检查在后端执行，不能只隐藏按钮。workspace owner/admin 能力不自动把外部 Agent 变成本产品可管理对象，也不能作为绕过产品边界的条件。协作关系、同处一个 workspace、可见或可调用，都不构成拥有关系。

自有与外部两类角色可以出现在同一地图中，但分别使用“我的角色/装备袋”和“可委托服务”交互。Skill 库保持同一份，个人 Profile 与 Skill 永久成就继续分开。未来广场的外部服务卡展示可公开能力与调用状态，具体装配不属于消费流程所需信息，不默认抓取外部 Agent 的详细装备。

“自己的装备”指来自用户受管库并有权使用/分发的 Skill；来源可以是用户导入的外部 Skill，不因此改变上游作者与来源记录。往 Multica 同步时仍保留独立 ID/版本映射，不能因为在本地拥有一份就覆盖他人创建的远端 Skill 实体。

据此收窄首版最小权限：普通 workspace member 拥有自己的 Agent，即可覆盖自有配装；消费外部 Agent 依赖对方授予的调用权。无需为本产品默认申请 workspace admin，也不增加“管理别人的装备”能力。服务端的完整权限矩阵保留为技术事实，产品操作范围比它更窄。

## 4. 权限结论

必须分清两层：**Multica 服务端实际授予的权限**，以及 **Skill Manager 在界面/适配器中限制的可用动作**。本产品设置“只读连接”可限制自身发出的请求，但不会把现有 PAT 变成服务端的只读或单工作区 token。

官方 PAT 代表用户，覆盖用户有权访问的工作区/API；没有发现可覆盖本次核心场景的用户 OAuth 细粒度 scope 合同。`mat_` 是服务端给某次运行的临时凭据，不能当作管理器登录凭据。详见 [官方认证文档](https://multica.ai/docs/auth-tokens) 和 [权限源码调研](./multica-auth-permissions.md)。

官方新增的 Plugin Action API 提供服务端受限授权，但当前核心路由只有上下文、issue 标题/描述、无 mention dispatch 的评论和插件存储。它不覆盖 Agent 清单、Skill 装配与任务启动，不能拿它代替本轮连接路线。主 `/api` 与此版本化 `/v1` 不是同一套凭据/稳定性合同。

具体动作最小权限、Agent owner 与 runtime owner 的差别、调用授权和版本依据见 [权限矩阵](./multica-auth-permissions.md)。本轮未提升账户角色、创建 token、公开 runtime 或改变 Agent 绑定。

## 5. 首次写入与执行的验收方案

这是待实施的测试合同，不是已经完成的运行。顺序为 Portal 往返 → 真实只读角色/装备 → 经用户确认的独立测试对象 → 新任务端到端验收 → 结果回流。

| 阶段 | 具体动作 | 通过标准 |
| --- | --- | --- |
| 选择对象 | 确认当前连接账号拥有的 Agent 和允许执行的 runtime，记录绑定快照与版本 | 身份明确；读、改装备、调用权限分别判定；不因管理员身份占用他人私有电脑 |
| 测试 Skill | 在专用测试范围导入一个带唯一 nonce 的微型 Skill，提示只回传 nonce 和校验步骤，不读其他项目、不修改文件、不联网 | 返回真实 Skill ID，正文/支持文件校验一致；冲突默认停止；不覆盖现有库 |
| 装配 | 增量绑定并再次 GET 核验 enabled/ID | 已有装备集合保留，目标绑定出现，不能仅依据 POST 成功动画 |
| 发起一次任务 | 给明确测试 Agent 派发短请求，仅指定测试 Skill 与独立关联 ID；期望 nonce 只存在 Skill 正文，不能写进任务提示 | 获得 issue/run ID；实际 runtime 领取；超时不盲目重发 |
| 验收 | 读取真实 run 与输出，核对仅存于 Skill 的 nonce、内容版本及执行证据 | 同时满足输出检查与 run 记录；单独 completed 不算通过 |
| 回流与收尾 | 在 Manager 保存证据引用和评审候选；测试绑定按快照恢复，保留核验记录 | 不自动授 SSR；恢复只移除本次增量，不替换整个装备集；归档测试对象前确认恢复成功 |

这个测试会写入工作区并消耗目标 runtime 的模型配额，必须在对象和运行范围明确后才进行。本轮调研已完成其前置只读验证，没有发送试探性任务。端到端验收要在正式适配器下再跑一次，不能只用 CLI 手动运行来替代 Skill Manager 的集成验收。

## 6. 复现与证据限制

```sh
node prototypes/toy-wilds/research/multica-readonly-probe.mjs \
  --profile desktop-api.multica.ai \
  --agent-id <从已授权清单选出的完整Agent UUID> \
  --output /tmp/multica-connection-evidence.json

node --test prototypes/toy-wilds/tests/multica-probe.test.mjs
```

只有一个可访问 workspace 时，探针将它作为本次命令参数，不修改 CLI 默认配置；多个 workspace 时要求提供 `--workspace-id`。只支持固定读取动作，不接受 token 或任意子命令。运行于 Multica task 环境时拒绝切回人类 profile。8 MB 输出限制/超时或未知结构会报告失败，不能把截断结果当作空清单。

本轮 3 项探针测试验证：命令/身份参数约束、原始数据不外泄、只读且工作区选择无配置写入。探针已在真实 profile 运行成功；测试 fixture 仅校验脚本行为，不充当真实连接证据。Portal 本轮是代码级设计审查，未执行 UI/原生发布验收。没有下载浏览器、模型、依赖或大型素材。

## 卡牌表达补充 · 2026-09-09

[官方能力/卡牌表达范例](card-copy-references.md) → [本产品的表达标准与UI落地](../CARD-COPY-V1.md)。只借表达结构，游戏规则和数值不充当AI Skill效果证据。
