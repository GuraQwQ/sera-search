# 结构化数据连接器

SERA 用同一连接器工厂注册结构化来源：声明描述协议、认证、访问条件、动作参数与字段映射，特殊站点提供专用处理函数。检索、读取、证据保存、缓存与研究续查继续使用同一核心。

先查看本机实际能力，再选择动作：

```bash
sera capabilities --sources deps-dev,pubchem,qq-avatar --json
sera channels --sources deps-dev --json
sera connectors --sources deps-dev --json
sera search zod --sources deps-dev --operation dependencies --params '{"system":"npm","version":"4.6.7"}' --json
```

`connectors` 与 MCP `sera_connectors` 导出检索连接器声明，仅含 `search` 动作定义；专用读取、评论与图片动作看 `channels`。`channels.operations[].inputSchema` 是实际动作参数契约，`entrypoint` 指定调用入口。声明不含账户凭据。支持自定义来源 ID，新增标准来源无需修改 CLI、MCP 或证据格式。

## 提供者、平台与动作

连接器 `id` 是提供者来源，`platforms` 声明处理的目标平台，`operations` 描述具体材料与动作。例如 `filmot`／`holodex` 关联 `youtube`，`chatarchive` 关联 `twitch`，`aicu`／`danmakus` 关联 `bilibili`；QQ 和微信连接器也按目标平台发现。使用 `channels --platform 平台` 查看所有相关入口，再按 `contentTypes`、参数 Schema 与覆盖限制选动作。

这种关联表示提供者处理同平台材料，不证明主体相同或来源独立。自动选路需要明确材料或动作才考虑第三方关联源。缺少必填参数的动作列入 `search.plan.pendingActions`，其中 `source`、`operation`、`entrypoint`、`required` 说明下一步；该动作不发送请求。

渠道的 `entrypoint:"read"` 使用 CLI `read URL --operation 动作 --params JSON` 或 MCP `sera_read`，URL 作为独立字段，动作 Schema 描述 `params`。声明式读取的 `{{params.字段}}` 先使用 URL 查询参数作为默认值，再由本次显式 `params` 覆盖。`entrypoint:"comments"` 使用 `comments URL` 或 `sera_comments`，`entrypoint:"images"` 使用 `image-search`／`reverse-image` 或 `sera_images`，`search` 使用 `search`／`research`。动作名不能替代入口判断，同名动作以各来源的 Schema 为准。`live-chat`／`live-danmaku`、`price-history`／`game-price-history` 可匹配相同材料类别，实际协议与参数仍由提供者定义。

## 配置与认证

在数据目录的 `config.json` 中配置来源运行参数，并加载声明文件：

```json
{
  "sources": {
    "community-books": { "enabled": true },
    "materials-project": { "enabled": true },
    "exa": { "freeTierConfirmed": false }
  },
  "connectorFiles": ["connectors/books.json"],
  "connectors": []
}
```

`connectorFiles` 相对 `config.json` 所在目录解析，每个文件可以包含一份声明或声明数组；也可以将声明放进 `connectors`。重复 ID 使用最后加载的声明。对已有内置来源，同 ID 声明合并动作，显式配置 `request`／`read` 可以替换对应的内置处理；只提供读取的来源也支持 `read` 覆盖。

动作的 `access` 覆盖同样适用于评论和图片入口。明确声明 `authentication:"none"` 时，请求按匿名方式发送；`paid`／`trial` 动作在调用前排除。省略图片动作时，先按图片 URL 与来源配置确定实际动作，再检查对应的认证和费用条件。

`sources[id]` 支持 `enabled`、`baseUrl`、`userAgent`、`freeTierConfirmed` 等运行设置；旧来源顶层配置仍可使用，`sources[id]` 同字段优先。凭据通过 `login` 保存，实际请求以有效凭据记录优先：

```bash
sera login materials-project --from-env MATERIALS_PROJECT_API_KEY
```

只有声明需要或允许认证时才配置 Key。`auth` 支持 `none`、`api-key`、`bearer`，以及 `header`、`query`、`body` 三种 Key 位置；`prefix` 可声明 `Token ` 等前缀。浏览器会话复用由具体来源处理。旧配置中的凭据迁移前保存备份，迁移可重复执行；现有有效登录记录优先。

## 标准 REST 声明

下面可保存为 `connectors/books.json`，用 Open Library 演示字段映射与单条回读：

```json
{
  "id": "community-books",
  "platforms": ["open-library"],
  "type": "rest",
  "base_url": "https://openlibrary.org/",
  "label": "公开书目",
  "auth": { "type": "none" },
  "access": { "authentication": "none", "billing": "free" },
  "limits": { "min_interval_ms": 1000, "max_response_bytes": 8388608 },
  "operations": {
    "books": {
      "description": "按关键词查询书目",
      "content_types": ["book"],
      "input_schema": {
        "type": "object",
        "properties": { "page": { "type": "integer", "minimum": 1, "default": 1 } },
        "additionalProperties": false
      },
      "request": {
        "path": "search.json",
        "method": "GET",
        "query": { "q": "{{query}}", "limit": "{{limit}}", "page": "{{params.page}}" }
      },
      "output": {
        "items": "docs",
        "id": "key",
        "title": "title",
        "url": "https://openlibrary.org{{item.key}}",
        "snippet": "first_sentence.0"
      }
    }
  },
  "read": {
    "hosts": ["openlibrary.org"],
    "pattern": "^(/works/[^/]+)$",
    "request": { "path": "{{id}}.json", "method": "GET" },
    "title": "title",
    "content_kind": "metadata"
  }
}
```

