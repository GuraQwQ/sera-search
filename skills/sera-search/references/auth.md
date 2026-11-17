# 登录记录

用户明确提供 API Key 或 API 账号用于登录时，可直接登记到指定 SERA 数据目录。优先用 CLI `login --stdin` 输入纯 Key／JSON，或 `login --from-env 变量名` 登记已有环境变量。用 `auth` 查看状态，`logout` 清除记录。普通运行设置可通过 `config --sources` 查看、`config --input` 校验更新，认证字段由 `login` 管理。

首次配置可在真实终端运行 `sera install --home ./.sera`，或无人值守运行 `sera install --home ./.sera --yes --sources github,youtube --json`。向导只补齐支持的环境变量和已有工具入口，保留既有活动凭据字段及停用项。API 不发送验证请求；已保存的 OpenCLI／Agent Reach 平台记录自动复核，新平台需明确选择，例如 `install --platform opencli:zhihu`，非交互仅验证已有会话。向导选项见[CLI](../../../docs/cli.md#安装配置与调用后端)。

```bash
sera login exa --home ./.sera --from-env EXA_API_KEY
sera auth exa --home ./.sera --json
sera login opencli --home ./.sera --platform zhihu
sera login opencli --home ./.sera --platform zhihu --session-only
sera login agent-reach --home ./.sera --platform xiaohongshu
sera auth opencli --home ./.sera --platform zhihu --json
```

MCP 提供相同流程：`sera_setup` 在服务固定的 `home/config` 中执行非交互补齐，`sera_config` 读改受校验的运行设置。`sera_login` 的 `credentials`、`fromEnv`、`platform` 必须且只能选一条路径，例如从服务进程环境登记 Key：

```json
{"source":"exa","fromEnv":"EXA_API_KEY"}
```

`fromEnv` 只传变量名，读取 MCP 服务器启动时继承的环境；客户端或终端后来添加的变量需重新启动服务后才可用。用户直接提供 Key 时用 `credentials:{"apiKey":"…"}`，Twitch 用 `apiKey/clientId`。平台仅验证已有会话时传 `{"source":"opencli","platform":"zhihu","sessionOnly":true}`；`sessionOnly` 仅适用于平台，默认 `false`，可按后端官方流程打开登录页并等待用户完成验证。状态查询与清除使用 `sera_auth`／`sera_logout`，完整接口见[MCP 指南](../../../docs/mcp.md#配置与会话)。

API 返回“已记录”，请求才验证 Key。凭据来源无有效记录或认证失效时，认证文案为“未登录，不可用”，JSON 保留 `NOT_LOGGED_IN`。公开来源直接查询。Discord 需配置 `guildId`，Instagram 需专业账号 `accountId`；网易云需用户自建 API 的 `baseUrl`。限流、配额、权限和网络失败按实际错误处理。

CLI `--session-only` 仅与 `login --platform` 合用，通过已有后端会话验证，不打开登录页；需要用户登录时再使用普通平台登录流程。MCP 注册与平台登录分别处理，多个 Agent 共享 SERA 目录也仍需核对对应后端会话。

认证与免费档分别确认。混合账单或费用未知入口需要核对账号免费档后设置 `sources.<来源>.freeTierConfirmed: true`，也可向 `install` 明确传 `--confirm-free-tier 来源列表`；`--yes` 不代替确认，也不打开登录页。普通免费 Key 来源按其声明使用。免费档声明不限制上游账单，访问和费用规则见[连接器指南](../../../docs/connectors.md)。

LinuxDo 可选 `{apiKey, username}`，小黑盒可选 `apiKey` 保存网站 Cookie；公开内容可先匿名请求，受限对象按实际响应处理。

平台用户名／密码通过对应后端的官方登录流程使用。OpenCLI 可打开登录页面，明确登录成功或 `whoami` 验证后才记录；需要用户完成网页验证时等待其操作。Agent Reach 当前仅同步后端已有登录。已有平台会话明确认证失效时，本地登录记录标记失效并保留凭据字段；网络失败不会作废记录。登录等待不算成功，部分平台退出需要在后端或官网完成。登录记录和旧配置迁移备份是含凭据的本地 JSON；`clean` 清理证据缓存并保留它们。


来源需要的凭据与服务入口见 [来源指南](sources.md)；返回任务流程见 [SKILL.md](../SKILL.md)。
