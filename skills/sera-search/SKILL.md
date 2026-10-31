---
name: sera-search
description: 使用 SERA CLI 或 MCP 进行联网检索、领域资料查询、评论读取、图片来源匹配与证据核验。适用于用户指定 SERA，或需要跨来源查询资料、登记搜索服务凭据时。
---

# SERA

使用 SERA 已安装的 CLI 或 MCP 搜索和取得原始材料。公开渠道直接可用，账号渠道使用工具数据目录中的登录记录；平台能力以实际提供者为准。

## 开始与选路

进入任务先调用 `sera capabilities --json`（MCP：`sera_capabilities`），确认来源、动作与登录状态；需要平台或站点时用 `channels` 按 `sources`／`platform` 缩小清单。账号渠道缺少有效凭据时显示“未登录，不可用”；网络、权限和额度以本次 `runs` 为准。

先确认实体、别名、ID、版本、语言、目标时间及待核验字段，再选择材料：

| 问题 | 优先路径 |
|---|---|
| 版本、日期、规格、支持状态 | 官方页面、公告、结构化 API；先确认产品 ID，必要时限定官方域名 |
| 用户体验、故障反馈、口碑 | 原帖或评价，再读评论和回复；分别标记官方声明、作者体验与评论观点 |
| 旧网页、历史版本、失传信息 | 原始 URL、历史域名和目标时间 → Wayback availability／CDX → 实际快照；馆藏另查 Internet Archive |
| 游戏机制、攻略、同人资料 | 按需读 [游戏 Wiki 指南](references/game-wikis.md)，传 `group:game-wikis` 并选具体站点 |
| Galgame 发行考据或玩家讨论 | 官方和 VNDB／Bangumi 确认实体；讨论按需读 [Galgame 指南](references/galgame.md)，传 `group:galgame` 并选社区 |
| 已知 URL、Steam AppID、Niconico ID、DOI、PMID | 直接 `read`／`research`；已有证据用 `evidence` 定位或续读 |

已知 ID 可写为 `steam:105600`、`sm8628149`、`10.1234/example`、`pmid:12345`。只有名称时先搜索候选，核对别名和对象 ID，再读取真实链接。复合问题由 agent 拆成若干待核验字段；使用 `intent` 指定本轮目的，`aliases` 补别名，`goals` 记录要回答的字段。

默认搜索按意图依次选择可用来源，有有效候选后停止；空结果、实体不符或错误继续换源。显式 `sources` 并行聚合全部所选来源，控制接口和费用；原生查询语法应指定来源。`runs[].attempts` 保留实际后端、查询、空结果、无关结果和错误。相关性判断基于词面，跨语言实体应提供 `aliases`。

沿用同一 `SERA_HOME`／`--home`。CLI 不在 PATH 时，解析技能目录真实路径，向上两级定位包根目录，使用 `node <包根目录>/dist/cli.js`；源码工作区未指定数据目录时可用 `<包根目录>/.sera`。CLI 的目录参数为 `--group game-wikis|galgame`，MCP 在单次工具输入传 `group`，无需重启连接。

详细来源／语法见 [sources.md](references/sources.md)，文档、学术与领域材料见 [domains.md](references/domains.md)，社区、评论与图片范围见 [platform-expansion.md](references/platform-expansion.md)，历史快照与修订见 [archives.md](references/archives.md)。仅按任务需要读取相应参考。HTTP 沿用 `HTTP_PROXY`／`HTTPS_PROXY`／`NO_PROXY`。

## 登录记录

用户明确提供 API Key 或 API 账号用于登录时，可直接登记到指定 SERA 数据目录。MCP 调用 `sera_login`，传 `source` 和 `credentials: {apiKey}`；Twitch 用 `{apiKey, clientId}`，DataForSEO 用 `{username, password}`。CLI 用 `login --stdin` 输入纯 Key／JSON，或 `login --from-env 变量名` 登记已有环境变量。用 `auth`／`sera_auth` 查看状态，`logout`／`sera_logout` 清除记录。

```bash
sera login exa --from-env EXA_API_KEY
sera auth exa --json
sera login opencli --platform zhihu
sera login agent-reach --platform xiaohongshu
sera auth opencli --platform zhihu --json
```

API 返回“已记录”，请求才验证 Key。凭据来源无有效记录或认证失效时，认证文案为“未登录，不可用”，JSON 保留 `NOT_LOGGED_IN`。公开来源直接查询。Discord 需配置 `guildId`，Instagram 需专业账号 `accountId`；网易云需用户自建 API 的 `baseUrl`。限流、配额、权限和网络失败按实际错误处理。

LinuxDo 可选 `{apiKey, username}`，小黑盒可选 `apiKey` 保存网站 Cookie；公开内容可先匿名请求，受限对象按实际响应处理。

平台用户名／密码通过对应后端的官方登录流程使用。OpenCLI 可打开登录页面，明确登录成功或 `whoami` 验证后才记录；需要用户完成网页验证时等待其操作。Agent Reach 当前仅同步后端已有登录。登录等待不算成功，部分平台退出需要在后端或官网完成。登录记录和旧配置迁移备份是含凭据的本地 JSON；`clean` 清理证据缓存并保留它们。

## 检索与原文

