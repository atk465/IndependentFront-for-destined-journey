/**
 * event-commission.ts — 事件委托的**纯函数叶**（随机事件 × 委托板融合，2026-09-16）
 *
 * 职责：事件触发生成动态委托（`buildEventCommission`）、过期过滤（`pruneEventCommissions`）、
 * 与静态委托的视图合并（`eventCommissionDefs`）。所有 gameDay 都是调用方传入的整数。
 *
 * 不装什么: 任何 I/O、任何 Dexie、任何 AI 措辞。生成时机（事件结算）与交付
 *           （`deliverCommission`）在 state-manager / game-store，本模块只算。
 *
 * 设计要点（融合契约）：
 * - 动态委托**一次性**：交付成功即从存档移除（静态委托可反复交付，这是两者的唯一语义差）。
 * - 过期自动清理：`expiresDay` 过了就不再出现/交付，保洁由 `pruneEventCommissions` 收口。
 * - 名字即逻辑键：与静态委托同名时**动态优先**（事件是「正在发生的事」，覆盖常驻委托）。
 *
 * 纯度约束：无 I/O、无 Dexie、无 Vue。
 */

import type { CommissionDef, EventCommission, EventCommissionTemplate } from './commission';

/** 事件委托缺省有效期（gameDay） */
export const EVENT_COMMISSION_DEFAULT_TTL_DAYS = 7;

/**
 * 事件结算 → 实例化一条动态委托。
 * `currentDay` 非法（非有穷数）时抛不出错就返回 null —— 调用方按「没生成」处理。
 */
export function buildEventCommission(
  template: EventCommissionTemplate,
  sourceEvent: string,
  currentDay: number,
): EventCommission | null {
  if (typeof currentDay !== 'number' || !Number.isFinite(currentDay)) return null;
  const day = Math.floor(currentDay);
  const ttl =
    typeof template.ttlDays === 'number' &&
    Number.isFinite(template.ttlDays) &&
    template.ttlDays > 0
      ? Math.floor(template.ttlDays)
      : EVENT_COMMISSION_DEFAULT_TTL_DAYS;
  const { ttlDays: _ttl, ...def } = template;
  void _ttl;
  return {
    def: { ...def } as CommissionDef,
    sourceEvent,
    armedDay: day,
    expiresDay: day + ttl,
  };
}

/** 动态委托此刻是否仍然有效（expiresDay 当天仍可交付——到期日含当日） */
export function isEventCommissionActive(ec: EventCommission, currentDay: number): boolean {
  if (typeof currentDay !== 'number' || !Number.isFinite(currentDay)) return false;
  return currentDay < ec.expiresDay;
}

/** 保洁：摘掉已过期的动态委托（返回保留下来的；原列表不变） */
export function pruneEventCommissions(
  list: readonly EventCommission[] | undefined,
  currentDay: number,
): EventCommission[] {
  return (list ?? []).filter((ec) => isEventCommissionActive(ec, currentDay));
}

/** 动态委托 → 委托定义视图（交付与注入与静态同形状，下游无需知道来源） */
function eventCommissionToDef(ec: EventCommission): CommissionDef {
  return ec.def;
}

/** 动态委托清单 → 定义视图清单（保序） */
export function eventCommissionDefs(
  list: readonly EventCommission[] | undefined,
  currentDay: number,
): CommissionDef[] {
  return pruneEventCommissions(list, currentDay).map(eventCommissionToDef);
}
