---
name: sera-search
description: 使用 SERA CLI 或 MCP 搜索网页、平台、领域资料和历史档案，读取原文、评论或图片来源并核验证据。适用于用户指定 SERA，或需要跨来源查证资料时。
---

# SERA

先确认实体、别名、版本、语言、目标时间和待查字段，再选原始材料。官方事实查官方页面／结构化记录，用户反馈查原帖与评论，历史问题查原 URL 与实际快照。

## 起步与首轮取证

沿用同一 `SERA_HOME`／`--home`。本轮先查看相关来源的状态，例如 `sera capabilities --sources bing,web,steam,wayback --json`；MCP 用 `sera_capabilities` 的 `sources`。按任务替换该列表，平台不明时再用 `channels` 筛选。缺少有效凭据的账号渠道显示“未登录，不可用”，网络、权限与额度由本次 `runs` 确认。

| 手中线索 | 下一步 |
|---|---|
| 只有名称或关键词 | `search` 找候选，核对真实名称、别名与对象 ID |
| 多个待核验事实 | `research` 传 `goals`，先取一批原文，再用返回的 `state` 补缺口 |
| 已知 URL／ID | `read` 直接取证；多个链接用 `read-many`，最多20项、三路并行 |
| 已有证据 ID | `evidence` 定位或续读全文 |

```bash
sera research "某作品 发行与中文支持" --sources bing --read-sources web --goal "发行日期" --goal "中文界面与字幕" --state ./research-state.json --read-limit 3 --json
sera read-many "steam:105600" "sm8628149" --keyword release_date --keyword firstRetrieve --json
sera evidence EVIDENCE_ID --keyword "発売日" --length 1000 --json
```

`research` 的 `sources` 同时约束搜索和读取；搜索源不读正文时另选 `readSources`／`--read-sources`。已知 ID 还支持 DOI、`pmid:12345`。短片段通常足以判断下一步：用 `query`／`keywords` 定位，必要时按返回位置展开全文。只有确需完整材料时扩大 `length`。

多轮任务可从首轮传 `--state ./research-state.json`，CLI会创建或读取并原子更新同一状态文件。核验原文后编辑其中字段为 `supported`／`conflict` 并关联 `evidenceIds`，再执行原命令；MCP传回更新后的 `state` 对象。`nextQuery` 建议聚焦一个剩余字段，优先冲突；全部确认后停止。保存失败时保留报告并查看 `stateWarnings`。完整例子见 [取证与续查](references/workflows.md)。

## 换路与核验

根据 `runs` 保留成功材料再处理失败：空结果改别名／域名；403换允许的读取入口；429遵守 `retryAfterSeconds`，先查其他分支；只有标题、摘要或页面壳时继续找实际正文。历史查询从已发现的原始链接与目标时间定位快照，CDX索引和可用报告不算已读正文。

显式 `sources` 控制参与来源与费用；默认搜索按意图换源，过程见 `runs[].attempts`。`aliases` 补跨语言名称，`intent` 指定本轮目的。评论使用返回的 `cursor`／`parentId` 续读。来源、方法、版本、发布日期、捕获时间与取得时间分别记录，多引擎命中同一材料仍是一份原始来源。

默认复用新鲜缓存，需要新观察时用 `refresh`。证据保存失败仍可使用已返回正文，查看 `cacheWarnings`。结论关联原始 URL 与证据 ID；正文、元数据、字幕和评论分别使用，证据不足的字段保留未知。

## 按需参考

- [来源与查询语法](references/sources.md)：来源入口、搜索条件与内容边界；[领域材料](references/domains.md)：文档、学术、标准等。
- [历史档案](references/archives.md)：Wayback、Wiki修订与Internet Archive。
- [游戏 Wiki](references/game-wikis.md)／[Galgame](references/galgame.md)：分别传 `group:game-wikis`／`group:galgame` 后选站；[社区、评论与图片](references/platform-expansion.md)另看动作范围。
- 用户提供凭据或遇认证问题时读 [登录记录](references/auth.md)。

CLI 不在 PATH 时，解析技能目录真实路径，向上两级定位包根，运行 `node <包根>/dist/cli.js`；源码工作区未指定数据目录时可用 `<包根>/.sera`。MCP目录分组在单次输入传 `group`。HTTP沿用环境代理与 `NO_PROXY`。
