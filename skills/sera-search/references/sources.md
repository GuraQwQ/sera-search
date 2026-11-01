# 来源选择与查询语法

本指南用于选择 SERA 已接入的来源，以及在需要补充搜索入口时查阅官方语法。提供者能力看 `sera capabilities`，登录记录看 `sera auth`，具体平台及可匹配操作看 `sera channels`。参数和认证要求以 CLI 帮助及来源当前文档为准。

## 按对象选路

| 需要的对象 | 优先路径 | 核验重点 |
|---|---|---|
| 普通网页、事实和产品资料 | 公开 Bing RSS，或已登记 Exa／Tavily／Brave；中文资料可选智谱／豆包 | 搜索摘要与实际正文；资料版本和发布时间 |
| Google／Bing 结果 | SerpAPI／DataForSEO，指定实际引擎 | 两个 API 入口可能共享上游索引和原始文章 |
| 代码、仓库、issue／PR | GitHub；已安装时可选 `ghgrab` | 仓库、文件、commit 和讨论间的关系；ghgrab 搜索使用 GitHub，树与文件按已知 forge 支持范围读取 |
| 新闻发现与频道目录 | `google-news`／`iptv` | RSS 聚合记录与发布者正文、频道记录与实际播放分别核对 |
| 已知网页的浏览器提取／声明字段 | `scrapling`／`metadata-parser` | 实际工具与返回内容；页面声明保留来源并继续核验 |
| 中文帖子、答案和评论 | 指定平台的 Agent Reach／OpenCLI | 是否取得完整对象，评论与正文分别记录 |
| 视频内容 | 平台读取或字幕路径 | 标题、元数据、字幕、转录分别核对 |
| V2EX 帖子／节点 | V2EX 公开读取 | 浏览／读取接口与关键词检索的区别 |
| 论文、医学与书目核验 | Crossref／OpenAlex／PubMed；arXiv 可走 OpenCLI | DOI／论文 ID；书目、摘要与全文的区别 |
| Wiki、词典、古籍、文档站 | MediaWiki 直连，或官方文档域名与站内入口 | 语言、修订与软件版本；其他实例的 API 和访问条件 |
| 软件包、标准与法规 | OpenCLI 实时渠道及官方站点 | 包名／标准编号；版本和有效状态 |
| 技能、音乐和作品数据库 | `skills`、音乐来源、`bangumi`／`anilist`／`jikan`／`mangadex`／`vndb` | 技能正文、作品 ID、语言与发行版本；简介与正文分开 |
| 歌曲／视频／授权媒体评论 | `comments URL`，选择 `bilibili`／`youtube`／`netease`／`instagram` | 逐评论 ID、原文、父子关系、排序、下一页与读取范围 |
| 图片与来源识别 | `image-search`／`reverse-image`，按关键字／Lens／动画帧／插画类型选源 | 原图、承载页面、缩略图、匹配类型和许可线索 |
| 历史网页、Wiki 旧版和馆藏 | `wayback`、含 `oldid` 的 `wiki` 读取、`archive` | 捕获时间、修订时间、原始发布日期及当前可访问性 |
| LinuxDo、小黑盒帖子与回复 | `linuxdo`／`heybox` 原生读取与 `comments` | 主题／帖子 ID、楼层顺序、游标和实际可见范围 |
| 已知网页或公开附件 | 原始 URL 的读取源 | 尽量保留原始材料 URL，避免把介绍页当附件 |

公众号文章可先通过微信站内发现，再读取 `mp.weixin.qq.com` 原文。知乎搜索结果应继续到问题、答案及需要的评论层。平台读取若只得到页面壳或摘要，应记录这次内容范围，再选择其他已可用的读取路径。

领域与站点的具体入口、其他 MediaWiki 配置、`llms.txt` 和文档索引路径见 [domains.md](domains.md)。

Reddit、Twitch、Discord、Instagram、评论、图片及作品资料的当前边界见 [platform-expansion.md](platform-expansion.md)。游戏 Wiki 使用 [game-wikis.md](game-wikis.md) 的配置组；Galgame 社区使用 [galgame.md](galgame.md) 的独立站点目录，按游戏或站点选择。

历史页面、Wiki 修订与 Internet Archive 馆藏见 [archives.md](archives.md)。`capabilities --sources` 可缩小来源清单，历史与领域来源按任务选择。

## 当前渠道范围

