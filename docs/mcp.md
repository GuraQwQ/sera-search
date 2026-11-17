# Agent Skill 与 MCP

推荐 Agent 通过 CLI 与项目 Skill 使用 SERA；MCP 是可选入口，共用同一配置、凭据与证据目录。项目 Skill 位于 [skills/sera-search/SKILL.md](../skills/sera-search/SKILL.md)，可链接到所用 Agent 的标准技能入口：

```powershell
node .\dist\cli.js install --home 'F:\tools\sera-data' --skill-dir 'F:\.agents\skills' --json
```

Skill 指导 Agent 选择来源、使用 `research` 和读取证据。它属于项目提供的技能，源文件随包发布。`install --skill-dir` 链接到包内技能目录，需保留包的位置；目标已指向同一目录时重复执行保持不变，其他已有内容保留。

## 注册可选 MCP 服务

通过 `install --mcp-client` 选择已有客户端，注册名为 `sera`。例如只注册到 Codex：

```bash
node dist/cli.js install --home ./.sera --mcp-client codex --json
```

客户端 ID 可为 `codex`、`pi`、`omp`、`claude-code`、`hermes`、`openclaw`、`antigravity`；逗号分隔可选择多个，每项独立处理。`mcp.registrations` 返回逐项结果，待处理项不妨碍后续客户端，`mcp.status` 汇总为 `ready`、`partial` 或 `cancelled`。客户端和命令需已安装，注册流程不自动安装它们。

单客户端调用可用 `--mcp-command` 指定已有 CLI 路径；JSON 客户端还可用 `--mcp-config` 指定实际目标文件。注册固定绝对 Node、包入口、`home` 和 SERA 配置文件路径，Key 保留在 SERA 数据目录。注册后开启新会话或刷新对应客户端工具清单。

### 客户端适配