```bash
sera search astronomy --sources community-books --operation books --params '{"page":1}' --limit 5 --json
sera read https://openlibrary.org/works/OL45804W --sources community-books --json
```

`input_schema` 使用 JSON Schema，经 Zod 校验后才发送请求，默认值也参与解析。字段路径使用点分属性，如 `data.records`；输出中的 URL 使用模板。完整占位符保留原值类型，嵌入字符串的占位符转换成文字。搜索上下文有 `query`、`limit`、`since`、`until`、`params`，输出 URL 额外有 `item`。单条读取上下文有 `url`、正则第一个捕获组 `id`、全部捕获组 `match`、URL 查询参数 `params`。搜索 `output.id` 应与读取捕获的身份一致，便于携带 `locator` 核验同一条记录。

`output.title`、`snippet`、`published_at` 是字段路径；`output.url` 是模板。每条命中的 `metadata.record` 保留原始条目，读取默认保存完整 JSON 并标记为 `metadata`。`content_kind` 可配置页面、帖子、字幕或元数据；原始数据本身应能支持该类型。

## GraphQL、分页与调用边界

GraphQL 使用相同请求声明，将查询和变量放入 POST 正文，例如：

```json
{
  "path": "/",
  "method": "POST",
  "body": {
    "query": "query ($text: String, $count: Int) { Page(perPage: $count) { media(search: $text) { id title { romaji } siteUrl } } }",
    "variables": { "text": "{{query}}", "count": "{{limit}}" }
  }
}
```

将该请求配进 `type: "graphql"` 的完整声明；端点在根目录时使用 `/`。相应 `output.items` 可为 `data.Page.media`、`title` 为 `title.romaji`、`url` 为 `{{item.siteUrl}}`。只有协议错误且无数据时报告 `GRAPHQL_ERROR`；有部分数据则保留命中并标明部分字段失败。

默认无正文时执行 GET，有正文时执行 POST；显式 POST 无正文时发送空 JSON 对象。GET 声明不能携带正文。`format: "text"` 适合由专用处理器解析文本，标准字段映射使用 JSON。

上游返回下一游标时，可以配置 `pagination: {"next":"next_cursor","cursor_param":"cursor","total":"total"}`，并在请求里映射 `{{params.cursor}}`。`total` 保留在声明中供调用方理解；续查依据实际下一游标。通用映射额外支持 `params.resultOffset`：同一上游页超过 `limit` 时先返回页内余项，再推进游标。上述 Open Library 示例是页码接口，需要调用方递增 `params.page`。

`runs[].coverage.nextCursor` 可能是游标字符串、页码或 JSON 参数对象；按具体动作 Schema 传递。分页结束只表示当前查询结束，不能证明历史数据收录完整。

共享请求边界复用代理、HTTP 错误分类与限流响应处理，内置原生适配器和声明式客户端采用同一规则；`min_interval_ms` 按来源和服务 origin 排队，取消请求可退出等待；`max_response_bytes` 默认 8 MiB，超限会停止读取响应流。同来源内部的专用客户端沿用本次最终配置的预算。重型档案有额外压缩、展开和事件预算。证据缓存与 `clean` 沿用 SERA 数据目录管理。

## 免费、配额与选源顺序

`access` 声明 `authentication`（`none`、`optional`、`api-key`、`session`）、`billing`、可选 `quota`、`nonCommercial` 与官方依据 `evidence`。动作可以覆盖来源访问条件。`quota` 是说明文字，排序依据明确的 `billing`，普通每秒／每分钟限速按 `free` 处理。

| 访问条件 | 默认 priority | 自动参与 |
|---|---:|---|
| 匿名免费、普通限速 | 0 | 是 |
| 已认证免费、普通限速 | 10 | 是 |
| 匿名周期免费额度 | 20 | 是 |
| 已认证周期免费额度 | 30 | 是 |
| 缺少所需认证 | 80 | 取得认证后参与 |
| 混合账单或费用状态待确认 | 90 | 确认免费档后参与 |
| 必须付费或一次性试用 | 100 | 排除对应操作 |

`priority` 越小越优先；自动选择同时考虑任务内容与实际动作，显式 `sources` 保留用户顺序。回读优先保持命中来源和定位。免费额度耗尽后按实际错误报告或换可用来源。非商业免费来源通过 `nonCommercial` 标明适用条件。

