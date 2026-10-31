# Agent Skill 与 MCP

项目 Skill 位于 [skills/sera-search/SKILL.md](../skills/sera-search/SKILL.md)。需要让 Agent 发现它时，可以将 Skill 安装到该 Agent 使用的标准技能入口：

```powershell
node .\dist\cli.js install --home 'F:\tools\sera-data' --skill-dir 'F:\.agents\skills'
```

Skill 指导 Agent 选择来源、使用 `research` 和读取证据。它属于项目提供的技能，源文件随包发布。`install --skill-dir` 链接到包内技能目录，需保留包的位置；目标已指向同一目录时重复执行保持不变，其他已有内容保留。

MCP 是同一核心的 Agent 接入口：

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

MCP 提供 12 个工具：`sera_capabilities`、`sera_channels`、`sera_search`、`sera_comments`、`sera_images`、`sera_research`、`sera_read`、`sera_read_many`、`sera_evidence`、`sera_login`、`sera_logout` 和 `sera_auth`。检索参数对应 CLI 的来源、平台、每源数量、域名及日期条件；`sera_comments` 使用 `url/cursor/parentId/order`，`sera_images` 使用 `query` 或 `imageUrl`，完整字段以工具 Schema 为准。

用户明确提供 API Key 或 API 账号时，Agent 可调用 `sera_login`，输入 `source` 与 `credentials: {apiKey}`、Twitch 的 `{apiKey, clientId}` 或 DataForSEO 的 `{username, password}`；平台验证输入 `source` 与 `platform`。结果不回显凭据，每次 MCP 调用重新加载记录，登录后同一连接即可查询。CLI Agent 通过 Skill 与 `--help` 获得调用指引，MCP Agent 还会取得工具 Schema。MCP 的能力、渠道、搜索、研究与读取工具支持单次输入 `group:"game-wikis"` 或 `group:"galgame"`，同一连接可按需切换；自定义站点目录可在启动参数中传 `--catalog <目录文件>`。
