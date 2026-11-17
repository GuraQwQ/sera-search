# 登录记录

用户明确提供 API Key 或 API 账号用于登录时，可直接登记到指定 SERA 数据目录。MCP 调用 `sera_login`，传 `source` 和 `credentials: {apiKey}`；Twitch 用 `{apiKey, clientId}`。CLI 用 `login --stdin` 输入纯 Key／JSON，或 `login --from-env 变量名` 登记已有环境变量。用 `auth`／`sera_auth` 查看状态，`logout`／`sera_logout` 清除记录。

首次配置可在真实终端运行 `sera install --home ./.sera`，或无人值守运行 `sera install --home ./.sera --yes --sources github,youtube --json`。向导只补齐支持的环境变量和已有工具入口，保留既有活动凭据字段及停用项。API 不发送验证请求；已保存的 OpenCLI／Agent Reach 平台记录自动复核，新平台需明确选择，例如 `install --platform opencli:zhihu`，非交互仅验证已有会话。向导选项见[CLI](../../../docs/cli.md#安装配置与调用后端)。

```bash
sera login exa --home ./.sera --from-env EXA_API_KEY
sera auth exa --home ./.sera --json
sera login opencli --home ./.sera --platform zhihu
sera login agent-reach --home ./.sera --platform xiaohongshu
sera auth opencli --home ./.sera --platform zhihu --json
```

API 返回“已记录”，请求才验证 Key。凭据来源无有效记录或认证失效时，认证文案为“未登录，不可用”，JSON 保留 `NOT_LOGGED_IN`。公开来源直接查询。Discord 需配置 `guildId`，Instagram 需专业账号 `accountId`；网易云需用户自建 API 的 `baseUrl`。限流、配额、权限和网络失败按实际错误处理。

认证与免费档分别确认。混合账单或费用未知入口需要核对账号免费档后设置 `sources.<来源>.freeTierConfirmed: true`，也可向 `install` 明确传 `--confirm-free-tier 来源列表`；`--yes` 不代替确认，也不打开登录页。普通免费 Key 来源按其声明使用。免费档声明不限制上游账单，访问和费用规则见[连接器指南](../../../docs/connectors.md)。

LinuxDo 可选 `{apiKey, username}`，小黑盒可选 `apiKey` 保存网站 Cookie；公开内容可先匿名请求，受限对象按实际响应处理。

平台用户名／密码通过对应后端的官方登录流程使用。OpenCLI 可打开登录页面，明确登录成功或 `whoami` 验证后才记录；需要用户完成网页验证时等待其操作。Agent Reach 当前仅同步后端已有登录。已有平台会话明确认证失效时，本地登录记录标记失效并保留凭据字段；网络失败不会作废记录。登录等待不算成功，部分平台退出需要在后端或官网完成。登录记录和旧配置迁移备份是含凭据的本地 JSON；`clean` 清理证据缓存并保留它们。


来源需要的凭据与服务入口见 [来源指南](sources.md)；返回任务流程见 [SKILL.md](../SKILL.md)。
