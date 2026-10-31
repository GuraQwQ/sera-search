# 登录记录

用户明确提供 API Key 或 API 账号用于登录时，可直接登记到指定 SERA 数据目录。MCP 调用 `sera_login`，传 `source` 和 `credentials: {apiKey}`；Twitch 用 `{apiKey, clientId}`，DataForSEO 用 `{username, password}`。CLI 用 `login --stdin` 输入纯 Key／JSON，或 `login --from-env 变量名` 登记已有环境变量。用 `auth`／`sera_auth` 查看状态，`logout`／`sera_logout` 清除记录。

```bash
sera login exa --from-env EXA_API_KEY
sera auth exa --json
sera login opencli --platform zhihu
sera login agent-reach --platform xiaohongshu
sera auth opencli --platform zhihu --json
```

API 返回“已记录”，请求才验证 Key。凭据来源无有效记录或认证失效时，认证文案为“未登录，不可用”，JSON 保留 `NOT_LOGGED_IN`。公开来源直接查询。Discord 需配置 `guildId`，Instagram 需专业账号 `accountId`；网易云需用户自建 API 的 `baseUrl`。限流、配额、权限和网络失败按实际错误处理。

LinuxDo 可选 `{apiKey, username}`，小黑盒可选 `apiKey` 保存网站 Cookie；公开内容可先匿名请求，受限对象按实际响应处理。

平台用户名／密码通过对应后端的官方登录流程使用。OpenCLI 可打开登录页面，明确登录成功或 `whoami` 验证后才记录；需要用户完成网页验证时等待其操作。Agent Reach 当前仅同步后端已有登录。登录等待不算成功，部分平台退出需要在后端或官网完成。登录记录和旧配置迁移备份是含凭据的本地 JSON；`clean` 清理证据缓存并保留它们。


来源需要的凭据与服务入口见 [来源指南](sources.md)；返回任务流程见 [SKILL.md](../SKILL.md)。
