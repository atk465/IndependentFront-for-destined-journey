/**
 * shop-system.ts — 商店/交易折扣（2026-09-18）
 *
 * 引擎没有独立商店系统——购买行为发生在：
 *  - 命运祭坛掷问（帝冕币/命运点）
 *  - 开局购卡（转生点）
 *  - 未来的 NPC 商店
 *
 * 本模块提供统一的**折扣读取与价格计算**，任何购买流都可消费。
 * 折扣由天赋条目 `交易折扣{discountPct}` 驱动，多条叠加后 clamp 到 0..50
 * （防滚雪球：任何角色组合折扣不超过半价）。
 *
 * 纯度约束：纯函数、不 mutate。
 */

import type { TalentEntry } from './talent-entry';

/** 最大折扣上限（%）：任何角色组合不超过半价 */
export const MAX_DISCOUNT_PCT = 50;

/**
 * 从天赋条目收集交易折扣总和（clamp 到 0..MAX_DISCOUNT_PCT）。
 */
export function shopDiscountOf(
  talents: readonly { entries?: readonly TalentEntry[] }[] | undefined,
): number {
  let total = 0;
  for (const t of talents ?? []) {
    for (const e of t.entries ?? []) {
      if (e.kind !== '交易折扣') continue;
      const v = e.params.discountPct;
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) total += Math.round(v);
    }
  }
  return Math.min(MAX_DISCOUNT_PCT, total);
}

/**
 * 买价计算：原价 × (1 − 折扣%)，下限 1（不白送）。
 */
export function buyPrice(base: number, discountPct: number): number {
  const b = Math.max(0, Math.round(base) || 0);
  const d = Math.max(0, Math.min(MAX_DISCOUNT_PCT, Math.round(discountPct) || 0));
  return Math.max(1, Math.round(b * (1 - d / 100)));
}

/**
 * 卖价计算：原价 × 系数（折旧），下限 1。
 *
 * @param markupPct 卖价占原价的百分比（缺省 50 = 半价回收）
 */
export function sellPrice(base: number, markupPct = 50): number {
  const b = Math.max(0, Math.round(base) || 0);
  const m = Math.max(1, Math.round(markupPct) || 50);
  return Math.max(1, Math.round((b * m) / 100));
}
