# 如何使用证据

CLI 和 MCP 默认返回正文窗口、原文坐标、当前观测和必要的来源诊断。可用 `--full` 或 `full:true` 查看观测历史、片段正文及完整诊断。聚焦结果的 `content` 按原文顺序拼接，各片段在 `fragments` 中保留原文坐标。批读中 `duplicateOf` 指向相同结果首次出现的输入位置，从 0 开始计数。`metadataTruncated` 提示摘要省略了元数据字段。`hitsTruncated` 和 `totalHits` 提示候选输出达到预算。完整证据可用同一 ID 继续回读。

结构化来源可在 `snippet` 或 `evidence.metadata.summary` 提供关键值与报告范围。`recordPreview` 和 `externalIdSample` 只提供字段预览或样本，完整记录可继续读取。同一份维基原文的默认阅读窗口会跳过开头的模板，`--raw` 或 `raw:true` 从原文开头读取。维基标题可出现在聚焦结果的 `sections` 和 `contexts` 中，所有坐标保持相对于原文。

长研究默认只展示前 50 条缺口，`coverage.totalGaps` 给出数量。大状态中空白待查单元由对象和判据重建，`implicitPendingAssessments` 给出折叠数量，继续传回 `state` 即可。CLI 使用 `--state` 成功保存大型状态后可直接沿用返回的 `stateFile`。

`search` 保留每个来源的执行结果和命中，合并重复 URL。`rankScore` 用于排序，表示召回位置，不能解释成事实可信度。

`retrievals[].metadata.relevance` 是查询词面的充分、部分或无关匹配，仍需核对对象、用途和必需条件。显式来源保留无关候选的诊断，默认选路对部分匹配继续找其他入口。

搜索、读取、评论、图片和渠道请求的 `runs[].network` 记录当前 SERA 进程可观察的 HTTP：`requestCount`、`redirectResponseCount`、逐次 URL／方法／状态和到响应头或错误的耗时；并发来源分别归属，缓存命中为零请求。已登记凭据从记录中隐藏。`scope:sera-http` 不包含外部进程、浏览器子资源或上游服务内部请求，`upstreamRequestCount:null` 表示这部分不可观察；不要用它代替整个调查的请求总数。

`record`／`sera_record` 把外部取得的内容保存为 `source:external`，与正常证据一样按内容和 URL 得到稳定 ID。`metadata.acquisition` 是实际取得方法和观察时间，`retrievedAt` 是导入时间。同一正文再次取得时追加 `observations`，保留首次采集信息；`observationId` 标识本次观测。`evidence ID` 返回首次观测及历史，`read` 缓存返回符合本次动作、参数和材料要求的具体观测。旧格式在读取时规范化，下次保存原子追加，原证据 ID 和引用保持有效。导入记录仍需核验原文支持关系。

`research` 先检查已有证据，材料仍有缺口时再搜索和读取，返回 `documents`、`coverage` 和 `comparison`。证据保留 URL、读取来源、原始内容类型、获取时间及来源提供的发布时间。缺少发布时间时保持缺失；获取时间表示这次观察的时间。

通常先使用默认的短片段，再按字段补关键词或展开需要的上下文。`read` 默认返回前2000字符；传 `--query <问题>` 或重复 `--keyword <词>` 后返回相关片段与标题位置，`selection` 区分 `focused` 和 `leading`。`fragments` 保留原文坐标；`contexts` 补充相关标题与表头，额外上下文最多为 `min(1000, length)` 个码点。全文仍可通过 `evidence.id` 读取。`--length` 控制返回字符预算，分页使用 `nextOffset`。坐标按 Unicode 码点计数，例如 `😀` 算一个字符。

多个已知链接用 `read-many`（MCP：`sera_read_many`），最多20项、三路并行；重复 URL 合并请求，结果保持输入顺序，失败逐项返回。已知 Steam AppID、Niconico ID、DOI、PMID、`wikidata:Q28865` 这类明确实体 ID 可直接传给 `read` 或 `research`，无需先跑搜索。

已知视频可按 `channels` 的 `entrypoint:read` 选择元数据或字幕，`read` 支持 `operation`、`params`、`contentTypes`。OpenCLI 的 YouTube `video` 和 B站 `video` 保留字段记录，类型为 `metadata`；`transcript`／`subtitle` 取得的实际文本类型为 `subtitle`，并保留接口给出的时间标记。不同动作、参数、材料和 `locator` 分别匹配缓存；定位中明确提供的父 URL、起止秒数和事件时间也参与核对。同一 URL 的评论页不能充当视频正文或元数据。Wikidata 声明和外部 ID、VNDB 发行语言与商店关联仍属于各自数据库的记录，事实结论继续核对声明范围和原始出处。

```bash
node dist/cli.js read-many "steam:105600" "sm8628149" --keyword "release_date" --keyword "firstRetrieve" --json
node dist/cli.js read "https://example.org/article" --query "中文支持何时更新" --keyword "简体" --length 1500 --json
node dist/cli.js evidence EVIDENCE_ID --keyword "発売日" --length 1000 --json
node dist/cli.js research "某作品" --goal "发行日期" --goal "中文支持" --sources bing --read-sources web --state ./research-state.json --json
```