```bash
sera search "查询" --sources exa,tavily,brave --limit 5 --json
sera research "查询" --sources bing --read-sources web --read-limit 3 --json
sera search "查询" --sources agent-reach --platform xiaohongshu --json
sera research "查询" --sources exa,github --read-limit 4 --json
sera research "查询" --sources brave --read-sources web --read-limit 4 --json
sera research "中文技术资料" --sources zhipu,doubao --read-sources web --read-limit 3 --json
sera search "retrieval augmented generation" --sources crossref,openalex,pubmed --json
sera search "量子力学" --sources wiki --platform wikipedia-zh --json
sera search "search" --sources skills --json
sera search "CLANNAD" --sources vndb,bangumi --json
sera search "CLANNAD 感想" --sources sites --platform ymgal --group galgame --json
sera search "https://example.org/" --sources wayback --at 20200101 --json
sera search "Linux" --sources linuxdo --json
sera comments "https://www.bilibili.com/video/BV17x411w7KC" --sources bilibili --limit 20 --json
sera image-search "动漫背景" --sources baidu-images,sogou-images --json
sera reverse-image "https://example.org/frame.jpg" --sources serpapi,trace-moe,saucenao --json
sera research "retrieval augmented generation" --sources opencli --platform arxiv --read-sources web --read-limit 3 --json
sera read "https://example.org/article" --json
sera evidence EVIDENCE_ID --offset 0 --length 2000 --json
```

`search` 返回候选和各来源状态；`research` 继续读取并组织证据。`research --sources` 同时限定检索和读取；Bing、Brave、智谱、豆包、SERP、`sites` 等搜索入口需要显式 `--read-sources web` 或其他正文源，MCP／库接口使用 `readSources`。按任务控制命中数、读取预算和来源。

`comments` 返回 `page.comments`、`page.scope` 和 `page.nextCursor`；下一页传 `--cursor`，楼中楼传 `--parent`，MCP 用 `cursor`／`parentId`。核对原始正文、截断和回复范围，再说明已检查的评论量。图片动作的 `metadata` 保留图片与来源页等线索，匹配结果继续回到原作品核对。

MCP 共 12 个工具：来源／渠道、搜索、评论、图片、研究、读取、证据及三个认证工具；分别为 `sera_capabilities`、`sera_channels`、`sera_search`、`sera_comments`、`sera_images`、`sera_research`、`sera_read`、`sera_read_many`、`sera_evidence`、`sera_login`、`sera_logout`、`sera_auth`。`sera_images` 传 `query` 或 `imageUrl`，其他字段以 Schema 为准。每次调用刷新配置，同一连接登记后即可查询。

`read`／`evidence` 用 `--query` 或重复 `--keyword` 定位原文；MCP 字段为 `query`／`keywords`。`selection:focused` 返回带 Unicode 坐标的 `fragments`；`leading` 表示返回开头，需要查看标题、补词或分页。`length` 控制返回字符预算，全文仍保存在证据 ID 下。定位依据词面，关键词命中只表示候选片段。

多个已知链接用 `read-many URL1 URL2 --keyword 关键词 --json`（MCP：`sera_read_many` 的 `urls`），最多20项、三路并行，重复地址共用读取结果；逐项查看失败并保留成功证据。无定位条件时 `read` 默认返回前2000字符，`evidence` 通过 `nextOffset` 续读，emoji 算一个字符。

当前页默认复用15分钟内的同源 URL 缓存；明确 Wayback 快照、Wiki `oldid` 可复用到保留期限。`refresh:true`／`--refresh` 强制读取，`maxAgeMs`／`--max-age` 指定读取缓存上限。`cacheHit` 与原始 `retrievedAt` 保留实际获取时间。正文取得但保存失败时仍交付 `content`／`document`，状态为 `partial`，按 `cacheWarnings` 处理。

`research` 用 `goals` 建立待核验字段，返回 `state.fields/candidates/accessFailures/examinedUrls/nextAction`。agent 阅读原文后把字段设为 `supported` 或 `conflict`，关联 `evidenceIds`，再传回 `state`（CLI：`--state state.json`）。后续只补待查或冲突字段、跳过已取证 URL；失败链接仍可重试。全部字段确认后停止联网。候选证据与字段的关联仅供审阅，状态由 agent 核验后更新。

## 核验

结合原文形成结论，并关联证据 ID 和原始 URL。区分摘要、正文、评论、字幕和元数据；字幕轨道列表和评论计数只证明这些对象的线索。

检查 `comparison` 中的发布者组和重复正文，再结合原文确认引用或转载关系。排序分数用于召回顺序；多个引擎命中同一文章仍是同一来源。`retrievals[].metadata.searchEngine` 可追溯智谱／SERP 的实际上游；入口不同也可能共享搜索引擎。记录支持证据、冲突证据和待核验事实，冲突时追查原始资料及时间版本。

`publishedAt` 来自来源，`retrievedAt` 表示本次获取时间；档案 `captureAt` 是捕获时间，Wiki `updatedAt` 是修订时间。指定旧版本时保留快照或修订 URL，缺失的发布日期保持缺失。

“最新”“免费”“全部”等问题记录观察日期、检查过的来源与页面条件。核对官方版本、更新时间、地区／语言及费用；结果不充分时保留未知范围，避免以搜索排序或有限命中推断全网覆盖。

来源超时、为空或需要登录时，保留成功结果，根据 `runs` 判断是否调整查询、等待限流或向用户说明渠道缺口。Wiki 连接失败时，可用已登录的网页引擎限定目标 Wiki 域名，再选择可用正文源。论文结果可能只含书目和摘要，需要全文时继续读取原始 PDF 链接；视频读取则核对实际 `contentKind`。
