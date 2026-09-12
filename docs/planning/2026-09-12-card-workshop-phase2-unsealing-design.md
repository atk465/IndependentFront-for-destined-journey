# 卡牌工坊 阶段 2：启封判定设计（接确定性骰带）

- 日期：2026-09-12
- 分支：`card-workshop-mvp`
- 承接：`2026-09-12-card-workshop-mvp-design.md` §2 / `2026-09-12-card-workshop-mvp-adr.md`（路线 A++）
- 交接档案 §9 阶段 2：「启封判定接入 dice-tape.ts 确定性骰带」，风险低

## 1. 世界观与判定位置

> 卡牌是被封印的**有意志的存在**。启封高阶卡时，封印物会**抗拒**。
> 意志对抗失败 → **抗命**：哑火 / 暴走（打自己人）/ 反噬。

- **不做真抽牌**（ADR 既定）：随机性全部落在启封这一步。
- **稀有度越高越危险**：封印 DC 随卡牌品质（白铁→星辉）单调上升，天然平衡杠杆。
- 启封 = **使用**这张卡（战斗中打出）。战外没有「启封」的世界观支点，故本阶段
  **不做战外启封按钮**，UI 只做诚实的难度预览（DC + 槽位成本）。

## 2. 判定规则（确定性，零 AI 参与）

### 2.1 意志对抗

启封者掷 1 颗 d20 + 意志修正，对抗封印 DC：

```
margin = (d20 + willMod) - DC
```

- `margin >= 0` → **启封**（封印受控破裂；若卡 `sealed`，调用方置 `sealed: false`）
- `-3 <= margin <= -1` → **哑火**（封印扛住，卡什么都没发生，**保持封印**）
- `-7 <= margin <= -4` → **暴走**（力量脱控逸出，敌我识别失效 —— 效果由调用方按
  「作用于己方」结算；封印破裂，`sealed: false`）
- `margin <= -8` → **反噬**（封印物反扑启封者；封印破裂，`sealed: false`）

失败越大、抗命越烈：单颗骰即可分级，骰数越少回放越干净。

### 2.2 边界规则

- **nat 20 自动突破**：封印必有裂缝，无论 DC 多高。
- **nat 1 必定抗命**，且不劣于哑火（意志修正再高也救不回）。

### 2.3 数值表（集中定义在 unsealing.ts，单一真源）

| 卡牌品质 | 封印 DC | 启封槽位成本（动作槽） |
| -------- | ------- | ---------------------- |
| 白铁     | 8       | 1                      |
| 青铜     | 11      | 1                      |
| 白银     | 14      | 1                      |
| 鎏金     | 17      | 2                      |
| 星辉     | 20      | 2                      |

- **相克不稳**：`recipe.fusionKind === '相克'` 的卡 DC +3（d20 口径下 ≈ 抗命率 +15%，
  兑现 MVP 设计文档「相克：启封抗命率 +15%」的承诺）。
- **意志修正**：`willModifierOf(attributes) = floor((spi - 10) / 2)`（精神 8→-1，20→+5）。
  战斗内接线时由调用方从单位属性计算后传入，本模块不读 CharacterState。

## 3. 确定性契约（对齐 dice-tape 铁律）

- **零 `Math.random` / 零时钟**：d20 一律由调用方传入。本模块与 `combat-v3/dice-tape.ts`
  同一条铁律（战斗 v3 目录内由 `no-nondeterminism.test.ts` 扫描断言）。
- **可回放**：同一骰值序列 + 同一输入 → 同一结果。战斗内接线（阶段 5）时，d20 从
  骰带通道 `draw` 取得，天然落进既有回放体系。
- 🔴 **不 import `combat-v3/` 任何内部模块**：骰带是 combat-v3 的 internal
  （`index.ts` 唯一公共出口不含它），反向依赖会把卡牌工坊焊死在战斗内核上。
  本阶段只对齐其**契约形状**（骰值调用方供给 + 通道耗尽语义由调用方处理）。

## 4. 文件布局（扩散优先，不碰 combat-v3/）

```
src/sillytavern/card-workshop/
  unsealing.ts             # DC/槽位成本表 + 意志修正 + 判定纯函数
  unsealing.test.ts        # 边界逐格覆盖（margin 分级 / nat 20/1 / 相克加值）
src/ui/components/game/cards/
  CardAlbumPanel.vue       # 详情区对 sealed 卡显示「封印 DC / 启封槽位」预览（只读，无按钮）
```

## 5. 战斗内接线点（阶段 5 才做，本文只锚坐标）

- 启封命令挂 `TacticalActionType = 'item'`（`combat-v3/phases/action.ts`）。
- 槽位消费走 `consumeSlot`（`combat-v3/phases/unit-turn.ts`）：高阶卡要求
  `UNSEAL_SLOT_COST[tier]` 个动作槽（现内核 DeclareAction 固定消费 1 槽，
  多槽消耗届时独立评估改造方式）。
- 骰值来源：骰带通道（`statusContest` / `procCheck` 语义最近，或届时评估新增
  reserved 通道 —— 动 60 骰切分契约属于战斗内核改动，独立提交）。
- 暴走/反噬的伤害落地：走既有 EffectIntent 通道，由 AI（战斗主持人）演绎、内核记账。

## 6. 测试与闸门

- `unsealing.test.ts`：DC 表逐档、相克 +3、margin 分级六条边界（0 / -1 / -3 / -4 /
  -7 / -8）、nat 20 vs 星辉+相克、nat 1 vs 白铁、意志修正两端、槽位成本表、
  纯函数不变式（不 mutate 入参）。
- 提交前 `npm run gates` 八道闸门全绿。
