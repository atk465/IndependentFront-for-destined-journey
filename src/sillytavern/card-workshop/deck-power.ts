/**
 * deck-power.ts — 卡组战力（卡牌工坊 阶段 3a，确定性）
 *
 * 委托难度（阶段 3b）按战力定档，战力公式刻意简单且全部可复现：
 * - 每张编入卡：品质权重（白铁 1 … 星辉 5）
 * - 复合词条（相生产物，如 燎原）：每个 +2 —— 元素词条人人都有，复合才是稀缺性
 * 同名多张按编入张数逐张计（卡组里真编两张就是两份战力）；
 * 名字查不到实物的编入位（数据漂移）按 0 计，不炸不猜。
 */

import type { CardTier } from '../field-enums';
import type { CardItem } from '../types';
import { SYNERGY_PRODUCTS } from './card-fusion';

/** 品质 → 战力权重（单一真源） */
export const TIER_POWER: Record<CardTier, number> = {
  白铁: 1,
  青铜: 2,
  白银: 3,
  鎏金: 4,
  星辉: 5,
};

/** 单卡战力。
 * 🔴 2026-09-13 真机：词条/品质都可能缺失（存档数据）——缺词条按无复合词条算、
 * 缺品质按白铁兜底，**绝不抛**（一次抛出会打断整个卡册面板渲染）。 */
export function cardPower(card: Pick<CardItem, 'cardTier' | '词条'>): number {
  const words = Array.isArray(card.词条) ? card.词条 : [];
  const synergy = words.filter((w) => SYNERGY_PRODUCTS.has(w)).length;
  const tier = TIER_POWER[card.cardTier] ?? TIER_POWER['白铁'];
  return tier + 2 * synergy;
}

/** 卡组战力：按编入顺序逐张累加；查不到实物的名字跳过 */
export function deckPower(deck: string[], cardOf: (name: string) => CardItem | undefined): number {
  let total = 0;
  for (const name of deck) {
    const card = cardOf(name);
    if (card) total += cardPower(card);
  }
  return total;
}
