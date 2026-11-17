# CLI

账号与地理扩展使用同一 `install --components` 和 `backend` 命令。组件包括 `aliens-eye`、`sherlock`、`gods-eye-view`；先用 `backend 来源` 发现 Schema，再以 `--input JSON文件` 调用工具。`--timeout-ms` 设置外层预算，扫描范围、关联信号及地理区域由工具参数指定。完整示例见[账号与地理扩展](extensions.md)。

安装为可执行包后，下面的 `node dist/cli.js` 可以替换为 `sera`。使用 `--help` 查看实际参数。

垂直资料使用 `--operation`、`--params JSON` 与 `--content-type`，参数由 `channels` 的动作 Schema 给出。`search --input 文件` 可传每源独立的 `sourceOptions`；`--since/--until` 指定范围，`--strategy cross-check --max-sources 数量` 控制交叉核验。来源、分页和片段示例见[垂直来源](specialist-sources.md)。

任务开始时先查看相关来源，再直接执行首轮取证；例如网页问题只看 `bing,web`，作品发行考据再加入 `steam,wayback`。多字段任务使用 `research --goal`，已有链接直接 `read`／`read-many`。起步和续查示例见[取证与续查](../skills/sera-search/references/workflows.md)。

```bash
node dist/cli.js capabilities --sources bing,web --json
node dist/cli.js research "TypeScript 发行记录" --sources bing --read-sources web --goal "版本与发布日期" --goal "官方更新内容" --state ./research-state.json --read-limit 3 --json
```

## 发现连接器与访问条件

`connectors` 导出结构化连接器定义，包含协议、动作、输入 Schema、字段映射、认证、费用和限速；只需相关来源时用 `--sources` 筛选。定义不包含账号凭据，实际可用状态继续查看 `capabilities` 与调用结果。

```bash
sera connectors --sources modrinth,scryfall --json
node dist/cli.js connectors --sources modrinth,scryfall --json
```

来源 ID 支持通过配置动态增加；`sources` 保存每源设置，`connectorFiles` 加载外部定义，`connectors` 内联定义。新增来源可沿用 `--sources`、`--operation` 与 `--params` 调用，完整格式见[连接器指南](connectors.md)。

自动选路优先匿名免费、认证免费，再考虑周期免费配额；认证加配额的来源进一步降权。付费必需动作和一次性试用排除；混合计费或计费未确认的入口需在确认账号免费档后设置 `sources.<来源>.freeTierConfirmed: true`。已知免费 Key 来源按其声明使用。该设置是账号档位声明，实际额度与账单仍由服务端控制。

## 安装配置与调用后端

先选数据目录，再运行 `install`；源码可用 `--home ./.sera`，独立安装可用 `--home F:/tools/sera-data`，避免默认用户目录和缓存占用 C 盘。真实终端中的 `install` 默认启动向导；逐步探测已有组件、补齐凭据、确认免费档和选择平台。非终端或 `--json` 模式不提问。

| 选项 | 配置行为 |
|---|---|
| `--setup` | 显式启用向导流程；非交互环境也执行可自动完成的步骤 |
| `--yes` | 无人值守补齐可用环境变量和已有工具入口；保留既有停用项及已有凭据字段 |
| `--sources a,b` | 限定本轮配置的来源 |
| `--platform opencli:zhihu,agent-reach:xiaohongshu` | 加入要复核的平台；非交互仅验证已有会话，交互中需要时打开登录页 |
| `--confirm-free-tier exa,tavily` | 明确确认所列来源使用免费档；`--yes` 不代替该确认 |
| `--components ghgrab,scrapling` | 选择需要下载、安装或修复的组件 |

仅本轮新建配置模板中的组件可在探测成功后自动启用；既有 `enabled:false` 保留，包括旧默认模板的停用项。交互向导会单独列出已停用组件，由用户填写本次要启用的组件。

