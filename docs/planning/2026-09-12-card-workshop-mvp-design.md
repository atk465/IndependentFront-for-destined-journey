# 卡牌工坊 MVP 设计文档（卡兰大陆世界观）

- 日期：2026-09-12
- 分支：`card-workshop-mvp`（fork: `atk465/IndependentFront-for-destined-journey`）
- 作者：atk465
- 关联：`docs/planning/2026-09-12-card-workshop-mvp-adr.md`

## 1. 背景与目标

命定之诗前端（`IndependentFront-for-destined-journey`）是一套 Vue3 + Pinia + Vite + TS 的
AI 驱动文字 RPG 引擎。我们希望在其上承载一套**真正的卡牌制作玩法**——以参考实现
（「冒险公会 / 卡牌制作」截图）为蓝本，世界观设定为「卡兰大陆」：

> 万物皆可成素材；远古巨兽可化为伙伴；山川河流可被封入卡牌；少数禁忌卡能颠覆法则。

**MVP 目标（MVP 先行）**：打通「采集素材 → 炼制卡牌 → 编入卡组 → 查看卡包」闭环，
**不碰 combat-v3 内核**，不做真抽牌战斗。验证「引擎级真数值 / 真随机 / 真 UI 面板」可行性。

## 2. 战斗路线决策（A++「启封式卡组战斗」）

经源码勘察，路线定为**技术形态 = 路线 A（不动 reducer/phases 主干），表现力 ≈ 路线 B**。

| 世界观原句       | 引擎现有通道                                                                                     | 改动量     |
| ---------------- | ------------------------------------------------------------------------------------------------ | ---------- |
| 巨兽化为伙伴     | `SpawnOrDespawnIntent` → 冻结 spawn frame → `CharGenRequest` → `SupplyUnit` → 插进 `state.units` | 零         |
| 禁忌卡颠覆法则   | `Adjudicate` + `requestedRuleOverride`                                                           | 零         |
| 万物皆可成素材   | `craft-gen-chain` → `item-gen-chain` → `buildCraftPatches`                                       | 零         |
| 山川河流封入卡牌 | 引擎**无地形/环境概念**（grep 零命中）                                                           | **需新增** |

**不做真抽牌**：制卡师亲手炼卡，与卡册间不存在信息不对称，「抽牌」前提不成立。
**随机性改放「启封判定」**：高阶卡封印物会抗拒，意志对抗失败 → 抗命（哑火/暴走/反噬），
复用现有 `dice-tape.ts` 确定性骰带，天然形成「稀有度越高越危险」的平衡杠杆。
资源用**启封槽位**（复用 `unit-turn.ts:165` 的 `consumeSlot`），非蓝条。

> 注：地景卡（`CombatState.landscape`）是 MVP 之后唯一必须碰战斗内核的项，本阶段不做。

## 3. MVP 范围（比原计划大幅收缩）

勘察发现引擎已有完整制作系统骨架，故「制卡」无需新造链路：

```typescript
CraftIndustry = '锻造' | '炼金' | '烹饪' | '裁缝'; // 产业 + 核心属性映射
CraftRating = '大失败' | '失败' | '成功' | '精益求精'; // 评级
CRAFT_RATING_VALUE_RANGE; // 产出数值区间（已是确定性 Code）
QualityLevel = Rarity; // 品质 7 级
```

MVP 五件事：

1. `CraftIndustry` 增加 `'制卡'`（在 `types.ts`，注意：当前定义在 types.ts 而非 field-enums.ts，
   违反数据规范铁律⑤，本 PR 顺手收口到 `field-enums.ts`）。
2. `field-enums.ts` 的 `ITEM_TYPES` 增加 `'卡牌'`（复用 `InventoryItem.material` 模型 + `automata` DSL）。
3. 新增 `src/sillytavern/card-workshop/card-fusion.ts` —— **确定性融合内核**（纯函数，不碰 AI）。
4. 卡册状态：`CharacterState` 内嵌 `cardAlbum: CardAlbumState`（遵循「物品无 id、逻辑键=名字」铁律）。
5. 最小 UI：卡包面板 + 制台实时预览（复用 `game/cards` 现有系统卡组件布局）。

## 4. 数据模型

遵循 `docs/superpowers/specs/2026-07-16-data-field-conventions-design.md` 五铁律：
逻辑键 = 名字；AI 永不产 id；每类数据唯一真源；枚举中文集中定义；物品无 id 内嵌 inventory。

```typescript
// 卡牌 = InventoryItem 子类型（type: '卡牌'），复用 material/effects/automata/modifiers/rarity
export interface CardItem extends InventoryItem {
  type: '卡牌';
  // 由 card-fusion 确定性产出，绝不来自 AI 自由文本
  cardTier: CardTier; // 白铁|青铜|白银|鎏金|星辉 (5 级)
  词条: string[]; // 元素/形态/效果/稀有 四类
  recipe: FusionRecipe; // 主+副素材名（逻辑键）
  sealed: boolean; // 是否未启封（高阶卡封印物）
}

export interface CardAlbumState {
  owned: string[]; // 卡牌名（逻辑键，遵循铁律①）
  deck: string[]; // 当前卡组（同名≤2，遵循铁律）
  capacity: number;
}
```

融合规则（确定性，写入 `card-fusion.ts`）：

- 同类叠加升级：火 + 火 = 烈焰
- 相生复合：火 + 风 = 燎原
- 相克标记不稳定：造价 ×0.7，启封抗命率 +15%
- 造价 = Σ素材售价 × 稀有度系数；可能炼制失败（走 `CraftRating`）

## 5. 文件布局（仅新增/微调，扩展优先于修改）

```
src/sillytavern/
  field-enums.ts            # ITEM_TYPES + 新增枚举集中（收口铁律⑤）
  types.ts                  # CraftIndustry 加 '制卡'；CardItem/CardAlbumState
  card-workshop/
    card-fusion.ts          # 确定性融合内核（纯函数）
    card-fusion.test.ts     # 单元测试（仓库强制：每模块配 .test.ts）
src/ui/components/game/
  cards/
    CardAlbumPanel.vue      # 卡包面板
    CraftBench.vue          # 制台实时预览
```

## 6. 测试与质量闸门

- 新模块必须配 `.test.ts`（仓库 7400+ 测试传统）。
- `card-fusion.test.ts` 覆盖：叠加/相生/相克/造价/失败率/稀有度系数。
- 提交前跑 `npm run gates`（八道闸门）；本阶段新代码至少过 `vitest` 相关用例。
- 因沙箱限制，本地 git 分支名禁用斜杠（`feature/` 前缀无法持久化），统一用 `card-workshop-mvp`。

## 7. 回滚

- 纯扩展（新增 `card-workshop/` 目录 + 枚举追加），不修改 combat-v3 / craft-gen-chain 主干。
- 任一步失败：`git revert` 或整分支不合并即可，上游 `master` 不受影响（fork + 独立分支）。

## 8. 后续阶段（MVP 之后，非本 PR）

- 阶段 2：启封判定接入 `dice-tape.ts` 确定性骰带。
- 阶段 3：卡组战力 + 委托系统（复用 `craft-gen-chain` 的 `<craft_request>` marker 协议）。
- 阶段 4：地景卡 `CombatState.landscape`（唯一需碰战斗内核项，隔离开发）。
- 阶段 5：召唤/规则覆写接入 `summon-pool.ts` + `requestedRuleOverride`。
