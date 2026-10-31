# 配置来源

编辑数据目录内的 `config.json`，或通过 `--config`／`SERA_CONFIG` 指定配置文件。完整字段见 [config.example.json](../config.example.json)。配置保存 API 入口、搜索引擎、地域和启用状态；凭据单独存入数据目录的 `credentials/`。数据目录的优先级为 `--home`、`SERA_HOME`、配置中的 `home`、默认用户目录。

| 来源 | 凭据 | 获取能力 |
|---|---|---|
| `exa`、`tavily` | 各服务 API Key | 网页搜索与正文提取 |
| `bing`、`sites` | 公开查询 | Bing RSS 网页发现；按独立目录域名选站查询 |
| `brave`、`zhipu`、`doubao` | 各服务 API Key | 网页搜索；Brave 另有图片动作，智谱可选引擎，豆包可按行业筛选 |
| `serpapi`、`dataforseo` | SerpAPI Key／DataForSEO API 用户名与密码 | Google、Bing 自然结果；SerpAPI 另有关键词图片和 Lens 识图动作 |
| `github` | 可选 GitHub Token | 公开仓库和资料可匿名访问；代码搜索需要 Token |
| `crossref`、`openalex`、`pubmed`、`wiki` | 公开查询；OpenAlex／PubMed Key 可选 | DOI、论文书目、摘要及公开 Wiki 页面 |
| `skills` | 公开查询 | skills.sh 技能检索，继续到所属 GitHub 仓库核对正文与版本 |
| `bangumi`、`anilist`、`jikan`、`mangadex`、`vndb` | 公开资料查询 | 动画、漫画、视觉小说及作品记录；用户数据与平台权限按接口判断 |
| `musicbrainz`、`listenbrainz` | 公开资料查询 | 音乐实体、播放记录或关联数据，具体对象见来源指南 |
| `lastfm`、`discogs` | 各服务 API Key／Token | 音乐检索、发行记录与唱片资料 |
| `bilibili`、`youtube`、`netease` | B站公开；YouTube Key；网易云自建 API 入口 | 视频／歌曲资料和逐页评论；网易云需配置第三方服务器 `baseUrl` |
| `baidu-images`、`sogou-images`、`trace-moe`、`saucenao` | 前三者公开入口；SauceNAO Key | 关键词图片、动画帧或插画来源匹配，具体动作按来源区分 |
| `twitch`、`discord`、`instagram` | Twitch Token＋Client-Id；Discord Bot Token；Instagram Token | 直播对象、获授权服务器消息、专业账号／hashtag／授权媒体评论 |
| `wayback`、`archive` | 公开查询 | 网页历史快照、捕获索引、Internet Archive 馆藏及文件目录 |
| `linuxdo`、`heybox` | 公开入口，可选 API 凭据／网站 Cookie | 原生主题或帖子读取、逐页评论；可见范围以站点响应为准 |
| `steam`、`nicovideo` | 公开查询 | Steam AppID、商店规格与公告；Niconico 视频标识、投稿时间与作者元数据 |

用 `login --from-env` 登记已有环境变量，或用 `login --stdin` 传入纯 Key／凭据 JSON：

```powershell
node .\dist\cli.js login exa --from-env EXA_API_KEY
$env:TAVILY_API_KEY | node .\dist\cli.js login tavily --stdin
@{ username = $env:DATAFORSEO_USERNAME; password = $env:DATAFORSEO_PASSWORD } |
  ConvertTo-Json -Compress | node .\dist\cli.js login dataforseo --stdin
@{ apiKey = $env:TWITCH_ACCESS_TOKEN; clientId = $env:TWITCH_CLIENT_ID } |
  ConvertTo-Json -Compress | node .\dist\cli.js login twitch --stdin
node .\dist\cli.js login youtube --from-env YOUTUBE_API_KEY
node .\dist\cli.js auth --json
node .\dist\cli.js logout exa
```

