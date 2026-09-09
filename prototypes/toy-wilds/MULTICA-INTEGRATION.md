# Card Master × Multica 接入边界

核查日期：2026-09-09。本文件保留早期安装检查与接口边界。后续正式 CLI 已成功读取真实工作区、Agent、装备与运行记录；最新权限矩阵、Portal 方案与脱敏证据见 [技术调研结论](./research/README.md)。主 App 接入、装备写入与新任务执行尚未实施/验收。

## 产品归属决策 · 2026-09-09

用户明确的根本需求：产品本体仍然是 Skill Manager / Skill 管理库，也就是武器库管理。用户连接自己的 Multica 账户、workspace 或本机执行环境；连接能力服务于 Skill Manager，正式的卡牌、装备袋与游戏化场景存在于 Skill Manager 内。

据此固定以下边界：

- **产品入口**：Skill Manager 默认保持传统 SaaS UI；只有点击场景中的 Portal 才隐藏 SaaS UI，进入全窗口游戏皮肤，退出恢复原页面与工作状态。Skill Manager 是用户管理装备与选择用途的主入口。现有 `/my-skills`、`/scenes` 和 `/assistants` 分别提供库、场景与连接的承载位置；具体界面合入尚未实施。
- **一份受管 Skill 定义、多种表现**：普通库、武器库、卡片、地图装备引用同一稳定 Skill ID。品阶、卡面、场景关系与历史关联该定义和相应版本；不得随着切换视图复制成新的业务库。
- **装备库与角色装备的归属**：库管理用户可用的 Skills；角色装备记录具体 Agent 的绑定。Skill 的永久成就保留在 Skill 库，个人 Profile 不据此获得能力认证。角色装备变化、workspace 断开或 runtime 更换都不删除受管 Skill 与已有成就。
- **Multica 为可选执行连接**：连接流程定位服务地址、workspace 和具体 Agent，再核验其技能绑定与 runtime。仅检测到本机 App 或登录账户不足以确定装备对象。未连接时，库管理与卡牌浏览仍应完整可用。
- **自有与外部 Agent**：只给当前用户拥有的 Agent 配装，供其参与合作；外部 Agent 仅作为被授权调用的服务，对方装备由对方管理。即使 workspace admin 技术上可修改，也不开放外部装备操作。
- **状态权威**：Skill Manager 保存其受管内容、版本、评审及视觉；Multica 的实际绑定、执行状态和调用权限由其返回结果确认。地图展示这些状态，并从运行证据发起 Skill 改进与评审，不能用本地动画代替执行成功。

### 据此调整后续顺序

1. 先把已验证的装备袋、卡片与玩具旷野表现合入 Skill Manager 的场景体系，复用应用现有受管库与详情能力；独立 4185 站点继续作为验证原型，不能被当作已完成的正式产品入口。
2. 再接通用户选择的 Multica workspace / Agent，跑通一个 Agent 的装备确认、一次任务与结果回流。
3. 基于真实 Agent 与运行记录扩展游戏地图及未来广场。

原型目前把本地携带草稿按运行环境保存在浏览器 localStorage；这仅用于验证交互。正式角色装备按稳定 Agent 引用保存，runtime 是可变执行配置。旧草稿如需迁入，必须由用户选定目标角色后导入，不能按工具名或角色名自动认领；保留原始草稿直至迁入得到确认。本轮仅固定产品归属与迁移要求，尚未执行迁移、合入主程序或绑定 Multica。

代码依据：`src/App.tsx` 提供上述路由，`src/views/Scenes.tsx` 已通过 `useApp().managedSkills` 与 `openSkillDetailById` 复用受管库；正式场景应沿用这条主数据链。

## 当前结论

Multica 可以承担 Agent 的技能绑定、任务调度和运行记录；Card Master 承担角色与卡牌呈现、装备编排、结果验收和成长规则。后续只读探针已取得用户的唯一 workspace、10 个 Agent 与抽样装备/运行记录。当前原型尚未消费这套 Multica 数据，样例角色仍保持本地身份；写入与执行未验证。

本次没有读取凭据文件、cookie、token 或私人任务数据库，没有登录、启动 daemon、执行任务、导入技能或修改 Agent。

## 首次安装与连接验证（历史记录）

以下失败状态为首次探测记录，已被本轮成功只读探针更新；不能用它们描述当前账号连接状态。见 [connection-evidence.json](./research/connection-evidence.json)。

