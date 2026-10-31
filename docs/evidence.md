# 如何使用证据

`search` 保留每个来源的执行结果和命中，合并重复 URL。`rankScore` 用于排序，表示召回位置，不能解释成事实可信度。

`research` 在搜索后读取原始材料，返回 `documents` 和 `comparison`。证据保留 URL、读取来源、原始内容类型、获取时间及来源提供的发布时间。缺少发布时间时保持缺失；获取时间表示这次观察的时间。

`read` 默认返回前2000字符；传 `--query <问题>` 或重复 `--keyword <词>` 后返回相关片段与标题位置，`selection` 区分 `focused` 和 `leading`。`fragments` 保留原文坐标，全文仍可通过 `evidence.id` 读取。`--length` 控制返回字符预算，分页使用 `nextOffset`。坐标按 Unicode 码点计数，例如 `😀` 算一个字符。

多个已知链接用 `read-many`（MCP：`sera_read_many`），最多20项、三路并行；重复 URL 合并请求，结果保持输入顺序，失败逐项返回。已知 Steam AppID、Niconico ID、DOI、PMID 可直接传给 `read` 或 `research`，无需先跑搜索。

```bash
node dist/cli.js read-many "steam:105600" "sm8628149" --keyword "release_date" --keyword "firstRetrieve" --json
node dist/cli.js read "https://example.org/article" --query "中文支持何时更新" --keyword "简体" --length 1500 --json
node dist/cli.js evidence EVIDENCE_ID --keyword "発売日" --length 1000 --json
node dist/cli.js research "某作品" --goal "发行日期" --goal "中文支持" --sources bing --read-sources web --json
```

`research` 的 `goals` 建立待核验字段，返回 `state`。agent 核验候选原文后更新 `fields[].status`（`pending`、`supported`、`conflict`）与 `evidenceIds`，下一轮原样传入 `state`；CLI 用 `--state <UTF-8 JSON文件>` 读取该对象。后续查询聚焦未确认或冲突字段，并跳过已取证 URL；访问失败的 URL 保留重试机会。`candidates` 供审阅，关键词命中不自动确认事实。`nextAction` 提示继续检索、审阅证据或完成；全部字段由调用方确认后停止联网。

相同正文可以归为重复内容组；`publisherGroups` 用于组织发布者线索。两个引擎找到同一篇文章、多个页面属于同一发布者，或文章互相转载，都不能直接算作独立证据。Agent 应根据原文和引用关系记录支持、冲突及仍待核验的事实。

部分来源超时、未配置或需要登录时，其他已成功结果仍会返回。搜索有效但没有命中与请求失败分别记录。正文不足时，读取失败仍显示在 `documents`／`runs` 中，便于 Agent 选择下一条来源。

正文已取得但证据保存失败时，读取结果为 `partial`，仍返回首段 `content` 和 `document` 元数据；`cacheWarnings` 说明缓存问题。缓存清理问题也会记录在 `cacheWarnings` 中，已经取得的内容继续交付。保存成功的证据可分页读取，需要重试缓存保存时保留原始 URL 和这次读取结果。

`read` 默认复用同一 URL 和来源在15分钟内取得的证据；明确时间的 Wayback 快照、Wiki `oldid` 可复用至 `retentionDays`，默认七天。`--refresh`／`refresh:true` 强制读取，`--max-age`／`maxAgeMs` 限定读取缓存的毫秒上限。返回 `cacheHit`、缓存年龄与原获取时间；认证失效的来源不复用其 URL 缓存。过期缓存每小时检查一次，失效 URL 索引一起回收。`clean` 删除 SERA 生成的证据缓存，保留配置、登录记录、迁移备份及未识别为 SERA 证据的文件；占用或无法处理的缓存文件保留，并在 `failures` 中列出。需要长期保留的研究结果，应由调用方导出正文及引用；`evidence` 是项目缓存的读取接口。
