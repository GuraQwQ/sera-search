# 来源选择与查询语法

本指南用于选择 SERA 已接入的来源，以及在需要补充搜索入口时查阅官方语法。提供者能力看 `sera capabilities`，登录记录看 `sera auth`，具体平台及可匹配操作看 `sera channels`；结构化连接器看 `sera connectors`／MCP `sera_connectors`。参数和认证要求以 CLI 帮助及来源当前文档为准。

字幕、直播记录、公开评审、研究产物、书目、漏洞、气象及专利等入口见[垂直来源与动作](../../../docs/specialist-sources.md)。先查动作 Schema，再按公开作品任务需要补参数；Aicu `room-danmaku.params.uid` 与 Danmakus `live-events.params.channelUid` 指主播 UID，按共同覆盖区间核对原始事件。

`source` 是提供者，`platform` 是目标平台，`operation` 是动作。用 `channels --platform youtube` 可发现 YouTube、Filmot 与 Holodex，`twitch` 可发现 Twitch 与 ChatArchive；`bilibili`、`qq`、`wechat` 也关联原生与第三方入口。按所需材料、预算和证据缺口选择，关联不证明主体相同或数据独立，第三方关联源不会在缺少明确材料或动作时自动逐一查询。

动作缺必填参数时，`search.plan.pendingActions` 返回 `source/operation/entrypoint/required`，该动作不请求。`entrypoint:read` 使用 `read URL`／`sera_read`，`operation`、`params` 和 `contentTypes` 选择实际读取材料；`comments` 使用 CLI `comments`／MCP `sera_comments`，`images` 使用 `image-search`／`reverse-image` 或 `sera_images`。专用动作看 `channels --json`，连接器导出仅含 `search` 定义。待补项与无命中都不能推出目标材料不存在。

## 按对象选路

| 需要的对象 | 优先路径 | 核验重点 |
|---|---|---|
| 普通网页、事实和产品资料 | 已登记的通用网页来源或公开 Bing；按目标材料选实际入口 | 搜索摘要与实际正文；资料版本、发布时间与目标相关性 |
| 候选发现与比较选型 | 少量互补的网页、社区原帖、B站介绍与 GitHub 集成记录；规则再追发布者 | 对象身份、用户必需条件与证据充分程度；广告和实际观测分别使用 |
| Google／Bing 结果 | SerpAPI，指定实际引擎 | API 入口与原始文章分别核验，多个引擎可能共享同一材料 |
| 代码、仓库、issue／PR、发布说明 | GitHub；已安装时可选 `ghgrab` | `releases` 按 `repository` 列出版本，按 `tag` 或 `releaseId` 取单条；附件元数据与文件正文分别核验 |
| 新闻发现与频道目录 | `google-news`／`iptv` | RSS 聚合记录与发布者正文、频道记录与实际播放分别核对 |
| 已知网页的浏览器提取／声明字段 | `scrapling`／`metadata-parser` | 实际工具与返回内容；页面声明保留来源并继续核验 |
| 公开账号、资料关联与头像比较 | `aliens-eye`／`sherlock` 可选扩展 | 先选站点与用户名，按需读取主页和关联；检测命中与主体归属分别核验 |
| 地理对象、事件和时空数据 | `gods-eye-view` 独立扩展 | 先发现领域 Schema，再选区域、对象与预算；核对数据时间、采集范围和预测类型 |
| 中文帖子、答案和评论 | 指定平台的 Agent Reach／OpenCLI | 是否取得完整对象，评论与正文分别记录 |
| 视频与作品演唱材料 | 视频候选、Filmot 字幕、Holodex 元数据及 OpenCLI 作品读取 | 已知视频用 `read --sources opencli --content-type subtitle` 选 YouTube `transcript`／B站 `subtitle`；视频 `video` 只返回元数据 |
| Twitch 已收录场次与聊天回放 | `chatarchive` 的 `streams`／`replay` | 只覆盖已收录场次，关键词只筛回放当前页，保留时间与分页范围 |
| 游戏价格记录 | `isthereanydeal` 当前价、历史低价与价格事件 | `price-history`／`game-price-history` 可匹配，游戏 ID、地区及实际覆盖分别核验 |
| V2EX 帖子／节点 | V2EX 公开读取 | 浏览／读取接口与关键词检索的区别 |
| 论文、医学与书目核验 | Crossref／OpenAlex／PubMed；arXiv 可走 OpenCLI | DOI／论文 ID；书目、摘要与全文的区别 |
| Wiki、词典、古籍、文档站 | MediaWiki 直连，或官方文档域名与站内入口 | 语言、修订与软件版本；其他实例的 API 和访问条件 |
| 实体、数据库 ID 与站点关联 | `wikidata` 的 `search`／`entity` | 明确 Q／P ID、语言与修订号；外部 ID 和声明继续回原数据库核验 |
| 软件包、标准与法规 | OpenCLI 实时渠道及官方站点 | 包名／标准编号；版本和有效状态 |
| 技能、音乐和作品数据库 | `skills`、音乐来源、`bangumi`／`anilist`／`jikan`／`mangadex`／`vndb` | 技能正文、作品 ID、语言与发行版本；简介与正文分开 |
| 歌曲／视频／授权媒体评论 | `comments URL`，选择 `bilibili`／`youtube`／`netease`／`instagram` | 逐评论 ID、原文、父子关系、排序、下一页与读取范围 |
| 图片与来源识别 | `image-search`／`reverse-image`，按关键字／Lens／动画帧／插画类型选源 | 原图、承载页面、缩略图、匹配类型和许可线索 |
| 历史网页、Wiki 旧版和馆藏 | `wayback`、含 `oldid` 的 `wiki` 读取、`archive` | 捕获时间、修订时间、原始发布日期及当前可访问性 |
| 科研材料、科学记录与公共数据 | Europe PMC、Hugging Face、UniProt、PubChem、World Bank、Eurostat 等结构化动作 | 数据集、版本、单位、时间范围和分页限制；元数据与实际数据分别核验 |
| 已知 QQ 资源与公众号文章 | QQ 头像／公开资料、公众号／文章连接器 | 仅核对当前可见字段；默认头像不能证明账号存在，公开文章发现不代表全部历史 |
| LinuxDo、小黑盒帖子与回复 | `linuxdo`／`heybox` 原生读取与 `comments` | 主题／帖子 ID、楼层顺序、游标和实际可见范围 |
| 已知网页或公开附件 | 原始 URL 的读取源 | 尽量保留原始材料 URL，避免把介绍页当附件 |

