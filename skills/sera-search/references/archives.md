# 历史网页、Wiki 版本与馆藏

历史查询先明确原始 URL、目标时间、语言和要核对的事实。网页快照、Wiki 修订和馆藏记录使用不同对象；可用性、捕获时间、发布日期与正文读取分别确认。

## Wayback

`--sources wayback` 的默认 `availability` 查询 URL 或域名附近的可用快照；`--at YYYYMMDD` 或 `YYYYMMDDhhmmss` 指定目标时间。返回的最近快照可能在目标时间之前或之后，按 `captureAt` 再确认它是否满足问题的时间条件。

```bash
sera search "https://example.org/" --sources wayback --at 20200101 --json
sera search "example.org/*" --sources wayback --platform cdx --since 2019-01-01 --at 20201231 --limit 10 --json
sera read "https://web.archive.org/web/捕获时间/原始URL" --sources wayback --json
```

最后一行替换成搜索实际返回的快照 URL。CDX 查询捕获索引，当前按月折叠并遵守结果预算；索引命中保留 `snapshotVerified:false`，继续读取成功后才记录 `snapshotVerified:true`。Availability 报告可用，也不等于已经取得正文。

读取保留原始 URL、实际快照 URL、`captureAt` 和请求捕获时间。文本、HTML、JSON／XML 快照可读取，动态脚本未运行；媒体快照需要对应内容读取路径。快照受限、未收录或不可访问时按来源状态说明，不把后来的网页当成历史版本。

文本按响应头与页面编码声明解码，记录 `encoding`；旧日文页面可按 Shift-JIS／EUC-JP 取得原始文字。链接与表格边界保留，继续核对原始字段及其历史语境。

[Wayback Availability API](https://archive.org/help/wayback_api.php)和 [CDX](https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server)说明这些入口的对象和范围。

## Wikipedia 与 MediaWiki 修订

常规 `wiki` 包含中英日 Wikipedia。搜索和普通页面读取查询当前版本；需要指定历史版本时使用该站实际给出的 `oldid` 链接：

```bash
sera search "Linux" --sources wiki --platform wikipedia-en --json
sera search "Linux" --sources wiki --platform wikipedia-ja --json
sera read "https://en.wikipedia.org/w/index.php?oldid=修订ID" --sources wiki --json
```

用页面历史记录里的真实数字 ID 替换占位文本。SERA 通过 `revids` 读取该修订，并保留版本 URL、`revisionId`、`updatedAt` 与原始 wikitext。修订时间不代替文章首次发布日期；两个版本可以分别保存证据，按原始内容比较事实变化。

[MediaWiki Revisions API](https://www.mediawiki.org/wiki/API:Revisions)提供修订读取；页面历史与当前页面的引用关系继续从原站核对。

## Internet Archive 馆藏

`--sources archive` 查询馆藏标题、作者、描述等目录字段；`--platform` 可选择 `texts`、`audio`、`movies`、`software` 等媒体类型。

```bash
sera search "opensource_movies" --sources archive --json
sera search "open source" --sources archive --platform software --limit 5 --json
sera read "https://archive.org/details/opensource_movies" --sources archive --json
```

`read` 返回元数据、文件清单和 `accessConditions`，包括许可、权利声明、访问限制或借阅线索；`filesComplete` 在可校验时说明目录完整度，`filesDownloaded:0` 和 `fullContentVerified:false` 说明本次只查目录。下一步根据具体文件、访问条件和格式选择文本或媒体读取路径。

馆藏 `date` 有明确日级日期时才进入 `publishedAt`；捕获时间和修改时间分别保留。馆藏搜索的 `--since` 映射目录日期，Wayback 的时间条件对应网页捕获日期；`--at` 用于 Wayback 历史快照。

[Internet Archive Advanced Search](https://archive.org/advancedsearch.php)与 [Metadata API](https://archive.org/services/docs/api/metadata-schema/index.html)用于目录和记录核验。

观察日期：2026-11-01。当前 Node.js 22.17 环境通过环境代理取得了 Wayback availability、英文 Wikipedia 和 Internet Archive 馆藏查询的公开响应。单次成功不保证所有网址、版本、文件或媒体快照可访问，动态页面与受限馆藏仍按实际结果处理。