`--yes` 不打开登录页面。API Key 只登记，不发送试探请求；已有活动凭据按字段补缺，不替换已存字段。已保存的 OpenCLI／Agent Reach 平台记录自动复核，新平台通过 `--platform` 或交互选择；非交互仅验证已有会话。经后端 `whoami`／会话同步确认后才记录登录，明确认证失效会作废本地记录并保留凭据字段，网络失败不作废。普通本机探测不安装软件，组件下载只由 `--components` 触发。

```bash
# 真实终端逐步配置
node dist/cli.js install --home ./.sera

# 无人值守，只处理所选来源的已有入口和环境变量
node dist/cli.js install --home ./.sera --yes --sources github,youtube,opencli --platform opencli:zhihu --json

# 已核对账号免费档后单独确认
node dist/cli.js install --home ./.sera --setup --sources exa,tavily --confirm-free-tier exa,tavily --json

# 显式安装扩展依赖
node dist/cli.js install --home F:/tools/sera-data --components ghgrab,scrapling,metadata-parser --python D:/Python/python.exe --browser "D:/Apps/Edge/msedge.exe"
node dist/cli.js capabilities --home F:/tools/sera-data --sources ghgrab,scrapling,metadata-parser,google-news,iptv --json

# 省略 tool 时，发现上游工具名及输入 Schema
node dist/cli.js backend ghgrab --home F:/tools/sera-data --json
node dist/cli.js backend scrapling --home F:/tools/sera-data --json

# TOOL_NAME 替换为发现的工具名，文件内容为该工具接受的 JSON 对象
node dist/cli.js backend scrapling TOOL_NAME --input ./backend-input.json --home F:/tools/sera-data --json
```

安装向导的提示和进度写入 stderr，stdout 始终为一个最终 JSON 对象。部分步骤未完成时保留成功项，返回 `partial` 和下一步，退出码为 `0`；取消退出码为 `130`，可重跑同一命令补齐。免费档声明不限制服务端账单，凭据及环境变量说明见[配置指南](configuration.md)。

`setup.sources[].status` 区分 `recorded`（凭据已记录）、`public`（公开入口）、`needs-key`、`needs-settings`、`needs-free-tier`、`disabled` 和 `needs-component`；按待办补齐后重跑，已记录不表示 API 已在线验证。

`--python` 指定已有 Python 3.10+，`--browser` 指定已有 Chromium／Edge 可执行文件；路径请替换为本机实际位置。

`backend` 接受 `ghgrab`、`scrapling`、`aliens-eye`、`sherlock` 或 `gods-eye-view`，按上游 Schema 传参。组件位于 `<home>/tools`，安装与运行缓存位于 `<home>/cache/integrations`；重复 `install --components` 会核对、补全或修复所选组件。Scrapling 的内存会话在同一 MCP 连接内保持；每次 CLI `backend` 是独立进程，需要跨进程会话时使用上游发现的 save／load 工具。完整能力与兼容范围见[扩展来源与后端](integrations.md)。

## 检索与取证

搜索返回 `retrievals[].metadata.relevance` 的词面诊断，显式来源仍保留原始候选。默认搜索继续取得足量新命中，`--exclude-url` 标记已知 URL，`--term` 单独指定发现用词。`research` 优先充分匹配的候选，也允许部分匹配取证；需要先审阅来源时设 `--read-limit 0`，确认后直接 `read`。

`read`／`read-many`／`research` 可传 `--timeout-ms` 调整本次读取预算、`--browser` 使用已有 Chromium／Edge。`web` 读取公开 JSON、文本与 JS 时直读；`--raw` 跳过 Jina 并保留 HTML，便于定位页面已有的原文、数据和脚本入口。不同取得方式的正文缓存分别匹配，`--refresh` 取得新观察。

`record --input JSON文件` 保存外部工具实际取得的材料，必填 `url`、`title`、`content`、`method` 与 ISO 时间 `observedAt`；可传 `publishedAt`、`contentKind` 和 `metadata`。返回的 `source:external`、`metadata.acquisition` 与导入时间可通过 `evidence` 继续读取；状态文件关联该证据 ID。示例见[取证与续查](../skills/sera-search/references/workflows.md)。