| 项目 | 实际核查结果 |
| --- | --- |
| App | `/Applications/Multica.app` |
| Bundle ID | `ai.multica.desktop` |
| Desktop 版本 | `0.4.39`，来自 `Contents/Info.plist` 和安装包 `package.json` |
| 内置 CLI | `/Applications/Multica.app/Contents/Resources/app.asar.unpacked/resources/bin/multica` |
| CLI 版本 | `v0.4.39`，commit `0eff894b5`，构建时间 `2026-09-03T10:44:39Z`，`darwin/arm64` |
| 官方身份 | 安装包 homepage 为 `https://multica.ai`，repository / updater 指向 `multica-ai/multica` |
| 进程 | 核查时未发现 Multica 进程 |
| 默认 CLI 连接 | `agent list --output json` 返回 exit 1，错误指向未配置 server / `multica setup`；没有清单 |
| Desktop 云 profile | `--profile desktop-api.multica.ai agent list --output json` 返回 exit 1，缺少 workspace 上下文；没有清单 |
| Desktop workspace 清单 | 同 profile 的 `workspace list --output json` 返回 exit 2，未获得可解析清单；原因未进一步确认 |
| 健康端口 | 默认 CLI 端口 `19514`、官方云 Desktop 端口 `19681` 均未监听 |

安装版 Desktop 源码将自身 profile 与用户终端的默认 profile 分开。官方云地址推导出的 Desktop profile 为 `desktop-api.multica.ai`；对应端口为 `19515 + sum(profile UTF-8 bytes) % 1000 = 19681`。这是安装版实现细节，不应作为未来稳定接口。没有读取用户实际选择的服务地址，因此不能排除用户使用其他 self-hosted profile。

上面的失败证明“此次没有拿到可用清单”，不证明用户未登录，也不证明远端 workspace 没有 Agent。后续真实人物选择必须由成功的清单读取驱动；连接失败、清单为空、缺少 workspace、无调用权限、runtime 离线应分别表达。

## 三个独立的数据域

| 域 | 真实含义 | Card Master 映射 | 不能混同的概念 |
| --- | --- | --- | --- |
| 角色身份 / Agent identity | workspace 内的 Agent，拥有名称、职责、instructions、访问权限、技能绑定和历史 | 可选择的角色及其持久身份 | Agent 的名称不是稳定 ID；角色不等于一台机器，也不等于某个模型 |
| 运行部署 / Runtime deployment | 一台计算机上的一个 AI 工具或兼容 runtime profile；daemon 负责领取运行并调用工具 | 当前角色可以在哪里、用什么工具与模型执行 | `runtime_id` 可以改变；runtime 删除或解绑不应删除角色和历史；离线不等于不存在 |
| 技能库 / Skill library | workspace skill、runtime 本地 skill、仓库 skill 等不同来源的能力内容 | 装备的实际能力定义与版本 | 卡面资产不是 skill 内容；本地发现不等于已导入 workspace；库中存在不等于已装备到 Agent |

Multica 的 Agent 响应提供 `id`、`workspace_id`、`runtime_id`、`runtime_bound`、`runtime_mode`、`model`、`status`、`skills` 等信息。Agent 列表中的技能仅是摘要；完整内容需要技能详情接口。详细技能绑定还包含 `enabled`。读取清单不等于拥有调用或修改权限。

