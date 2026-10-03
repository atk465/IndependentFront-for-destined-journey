# 卡牌工坊 阶段 5：战斗内接线 —— 启封入骰带 + 召唤卡 + 禁忌卡设计

- 日期：2026-09-13
- 分支：`card-workshop-mvp`
- 承接：`2026-09-12-card-workshop-phase2-unsealing-design.md` §5（战斗内接线点，标注「阶段 5 才做」）、
  交接档案 §9 阶段 5（召唤接入 + 规则覆写）
- 状态：本文同日实施

## 1. 范围：把三条既有通道对齐到「玩卡」这一个动作上

| 世界观         | 既有通道（MVP 设计 §2 勘察：改动量零）                                                                                                | 本阶段接的事               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 启封判定       | 骰带 `intentCheck` 通道 + `judgeUnseal` 纯函数（阶段 2）                                                                              | 内核抽骰判定，落进回放体系 |
| 巨兽化为伙伴   | `action.declared` 窗口 → `SpawnOrDespawnIntent` → 冻结 spawn frame → `CharGenRequest` → `SupplyUnit`（M3.5）                          | 卡的召唤意图**打出即发动** |
| 禁忌卡颠覆法则 | `OverrideIntent` → `applyIntents`（`action.freezeSlot` 等已落地）+ `Adjudicate`/`requestedRuleOverride`（战斗主持人六步验证，会话层） | 卡的覆写意图随打出结算     |

## 2. 玩卡通道统一（对阶段 4 的一处更正）

📌 **2026-09-13 更正**：阶段 4 提交的 `DeclareAction.payload.landscape` 更名为
**`payload.card`** 并扩形——地景只是卡的一种（词条含「地景」），召唤/禁忌卡走同一条
通道，两个平行字段会造成第二套玩卡语义。`state.landscape` / `LandscapeSet` 事件 /
替换语义**逐字段不变**，仅载荷入口更名扩形。

```typescript
payload: {
  actionType: 'item' | 'move' | 'focus' | 'defend';
  description?: string;
  card?: {
    name: string;
    cardTier: string;                            // 白铁…星辉；非法值兜底白铁
    词条: readonly string[];
    fusionKind?: '叠加' | '相生' | '相克';        // 相克 DC+3（phase2）
    sealed?: boolean;                            // 未启封 → 先过意志对抗
    automata?: readonly EffectAutomaton[];       // 卡牌自带 DSL
  };
}
```

正规来源仍是**会话层**从背包解析真实 `CardItem`（信任模型同 `SupplyUnit.definition`）。

## 3. 结算流程（`phases/action.ts` 玩卡分支）

`actionType='item'` 且带 `payload.card`：

1. **槽位校验**（先于一切，rejection = 零骰零变更零消费）：封印卡按
   `UNSEAL_SLOT_COST`（白铁~白银 1 / 鎏金·星辉 2）。consumeSlot 已扣 1 槽；
   不足 N 槽整命令拒绝（reducer 对 rejection 不提交 consumeSlot 的变更），足够则补扣第二槽。
2. **启封判定**（仅 `sealed`）：从 `intentCheck` 通道抽 1 颗 d20（意图对抗语义最贴），
   `judgeUnseal(卡, roll, willModifierOf(行动者.spi))`（阶段 2 纯函数原样复用）。
   通道耗尽 → `RequiredInput.BeginOutput`（flee 同款；coordinator 注骰后重试，
   半成品不提交故无双扣）。产 `UnsealJudged { unitId, name, outcome, roll, dc, margin }`：
   - **哑火**：无效果，槽位照耗（尝试即代价），返回
   - **反噬**：效果不发；`REBOUND_DAMAGE[cardTier]` 反扑启封者（新表，见 §4），返回
   - **暴走**：效果照发（敌我识别失效是内容层——卡的 automata 自带指向），叙事记暴走，继续
   - **启封**：继续
3. **automata 切分**（compile → 两半）：
   - **地景卡**（词条含「地景」，`LANDSCAPE_ENTRY` 唯一真源）：**全部持久注册**（阶段 4
     语义原样：环境常驻、从下一次行动起按窗口触发）+ 设 `state.landscape`
   - **非地景卡**：`action.declared` 订阅者**打出即发动**（并入本次窗口求值，不持久注册
     ——重注册会在下个行动双发）；其余窗口订阅者持久注册（持续光环）
4. **窗口求值与结算走既有管线**：spawn 意图进 M3.5 冻结链（CharGenRequest/SupplyUnit/
   templateRef 召唤池，池空未命中走实时生成——离线填池不在本阶段）；非 spawn 意图
   `applyIntents` 落地（阶段 4 补的缺口修复）；`OverrideIntent(action.freezeSlot)`
   即禁忌卡的机械证明（落 `freezeSlotPatches` → `state.frozenSlots`）。

## 4. 反噬伤害表（阶段 2 遗留开口的收口）

阶段 2 设计写「反噬伤害由 AI 演绎、内核记账」但没给账本。本阶段补
`card-workshop/unsealing.ts` 的 `REBOUND_DAMAGE`（单一真源，单调、非致死档）：

| 白铁 | 青铜 | 白银 | 鎏金 | 星辉 |
| ---- | ---- | ---- | ---- | ---- |
| 5    | 8    | 12   | 16   | 20   |

内核 import 该表记账（combat-v3 引擎内兄弟模块 import 有先例：compile.ts 引
effect-types、state.ts 引 ../types）；HP 走 `changes.hpChanges`（applyPending
clamp 兜底）。

## 5. 会话层装配与 `Adjudicate` 深覆写（不在本阶段）

- `coordinator.toolCallToCommandSync` 的载荷收敛改为 `card` 形状（形状校验永不抛）；
  玩家自由文本「铺开/打出某卡」→ 从背包解析 CardItem → 组装 payload，仍是
  游戏管线层工作（phase4 §6 清单延续）。
- 禁忌卡的**深覆写**（`terminal.forceTerminal` / `death.threshold` /
  `morale.forceState`）走战斗主持人 `Adjudicate` + `requestedRuleOverride`
  六步验证（adjudication.ts），由卡打出引发的叙事驱动——内核不重复实现。

## 6. 回放与不变量安全

- 载荷可选、`UnsealJudged` 只追加事件类型（projection-ui 穷尽 switch 补映射）；
  夹具不含 card 命令 → case-06 等契约逐字节不变（gates 实测为准）。
- 判定骰走 `state.dice`（applyOutcome `dice` 字段）→ 回放天然对齐；
  零 `Math.random` / 零时钟（`no-nondeterminism.test.ts` 扫描域内）。
- rejection / BeginOutput 均不提交半成品（consumePlayerCommand 既有语义）。

## 7. 测试计划

`combat-v3/card-play.test.ts`（替代 phase4 的 landscape.test.ts，全部用例迁移扩容）：

- 地景六例迁移（载荷改 `card`）：落位/替换/非 item 拒绝/缺省无键/持久光环/坏 automaton 剔除
- 启封：nat20 启封、低滚哑火（槽已耗）、星辉+低滚反噬（HP 扣 REBOUND_DAMAGE、无效果）、
  暴走（效果照发+事件）、鎏金 2 槽不足 → rejection（applyOutcome 恒等原 state）、
  intentCheck 耗尽 → BeginOutput
- 召唤卡：非封印卡带 spawn automaton → 打出即 `CharGenRequest` + spawn 冻结（M3.5 通道证明）
- 禁忌卡：`OverrideIntent(action.freezeSlot)` → applyOutcome 后 `state.frozenSlots` 落位
- unsealing.test.ts：`REBOUND_DAMAGE` 表
