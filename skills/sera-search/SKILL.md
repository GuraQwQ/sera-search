---
name: sera-search
description: 使用 SERA CLI 或 MCP 跨来源发现资料、读取原文，并用对象、判据和证据记录推进多轮核验。适用于用户指定 SERA，或需要可回读证据的跨来源调查。
---

# SERA

沿用同一 `SERA_HOME`／`--home`。先看任务相关来源的 `capabilities`，平台不明时用 `channels`；实际网络、权限与额度由调用结果确认。

## 选择入口

| 当前材料 | 入口 |
|---|---|
| 尚未取得来源 | `search`；`terms` 为发现用词，`aliases` 补充实体别名 |
| 已有 URL 或明确对象 ID | `read`／`read-many`；已有证据用 `evidence` 定位、续读 |
| 多对象或多条件调查 | `research`；完整任务放 `query`，本轮查询放 `discoveryQuery`，对象与判据分别用 `subjects`／`criteria` |
| 宿主工具已经取得材料 | `record`／`sera_record`，保留原始 URL、内容、实际方法与观察时间 |
| 需要仓库、浏览器、账号或地理后端的完整动作 | `backend` 先发现当前 Schema，再调用相应工具 |

`research` 会先复用证据，按缺口搜索并检查完成条件。Agent 审阅原文后填写 `state.assessments` 的结论、条件满足情况、适用范围及引用坐标；`coverage` 返回合格对象、排除项和缺口。判据的 `kind` 区分必需条件与偏好，数量要求用 `targetCount`。接口与通用示例见[取证与续查](references/workflows.md)。

请求成功、取得材料和结论得到支持分别判断。搜索相关性及证据 ID 用于组织核验；发布时间、生效条件和原始引用关系需要结合正文理解。片段不足时续读，比较前对齐条件与口径。

`research` 的 `sources` 同时限制搜索和新读取，正文需要另一组入口时传 `readSources`。网页可用 `raw` 获取原始 HTML，渲染读取可传已有浏览器路径 `browser` 与单次预算 `timeoutMs`。SERA 路径不足时，按用户允许的来源与费用使用宿主工具接力，再导入实际材料。

## 按需参考

- [来源与查询语法](references/sources.md)／[领域材料](references/domains.md)：来源入口、搜索条件与材料范围。
- [取证与续查](references/workflows.md)：对象与判据、证据片段、完成检查、状态迁移与失败恢复。
- [历史档案](references/archives.md)、[游戏 Wiki](references/game-wikis.md)、[Galgame](references/galgame.md)、[社区、评论与图片](references/platform-expansion.md)：按材料选择目录和动作；游戏与作品目录在单次输入传 `group`。
- [登录记录](references/auth.md)：用户提供凭据或遇到认证问题时读取。
- [扩展来源与后端](../../docs/integrations.md)／[账号与地理扩展](../../docs/extensions.md)：完整工具、会话、安装位置与报告范围。

CLI 不在 PATH 时，解析技能目录真实路径，向上两级定位包根，运行 `node <包根>/dist/cli.js`；源码工作区可用 `<包根>/.sera` 作为数据目录。证据缓存沿用保留期与 `clean`，长期成果另行导出。`runs[].network` 的计数范围是 SERA 进程可观察 HTTP。