Workspace skill 以 `SKILL.md` 为主文件，可附带脚本、模板和引用文件。导入本地目录或从 runtime 复制是内容快照；本地后续变化不会自动更新 workspace 副本。仓库自己的 `.agents/skills/` 等文件由仓库维护，支持程度取决于实际执行工具。[官方 Skills 文档](https://multica.ai/docs/skills)

## 后续稳定 ID 与版本映射

以下是接入设计约束，尚未实现：

1. **角色引用**使用 `{provider: "multica", serviceOrigin, workspaceId, agentId}`。显示名称、头像、状态与模型作为可更新属性，不能参与身份判断。
2. **部署引用**单独保存 `runtimeId` 与执行时的工具 / 模型配置。更换部署保留同一角色的卡牌与历史，不能生成一个重复角色。
3. **技能映射**连接 Card Master 的稳定 `skillDefinitionId` 与 Multica 的 `{serviceOrigin, workspaceId, skillId}`。不能用相同名称推断两者是同一技能。
4. **技能版本**保存 `packageVersion`（有则保留）、来源定位、`contentHash` 和对应卡面版本。`contentHash` 应覆盖规范化后的 `SKILL.md` 与所有支持文件，不能只计算卡面图片或主文件。
5. **装备快照**在发起执行时固定 `agentRef`、`runtimeRef`、skill ID / 内容版本及启用状态。装备在后续被修改时，历史运行仍指向当时的快照。
6. **运行引用**用 `{serviceOrigin, workspaceId, taskId}` 去重，并另存 `issueId`、重试 / 再运行关系。一个 issue 有多次 run，不能把 `issueId` 当作单次执行 ID。

自动导入、更新技能、同步装备或运行任务均不是本轮已完成能力；适配器必须先保证这些映射成立，再接入有副作用的操作。

## 接口：本机命令与安装版源码已核实

验证口径：

- “实际调用”只指本轮执行过的只读 CLI / 健康检查。
- “安装版支持”指查看内置 CLI `--help` 或安装包源代码确认接口存在，不表示服务器已接受调用。
- 下表所有写入接口仅核对实现，**没有实际调用**。

### 只读清单与结果读取

| 用途 | CLI / HTTP 接口 | 验证程度 |
| --- | --- | --- |
| 版本 | `multica version` | 实际调用成功，版本如上 |
| Agent 清单 | `multica agent list --output json`；`GET /api/agents`，支持 `workspace_id` / `include_archived` | CLI 实际调用未取得清单；参数与 HTTP 路由已核实 |
| Agent 详情 | `multica agent get <agent-id>`；`GET /api/agents/:id` | CLI 文档及安装版 HTTP client 核实 |
| Agent 装备技能 | `multica agent skills list <agent-id> --output json`；`GET /api/agents/:id/skills` | 安装版 CLI help 与 HTTP client 核实 |
| 技能库 | `multica skill list`；`GET /api/skills` | CLI 文档及安装版 HTTP client 核实 |
| 技能正文与文件 | `multica skill get <skill-id>`；`GET /api/skills/:id` | CLI 文档及安装版 HTTP client 核实 |
| Agent 运行记录 | `GET /api/agents/:id/tasks` | 安装版 HTTP client 核实 |
| Issue 的历次运行 | `multica issue runs <issue-id>`；`GET /api/issues/:id/task-runs` | CLI 文档及安装版 HTTP client 核实 |
| 单次运行消息 | `multica issue run-messages <task-id> --issue <issue-id>`；`GET /api/tasks/:id/messages` | CLI 文档及安装版 HTTP client 核实 |
| Issue 使用统计 | `GET /api/issues/:id/usage` | 安装版 HTTP client 核实 |

Agent 原始响应在部分权限下包含 `mcp_config` 等敏感配置。清单适配器只投影角色所需的 ID、名称、状态、runtime、模型和技能摘要，不能把原始响应或错误配置直接透传给前端。认证由正式连接机制处理，不能从 Desktop cookie、数据库或配置文件中提取凭据。

### 有副作用的接口：仅核实，未调用

| 用途 | 安装版接口 | 语义 |
| --- | --- | --- |
| 增量装备 | `POST /api/agents/:id/skills/add`，`{skill_ids:[...]}` | 仅添加指定技能，不覆盖已有绑定 |
| 整套替换 | `PUT /api/agents/:id/skills`，`{skill_ids:[...]}` | 替换该 Agent 的技能集合；不能误用于单件装备 |
| 启用 / 禁用绑定 | `PUT /api/agents/:id/skills/:skillId/enabled`，`{enabled:true/false}` | 保留技能实体，调整装备状态 |
| 移除绑定 | `DELETE /api/agents/:id/skills/:skillId` | 从该 Agent 移除绑定 |
| 本地技能扫描请求 | `POST /api/runtimes/:id/local-skills`，随后 `GET /api/runtimes/:id/local-skills/:requestId` | 创建异步扫描请求；不能归入纯 GET 清单读取 |
| 创建 issue | `POST /api/issues`；CLI `issue create --title ... --assignee-id ...` | 分配给可调用 Agent、状态满足触发规则时产生运行 |
| Issue 再运行 | `POST /api/issues/:id/rerun`，可带 `{task_id:...}`；CLI `issue rerun <id>` | 不指定旧 task 时对当前 assignee 发起新的运行 |
| 创建聊天 | `POST /api/chat/sessions`，`{agent_id,title?,project_id?}` | 创建 Agent 聊天上下文 |
| 发送聊天消息 | `POST /api/chat/sessions/:id/messages`，`{content,attachment_ids?}` | 消息触发 Agent 运行 |

官方还支持 issue 分配、评论提及和 Autopilot 触发。`backlog` 不触发执行；拥有 workspace 角色或能看见 Agent，不自动等于拥有调用权限。[官方触发规则](https://multica.ai/docs/triggering-agents)

安装版默认 API origin 为 `https://api.multica.ai`，WebSocket 为 `wss://api.multica.ai/ws`。客户端使用 Bearer 认证与 `X-Workspace-Slug` 选择 workspace。这些是服务端接口；没有核实到可供 Card Master 外部直接调用的 Desktop 通用 Agent RPC。Electron IPC 主要管理 daemon、窗口与文件；健康端口也不等于通用执行入口。[官方 Desktop 文档](https://multica.ai/docs/desktop-app)、[官方 daemon / runtime 文档](https://multica.ai/docs/daemon-runtimes)

## 执行结果回流与成长

推荐闭环为：**确认装备快照 → 创建执行 → 记录 task / run ID → 获取结果与证据 → 进入 review → 接受或驳回 → 按 Card Master 规则更新成长**。这是后续设计，不代表本原型已连通执行。

- Issue 保存目标与协作过程；run 保存一次执行。一次 issue 可以产生多个 run。
- `completed` 只代表该次运行正常结束，不代表目标已经满足或交付已经被接受。不能仅据此增加经验、升级卡牌或授予 SSR。
- 接受结果应记录 `taskId`、装备版本、交付证据、review 状态、接受者与接受时间。重复轮询和重试记录按 task ID 去重，避免重复成长。
- 失败、取消、排队、离线分别保留，不当作成功。模型调用量、token 花费与运行次数可作活动信息，不能代替质量验收。
- 接受的结果可以回流为技能改进候选或成长事件；是否升级 skill 内容、卡牌稀有度或授予 SSR，由独立规则与 review 决定。不能把自动执行完成直接等同于自动授 SSR。

官方明确区分运行完成与 issue 目标完成，并保留每一次执行记录。[官方 Runs 文档](https://multica.ai/docs/tasks)

## 未来范围：广场

广场属于未来产品范围。本次没有实现角色公开、跨用户调用、装备交易、技能发布或共享成长。未来的广场应引用稳定的角色 / 技能身份，另外处理可见性、调用授权、内容版本和来源；公开卡面不能自动开放 Agent 执行权限，也不能携带私有运行配置。当前接入不需要为了广场改造 Multica 或上线公共服务。

## 证据来源

**本机实际证据**

- [Multica Info.plist](/Applications/Multica.app/Contents/Info.plist)：版本、bundle ID、URL scheme。
- [Multica 更新配置](/Applications/Multica.app/Contents/Resources/app-update.yml)：官方 repository / owner。
- 安装包 `/Applications/Multica.app/Contents/Resources/app.asar` 内：`package.json`、`out/main/index.js`、`out/preload/index.js`、`node_modules/@multica/core/api/client.ts`、`node_modules/@multica/core/types/agent.ts`。
- 内置 CLI 的 `version`、`agent list --help`、`agent skills list --help`、`issue create --help`、`issue rerun --help`，以及本文件记录的只读连接尝试。

**官方公开来源**

- [官方仓库](https://github.com/multica-ai/multica)
- [CLI 文档](https://multica.ai/docs/cli)
- [Skills 文档](https://multica.ai/docs/skills)
- [Runs 文档](https://multica.ai/docs/tasks)
- [Agent 触发与权限](https://multica.ai/docs/triggering-agents)
- [Desktop 文档](https://multica.ai/docs/desktop-app)
- [Daemon 与 runtimes](https://multica.ai/docs/daemon-runtimes)
- [认证与 token 文档](https://multica.ai/docs/auth-tokens)
- [公开 API client 源码（main）](https://raw.githubusercontent.com/multica-ai/multica/main/packages/core/api/client.ts)

公开文档与 `main` 会变化；安装版能力以上述本机 `0.4.39` 源码和内置 CLI 为准。HTTP 路由在安装版代码中存在，不保证任意 self-hosted 服务端版本都已实现，接入时还需要真实连接后的能力确认。
