# 如何使用证据

`search` 保留每个来源的执行结果和命中，合并重复 URL。`rankScore` 用于排序，表示召回位置，不能解释成事实可信度。

`research` 在搜索后读取原始材料，返回 `documents` 和 `comparison`。证据保留 URL、读取来源、原始内容类型、获取时间及来源提供的发布时间。缺少发布时间时保持缺失；获取时间表示这次观察的时间。

通常先使用默认的短片段，再按字段补关键词或展开需要的上下文。`read` 默认返回前2000字符；传 `--query <问题>` 或重复 `--keyword <词>` 后返回相关片段与标题位置，`selection` 区分 `focused` 和 `leading`。`fragments` 保留原文坐标，全文仍可通过 `evidence.id` 读取。`--length` 控制返回字符预算，分页使用 `nextOffset`。坐标按 Unicode 码点计数，例如 `😀` 算一个字符。

多个已知链接用 `read-many`（MCP：`sera_read_many`），最多20项、三路并行；重复 URL 合并请求，结果保持输入顺序，失败逐项返回。已知 Steam AppID、Niconico ID、DOI、PMID 可直接传给 `read` 或 `research`，无需先跑搜索。

```bash
node dist/cli.js read-many "steam:105600" "sm8628149" --keyword "release_date" --keyword "firstRetrieve" --json
node dist/cli.js read "https://example.org/article" --query "中文支持何时更新" --keyword "简体" --length 1500 --json
node dist/cli.js evidence EVIDENCE_ID --keyword "発売日" --length 1000 --json
node dist/cli.js research "某作品" --goal "发行日期" --goal "中文支持" --sources bing --read-sources web --state ./research-state.json --json
```

`research` 的 `goals` 建立待核验字段，返回 `state`。多轮CLI任务从首轮传 `--state ./research-state.json`：文件不存在时按goals建立，存在时读取，并在本轮完成后原子写回同一文件。Agent核验原文后编辑文件中的 `fields[].status`（`pending`、`supported`、`conflict`）、`evidenceIds` 和需要的 `note`，再执行原命令；重复执行保留已核验状态。MCP下一轮直接传回更新后的 `state` 对象。

后续查询优先聚焦一个冲突或未确认字段，建议问题见 `state.nextQuery`；已取证URL跳过，失败URL保留重试机会。上游明确给出 `Retry-After` 时，`accessFailures[].retryAt` 记录允许重试的时间；下一轮在等待期先处理其他URL，`refresh` 也遵守该时间。`candidates` 供审阅，关键词命中不自动确认事实。`nextAction` 提示继续检索、审阅证据或完成；全部字段由调用方确认后停止联网。

状态文件保存失败时仍交付研究结果及返回状态，`stateWarnings` 说明原因；修复后可以继续。首轮输入、编辑状态与下一轮调用见[取证与续查](../skills/sera-search/references/workflows.md)。

相同正文可以归为重复内容组；`publisherGroups` 用于组织发布者线索。两个引擎找到同一篇文章、多个页面属于同一发布者，或文章互相转载，都不能直接算作独立证据。Agent 应根据原文和引用关系记录支持、冲突及仍待核验的事实。

## 扩展来源的材料范围

`metadata-parser` 返回 `contentKind:metadata`，保留 HTML 的 `page`、`meta`、Open Graph、Twitter 与 Dublin Core 等实际分组，以及字段来源和声明 URL。相对 canonical 可按实际取得 URL 解析为绝对地址，原始声明同时保留；canonical／OG URL 表示页面声明，实际取得 URL 仍单独记录。页面声明日期保留在元数据中，事实发布时间需另行核验。启用后它也可增强 `web` 的原始 HTML 读取，增强失败保留已取得文本与错误线索。

`google-news` 的 RSS 条目、RSS 目录和未解析的聚合落地页均为元数据，`fullContentVerified:false` 表明发布者正文仍待取得。条目日期来自 RSS；只有请求实际到达发布者并取得文本时，才能按该次返回的内容范围使用正文。标题、新闻聚合摘要与正文各自核对。

`iptv` 返回频道目录记录、流 URL 和 EPG 线索，`streamAvailability:unknown` 表示播放可用性尚未验证。目录条目用于定位频道和承载地址，节目或视听内容需要实际观察后取证。

`ghgrab` 的树与文件记录应对齐仓库、ref、路径和返回范围。`scrapling` 的 HTTP 与浏览器结果按实际工具、响应和会话状态判断，浏览器渲染本身不保证页面内容支持目标结论。完整后端结果由 `backend`／`sera_backend` 保留上游结构，使用时同时核对错误和返回内容，必要时转入统一读取流程取得证据 ID。

部分来源超时、未配置或需要登录时，其他已成功结果仍会返回。搜索有效但没有命中与请求失败分别记录。403、429、无历史快照与正文未取得需要不同处理：查看 `runs`，有 `retryAfterSeconds` 时先遵守等待条件并处理其他字段；仅取得标题或页面壳时继续查原始API或正文。已经取得的材料继续保留，不能用索引、摘要或页面标题补齐全文结论。

`partial` 可能表示正文已取得但缓存未保存，也可能表示只取得页面框架。前者保留 `content` 和 `document` 元数据，并在 `cacheWarnings` 记录缓存问题；后者通过 `metadata.bodyAvailable:false`、`contentScope:page-shell` 与 `runs[].code:CONTENT_INCOMPLETE` 标明正文尚未取得，`nextSteps` 提供下一步。已经取得的内容继续交付；保存成功的证据可按需回读。

`read` 默认复用同一 URL 和来源在15分钟内取得的证据；明确时间的 Wayback 快照、Wiki `oldid` 可复用至 `retentionDays`，默认七天。`--refresh`／`refresh:true` 强制读取，`--max-age`／`maxAgeMs` 限定读取缓存的毫秒上限。返回 `cacheHit`、缓存年龄与原获取时间；认证失效的来源不复用其 URL 缓存。过期缓存每小时检查一次，失效 URL 索引一起回收。`clean` 清理 SERA 生成的证据缓存及 `<home>/cache/integrations` 的受管理组件缓存，保留 `<home>/tools` 内的依赖与会话、配置、登录记录、迁移备份及未识别为 SERA 证据的文件；占用或无法处理的缓存文件保留，并在结果中列出。需要长期保留的研究结果，应由调用方导出正文及引用；`evidence` 是项目缓存的读取接口。
