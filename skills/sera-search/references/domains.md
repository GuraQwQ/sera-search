# 领域与站点选路

先选择资料类型和原始发布者，再选择检索入口。`sera channels` 给出当前可匹配的渠道；API Key、浏览器登录和实际请求结果分别确认。下表区分本包已接入的来源与可复用、待扩展的路径。

| 领域 | 优先来源／站点 | SERA 调用路径与内容范围 |
|---|---|---|
| 通用知识、人物、历史概念 | Wikipedia 中／英／日文 | `wiki` 选 `wikipedia-zh`／`wikipedia-en`／`wikipedia-ja`；指定 `oldid` 可读历史修订并保留版本 URL |
| 语言、古籍、公共文本 | Wiktionary、Wikisource | `wiki` 的 `wiktionary-zh`、`wikisource-zh`；词条与文库文本分别核对语言和版本 |
| 地理、旅行 | Wikivoyage、OpenStreetMap | `wiki --platform wikivoyage-zh`；地址／地点可另接 [Nominatim Search](https://nominatim.org/release-docs/latest/api/Search/)，它是地理查询而非网页全文搜索 |
| 图像与文件背景 | Wikimedia Commons | `wiki --platform commons` 读取描述、许可和引用文字；图像本身需另外检查 |
| 软件与技术文档 | 官方 Node.js／Python／Rust 文档、MDN、ReadTheDocs | 通用引擎加 `--domain nodejs.org`／`docs.python.org`／`doc.rust-lang.org`／`developer.mozilla.org`；OpenCLI 的 `mdn` 可在清单中发现 |
| 学术论文 | Crossref、OpenAlex、arXiv | `--sources crossref,openalex`，或 OpenCLI `arxiv`；DOI、书目、作者及开放访问链接不等于全文 |
| 医学与生命科学 | PubMed、PMC、Europe PMC | `--sources pubmed` 返回书目与摘要；全文继续到 PMC／出版者。可扩展 [Europe PMC REST](https://europepmc.org/RestfulWebService) 的记录与开放全文 |
| 软件包与开发问题 | npm、PyPI、crates、Maven、NuGet、GitHub、Stack Overflow | 包索引的 OpenCLI 搜索配合 GitHub 读取；版本、发布日和仓库链接分别核对，平台能力看实时清单 |
| 标准、法规、政策 | IETF RFC、国家法律法规数据库、中国政府网 | OpenCLI `rfc`／`gov-law`／`gov-policy`；可扩展 [IETF Datatracker API](https://datatracker.ietf.org/api/)，查询有效版本、更新和废止关系 |
| 财经、统计与公共数据 | SEC EDGAR、政府数据站、CKAN 数据门户 | 优先官方原始公告／JSON／CSV；[SEC 数据 API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)适合公司申报和财务事实，[CKAN API](https://docs.ckan.org/en/latest/api/)适合数据集发现 |
| 音乐作品与发行资料 | MusicBrainz、Last.fm、Discogs、ListenBrainz | 按音乐实体或用户播放对象选择对应来源，MBID、发行 ID、语言与版本分别核对 |
| 动画、漫画、人物与制作资料 | Bangumi、AniList、Jikan、MangaDex | 明确指定对应 API 来源；作品元数据、章节目录与正文分别判断 |
| 视觉小说／Galgame | VNDB、Bangumi、官方发行平台与社区 | 作品记录用 `vndb`／`bangumi`；社区按[独立目录](galgame.md)选站，继续追官方语言与发行版本 |
| 评论、直播与社交消息 | B站、YouTube、网易云、Twitch、Discord、Instagram | `comments` 读取评论页；社交 API 按授权对象选路，详见[平台指南](platform-expansion.md) |
| 技能与工具包 | skills.sh、GitHub | `skills` 找技能，GitHub 核对 `SKILL.md` 正文、提交与实际接口 |
| 历史网页、文献与馆藏 | Wayback、Internet Archive、Wiki 修订 | 按[档案指南](archives.md)选择网页捕获、旧修订或馆藏目录，捕获时间与发布日期分开 |
| 技术社区与游戏讨论 | LinuxDo、小黑盒、原有平台后端 | `linuxdo`／`heybox` 查原生主题／帖子与逐页回复；权限和可见范围见平台指南 |
| 专业／社区 Wiki | MediaWiki、项目自建 Wiki、Wikidata | 公开 MediaWiki 实例可加入 `wiki.sites`；其他引擎走域名检索及原文，实体关系按对应 ID 查询 |

游戏 Wiki 使用[独立目录组](game-wikis.md)，Galgame 社群使用[独立站点目录](galgame.md)，按游戏、语言与版本选站。音乐、动漫漫画、宅文化与评论区的操作范围见 [平台指南](platform-expansion.md)；API 或网站入口存在，不等于已取得需要的正文与权限。

## 已接入的公共接口

- **Crossref**：官方 [REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)的 `/works` 检索与 DOI 单记录读取。返回书目元数据和可能存在的摘要、引用、原文链接。
- **OpenAlex**：官方 [API overview](https://docs.openalex.org/how-to-use-the-api/api-overview) 与 [API 根端点](https://api.openalex.org)均允许不带 Key 进行基础查询；可选 Key 增加预算，较重用量按服务规则计费。本包查询论文记录并保留开放访问位置。
- **PubMed**：使用 [NCBI E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25501/) 的 ESearch、ESummary 和 EFetch。XML 中的书目、摘要属于元数据记录，不能声称已拿到期刊全文。
- **MediaWiki**：使用 [Search](https://www.mediawiki.org/wiki/API:Search) 与 [Revisions](https://www.mediawiki.org/wiki/API:Revisions) 的 `formatversion=2` 协议。页面修改时间是 `updatedAt`，不冒充发布日期。

公开查询可以直接使用。可选 API Key 交给工具包的登录记录管理；错误的 Key、来源配额和网络失败仍以实际响应判断。

```bash
sera search "retrieval augmented generation" --sources crossref,openalex,pubmed --limit 5 --json
sera read "https://doi.org/10.1234/example" --sources crossref --json
sera search "量子力学" --sources wiki --platform wikipedia-zh --json
sera read "https://zh.wikipedia.org/wiki/量子力学" --sources wiki --json
sera search "Linux" --sources wiki --platform wikipedia-ja --json
```

学术检索的 `--since` 按出版日期筛选。Wiki 的修订时间与发布日期不同，统一 `--since` 不用于 Wiki；需要页面修改条件时使用该站搜索后端支持的原生表达式。

## 配置其他 MediaWiki 实例

在配置中添加该站真实的 API 和文章入口：

```json
{
  "wiki": {
    "sites": {
      "project-wiki": {
        "apiUrl": "https://wiki.example.org/w/api.php",
        "pageBaseUrl": "https://wiki.example.org/wiki/",
        "label": "项目 Wiki"
      }
    }
  }
}
```

随后使用 `--sources wiki --platform project-wiki`。API 路径并非所有站点都是 `/w/api.php`；以该站的 API 帮助页为准。公开实例可能限制匿名读取或自动请求，不能把软件名称相同推导为访问条件相同。

## 文档站的搜索与原文

1. 用户已指定项目时，优先官方文档、版本文档或仓库，避免先进入泛搜索结果。
2. 站点已有 OpenCLI 渠道时按实时清单调用；其他站点用已配置网页引擎的域名过滤。
3. 读取公开 `llms.txt`、Markdown、sitemap 或静态搜索索引可帮助定位页面；它们是资料发现路径，并非完整站内搜索保证。
4. 对代码示例保留原始空白，确认版本；对教程核对它是否对应用户所用版本。

[Context7 官方 API 指南](https://context7.com/docs/api-guide)当前提供需要 Bearer Key 的 `/api/v3/search` 和 `/api/v3/fetch`，适合作为下一批文档专用来源；本模块尚未接入。`/api/v3/search` 可直接搜索文档，通常不必先解析库 ID。

[ReadTheDocs](https://docs.readthedocs.io/en/stable/api/v3.html)的管理 API v3 使用项目权限和认证，不能等同为全部托管站点的匿名全文搜索。公开文档可以使用站点搜索、域名检索及其 [llms.txt](https://docs.readthedocs.io/en/stable/reference/llms-txt.html)、[Agent Markdown](https://docs.readthedocs.io/en/stable/reference/markdown-for-agents.html) 和 [Agent Skill](https://docs.readthedocs.io/en/stable/reference/agent-skills.html) 入口。

观察日期：2026-11-01。SERA 已支持环境代理，英文 Wikipedia、Wayback 和 Internet Archive 的公开调用取得真实响应；学术、部分作品数据库、游戏 Wiki 及论坛也有有界结果。不同实例、权限、媒体格式和网络条件仍影响可用性，登录平台及完整覆盖未逐一验证。
