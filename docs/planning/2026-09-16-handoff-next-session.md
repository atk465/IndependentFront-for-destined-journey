# 交接文档 —— 卡牌工坊 · 精简运动与新功能批次（2026-09-16）

> 写给下一个对话/下一个会话的接手人。读完这一份 + 四份同日设计文档，就能无缝接手。
> 分支 `card-workshop-mvp`，远程 `atk465/IndependentFront-for-destined-journey`（origin），上游 `The-poem-of-destiny/IndependentFront-for-destined-journey`。

## 一、这轮做了什么（14 个提交，全在本地待推送）

**精简运动 ADR**：`docs/planning/2026-09-16-system-pruning-adr.md`（逐系统裁决记录，净删 ~10 万行）
**三个新功能设计**：`2026-09-16-affection-bond-design.md`（好感共鸣+冒险者等级）、`2026-09-16-event-commission-fusion-design.md`（事件委托）、`2026-09-16-memory-vector-recall.md`（向量召回）

| 提交 | 内容 |
|---|---|
| `665cf8d` | 删社交工坊（DB v25 删 workshopProjects） |
| `f73bee3` | 删 CG 图鉴 |
| `ffeef8c` | 删音频系统+迷你播放器（DB v25 补删音频四表） |
| `e46474e` | 删 AI 图像生成+角色外貌链（**立绘素材库保留**） |
| `c1f14e1` | 删命运契约 |
| `e700e16` | 删登神长阶飞升叙事（**等级层数值骨架保留**，A 方案） |
| `3b4965b` | 改造：冒险者等级 = 声望派生（自动晋升） |
| `25d9ed4`+`94a2608` | 删 combat-v3 引擎残余（~3 万行；DSL 类型迁入 types.ts） |
| `055fa37` | 删回合活动账本 UI（数据链保留） |
| `4e8813a` | 新功能：好感共鸣（伙伴卡×好感度） |
| `4f774ec` | 新功能：随机事件×委托板融合（事件驱动动态委托） |
| `ba6b514` | 新功能：向量召回补齐（惰性回填） |

**总账**：366+ 文件变更，净删 ~10 万行。全程四绿（typecheck / typecheck:vue / vitest / lint / knip-ratchet）。

## 二、当前验证基线

```
typecheck        0 错误
typecheck:vue    0 错误
vitest           301 文件 / 7369+ 通过 / 0 失败（数字随提交略动，以 latest 为准）
lint             0 错误
knip-ratchet     通过（基线 111 条，只减不增）
```

DB 版本 `DB_VERSION = 26`（v25 删工坊+音频五表，v26 删插画/外貌四表；老档自动清理不丢保留数据）。

## 三、关键架构事实（接手必读）

1. **战斗只有交锋拍**：combat-v3 已删，`handleCombatTrigger` 统一走 `runSkirmishEncounter`。效果 DSL（EffectAutomaton/WindowKey/EffectIntent 等）**保留**在 `types.ts`（卡片词条共用）。
2. **冒险者等级 = 声望派生**：`card-workshop/adventurer-rank.ts`，`rankForReputation(rep)` 纯函数，不落库。`CharacterState.adventurerRank` 字段已删。
3. **好感共鸣**：`card-workshop/affection-bond.ts`。打出召唤/军团卡时按同名 NPC 好感乘效果（×0.8~×1.5）。接线在 `submitSkirmishCounter` 两条出卡路径。
4. **事件委托**：`RandomEventDef.commission?`（模板）→ 事件结算写 `worldFlags.randomEvents.eventCommissions` → 委托板/AI 注入合并显示 → 交付一次性移除。纯函数在 `card-workshop/event-commission.ts`。
5. **向量召回**：管线本来就在（`recallMemories` + `callMemoryRecallEmbedding` 自动路由）。本次补了**惰性回填**：`buildContext` 末尾 `maybeBackfillMissingMemories()`（fire-and-forget，每轮最多 5 条）。主人已配 doubao embedding 端点。
6. **MINUTES_PER_GAME_DAY** 已上提 `time-system` 导出（gameDay 公式全仓统一：`floor(toEpochMinutes(gameTime) / 1440)`）。

## 四、待办（主人已裁决/已提出，未实施）

| 待办 | 状态 | 备注 |
|---|---|---|
| 伙伴契约重做（并入好感共鸣） | 设计钩子已留 | 旧「阶段5-闭环」（召唤→契约→损坏→修复）绑 v3 已删。重做时契约=高好感+专属卡高阶形态，损坏/修复按交锋语义重定义。CraftBench 修复 UI 还在但 `damaged` 标记暂无写入方 |
| 随机事件×委托板**深化** | 基础融合已上（事件→动态委托） | 深化方向：事件条件吃 reputation（`EventCondition.char.affectionGte` 已支持好感，声望可仿照）、事件委托支持素材奖励的动态化 |
| 向量召回**效果验证** | 代码已上 | 主人玩几轮后看调试面板 `memory_embedding` 条目与召回质量；doubao-embedding-vision 若有兼容问题换 `doubao-embedding` |
| 过时文档归档 | 未做 | `image-generation-*`×3 / `combat-system-architecture-v3.md` / `creative-workshop-compat-design.md` / `audio_system.md` → 挪 `docs/archive/` 或加归档头 |
| 推送 | **待主人凭证** | 本地 14 个提交（含文档）待推 origin |

## 五、坑与纪律（这轮踩过的）

1. **python heredoc 多行 replace 对 CRLF 文件静默失败**——`.replace('\r\n','\n')` 先归一，或直接行级处理。这轮多次栽在这里。
2. **删除接口字段时连带删所有测试夹具**（types.test / fixtures / *-test 的 make* 函数）——typecheck 会替你找全。
3. **Dexie 删表必须显式 `表名: null` + 升 DB_VERSION**，且 `FullBackup`/`SessionBackup`/`validateBackupOrThrow` 数组字段清单/`exportAllData`/`importAllData` 五处同步。
4. **knip-ratchet 是硬闸门**：新增死代码必须删掉/接上，或 `knip:update` 说明理由。删除导出前先查内部消费（有的「死导出」其实是模块私有化的候选）。
5. **分层闸门**（`tests/layering-gate.test.ts`）：引擎不依赖前端。删目录后记得更新其覆盖面断言（如 combat-v3/ → card-workshop/）。
6. **`card-workshop/contract.ts` 已删**（阶段5-闭环随 v3 下线）——CraftBench 修复 UI 还在但 `damaged` 无写入方；重做契约时一起处理。

## 六、下一步建议（优先级序）

1. 主人实玩验证：交锋好感共鸣审计行、事件委托全链、记忆召回质量（调试面板 `memory_embedding` 条目）
2. 推送 + 同步私有内容仓（事件定义补 commission 模板的示例）
3. 伙伴契约×好感度深化设计（对接玩卡账本与修复闭环）
4. 过时文档归档
