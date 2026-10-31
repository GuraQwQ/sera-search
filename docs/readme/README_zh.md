<div align="center">

[English](../../README.md) · **简体中文**

<img src="../../docs/assets/sera-icon.svg" alt="SERA 放大镜：墨绿色镜框、薄荷色镜片与琥珀色手柄" width="128" height="128" />

# SERA：搜索一切

### 一个 CLI 与 MCP 入口，搜索网页、社区、数据库与互联网档案。

**让 Agent 找到原始材料，带着证据回答。**

[![跨平台验证](https://github.com/GuraQwQ/sera-search/actions/workflows/ci.yml/badge.svg)](https://github.com/GuraQwQ/sera-search/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-39786B?style=flat-square)](https://nodejs.org/)
[![MIT](https://img.shields.io/badge/许可证-MIT-D99A42?style=flat-square)](../../LICENSE)

[快速开始](#快速开始) · [接入你的-agent](#接入你的-agent) · [工作方式](#工作方式) · [可以查什么](#可以查什么) · [文档](#文档)

</div>

想核实产品规格、追踪一条消息的出处，或找回已经消失的网页？把问题交给接入 SERA 的 Agent：找到对应来源，读取原始材料，追查还没解决的线索，再用证据说明答案。

SERA 把网页、代码、社区、学术、作品数据库和互联网归档接到同一套检索与取证接口。Agent 通过 MCP 调用，你也可以直接在终端使用。搜索结果继续通向原文、帖子、评论、结构化记录或历史快照，保留链接、版本、时间与可回读的证据 ID。

## 快速开始

需要 **Node.js 22 或以上版本**。当前从源码运行，尚未发布到 npm。

```bash
git clone https://github.com/GuraQwQ/sera-search.git
cd sera-search
npm ci --cache ./.cache/npm
npm run build
node dist/cli.js install --home ./.sera
node dist/cli.js capabilities --home ./.sera --json
```

使用公开网页来源完成一次搜索与原文读取：

```bash
node dist/cli.js research "TypeScript 官方发布记录" --home ./.sera --sources bing --read-sources web --read-limit 3 --json
```

公开来源可直接请求；需要账号的来源通过 `login` 登记。数据目录统一使用 `--home` 或 `SERA_HOME`，重复执行 `install` 保留已有配置。网络、登录与额度状态以每次返回的 `runs` 为准。

已有 URL 或对象 ID 时可以直接读取：

```bash
node dist/cli.js read-many "steam:105600" "sm8628149" --home ./.sera --keyword "release_date" --keyword "firstRetrieve" --json
```

完整参数见 [CLI 指南](../../docs/cli.md)，API Key、代理和平台后端见 [配置指南](../../docs/configuration.md)。

## 接入你的 Agent

支持本地 stdio MCP 的 Agent 可以注册以下服务。将路径换成实际包目录，数据目录与 CLI 保持一致：

```json
{
  "mcpServers": {
    "sera": {
      "command": "node",
      "args": [
        "/absolute/path/to/sera-search/dist/cli.js",
        "mcp",
        "--home",
        "/absolute/path/to/sera-data"
      ]
    }
  }
}
```

Windows 可使用 `F:/tools/sera-search/dist/cli.js` 这样的绝对路径。

把项目 Skill 链接到 Agent 的标准技能入口，提供选路和证据核验指引：

```bash
node dist/cli.js install --home /absolute/path/to/sera-data --skill-dir /absolute/path/to/agent-skills
```

Skill 源文件随包提供，入口链接到包内目录，需要保留包的位置。MCP 配置和 Skill 入口按所用客户端加载，详见 [Agent Skill 与 MCP](../../docs/mcp.md)。

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
- **只补还缺的证据。** `research` 用 `goals`／`state` 保留待查、已确认、冲突和访问失败，跳过已取证页面。字段由 Agent 核验后更新，全部确认后停止联网。
- **换路过程可追溯。** 默认按意图选源，空结果、无关候选或错误继续换后端；显式 `sources` 并行聚合所选来源，`runs[].attempts` 保留实际查询与原因。

全文保留在证据 ID 下，相关片段带 Unicode 坐标。排序分数用于组织召回；多个引擎找到同一篇文章仍是一份原始材料。证据的读取范围、内容类型和使用方式见 [证据指南](../../docs/evidence.md)。

## 可以查什么

当前注册 **44 个来源**，MCP 提供 **12 个工具**。来源注册表示接口已接入，实际可用性由配置、权限和上游响应确认。

| 资料 | 入口示例 | 返回内容 |
|---|---|---|
| 网页、新闻与官方文档 | Bing、Exa、Tavily、Brave、智谱、豆包、SerpAPI、DataForSEO | 候选链接、摘要；支持的后端继续提取原文 |
| 仓库、代码与平台内容 | GitHub、Agent Reach、OpenCLI、B站、V2EX | 仓库、文件、帖子或平台记录，按实时渠道选择动作 |
| 学术与百科 | Crossref、OpenAlex、PubMed、MediaWiki | 书目、摘要、页面原文与指定修订 |
| 游戏、动漫、音乐与作品资料 | Steam、Niconico、VNDB、Bangumi、MusicBrainz 等 | 对象 ID、发行记录、规格、署名与元数据 |
| 历史网页与失传信息 | Wayback、Internet Archive | 捕获索引、实际快照、馆藏及文件目录 |
| 社区、评论与图片来源 | LinuxDo、小黑盒、YouTube、网易云、图片与反向识图接口 | 原帖、评论分页、父子回复、图片承载页及匹配线索 |

游戏 Wiki 和 Galgame 社区采用独立目录，按需加载：

```bash
node dist/cli.js search "Guide" --home ./.sera --sources wiki --platform terraria --group game-wikis --json
node dist/cli.js search "CLANNAD 感想" --home ./.sera --sources sites --platform ymgal --group galgame --json
```

MCP 单次输入使用 `group:"game-wikis"` 或 `group:"galgame"`，同一连接可切换目录。完整来源、平台对象和内容范围见 [来源指南](../../skills/sera-search/references/sources.md)及[领域选路](../../skills/sera-search/references/domains.md)。

## 结果与证据

来源返回的摘要、正文、元数据、字幕和评论分别标记。部分来源失败仍交付已取得的结果；`status`、`runs`、`cacheWarnings` 保留需要补查的信息。平台登录、付费 Key、上游限流与历史快照的可访问性以实际请求为准。

已取得的证据保存在指定数据目录，Agent 可以继续定位、分页或刷新。多个引擎命中同一篇文章仍是一份原始材料；事实判断结合原文、时间版本及发布者关系完成。

## 文档

| 文档 | 内容 |
|---|---|
| [配置指南](../../docs/configuration.md) | 来源凭据、代理、Agent Reach／OpenCLI 与数据目录 |
| [CLI 指南](../../docs/cli.md) | 搜索、研究、读取、评论、图片与退出码 |
| [证据指南](../../docs/evidence.md) | 片段、缓存、版本时间、缺口续查与清理 |
| [Agent Skill 与 MCP](../../docs/mcp.md) | Skill 链接、服务配置及工具目录 |
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

[MIT](../../LICENSE)。第三方服务和资料的使用遵循各自条款与许可。