```bash
# 多来源召回，每个来源最多返回 5 条
node dist/cli.js search "MCP TypeScript SDK stdio" --sources exa,tavily,brave,github --limit 5 --json

# 搜索后读取最多 4 个命中，生成证据对照
node dist/cli.js research "REA 如何连接 Agent" --sources exa,github --read-limit 4 --json

# 使用 Brave 搜索，另选 web 读取正文
node dist/cli.js research "MCP stdio 文档" --sources brave --read-sources web --read-limit 4 --json

# 指定平台的站内搜索
node dist/cli.js search "咖啡" --sources agent-reach --platform xiaohongshu --json
node dist/cli.js search "检索增强生成" --sources opencli --platform zhihu --json

# 中文搜索与 Google／Bing 自然搜索
node dist/cli.js research "国产数据库 文档" --sources zhipu,doubao --read-sources web --read-limit 3 --json
node dist/cli.js search "TypeScript 文档" --sources serpapi --platform google --json

# 学术记录与 Wiki
node dist/cli.js search "retrieval augmented generation" --sources crossref,openalex,pubmed --json
node dist/cli.js search "量子力学" --sources wiki --platform wikipedia-zh --json

# 公开网页、技能与作品资料
node dist/cli.js research "MCP stdio 文档" --sources bing --read-sources web --read-limit 3 --json
node dist/cli.js search "search" --sources skills --json
node dist/cli.js search "CLANNAD" --sources bangumi,vndb --json

# Galgame 社区与游戏 Wiki 分别按需加载
node dist/cli.js search "CLANNAD 感想" --sources sites --platform ymgal --group galgame --json
node dist/cli.js search "Creeper" --sources wiki --platform minecraft --group game-wikis --json

# 评论使用返回的 page.nextCursor 继续翻页
node dist/cli.js comments "https://www.bilibili.com/video/BV17x411w7KC" --sources bilibili --limit 20 --json
node dist/cli.js comments "https://www.youtube.com/watch?v=VIDEO_ID" --sources youtube --cursor NEXT_CURSOR --json
node dist/cli.js comments "https://music.163.com/song?id=186016" --sources netease --json

# 关键词图片与反向识图是不同动作
node dist/cli.js image-search "动漫背景" --sources brave,baidu-images,sogou-images --json
node dist/cli.js reverse-image "https://example.org/frame.jpg" --sources serpapi,trace-moe,saucenao --json

# 社交 API 按实际对象和授权范围查询
node dist/cli.js search "Just Chatting" --sources twitch --platform categories --json
node dist/cli.js search "检索" --sources discord --platform messages --json
node dist/cli.js search "illustration" --sources instagram --platform hashtag --json

# 历史网页与公开馆藏
node dist/cli.js search "https://example.org/" --sources wayback --at 20200101 --json
node dist/cli.js search "opensource_movies" --sources archive --json

# 新闻 RSS、频道目录与可选提取来源
node dist/cli.js search "TypeScript" --sources google-news --json
node dist/cli.js search "France 24" --sources iptv --json
node dist/cli.js read "https://example.org/article" --sources scrapling --json
node dist/cli.js read "https://example.org/article" --sources metadata-parser --json

# 原生论坛检索与评论
node dist/cli.js search "Linux" --sources linuxdo --json
node dist/cli.js search "游戏评测" --sources heybox --json

# 读取原文，获得 evidence.id 和首段正文
node dist/cli.js read "https://github.com/morluto/rea" --json

# 按 Unicode 码点范围读取已保存的证据
node dist/cli.js evidence EVIDENCE_ID --offset 0 --length 2000 --json

# 查看配置与来源声明；配置存在不代表账号已登录
node dist/cli.js capabilities --sources wiki,wayback,linuxdo --json

# 发现平台命令与浏览器要求，可按平台缩小结果
node dist/cli.js channels --sources opencli,agent-reach --json
node dist/cli.js channels --sources opencli --platform zhihu --json

# 清理 SERA 管理的证据与组件缓存，保留依赖及会话
node dist/cli.js clean --json
```

