# Multica 认证、权限与接入证据

核查日期：2026-09-09。范围为官方文档、官方公开源码及本轮主任务提供的只读连接结果。本文没有执行登录、插件安装、授权变更、Skill 写入或 Agent 任务，也没有读取本机凭据。

## 接入判断

Skill Manager 保持默认 SaaS 工作界面；Portal 只切换成完整游戏界面。两者共享同一个连接、角色引用和权限判断，进入 Portal 不产生额外授权。角色装配必须映射到真实 Agent 的 Skill 绑定，不能由游戏中的装备状态推断远端已接受修改。

当前可落地的路径是 **官方用户身份连接 + 明确 workspace + `/api` 适配器**。本机阶段复用正式 CLI 已建立的连接，通过固定命令和参数投影读取结果；后续若直接调用 HTTP，由本机 Tauri 后端承接用户明确授权的 PAT 连接。PAT 是账号凭据，不能宣传为“仅授权这个 workspace / 只读 Agent”的服务端细粒度授权。Plugin Action API 的独立权限模型更窄，但现有功能不覆盖完整管理器需求，不能用它替代当前适配器。认证依据见[官方 token 文档](https://multica.ai/docs/auth-tokens)，能力依据见[公开 v1 路由](https://raw.githubusercontent.com/multica-ai/multica/main/server/pkg/publicapi/v1/routes.go)。

产品应分别展示 `read_verified`（实际读取成功）、`permission_inferred`（由角色及访问配置推导）、`execution_verified`（真实执行及结果已验证）。有登录、有 Agent 清单、有管理权限和任务能执行是四个不同事实。

## 版本与证据层级

| 证据 | 已确认内容 | 不能据此确认 |
| --- | --- | --- |
| 本机安装包与内置 CLI，前一轮实际核查 | Desktop `0.4.39`；CLI `v0.4.39`，commit `0eff894b5`，构建时间 `2026-09-03T10:44:39Z` | 云端部署的服务端版本、当前 main 的全部权限实现 |
| 本轮主任务的实际只读连接，已反馈 | profile 认证、选定工作区、10 个 Agents、16 个 Skills、24 个 runtimes（18 online / 6 offline）、所选 Agent 的 7 个 enabled 绑定、85 条历史 run 读取成功；本机 daemon 为 stopped | 本子任务未重复读取这些对象；历史存在不等于本轮已创建并验证一次执行，也不证明写权限 |
| 本文官方网页与 `main` 源码核查 | 下面列出的认证、权限与路由实现 | 不等同于对安装版或云部署执行了权限测试；网页抓取时间也不保证所有文件属于同一 commit |

内置 CLI 绝对路径：`/Applications/Multica.app/Contents/Resources/app.asar.unpacked/resources/bin/multica`。版本来自 [Info.plist](/Applications/Multica.app/Contents/Info.plist)、安装包及前轮 CLI 输出。本轮没有再次运行 CLI。早先读取失败已经被主任务本轮的成功结果覆盖，不能继续写成“用户未登录”或“需要用户提供 workspace”。

`main` 的 `/api/config` 返回可选 `server_version`；未注入正式构建版本的 dev 服务会省略该字段。接入时记录真实服务 origin、版本（有则保留）和逐项能力探针，不把 Desktop 版本当成服务端版本。本轮未取得与 `0.4.39` 对应的完整服务端权限源码快照。[`router.go`：`normalizeServerVersion`、`/api/config`](https://raw.githubusercontent.com/multica-ai/multica/main/server/cmd/server/router.go)

## 凭据与登录流程

| 类型 | 身份和边界 | 适用性 |
| --- | --- | --- |
| Web / Desktop session | 官方登录建立 HttpOnly JWT cookie；cookie 写请求校验 CSRF | Multica 自身 UI；不应抓取 cookie 给管理器使用 |
| 用户 PAT：`mul_` | 代表用户账号；可访问该用户有权访问的 workspace 和 API，仍受各业务权限约束 | 官方 CLI、外部用户 API 连接 |
| 任务 token：`mat_` | 绑定 user、workspace、agent、run；最长 24 小时，运行结束清理 | 运行中的 Agent 回调；不能作为长期管理器凭据 |
| `mcn_` / `mdt_` | Cloud Node / daemon 的机器身份凭据 | 内部执行基础设施；不作为用户连接方案 |
| `mpi_` / `mpc_` | Plugin API 接受的插件凭据族 | 仅用于相应插件安装与调用上下文 |

前三类及生命周期由[认证文档](https://multica.ai/docs/auth-tokens)确认；`Auth` 的 PAT 分支映射用户身份，任务 token 分支从服务器记录重建 actor、Agent、task 与 workspace 上下文，并清理伪造的 actor source。[`middleware/auth.go`](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/middleware/auth.go)

官方 CLI 浏览器登录是：建立本地临时 callback listener → 随机 state → 打开 `/login?cli_callback=…&cli_state=…` → 校验回传 state / JWT → `POST /api/tokens` 创建 90 天 PAT → `GET /api/me` 验证 → 保存官方 CLI profile。这是已核实的官方浏览器回调流程。[`cmd_auth.go`：`runAuthLoginBrowser`](https://raw.githubusercontent.com/multica-ai/multica/main/server/cmd/multica/cmd_auth.go)

Google OAuth 在服务端用于用户登录，随后签发 Multica session；这不等于 Multica 已向第三方应用提供 OAuth 授权服务器。此次未确认公开的第三方 client 注册、authorization-code + PKCE、用户 consent scopes 或 RFC 8628 device authorization grant。不能据此设计“用 Multica 登录并勾选 Agent scopes”的既有产品流程；也不能把其他集成的 device flow 当成 Multica 账号接入能力。[`handler/auth.go`：Google 登录、`IssueCliToken`](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/handler/auth.go)

`RequireHumanActor` 会拒绝机器凭据，但它只在指定接口接入，不能泛化为“所有写入都拒绝 Agent token”。例如 Agent 环境变量接口额外要求 human actor，并受 owner / admin 检查与审计约束；管理器清单不需要读取此接口。[actor guards](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/handler/actor_guards.go)、[Agent env 授权](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/handler/agent_env.go)

## 产品范围优先于技术权限

用户随后明确只管理自有 Agent 的装备，外部 Agent 仅消费其获准提供的服务。所以下表描述 Multica 的服务端能力，不等于 Skill Manager 要全部开放：装备修改必须额外核验 Agent.owner_id 与当前认证用户 ID 相符，即使工作区管理员在服务端有更广权限也不扩大产品范围。普通 member 拥有自己的 Agent + 对外部 Agent 的单独调用授权即可覆盖首版，不默认申请 admin。不自动读取外部 Agent 的详细装备作为消费流程。

## 最小权限矩阵

下面是 **普通人类用户** 的权限矩阵，依据当前官方源码推导，写入和调用权限未作本机写请求实测。全部以同一 workspace 的有效成员资格为前提；owner/admin 指 workspace 角色，Agent owner 指该 Agent 的所有者，二者不是同一概念。

| 操作 | Agent owner（普通 member） | 被授予调用权限的非 owner member | 非 Agent owner 的 workspace owner/admin | 未获调用权限的普通 member |
| --- | --- | --- | --- | --- |
| Agent 清单 / 详情 / 运行历史可见 | 是 | 是 | 是 | 否 |
| 发起该 Agent 的执行 | 是 | 是 | 必须另外命中 Agent Access | 否 |
| 修改 Agent 配置、增减 / 启停其 Skill 绑定 | 是 | 否 | 是 | 否 |
| 修改该 Agent 的 Access | 是 | 否 | 否 | 否 |

列表通过 `memberAllowedToViewAgent` 过滤，详情与历史通过 `canAccessPrivateAgent`；管理修改走 `canManageAgent`。`UpdateAgent` 对非 Agent owner 的真实 Access 变更返回 403；仅原样回传不构成变更。[Agent handler](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/handler/agent.go)

调用授权单独走 `canInvokeAgent` / `invokeAgentDecision`。Agent owner 可调用自己的 Agent；其他人必须命中 workspace 或指定用户的授权目标，workspace 管理员没有绕过私有 Agent 调用限制的特权。Agent 间调用会追溯原始人类发起者；无该发起者时的系统调用仅允许 workspace-wide 的目标。此处不能用“看得见”代替“能调用”。[调用与可见性授权源码](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/handler/agent_access.go)、[官方角色文档](https://multica.ai/docs/members-roles)

Skill 内容与 Agent 装备权限也分开：

| 资源 / 操作 | 最小权限 | 对管理器的含义 |
| --- | --- | --- |
| 修改 workspace Skill 正文 / 支持文件 | Skill creator，或 workspace owner/admin | 会影响该远端技能实体，不能从“能调用 Agent”推导 |
| 本地导入覆盖已有 Skill | 原 Skill creator | 不能用通用 admin 管理权限推断覆盖获准 |
| Agent 添加、替换、移除、启停 Skill 绑定 | Agent owner，或 workspace owner/admin | 属于 Agent 管理权，不要求成为所有 Skill 的 creator |
| 绑定跨 workspace Skill | 不允许 | 必须先有目标 workspace 内的明确实体映射 |
| 使用私有 runtime 绑定 Agent | runtime owner | workspace admin 身份不能绕过 runtime 私有性 |

Skill 的 `canManageSkill`、`canOverwriteSkillByLocalImport`、四个绑定写 handler 及 `validateAgentSkillIDsInWorkspace` 支持前四行。[`skill.go`](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/handler/skill.go) Runtime 边界见[官方 daemon / runtimes 文档](https://multica.ai/docs/daemon-runtimes)。这里的 runtime owner 限制用于选择 / 绑定私有 runtime，不能改写成“调用一个已授权 Agent 的人必须拥有其 runtime”。Agent 调用权仍走上表的独立检查。`ListAgentSkills` 只调用 `loadAgentForUser`，该方法的完整授权链本轮未展开验证；适配器应只为成功可见清单中的 Agent 请求绑定，不能据此假定所有按 ID 读取都共享详情的私有性校验。

Agent Access 的新字段应以 `permission_mode` / targets 为准，legacy `visibility` 不能完整表达“指定人可调用”。member target 是用户 ID，而非 workspace member 行 ID。`public_to` 在没有可解析 target 时会归一化成整个 workspace；因此不要用空的 `public_to` 表达“不给任何人”，也不要自动补写缺失权限字段。[`agent_permission.go`](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/handler/agent_permission.go)

## Workspace header 兼容性

官方文档使用 `X-Workspace-ID`；安装 `0.4.39` 的 client 使用过 `X-Workspace-Slug`。当前服务端接受两者，也支持对应 query 参数；必须先解析 workspace，再验证成员或角色。两处解析辅助函数的 header / query 优先顺序不完全相同，因此适配器只发送一种规范字段：**获得 UUID 后发送 `X-Workspace-ID`，不混发 slug 或 workspace query**。Slug 仅用于显示或明确的旧客户端兼容。[`middleware/workspace.go`：`ResolveWorkspaceIDFromRequest`、`resolveWorkspaceUUID`](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/middleware/workspace.go)

对于 `mat_`，服务端以 token 绑定的 workspace 为权威，并对 URL 指向其他 workspace 的情况执行额外校验；客户端 header 不能扩大其范围。Header 支持已经由公开服务端代码确证；安装版 client 对当前真实服务的具体请求是否成功，应以主任务的只读结果为准。

## Plugin Action API：有专门权限模型，能力仍不足

`/v1` 是源码明确标记的稳定、整体版本化 Plugin Action API。其入口通过 `PluginBearerOnly`，仅接受 `mpi_` / `mpc_`；浏览器插件使用独立的 `/api/plugin-bridge/v1` session relay。后者由 host 传递 installation 上下文，iframe 不持有用户凭据。这不是让任意外部客户端复用 Multica cookie 的接口。[`router.go`：public Plugin routes 与 bridge](https://raw.githubusercontent.com/multica-ai/multica/main/server/cmd/server/router.go)

| 管理器所需能力 | 公开 Plugin v1 是否覆盖 | 已核实的 v1 边界 |
| --- | --- | --- |
| 列出 Agent / runtime / Skill 库 | 否 | 路由清单没有这些资源 |
| 添加、移除、启停 Agent 的 Skill | 否 | 没有 Agent-Skill junction 操作 |
| 创建任务、分配 Agent、再运行 | 否 | 没有对应写操作 |
| 读写 issue 部分信息 / 评论 | 是 | scope 包括 `issues:read/write`、`comments:read/write` |
| 插件自身存储 | 是 | storage 的 scope / key 操作 |

路由集合只有 context、issue GET/PATCH、comments GET/POST、plugin storage。共享 credential 类型中虽出现 user OAuth / PAT，源码注释将其定位为未来入口复用；实际 `/v1` 挂载仍是 plugin-only。[公开 v1 路由描述](https://raw.githubusercontent.com/multica-ai/multica/main/server/pkg/publicapi/v1/routes.go)

OpenAPI 中 issue PATCH 只允许 title / description，comment POST 明确不触发 mention dispatch，所以不能借“更新 issue”或“发评论”绕出运行能力。`If-Match` revision 有定义；`Idempotency-Key` 被标作未来预留，不能当成已生效的重试保证。[官方 v1 OpenAPI](https://raw.githubusercontent.com/multica-ai/multica/main/server/pkg/publicapi/v1/openapi.yaml)

证据限制：已读到路由入口、scope 合约与 OpenAPI；本轮网页工具没有成功取得 `plugin_auth.go` 和具体 Plugin action handler 正文，所以没有完成每个 scope 拒绝分支的源码核验，也没有实际申请插件凭据测试。可确证“存在插件专门的 scope 合约与入口限制”，不能声称“部署在本机所连服务上的全部 scope 都已实测生效”。即便这些 scope 全部生效，也不会补出缺失的 Agent / Skill / run 能力，因此不改变接入路线。

## 接口覆盖与验证方法

以下 `/api` 路由由安装版 client 或当前官方服务端代码确认存在；写接口均只检查源码，未实际调用。路由入口见[官方 server router](https://raw.githubusercontent.com/multica-ai/multica/main/server/cmd/server/router.go)。

| 意图 | 接口 | 本轮允许的验证方式 |
| --- | --- | --- |
| 服务版本 / 当前身份 / workspace | `GET /api/config`、`GET /api/me`、`GET /api/workspaces` | 只读读取并保留必要元数据 |
| Agent 与当前装备 | `GET /api/agents`、`GET /api/agents/:id`、`GET /api/agents/:id/skills` | 成功结果投影；不透传 mcp_config、env 或 token |
| Skill 库与元数据 | `GET /api/skills`、`GET /api/skills/:id` | 清单优先；完整正文仅在编辑/版本同步确有需要时读取 |
| 装备增量添加 | `POST /api/agents/:id/skills/add` | 源码确认，不执行 |
| 装备全量替换 | `PUT /api/agents/:id/skills` | 源码确认，不执行；单件装备不能误用此操作 |
| 启停 / 卸载绑定 | `PUT /api/agents/:id/skills/:skillId/enabled`、`DELETE /api/agents/:id/skills/:skillId` | 源码确认，不执行 |
| 发起工作 / 再运行 | `POST /api/issues`、`POST /api/issues/:id/rerun` | 源码和触发规则确认，不执行 |
| 聊天发起执行 | `POST /api/chat/sessions`、`POST /api/chat/sessions/:id/messages` | 源码确认，不执行 |
| 运行与结果读取 | `GET /api/agents/:id/tasks`、`GET /api/issues/:id/task-runs`、`GET /api/tasks/:id/messages` | 将来针对用户选择的运行读取；本轮不遍历私人历史 |

Issue 分配给 Agent 并满足状态规则、聊天消息、特定评论提及等可以触发执行；`backlog` 不触发。创建普通记录不应一概描述成“必然启动任务”。[官方触发文档](https://multica.ai/docs/triggering-agents)

只读成功最多证明该服务接受了这次读请求、当前身份可看见返回的资源。它不证明写权限、Agent 调用权限、runtime 可用、模型凭据就绪、额度充足或任务完成。也不能通过发送一次预计会被拒绝的写请求来“测试权限”：如果它实际获准，就已产生副作用。

连接诊断应保留明确类别：缺少 workspace 上下文、认证失败、权限拒绝、资源/路由不存在、网络或服务端错误、成功但清单为空。单独 404 不足以区分“不支持该能力”和“资源不存在”；CLI exit code 也不能单独推断用户登录状态。接口返回后再进行白名单投影，原始 stderr / 配置不得直接回显。

## 账号接入与最小权限方案

1. **本机验证沿用已有正式连接。** 主任务已确认账号与 workspace，不要求用户再次登录。固定 CLI 绝对路径，以结构化参数执行受控只读命令；子进程 stdout 先解析，再只返回角色、部署、技能摘要。不要读取 CLI 配置或将 shell 执行器直接暴露为网页接口。
2. **桌面产品的直接 HTTP 连接由本机 Tauri 后端保管凭据。** 当前用户说的 SaaS 是默认 UI 风格，不代表要新增云端账户托管或多租户服务。若后续采用直接 HTTP，将连接固定到本地连接 ID、Multica service origin、Multica user ID 和 workspace UUID，凭据放在系统钥匙串；前端不保存 token。后端对操作及资源设 allowlist，默认先建立读能力，用户执行装配或运行动作时只发送那一项明确请求。这是 Skill Manager 自己的约束，不是 Multica PAT scope。
3. **业务能力按资源分开。** 可调用 Agent 的 member 可以发起工作，但不能因此修改装配；装配者需要 Agent owner 或 workspace 管理角色；修改共享 Skill 内容还要单独判断 creator / workspace 管理权限。不要为了“能装备”默认索取整个 workspace admin。
4. **需要 Multica 侧收窄权限时，优先收窄账号身份与资源授权。** 普通 member 账号只加入目标 workspace，并只取得目标 Agent 的相应访问；需要管理装配则由该账号拥有目标 Agent。此次没有确认官方 service-account 产品/API，不把普通用户账号包装成已经支持的服务账号。仅 PAT 命名或选择 workspace 不产生 token 范围限制。
5. **Cloud 与 self-hosted 采用同一身份模型、分别探测能力。** 地址、证书与实际版本独立记录；自托管登录方式依部署配置核验，不承诺其具备 Cloud 的全部服务或最新 main 能力。安装/本地 runtime 的状态与 SaaS 产品形态无冲突，执行仍可发生在用户连接的机器上。[官方 Desktop](https://multica.ai/docs/desktop-app)、[官方 runtime](https://multica.ai/docs/daemon-runtimes)

服务端授权与执行环境权限也是两层：Multica 默认运行继承 daemon 所在 OS 用户权限；角色可调用并不意味着运行有额外文件隔离。因此 runtime 的真实身份和执行模式应进入执行记录，不能从“低品阶角色”推断较低 OS 权限。[官方安全模型](https://multica.ai/docs/security-model)

## 未确证事项与后续边界

- 本机所连云服务的精确 server version、其 Plugin v1 是否部署，以及写入和执行能力，仍由后续明确授权的验证决定；本次没有启动任务或插件安装。
- 当前公开 `/api` 没有在本轮检索到与 Plugin `/v1` 相同的整体稳定契约保证；适配器应集中管理版本兼容和错误映射，不能让产品 UI 依赖原始字段形状。
- 未确认第三方 OAuth / device flow / PAT scopes / service-account API；已有证据不足以承诺这些接入体验。
- 真实执行结果只进入 review 及证据链。`completed`、成本或运行次数不直接授予 SSR；需要固定 skill 版本、装备快照、task ID 和验收事件，避免重复回流。
- 广场属于未来范围；公开角色卡面不意味着开放 Agent 调用，也不能公开私有配置。SaaS / Portal 两种界面沿用同一授权，不增加独立账户或隐式跨 workspace 权限。
