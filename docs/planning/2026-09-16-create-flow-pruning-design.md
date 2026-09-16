# 捏人流程精简 · 设计裁决与实施记录（2026-09-16）

> 访谈 → 共识 → 实施三段完成。本文记录裁决结论与改动清单，供后续会话接手。
> 分支 `card-workshop-mvp`；未提交（等主人确认后随下一批一起推送）。

## 一、目标与方向

**首要痛点**：砍低价值步骤（删减，不加快速通道、不做全面重组、不引入 AI 代填）。

## 二、步骤裁决（9 步 → 6 步）

| 原步骤 | 裁决 | 说明 |
|---|---|---|
| 1 难度选择 | 保留 | 点数预算来源，必选 |
| 2 基础信息 | 保留 + 承接背景 | 身世字段旁挂「从预设背景选择」折叠面板（四分类 + BackgroundList）；点选预设把 fullText 写进身世文本、可再编辑；`selectedBackground`/`customBackgroundText` 双状态删除，`<user>` 占位统一在 `buildOpeningPrompt` 替换（身世段新加 `substituteUser`） |
| 3 命定核心 | **整链删除** | 见 §三 |
| 4 角色启用 | 步骤保留 | 内容条目「男娘扮演」「假小子扮演」（作者：快乐柠萌茶）→ **私有内容仓删除**（含内容包 uid 钉选清单同步），非本仓代码改动 |
| 5 装备/道具/技能 | 保留不动 | 转生点经济消费口 + item_gen 开场链路 |
| 6 背景故事 | 并入基础信息（见上） | 独立步骤消失 |
| 7 剧情规划 | 保留不动 | AI 叙事核心输入 |
| 8 出身天赋 | 保留 | 必选 7 选 1；提交点维持在此步（原确认页本就不可达） |
| 9 确认提交 | **删除** | `CreatePage.vue` 在出身天赋步提交，确认页从未可达——纯死代码 |

## 三、命定核心整链删除清单

主人裁决：命定核心是上游「命定诗篇」的遗产，本项目实际无作用。

- 步骤组件 + 测试：`CreateStepDestinyCore.vue` / `CreateStepDestinyCore.test.ts` 删
- create-store：`destinyCore`/`destinyCorePool`/`selectDestinyCore`（目录旧路径）、`systemCoreEntries`/`selectedSystemCoreEntryUid`/`selectedSystemCoreEntry`/`selectSystemCoreEntry`（世界书路径）、`buildEnabledWorldBookEntries` 的 system_core 分支全删
- `types.ts`：`CreatePreset.destinyCoreId`/`systemCoreEntryUid`/`background`/`customBackgroundText` 字段删（`CharacterState.customFields` 是自由对象，typed 字段本就在 CreatePreset；无 DB 迁移需求）
- `game-pipeline.ts`：core lore agent 分支（`selectedSystemCore` → story/char_gen 强插 system_core 书）删；老档残余 `system_core:uid` 键仍由 `filterBooksByEnabledEntries` 存档级过滤自然兼容
- `content-pack-plan.ts`：`SINGLE_SELECT_PINNED_PARTITIONS` 收为 `['character']`——system_core 降级为多选分区，老档失配键走「清除 + sideEffect note」宽路径
- `builtin-worldbooks.ts`：`BUILTIN_IDS` 移除 `system_core`；`public/data/worldbooks/system_core.json` 删（三条「起源印记」风味文本随之退场）
- `public/data/defaults/agent-config.json`：5 处 `worldBookIds` 悬空引用清掉
- 占位内容集：15 本 → 14 本，`placeholder-hashes.json` 重跑 `scripts/build-placeholder-hashes.mjs` 再生
- 引擎目录面：`DestinyCore` 接口、`CatalogData.destinyCores` 面删除；占位 `catalog.json` 的 `destinyCores` 池删
- 无需改：`beautifier.ts` 的 `collectActiveSignalsFromEntries` 是通用函数（character 条目仍消费）；`WorldBookPartition` 联合类型保留 `'system_core'`（老档/备份兼容）

## 四、字段级裁决

- **性别枚举**（引擎侧 D24）：只留「男」「雄性」「自定义」（主人逐字裁决；「女/雌性/扶他/男娘/假小子」删）
- 年龄/性格/身材/身世/补充保留（廉价自由文本）；经验档位保留（游戏内可切换，无精简收益）
- 身材是自由文本 textarea，无枚举（与性别枚举同名词条是巧合，勿混淆）

## 五、验证基线（实施后）

```
typecheck        0 错误
typecheck:vue    0 错误
vitest           301 文件 / 7385 通过 / 0 失败（8 skipped 为既有）
lint             0 错误
knip-ratchet     通过（111 条，无新增）
```

本次触碰的文件全部 prettier-clean（仓库尚有 52 个历史文件不合 format:check，非本次基线范畴，未动）。

## 六、待办（移交）

| 待办 | 状态 |
|---|---|
| 私有内容仓：删「男娘扮演」「假小子扮演」两条 character 条目 + 同步内容包 uid 钉选清单 | 待办（内容仓操作） |
| 私有内容仓 catalog 若含 `destinyCores` 面，可顺手清掉（解析端已忽略） | 可选 |
| 实玩验证：6 步向导流转、背景旁挂选择器、预设保存/加载（旧预设含 destinyCoreId/background 字段已被容错忽略） | 待主人实玩 |
