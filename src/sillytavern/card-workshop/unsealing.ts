/**
 * unsealing.ts — 启封判定（卡牌工坊 阶段 2）
 *
 * 世界观：卡牌是被封印的有意志的存在。启封高阶卡时封印物会抗拒；
 * 意志对抗失败 → 抗命（哑火 / 暴走 / 反噬）。设计：
 * docs/planning/2026-09-12-card-workshop-phase2-unsealing-design.md
 *
 * 确定性契约（对齐 combat-v3/dice-tape 铁律）：
 * - 零 Math.random / 零时钟：d20 一律由调用方传入。战斗内接线（阶段 5）时
 *   骰值从骰带通道 draw 取得，天然落进既有回放体系。
 * - 🔴 本模块不 import combat-v3/ 任何内部模块（骰带是 internal），只对齐其
 *   「骰值调用方供给」的契约形状。
 * - 纯函数：不 mutate 入参；判定只返回**数据**，暴走/反噬的效果落地由调用方结算。
 */

import type { CardTier } from '../field-enums';

/** 封印 DC 表 —— 稀有度越高越危险（单一真源） */
export const UNSEAL_DC: Record<CardTier, number> = {
  白铁: 8,
  青铜: 11,
  白银: 14,
  鎏金: 17,
  星辉: 20,
};

/** 相克不稳：DC 加值（d20 口径 ≈ 抗命率 +15%，兑现 MVP 设计承诺） */
export const CLASH_DC_BONUS = 3;

/** 启封槽位成本（动作槽数）—— 战斗内接线走 consumeSlot（阶段 5） */
export const UNSEAL_SLOT_COST: Record<CardTier, number> = {
  白铁: 1,
  青铜: 1,
  白银: 1,
  鎏金: 2,
  星辉: 2,
};

/** 启封判定入参（卡牌侧只取判定相关两字段） */
export interface UnsealCardSpec {
  cardTier: CardTier;
  recipe: { fusionKind: '叠加' | '相生' | '相克' };
}

/** 判定结果 —— 纯数据；效果落地（暴走指向己方 / 反噬伤害 / sealed 翻转）由调用方结算 */
export type UnsealOutcome =
  | { kind: '启封'; margin: number }
  | { kind: '哑火'; margin: number }
  | { kind: '暴走'; margin: number }
  | { kind: '反噬'; margin: number };

/** 封印是否破裂（哑火 = 封印扛住，卡保持 sealed；其余三种都破） */
export function sealBreaks(outcome: UnsealOutcome): boolean {
  return outcome.kind !== '哑火';
}

/** 意志修正 = floor((精神-10)/2)（精神 8→-1，10→0，20→+5）；缺省按 10 算 */
export function willModifierOf(attributes: Record<string, number> | undefined): number {
  const spi = attributes?.['spi'];
  const base = typeof spi === 'number' && Number.isFinite(spi) ? spi : 10;
  return Math.floor((base - 10) / 2);
}

/** 这一行的判定难度 */
export function unsealDC(card: UnsealCardSpec): number {
  const dc = UNSEAL_DC[card.cardTier];
  return card.recipe.fusionKind === '相克' ? dc + CLASH_DC_BONUS : dc;
}

/**
 * 意志对抗：margin = (d20 + willMod) - DC，按失败幅度分级抗命。
 * 边界规则：nat 20 自动突破（封印必有裂缝）；nat 1 必定抗命且不劣于哑火。
 */
export function judgeUnseal(card: UnsealCardSpec, d20: number, willMod: number): UnsealOutcome {
  const roll = Math.max(1, Math.min(20, Math.floor(d20)));
  const margin = roll + willMod - unsealDC(card);

  if (roll === 20) return { kind: '启封', margin };
  if (roll === 1) {
    return margin >= -3
      ? { kind: '哑火', margin }
      : margin >= -7
        ? { kind: '暴走', margin }
        : { kind: '反噬', margin };
  }
  if (margin >= 0) return { kind: '启封', margin };
  if (margin >= -3) return { kind: '哑火', margin };
  if (margin >= -7) return { kind: '暴走', margin };
  return { kind: '反噬', margin };
}