- 直连网页搜索：公开 Bing RSS；Exa、Tavily、Brave、智谱、豆包 Custom；SerpAPI／DataForSEO 的 Google 与 Bing 自然结果。
- 直连结构化查询：GitHub 仓库与代码，Crossref DOI／书目、OpenAlex Works、PubMed 记录和 MediaWiki 页面。
- 直连读取：以上支持读取的来源，以及 V2EX 公开资料、网页和公开文本附件。B站直连公开搜索与详情，详情是视频元数据。
- Agent Reach：枚举当前统一 CLI 声明的搜索与读取渠道；配置好后也参与默认网页查询。
- OpenCLI：依据实时注册表匹配只读 `search`，接受 `query` 或 `keyword` 位置参数。论文、软件包、社区、电商与中文平台均由实际清单决定。
- OpenCLI 原文读取：目前匹配微信、知乎、小红书、B站及声明完整链接参数的已知 `read` 入口。搜索命中不自动表示该站点有原文映射。
- 领域 API：skills.sh、Bangumi、AniList、Jikan、MangaDex、VNDB、MusicBrainz、Last.fm、ListenBrainz、Discogs，以及 Twitch、Discord、Instagram 的选定对象。
- 独立动作：评论按 `comments` 逐页获取；关键词图片和反向识图按各来源的 `images` 能力调用。B站评论、Brave 图片、SerpAPI 图片附在原来源上。
- 站点目录：`sites` 按所选平台域名发现公开页面，使用已登记网页后端或公开 Bing RSS；游戏 Wiki 与 Galgame 社区目录分别按需加载。
- 档案与论坛：`wayback` 查最近快照／CDX 捕获索引，`archive` 查馆藏；`linuxdo` 与 `heybox` 读取原生主题、帖子和评论。
- 扩展后端：`ghgrab`、`scrapling` 的统一来源用于仓库与网页取证，`backend`／`sera_backend` 发现完整上游工具和输入 Schema；Scrapling 内存会话在同一 MCP 连接保持，跨进程恢复用上游 save／load。
- RSS 与目录：`google-news` 提供新闻条目和聚合记录，`iptv` 提供 Free-TV 频道与流地址线索；`metadata-parser` 提供现成 HTML 的声明分组，也可增强 `web` 原始 HTML 读取。内容边界、安装与兼容范围见[扩展来源与后端](../../../docs/integrations.md)。

2026-10-31 的本机渠道发现快照匹配到 86 个 OpenCLI 搜索入口，其中 29 个不需要浏览器，57 个需要浏览器。Google 的 `keyword` 参数已被识别。快照表示签名匹配；运行状态和质量通过实际请求确认，后续以 `sera channels` 为准。

无浏览器例：`arxiv`、`openalex`、`pubmed`、`dblp`、`npm`、`crates`、`maven`、`wikipedia`。浏览器例：`google`、`weixin`、`zhihu`、`xiaohongshu`、`douyin`、`reddit`、`boss`、`cnki`。对需要不同正文路径的站点，使用 `research --read-sources web` 或其他已配置读取源。

浏览器要求与登录要求分别判断：公开 OpenCLI 渠道直接查询，账号渠道需对应平台登录记录。用 `login opencli --platform 平台` 验证官方登录流程；Agent Reach 用 `login agent-reach --platform 平台` 同步已有会话。API Key／API 账号经 `login --stdin` 或 `--from-env` 登记。需要凭据但未登记或认证失效时返回“未登录，不可用”；额度和网络错误保留实际原因。

## 网页与 API 查询

