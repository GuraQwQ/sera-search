# 配置来源

可选账号和地理组件通过 `install --components aliens-eye,sherlock,gods-eye-view` 安装，配置项使用同名的 `{command,args,enabled}`；安装成功会写入实际入口。扩展工具的 Schema、预算和数据源配置见[账号与地理扩展](extensions.md)。

编辑数据目录内的 `config.json`，或通过 `--config`／`SERA_CONFIG` 指定配置文件。完整字段见 [config.example.json](../config.example.json)。配置保存 API 入口、搜索引擎、地域和启用状态；凭据单独存入数据目录的 `credentials/`。数据目录的优先级为 `--home`、`SERA_HOME`、配置中的 `home`、默认用户目录。

## 首次配置与补齐

先指定数据目录，例如源码工作区的 `--home ./.sera` 或 `--home F:/tools/sera-data`，使配置、依赖与缓存落在选定位置，避免使用 C 盘用户目录。真实终端运行 `install` 默认进入向导；无人值守用 `install --yes --json`，非终端或 `--json` 模式不提问。完整参数见[CLI 安装配置](cli.md#安装配置与调用后端)。

```bash
node dist/cli.js install --home ./.sera
node dist/cli.js install --home ./.sera --yes --sources github,youtube,opencli --json
```

向导探测已有原生工具入口，从受支持环境变量补齐凭据和账号设置；既有活动凭据按字段保留。仅本轮新建模板中的组件可在探测成功后自动启用，既有 `enabled:false` 保留；交互中可另外选择启用已停用组件。

通用 Key 名为 `SERA_<来源大写且连字符转下划线>_API_KEY` 或 `<来源大写且连字符转下划线>_API_KEY`，也识别下列常用变量：

| 来源 | 环境变量 |
|---|---|
| GitHub／Hugging Face／YouTube | `GITHUB_TOKEN`／`GH_TOKEN`、`HF_TOKEN`、`YOUTUBE_API_KEY` |
| Twitch | `TWITCH_ACCESS_TOKEN`、`TWITCH_CLIENT_ID` |
| Discord | `DISCORD_BOT_TOKEN`、`DISCORD_GUILD_ID`、`DISCORD_CHANNEL_ID` |
| Instagram | `INSTAGRAM_ACCESS_TOKEN`、`INSTAGRAM_ACCOUNT_ID` |
| LinuxDo／网易云／授权公众号 | `LINUXDO_USERNAME`、`NETEASE_BASE_URL`、`WECHAT_ACCESS_TOKEN`，分别补用户名、已有服务地址与自己授权账号的 Token |

API 凭据仅登记，实际调用时验证；探测工具不下载软件，下载由 `--components` 明确选择。已保存的 OpenCLI／Agent Reach 平台记录自动复核，新平台通过 `--platform 后端:平台` 或交互选择加入。非交互仅验证已有会话，真实终端需要时进入官方登录页。`--yes` 不发起网页登录，也不确认费用；免费档可在交互中逐项选择，或明确传 `--confirm-free-tier 来源列表`。

Agent 主要通过 CLI 与 Skill 使用同一数据目录；MCP 注册按 `--mcp-client` 选择已有客户端，客户端配置目录与 SERA 的 `--home` 分别管理。Pi、OMP、Claude Code、Antigravity 可在单客户端调用中用 `--mcp-config` 明确配置文件；默认位置落在未使用的 C 盘目录时，先指定 F 盘等实际数据盘路径。Hermes、OpenClaw 和 Codex 沿用其官方 CLI 的环境与配置定位。客户端路径、格式与出处见[MCP 适配表](mcp.md#客户端适配)。

| 来源 | 凭据 | 获取能力 |
|---|---|---|
| `exa`、`tavily` | 各服务 API Key | 网页搜索与正文提取 |
| `bing`、`sites` | 公开查询 | Bing RSS 网页发现；按独立目录域名选站查询 |
| `brave`、`zhipu`、`doubao` | 各服务 API Key | 网页搜索；Brave 另有图片动作，智谱可选引擎，豆包可按行业筛选 |
| `serpapi` | API Key | Google、Bing 自然结果、关键词图片和 Lens 识图动作 |
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
| `ghgrab`、`scrapling` | 已安装命令入口及后端自身需要的访问条件 | 仓库查询、网页提取与完整后端工具 |
| `metadata-parser` | 安装 metadata-parser 的 Python 与桥接路径 | HTML 页面声明元数据，并可增强 `web` 原始 HTML 读取 |
| `google-news` | 公开 RSS | 新闻条目、发布者与聚合 URL；按语言、国家和版别选择目录 |
| `iptv` | 公开 M3U 目录 | 频道字段、流 URL 与 EPG 线索 |

## 查看与更新运行配置

Agent 可以通过 CLI `config` 查看当前运行设置；MCP 使用同一契约的 `sera_config`。返回来源设置、后端入口、连接器摘要与文件位置，凭据不在投影中返回。

```bash
node dist/cli.js config --home ./.sera --sources github,opencli --json
node dist/cli.js config --home ./.sera --input ./source-settings.json --json
```

例如将以下内容保存为 `source-settings.json`；`updates` 按来源合并设置，后端入口放在 `backends`：

```json
{
  "sources": ["github", "opencli"],
  "updates": {"github": {"enabled": true, "userAgent": "your-project/1.0"}},
  "backends": {"opencli": {"enabled": true}}
}
```

| 输入字段 | 用途 |
|---|---|
| `sources` | 来源 ID 数组，仅筛选返回的配置；CLI `--sources` 优先 |
| `updates` | 按来源 ID 合并 `enabled`、`baseUrl`、`userAgent`、`engine`、`languageCode`、`locationCode`、`clientId`、`accountId`、`guildId`、`channelId`、`freeTierConfirmed` |
| `backends` | 更新 `opencli`、`agent-reach`、`ghgrab`、`scrapling`、`metadata-parser`、`aliens-eye`、`sherlock`、`gods-eye-view` 的 `command`、`args`、`enabled`；启用前需已有完整入口 |
| `connectorFiles` | 替换外部定义文件列表，路径相对当前配置文件目录 |
| `connectors` | 完整连接器定义数组，按 ID 合并；来源设置可在同一次请求中更新 |

输入经校验后保存；Key、密码通过 `login`／`sera_login` 管理，数据目录由 CLI 启动参数或 MCP 服务启动时确定。用户已核对免费档后，才将 `freeTierConfirmed` 设为 `true`。动态连接器格式见[连接器指南](connectors.md)。

外部连接器声明文件移动或删除后，可通过 `config --input` 或 MCP `sera_config` 提交 `{"connectorFiles":[]}` 移除引用，也可替换成新的文件列表。更新先合并补丁，再校验完整的新配置及引用，通过后原子保存；失败保留原文件。普通业务调用继续报告失效引用，MCP 服务仍可通过配置工具完成修复。同一服务进程内的登录、向导和配置更新按配置文件排队，保留各自修改。

## 动态来源与连接器

`sources` 按来源 ID 保存统一设置，例如 `enabled`、`baseUrl`、`userAgent` 与 `freeTierConfirmed`；它覆盖同名顶层来源的对应字段。API Key 继续通过 `login` 登记，活动凭据记录优先。

```json
{
  "sources": {
    "modrinth": {"enabled": true, "userAgent": "your-project/1.0 (contact@example.org)"}
  },
  "connectorFiles": ["./connectors/community.json"],
  "connectors": []
}
```

`connectorFiles` 的相对路径以当前配置文件所在目录为基准；文件内容可为单个连接器对象或对象数组。`connectors` 用于内联定义。定义按 ID 合并，后加载的同名定义优先；自定义来源 ID 可直接用于 CLI `--sources` 和 MCP 的 `sources`。通过 `sera connectors`／`node dist/cli.js connectors` 或 MCP `sera_connectors` 导出当前定义，协议、动作与字段映射示例见[连接器指南](connectors.md)。

## 免费档、配额与选路

来源与动作通过 `access` 声明认证、计费、配额及非商业限制，`capabilities` 返回 `priority` 与 `automatic`。自动选路优先匿名免费、认证免费，再考虑周期免费配额；认证加配额的来源低于匿名配额来源。普通每秒／每分钟限速仍按免费处理，日／月免费额度保留并降权；付费必需动作和一次性试用排除，同一服务的免费与付费动作分别处理。

混合计费或计费未知的入口返回 `FREE_TIER_UNCONFIRMED`，需要先核对账号当前免费档，再设置 `sources.<来源>.freeTierConfirmed: true`。已知免费 Key 来源按其声明使用。此字段记录用户对档位的确认，不能限制上游账单；调用仍需检查实际额度、条款和非商业限制。

OpenAlex 匿名入口按 `free-quota` 使用免费每日预算；带 Key 的入口因可能续用已购余额，按 `mixed` 处理，需要确认免费档并设置 `sources.openalex.freeTierConfirmed: true`。匿名额度耗尽时等待重置或换源，带 Key 时还需核对账户余额与扣费设置。

## 可选组件

安装扩展依赖时显式传 `--components ghgrab,scrapling,metadata-parser`。`--python` 指定已有 Python 3.10+；`--browser` 指定已有 Chromium／Edge 可执行文件。组件安装到 `<home>/tools`，缓存集中到 `<home>/cache/integrations`，成功后把绝对命令路径写入配置。空状态、部分安装及中断后均可重复执行相同的 `install` 命令。用 `clean` 清理受管理缓存会保留依赖、配置和会话数据。详细安装步骤见[扩展来源与后端](integrations.md)。

[配置示例](../config.example.json)中的三个命令模板默认禁用，安装后由 `install` 填入实际路径；手动配置时使用原生可执行文件与独立参数数组。`ghgrab` 的参数为 `["mcp"]`，Scrapling 使用 `scrapling-mcp`，`metadata-parser` 使用 Python 加包内 `bridges/metadata_parser.py` 的绝对路径。

`google-news` 支持 `languageCode`、`country`、`edition` 和可选 `topicId`。默认 `en-US`／`US`／`US:en`；配置 `topicId` 后读取该主题 RSS，查询词不再用于关键词 RSS。`baseUrl` 可替换新闻服务入口。`iptv.baseUrl` 是 M3U 目录的完整 URL，默认读取 [Free-TV/IPTV](https://github.com/Free-TV/IPTV) 的 `playlist.m3u8`。这两个来源直接参与 `capabilities`、`search` 与 `read`，无需安装 Python 组件。

用 `login --from-env` 登记已有环境变量，或用 `login --stdin` 传入纯 Key／凭据 JSON：

```powershell
node .\dist\cli.js login exa --home ./.sera --from-env EXA_API_KEY
$env:TAVILY_API_KEY | node .\dist\cli.js login tavily --home ./.sera --stdin
@{ apiKey = $env:TWITCH_ACCESS_TOKEN; clientId = $env:TWITCH_CLIENT_ID } |
  ConvertTo-Json -Compress | node .\dist\cli.js login twitch --home ./.sera --stdin
node .\dist\cli.js login youtube --home ./.sera --from-env YOUTUBE_API_KEY
node .\dist\cli.js auth --home ./.sera --json
node .\dist\cli.js logout exa --home ./.sera
```

环境变量经登记后成为本地登录记录。API 登录返回“已记录”，下一次请求才验证凭据；需要凭据的渠道无有效记录或被上游确认认证失效时，纯文本查询只返回“未登录，不可用”，JSON 保留 `runs` 和 `NOT_LOGGED_IN` 状态。限流、余额不足和网络失败按实际错误记录。

`login --from-env` 与 MCP `sera_login.fromEnv` 更新 Key 时保留已有有效记录中的 `clientId` 等辅助字段，适合轮换 Twitch Token。显式凭据 JSON（CLI `--stdin` 或 MCP `credentials`）完整替换该条凭据，需包含本次要保存的所有字段。

同一服务进程中的凭据更新按单个文件排队，旧请求的认证失败只影响它实际使用的记录。取消登录或退出会阻止尚未开始的文件操作；已完成的凭据保存会保留，后续启用步骤可重试。

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
node dist/cli.js login opencli --home ./.sera --platform zhihu
node dist/cli.js login agent-reach --home ./.sera --platform xiaohongshu
node dist/cli.js auth opencli --home ./.sera --platform zhihu --json
node dist/cli.js logout opencli --home ./.sera --platform zhihu
```

OpenCLI 可打开官方登录页面并通过明确的登录结果或 `whoami` 验证，用户完成网页验证后才记录。Agent Reach 当前同步后端已有登录，调用其 `login --sync`。平台用户名／密码需在对应后端的官方登录流程使用；SERA 的凭据 JSON 用于对应 API 声明的认证字段。部分平台无后端退出命令，`logout` 会清除本地记录并提示到后端或官网退出。OpenCLI 的配置与缓存目录位于 SERA 数据目录；Agent Reach 浏览器状态仍由其后端管理。

各搜索 API 有独立额度与计费。按任务选择来源和读取预算；费用以 [Exa](https://exa.ai/pricing)、[Tavily](https://www.tavily.com/pricing)、[Brave](https://brave.com/search/api/) 及[来源指南](../skills/sera-search/references/sources.md)链接的官方文档为准。豆包使用独立搜索服务的专用 Key。
