# 取证与续查

工具负责保存证据、复用材料、检查引用和任务覆盖；Agent 负责解释用户要求、生成查询及判断原文是否支持结论。CLI 与 MCP 使用同一研究契约。

## 对象与判据

`query` 表示完整任务，`discoveryQuery` 是本轮实际搜索语句。`terms` 可指定发现用词，条件核验由 `criteria` 承担。对象名称、别名及相关 URL 放在 `subjects`，判据用 `kind:required` 或 `kind:preference` 区分必需条件与偏好。`intent` 可按当前判据选择官方、反馈、历史等材料；`scope` 是任务定义的条件键值。

```json
{
  "query": "比较甲与乙在目标场景中的适用范围及实际表现",
  "discoveryQuery": "甲 乙 适用范围 原始说明",
  "subjects": [
    {"id": "a", "name": "甲", "urls": ["https://example.org/a"]},
    {"id": "b", "name": "乙", "urls": ["https://example.org/b"]}
  ],
  "criteria": [
    {"id": "scope", "description": "满足目标场景的必需条件", "kind": "required", "intent": "official", "scope": {"场景": "目标场景"}},
    {"id": "experience", "description": "实际表现符合偏好", "kind": "preference", "intent": "feedback"}
  ],
  "readLimit": 3
}
```

维度由任务决定，可用于产品、研究资料、历史记录或其他对象。接口支持最多 100 个对象、100 项判据及 10000 个核验单元。简单单对象任务可用重复 `--goal` 建立必需判据；尚未发现对象且任务要求一定数量时，先传 `targetCount`，从取得的材料登记对象后再核验。

CLI 将上述输入保存为 JSON：

```bash
sera research --input ./request.json --state ./research-state.json --json
sera research "某对象的适用范围" --goal "目标范围" --state ./research-state.json --json
```

MCP 对应 `sera_research`；下一轮传回返回的 `state`。显式命令行参数覆盖输入文件的同名设置。`sources` 控制搜索和新读取，正文入口另选时用 `readSources`／`--read-sources`。

## 核验单元与原文引用

工具为每个对象与判据建立 `state.assessments`。Agent 审阅 `documents`，填写以下内容：

| 字段 | 含义 |
|---|---|
| `subjectId`／`criterionId` | 对象与判据的稳定 ID |
| `status` | `pending` 待核验、`supported` 已有支持结论、`conflict` 仍有实质冲突 |
| `outcome` | `satisfied` 满足条件、`violated` 不满足、`unknown` 尚未知 |
| `conclusion` | 原文支持的具体结论 |
| `scope` | 与判据对齐的适用场景、时期或其他影响比较的条件 |
| `citations` | 实际证据 ID 及 `offset`、`endOffset` 原文坐标 |
| `reviewedEvidenceIds` | 已审阅但不足以推进当前判据的材料，避免反复呈现 |

坐标按 Unicode 码点计数，末端不包含在片段内。使用返回的 `fragments`／`contexts` 坐标；普通分页用 `offset` 加返回内容的码点长度计算末端。需要表头、生效日期或标题上下文时，额外关联对应片段。引用缺失、坐标越界、空白引用、页面框架、重复核验记录或条件未对齐都会保留为缺口。

已有证据会为新判据重新定位片段，已取得页面不会因此再次联网。待审阅材料在 `candidates` 中关联当前对象和判据；这项关联不自动确认支持关系。外部取得的实际材料先用 `record`／`sera_record` 保存，再将返回 ID 加入 `state.evidenceIds` 或 `citations`。

## 完成检查与比较

`coverage` 返回 `qualified`、`excluded`、`unresolved`、`verified` 和 `gaps`。`verified` 表示调用方结论具备有效原文引用并通过结构与范围检查，原文的语义支持关系由 Agent 核验。

存在 `targetCount` 时，满足全部必需条件的对象数量达到目标才完成；偏好未知继续显示为缺口，偏好不满足不会排除对象。没有数量目标时，每个对象的必需条件需要得到明确结论，入选对象的偏好也需核验。已有证据证明对象不满足必需条件时，可以结束对该对象其余条件的取证。

`comparison.groups` 按判据、适用 `scope` 和单位分组。不同生效时期、场景或口径分别呈现。数值可在核验单元中记录：

```json
{"measurement":{"value":200,"unit":"ms","normalization":{"factor":0.001,"unit":"s","note":"1 秒等于 1000 毫秒"}}}
```

工具按 `value × factor` 计算，保留原值、原单位与换算说明；因子与单位关系应由 Agent 核验并引用依据。不同单位只有显式规范化到相同单位后才进入同一比较组。

## 自适应续查

每轮记录新增相关 URL、新增证据和通过检查的新增核验单元，见 `comparison.progress`。`history` 保留最近 100 轮。默认搜索不将已知 URL 计入新增命中预算，部分匹配按词面相关性排序后仍可取证。

| `nextAction` | 后续行为 |
|---|---|
| `review-evidence` | 优先审阅已有材料，填写结论和引用，或标记已审阅材料 |
| `continue` | 围绕当前对象和剩余判据继续取证 |
| `change-source` | 后续默认调用采用 `nextSources` 中的可用来源顺序 |
| `change-query` | 后续采用建议查询或实体别名；Agent 可用 `discoveryQuery` 指定新查询 |
| `waiting` | 保留 `accessFailures[].retryAt`，等待期内先处理其他对象或来源 |
| `complete` | 覆盖与引用检查通过，停止自动检索 |

显式来源范围在换路时保持。`readLimit:0` 只发现来源；已有链接可直接 `read`／`read-many`。`refresh` 重取当前材料并重新打开当前核验单元，仍遵守明确的 Retry-After。

## 状态迁移与恢复

新状态使用 `version:2`。CLI 读取旧 `fields` 状态时，先原子保存带内容哈希的原文件备份，再迁移并原子替换；重复执行复用同一备份，中断后可重跑。也可以单独执行：

```bash
sera migrate-state --state ./research-state.json --json
```

MCP 使用 `sera_migrate_state` 传旧 `state`，返回新记录，由调用方保存并用于后续研究。迁移保留原结论、状态、证据 ID、候选和访问失败；旧记录没有明确的条件满足判断及引用坐标，补充后再完成核验。执行阶段统一使用新契约。

状态文件保存失败仍返回研究结果及 `stateWarnings`；缓存保存失败保留正文和 `cacheWarnings`。页面框架、元数据、正文及浏览器实际状态分别使用；动态页面可指定已有 `browser` 和单次预算 `timeoutMs`，公开 HTML、JSON、文本与 JS 可用 `raw` 直读。材料范围与读取方法见[证据说明](../../../docs/evidence.md)，后端工具及会话见[扩展来源与后端](../../../docs/integrations.md)。
