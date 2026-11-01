# 扩展来源与后端

SERA 将下列五个来源接入统一能力、搜索与读取流程；`ghgrab` 和 `scrapling` 还可通过 `backend`／`sera_backend` 调用上游完整工具。

| 来源 | 统一接口 | 取得的材料 |
|---|---|---|
| `ghgrab` | 搜索、读取 | GitHub 搜索、受支持 forge 的仓库树和文件；完整工具按上游 Schema 发现 |
| `scrapling` | 读取 | 已知 URL 的提取结果；完整后端提供 HTTP、浏览器和会话工具 |
| `metadata-parser` | 读取，并可增强 `web` | 已取得 HTML 的标题、meta、Open Graph、Twitter、Dublin Core 与声明 URL |
| `google-news` | 搜索、读取 | Google News RSS 条目、新闻目录和聚合记录 |
| `iptv` | 搜索、读取 | Free-TV IPTV 频道目录、流 URL 与 EPG 线索 |

## 安装与目录

默认 `install` 准备配置与可选 Skill 链接。需要扩展依赖时，显式选择组件；可以一次安装多个组件，也可以分次补装。

```powershell
node .\dist\cli.js install --home 'F:\tools\sera-data'
node .\dist\cli.js install --home 'F:\tools\sera-data' --components ghgrab,scrapling,metadata-parser --python 'D:\Python\python.exe' --browser 'D:\Apps\Edge\msedge.exe'
node .\dist\cli.js capabilities --home 'F:\tools\sera-data' --sources ghgrab,scrapling,metadata-parser,google-news,iptv --json
```

`--python` 选择已有 Python 3.10+，SERA 据此在数据目录建立虚拟环境。`--browser` 选择已有 Chromium／Edge 浏览器；省略时 Scrapling 的浏览器安装步骤使用数据目录内的浏览器位置。示例中的 Python、浏览器和数据目录需替换为实际路径。先选择数据目录，再执行组件安装，以控制依赖和缓存位置。

| 路径 | 用途 | `clean` 后 |
|---|---|---|
| `<home>/tools/ghgrab` | ghgrab 可执行文件 | 保留 |
| `<home>/tools/python` | Python 虚拟环境与扩展依赖 | 保留 |
| `<home>/tools/browsers` | 由组件管理的浏览器分发包 | 保留 |
| `<home>/tools/state` | 后端配置与持久状态 | 保留 |
| `<home>/cache/integrations` | 下载、安装与运行的受管理缓存 | 清理 |

安装成功后，配置写入实际可执行文件的绝对路径；模板中的 `enabled:false` 随成功安装更新。重复 `install --components` 会核对并补全所选组件，部分完成或中断后可重试同一命令。默认 `install` 保留已有配置与已安装组件。`clean` 同时处理 SERA 证据缓存，依赖、配置、登录记录与持久会话保留；清理范围见[证据指南](evidence.md)。

`google-news` 与 `iptv` 使用 SERA 自身的 HTTP 适配，无需安装 Python 组件。新闻语言、地区、主题和 M3U 地址见[配置指南](configuration.md)。

## 上游完整工具

先发现工具与输入 Schema，再按实际工具传参：

```bash
node dist/cli.js backend ghgrab --home F:/tools/sera-data --json
node dist/cli.js backend scrapling --home F:/tools/sera-data --json
node dist/cli.js backend scrapling TOOL_NAME --input ./backend-input.json --home F:/tools/sera-data --json
```

将 `TOOL_NAME` 换成发现的工具名，`backend-input.json` 保存该工具接受的 UTF-8 JSON 对象。省略 `tool` 时返回上游工具清单和 Schema；CLI 合同为 `backend <ghgrab|scrapling> [tool] --input JSON文件`。工具名、参数、浏览器选项和会话操作以本次发现结果为准。

MCP 使用 `sera_backend`，输入为 `{source, tool?, arguments?}`：

```json
{"source":"ghgrab"}
```

省略 `tool` 发现工具；实际调用时，`tool` 是发现的工具名，`arguments` 是符合该工具 Schema 的对象。返回结果保留上游结构，错误和内容范围需结合实际结果判断。这个入口适合上游专用操作；需要统一命中、证据 ID 和缓存时使用 `search`／`read`／`research`。

同一 SERA MCP 连接复用后端进程，Scrapling 内存会话可跨工具调用使用。关闭连接或重启 CLI 会结束该内存状态；CLI 每条 `backend` 命令独立运行。需要跨进程恢复时，用上游工具清单中的 save／load 功能持久化并恢复会话，保存路径与所用工具保持一致。

## 来源的使用范围

`ghgrab` 的搜索调用 GitHub。仓库树与文件读取支持其已识别的 forge，具体路径、ref 和认证按上游当前工具 Schema；它们不表示各 forge 都有统一搜索能力。先确认仓库、分支或提交，再核对实际返回的文件与范围。

`scrapling` 的统一读取用于已知网页 URL；HTTP、动态浏览器、批量及会话能力通过完整后端工具发现。根据目标内容选择工具，并核对实际响应是否取得所需正文。浏览器执行、页面标题、验证页与目标内容分别判断。

`metadata-parser` 解析调用方已取得的 HTML，不另行获取该 URL。输出保留官方分组原字段、解析方法及声明来源；canonical、OG URL 和网页日期都是页面声明。相对 URL 解析后仍保留原值，实际取得 URL 另行记录。启用该组件后，`web` 的原始 HTML 路径可做可选元数据增强；失败时继续保留已取得文本。它的直接读取返回 `contentKind:metadata`。页面声明支持来源分析，事实判断仍需对应证据。

`google-news` 通过公开 RSS 发现新闻，返回新闻标题、发布者、RSS 日期和聚合链接。RSS 记录以及未解析的 Google News 落地页标记为元数据；请求实际到达发布者且取得文本后，才能把那次取得内容作为正文。Google 聚合链接、发布者链接与真正取得 URL 按各自含义保留。

`iptv` 从 [Free-TV/IPTV](https://github.com/Free-TV/IPTV) 的公开 M3U 目录发现频道。结果中的流 URL、logo、频道分组和 EPG 是目录线索；`streamAvailability:unknown` 表示可播放性尚未验证。SERA 的目录读取不发起媒体播放或流可用性探测；节目和视听内容需要单独观察后取证。

## 兼容与维护

| 组件 | 当前适配范围 | 范围依据 |
|---|---|---|
| [ghgrab](https://github.com/abhixdd/ghgrab) | `v2.3.0`，Agent API `v1` | 当前发行包与 Agent／MCP 接口验收；安装使用发行校验值 |
| [Scrapling](https://github.com/D4Vinci/Scrapling) | `>=0.5,<0.6`，安装 AI／MCP 依赖 | 当前 MCP 工具、浏览器参数与会话合同 |
| [metadata_parser](https://github.com/jvanasco/metadata_parser) | `>=2,<3` | 当前 `MetadataParser` 与 `parsed_result.metadata` API |

这些版本范围是当前适配和可复现验收的边界，由 SERA 维护者负责跟进上游、更新适配和测试后再扩大。手动替换为范围外版本时，应先核对工具 Schema、返回结构及会话行为。来源材料与上游工具的许可、归属见[第三方说明](../THIRD_PARTY.md)。