环境变量经登记后成为本地登录记录。API 登录返回“已记录”，下一次请求才验证凭据；需要凭据的渠道无有效记录或被上游确认认证失效时，纯文本查询只返回“未登录，不可用”，JSON 保留 `runs` 和 `NOT_LOGGED_IN` 状态。限流、余额不足和网络失败按实际错误记录。

登录记录是本地 JSON，包含 API Key 或 API 账号，需保管数据目录。读取旧配置时会先备份，再迁移其中的凭据；`migrations/` 备份也可能包含旧凭据。迁移可重复执行，已登记的凭据优先。

Discord 在配置中填写 `guildId`，可选 `channelId`；Instagram 填写专业账号 `accountId`。Twitch 的 `clientId` 可随 Token 登记。MusicBrainz 等有站点调用要求的来源可设置 `userAgent`。网易云使用用户已经部署的 [api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)服务，配置 `netease.baseUrl` 并启用该来源；SERA 负责调用接口。

LinuxDo 可登记 `{apiKey, username}`，分别映射 Discourse 的 `Api-Key` 与 `Api-Username`。小黑盒可将完整网站 Cookie 登记为 `heybox` 的 `apiKey`；公开样本已经返回原生帖子与评论，可选凭据用于站点允许的账号范围。

SERA 的 HTTP 请求支持环境中的 `HTTP_PROXY`／`HTTPS_PROXY`／`NO_PROXY`，也识别相应小写变量；本机 loopback 请求直接连接。代理仅设置在 SERA 的 HTTP 调用边界，CLI 后端沿用自己的网络配置。Node.js 22.17 环境已通过代理取得英文 Wikipedia、Wayback 与馆藏查询的真实响应。

Agent Reach 和 OpenCLI 使用用户已经安装的工具：

```json
{
  "agentReach": {
    "command": "agent-reach",
    "args": [],
    "enabled": true
  },
  "opencli": {
    "command": "opencli",
    "args": [],
    "enabled": true
  }
}
```

Windows 上若命令入口是 `.cmd` 或 `.ps1`，请配置真正的运行时。例如 Agent Reach 可使用 `python.exe` 加 `args: ["-m", "agent_reach.cli"]`；OpenCLI 可使用 `node.exe` 加已安装 CLI 的 JavaScript 入口。SERA 通过参数数组启动进程，查询字符串作为独立参数传递。

Agent Reach 使用上游统一 CLI 的 `channels`、平台动作和 `read` 协议。平台依赖与浏览器会话由 [Agent Reach](https://github.com/Panniantong/Agent-Reach) 或 [OpenCLI](https://github.com/jackwener/OpenCLI) 管理。浏览器渠道还需其浏览器桥接或专用浏览器就绪。公开渠道直接查询；账号渠道需要经后端验证的 SERA 平台登录记录：

```bash
node dist/cli.js login opencli --platform zhihu
node dist/cli.js login agent-reach --platform xiaohongshu
node dist/cli.js auth opencli --platform zhihu --json
node dist/cli.js logout opencli --platform zhihu
```

OpenCLI 可打开官方登录页面并通过明确的登录结果或 `whoami` 验证，用户完成网页验证后才记录。Agent Reach 当前同步后端已有登录，调用其 `login --sync`。平台用户名／密码需在对应后端的官方登录流程使用；SERA 的 `username/password` 输入用于 DataForSEO 等 API 账号。部分平台无后端退出命令，`logout` 会清除本地记录并提示到后端或官网退出。OpenCLI 的配置与缓存目录位于 SERA 数据目录；Agent Reach 浏览器状态仍由其后端管理。

各搜索 API 有独立额度与计费。按任务选择来源和读取预算；费用以 [Exa](https://exa.ai/pricing)、[Tavily](https://www.tavily.com/pricing)、[Brave](https://brave.com/search/api/) 及[来源指南](../skills/sera-search/references/sources.md)链接的官方文档为准。豆包使用独立搜索服务的专用 Key。
