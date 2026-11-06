# 账号与地理扩展

扩展按需安装，通过同一个 CLI 和 MCP 连接发现工具、指定范围、读取结果及保存证据。Agent 根据当前问题选择动作，已取得的线索和报告可用于下一轮。

## 安装

```powershell
node dist/cli.js install --home F:/tools/sera-data --components aliens-eye,sherlock --python D:/Python/python.exe
node dist/cli.js install --home F:/tools/sera-data --components gods-eye-view
node dist/cli.js capabilities --home F:/tools/sera-data --sources aliens-eye,sherlock,gods-eye-view --json
```

账号依赖安装到 `<home>/tools/python`；地理扩展拥有 `<home>/tools/gods-eye-view` 中的独立运行依赖，并使用 Node.js 24+。`install --node 路径` 可选择已有运行时；缺省时检查当前程序与 PATH，缺失时给出要求和官方下载地址。安装与运行缓存由 `<home>/cache/integrations` 管理，沿用 `install` 的重复执行、失败重试和 `clean` 行为。扩展代码随 SERA 发布，安装成功后配置保存实际入口。

Aliens_eye 适配 `>=2.7.5,<2.8`，Sherlock 适配 `>=0.16.2,<0.17`，账号桥接使用 MCP Python SDK `>=2.3,<3`。这些范围约束当前使用的报告、关联、头像哈希、notifier 与 MCPServer 接口；维护者在更新范围时负责核对 Schema、状态和行为。头像匹配依赖 Pillow，与 Aliens_eye 组件一起安装。

## 工具发现和调用

```powershell
node dist/cli.js backend aliens-eye --home F:/tools/sera-data --json
node dist/cli.js backend sherlock --home F:/tools/sera-data --json
node dist/cli.js backend gods-eye-view --home F:/tools/sera-data --json
node dist/cli.js backend aliens-eye scan_username --input ./scan.json --timeout-ms 30000 --home F:/tools/sera-data --json
```

`scan.json` 示例：

```json
{"username":"octocat","sites":["github"],"timeout_seconds":15}
```

站点名称先由 `list_sites` 确认。MCP 对应：

```json
{"source":"aliens-eye","tool":"scan_username","arguments":{"username":"octocat","sites":["github"],"timeout_seconds":15},"timeoutMs":30000}
```

传给 `sera_backend`。省略 `tool` 返回工具清单与真实 Schema。`timeoutMs` 是外层调用预算；扫描工具的 `timeout_seconds` 应留出启动和返回时间。扫描内部预算到期会保留已完成结果，检查 `status`、`pendingSites` 和 `scanId`；外层中断后可用 `read_scan` 找到已经记录的站点。

## 账号发现与关联

| 动作 | 输入与用途 |
|---|---|
| `list_sites` | 按站点名或域名筛选目录，分页查看 URL 模板及用户名格式 |
| `scan_username` | 显式提供一个用户名和站点列表；变体级别、预算和代理按任务选择 |
| `read_scan` | 按 `scan_id` 读取已记录结果，省略时发现最近记录 |
| `match_profile_url` | 将已知主页链接反解为可能的站点和用户名 |
| `extract_leads` | 从已读取文本提取外链与 @用户名，供下一轮选择 |
| `correlate_profiles` | Aliens_eye：关联 `report` 中所选站点的资料，返回关系边与依据；`avatar_match` 控制头像抓取 |
| `compare_avatars` | Aliens_eye：对指定 `avatar_urls` 计算图像 dHash 距离；取得失败的图片单独标记 |

统一账号搜索也可使用 `search --sources aliens-eye --platform github`。目录中的平台标识统一为小写、连字符形式，原始上游站点名称保留在工具结果；先用 `channels --sources aliens-eye` 确认。也可按 `domains` 筛出目标站点。返回数量与实际扫描范围分别控制。

Agent 先选择与问题相关的平台，读取候选主页，再按缺口比较简介、外链或头像，需要时选取新用户名继续查询。上游状态、检测分数、原报告和关联依据保留；账号存在、资料相似及属于同一主体分别核验。Sherlock 的规则目录与误报排除表版本信息随结果返回，刷新失败时保留可用缓存并报告警告。

## 地理与时空查询

`gods-eye-view` 将上游查询和数据模块组合为独立运行的 SERA 扩展。通过工具清单选择具体领域，再按工具 Schema 指定区域、对象和过滤条件。区域可用地名、边界框或经纬度与半径；航班、船舶和卫星使用各自对象标识。

```json
{"source":"gods-eye-view","tool":"get_earthquakes","arguments":{"area":{"place":"Tokyo"},"min_magnitude":3,"limit":5}}
```

数据域、凭据、采集范围和运行限制以[扩展运行说明](../extensions/gods-eye-view/README.md)及本次 Schema 为准。需要综合资料时再选择综合工具；分别检查观测时间、抓取时间、陈旧状态、替代来源、缺失领域和结果截断。轨道预测、模拟值及原始观测按各自类型解释，结果过滤范围与上游实际采集范围分别确认。

## 证据与缓存

扩展工具的成功返回保存为 `contentKind:metadata`，`structuredContent.seraEvidence` 提供证据 ID。`sera://extensions/<扩展>/<标识>` 是 SERA 本地报告地址；原始网页和上游对象链接保留在报告数据中。用 `evidence`／`sera_evidence` 重读已保存报告，原文事实继续对应到实际材料。

图片通过 MCP 原内容返回，报告的 `imageCount` 记录图片数量；文本证据保存结构化数据，图片内容按本次返回核验。缓存保存失败不会丢弃已取得结果，查看 `cacheWarnings`。`clean` 可移除扫描检查点与运行缓存，已安装依赖和配置按现有目录规则保留。
