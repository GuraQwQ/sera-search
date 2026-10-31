# 平台、评论、图片与作品资料

观察日期：2026-11-01。当前来源注册、CLI／MCP 动作和目录已经接通，实际可用性由配置、权限、远端响应及内容范围确认。以下说明结合 SERA 代码、本机 OpenCLI 1.8.4 注册表、官方文档和有界公开查询。

## 指定平台的覆盖

| 平台／对象 | 当前实现 | 调用与范围 |
|---|---|---|
| 百度图片 | `baidu-images` 关键词图片动作 | `image-search query --sources baidu-images`；网页内部协议按实际返回处理 |
| 搜狗图片 | `sogou-images` 关键词图片入口 | 内部关键词接口或页面初始数据；反向图片输入选择 Lens／动画帧／插画匹配来源 |
| Reddit | 平台帖子搜索与有限正文／评论读取；`sites` 可发现公开页面 | 专用平台路线按登录记录查询，正文读取保留当前后端内容范围 |
| Twitch | 官方 Helix 分类、频道、直播、视频及剪辑 | `--sources twitch --platform categories|channels|streams|videos|clips`；Token＋Client-Id |
| Discord | 官方获授权服务器消息搜索、消息读取及有限上下文 | `--sources discord --platform messages`；Bot Token、`guildId` 与可选 `channelId` |
| Instagram／ins | 专业账号、近期媒体、hashtag、授权媒体评论；上游用户搜索仍可选 | 同名来源的 `users|posts|hashtag|hashtag-top|self-media`，Token＋`accountId` |
| skills.sh | `skills` 使用官方 CLI 的公开搜索端点 | 搜索技能，再核对所属仓库、`SKILL.md` 与提交版本 |
| 游戏 Wiki | Minecraft、Terraria、THBWiki 已由当前适配器取得命中 | 使用[独立游戏 Wiki 目录组](game-wikis.md)，按游戏选择站点 |
| Galgame 社区 | 作品数据库与九组公开站点目录 | `vndb`／`bangumi` 查询记录，`sites` 加[独立目录](galgame.md)选择社区 |
| LinuxDo | Discourse 原生帖子搜索、指定楼层读取和回复分页 | `linuxdo`，可选 Api-Key＋Api-Username；按返回的可见楼层 ID 流取正文 |
| 小黑盒 | Bing 发现真实帖子，官网原生帖及评论接口 | `heybox`，可选网站 Cookie；读取单帖与根评论／子评论分页 |

本机注册表仍匹配 86 个搜索签名，其中 29 个不需浏览器、57 个需浏览器。签名并不保证登录、字段和返回内容均符合 SERA：Spotify 注册为 public，但本次请求实际要求 `spotify auth`，且只有 URI 字段；Discord UI 搜索的消息缺少 URL。Steam 已经由当前 SERA 平台适配器取得 `Portal 2` 的真实结果。

### 社区与直播的具体边界