公众号文章可先通过微信站内发现，再读取 `mp.weixin.qq.com` 原文。知乎搜索结果应继续到问题、答案及需要的评论层。平台读取若只得到页面壳或摘要，应记录这次内容范围，再选择其他已可用的读取路径。

显式来源也返回 `metadata.relevance`：`relevant` 是充分词面匹配，`uncertain` 是部分匹配，`irrelevant` 是未匹配；它们不是可信度或条件满足证明。返回重复或仅品牌相关结果时，调整实体与约束或改查材料实际出现的来源。

领域与站点的具体入口、其他 MediaWiki 配置、`llms.txt` 和文档索引路径见 [domains.md](domains.md)。

Reddit、Twitch、Discord、Instagram、评论、图片及作品资料的当前边界见 [platform-expansion.md](platform-expansion.md)。游戏 Wiki 使用 [game-wikis.md](game-wikis.md) 的配置组；Galgame 社区使用 [galgame.md](galgame.md) 的独立站点目录，按游戏或站点选择。

历史页面、Wiki 修订与 Internet Archive 馆藏见 [archives.md](archives.md)。`capabilities --sources` 可缩小来源清单，历史与领域来源按任务选择。

## 当前渠道范围

- 直连网页搜索：公开 Bing RSS；Exa、Tavily、Brave、智谱、豆包 Custom；SerpAPI 的 Google 与 Bing 自然结果，按各入口费用策略启用。
- 直连结构化查询：GitHub 仓库、代码、issue 与发布说明，Crossref DOI／书目、OpenAlex Works、PubMed 记录、MediaWiki 页面和 Wikidata 实体。
- 直连读取：以上支持读取的来源，以及 V2EX 公开资料、网页和公开文本附件。B站直连公开搜索与详情，详情是视频元数据。
- Agent Reach：枚举当前统一 CLI 声明的搜索与读取渠道；配置好后也参与默认网页查询。
- OpenCLI：依据实时注册表匹配只读 `search`，接受 `query` 或 `keyword` 位置参数。论文、软件包、社区、电商与中文平台均由实际清单决定。
- OpenCLI 原文读取：匹配微信、知乎、小红书、YouTube／B站作品及声明完整链接参数的已知 `read` 入口。视频 `video` 返回字段元数据，YouTube `transcript`／B站 `subtitle` 返回实际字幕；参数按实时注册表。
- 领域 API：skills.sh、Bangumi、AniList、Jikan、MangaDex、VNDB、MusicBrainz、Last.fm、ListenBrainz、Discogs，以及 Twitch、Discord、Instagram 的选定对象。
- 独立动作：评论按 `comments` 逐页获取；关键词图片和反向识图按各来源的 `images` 能力调用。B站评论、Brave 图片、SerpAPI 图片附在原来源上。
- 站点目录：`sites` 按所选平台域名发现公开页面，使用已登记网页后端或公开 Bing RSS；游戏 Wiki 与 Galgame 社区目录分别按需加载。
- 档案与论坛：`wayback` 查最近快照／CDX 捕获索引，`archive` 查馆藏；`linuxdo` 与 `heybox` 读取原生主题、帖子和评论。
- 扩展后端：`ghgrab`、`scrapling` 的统一来源用于仓库与网页取证，`backend`／`sera_backend` 发现完整上游工具和输入 Schema；Scrapling 内存会话在同一 MCP 连接保持，跨进程恢复用上游 save／load。
- RSS 与目录：`google-news` 提供新闻条目和聚合记录，`iptv` 提供 Free-TV 频道与流地址线索；`metadata-parser` 提供现成 HTML 的声明分组，也可增强 `web` 原始 HTML 读取。内容边界、安装与兼容范围见[扩展来源与后端](../../../docs/integrations.md)。
- 结构化连接器：覆盖科研、公共数据、基础设施、兴趣资料和已知社交对象；通过 `connectors --sources` 查看协议与定义，通过 `channels` 取得动作及输入 Schema。当前有 126 个内置来源 ID，配置可增加动态 ID；注册不代表全部可用。配置入口与范围见[连接器指南](../../../docs/connectors.md)。