`search`／`research` 还支持 `--github-type repositories|code|issues`、重复的 `--domain` 和 `--since`。域名、时间过滤按来源的实际接口映射。用户使用原生搜索语法时，应指定来源，避免将同一表达式直接套给不同引擎。

平台查询通过 `--sources` 与 `--platform` 选择实际动作；游戏 Wiki 和 Galgame 社区还需选择 `--group`。Bing RSS 不支持统一 `--since`，需要日期条件时选择支持的 API，或继续核对原文日期。

`comments` 支持 `--limit`、`--cursor`、`--parent` 和按来源定义的 `--order`；一次读取一个评论页，返回逐评论 ID、父子关系、正文、`scope` 与下一页游标，最多请求 100 条。图片动作最多请求 20 条，结果保留原图、承载页面和匹配类型等 `metadata`；图片链接、搜索缩略图与来源文章分别核对。

未指定 `--sources` 时，`search` 按 `intent` 选择可用来源，空结果、无关候选或错误继续换源，有有效候选后停止。显式来源保持并行聚合。`--intent` 可指定 `official`、`feedback`、`historical`、`game`、`galgame`、`academic`、`code`、`images` 或 `general`；重复 `--alias` 补充别名，初始后端无有效结果时最多重试首个不同别名。`runs[].attempts` 记录实际查询、后端和换路原因。相关性为保守词面判断，跨语言名称或歧义短名需 agent 消歧。

跨轮研究从首轮传 `--state ./research-state.json`；重复 `--goal` 建立必需判据，多对象与偏好通过 `research --input ./request.json` 的 `subjects`、`criteria` 定义。`--discovery-query` 控制本轮查询，`--target-count` 指定合格对象数量。新状态采用 `version:2`；审阅后填写 `assessments` 的结论、`outcome`、`scope` 和引用坐标。工具先复用旧证据再补缺口，通过 `coverage` 检查覆盖和引用，通过 `comparison.progress` 驱动续查。Retry-After 在跨轮保持，保存失败返回 `stateWarnings`。

CLI 读取旧 `fields` 状态时先原子备份并迁移，也可以用 `migrate-state --state ./research-state.json` 单独迁移。迁移重跑复用同一备份；旧结论和证据 ID 保留，明确条件判断及原文坐标后再完成核验。完整结构见[取证与续查](../skills/sera-search/references/workflows.md)。

`research --sources` 同时约束搜索和正文读取的来源范围。需要使用另一组读取后端时，传入 `--read-sources`；例如 `--sources brave --read-sources web`。MCP／库接口对应字段为 `readSources`。这样可以显式控制参与任务的来源及 API 调用预算。

正常结果和部分成功退出码为 `0`，整体失败或参数错误为 `1`，用户中断为 `130`。自动化调用应同时检查 JSON 中的 `status` 和 `runs`，部分成功仍可能有待补查来源。