| 客户端 ID | 注册入口与配置格式 | 官方依据 |
|---|---|---|
| `codex` | 原生 `codex mcp` CLI，沿用 `CODEX_HOME` 等客户端配置定位 | [Codex MCP](https://developers.openai.com/codex/mcp) |
| `pi` | 个人 `~/.pi/agent/mcp.json`，根 `mcpServers`；需要支持原生 MCP 的 Pi 版本 | [Pi MCP](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/mcp.md) |
| `omp` | 当前原生 MCP；默认配置为 `~/.omp/agent/mcp.json`，根 `mcpServers`，配置目录与命名 profile 可改变位置 | [OMP MCP](https://omp.sh/docs/mcp) |
| `claude-code` | 用户 `~/.claude.json`，或 `CLAUDE_CONFIG_DIR` 目录内 `.claude.json`，根 `mcpServers` | [MCP 作用域](https://code.claude.com/docs/en/mcp)／[目录定位](https://code.claude.com/docs/en/claude-directory) |
| `hermes` | 原生 `hermes config get/set`，保存 `mcp_servers.sera`；沿用客户端配置定位 | [MCP 格式](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference)／[配置 CLI](https://hermes-agent.nousresearch.com/docs/user-guide/configuration) |
| `openclaw` | 原生 `openclaw mcp show/set` registry，保存其管理的 MCP 条目 | [MCP registry](https://docs.openclaw.ai/cli/mcp/registry) |
| `antigravity` | 当前全局 `~/.gemini/config/mcp_config.json`，根 `mcpServers`，App／IDE／CLI 共用 | [Antigravity MCP](https://antigravity.google/docs/mcp/) |

`--mcp-config` 用于 Pi、OMP、Claude Code、Antigravity；Codex、Hermes、OpenClaw 通过各自原生 CLI 的环境或参数定位配置。已有目录链接解析到实际位置；默认位置若落在尚未使用的 C 盘目录，先明确选择数据盘文件。例如只配置 Antigravity：

```bash
node dist/cli.js install --home ./.sera --mcp-client antigravity --mcp-config F:/Antigravity/.gemini/config/mcp_config.json --json
```

该路径应与客户端实际读取的位置一致。表中列出适配的注册方式，客户端工具清单和个人会话是否就绪仍由对应客户端确认。

其他支持本地 stdio 的客户端可使用以下配置，路径替换为实际安装与数据目录：

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

MCP 提供 18 个工具：`sera_setup`、`sera_config`、`sera_connectors`、`sera_capabilities`、`sera_channels`、`sera_search`、`sera_comments`、`sera_images`、`sera_research`、`sera_migrate_state`、`sera_read`、`sera_read_many`、`sera_evidence`、`sera_record`、`sera_login`、`sera_logout`、`sera_auth` 和 `sera_backend`。检索参数对应 CLI 的来源、平台、每源数量、域名及日期条件；`sera_comments` 使用 `url/cursor/parentId/order`，`sera_images` 使用 `operation` 与 `query` 或 `imageUrl`，完整字段以工具 Schema 为准。

## 配置与会话

先按任务查看 `sera_capabilities`，需要入口或账号设置时查看 `sera_config`。`sera_setup` 在服务器固定的 `home/config` 中执行非交互配置：探测已有本地入口、从服务器环境补齐 Key、验证已有平台会话，缺项返回待办。例如：

```json
{"sources":["github","opencli"],"platforms":["opencli:zhihu"]}
```

`components` 显式选择才下载安装；`python`、`browser`、`node` 指定已有运行时。`confirmFreeTier` 仅在用户已核对免费档时填写，不由自动配置代为确认，也不能限制服务端扣费。`sera_setup` 不打开登录页。

`sera_config` 无更新字段时读取运行配置投影；`sources` 仅筛选返回来源，`updates` 更新来源设置，`backends` 更新命令入口，`connectorFiles` 替换声明文件列表，`connectors` 按 ID 合并完整定义。例如：

```json
{"sources":["github","opencli"],"updates":{"github":{"enabled":true}},"backends":{"opencli":{"enabled":true}}}
```

该接口校验字段并返回脱敏投影，凭据通过 `sera_login` 登记；可更新字段与 CLI `config --input` 共用契约，见[配置指南](configuration.md#查看与更新运行配置)。`home` 由服务器启动时固定。

外部声明文件失效时，可用 `{"connectorFiles":[]}` 移除引用或提交新的声明列表。MCP 启动及配置工具只校验主配置，补丁合并后再验证完整新配置；业务工具仍严格检查全部引用。无效补丁保留原配置，修复后同一连接即可继续调用。

`sera_login` 的 `credentials`、`fromEnv`、`platform` 三条路径必须且只能选一条。已有 Key 可只传服务器进程中的环境变量名：

```json
{"source":"exa","fromEnv":"EXA_API_KEY"}
```

这读取 MCP 服务器启动时继承的环境，不会读取客户端或当前终端后来增加的变量；变更环境后需重新启动服务。若变量不存在，返回补齐提示。用户直接提供凭据时可传 `credentials:{"apiKey":"…"}`，Twitch 使用 `apiKey/clientId`；结果不回显凭据，API 实际调用时才验证。

`fromEnv` 仅更新 Key，保留已有有效登录记录的辅助字段；显式 `credentials` 则完整替换该条凭据。

平台会话验证可传 `{"source":"opencli","platform":"zhihu","sessionOnly":true}`。`sessionOnly` 仅适用于平台；默认 `false`，可按后端流程打开官方登录页，需用户完成扫码或验证后才算登录。每次工具调用重新加载配置与登录记录，同一连接后续查询即可采用已保存设置；配置读取不等同于平台会话已通过验证。

主配置中的 `catalogFile` 会随工具调用重新加载；启动时显式传入的 `--catalog` 则固定用于该服务连接。

`sera_channels` 返回每个动作的参数 Schema，`entrypoint` 为 `search`、`read`、`comments` 或 `images`，分别使用对应工具。`sera_read`／`sera_read_many` 支持 `operation`、`params`、`contentTypes`：URL 独立传递，动作 Schema 描述 `params`。例如读取已知公开视频的实际字幕：

```json
{"url":"https://www.youtube.com/watch?v=VIDEO_ID","sources":["opencli"],"operation":"transcript","params":{"lang":"en","mode":"raw"},"contentTypes":["subtitle"]}
```

`sera_search`／`sera_research` 使用 `operation`、`params`、`contentTypes` 和按源区分的 `sourceOptions`。智谱、豆包、SerpAPI 的 `platform` 均为 `web`，检索引擎或行业用 `operation`。片段定位用 `locator`，实际范围见 `runs[].coverage`，调用计划及待补参数见 `plan`；游标按各动作 Schema 回传到 `params`。接口例子与来源边界见[垂直来源](specialist-sources.md)。

## 结构化连接器

`sera_connectors` 按需返回协议、`search` 动作定义、输入 Schema、字段映射、认证方式、费用、限速和限制，不返回账号凭据；专用评论和图片动作通过 `sera_channels` 发现。例如查看 Modrinth 与 Scryfall：

```json
{"sources":["modrinth","scryfall"]}
```

同一配置目录下的 `sources`、`connectorFiles` 和 `connectors` 也对 MCP 生效。来源 ID 可由配置动态增加；先发现动作和 `entrypoint`，再用相应工具调用，检索动作接受 `operation`、`params` 或 `sourceOptions`。配置格式及专用协议边界见[连接器指南](connectors.md)。

自动选路优先匿名免费、认证免费，再考虑周期免费配额；认证加配额的来源降权。付费必需动作和一次性试用排除；混合计费或计费未确认的入口需要在核对账号免费档后设置 `sources.<来源>.freeTierConfirmed: true`。已知免费 Key 来源按其声明使用，实际配额和服务端账单仍需分别核对。

## 完整后端工具

`sera_backend` 接受 `{source, tool?, arguments?, timeoutMs?}`，`source` 为 `ghgrab`、`scrapling`、`aliens-eye`、`sherlock` 或 `gods-eye-view`。省略 `tool` 时返回后端当前工具及输入 Schema，例如：

```json
{"source":"scrapling"}
```

发现后传入实际工具名与符合该 Schema 的 `arguments` 对象。此入口保留上游完整工具范围；仓库搜索、已知网页读取等常规取证也可使用统一 `sera_search`／`sera_read`。先按任务调用 `sera_capabilities` 的 `sources:["ghgrab","scrapling","metadata-parser","google-news","iptv"]` 核对配置。

同一 SERA MCP 连接会复用后端进程，Scrapling 的内存会话可跨 `sera_backend` 调用保持；断开连接或重启 CLI 后需重新创建会话，跨进程恢复使用上游发现的 save／load 工具。安装、浏览器选择与兼容范围见[扩展来源与后端](integrations.md)。

账号和地理扩展的工具调用结果附带 `structuredContent.seraEvidence`，可用 `sera_evidence` 重读报告。Agent 按本次 Schema 控制站点、关联动作、区域和预算；账号发现、头像匹配与地理查询示例见[账号与地理扩展](extensions.md)。

CLI Agent 通过 Skill 与 `--help` 获得调用指引，MCP Agent 还会取得工具 Schema。MCP 的连接器、能力、渠道、搜索、研究与读取工具支持单次输入 `group:"game-wikis"` 或 `group:"galgame"`，同一连接可按需切换；自定义站点目录可在启动参数中传 `--catalog <目录文件>`。

## 首轮调用与续查

`sera_search` 的 `terms` 是发现用词，`excludeUrls` 标记已知链接；默认来源继续取得足量新命中，显式来源保留原始候选。`relevance` 是词面排序诊断，`sera_research` 允许部分匹配取证；`readLimit:0` 可先发现来源。

`sera_read`、`sera_read_many` 与 `sera_research` 的 `timeoutMs` 设置单次读取预算，`browser` 传已有 Chromium／Edge 路径，`raw:true` 让 `web` 保留原始 HTML。外部工具取得的内容用 `sera_record` 传 `url/title/content/method/observedAt` 保存，返回 `source:external` 的证据。

先按任务缩小能力查询，例如 `sera_capabilities` 传 `sources:["bing","web","steam","wayback"]`；只需要站点或平台选择时再查询相应 `sera_channels`。账号状态与实际请求的权限、额度分别由 `runs` 确认。

多对象问题传 `subjects` 与 `criteria`，判据 `kind` 区分必需条件和偏好，`targetCount` 表示需满足必需条件的对象数量；`query` 保留任务，`discoveryQuery` 控制本轮查询。更新 `state.assessments` 的结论、`outcome`、`scope` 和带原文坐标的 `citations` 后续查。工具先复用证据，再按进展执行换源或换查询；`coverage` 返回覆盖、引用与条件检查结果。`accessFailures[].retryAt` 保留明确等待条件。旧 `fields` 状态通过 `sera_migrate_state` 转换，返回新状态由调用方保存。输入与完整规则见[取证与续查](../skills/sera-search/references/workflows.md)。