来源优先按所需材料匹配，再按访问成本排序：匿名免费、认证免费、匿名周期免费配额、认证加配额。付费必需动作与一次性试用排除；同源免费与付费动作分别处理。`mixed`／`unknown` 计费需要先核对免费档，再配置 `sources.<来源>.freeTierConfirmed: true`；已知免费 Key 来源按其声明使用。查看 `access` 的配额及非商业条件、`priority` 与 `automatic`，并以实际响应确认可用范围。免费档声明不控制服务端账单。

统一配置中的 `sources` 保存每源设置，`connectorFiles` 加载外部定义，`connectors` 内联定义；动态来源沿用 `search`、`read` 与取证接口，先发现动作再调用。

无浏览器例：`arxiv`、`openalex`、`pubmed`、`dblp`、`npm`、`crates`、`maven`、`wikipedia`。浏览器例：`google`、`weixin`、`zhihu`、`xiaohongshu`、`douyin`、`reddit`、`boss`、`cnki`。对需要不同正文路径的站点，使用 `research --read-sources web` 或其他已配置读取源。

浏览器要求与登录要求分别判断：公开 OpenCLI 渠道直接查询，账号渠道需对应平台登录记录。用 `login opencli --platform 平台` 验证官方登录流程；Agent Reach 用 `login agent-reach --platform 平台` 同步已有会话。API Key／API 账号经 `login --stdin` 或 `--from-env` 登记。需要凭据但未登记或认证失效时返回“未登录，不可用”；额度和网络错误保留实际原因。

## 网页与 API 查询