- **Reddit**：[OpenCLI read](https://github.com/jackwener/OpenCLI/blob/main/clis/reddit/read.js)有顶层数量、回复深度、每层回复预算、正文长度和 `expand-more`。SERA 当前只传 URL，尚未暴露这些参数。[Agent Reach](https://github.com/Panniantong/Agent-Reach/blob/main/agent_reach/channels/reddit.py)包含 public-web 路径；公开网页发现与账号后端是不同入口，不能概括为所有 Reddit 访问都需登录。
- **Discord UI**：已安装版本的 [search](https://github.com/jackwener/OpenCLI/blob/v1.8.4/clis/discord-app/search.js)只读当前服务器／频道，消息截到 200 字符；[read](https://github.com/jackwener/OpenCLI/blob/v1.8.4/clis/discord-app/read.js)按 `--guild`／`--channel`／`--url` 定位，并返回消息 ID。[status](https://github.com/jackwener/OpenCLI/blob/v1.8.4/clis/discord-app/status.js)只证明桌面连接，不能充当登录证明。
- **Discord 官方**：[Search Guild Messages](https://docs.discord.com/developers/resources/message.md#search-guild-messages)要求 `READ_MESSAGE_HISTORY`，受 `MESSAGE_CONTENT` intent 限制。SERA 在配置的服务器范围查询，202 响应按 `retry_after` 有界重试，结果保留消息 ID、频道 ID、回复与修改线索。`read` 获取消息和有限邻近上下文；消息新增／删除时，返回数量不能保证完整历史覆盖。
- **Instagram**：[上游 search](https://github.com/jackwener/OpenCLI/blob/main/clis/instagram/search.js)搜索用户，`post` 是发布操作。原生来源调用官方 [Hashtag Search](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/hashtag-search.md)与 [Business Discovery](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-discovery.md)，面向专业账号及权限。hashtag 查询不请求被限制的用户名字段；Graph 分页链接转换成游标和下一页标志，避免保留 Token。`read` 的网页作品链接在授权账号首批媒体中解析，更旧对象可用 Graph 媒体 ID 链接。[评论](https://developers.facebook.com/documentation/instagram-platform/comment-moderation.md)限应用用户拥有的媒体。
- **Twitch**：[Helix Reference](https://dev.twitch.tv/docs/api/reference/)要求 Client-Id 加 App／User Access Token。SERA 分别调用分类、频道、直播、视频、剪辑接口，返回预算内对象和游标线索；读取为元数据。频道搜索不是视频标题全文检索；[Chat EventSub](https://dev.twitch.tv/docs/chat/)是实时聊天路径，当前公开接口未验证可查询任意 VOD 历史聊天。
- **LinuxDo**：原生 `search.json` 查询帖子，`read` 返回指定楼层的 raw Markdown 或 cooked HTML。`comments` 根据主题楼层 ID 流取批次，按默认／`oldest` 顺序返回。`--parent` 使用结果中的真实帖子 ID 筛选直接回复；当前扫描批次可能没有匹配评论但仍有游标，可按预算继续扫描。
- **小黑盒**：搜索按 Bing 中的实际帖子链接发现；原生 `/bbs/app/link/tree` 读取帖子和根评论，`/bbs/app/comment/sub/comments` 读取子评论。官网签名及访问条件可能变化，结果保留原始 ID 和范围；Cookie 可登记到登录记录，匿名样本已取得帖子与评论。

## 独立评论动作

`comments URL`／`sera_comments` 绑定歌曲、视频或授权媒体，获取顶层或指定父评论的回复页。每次返回 `page.comments`、`page.scope`、`page.nextCursor` 与实际截断线索；下一页传 `--cursor`，楼中楼传 `--parent`，单页请求最多 100 条。原始评论正文保存后再展示分页。

| 来源 | 当前路径 | 范围与认证 |
|---|---|---|
| Bilibili | 公开评论与回复网页接口，附在现有 `bilibili` 来源上 | 按视频对象解析 ID，顶层和父评论回复分页；一条匿名查询曾取得真实评论，其他视频按实际返回判断 |
| YouTube | 官方 [commentThreads.list](https://developers.google.com/youtube/v3/docs/commentThreads/list) 和 [comments.list](https://developers.google.com/youtube/v3/docs/comments/list) | 公开评论用已启用 Data API 的 Key。顶层 `videoId/searchTerms/pageToken`，回复 `parentId/pageToken`；内嵌 replies 不保证完整。关闭评论、配额和认证错误分别处理 |
| 网易云音乐 | 用户自建第三方 [api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) 服务 | 配置 `netease.baseUrl` 并启用；歌曲评论、排序和父评论按接口选择，服务器部署与平台状态由用户管理 |
| Instagram | 授权媒体 `comments` 和父评论 `replies` | Token＋专业账号范围；保留完整返回文本及分页游标，原 Graph 分页 URL 中的 Token 不进入结果 |
| LinuxDo | 主题楼层 ID 流与 `posts.json` 批量读取 | 游标为已扫描回复 ID 的偏移；父楼层筛选在当前批次中进行 |
| 小黑盒 | 官网默认根评论／子评论 | 根评论游标为 `页码:页内偏移`，子评论游标为最后返回的评论 ID |

[YouTube OpenCLI comments](https://github.com/jackwener/OpenCLI/blob/main/clis/youtube/comments.js)调用一次 InnerTube continuation，文本截到 300 字符，缺少 commentId 与楼中楼；适合预览，完整研究优先官方分页。YouTube 两个官方列表方法每次分别消耗一个 quota unit，单页最多 100 条；`searchTerms` 有指定视频／频道边界。

排序按来源选择：B站 `time|hot|likes`，YouTube `time|relevance`，网易云 `time|hot|recommend`，LinuxDo `default|oldest`，小黑盒当前为 `default`。游标应使用返回的 `nextCursor`：B站是页码，YouTube 是 pageToken，网易云可能是 offset、JSON 状态或楼层时间，论坛则使用自己的页／ID偏移。父评论用 `page.comments[].id`，跨源游标与 ID 不混用。

网易云旧 `Binaryify/NeteaseCloudMusicApi` 仓库已归档；`api-enhanced` 的当前维护证据与具体版本需继续核对。SERA 归一化网易云 `/#/song?id=…` 等链接时先保留资源类型和 ID，再处理 hash；第三方接口的登录与参数范围按服务器版本判断。

结果保留逐评论的 `id、parentId、rootId、text、author、publishedAt、likes` 和页面范围。首批、热点或有限回复不代表完整评论区；评论查询绑定了具体对象，不能从一次取样推断全平台评论或整体用户意见。

## 关键词图片搜索与反向识图

`image-search query` 和 `reverse-image imageURL` 分别调用关键词或图片输入路径。Brave／SerpAPI 图片能力附在现有来源，百度／搜狗图片、trace.moe、SauceNAO 使用各自来源。结果的 `metadata` 保留图片、承载页面、缩略图、匹配类型和实际后端线索；图片地址与文章证据分别核对。

- **百度图片**：`baidu-images` 调用 [image.baidu.com](https://image.baidu.com/) 的内部关键词路径；响应需要真实图片项。远端网页协议、返回格式和访问限制会变化，来源记录保留实际结果与失败原因。
- **百度 AI 图像搜索**：[官方说明](https://ai.baidu.com/ai-doc/IMAGESEARCH/Uk3bczr77)明确搜索用户自建图库，需要先入库；它不能替代百度全网搜图／识图。
- **搜狗图片**：`sogou-images` 使用 [pic.sogou.com](https://pic.sogou.com/) 的关键词接口或页面初始数据。图片 URL 输入调用反向识图来源；内部端点不是稳定开发者合约，实际返回与失败原因保留在来源记录。
- **反向识图 API**：SerpAPI 的图片动作调用 [Google Lens](https://serpapi.com/google-lens-api)，使用用户已有 Key 和输入图片 URL，返回视觉匹配与来源页。Brave 图片与 SERP 自然结果是不同动作。
- **动漫画面／插画来源**：`trace-moe` 调用 [trace.moe](https://soruly.github.io/trace.moe-api/)，`saucenao` 调用 [SauceNAO](https://saucenao.com/tools/examples/api/index.php)并要求 Key。匹配分数和时间片段只作为线索，仍需回到原作品核对。

关键词图片、OCR、物体识别和来源追溯是不同能力。当前动作以接口返回的对象和范围为准，选择来源时核对它支持的输入及匹配类型。

图片命中在 `retrievals[].metadata` 保存 `imageUrl`、`thumbnail`、`matchType` 及来源特定信息；`hit.url` 指向承载／作品页面。SerpAPI 关键词图片可选 `google|bing`，图片输入走 Google Lens。trace.moe 相似度标为 `0..1`，SauceNAO 标为 `0..100`，不同分数尺度不能直接比较。

## 音乐、动漫、漫画与宅文化

| 资料领域 | 当前来源 | 资料范围 |
|---|---|---|
| 音乐作品、艺人、发行版本 | `musicbrainz`、`lastfm`、`listenbrainz`、`discogs`；`sites` 音乐目录 | MusicBrainz 录音／艺人／发行；Last.fm 曲目／艺人；ListenBrainz 按用户名查公开播放统计；Discogs 发行／母版／艺人／厂牌 |
| 中文动画、漫画、游戏、音乐条目 | `bangumi`、官方站 | [Bangumi API](https://github.com/bangumi/api/blob/master/open-api/api.yml)作品记录、别名、ID与关联资料 |
| 动画、漫画、角色与制作人员 | `anilist`、`jikan`，官方站与资料库页面 | [AniList](https://docs.anilist.co/)和非官方 MAL 的 [Jikan](https://docs.api.jikan.moe/)记录；内容类型按结果确认 |
| 漫画作品、作者、章节与语言线索 | `mangadex`，出版社与作品官网 | [MangaDex](https://api.mangadex.org/docs/)作品资料，元数据与章节图片分别处理 |
| 视觉小说／Galgame | `vndb`、`bangumi`，官方设定与[社群目录](galgame.md) | [VNDB Kana](https://api.vndb.org/kana)作品／发行线索；用户列表、论坛内容与记录接口范围分别处理 |
| 游戏机制、攻略、东方同人 | [独立游戏 Wiki 目录组](game-wikis.md)，Steam 已取得搜索命中 | 按游戏、语言与版本扩充实例；Liquipedia 单独适配调用要求 |
| 插画、同人、社区评论 | Pixiv／豆瓣已有搜索签名；账号、内容范围和读取待核对 | 作品 ID、作者 ID 与官方作品站；讨论和作品资料分别保留来源 |
| 其他百科与实体关系 | 常规 `wiki`、Wikidata 上游搜索、官方站点域名查询 | MediaWiki 实例按站配置；Wikidata 实体／关系单独查询；非 MediaWiki 百科按实际站点接口处理 |

公开元数据不等于作品正文或所有章节均可获取。跨库去重优先作品 ID、MBID、DOI 或明确的关联 ID；复制的简介与同一 Wiki 转载不能算独立证据。Bangumi 要求包含应用／项目的 UA；AniList 有限流和按需使用条款；MusicBrainz 要求有意义的 UA 和请求节流，本次查询返回 503。各来源的登录、许可和响应范围按自己的接口处理。

## 使用顺序

1. 根据问题选择网页、作品数据库、社交对象、评论或图片动作；先确认对应来源与凭据状态。
2. 游戏 Wiki 和 Galgame 社群按需加载独立目录；优先选择当前游戏、语言和版本对应的站点。
3. 搜索取得候选后核对原文、记录 ID 和更新时间；评论继续按游标／父评论读取，图片回到承载页面核对来源。
4. 记录已检查的渠道、内容范围、支持与冲突证据，再据此形成结论。

原生 API 和上游 CLI 的内容范围可能不同。需要逐对象 ID、完整返回文本及翻页时优先对应 API；浏览器路径保留首批、截断和实际操作限制。

公开来源直接查询；需要凭据的操作沿用工具包登录记录，未记录时返回“未登录，不可用”。官方 Key、Token、多字段 OAuth 账号与浏览器会话按实际认证类型接入，Twitch 等来源不能硬塞成一个普通 API Key。

SERA HTTP 已支持环境代理，当前取得了英文 Wikipedia、Wayback、Internet Archive、Bing RSS、部分游戏 Wiki、作品记录和论坛的公开响应。小黑盒匿名帖子／评论有成功样本；其他账号、网易云自建服务、YouTube 评论 Key、社交授权、反向识图与完整覆盖尚未逐一验证。固定响应测试与公开小样分别说明协议和实际入口，不代表所有用户环境的覆盖与质量。
