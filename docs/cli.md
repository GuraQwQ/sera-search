# CLI

安装为可执行包后，下面的 `node dist/cli.js` 可以替换为 `sera`。使用 `--help` 查看实际参数。

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

# 清理 SERA 生成的证据缓存
node dist/cli.js clean --json
```

`search`／`research` 还支持 `--github-type repositories|code|issues`、重复的 `--domain` 和 `--since`。域名、时间过滤按来源的实际接口映射。用户使用原生搜索语法时，应指定来源，避免将同一表达式直接套给不同引擎。

平台查询通过 `--sources` 与 `--platform` 选择实际动作；游戏 Wiki 和 Galgame 社区还需选择 `--group`。Bing RSS 不支持统一 `--since`，需要日期条件时选择支持的 API，或继续核对原文日期。

`comments` 支持 `--limit`、`--cursor`、`--parent` 和按来源定义的 `--order`；一次读取一个评论页，返回逐评论 ID、父子关系、正文、`scope` 与下一页游标，最多请求 100 条。图片动作最多请求 20 条，结果保留原图、承载页面和匹配类型等 `metadata`；图片链接、搜索缩略图与来源文章分别核对。

未指定 `--sources` 时，`search` 按 `intent` 选择可用来源，空结果、无关候选或错误继续换源，有有效候选后停止。显式来源保持并行聚合。`--intent` 可指定 `official`、`feedback`、`historical`、`game`、`galgame`、`academic`、`code`、`images` 或 `general`；重复 `--alias` 补充别名，初始后端无有效结果时最多重试首个不同别名。`runs[].attempts` 记录实际查询、后端和换路原因。相关性为保守词面判断，跨语言名称或歧义短名需 agent 消歧。

`research --sources` 同时约束搜索和正文读取的来源范围。需要使用另一组读取后端时，传入 `--read-sources`；例如 `--sources brave --read-sources web`。MCP／库接口对应字段为 `readSources`。这样可以显式控制参与任务的来源及 API 调用预算。

正常结果和部分成功退出码为 `0`，整体失败或参数错误为 `1`，用户中断为 `130`。自动化调用应同时检查 JSON 中的 `status` 和 `runs`，部分成功仍可能有待补查来源。

| 来源 | SERA 的入口边界 |
|---|---|
| `exa`、`tavily` | 使用已登记的 API Key，搜索与正文提取 |
| `bing`、`sites` | 公开网页发现；站点目录用于选择域名，普通网页正文另选读取源 |
| `brave`、`zhipu`、`doubao` | 使用已登记的 API Key；网页搜索，Brave 另有关键词图片；正文另选读取源 |
| `serpapi`、`dataforseo` | Google／Bing 自然搜索；SerpAPI 可调用图片与 Lens；正文另选读取源 |
| `github` | 读取公开仓库、代码搜索结果及 issue／PR 等资料；受 GitHub 权限和速率限制约束 |
| `agent-reach`、`opencli` | 按实时渠道清单查询；账号渠道检查平台登录记录，正文、评论和字幕分别核对 |
| `bilibili`、`youtube`、`netease` | 视频／歌曲资料与评论；正文、字幕、评论和计数是不同对象 |
| `v2ex` | 公开帖子／节点资料读取；该 API 本身不是任意关键词全站搜索 |
| `web` | Jina Reader 通用网页读取 |
| `crossref`、`openalex`、`pubmed` | 公开书目与记录读取；摘要和元数据不能当成论文全文 |
| `wiki` | 七个默认 Wikimedia 站点和配置的 MediaWiki 实例；中英日 Wikipedia 与 `oldid` 指定修订读取 |
| `wayback`、`archive` | 网页捕获索引／快照与馆藏元数据；捕获时间和原始发布日期分开 |
| `linuxdo`、`heybox` | 原生主题／帖子与评论；访问权限、父楼层和游标按接口判断 |
| 作品、音乐、技能与社交 API | 按资料对象与授权范围调用；详细入口见来源及平台指南 |

当前注册 44 个来源，`capabilities --sources` 可缩小查看范围。Agent Reach 的渠道从统一 CLI 的 `channels` 发现；OpenCLI 从实时注册表发现接受 `query` 或 `keyword` 位置参数的只读搜索命令。来源注册与登录记录说明可调用的路径，实际账号权限、额度与结果仍由请求确认。

`sera channels` 返回各平台的 `search`、`read`、`configured` 和搜索入口的 `browser`／`strategy`。这份清单说明 SERA 可匹配的操作，实际登录与返回内容由调用结果确认。OpenCLI 的平台搜索覆盖比原文映射广；只有 `read: true` 的平台可直接通过该适配读取，其余可显式选择网页正文源。

Agent 的来源选择表位于项目 Skill；[领域指南](../skills/sera-search/references/domains.md)覆盖知识百科、语言与古籍、技术文档、学术医学、软件包、标准法规及公共数据。默认 Wiki 包含中英日 Wikipedia、中文 Wiktionary／Wikisource／Wikivoyage 和 Commons；其他公开 MediaWiki 实例可配置 `wiki.sites`。网页与 Wiki 历史版本、Internet Archive 馆藏见[档案指南](../skills/sera-search/references/archives.md)。

[游戏 Wiki](../skills/sera-search/references/game-wikis.md)采用独立的 [catalogs/game-wikis.json](../catalogs/game-wikis.json)，游戏查询通过 `--group game-wikis` 选择该组。[Galgame 社区](../skills/sera-search/references/galgame.md)使用 [catalogs/galgame.json](../catalogs/galgame.json)，通过 `--group galgame` 选择目录、`--platform` 选择站点；自定义站点目录使用 `--catalog <文件>`。常规配置分别加载自己的来源与站点目录。识图、直播、社区、评论及作品资料的当前范围见 [平台指南](../skills/sera-search/references/platform-expansion.md)。

2026-11-01 的有界检查取得了 Bing RSS、英文 Wikipedia、Wayback、Internet Archive、部分游戏 Wiki、skills.sh、作品数据库、B站单视频评论、小黑盒原生帖子／评论和 Steam 的真实结果。环境代理支持已接通；新 API 的适配与固定响应测试仍不能替代实际 Key、平台权限和质量验证，具体证据见平台指南与研究记录。
