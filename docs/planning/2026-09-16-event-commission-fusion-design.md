# 随机事件 × 委托板融合设计（2026-09-16）

> 状态：已实施（`4f774ec`）
> 裁决人：主人（随机事件「留但与委托板融合」；设计本文档定稿）
> 前置：随机事件系统 v1（`2026-08-15-random-event-system-design.md`）、卡牌工坊委托接线（playable-loop §6）

## 玩法闭环

```
内容包事件定义带 commission 模板
        ↓
Story AI 写 <event_trigger name="盗贼团袭击"> 认领事件
        ↓
结算：事件入档 + 委托板【动态出现】「讨伐盗贼团」（带「事件」标记）
        ↓
AI 从 {{COMMISSIONS}} 看到它 → 按名立 quest；玩家炼卡交付
        ↓
交付 = 奖励到账 + 委托消失（同一次原子提交，防刷）
        ↓
逾期未交付 → ttlDays（缺省 7 天）后自动清理
```

## 数据形状（`card-workshop/commission.ts`）

```ts
/** 事件定义里的委托模板（RandomEventDef.commission） */
interface EventCommissionTemplate extends CommissionDef {
  ttlDays?: number;   // 有效期（gameDay）；缺省 7 天
}

/** 已实例化的动态委托（每存档，落 worldFlags.randomEvents.eventCommissions） */
interface EventCommission {
  def: CommissionDef;      // 本体（交付/注入与静态同形状，下游无需知道来源）
  sourceEvent: string;     // 来源事件名（溯源与同名去重）
  armedDay: number;        // 触发日（gameDay）
  expiresDay: number;      // 过期日（armedDay + ttlDays）
}
```

`RandomEventDef.commission?: EventCommissionTemplate`、`RandomEventSaveFlags.eventCommissions?: EventCommission[]`（均为可选字段，旧档/旧包零影响）。

## 纯函数叶（`card-workshop/event-commission.ts`）

| 函数 | 职责 |
|---|---|
| `buildEventCommission(tpl, sourceEvent, currentDay)` | 模板实例化：剥 ttlDays、记来源与到期日；currentDay 非法 → null |
| `isEventCommissionActive(ec, currentDay)` | `currentDay < expiresDay`（触发起 ttlDays 天内有效，到期日当天已过期） |
| `pruneEventCommissions(list, currentDay)` | 保洁：摘过期、保序 |
| `eventCommissionDefs(list, currentDay)` | 视图转换：剥溯源字段 → `CommissionDef[]`（交付/注入同形状） |

纯度约束：无 I/O、无 Dexie、无 Vue。gameDay 由调用方传入（`Math.floor(toEpochMinutes(gameTime) / MINUTES_PER_GAME_DAY)`，常量已上提 time-system 导出）。

## 生成时机（state-manager.confirmRandomEventTrigger）

事件结算（`settleRandomEventTrigger`）成功后，**同一把存档写锁内**：

1. `getRandomEventPack().defs` 按名找定义，取 `def.commission` 模板
2. `buildEventCommission(tpl, name, currentDay)` 实例化
3. 同名同源已存在 → 移除旧条（重新触发 = 委托重新来过）
4. `pruneEventCommissions` 顺带清过期
5. `settled.flags.eventCommissions = [...]` → `updateRandomEventFlags` 原子落库

解析侧：`random-event-pack.coerceDef` 解析 `raw.commission`（复用 `coerceCommissions` 单条包数组取一，`ttlDays` 正整数向下取整）。解析失败只 warn **不拒绝整条事件**——事件照常触发，只是不带委托。

## 交付（game-store.deliverCommission）

委托查找 = **静态（内容包第 15 面）+ 动态（存档 flags，按当前 gameDay 过滤过期）**；同名时动态优先（事件是「正在发生的事」，覆盖常驻委托）。

动态委托**一次性**：交付 patches 与「移除该条」的 `set_variable worldFlags.randomEvents.eventCommissions` patch 同一次原子提交——不存在「交付了还能再交」的刷取窗口。静态委托保持可反复交付，两者是刻意的语义差。

## 显示与注入

| 消费面 | 处理 |
|---|---|
| CommissionBoard.vue | 合并清单（动态在前）+ 动态委托带「事件」标记（title 说明交付后即消失） |
| `{{COMMISSIONS}}` 注入（placeholder-registry） | `game-pipeline.commissionDefsForAI()` 供值 = 动态（gameDay 过滤后）+ 静态（同名去重，动态优先）——AI 看得到才会按名立 quest |

## 测试

`event-commission.test.ts` 7 条：模板实例化（def 剥 ttlDays/来源/到期日）、ttlDays 覆盖与取整、currentDay 非法、TTL 边界（10~16 有效 17 过期）、prune 保序、undefined/空兜底、视图转换剥溯源字段。

另修一处真 bug：`eventCommissions` computed 的 `filter(isEventCommissionActive)` 会把数组**索引**当 currentDay 传进去（永远 active）——改为显式 `currentGameDay()` 传参。