Google 的精确短语、`site:`、`filetype:`、排除词和时间条件见 [官方运算符说明](https://support.google.com/websearch/answer/2466433?hl=en)。`site:` 搜索是候选发现；[官方说明](https://developers.google.com/search/docs/monitor-debug/search-operators/all-search-site)明确它不会保证返回该范围内全部已索引页面。

Exa 的查询适合描述想找到的材料；Brave 等关键词检索可使用页面上预计出现的名称和术语。API 的域名与日期过滤采用该 API 的真实参数。使用 `--domain`／`--since` 时，检查来源是否支持该过滤。

`bing` 是公开 RSS 搜索入口，已取得有界真实响应；它不支持统一发布日期过滤，也不保证请求的数量或全站索引完整度。`sites` 返回 `discoveryBackend` 等线索，说明目录查询实际用了哪个后端，正文继续用 `research --read-sources web` 或实际平台读取源。

先限定已知机构、域名、文档类型或时间，再根据缺口放宽。中文技术问题可以追加英文名称或术语变体，保留原始查询与各来源实际使用的条件。

## GitHub 与学术

[GitHub 代码搜索语法](https://docs.github.com/en/search-github/github-code-search/understanding-github-code-search-syntax)包含 `repo:`、`org:`、`path:`、`language:`、`symbol:` 和正则表达式。网页代码搜索与 REST／CLI 的支持范围可能不同；`symbol:` 主要查定义，调用关系需要继续阅读代码。

[OpenAlex 搜索说明](https://docs.openalex.org/api-entities/works/search-works)采用自己的短语、布尔表达式和字段过滤。论文去重优先使用 DOI 或数据库论文 ID；[Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)可核对书目信息与更新元数据。科学结论仍需要正文证据。本包的 Crossref、OpenAlex、PubMed 公开查询无需 Key；读取结果明确为元数据记录，需要全文时继续到开放访问链接或出版者。

## 可扩展的获取路径

- [RSS／Atom](https://www.rssboard.org/rss-specification)用于近期条目和增量发现。
- [Sitemap](https://www.sitemaps.org/protocol.html)用于站点 URL 发现；`lastmod` 表示更新线索。
- [CKAN API](https://docs.ckan.org/en/latest/api/)可发现数据集和原始资源，页面说明、CSV／JSON 等资源应分别记录。
- 标准、法规和专利应记录有效版本与状态；[IETF Datatracker](https://datatracker.ietf.org/api/)和 [EPO OPS](https://www.epo.org/en/searching-for-patents/data/web-services/ops)是后续适配候选。

## 后续搜索引擎候选

[Mojeek](https://www.mojeek.com/about/technology.html)使用自建索引，可增加不同索引的召回结果；命中的文章依然可能属于同一原始来源。

[SearXNG](https://docs.searxng.org/dev/search_api.html)可自托管聚合其他引擎。结构化输出需要实例启用，结果应保留实际上游，便于识别与直接搜索的来源重合。

[Yandex Search API](https://yandex.cloud/en/docs/search-api/concepts/web-search)是地域检索的候选，需要在接入时核对当前参数与额度。上述候选由后续适配器接入；当前可调用源由 SERA 的能力列表给出。

## 已接入 API 的实际范围

| 来源 | 认证与当前实现 | 过滤和内容边界 |
|---|---|---|
| [智谱 Web Search](https://docs.bigmodel.cn/api-reference/%E5%B7%A5%E5%85%B7-api/%E7%BD%91%E7%BB%9C%E6%90%9C%E7%B4%A2) | `zhipu`，Bearer Key；纯检索，配置 `engine` 可选 `search_std`／`search_pro`／`search_pro_sogou`／`search_pro_quark` | 查询最多 70 字符；按引擎映射 API 条件，再按已知域名／发布日期过滤；无正文读取 |
| [豆包搜索 Custom](https://www.volcengine.com/docs/87772/2272953) | `doubao`，独立搜索专用 Bearer Key；当前为网页搜索 | 查询最多 100 字符；域名、日期和 `finance`／`game`／`health`／`gov` 行业条件；当前返回标题、链接和摘要 |
| [SerpAPI](https://serpapi.com/search-api) | `serpapi`，API Key；网页 `--platform google`／`bing` | 自然搜索结果及独立关键词图片／Lens 动作；Google 网页映射日期条件，Bing 按已知发布日期本地过滤 |
| [DataForSEO](https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/) | `dataforseo`，API 用户名／密码 Basic 认证；Google／Bing organic live advanced | `languageCode`／`locationCode` 配置地域，默认 `en`／`2840`；Google 支持日期条件，当前 Bing 路径无日期过滤 |
| [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)／[OpenAlex](https://docs.openalex.org/how-to-use-the-api/api-overview)／[PubMed](https://www.ncbi.nlm.nih.gov/books/NBK25501/) | 公开检索和单记录读取；OpenAlex／PubMed Key 可选 | DOI、作者、书目和可能存在的摘要／开放访问链接；元数据与全文分别获取 |
| [MediaWiki](https://www.mediawiki.org/wiki/API:Main_page) | `wiki`，公开 Search／Revisions API；七个默认站点，可配置 `wiki.sites` | 中英日 Wikipedia；`oldid` 读取指定修订并保留版本 URL；修订时间为 `updatedAt` |
| [skills.sh](https://skills.sh/) | `skills`，官方 CLI 使用的公开 `/api/search` | 技能标题、所属仓库与安装线索；正文和提交版本继续到 GitHub 核对 |
| [Bangumi](https://github.com/bangumi/api)、[AniList](https://docs.anilist.co/)、[Jikan](https://docs.api.jikan.moe/)、[MangaDex](https://api.mangadex.org/docs/)、[VNDB](https://api.vndb.org/kana) | `bangumi`、`anilist`、`jikan`、`mangadex`、`vndb` 的公开资料查询 | 作品、名称、别名、类型、关联 ID 与元数据；用户列表、受限数据和章节图片按平台范围判断 |
| [MusicBrainz](https://musicbrainz.org/doc/MusicBrainz_API)、[ListenBrainz](https://listenbrainz.readthedocs.io/en/latest/users/api/) | MusicBrainz 选 `recording|artist|release`；ListenBrainz 选 `user`，查询输入用户名 | 音乐实体及用户公开播放统计；MusicBrainz 设置有意义 UA 并节流 |
| [Last.fm](https://www.last.fm/api)、[Discogs](https://www.discogs.com/developers) | `lastfm`、`discogs`，登记对应 Key／Token | 歌曲、艺人或发行记录；公开方法与用户会话操作分开 |
| [Twitch](https://dev.twitch.tv/docs/api/reference/)、[Discord](https://docs.discord.com/developers/resources/message.md)、[Instagram](https://developers.facebook.com/docs/instagram-platform/) | `twitch` Token＋`clientId`；`discord` Bot Token＋`guildId`；`instagram` Token＋专业账号 `accountId` | 分类／频道等元数据、获授权服务器消息、专业账号／hashtag／授权媒体，详见平台指南 |
| 视频／歌曲评论、关键词图片、来源匹配 | `comments`、`image-search`、`reverse-image` | 分页、父子关系、匹配类型与图片来源保留在结构化结果；范围由各动作和来源决定 |
| [Wayback](https://archive.org/help/wayback_api.php)、[Internet Archive](https://archive.org/advancedsearch.php) | `wayback` 的 availability／CDX；`archive` 的馆藏目录 | `--at` 选择目标捕获时间；快照与元数据读取范围见档案指南 |
| [LinuxDo](https://linux.do/)、[小黑盒](https://www.xiaoheihe.cn/) | `linuxdo` Discourse 搜索／主题／楼层，`heybox` Bing 发现＋官网原生帖／评论 | 公开样本和权限以实际响应为准；可选 Key／用户名或完整网站 Cookie |

`steam` 区分商品规格、公告列表与单条公告：`steam:105600`／商店链接读取公开 `api/appdetails`；`allnews`、公告列表和 `ISteamNews/GetNewsForApp/v2` 链接读取新闻记录，返回 `contentScope:news-list` 及截断范围；单条公告从实际页面中的对应记录读取全文，保留新闻流、事件和公告各自的标识，不能将它们直接视为同一个 ID。列表截断时按返回的续查时间继续获取，不用最新公告替代指定历史公告。

`nicovideo` 使用 [Snapshot API](https://site.nicovideo.jp/search-api-docs/snapshot) 与公开 ThumbInfo 元数据，`sm8628149` 可直接读取。商店语言字段与投稿元数据不等于游戏文件、完整视频、字幕或评论。2026-11-01 本机已取得 Terraria 商店规格和 Bad Apple 原投稿元数据。

默认搜索的顺序由 `intent` 决定，有有效候选后停止；显式 `sources` 并行取全部指定来源。空或无关结果继续换源，`aliases` 同时帮助词面相关性判断；初始后端耗尽后最多检索首个不同别名。过程见 `runs[].attempts`，别名重试跳过已确认未登录或限流的后端。

智谱和两个 SERP 来源在命中记录中保存 `searchEngine`。API 入口不同不表示索引或原始材料独立。搜索后需要正文时，显式使用 `research --read-sources web` 或其他正文源。

智谱搜索工具按调用计费。豆包[计费](https://www.volcengine.com/docs/87772/2272951)区分按量和订阅，当前使用 Custom 网页搜索专用 Key；IAM 和方舟模型联网路径按各自接口处理。SerpAPI 的图片动作与网页自然搜索分别选路，DataForSEO 当前接自然结果；新闻、地图等垂直服务按实际适配状态确认。正式使用前核对当前额度与条款。

## 后续 API 优先级

1. [Context7](https://context7.com/docs/api-guide)：需要 Bearer Key 的文档 `/api/v3/search`／`fetch`，补文档版本与相关片段定位。
2. [Europe PMC](https://europepmc.org/RestfulWebService)、CKAN、IETF Datatracker／EPO OPS：分别补开放全文、数据集、标准与专利的结构化查询。
3. Mojeek／SearXNG：分别补不同索引、可自管聚合；依据新增有效来源和维护成本选择。
4. [Firecrawl Search](https://docs.firecrawl.dev/features/search.md)／[Parallel Search](https://docs.parallel.ai/search/search-quickstart.md)：先评估搜索到相关正文的成功率和费用，再决定接入。

新增 API 应返回同一套命中和原文契约，保留提供者、原始发布者、内容类型和失败原因。中文平台的账号开放 API、发布 API 与全站搜索授权范围不同，接入前核对实际可读数据。

SERA HTTP 请求支持环境代理与 `NO_PROXY`；Node.js 22.17 下的代理调用已取得英文 Wikipedia、Wayback 与馆藏查询响应。观察日期：2026-11-01，当前注册 49 个来源。公开网页、学术、作品数据库、部分游戏 Wiki、B站评论、小黑盒原生帖／评论等取得有界结果；付费 Key、社交授权和完整覆盖未逐一验证。Europe PMC／SEC 保留为扩展候选。
