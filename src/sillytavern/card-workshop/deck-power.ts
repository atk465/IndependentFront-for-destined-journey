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
 * 缺品质按白铁兜底，**绝不抛**（一次抛出会打断整个卡册面板渲染）。
 * 交锋拍制：卡牌经验满管转化的 cardPowerBonus 逐点累加（旧存档缺字段按 0）。 */
export function cardPower(card: Pick<CardItem, 'cardTier' | '词条' | 'cardPowerBonus'>): number {
  const words = Array.isArray(card.词条) ? card.词条 : [];
  const synergy = words.filter((w) => SYNERGY_PRODUCTS.has(w)).length;
  const tier = TIER_POWER[card.cardTier] ?? TIER_POWER['白铁'];
  const bonus =
    typeof card.cardPowerBonus === 'number' && Number.isFinite(card.cardPowerBonus)
      ? Math.max(0, Math.round(card.cardPowerBonus))
      : 0;
  return tier + 2 * synergy + bonus;
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

/** deck 战斗化（2026-09-17，主人裁决）：
 *  ① 出卡资格收敛卡组——交锋只能打出编入卡组的卡（背包=收藏，卡组=出战配置）；
 *     卡组为空（未整备）时回退全背包，不惩罚老档。过滤口径与 SkirmishPanel 一致：
 *     排除损坏与未启封。
 *  ② 开战防护加成——guard += ⌊deckPower/3⌋（卡组是你的盾，C' 制互补）。 */

export function battleReadyCards(
  inventory: readonly CardItem[],
  deck: readonly string[],
): CardItem[] {
  const playable = inventory.filter(
    (c) => c.type === '卡牌' && !isSealedCard(c) && !isDamagedCard(c),
  );
  if (deck.length === 0) return playable; // 未整备 → 回退全背包
  const inDeck = new Set(deck);
  return playable.filter((c) => inDeck.has(c.name));
}

function isSealedCard(c: CardItem): boolean {
  return c.sealed === true;
}

function isDamagedCard(c: CardItem): boolean {
  const d = c.data as Record<string, unknown> | undefined;
  return d?.['damaged'] === true;
}

/** 开战防护加成：⌊卡组战力/3⌋（数值口径：12 张均青铜 ≈ +8，每拍减伤 +4——有感不爆炸） */
export function deckGuardBonus(deckPowerTotal: number): number {
  return Math.max(0, Math.floor(deckPowerTotal / 3));
}
