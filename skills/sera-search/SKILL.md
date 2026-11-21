---
name: sera-search
description: 使用 SERA CLI 或 MCP 跨来源发现资料、读取原文，并用对象、判据和证据记录推进多轮核验。适用于用户指定 SERA，或需要可回读证据的跨来源调查。
---

# SERA

优先通过 CLI 与本 Skill 使用 SERA，MCP 按需启用，共用同一 `SERA_HOME`／`--home`。先看任务相关来源的 `capabilities`；设置不明时用 `config --sources`，平台或动作不明时用 `channels`；结构化定义用 `connectors`，来源 ID 可由配置动态增加。实际网络、权限与额度由调用结果确认。按 `contentTypes` 选材料，按动作 Schema 提供 `operation`／`params`；多来源参数不同用 `sourceOptions`。字幕、弹幕、公开评审、模型与数据集等入口见[垂直来源](../../docs/specialist-sources.md)。

`source` 是提供者、`platform` 是目标平台、`operation` 是动作。按 `channels --platform 平台 --json` 发现 YouTube、Twitch 或 B站等同平台的多个入口，再按公开作品任务所需材料、预算和缺口选择。第三方关联不证明主体相同或数据独立；未指定材料或动作时不会自动逐一查询。缺少必填参数看 `search.plan.pendingActions`，按 `source/operation/entrypoint/required` 补齐；`entrypoint` 区分 `search`、`read`、`comments`、`images`，使用对应 CLI／MCP 入口。

首次配置、登录及费用策略见[登录与配置](references/auth.md)。需要在 Agent 注册 MCP 时，使用安装命令并按[客户端指南](../../docs/mcp.md)验证。

发现结果默认简洁。先按平台看渠道，指定来源查看动作 Schema。需要完整结果、原文坐标或历史诊断时，使用 `--full`／`full:true`，或按证据 ID 分页回读。

## 选择入口

| 当前材料 | 入口 |
|---|---|
| 尚未取得来源 | `search`；`terms` 为发现用词，`aliases` 补充实体别名 |
| 已有 URL 或明确对象 ID | `read`／`read-many`；已有证据用 `evidence` 定位、续读 |
| 已知公开视频的字幕 | `read URL --sources opencli --content-type subtitle`；按渠道 `read` 动作选择 YouTube `transcript`／B站 `subtitle`，语言等参数传 `params` |
| 已知视频、歌曲或授权媒体的评论 | 按渠道 `entrypoint:comments` 调用 `comments URL`／`sera_comments`，保留分页与覆盖 |
| 关键词图片或反向识图 | 按 `entrypoint:images` 调用 `image-search`／`reverse-image` 或 `sera_images`，`operation` 选择图片动作 |
| 多对象或多条件调查 | `research`；完整任务放 `query`，本轮查询放 `discoveryQuery`，对象与判据分别用 `subjects`／`criteria` |
| 宿主工具已经取得材料 | `record`／`sera_record`，保留原始 URL、内容、实际方法与观察时间 |
| 需要仓库、浏览器、账号或地理后端的完整动作 | `backend` 先发现当前 Schema，再调用相应工具 |

`research` 会先复用证据，按缺口搜索并检查完成条件。Agent 审阅原文后填写 `state.assessments` 的结论、条件满足情况、适用范围及引用坐标；`coverage` 返回合格对象、排除项和缺口。判据的 `kind` 区分必需条件与偏好，数量要求用 `targetCount`。接口与通用示例见[取证与续查](references/workflows.md)。

请求成功、取得材料和结论得到支持分别判断。搜索相关性及证据 ID 用于组织核验；发布时间、生效条件和原始引用关系需要结合正文理解。片段不足时续读，比较前对齐条件与口径。字幕／事件命中的 `locator` 需要随读取保留；`runs[].coverage` 是本次数据范围，研究 `coverage.complete` 是对象与判据检查。交叉核验用 `strategy:cross-check` 和 `maxSources`，核对共同覆盖区间及原始事件，不能将重复采集当成独立佐证。

`research` 的 `sources` 同时限制搜索和新读取，正文需要另一组入口时传 `readSources`。网页可用 `raw` 获取原始 HTML，渲染读取可传已有浏览器路径 `browser` 与单次预算 `timeoutMs`。SERA 路径不足时，按用户允许的来源与费用使用宿主工具接力，再导入实际材料。

## 按需参考

- [来源与查询语法](references/sources.md)／[领域材料](references/domains.md)：来源入口、搜索条件与材料范围。
- [取证与续查](references/workflows.md)：对象与判据、证据片段、完成检查、状态迁移与失败恢复。
- [历史档案](references/archives.md)、[游戏 Wiki](references/game-wikis.md)、[Galgame](references/galgame.md)、[社区、评论与图片](references/platform-expansion.md)：按材料选择目录和动作；游戏与作品目录在单次输入传 `group`。
- [登录记录](references/auth.md)：用户提供凭据或遇到认证问题时读取。
- [连接器](../../docs/connectors.md)：`sources`、`connectorFiles`、`connectors` 配置，动态来源与费用策略。
- [扩展来源与后端](../../docs/integrations.md)／[账号与地理扩展](../../docs/extensions.md)：完整工具、会话、安装位置与报告范围。

CLI 不在 PATH 时，解析技能目录真实路径，向上两级定位包根。发布包含 `bundle.json`，运行 `node <包根>/portable.mjs` 以加载组件环境；源码或 npm 包运行 `node <包根>/dist/cli.js`。PowerShell 7.3+ 也可使用发布包内的 `sera.ps1`。源码工作区可用 `<包根>/.sera` 作为数据目录。证据缓存沿用保留期与 `clean`，长期成果另行导出。`runs[].network` 的计数范围是 SERA 进程可观察 HTTP。
