/**
 * affection-bond.ts — 好感共鸣（伙伴卡 × 好感度，卡牌工坊规则层）
 *
 * 裁定（主人 2026-09-16）：伙伴卡接入好感度 —— 打出**召唤/军团卡**（伙伴卡）时，
 * 若好感度账本（SaveProfile.affections，键 = 角色名）里存在**同名角色**的记录，
 * 好感等级决定这张卡的威力与在场效果加成：
 *   好感越高伙伴越卖力（×1.1 ~ ×1.5）；反感及以下消极怠工（×0.8）；中立不加不减。
 *
 * 绑定规则沿用契约召唤的「名字即羁绊」裁定：卡名 = 角色名，零配置。
 *
 * 纯度约束：无 I/O、无 Dexie、无 Vue —— 数值表与乘区全在这里，接线只在 game-pipeline。
 */

import { clampAffection, getAffectionLabel, type AffectionMap } from '../affection-system';

/** 一条共鸣档：好感下限（含）→ 效果乘区 */
export interface BondTier {
  min: number;
  multiplier: number;
}

/**
 * 奖励档（升序；取满足的**最高**档）。
 * 阈值对齐 affection-system 的 11 级标签：10 略有善意 / 30 好感 / 50 友好信任 / 70 深厚羁绊 / 90 誓死追随。
 */
export const BOND_TIERS: readonly BondTier[] = [
  { min: 90, multiplier: 1.5 },
  { min: 70, multiplier: 1.4 },
  { min: 50, multiplier: 1.3 },
  { min: 30, multiplier: 1.2 },
  { min: 10, multiplier: 1.1 },
] as const;

/** 惩罚档：反感（≤ -10）伙伴消极怠工，效果打 8 折（与奖励档互斥） */
const BOND_PENALTY_THRESHOLD = -10;
const BOND_PENALTY_MULTIPLIER = 0.8;

/** 中立乘区（无记录 / -9..9）：不加不减 */
export const BOND_NEUTRAL_MULTIPLIER = 1;

/**
 * 好感度 → 共鸣乘区。
 * 反感及以下（≤ -10）伙伴消极怠工，效果打 8 折；誓死追随（≥ 90）效果 ×1.5；
 * 中立（-9..9）不加不减。
 */
export function bondMultiplier(affection: number): number {
  const a = clampAffection(affection);
  if (a <= BOND_PENALTY_THRESHOLD) return BOND_PENALTY_MULTIPLIER;
  for (const tier of BOND_TIERS) {
    if (a >= tier.min) return tier.multiplier;
  }
  return BOND_NEUTRAL_MULTIPLIER;
}

/** 一条共鸣判定结果；null = 账本里没有同名角色（无羁绊记录，不加不减） */
export interface BondInfo {
  /** 好感度原值（已钳制） */
  affection: number;
  /** 11 级标签（审计行展示用） */
  label: string;
  /** 乘区（bondMultiplier 的结果） */
  multiplier: number;
}

/**
 * 伙伴卡的共鸣判定：卡名即角色名，查好感账本。
 * 无记录 → null（中立，不出审计行 —— 沉默的多数不值得一行字）。
 */
export function bondForCard(
  cardName: string,
  affections: AffectionMap | undefined,
): BondInfo | null {
  const raw = affections?.[cardName];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const affection = clampAffection(raw);
  return {
    affection,
    label: getAffectionLabel(affection),
    multiplier: bondMultiplier(affection),
  };
}

/** 乘区应用：四舍五入取整（交锋数值全整数） */
export function applyBond(value: number, multiplier: number): number {
  return Math.round(value * multiplier);
}
