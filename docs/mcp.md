# Agent Skill 与 MCP

项目 Skill 位于 [skills/sera-search/SKILL.md](../skills/sera-search/SKILL.md)。需要让 Agent 发现它时，可以将 Skill 安装到该 Agent 使用的标准技能入口：

```powershell
node .\dist\cli.js install --home 'F:\tools\sera-data' --skill-dir 'F:\.agents\skills'
```

Skill 指导 Agent 选择来源、使用 `research` 和读取证据。它属于项目提供的技能，源文件随包发布。`install --skill-dir` 链接到包内技能目录，需保留包的位置；目标已指向同一目录时重复执行保持不变，其他已有内容保留。

MCP 是同一核心的 Agent 接入口：

`sera_channels` 返回每个动作的参数 Schema；`sera_search`／`sera_research` 使用 `operation`、`params`、`contentTypes` 和按源区分的 `sourceOptions`。片段定位用 `locator`，实际数据范围见 `runs[].coverage`，调用计划见 `plan`。接口例子与各来源边界见[垂直来源](specialist-sources.md)。

```json
{
  "mcpServers": {
    "sera": {
      "command": "node",
      "args": [
        "F:/tools/sera-search/dist/cli.js",
        "mcp",
        "--home",
        "F:/tools/sera-data"
      ]
    }
  }
}
```

MCP 提供 16 个工具：`sera_connectors`、`sera_capabilities`、`sera_channels`、`sera_search`、`sera_comments`、`sera_images`、`sera_research`、`sera_migrate_state`、`sera_read`、`sera_read_many`、`sera_evidence`、`sera_record`、`sera_login`、`sera_logout`、`sera_auth` 和 `sera_backend`。检索参数对应 CLI 的来源、平台、每源数量、域名及日期条件；`sera_comments` 使用 `url/cursor/parentId/order`，`sera_images` 使用 `query` 或 `imageUrl`，完整字段以工具 Schema 为准。

## 结构化连接器

`sera_connectors` 按需返回协议、动作、输入 Schema、字段映射、认证方式、费用、限速和限制，不返回账号凭据。例如查看 Modrinth 与 Scryfall：

```json
{"sources":["modrinth","scryfall"]}
```

同一配置目录下的 `sources`、`connectorFiles` 和 `connectors` 也对 MCP 生效。来源 ID 可由配置动态增加；先用 `sera_connectors`／`sera_channels` 发现动作，再用 `sera_search` 的 `operation`、`params` 或 `sourceOptions` 调用。配置格式及专用协议边界见[连接器指南](connectors.md)。

自动选路优先匿名免费、认证免费，再考虑周期免费配额；认证加配额的来源降权。付费必需动作和一次性试用排除；混合计费或计费未确认的入口需要在核对账号免费档后设置 `sources.<来源>.freeTierConfirmed: true`。已知免费 Key 来源按其声明使用，实际配额和服务端账单仍需分别核对。

## 完整后端工具

`sera_backend` 接受 `{source, tool?, arguments?, timeoutMs?}`，`source` 为 `ghgrab`、`scrapling`、`aliens-eye`、`sherlock` 或 `gods-eye-view`。省略 `tool` 时返回后端当前工具及输入 Schema，例如：

```json
{"source":"scrapling"}
```

发现后传入实际工具名与符合该 Schema 的 `arguments` 对象。此入口保留上游完整工具范围；仓库搜索、已知网页读取等常规取证也可使用统一 `sera_search`／`sera_read`。先按任务调用 `sera_capabilities` 的 `sources:["ghgrab","scrapling","metadata-parser","google-news","iptv"]` 核对配置。

同一 SERA MCP 连接会复用后端进程，Scrapling 的内存会话可跨 `sera_backend` 调用保持；断开连接或重启 CLI 后需重新创建会话，跨进程恢复使用上游发现的 save／load 工具。安装、浏览器选择与兼容范围见[扩展来源与后端](integrations.md)。

账号和地理扩展的工具调用结果附带 `structuredContent.seraEvidence`，可用 `sera_evidence` 重读报告。Agent 按本次 Schema 控制站点、关联动作、区域和预算；账号发现、头像匹配与地理查询示例见[账号与地理扩展](extensions.md)。

用户明确提供 API Key 或 API 账号时，Agent 可调用 `sera_login`，输入 `source` 与 `credentials: {apiKey}`，Twitch 使用 `{apiKey, clientId}`；平台验证输入 `source` 与 `platform`。结果不回显凭据，每次 MCP 调用重新加载记录，登录后同一连接即可查询。CLI Agent 通过 Skill 与 `--help` 获得调用指引，MCP Agent 还会取得工具 Schema。MCP 的连接器、能力、渠道、搜索、研究与读取工具支持单次输入 `group:"game-wikis"` 或 `group:"galgame"`，同一连接可按需切换；自定义站点目录可在启动参数中传 `--catalog <目录文件>`。

## 首轮调用与续查

`sera_search` 的 `terms` 是发现用词，`excludeUrls` 标记已知链接；默认来源继续取得足量新命中，显式来源保留原始候选。`relevance` 是词面排序诊断，`sera_research` 允许部分匹配取证；`readLimit:0` 可先发现来源。

`sera_read`、`sera_read_many` 与 `sera_research` 的 `timeoutMs` 设置单次读取预算，`browser` 传已有 Chromium／Edge 路径，`raw:true` 让 `web` 保留原始 HTML。外部工具取得的内容用 `sera_record` 传 `url/title/content/method/observedAt` 保存，返回 `source:external` 的证据。

先按任务缩小能力查询，例如 `sera_capabilities` 传 `sources:["bing","web","steam","wayback"]`；只需要站点或平台选择时再查询相应 `sera_channels`。账号状态与实际请求的权限、额度分别由 `runs` 确认。

多对象问题传 `subjects` 与 `criteria`，判据 `kind` 区分必需条件和偏好，`targetCount` 表示需满足必需条件的对象数量；`query` 保留任务，`discoveryQuery` 控制本轮查询。更新 `state.assessments` 的结论、`outcome`、`scope` 和带原文坐标的 `citations` 后续查。工具先复用证据，再按进展执行换源或换查询；`coverage` 返回覆盖、引用与条件检查结果。`accessFailures[].retryAt` 保留明确等待条件。旧 `fields` 状态通过 `sera_migrate_state` 转换，返回新状态由调用方保存。输入与完整规则见[取证与续查](../skills/sera-search/references/workflows.md)。
