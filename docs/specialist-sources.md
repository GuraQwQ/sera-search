# 垂直来源与材料检索

结构化来源统一配置、免费与认证排序、科学／公共数据及 QQ／微信动作见[结构化数据连接器](connectors.md)。

`source` 是提供者，`platform` 是目标平台，`operation` 是具体动作。先用 `channels --platform 平台 --json` 发现处理该平台材料的来源，再按 `capabilities` 核对访问条件，按 `operations[].inputSchema` 和 `entrypoint` 选择调用入口。`search` 和 `research` 共用 `operation`、`params`、`contentTypes`、`since`、`until`；日期可以表示投稿、事件、登记或出版时间，具体含义见动作说明。

## 平台与材料

| 目标平台 | 提供者来源 | 实际材料 |
|---|---|---|
| `bilibili` | `bilibili`、`opencli`、`aicu`、`danmakus` 及其他已接入渠道 | 原生视频候选与元数据、OpenCLI 作品字幕；第三方已收录评论、弹幕、场次，各动作范围不同 |
| `youtube` | `youtube`、`opencli`、`filmot`、`holodex` | 视频与评论、指定视频转录、已索引字幕、频道与直播／切片元数据分别调用 |
| `twitch` | `twitch`、`chatarchive` | Helix 元数据；ChatArchive 已收录场次与免费聊天回放页 |
| `qq`／`wechat` | 同平台的头像、公开资源或公众号连接器 | 仅返回所选动作当前可取得的对象与字段 |

平台关联表示来源处理同平台的不同材料，不证明主体相同，也不使重复采集成为独立证据。按公开作品研究所需材料、预算与缺口选择动作；只有平台名时，第三方关联源不会自动逐一查询。

## 已接入来源

| 来源 | 原生动作 | 材料与范围 |
|---|---|---|
| `aicu` | `comments`、`video-danmaku`、`live-danmaku`、`room-danmaku` | 按发言者／主播 UID 查询已收录评论与弹幕；排队 ticket、SSE 与发送时间；Cookie 可选 |
| `danmakus` | `channels`、`lives`、`live-events` | 主播、已录制场次和异步弹幕查询；Token 可选，排队任务可用 `taskId` 续读 |
| `filmot` | `subtitles` | 跨视频字幕片段及起止秒数；读取取得匹配字幕，需要 API Key；免费账户档与 credits 状态确认后参与调用 |
| `holodex` | `videos`、`channels`、`channel` | 频道、直播、切片及联动关系；要求 `X-APIKEY`，结果为元数据 |
| `chatarchive` | `streams`、`replay` | Twitch 已收录场次和指定场次免费聊天回放；`replay` 关键词只筛当前页，不是全历史关键词搜索 |
| `bilibili` | `videos`；独立评论入口 | `videos` 按关键词发现公开视频，`params.page` 选择结果页；读取为视频元数据，当前没有用户搜索动作 |
| `opencli` | 按实时注册表的 `read` 动作 | YouTube `video`／`transcript`、B站 `video`／`subtitle` 分别读取作品元数据和字幕正文；字幕可选 `lang`，YouTube 可选 `mode:grouped|raw` |
| `youtube` | `videos`；独立评论入口 | Data API Key；关键词视频元数据，`pageToken` 续页，`until` 包含指定日期；实际字幕另用已配置的 OpenCLI |
| `twitch` | `channels`、`categories`、`streams`、`videos`、`clips` | Helix Token＋Client-Id；现有动作通过 `params.after` 续页，视频日期在当前页过滤 |
| `instagram` | `users`、`posts`、`hashtag`、`hashtag-top`、`self-media` | 按专业账号与授权媒体范围调用；媒体动作通过 `params.after` 续页，过滤为空的当前页仍可能有续页 |
| `wikidata` | `search`、`entity` | 匿名实体名称检索、Q／P ID 读取、声明、限定条件、参考文献、外部 ID 和站点链接；保留修订号，数据为 CC0 |
| `github` | `repositories`、`code`、`issues`、`releases` | 发布说明按仓库、tag 或 releaseId 查询，保留发布正文与附件元数据；公开动作可匿名，代码搜索需 Token |
| `vndb` | `search`、`releases` | 作品与发行版本分开；发行保留语言、平台、关联 VN、商店链接、补丁、官方与免费标记 |
| `semantic-scholar` | `papers` | 论文检索、摘要、引用计数和开放全文入口；可登记 Key，匿名额度可能限流 |
| `openreview` | `papers`、`forum` | 论文与公开评审、回复、讨论；读取保留 note、forum 和回复关系，受实际可见范围影响 |
| `huggingface` | `models`、`datasets`、`spaces` | 模型与数据集仓库、卡片字段、提交 SHA 与文件清单；Token 可选 |
| `biorxiv` | `versions`、`recent` | bioRxiv／medRxiv DOI 版本、日期区间与类别列举；`recent` 不使用 query 关键词 |
| `europepmc` | `papers` | 文献／预印本检索；可开放获取的 PMC 记录继续读取 JATS XML 全文 |
| `zenodo` | `records` | 已发布研究产物、DOI、版本与文件清单；按需另读附件 |
| `clinicaltrials` | `studies` | 临床试验登记、阶段、状态和提交结果；日期按首次公开登记时间 |
| `osv` | `package` | 包生态、包名与版本或 commit 查询；聚合包含 GHSA 在内的上游公告 |
| `github-advisory` | `advisories` | CVE／GHSA、包生态、版本和严重度；可登记 GitHub Token |
| `gdelt` | `articles`、`timeline` | 报道发现与报道量时间线；两动作窗口不同，正文继续到发布者读取 |
| `open-library` | `books` | 作品、版本、作者和 ISBN 线索；出版筛选精度为年，读取是书目记录 |
| `open-meteo` | `historical-weather`、`forecast` | 经纬度、日期和变量的气象序列；UTC 时间、单位、再分析与预报分别保留 |
| `mangaupdates` | `series` | 漫画作品及出版／发布资料，保留来源署名与页内分页 |
| `syosetu` | `novels` | なろう作品简介、作者、N-code、连载状态与更新时间；正文另读 |
| `ndl` | `catalog` | OpenSearch 书目、馆藏及单条 DC-NDL 记录；使用条件依数据提供机构 |
| `hackernews` | `posts` | Algolia 关键词、帖子与评论检索，原生读取讨论树 |
| `lobsters` | `recent` | 当前最新帖子页的关键词筛选及讨论读取；历史发现可用 `sites --platform lobsters` |
| `steam` | `store`、`news`、`players`、`reviews` | 商店实体、AppID 公告、当前人数与公开游戏评价；`reviews` 免 Key，通过 AppID、语言和排序选当前评价页 |

