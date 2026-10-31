# Galgame 作品与社区选路

Galgame 使用独立 [catalogs/galgame.json](../../../catalogs/galgame.json) 站点目录。作品数据库、发行平台、制作社区和玩家讨论分别取证；查询先明确作品名、别名、语言与版本，再选少量相关站点。游戏机制和攻略 Wiki 另见 [game-wikis.md](game-wikis.md)。

## 目录站点

| 平台名 | 资料对象 | 已核实入口 |
|---|---|---|
| `ymgal` | 中文作品档案、专栏、感想、制作组动态 | [月幕 Galgame](https://www.ymgal.games/) |
| `cngal` | 国内制作／中文化作品介绍、攻略、评测与制作组资料 | [CnGal](https://www.cngal.org/)、[官方介绍](https://www.cngal.org/articles/index/767) |
| `2dfan` | 游戏条目、攻略、感想、小组讨论 | [2DFan 小组](https://2dfan.com/groups) |
| `fuwanovel` | 英文视觉小说讨论、推荐、攻略、技术问题及创作交流 | [Fuwanovel Forums](https://forums.fuwanovel.moe/) |
| `lemmasoft` | 视觉小说制作、Ren'Py、原创项目与开发者交流 | [Lemma Soft Forums](https://lemmasoft.renai.us/forums/) |
| `vndb` | 作品、发行版本、人物、制作方与作品讨论 | [VNDB](https://vndb.org/)，结构化记录可另用 `--sources vndb` |
| `bangumi` | 游戏条目、评价、日志、角色与小组 | [Bangumi](https://bgm.tv/)，结构化记录可另用 `--sources bangumi` |
| `itch-vn` | 创作者作品页、开发日志、游戏 Jam 与交流 | [itch.io 社区](https://itch.io/community)，查询加入作品名或 visual novel／NaNoRenO |
| `steam-vn` | 指定作品／制作工具的讨论、公告、评价和攻略 | [Steam Community](https://steamcommunity.com/)，查询加入作品名或 App ID |

目录用于公开网页发现。`sites` 会优先使用已登记且可调用的网页来源，必要时回退公开 Bing RSS；`retrievals[].metadata` 记录实际发现后端与目录平台。命中后用 `web` 或平台的实际读取动作取得材料。

## 调用

从包根目录运行，或将目录路径写为绝对路径：

```bash
sera search "CLANNAD" --sources vndb,bangumi --json
sera search "CLANNAD 感想" --sources sites --platform ymgal --group galgame --json
sera research "visual novel text rendering" --sources sites --platform lemmasoft --group galgame --read-sources web --read-limit 3 --json
sera channels --sources sites --group galgame --json
```

CLI 未在 PATH 时使用 `node <包根目录>/dist/cli.js`；沿用 `SERA_HOME` 或 `--home`。MCP 在单次 `sera_search`／`sera_research`／`sera_channels` 输入传 `group:"galgame"`，并用 `sources:["sites"]` 与 `platform` 选择站点。CLI 自定义目录仍可传 `--catalog <文件>`。

## 核查语言、版本和来源

1. VNDB／Bangumi 的作品 ID 用于消歧，继续追查制作方、发行物和对应语言；主条目与不同发行版本分别记录。
2. Steam／itch.io 的商店页核对发布日期、支持语言、版本说明及免费／试玩条件。社区发言和旧评论不替代当前官方语言或价格说明。
3. 翻译项目的公告、补丁版本和作者说明只证明其明确写出的状态；更新日期与完整度分别确认。
4. 评价、推荐和个人感想属于观点来源。角色／作品事实优先回到官方页面、对应游戏版本或原始制作资料。
5. 搜索目录只选择当前任务需要的站点；有缺口时再补另一个数据库、社区或官方来源。

观察日期：2026-11-01。目录入口已通过公开搜索或页面读取核实；目录查询受搜索索引、公开页面和读取后端影响，不保证站内完整覆盖。CnGal 等站点对内容再使用有自己的许可规则，按需引用原页面并保留来源。
