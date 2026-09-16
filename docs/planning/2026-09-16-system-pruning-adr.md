# 系统精简运动 ADR（2026-09-16）

> 状态：已实施完毕（14 个提交，`665cf8d`..`055fa37`，净删 ~10 万行）
> 裁决人：主人（逐系统访谈，每项单独给出保留/删除理由后裁决）
> 执行：ZCode（卡牌工坊会话）

## 背景

项目从「命定之诗」叙事引擎长出，历史包袱是 galgame 式养成 + 多系统并行。主人转向**卡牌工坊**为核心玩法后，发起逐系统访谈：每个系统给出「是什么 / 卡牌工坊是否依赖 / 删除理由 / 保留理由」，主人逐项裁决后才动代码。

**总账**：366 文件变更，+1,707 / **−100,123 行**。全程保持类型（引擎+Vue）/ 测试 / lint / knip 四绿，每批一提交可回溯。

## 裁决记录（按访谈顺序）

| # | 系统 | 裁决 | 提交 | 理由摘要 |
|---|---|---|---|---|
| 1 | 社交工坊（浏览/安装/社区分享 + 扩展管理页 + 捏人页工坊轴） | 删 | `665cf8d` | 卡牌工坊核心玩法零依赖；DB v25 删 `workshopProjects` 表；`creative_workshop` 分区从 `WorldBookPartition` 移除 |
| 2 | CG 图鉴 | 删 | `f73bee3` | 依赖已删的图像生成；gallery modal 与工具入口一并摘除 |
| 3 | 音频系统 + 迷你播放器 | 删 | `ffeef8c` | 无播放需求；`<play_audio>` 标记链全删；素材 zip 的音频半边剥离（mp3 按噪音跳过）；`audio-names.ts` **保留**（MIME 工具被素材系统共用）；DB v25 补删音频四表 |
| 4 | AI 图像生成（含角色外貌链） | 删，**立绘素材库保留** | `e46474e` | 出图链（anlas/quota/dialect/providers/scene-image）+ 外貌三件套（唯一读者是出图 prompt）一起下线；`resolveSceneWeather` 上提 `lib/scene-weather.ts`（地图仍用）；内容注册表删第 7 面 imageDialects；DB v26 删四表 |
| 5 | 命运契约 | 删 | `c1f14e1` | 主人裁定「专属词条交给好感度解决」；`FateContract` 降级为老档兼容形状（可选字段零读写口）；`save-profile` 三函数本就零消费者 |
| 6 | 登神长阶 | **A 方案**：删飞升叙事、留等级层数值 | `e700e16` | 等级 `level` 直接进交锋数值（`derived-stats` atk=2×str+level）必须留；飞升闸门（`canPassAscensionGate`/`resolveAscensionFlyup`/`canBreakthrough`）+ NPC 神位/道途/神国字段删除；升级循环收敛为「totalExp 攒够即升」 |
| 7 | combat-v3 战斗引擎残余 | 删 | `25d9ed4` `94a2608` | 交锋（SKIRMISH_DEFAULT）全面接管，v3 休眠 0 触达；**回滚开关失效**——卡牌工坊全绑交锋，回 v3 = 回到没有卡牌战斗的游戏。**精确切割**：`EffectAutomaton` DSL 全套类型（WindowKey/EffectIntent/ModifierSlot/SummonedUnitDefinition/DeckCardData）迁入 `types.ts`（卡片词条共用）；v3 内核/协调器/回放/UI（~3 万行）删除 |
| 8 | 回合活动账本 UI | 删 UI 留数据 | `055fa37` | `agentActivityRuns` 数据链完整保留（活动指示器 `thinkingText` / 防并发判据仍在消费）；删 TurnActivityLedger.vue + ChatFlow 挂载 + retry 链 |

## 明确保留（同轮访谈裁定）

| 系统 | 裁决 | 备注 |
|---|---|---|
| 地图系统 + 剧情线系统 + 美化系统 | 留（第一轮） | 主人「地图后面会做」 |
| 立绘素材库（asset 系统） | 留 | `audio-names.ts` MIME 工具被它共用 |
| 快照系统 | 留 | 交锋结算的撤销/回退依赖 |
| 记忆系统 | 留 + 向量召回补齐 | 见 `2026-09-16-memory-vector-recall.md` |
| 随机事件系统 | 留 + 与委托板融合 | 见 `2026-09-16-event-commission-fusion-design.md` |
| 好感度系统 | 留 + 伙伴卡接入 | 见 `2026-09-16-affection-bond-design.md` |
| EJS 脚本 / DebugPanel / 角色UI / 玩家人格 / 场景面板 | 留 | 主人批量裁决「剩下的都留着」 |
| 回合活动账本 UI | 删 UI 留数据 | 唯一的「部分删」项 |

## 兼容性契约（老档安全）

- **数据库**：`DB_VERSION 24 → 26`，v25 删 workshopProjects + 音频四表，v26 删插画/外貌四表。Dexie 显式 `表名: null` 删表语法；老档打开自动清理，**不丢任何保留数据**。
- **存档备份**：`SessionBackup`/`FullBackup` 字段同步清理；旧备份缺席字段照常导入（三态容忍不变）。
- **变量别名**：`stat_data.主角.冒险者等级` 改指 `profile.reputation` 真源（见冒险者等级设计文档）。
- **老正文中残留标记**：`<play_audio>` / `<scene_image>` 在 story-output 投影层集中剥离（旧消息兼容，新 prompt 已不教）。

## 过时文档清单（本次已识别，未处理）

`image-generation-*`（3 份）、`combat-system-architecture-v3.md`、`creative-workshop-compat-design.md`、`audio_system.md` 描述的是已删系统。建议挪 `docs/archive/` 或加归档标记（待主人裁决）。