以下来源提供可执行的 `pages` 站点发现与原文读取，结果标记 `accessMethod:site-search`：`operationhong`、`matsuri`、`steamdb`、`vgmdb`、`novelupdates`、`kakuyomu`、`google-patents`、`j-platpat`、`nga`、`5ch`。它们同时登记到默认站点目录，可用 `--sources sites --platform 来源` 检索。站点可访问状态、页面正文及站内历史查询范围由实际响应确认。

`laplace` 的 `local-records` 检索本地已导入记录。使用 `record --input 文件`，在请求中设置 `originSource:"laplace"`，保留实际内容、原始 URL、`method`、`observedAt` 和事件 `locator`。只检索已录制并实际导入的材料，沿用证据保留期与 `clean`。

[Steam Web API 文档](https://steamapi.xpaw.me/)提供 Valve 接口参考；`steam` 执行已映射的 Valve 读操作，`steamdb` 返回该站页面发现与提取结果，两者分别报告实际取得的数据。

## 实体、发行版本与公开评价

Wikidata `search` 使用 `language`（默认 `zh`）、`type:item|property` 和 `offset`；`entity` 使用 `id` 和 `language`，未传 `id` 时将 query 作为 Q／P ID。`read wikidata:Q28865` 或实体 URL 取得记录；`wiki/Special:EntityData/Q28865.json?revision=修订号` 读取指定修订，保留原声明而不把实体关联视为独立事实证明。

GitHub `releases` 必填 `repository:owner/repo`，`page` 默认 1；`tag` 与 `releaseId` 选择一项可定位单条发布。日期仅筛当前发布页，附件保留名称、大小、digest 和下载地址，实际附件内容仍需另读。仓库、代码和 issue 搜索使用各自接口及分页。

VNDB `releases` 可按 `vnId`、`releaseId`、`steamAppId`、`externalUrl` 选择版本；没有身份参数时按 query 搜索发行标题，另可提供 `languages`、`platforms` 与 `page`。`read https://vndb.org/r...` 回读发行记录；主作品条目与某一发行版本的语言分别核对。

Steam `reviews` 必填字符串 `appId`，query 不作评价正文全文搜索。可选 `languages`（默认 `["all"]`）、`sort:recent|updated|helpful|funny`、`reviewType:all|positive|negative`、`purchaseType:all|steam|non-steam`，以及 `pageSize`、`filterOfftopic`，日期映射到接口评价区间。页统计放在 `runs[].coverage`，简明链接省略默认分页参数。把返回的 URL 和绑定 recommendationid 的 `locator` 一起传给 `read`，或用 `research` 按该定位回读。匿名页可能缓存约十分钟，热门／搞笑排序不能当作完整遍历。

```bash
sera search "Python" --sources wikidata --operation search --params '{"language":"zh"}' --json
sera read "wikidata:Q28865" --json
sera search "发布说明" --sources github --operation releases --params '{"repository":"microsoft/TypeScript","page":1}' --json
sera search "CLANNAD" --sources vndb --operation releases --params '{"steamAppId":"324160"}' --json
sera search "公开评价" --sources steam --operation reviews --params '{"appId":"105600","languages":["schinese"],"sort":"recent"}' --json
```

这些动作的 `runs[].coverage.nextCursor` 返回 JSON 参数对象，解析后作为下一次 `params`；Steam 还会先续取当前上游页中的剩余评价。YouTube `videos` 的字符串游标传到 `params.pageToken`；Twitch 和 Instagram 媒体动作传到 `params.after`。一次空页或分页结束都不能证明资料库完整收录了目标时期。

## 多来源交叉核验

不同来源的参数名与动作可以不同，使用 `sourceOptions` 分别指定。例如研究公开作品的演唱材料时，将下面的请求交给 `search --input 文件` 或 MCP，分别发现字幕片段和视频记录：

```json
{
  "query": "Bad Apple",
  "sources": ["filmot", "holodex"],
  "platform": "youtube",
  "contentTypes": ["subtitle", "video-metadata"],
  "strategy": "cross-check",
  "maxSources": 2,
  "limit": 3,
  "sourceOptions": {
    "filmot": { "operation": "subtitles", "params": { "title": "Bad Apple" } },
    "holodex": { "operation": "videos", "params": { "types": ["stream", "clip"] } }
  }
}
```

Filmot 命中字幕，Holodex 返回元数据；发现同一视频后继续核对作品、视频 ID 和实际片段。Holodex 名称匹配及日期过滤只作用于当前返回页，Danmakus `lives` 的日期也只过滤本页。Aicu `room-danmaku` 的 `params.uid` 与 Danmakus `live-events` 的 `params.channelUid` 都是主播 UID；参数按原生动作 Schema 提供。

交叉核验只比较共同覆盖范围；记录原始作品、场次、时间、正文和事件标识。同一原始记录的两次采集不自动变成两条独立证据。维护方公告 Danmakus 在 2026-01-24 丢失旧历史弹幕，Aicu 也明确更新不规则、记录不完整；无命中不能推出目标材料不存在。

## 待补动作与正确入口

缺少动作必填参数时，`search.plan.pendingActions` 列出 `source`、`operation`、`entrypoint` 和 `required`，该动作不发出请求。先按任务确认所需参数，再选择执行；待补项不是一次空结果。

`entrypoint:"read"` 对应 CLI `read URL` 或 MCP `sera_read`，`operation` 选动作，`params` 只填写该动作 Schema 的附加参数。已知视频使用 `--content-type subtitle` 可选择实际字幕，使用 `video-metadata` 选择字段记录；URL 独立传入，`lang` 和 `mode` 等选项按实时注册表提供。字幕轨道列表、作品简介与实际字幕正文分别判断。

`entrypoint:"comments"` 对应 CLI `comments URL` 或 MCP `sera_comments`，用于指定视频、歌曲或授权媒体的评论页；不能把该动作作为 `search --operation comments` 执行。Aicu 的同名原生动作属于另一份检索契约，应以渠道返回的 `entrypoint` 和 Schema 区分。

`entrypoint:"images"` 对应 `image-search`／`reverse-image` 或 MCP `sera_images`；传 `operation` 选择图片动作，输入为 `query` 或 `imageUrl`。连接器导出仅包含 `search` 定义，完整专用动作以 `channels` 为准。

## 片段、覆盖和调用预算

- `locator` 保存片段／事件／记录身份、原始出处、媒体秒数和事件时间。同 URL 的不同定位分别聚合、保存和缓存。`research` 自动传递定位并优先使用命中来源；单次 `read` 可传 `--locator JSON`。
- `newUrls` 统计新页面，`newItems` 统计新片段／事件／记录；研究续查按新材料推进，同一页面的新片段仍计为进展。
- `runs[].coverage` 返回查询范围、实际观察时间、`completeness`、`truncated`、`nextCursor` 和限制。分页结束与历史收录完整分别判断，未知保持 `unknown` 或 `partial`。游标有的映射 `params.cursor`／`offset`／`page`，有的是 JSON 参数对象；按来源的动作 Schema 传递。
- 研究 `coverage.complete` 检查对象、判据、原文引用及任务数量，不能证明来源完整收录目标时间段。
- 默认 `fallback` 分阶段调用，足量新记录后停止；`cross-check` 查询互补来源，自动选源默认最多三个，`maxSources` 可调整。显式 `sources` 保留请求顺序并最多三路并发，来源数量仍受 `maxSources` 限制。`plan` 报告选择与停止原因。
- 自动材料识别帮助选择字幕、弹幕、公开评审、模型、数据集、专利和天气等动作。已知 URL／对象 ID 继续直接读取；UID、日期、坐标或版本参数通过动作 Schema 明确提供。
- `live-chat`／`live-danmaku`、`price-history`／`game-price-history` 可用于匹配对应材料，但提供者参数与收录范围仍各自核对。游戏史价会考虑 ITAD 的历史低价和价格事件动作，所需游戏 ID 按待补项提供。

原生 API、站点索引、本地记录三种获取方式在能力中可区分。付费 Key、身份权限、上游改版和网络会影响实际结果。Aicu／Danmakus 使用当前前端接口，需要在上游调整后复核。