Google 的精确短语、`site:`、`filetype:`、排除词和时间条件见 [官方运算符说明](https://support.google.com/websearch/answer/2466433?hl=en)。`site:` 搜索是候选发现；[官方说明](https://developers.google.com/search/docs/monitor-debug/search-operators/all-search-site)明确它不会保证返回该范围内全部已索引页面。

Exa 的查询适合描述想找到的材料；Brave 等关键词检索可使用页面上预计出现的名称和术语。API 的域名与日期过滤采用该 API 的真实参数。使用 `--domain`／`--since` 时，检查来源是否支持该过滤。

`bing` 是公开 RSS 搜索入口，已取得有界真实响应；它不支持统一发布日期过滤，也不保证请求的数量或全站索引完整度。`sites` 返回 `discoveryBackend` 等线索，说明目录查询实际用了哪个后端，正文继续用 `research --read-sources web` 或实际平台读取源。

先限定已知机构、域名、文档类型或时间，再根据缺口放宽。中文技术问题可以追加英文名称或术语变体，保留原始查询与各来源实际使用的条件。

## GitHub 与学术

[GitHub 代码搜索语法](https://docs.github.com/en/search-github/github-code-search/understanding-github-code-search-syntax)包含 `repo:`、`org:`、`path:`、`language:`、`symbol:` 和正则表达式。网页代码搜索与 REST／CLI 的支持范围可能不同；`symbol:` 主要查定义，调用关系需要继续阅读代码。

[OpenAlex 搜索说明](https://docs.openalex.org/api-entities/works/search-works)采用自己的短语、布尔表达式和字段过滤。论文去重优先使用 DOI 或数据库论文 ID；[Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)可核对书目信息与更新元数据。科学结论仍需要正文证据。本包的 Crossref、OpenAlex、PubMed 公开查询无需 Key；OpenAlex 匿名路径使用免费每日预算，带 Key 路径按混合账单处理，需确认免费档。读取结果明确为元数据记录，需要全文时继续到开放访问链接或出版者。

## 已接入 API 的实际范围

| 来源 | 认证与当前实现 | 过滤和内容边界 |
|---|---|---|
| [智谱 Web Search](https://docs.bigmodel.cn/api-reference/%E5%B7%A5%E5%85%B7-api/%E7%BD%91%E7%BB%9C%E6%90%9C%E7%B4%A2) | `zhipu`，Bearer Key，`platform:web`；`operation` 选 `search_std`／`search_pro`／`search_pro_sogou`／`search_pro_quark`，配置 `engine` 为默认 | 查询最多 70 字符；按引擎映射 API 条件，再按已知域名／发布日期过滤；无正文读取 |
| [豆包搜索 Custom](https://www.volcengine.com/docs/87772/2272953) | `doubao`，独立搜索专用 Bearer Key，`platform:web`；`operation` 选 `web`／`finance`／`game`／`health`／`gov` | 查询最多 100 字符；域名、日期和行业条件；当前返回标题、链接和摘要 |
| [SerpAPI](https://serpapi.com/search-api) | `serpapi`，API Key，`platform:web`；网页 `--operation google`／`bing` | 自然结果；独立 `images` 入口的 `operation` 为 `google_images`／`bing_images`／`google_lens`，输入 `query` 或 `imageUrl`；Google 网页映射日期条件，Bing 按已知发布日期本地过滤 |
| [Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)／[OpenAlex](https://docs.openalex.org/how-to-use-the-api/api-overview)／[PubMed](https://www.ncbi.nlm.nih.gov/books/NBK25501/) | 公开检索和单记录读取；OpenAlex／PubMed Key 可选 | DOI、作者、书目和可能存在的摘要／开放访问链接；元数据与全文分别获取 |
| [MediaWiki](https://www.mediawiki.org/wiki/API:Main_page) | `wiki`，公开 Search／Revisions API；七个默认站点，可配置 `wiki.sites` | 中英日 Wikipedia；`oldid` 读取指定修订并保留版本 URL；修订时间为 `updatedAt` |
| [skills.sh](https://skills.sh/) | `skills`，官方 CLI 使用的公开 `/api/search` | 技能标题、所属仓库与安装线索；正文和提交版本继续到 GitHub 核对 |
| [Bangumi](https://github.com/bangumi/api)、[AniList](https://docs.anilist.co/)、[Jikan](https://docs.api.jikan.moe/)、[MangaDex](https://api.mangadex.org/docs/)、[VNDB](https://api.vndb.org/kana) | `bangumi`、`anilist`、`jikan`、`mangadex`、`vndb` 的公开资料查询 | 作品、名称、别名、类型、关联 ID 与元数据；用户列表、受限数据和章节图片按平台范围判断 |
| [MusicBrainz](https://musicbrainz.org/doc/MusicBrainz_API)、[ListenBrainz](https://listenbrainz.readthedocs.io/en/latest/users/api/) | `platform` 分别为 `musicbrainz`／`listenbrainz`；`operation` 分别选 `recording`／`artist`／`release` 或 `user` | 音乐实体及用户公开播放统计；MusicBrainz 设置有意义 UA 并节流 |
| [Last.fm](https://www.last.fm/api)、[Discogs](https://www.discogs.com/developers) | `lastfm`、`discogs`，登记对应 Key／Token | 歌曲、艺人或发行记录；公开方法与用户会话操作分开 |
| [Twitch](https://dev.twitch.tv/docs/api/reference/)、[Discord](https://docs.discord.com/developers/resources/message.md)、[Instagram](https://developers.facebook.com/docs/instagram-platform/) | `twitch` Token＋`clientId`；`discord` Bot Token＋`guildId`；`instagram` Token＋专业账号 `accountId` | 分类／频道等元数据、获授权服务器消息、专业账号／hashtag／授权媒体，详见平台指南 |
| 视频／歌曲评论、关键词图片、来源匹配 | `comments`、`image-search`、`reverse-image` | 分页、父子关系、匹配类型与图片来源保留在结构化结果；范围由各动作和来源决定 |
| [Wayback](https://archive.org/help/wayback_api.php)、[Internet Archive](https://archive.org/advancedsearch.php) | `wayback` 的 availability／CDX；`archive` 的馆藏目录 | `--at` 选择目标捕获时间；快照与元数据读取范围见档案指南 |
| [LinuxDo](https://linux.do/)、[小黑盒](https://www.xiaoheihe.cn/) | `linuxdo` Discourse 搜索／主题／楼层，`heybox` Bing 发现＋官网原生帖／评论 | 公开样本和权限以实际响应为准；可选 Key／用户名或完整网站 Cookie |

`steam` 区分商品规格、公告列表与单条公告：`steam:105600`／商店链接读取公开 `api/appdetails`；`allnews`、公告列表和 `ISteamNews/GetNewsForApp/v2` 链接读取新闻记录，返回 `contentScope:news-list` 及截断范围；单条公告从实际页面中的对应记录读取全文，保留新闻流、事件和公告各自的标识，不能将它们直接视为同一个 ID。列表截断时按返回的续查时间继续获取，不用最新公告替代指定历史公告。

`steam` 的 `reviews` 通过免 Key 公开接口按 `params.appId` 获取游戏评价页，`languages`、排序和购买类型分别筛选；query 不作评价全文搜索。VNDB `releases` 按 `vnId`、`releaseId`、`steamAppId` 或 `externalUrl` 查发行版本，也可按发行标题发现；发行语言、平台与商店关系和主作品条目分别核对。Wikidata 实体、GitHub 发布说明及这些动作的完整调用与续页例子见[垂直来源](../../../docs/specialist-sources.md#实体发行版本与公开评价)。

`nicovideo` 使用 [Snapshot API](https://site.nicovideo.jp/search-api-docs/snapshot) 与公开 ThumbInfo 元数据，`sm8628149` 可直接读取。商店语言字段与投稿元数据不等于游戏文件、完整视频、字幕或评论。

默认搜索的顺序由 `intent` 决定，有有效候选后停止；显式 `sources` 并行取全部指定来源。空或无关结果继续换源，`aliases` 同时帮助词面相关性判断；初始后端耗尽后最多检索首个不同别名。过程见 `runs[].attempts`，别名重试跳过已确认未登录或限流的后端。

智谱和 SerpAPI 在命中记录中保存 `searchEngine`。API 入口不同不表示索引或原始材料独立。搜索后需要正文时，显式使用 `research --read-sources web` 或其他正文源。

智谱与豆包入口的免费档需按当前账号核对，豆包[计费](https://www.volcengine.com/docs/87772/2272951)区分按量和订阅，当前适配 Custom 网页搜索专用 Key；IAM 和方舟模型联网路径按各自接口处理。SerpAPI 的图片动作与网页自然搜索分别选路；混合计费来源确认免费档后仍需检查账号额度，新闻、地图等垂直服务按实际适配状态确认。
