---
name: sera-search
description: 使用 SERA CLI 或 MCP 搜索网页、平台、领域资料和历史档案，读取原文、评论或图片来源并核验证据。适用于用户指定 SERA，或需要跨来源查证资料时。
---

# SERA

先明确用户要解决的问题、必须满足的条件与所需证据，区分明确要求、推断和待确认项。核对对象、别名、时间、版本及适用范围；多轮任务拆成可核验主张，用证据回答各项，保留条件性结论与未知。

## 按缺口选路

沿用同一 `SERA_HOME`／`--home`，复用已确认的任务相关能力；未知时用 `sera capabilities --sources bing,web --json` 等查询确认，MCP 用 `sera_capabilities` 的 `sources`，平台不明时用 `channels` 筛选。实际可用性和结果相关性由本次响应确认，缺少凭据的账号渠道显示“未登录，不可用”。

| 当前缺口 | 下一步 |
|---|---|
| 材料尚未找到 | `search` 按对象、别名与待查主张发现原始来源 |
| 已有 URL／ID，或内容未展开 | `read`／`read-many` 取证；已有证据用 `evidence` 定位、续读 |
| 需要交互、动态内容或当前页面状态 | 使用当前环境可用的浏览器工具观察，记录有关状态与原文 |
| 需要结构化、历史或媒体材料 | 选择相应 API、档案、字幕、评论或图像入口，核对实际取得范围 |

按所需观察选择工具。相关 SERA 入口不可用或不足以补齐关键主张时，可用用户允许的宿主搜索、浏览器或其他工具接力；外部材料保留原始 URL、实际方法、观察时间与片段，接回同一任务记录。按用户约定的来源、费用与访问边界换路；Agent 自选的 `sources` 限定该次调用。

简单问题直接读取；跨轮问题用 `research` 的 `goals` 与 `state` 跟踪主张和缺口。`research` 的 `sources` 同时约束搜索和读取，另选正文源用 `readSources`／`--read-sources`。`read-many` 最多20项、三路并行；用 `query`／`keywords` 定位，再按需续读。

## 核验与续查

分别检查请求是否成功、是否取得目标材料、材料是否支持待查结论。结合 `runs`、正文和 `metadata` 判断；无关结果、错误页、验证页、摘要和元数据各有取得范围，`ok` 与证据 ID 只作为核验线索。

按主张类型选证据：规则与声明追到原始发布者，实际表现查观测记录，用户体验查原帖。对齐对象、时间、版本和适用条件后处理冲突；转载及共享上游材料归为同一证据来源。发布时间、修订／捕获时间与本次取得时间分别保留；`refresh` 跳过本地 URL 缓存，上游新鲜度仍需核实。

每轮先审阅已有材料，再选择能推进关键缺口的行动。结果无关时调整查询或来源，内容不足时续读或换取得方法；403按访问条件换路，429遵守 `retryAfterSeconds`／`retryAt` 并先处理其他分支。重复尝试缺少新信息时调整方法或保留未决问题。

CLI 多轮任务用 `--state ./research-state.json` 创建或原子更新记录；核验后更新 `fields` 的 `supported`／`conflict`、真实 `evidenceIds` 与 `note`，MCP传回 `state`。`nextQuery` 提供聚焦缺口的建议。状态与缓存保存问题分别看 `stateWarnings`／`cacheWarnings`，继续使用已返回材料。工具接力和状态示例见 [取证与续查](references/workflows.md)。

## 交付

逐项对照用户目标，给结论关联原始来源、证据及适用范围，区分事实、来源自述、推断、冲突和未知。比较与推荐同时考虑条件符合程度和证据充分性；以关键主张得到支持判断完成。证据已充分时结束；可用路径难以继续补证时交付已有结论及具体缺口，候选和引用数量仅描述覆盖情况。

## 按需参考

- [来源与查询语法](references/sources.md)：来源入口、搜索条件与内容边界；[领域材料](references/domains.md)：文档、学术、标准等。
- [历史档案](references/archives.md)：Wayback、Wiki修订与Internet Archive。
- [游戏 Wiki](references/game-wikis.md)／[Galgame](references/galgame.md)：分别传 `group:game-wikis`／`group:galgame` 后选站；[社区、评论与图片](references/platform-expansion.md)另看动作范围。
- 用户提供凭据或遇认证问题时读 [登录记录](references/auth.md)。
- 需要仓库／浏览器完整工具、会话或 HTML 声明元数据时读[扩展来源与后端](../../docs/integrations.md)：按需安装，先发现后端 Schema 再调用。

CLI 不在 PATH 时，解析技能目录真实路径，向上两级定位包根，运行 `node <包根>/dist/cli.js`；源码工作区未指定数据目录时可用 `<包根>/.sera`。MCP目录分组在单次输入传 `group`。HTTP沿用环境代理与 `NO_PROXY`。
