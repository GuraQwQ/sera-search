# 垂直来源与材料检索

先用 `capabilities --sources 来源` 查看访问条件，再用 `channels --sources 来源 --json` 取得 `operations[].inputSchema`。`search` 和 `research` 共用 `operation`、`params`、`contentTypes`、`since`、`until`；操作参数会在实际请求前校验。日期可以表示发言、投稿、登记或出版时间，具体含义见动作说明。

## 已接入来源

| 来源 | 原生动作 | 材料与范围 |
|---|---|---|
| `aicu` | `comments`、`video-danmaku`、`live-danmaku`、`room-danmaku` | 按发言者／主播 UID 查询已收录评论与弹幕；排队 ticket、SSE 与发送时间；Cookie 可选 |
| `danmakus` | `channels`、`lives`、`live-events` | 主播、已录制场次和异步弹幕查询；Token 可选，排队任务可用 `taskId` 续读 |
| `filmot` | `subtitles` | 跨视频字幕片段及起止秒数；读取取得匹配字幕，要求 API Key，按 credits 计费 |
| `holodex` | `videos`、`channels`、`channel` | 频道、直播、切片及联动关系；要求 `X-APIKEY`，结果为元数据 |
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
| `steam` | `store`、`news`、`players` | 商店实体、AppID 公告、当前人数；规格与公告读取复用原有实现 |

以下来源提供可执行的 `pages` 站点发现与原文读取，结果标记 `accessMethod:site-search`：`operationhong`、`matsuri`、`steamdb`、`vgmdb`、`novelupdates`、`kakuyomu`、`google-patents`、`j-platpat`、`nga`、`5ch`。它们同时登记到默认站点目录，可用 `--sources sites --platform 来源` 检索。站点可访问状态、页面正文及站内历史查询范围由实际响应确认。

`laplace` 的 `local-records` 检索本地已导入记录。使用 `record --input 文件`，在请求中设置 `originSource:"laplace"`，保留实际内容、原始 URL、`method`、`observedAt` 和事件 `locator`。只检索已录制并实际导入的材料，沿用证据保留期与 `clean`。

[Steam Web API 文档](https://steamapi.xpaw.me/)提供 Valve 接口参考；`steam` 执行已映射的 Valve 读操作，`steamdb` 返回该站页面发现与提取结果，两者分别报告实际取得的数据。

## 多来源交叉核验

不同来源的参数名与动作可以不同，使用 `sourceOptions` 分别指定；公共时间范围放在顶层。下面是结构模板，将对象标识替换为本次调查实际确认的值后，通过 `search --input 文件` 或 MCP 传入：

```json
{
  "query": "需要检索的话题",
  "sources": ["aicu", "danmakus"],
  "contentTypes": ["live-danmaku"],
  "strategy": "cross-check",
  "maxSources": 2,
  "since": "2026-10-01",
  "until": "2026-10-07",
  "sourceOptions": {
    "aicu": { "operation": "room-danmaku", "params": { "uid": "主播UID" } },
    "danmakus": { "operation": "live-events", "params": { "channelUid": "主播UID" } }
  }
}
```

Aicu 和 Danmakus 的收录时间、房间和漏采范围不同；交叉核验只对共同覆盖区间进行。核对原始场次、发言时间、正文和事件标识；同一原始记录的两次采集不自动变成两条独立证据。维护方公告 Danmakus 在 2026-01-24 丢失旧历史弹幕，Aicu 也明确更新不规则、记录不完整。

## 片段、覆盖和调用预算

- `locator` 保存片段／事件／记录身份、原始出处、媒体秒数和事件时间。同 URL 的不同定位分别聚合、保存和缓存。`research` 自动传递定位并优先使用命中来源；单次 `read` 可传 `--locator JSON`。
- `newUrls` 统计新页面，`newItems` 统计新片段／事件／记录；研究续查按新材料推进，同一页面的新片段仍计为进展。
- `runs[].coverage` 返回查询范围、实际观察时间、`completeness`、`truncated`、`nextCursor` 和限制。分页结束与历史收录完整分别判断，未知保持 `unknown` 或 `partial`。游标有的映射 `params.cursor`／`offset`／`page`，有的是 JSON 参数对象；按来源的动作 Schema 传递。
- 研究 `coverage.complete` 检查对象、判据、原文引用及任务数量，不能证明来源完整收录目标时间段。
- 默认 `fallback` 分阶段调用，足量新记录后停止；`cross-check` 查询互补来源，自动选源默认最多三个，`maxSources` 可调整。显式 `sources` 保留请求顺序并最多三路并发，来源数量仍受 `maxSources` 限制。`plan` 报告选择与停止原因。
- 自动材料识别帮助选择字幕、弹幕、公开评审、模型、数据集、专利和天气等动作。已知 URL／对象 ID 继续直接读取；UID、日期、坐标或版本参数通过动作 Schema 明确提供。

原生 API、站点索引、本地记录三种获取方式在能力中可区分。付费 Key、身份权限、上游改版和网络会影响实际结果。Aicu／Danmakus 使用当前前端接口，需要在上游调整后复核。
