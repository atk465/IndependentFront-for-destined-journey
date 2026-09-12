# 卡牌工坊 阶段 4：地景卡（CombatState.landscape）设计

- 日期：2026-09-13
- 分支：`card-workshop-mvp`
- 承接：交接档案 §9 阶段 4（高风险，唯一必须碰战斗内核的项，独立开发独立提交）
- 世界观：**山川河流可被封入卡牌** —— 地景卡改变整个战场环境

## 1. 勘察结论（为什么这样改）

对 combat-v3 内核的勘察确认了四个可直接复用的机制，地景卡全部走既有形状：

| 需求                     | 现成机制（先例）                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| 可选状态字段             | `CombatState.frozenSlots?`（A4-3）——缺省 undefined，不破坏既有构造与回放                        |
| pending → state 原子提交 | `PendingChangeSet.freezeSlotPatches` → `applyPending` 落 `state.frozenSlots`（不变量④）         |
| 战斗中途注册 automata    | SupplyUnit 路径：`compileEffectProgram` → `updateIndex(activeEffects, { add })`（M3.5 召唤）    |
| 命令载荷携带 Code 数据   | `DeclareAttack.payload.ability` / `SupplyUnit.payload.definition` —— 载荷是调用方组装的可信数据 |

契约夹具只存 `bundle + epochs + commands + expected`（**不存全量 state**），
可选字段天然回放安全；`types.ts` 零 import（全自包含），新增类型保持零耦合。

## 2. 数据模型（全部可选，缺省不存在）

```typescript
// types.ts（v3 内部；cardTier 用 string —— v3 类型零 import 父级，不引 CardTier）
interface LandscapeFacts {
  name: string;                    // 地景卡名（逻辑键=名字）
  cardTier: string;                // 品质（展示面）
  词条: readonly string[];
  setByUnitId: string;             // 铺开者
  setInRound: number;              // 铺开回合
}

CombatState.landscape?: LandscapeFacts            // 当前地景（至多一份）
PendingChangeSet.landscapePatch?: LandscapeFacts  // 本 Command 待提交的地景
CombatView.landscape?: { name; cardTier; 词条 }   // 脱敏投影
```

- **同一时刻至多一份地景**：再铺一张**替换**旧的（journal 之外由
  `LandscapeSet.replaced` 记录被替换者名）；持续到战斗结束或被替换。
- `LandscapeFacts` 是**事实**不是效果：地景的数值面走卡牌自带的 automata DSL（§3）。

## 3. 接入通道（沿用 item 行动，零新命令）

**命令面**：`DeclareAction.payload` 增可选 `landscape?: { name; cardTier; 词条; automata? }`。
不新增 CombatCommandKind —— 地景卡是「使用道具」的一种，槽位消费、consumeSlot、
行动判定全部既有。

**结算面**（`phases/action.ts` handleAction）：

1. `actionType === 'item'` 且带 `payload.landscape` → 写入
   `changes.landscapePatch`（非 item 行动携带 landscape 字段时忽略，记 NarrativeCue 提示）。
2. 卡牌自带 `automata` → `compileEffectProgram({ owner: actorId, source: name, ... })`
   → `updateIndex(state.activeEffects, { add })` 注册进效果索引 —— 地景的数值效果
   从此走**既有 18 窗口**（Wired 12 个）由卡牌 DSL 声明，内核**零硬编码数值**
   （引擎不写死「火山加火伤」这类内容数 —— 世界观数值归世界书/卡牌，Code 只管结算）。
3. 事件：`DomainEvent.LandscapeSet { unitId, name, replaced: string | null }` +
   NarrativeCue（替换/新铺两种措辞）。
4. `applyPending` 落 `state.landscape`；`toView` 投影进 View；
   `projection-agent` 面板增一行地景（战斗主持人可见当前环境）。

## 4. 数据来源与信任模型（AI 不产数值的边界）

- `payload.landscape` 的**正规来源是会话层组装**：玩家/主持人点名要铺某张卡 →
  会话层从制卡师背包解析出那张 **CardItem** → 把卡的 name/cardTier/词条/automata
  原样装进 payload（与 `SupplyUnit.definition` 同一信任模型：内核信任调用方的
  结构化数据，形状自校验）。
- 内核 MVP 阶段不做「背包验证」（内核无存档访问）；会话层装配点是后续接线的
  唯一剩余工作（§6）。
- **地景卡的识别规则**（card-workshop 定义，供会话层消费）：
  `card.词条` 含 `'地景'` 词条（`LANDSCAPE_ENTRY` 常量 + `isLandscapeCard()` 纯函数）。
  词条是融合内核确定性产出集合之外，AI/作者可声明的一类（CardItem.词条 本就是
  元素/形态/效果/稀有四类的名字列表）。

## 5. 回放与不变量安全

- 全部字段可选：`createCombatState` 不写 landscape → 既有夹具/回放逐字节不变。
- 地景提交走 `applyPending`（不变量④）—— 不开第二条状态写入路径。
- automata 注册走 `updateIndex` 纯函数（与召唤摘除同款）—— 效果索引无就地突变。
- 零随机、零时钟（`setInRound` 取自 state.round）。
- 已核对：contract 夹具不存全量 state；7 场夹具不含地景命令 → 零回归预期，
  以全量 gates 实测为准。

## 6. 本阶段不做（后续接线清单）

- **会话层装配点**：战斗主持人工具循环 / player-input 自由文本把「铺开某卡」
  翻译成 payload.landscape（需存档访问解析真实 CardItem，属游戏管线层）。
- 地景卡的**产出**：融合内核不特判地景 —— 「地景」词条由叙事/委托自然产出。
- UI 面板的地景展示（View/projection 已备好消费面）。

## 7. 测试计划

`combat-v3/landscape.test.ts`（kernel 级，复用 test-utils bundle）：

1. item 行动铺地景 → `state.landscape` 落位 + View 投影 + `LandscapeSet(replaced: null)`。
2. 再铺一张 → 替换语义 + `replaced` 记录旧名。
3. 非 item 行动带 landscape 字段 → 忽略不落位。
4. 地景 automata 注册：卡带 `action.declared` 窗口 automaton → 铺设后的下一次
   DeclareAction 触发其效果（真效果证明，非空壳）。
5. 不变量④：地景与同 Command 的其他变更（NarrativeCue）一次提交、revision +1。
6. 缺省安全：不开地景的战斗，state 无 landscape 字段（JSON 序列化无该键）。
7. card-workshop：`isLandscapeCard` / `LANDSCAPE_ENTRY`。
