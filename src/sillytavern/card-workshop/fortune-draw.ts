/**
 * fortune-draw.ts — 抽封铭卡（命运祭坛 · 纯 Code 确定性抽卡）
 *
 * canon（抽封铭卡条目）：向底石掷问——你抽到的不是「你想要的」，是底石此刻愿意说的。
 * - 帝冕币掷问（小额）：大概率白铁/青铜，白银有份，鎏金看脸，星辉不出
 * - 命运点掷问（必得中品以上）：白银 60 / 鎏金 30 / 星辉 10
 *
 * 全部纯函数；d100 由调用方（dice.ts）掷出后传入。落库由调用方走
 * add_item（cardCatalogToItem 构造）+ 扣费（money/FP），不走 item_gen。
 */

import { CARD_TIERS, type CardTier } from '../field-enums';
import type { CardCatalogItem } from '../start-catalog-mechanics';

export type FortuneMode = 'coin' | 'fp';

export interface FortuneModeSpec {
  label: string;
  /** 帝冕币消耗（GC） */
  gcCost: number;
  /** 命运点消耗（FP） */
  fpCost: number;
  /** 各品质档权重（按 CARD_TIERS 顺序，d100 百分比） */
  weights: Record<CardTier, number>;
}

export const FORTUNE_MODES: Record<FortuneMode, FortuneModeSpec> = {
  coin: {
    label: '帝冕币掷问',
    gcCost: 50,
    fpCost: 0,
    weights: { 白铁: 40, 青铜: 35, 白银: 20, 鎏金: 5, 星辉: 0 },
  },
  fp: {
    label: '命运点掷问',
    gcCost: 0,
    fpCost: 1,
    weights: { 白铁: 0, 青铜: 0, 白银: 60, 鎏金: 30, 星辉: 10 },
  },
};

/** d100 点数（1-100）→ 品质档（按 CARD_TIERS 顺序累计权重） */
export function rollFortuneTier(mode: FortuneMode, d100: number): CardTier {
  const roll = Math.min(100, Math.max(1, Math.floor(d100)));
  const { weights } = FORTUNE_MODES[mode];
  let acc = 0;
  for (const tier of CARD_TIERS) {
    acc += weights[tier];
    if (roll <= acc) return tier;
  }
  // 权重不满 100 时尾部落到最高非零档
  for (let i = CARD_TIERS.length - 1; i >= 0; i--) {
    if (weights[CARD_TIERS[i]] > 0) return CARD_TIERS[i];
  }
  return CARD_TIERS[0];
}

/**
 * 从卡池按档抽一张：先取该档，空则向下顺延（底石不说没有，只说换个说法）。
 * 池整体为空返回 undefined。
 */
export function drawFortuneCard(
  pool: readonly CardCatalogItem[],
  tier: CardTier,
): CardCatalogItem | undefined {
  let idx = CARD_TIERS.indexOf(tier);
  for (; idx >= 0; idx--) {
    const t = CARD_TIERS[idx];
    const bucket = pool.filter((c) => c.cardTier === t);
    if (bucket.length > 0) {
      return bucket[Math.floor(Math.random() * bucket.length)];
    }
  }
  return undefined;
}