| 来源 | SERA 的入口边界 |
|---|---|
| `exa`、`tavily` | 使用已登记的 API Key，搜索与正文提取 |
| `bing`、`sites` | 公开网页发现；站点目录用于选择域名，普通网页正文另选读取源 |
| `brave`、`zhipu`、`doubao` | 使用已登记的 API Key；网页搜索，Brave 另有关键词图片；正文另选读取源 |
| `serpapi` | Google／Bing 自然搜索、图片与 Lens；正文另选读取源 |
| `github` | 读取公开仓库、代码搜索结果及 issue／PR 等资料；受 GitHub 权限和速率限制约束 |
| `ghgrab` | 搜索使用 GitHub；仓库树与文件支持上游识别的 forge，完整工具由 `backend ghgrab` 发现 |
| `scrapling` | 已知 URL 的网页提取；HTTP、浏览器与会话工具由 `backend scrapling` 发现 |
| `metadata-parser` | 现成 HTML 的标题、meta 与声明 URL；可选增强 `web` 原始 HTML 读取 |
| `google-news` | Google News RSS 发现与聚合记录；实际取得发布者正文前标为元数据 |
| `iptv` | Free-TV IPTV 频道目录、流 URL 与 EPG 线索，播放状态未验证 |
| `agent-reach`、`opencli` | 按实时渠道清单查询；账号渠道检查平台登录记录，正文、评论和字幕分别核对 |
| `bilibili`、`youtube`、`netease` | 视频／歌曲资料与评论；正文、字幕、评论和计数是不同对象 |
| `v2ex` | 公开帖子／节点资料读取；该 API 本身不是任意关键词全站搜索 |
| `web` | Jina Reader 通用网页读取 |
| `crossref`、`openalex`、`pubmed` | 公开书目与记录读取；摘要和元数据不能当成论文全文 |
| `wiki` | 七个默认 Wikimedia 站点和配置的 MediaWiki 实例；中英日 Wikipedia 与 `oldid` 指定修订读取 |
| `wayback`、`archive` | 网页捕获索引／快照与馆藏元数据；捕获时间和原始发布日期分开 |
| `linuxdo`、`heybox` | 原生主题／帖子与评论；访问权限、父楼层和游标按接口判断 |
| 作品、音乐、技能与社交 API | 按资料对象与授权范围调用；详细入口见来源及平台指南 |

当前注册 125 个内置来源 ID，配置可增加动态来源；`capabilities --sources` 可缩小查看范围。Agent Reach 的渠道从统一 CLI 的 `channels` 发现；OpenCLI 从实时注册表发现接受 `query` 或 `keyword` 位置参数的只读搜索命令。来源注册与登录记录说明可调用的路径，实际账号权限、额度与结果仍由请求确认。

`sera channels` 返回各平台的 `search`、`read`、`configured` 和搜索入口的 `browser`／`strategy`。这份清单说明 SERA 可匹配的操作，实际登录与返回内容由调用结果确认。OpenCLI 的平台搜索覆盖比原文映射广；只有 `read: true` 的平台可直接通过该适配读取，其余可显式选择网页正文源。

Agent 的来源选择表位于项目 Skill；[领域指南](../skills/sera-search/references/domains.md)覆盖知识百科、语言与古籍、技术文档、学术医学、软件包、标准法规及公共数据。默认 Wiki 包含中英日 Wikipedia、中文 Wiktionary／Wikisource／Wikivoyage 和 Commons；其他公开 MediaWiki 实例可配置 `wiki.sites`。网页与 Wiki 历史版本、Internet Archive 馆藏见[档案指南](../skills/sera-search/references/archives.md)。

[游戏 Wiki](../skills/sera-search/references/game-wikis.md)采用独立的 [catalogs/game-wikis.json](../catalogs/game-wikis.json)，游戏查询通过 `--group game-wikis` 选择该组。[Galgame 社区](../skills/sera-search/references/galgame.md)使用 [catalogs/galgame.json](../catalogs/galgame.json)，通过 `--group galgame` 选择目录、`--platform` 选择站点；自定义站点目录使用 `--catalog <文件>`。常规配置分别加载自己的来源与站点目录。识图、直播、社区、评论及作品资料的当前范围见 [平台指南](../skills/sera-search/references/platform-expansion.md)。

2026-11-01 的有界检查取得了 Bing RSS、英文 Wikipedia、Wayback、Internet Archive、部分游戏 Wiki、skills.sh、作品数据库、B站单视频评论、小黑盒原生帖子／评论和 Steam 的真实结果。环境代理支持已接通；新 API 的适配与固定响应测试仍不能替代实际 Key、平台权限和质量验证，具体入口与范围见平台指南。
