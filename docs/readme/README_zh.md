<div align="center">

[English](../../README.md) · **简体中文**

<img src="../../docs/assets/sera-icon.svg" alt="SERA 放大镜：墨绿色镜框、薄荷色镜片与琥珀色手柄" width="128" height="128" />

# SERA：搜索一切

### 一个 CLI 搜索网页、社区、数据库与互联网档案，按需接入 MCP。

**让 Agent 找到原始材料，带着证据回答。**

[![跨平台验证](https://github.com/GuraQwQ/sera-search/actions/workflows/ci.yml/badge.svg)](https://github.com/GuraQwQ/sera-search/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-39786B?style=flat-square)](https://nodejs.org/)
[![MIT](https://img.shields.io/badge/许可证-MIT-D99A42?style=flat-square)](../../LICENSE)

[快速开始](#快速开始) · [接入你的-agent](#接入你的-agent) · [工作方式](#工作方式) · [可以查什么](#可以查什么) · [文档](#文档)

</div>

想核实产品规格、追踪一条消息的出处，或找回已经消失的网页？把问题交给接入 SERA 的 Agent：找到对应来源，读取原始材料，追查还没解决的线索，再用证据说明答案。

SERA 把网页、代码、社区、学术、作品数据库和互联网归档接到同一套检索与取证接口。主要通过 CLI 与项目 Skill 供 Agent 调用，需要工具协议时可选 MCP。搜索结果继续通向原文、帖子、评论、结构化记录或历史快照，保留链接、版本、时间与可回读的证据 ID。

## 快速开始

Windows x64 可下载[轻量 ZIP](https://github.com/GuraQwQ/sera-search/releases/download/v1.0.0/SERA-v1.0.0-lite-windows-x64.zip)或[完整 ZIP](https://github.com/GuraQwQ/sera-search/releases/download/v1.0.0/SERA-v1.0.0-full-windows-x64.zip)，解压后运行 `sera.cmd`。完整版预装六个可选组件及其依赖；两版均检测本机已有环境，缺失时显示要求和下载入口。使用方法见[发布包指南](../../docs/releases.md)。

需要 **Node.js 22 或以上版本**。当前从源码运行，尚未发布到 npm。

```bash
git clone https://github.com/GuraQwQ/sera-search.git
cd sera-search
npm ci --cache ./.cache/npm
npm run build
node dist/cli.js install --home ./.sera
node dist/cli.js capabilities --home ./.sera --sources bing,web --json
```

使用公开网页来源完成一次搜索与原文读取：

```bash
node dist/cli.js research "TypeScript 官方发布记录" --home ./.sera --sources bing --read-sources web --read-limit 3 --json
```

在真实终端运行 `install` 会进入配置向导：探测已有工具入口，从受支持的环境变量补齐凭据，复核已保存的平台会话，再按选择加入新平台。无人值守使用 `node dist/cli.js install --home ./.sera --yes --json`；加 `--sources github,youtube` 可限定本轮来源。API 凭据仅登记，实际请求时才验证；免费档确认与平台登录分别选择，完整参数见[安装配置](../../docs/cli.md#安装配置与调用后端)。

先指定 `--home`，让数据、依赖与缓存写入选定磁盘；源码示例使用工作区内 `.sera/`，避免落入默认用户目录所在的 C 盘。重复向导保留已有凭据字段和用户停用项，补全缺项。后续调用沿用同一 `--home` 或 `SERA_HOME`；已可用的公开来源可直接请求，网络、登录与额度以 `runs` 为准。

向导只探测本机已有工具，下载组件仍需显式选择 `--components`：

```bash
node dist/cli.js install --home F:/tools/sera-data --components ghgrab,scrapling,metadata-parser --python D:/Python/python.exe --browser "D:/Apps/Edge/msedge.exe"
```

将路径替换为已有 Python 与 Chromium／Edge 浏览器。组件位于 `<home>/tools`，受管理缓存位于 `<home>/cache/integrations`；重复执行会核对或修复所选组件。兼容范围与后端工具发现见[扩展来源与后端](../../docs/integrations.md)。

已有 URL 或对象 ID 时可以直接读取：

```bash
node dist/cli.js read-many "steam:105600" "sm8628149" --home ./.sera --keyword "release_date" --keyword "firstRetrieve" --json
```

完整参数见 [CLI 指南](../../docs/cli.md)，API Key、代理和平台后端见 [配置指南](../../docs/configuration.md)。

## 接入你的 Agent

先使用 CLI 与项目 Skill。把 Skill 链接到 Agent 的标准技能入口，目标目录换成所用客户端的实际位置：

```bash
node dist/cli.js install --home ./.sera --skill-dir F:/path/to/agent-skills --json
```

Skill 链接到包内目录，需要保留包的位置。Agent 按任务查看相关 `capabilities` 与 `config`，发现动作和参数；需要 Key 时用 `login --from-env` 登记已有环境变量，需要平台时验证所选会话，再搜索、读取原文并按缺口续查，全程沿用同一 `--home`。

MCP 按需启用。支持 Codex、Pi、OMP、Claude Code、Hermes、OpenClaw 与 Antigravity，选择自己使用的客户端；例如注册到已有 Codex：

```bash
node dist/cli.js install --home ./.sera --mcp-client codex --json
```

`--mcp-client` 可传逗号分隔的客户端 ID，逐项返回结果，客户端需事先安装。单客户端可用 `--mcp-command` 指定已有 CLI，JSON 客户端可用 `--mcp-config` 选择 F 盘等数据盘的配置文件。注册固定绝对 Node、包入口、数据目录与配置路径，Key 保留在 SERA 凭据目录。注册后开启新会话或刷新对应客户端工具清单。MCP 也提供 `sera_setup`、`sera_config` 与 `sera_login` 完成配置和会话流程，详见[适配与配置](../../docs/mcp.md)。

接入后可以这样提问：

```text
用 SERA 核查 AIR 的 Steam 版中文支持时间线。
先确认作品和版本，再查官方商店、公告及历史快照。
分别列出界面、字幕和语音的证据，保留冲突与尚未确认的字段。
```

## 工作方式

```mermaid
flowchart LR
    A[你的问题] --> B[Agent 确认实体与待查字段]
    B --> C[SERA 选源、搜索与读取]
    C --> D[原文、版本、时间、证据 ID]
    D --> E[Agent 核验并回答]
    E -->|仍有缺口| B
```

- **先选合适的材料。** 版本、日期和规格优先官方资料；用户反馈读取原帖与评论；历史问题定位原 URL、域名和快照。账号渠道缺少有效凭据时显示“未登录，不可用”。
- **少翻页、少重复读取。** `query`／`keywords` 定位原文片段；`read-many` 三路并行、合并重复 URL；新鲜缓存可复用，需要最新内容时传 `refresh`。
- **只补还缺的证据。** `research` 用对象、必需判据与偏好组织核验；先复用已有证据，再补缺口。Agent 填写结论、适用范围和原文片段引用，工具检查覆盖与数量并记录搜索进展。CLI 从首轮用 `--state` 保存，旧状态自动备份迁移。完整契约见[取证与续查示例](../../skills/sera-search/references/workflows.md)。
- **换路过程可追溯。** 默认按意图选源，空结果、无关候选或错误继续换后端；显式 `sources` 并行聚合所选来源。重试受限入口前查看 `runs` 与 `retryAfterSeconds`，保留成功证据，继续其他线索。

全文保留在证据 ID 下，相关片段带 Unicode 坐标。排序分数用于组织召回；多个引擎找到同一篇文章仍是一份原始材料。证据的读取范围、内容类型和使用方式见 [证据指南](../../docs/evidence.md)。

## 可以查什么

当前注册 **126 个内置来源 ID**，MCP 提供 **18 个工具**；配置还可增加动态来源 ID。注册数量不代表全部可用，具体动作由配置、权限、收录范围与上游响应确认。

账号与地理扩展通过 `install --components aliens-eye,sherlock,gods-eye-view` 按需安装。Agent 用 `backend 来源` 发现真实工具，自行选择站点、关联信号、区域及后续动作；账号候选、关联依据和地理查询结果可保存为证据。使用方法见[账号与地理扩展](../../docs/extensions.md)。

| 资料 | 入口示例 | 返回内容 |
|---|---|---|
| 网页、新闻与官方文档 | Bing、Exa、Tavily、Brave、智谱、豆包、SerpAPI | 候选链接、摘要；支持的后端继续提取原文 |
| 仓库、代码与平台内容 | GitHub、Agent Reach、OpenCLI、B站、V2EX | 仓库、发布说明、文件、帖子或平台记录，按实时渠道选择动作 |
| 学术与百科 | Crossref、OpenAlex、PubMed、MediaWiki、Wikidata | 书目、摘要、页面原文、指定修订与结构化实体 ID |
| 科研材料与公共数据 | OpenReview、Europe PMC、Hugging Face、UniProt、World Bank、Eurostat | 公开评审、开放研究材料、科学记录与限定范围的数据查询 |
| 字幕、直播归档与历史事件 | Filmot、Holodex、Aicu、Danmakus、GH Archive | 命中片段、时间戳、事件记录和实际收录限制 |
| 游戏、动漫、音乐与作品资料 | Steam、Niconico、VNDB、Bangumi、MusicBrainz 等 | 对象 ID、发行版本、公开游戏评价、规格、署名与元数据 |
| 历史网页与失传信息 | Wayback、Internet Archive | 捕获索引、实际快照、馆藏及文件目录 |
| 社区、评论与图片来源 | LinuxDo、小黑盒、YouTube、网易云、图片与反向识图接口 | 原帖、评论分页、父子回复、图片承载页及匹配线索 |
| 仓库与浏览器工具、新闻和频道目录 | ghgrab、Scrapling、metadata_parser、Google News RSS、Free-TV IPTV | 仓库树与文件、浏览器响应、HTML 声明元数据、RSS 记录与频道资料 |
| 已知 QQ 资源与微信公众号 | QQ 头像／资料连接器、公众号／文章连接器 | 指定对象当前可见元数据、文章发现与授权账号已发表记录，按动作区分范围 |

用 `sera connectors --sources modrinth,scryfall --json` 查看相关连接器定义；源码运行使用 `node dist/cli.js connectors`，MCP 使用 `sera_connectors`。定义包含动作、输入 Schema、认证、费用、配额及限制；配置入口为 `sources`、`connectorFiles` 与 `connectors`，详见[连接器指南](../../docs/connectors.md)。

已有视频链接时，先用 `channels --sources opencli --platform youtube --json` 查看实际 `read` 动作，再选择视频元数据或字幕。`read --content-type subtitle` 通过已配置的 OpenCLI 会话读取 YouTube 转录或 B站字幕。发行版本、游戏评价与分页参数见[材料与动作指南](../../docs/specialist-sources.md)。

自动选路依次优先匿名免费、认证免费和周期免费配额；认证加配额的来源低于匿名配额来源。付费必需动作和一次性试用排除；混合计费或计费未确认的入口需先核对账号免费档，再配置 `freeTierConfirmed: true`。该声明不能限制服务端账单，仍需核对账号设置与实际配额。

游戏 Wiki 和 Galgame 社区采用独立目录，按需加载：

```bash
node dist/cli.js search "Guide" --home ./.sera --sources wiki --platform terraria --group game-wikis --json
node dist/cli.js search "CLANNAD 感想" --home ./.sera --sources sites --platform ymgal --group galgame --json
```

MCP 单次输入使用 `group:"game-wikis"` 或 `group:"galgame"`，同一连接可切换目录。完整来源、平台对象和内容范围见 [来源指南](../../skills/sera-search/references/sources.md)及[领域选路](../../skills/sera-search/references/domains.md)。

`backend ghgrab`／`backend scrapling` 发现上游工具与 Schema，MCP 使用 `sera_backend`。Scrapling 会话在同一 MCP 连接内保持。Google News 聚合记录在实际取得发布者正文前标为元数据；IPTV 返回频道目录与流 URL，可播放状态仍待验证。网页元数据保留页面声明，事实结论需继续核验。

## 结果与证据

来源返回的摘要、正文、元数据、字幕和评论分别标记。部分来源失败仍交付已取得的结果；`status`、`runs`、`cacheWarnings` 保留需要补查的信息。平台登录、付费 Key、上游限流与历史快照的可访问性以实际请求为准。

已取得的证据保存在指定数据目录，Agent 可以继续定位、分页或刷新。多个引擎命中同一篇文章仍是一份原始材料；事实判断结合原文、时间版本及发布者关系完成。

## 文档

| 文档 | 内容 |
|---|---|
| [配置指南](../../docs/configuration.md) | 来源凭据、代理、Agent Reach／OpenCLI 与数据目录 |
| [连接器指南](../../docs/connectors.md) | 动态来源定义、动作 Schema、访问策略与配额 |
| [CLI 指南](../../docs/cli.md) | 搜索、研究、读取、评论、图片与退出码 |
| [证据指南](../../docs/evidence.md) | 片段、缓存、版本时间、缺口续查与清理 |
| [Agent Skill 与 MCP](../../docs/mcp.md) | Skill 链接、服务配置及工具目录 |
| [扩展来源与后端](../../docs/integrations.md) | 组件安装、完整后端工具、会话与兼容范围 |
| [账号与地理扩展](../../docs/extensions.md) | 分步账号发现、资料关联、头像比较与地理时空数据 |
| [第三方归属](../../THIRD_PARTY.md) | 上游项目、许可与内容来源 |
| [选路 Skill](../../skills/sera-search/SKILL.md) | Agent 的起步流程与按需参考 |

## 开发与贡献

```bash
npm run check
npm run build
npm pack --ignore-scripts --dry-run --cache ./.cache/npm
```

版本来自 `package.json`，`package-lock.json` 记录可复现安装。源码位于 `src/`，独立目录位于 `catalogs/`。CI 在 Windows、macOS 和 Linux 上执行类型检查、构建、CLI 启动与打包检查。新增来源应明确搜索、读取、认证及内容范围。

欢迎通过 [Issue](https://github.com/GuraQwQ/sera-search/issues) 提供复现或接入建议，或通过 Pull Request 改进实现与文档。

## 致谢

SERA 的共享入口与证据组织参考 [REA](https://github.com/morluto/rea)。提供者接入、平台发现与查询扩展分别参考 [MCP Omnisearch](https://github.com/spences10/mcp-omnisearch)、[OpenCLI](https://github.com/jackwener/OpenCLI) 和 [search-skills](https://github.com/blessonism/search-skills)。

## 许可证

[MIT](../../LICENSE)。第三方服务和资料的使用遵循各自条款与许可，详见[第三方归属](../../THIRD_PARTY.md)。
