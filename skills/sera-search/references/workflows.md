# 取证与缺口续查

使用同一数据目录与来源预算，按当前问题选择一步；需要检索与取证时复用 `research`，已有原始链接或证据时直接读取。

## 多字段问题

需要跨轮补查时，先把问题拆成可核验字段。CLI从首轮就指定状态文件，一次取一批材料：

```bash
sera research "某作品 发行与中文支持" --sources bing --read-sources web --goal "日本原版发行日期" --goal "国际版产品关系" --goal "中文界面与字幕" --state ./research-state.json --read-limit 3 --json
```

`research-state.json` 不存在时按 `--goal` 建立；已存在时读取并原子写回，重复执行保留Agent核验过的字段、状态及证据ID。只需一次读取的问题可直接使用 `read`，不必建立状态文件。

MCP首轮对应：

```json
{
  "query": "某作品 发行与中文支持",
  "sources": ["bing"],
  "readSources": ["web"],
  "goals": ["日本原版发行日期", "国际版产品关系", "中文界面与字幕"],
  "readLimit": 3
}
```

从 `documents` 读取片段及证据 ID，检查它是正文、官方元数据还是候选线索。`state.fields` 初始为 `pending`，`candidates` 只是待审阅证据；阅读原文后更新相应字段：支持时设 `supported`，确有矛盾时设 `conflict`，并填入实际证据 ID 和必要的 `note`。未找到材料不表示该事实不存在。

CLI直接编辑 `research-state.json` 中对应的 `fields`，再执行原命令继续：

```bash
sera research "某作品 发行与中文支持" --sources bing --read-sources web --goal "日本原版发行日期" --goal "国际版产品关系" --goal "中文界面与字幕" --state ./research-state.json --read-limit 3 --json
```

MCP在下一次 `sera_research` 直接传入更新后的 `state` 对象。保留未确认和冲突字段，以及 `examinedUrls`、候选和失败记录。`state.nextQuery` 是“原问题加一个待查字段”的下一轮建议，优先处理冲突，不把所有字段拼成长查询。`nextAction` 提示审阅、继续或完成，事实状态由agent核验。

已有证据用 `evidence` 回读；需要重新观察某页时可传 `refresh:true`。上游明确给出 `Retry-After` 时，失败记录保存 `accessFailures[].retryAt`；等待期间下一轮先跳过该URL并处理其他分支，`refresh` 也遵守这一等待条件。

CLI状态文件保存失败时，完整研究结果和返回的 `state` 仍会交付，`stateWarnings` 说明写入问题。保留报告中的状态，修复文件路径或占用后继续，不要把保存失败当作研究材料丢失。

## 已有链接或对象

```bash
sera read "steam:105600" --keyword release_date --keyword supported_languages --json
sera read-many "https://example.org/spec" "https://example.org/news" --query "中文支持何时更新" --keyword 简体 --json
sera evidence EVIDENCE_ID --keyword "発売日" --length 1000 --json
```

替换为真实链接和证据 ID。`query`／`keywords` 定位相关原文，默认读取预算为2000字符；`selection:focused` 的 `fragments` 保留原文坐标，`leading` 表示返回开头。目标未出现时补别名或跨语言词，再使用 `evidence` 的 `offset`／`length` 续读需要的部分。全文在证据 ID 下保留，不必每次输出到最大预算。

Steam商品规格、新闻列表和单条公告是不同对象；先确认AppID与实际公告链接。新闻列表返回 `metadata.truncated`，列表范围不足时根据 `nextEndDate` 继续查较早记录；单条公告读取原始对应记录，保留各自的事件／公告标识。结构化语言名单没有界面／字幕／语音分栏时，继续查表格或公告，不能由名单补出完整语言矩阵。

## 失败后的下一步

| 返回情况 | 处理 |
|---|---|
| 正常空结果／名称不符 | 检查实体、别名、语言和域名，再改查询或来源 |
| 403／权限或站点阻止 | 保留已取得材料，换当前允许且支持该对象的入口 |
| 429／限流 | 遵守 `retryAfterSeconds`，先处理其他来源或字段；不要立即重复同一受限入口 |
| 无快照／历史正文未取得 | 区分CDX索引、可用报告与实际快照；从已发现URL和历史域名定位，保留无法取证的时间段 |
| 只有标题、摘要或页面壳 | 查看 `metadata.bodyAvailable`、`contentScope` 与 `nextSteps`；`CONTENT_INCOMPLETE` 表示正文未取得，继续找原始API、正文或可用快照 |
| 部分读取失败／缓存未保存 | 使用成功材料与已返回正文，再按 `runs`／`cacheWarnings` 补查 |

显式指定的来源是调用范围，换路仍遵守用户所选来源和账号权限。实际来源、URL、发布时间、修订／捕获时间与获取时间分别保留；多次读取和转载不算独立证据。
