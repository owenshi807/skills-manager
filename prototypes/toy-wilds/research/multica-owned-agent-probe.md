# Multica 自有 Agent 只读核验与本轮角色边界

核查时间：2026-09-09 18:03–18:13（Asia/Shanghai）。本记录只保留必要的身份关系与字段证据，不保留个人 UUID、邮箱、原始 Agent 配置、凭据或任务正文。

## 实际结论

安装的 Desktop / 内置 CLI 为 `0.4.39`；CLI build commit 为 `0eff894b5`。本次沿用现有正式 CLI profile `desktop-api.multica.ai`，指定已有工作区 `<selected-workspace>` 的 UUID，成功读取当前认证用户和 10 个可见 Agent。10 个 Agent 均返回有效 `owner_id`，但全部与当前认证用户的 `id` 不同。因此本次观测为 **已连接、可见 10 个、自有 0 个**。

这不是“用户未登录”，也不是“清单读取失败”。本次没有确认两个不同用户 ID 是否属于同一现实中的人；产品不得根据相同姓名、工作区成员身份、管理员权限或清单可见性将它们合并。未知所有权不授予管理权。

## 可复核的只读命令

固定可执行文件：

```text
/Applications/Multica.app/Contents/Resources/app.asar.unpacked/resources/bin/multica
```

使用结构化参数调用，无 shell 拼接：

```text
--profile desktop-api.multica.ai user profile get --output json
--profile desktop-api.multica.ai --workspace-id <已选择的工作区 UUID> agent list --output json
```

CLI `auth status --help` 没有 `--output` 参数；不解析或透传其含 token 前缀的文本作为用户身份。`user profile get --help` 则明确支持 JSON。实际命令 stdout 在内存中解析后才投影，未打印原始 JSON 或读取 CLI 配置文件。首次受沙箱网络限制的读取失败由正式只读重试成功覆盖，不能从此前错误推断登录状态。

身份返回投影只需 `id`、`name`。Agent 清单实际存在的白名单字段为 `id`、`name`、`workspace_id`、`owner_id`、`description`、`runtime_id`、`model`、`runtime_bound`、`runtime_mode`；本次没有独立的 `role` 或 `capabilities` 字段。角色简介可使用 `description`，不得从完整 instructions、环境变量或 MCP 配置中拼装。所有权比较必须使用同一服务、同一连接下的 `agent.owner_id === user.id`。

## ID 语义证据

- 安装版二进制 `main.runUserProfileGet` 的反汇编及只读常量核对确认调用 `APIClient.GetJSON`，路径参数为 `/api/me`；不是独立 profile 行的接口。
- [官方 CLI `cmd_user.go`](https://github.com/multica-ai/multica/blob/main/server/cmd/multica/cmd_user.go) 的 `runUserProfileGet` 同样 GET `/api/me` 并以 JSON 输出返回对象。
- [官方服务端 `auth.go`](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/handler/auth.go) 的 `GetMe` 通过认证上下文 `requireUserID` 查询 `GetUser`，`userToResponse` 将 `User.ID` 写入响应 `id`。因此这里的 `id` 是认证用户主键。
- [官方 Agent handler](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/handler/agent.go) 与[调用授权实现](https://raw.githubusercontent.com/multica-ai/multica/main/server/internal/handler/agent_access.go)区分可见、管理、调用；“看得见”不证明所有权或任务已可执行。更完整的权限边界见[前轮核验记录](./multica-auth-permissions.md)。

安装版行为来自本次本机核验；链接中的 `main` 是公开实现证据，不代表已确认云端部署版本。没有运行写权限探针，没有创建、调用、修改或转移 Agent。

## 本轮实现范围：独立本地角色与配装

本轮角色 Profile 和卡牌配置以本地角色为主体；用户可自建角色，每个角色独立保存选中的 Skill ID。Profile 只呈现当前角色携带的卡牌，Armory 呈现正式只读库存的全部卡牌。角色切换不得共享或串改配装，刷新失败保留上一份有效库存与本地选择；读取成功但为空与读取失败分开显示。

本地选择不表示 Multica Agent 已绑定 Skill，不改变远端 Agent，也不隐式增加执行能力。卡牌翻转、倾斜、装备与本地保存只属于当前产品交互；任务完成、运行次数或装备数量不自动授予 SSR。

本轮不新增 Multica adapter、不推断这 10 个可见 Agent 为自有角色、不改变现有账号或登录。未来真实对接时，以服务 origin、workspace UUID 和 Agent UUID 组成稳定资源引用，重新核验当前用户与 owner，并将本地草稿、远端绑定和验收结果分别记录。广场、外部 Agent 服务消费、任务执行与结果回流继续留在未来范围。
