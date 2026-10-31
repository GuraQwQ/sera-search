# 游戏 Wiki 独立目录组

游戏 Wiki 目录保存在包内 [catalogs/game-wikis.json](../../../catalogs/game-wikis.json)，采用现有配置格式。常规配置不加载该目录；查询游戏资料时才通过 `--group game-wikis` 选择它，再用 `--platform` 指定站点。Agent 仅在游戏、攻略、机制或同人设定请求涉及这些资料时读取本指南。

目录与站点检索分别处理：先根据游戏名、版本和问题选站，再向该站发送查询。新增大量站点时扩展这一独立目录，保持常规百科、音乐和作品数据库的来源清单简洁。

## 当前实例

| 站点 | 适用资料 | 2026-11-01 验证 |
|---|---|---|
| `terraria` | Terraria 物品、NPC、机制、攻略 | 当前 SERA Wiki 适配器检索到 `Guide`，读取取得完整返回的原始 wikitext 与修订 ID |
| `minecraft` | Minecraft 版本、方块、生物、机制 | 当前适配器检索到 `Creeper` |
| `thbwiki` | 东方作品、人物、音乐、社团与同人资料 | 当前适配器检索到“博丽灵梦” |

三个实例均通过公开查询验证。每个实例的版本、语言、许可和访问状态仍以实际页面与请求为准。

从包根目录运行：

```bash
node dist/cli.js search "Guide" --group game-wikis --sources wiki --platform terraria --limit 5 --json
node dist/cli.js search "Creeper" --group game-wikis --sources wiki --platform minecraft --json
node dist/cli.js search "博丽灵梦" --group game-wikis --sources wiki --platform thbwiki --json
node dist/cli.js read "https://terraria.wiki.gg/wiki/Guide" --group game-wikis --sources wiki --json
```

CLI 不在 PATH 时定位包根目录后使用上面的入口；沿用已选的 `SERA_HOME` 或传入 `--home`。MCP 在单次 `sera_capabilities`／`sera_channels`／`sera_search`／`sera_research`／`sera_read` 输入传 `group:"game-wikis"` 使用该组，继续按来源和平台筛选。

## 扩充目录

1. 优先游戏官网认可的 Wiki 或当前维护的社区站，核对迁站说明、语言和游戏版本。
2. 验证实际 `apiUrl`、文章入口，以及 Search／Revisions 返回，再加入实例。Wiki 引擎相同并不保证访问条件相同。
3. 查询只选择当前游戏需要的实例。需要另一站补证时再追加，避免把完整目录变成一次请求的扇出列表。
4. 旧 Fandom 站与迁移后的 wiki.gg 站保留各自 URL、时间和修订线索；相同转载内容仍归为同一证据线索。

[Fandom Terraria 搜索](https://terraria.fandom.com/api.php?action=query&format=json&formatversion=2&list=search&srsearch=guide&srlimit=1)本次返回一条结果，但它没有加入首批目录；应先根据资料版本选站。

[Liquipedia API 条款](https://liquipedia.net/api-terms-of-use)要求项目与联系方式 User-Agent、缓存、gzip 和请求节流；MediaWiki API 与需批准的 LiquipediaDB API 分开。本包当前通用 Wiki UA 尚未覆盖这些要求，Liquipedia 作为后续适配候选。

较大的后续目录可按游戏系列、语言和资料类型分文件，Agent 按游戏名选择对应文件。当前三站使用一个独立文件即可；站点数量增加后再拆分。