`research` 使用 `version:2` 状态，分别保存 `subjects`、`criteria` 与 `assessments`；`goals` 是建立必需判据的简便入口。CLI 从首轮传 `--state ./research-state.json`，创建或原子更新状态；Agent 核验后填写单元的 `status`、`outcome`、`conclusion`、`scope` 和 `citations` 原文坐标，MCP 下一轮传回同一 `state`。已有证据可为另一个判据重新定位，不因页面已经取证而跳过核验。完成判断会复核本轮读取来源、材料、动作参数及时间范围；条件改变后，不适用的旧结论和引用保留并回到待核验，继续取得对应材料。

同 ID 的对象或判据定义改变时，只重新打开相关核验单元，保留结论、引用和证据，并允许重新审阅；提交相同定义继续复用。URL、对象标识符和结构化动作续查保留查询种子，`discoveryQuery` 可显式替换本轮发现查询。

研究续查省略 `raw` 时保留既有观测的模式，显式传入时按该模式重新核验。读取参数即使省略动作名也会参与复核；搜索参数与各来源的读取参数分别处理。

后续先复用材料，再围绕当前对象与判据补证；新增 URL、证据与通过检查的核验单元见 `comparison.progress`。零进展时调整默认来源顺序或建议查询，`discoveryQuery` 可显式指定本轮查询；已知 URL 不计入新增命中预算。`accessFailures[].retryAt` 在跨轮保持限流等待，`refresh` 仍遵守。`candidates` 是待审阅关联，`reviewedEvidenceIds` 记录已审阅而不足以支持当前判据的材料。

`coverage` 检查对象与判据、原文引用、坐标、适用范围和 `targetCount`。必需条件不满足时排除对象，偏好单独记录；工具通过检查的引用仍需 Agent 核验语义。`comparison.groups` 按判据、范围和单位分组，显式 `measurement.normalization` 保留原值与换算依据。CLI 自动迁移旧状态并保留原子备份，MCP 使用 `sera_migrate_state`。状态文件保存失败时仍交付研究结果及返回状态，`stateWarnings` 说明原因；修复后可以继续。首轮输入、编辑状态与下一轮调用见[取证与续查](../skills/sera-search/references/workflows.md)。

相同正文可以归为重复内容组；`publisherGroups` 用于组织发布者线索。两个引擎找到同一篇文章、多个页面属于同一发布者，或文章互相转载，都不能直接算作独立证据。Agent 应根据原文和引用关系记录支持、冲突及仍待核验的事实。

## 扩展来源的材料范围

`metadata-parser` 返回 `contentKind:metadata`，保留 HTML 的 `page`、`meta`、Open Graph、Twitter 与 Dublin Core 等实际分组，以及字段来源和声明 URL。相对 canonical 可按实际取得 URL 解析为绝对地址，原始声明同时保留；canonical／OG URL 表示页面声明，实际取得 URL 仍单独记录。页面声明日期保留在元数据中，事实发布时间需另行核验。启用后它也可增强 `web` 的原始 HTML 读取，增强失败保留已取得文本与错误线索。

`google-news` 的 RSS 条目、RSS 目录和未解析的聚合落地页均为元数据，`fullContentVerified:false` 表明发布者正文仍待取得。条目日期来自 RSS；只有请求实际到达发布者并取得文本时，才能按该次返回的内容范围使用正文。标题、新闻聚合摘要与正文各自核对。

`iptv` 返回频道目录记录、流 URL 和 EPG 线索，`streamAvailability:unknown` 表示播放可用性尚未验证。目录条目用于定位频道和承载地址，节目或视听内容需要实际观察后取证。

`ghgrab` 的树与文件记录应对齐仓库、ref、路径和返回范围。`scrapling` 的 HTTP 与浏览器结果按实际工具、响应和会话状态判断，浏览器渲染本身不保证页面内容支持目标结论。完整后端结果由 `backend`／`sera_backend` 保留上游结构，使用时同时核对错误和返回内容，必要时转入统一读取流程取得证据 ID。

部分来源超时、未配置或需要登录时，其他已成功结果仍会返回。搜索有效但没有命中与请求失败分别记录。403、429、无历史快照与正文未取得需要不同处理：查看 `runs`，有 `retryAfterSeconds` 时先遵守等待条件并处理其他字段；仅取得标题或页面壳时继续查原始API或正文。已经取得的材料继续保留，不能用索引、摘要或页面标题补齐全文结论。

`partial` 可能表示正文已取得但缓存未保存，也可能表示只取得页面框架。前者保留 `content` 和 `document` 元数据，并在 `cacheWarnings` 记录缓存问题；后者通过 `metadata.bodyAvailable:false`、`contentScope:page-shell` 与 `runs[].code:CONTENT_INCOMPLETE` 标明正文尚未取得，`nextSteps` 提供下一步。已经取得的内容继续交付；保存成功的证据可按需回读。

`read` 默认复用同一 URL 和来源在15分钟内取得的证据；明确时间的 Wayback 快照、Wiki `oldid` 可复用至 `retentionDays`，默认七天。`--refresh`／`refresh:true` 强制读取，`--max-age`／`maxAgeMs` 限定读取缓存的毫秒上限。返回 `cacheHit`、缓存年龄与原获取时间；认证失效的来源不复用其 URL 缓存。过期缓存每小时检查一次，失效 URL 索引一起回收。`clean` 清理 SERA 生成的证据缓存及 `<home>/cache/integrations` 的受管理组件缓存，保留 `<home>/tools` 内的依赖与会话、配置、登录记录、迁移备份及未识别为 SERA 证据的文件；占用或无法处理的缓存文件保留，并在结果中列出。需要长期保留的研究结果，应由调用方导出正文及引用；`evidence` 是项目缓存的读取接口。