Exa、Tavily、Brave、SerpAPI 等免费与已购余额共用接口的来源，以及费用状态待确认的来源，需要在账户实际处于免费档时设置 `sources[id].freeTierConfirmed: true`。OpenAlex 匿名免费路径可用，带 Key 路径同样需要确认。此字段是账户使用条件声明；SERA 未接入这些服务的余额账本，不能替服务商限制账户扣费。账户改用付费余额后应同步调整配置。DataForSEO 的一次性试用路径已移出活动来源，原凭据文件保留。

## 专用协议与内置来源

`world-bank` 的 `indicators` 按代码直查，或在指定数据源的指标名称和代码中检索。关键词默认使用世界发展指标（`sourceId:2`），其他数据源可传 `sourceId`。每次读取一页轻量目录，按 `coverage.nextCursor` 中的参数续查，`limit` 只控制返回的命中数。关键词首条命中最多补查一次指标口径，并随该目录短暂复用。

`rcsb-pdb` 的 `structures` 在搜索后用一次有时限的批量详情补充结构名称、实验方法、分辨率和物种。部分详情未取得时仍返回原有 PDB ID，可继续按 ID 读取。

`type` 支持 `rest`、`graphql`、`sdmx`、`mediawiki`、`custom`。标准 JSON 请求可由声明直接执行；SDMX 维度解释、MediaWiki 多站点、XML、WARC、流式压缩和浏览器交互由 `ConnectorHooks` 保留协议语义。导出中缺少 `request`／`output` 的内置动作依赖已注册处理器，不能当作独立的通用 HTTP 声明运行。

开发者可从包导入 `createStructuredSource`、`connectorClient`、`connectorDefinitionSchema` 及相应类型。特殊处理函数接收经校验的参数与共享客户端，返回统一命中／文档；继承证据、定位、研究续查与费用策略。

| 领域 | 来源与主要动作 |
|---|---|
| 实体与版本 | `wikidata` 名称检索／实体声明、外部 ID 与修订；`github` 仓库／代码／issue／发布说明；`vndb` 作品／发行版本；`steam` 商店／公告／公开游戏评价 |
| 网页与软件历史 | `common-crawl` 批次 URL 索引／WARC 回读；`gh-archive` 单小时事件；`wikimedia-analytics` 阅读量；`ecosystems` 包与版本；`deps-dev` 包、版本与依赖图 |
| 网络测量 | `ripestat` 概要／路由历史；`ooni` 公开测量；`urlscan` 已有公开扫描 |
| 科学数据 | `rcsb-pdb` 结构目录／序列匹配；`uniprot` 蛋白；`chembl` 分子／靶点／活性；`pubchem` 化合物；`materials-project` 材料；`nasa-exoplanets` 行星；`hepdata` 实验数据；`gbif` 分类／出现记录；`inaturalist` 分类／观察；`earthdata-cmr` 集合／粒度元数据 |
| 公共数据 | `fred` 指标／观测与历史版本；`world-bank` 指标／国家序列；`un-comtrade` 匿名预览／免费注册数据；`eurostat` 数据集；`courtlistener` 判决；`federal-register` 公告；`osm-overpass` 边界内地物；`met`、`artic` 馆藏 |
| 兴趣资料 | `chatarchive` 已归档场次／回放；`sakugabooru` 作画标签；`isthereanydeal` 当前价／历史低价／价格事件；`modrinth` 项目／版本；`speedrun` 游戏／榜单；`boardgamegeek` 桌游；`scryfall` 卡牌；`acoustid` 指纹匹配；`setlistfm` 演出曲目 |
| QQ 与微信 | `qq-avatar`、`qq-group-avatar` 图片元数据；`qq-public-profile` 可见资料；`qq-portrait-legacy` 实验昵称；`wechat-official-account` 账号发现／资料；`wechat-article-history` 公开文章发现／历史页／自己授权的已发表记录 |

Common Crawl 必须提供抓取批次；GH Archive 必须指定 UTC 小时，并按仓库／事件范围和下载预算筛选。达到预算时保留已取得材料，按覆盖报告缩小范围或继续查询。两者适合有界取证。

ChatArchive 的 `streams` 列举已收录 Twitch 场次，`replay` 读取指定场次的免费聊天回放页，关键词只筛当前页。Filmot 的字幕与 Holodex 的视频／场次元数据属于不同材料。游戏史价匹配包含 ITAD 的历史低价与价格事件，所需游戏 ID 和地区按动作 Schema 补齐；无命中、页内筛选或待补参数都不能推出目标资料不存在。

QQ 头像验证响应图片类型、文件头、字节大小和哈希；默认头像不能证明账号或群存在。公开资料仅返回实际可见字段，旧 portrait 接口解析实际 JSONP 返回并标明实验范围。

微信账号和文章发现复用 OpenCLI／Browser Bridge 与本机已有会话；历史页仅保留当前实际渲染并取得的链接与时间范围。`authorized-published` 使用自己授权公众号的 access_token，按该账号权限和额度工作。公开发现、会话可见历史与官方授权记录各自报告覆盖；重名、删除、验证码与权限都可能影响结果。认证信息只采用页面明确展示的字段。

这些来源的标准 API、网页解析、实验接口和需认证操作在能力中分别描述。部署时以 `capabilities`、`channels`、实际错误与上游使用条款为准。
