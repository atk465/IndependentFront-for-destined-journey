/**
 * battle-rules.ts — 战斗规则改写（2026-09-17）
 *
 * 三条天赋改的不是数值而是**规则本身**，所以集中在这里：
 *  - **惰性**（S「懒惰天才」）：带回「懒惰」印记的生物卡，拍内按概率摸鱼跳过行动，
 *    但只要行动就暴击/效果翻倍。
 *  - **双生羁绊**（S「双生羁绊」）：两张结成羁绊的伙伴卡先后打出时触发**组合技**。
 *  - **决斗**（S「西部决斗礼仪」）：整场禁用在场的召唤/军团卡，
 *    并抑制场地持续伤害与治疗（「双方均无法使用伙伴卡，且免疫一切外部伤害与治疗」）。
 *
 * 三条都是**纯函数 + 显式输入**：拍内掷骰由调用方传入（与 skirmish 同一条零随机铁律）。
 *
 * 纯度约束：纯函数、不 mutate。
 */

import type { CardItem } from '../types';
import { cardKindOf } from './card-kind';

/** 懒惰印记词条名（制卡时打在卡上；内容侧可再命名） */
export const LAZY_ENTRY = '懒惰';

/** 双生羁绊词条名（缔结羁绊时打在两张卡上） */
export const TWIN_ENTRY = '双生';

// ════════════════════════════════════════════════════════════════════
// 惰性（懒惰天才）
// ════════════════════════════════════════════════════════════════════

export interface LazyCardEntry {
  skipPct: number;
  critMult: number;
}

/** 这张卡是否带懒惰印记（词条即单一真源） */
export function isLazyCard(card: Pick<CardItem, '词条'>): boolean {
  return (card.词条 ?? []).includes(LAZY_ENTRY);
}

export type LazyOutcome =
  | { kind: '摸鱼'; power: 0; note: string }
  | { kind: '暴击'; power: number; note: string }
  | { kind: '正常'; power: number; note: string };

/**
 * 懒惰卡的拍内裁定（纯函数）。
 *
 * @param basePower 该卡原本的行动值
 * @param d100 掷骰（1..100，调用方传入）
 * @param spec 条目的档位（skipPct / critMult）；缺省 = 50% / ×2
 */
export function resolveLazyCard(
  card: Pick<CardItem, 'name' | '词条'>,
  basePower: number,
  d100: number,
  spec: LazyCardEntry = { skipPct: 50, critMult: 2 },
): LazyOutcome {
  if (!isLazyCard(card)) {
    return { kind: '正常', power: basePower, note: '' };
  }
  const roll = Number.isFinite(d100) ? Math.max(1, Math.min(100, Math.floor(d100))) : 100;
  const skip = Math.max(0, Math.min(100, Math.round(spec.skipPct)));
  if (roll <= skip) {
    return {
      kind: '摸鱼',
      power: 0,
      note: `【懒惰】${card.name} 摸鱼了——这一拍它什么都没做（d100=${roll} ≤ ${skip}）`,
    };
  }
  const mult = spec.critMult > 0 ? spec.critMult : 2;
  return {
    kind: '暴击',
    power: Math.round(basePower * mult),
    note: `【懒惰】它总算动了一下——行动值 ×${mult}（d100=${roll} > ${skip}）`,
  };
}

// ════════════════════════════════════════════════════════════════════
// 双生羁绊（组合技）
// ════════════════════════════════════════════════════════════════════

/** 一对羁绊（卡名无序） */
export interface TwinBond {
  a: string;
  b: string;
}

/** 宽读：从存档里取出羁绊表（脏值丢弃，绝不抛） */
export function coerceTwinBonds(raw: unknown): TwinBond[] {
  if (!Array.isArray(raw)) return [];
  const out: TwinBond[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { a, b } = item as Partial<TwinBond>;
    if (typeof a !== 'string' || typeof b !== 'string' || !a.trim() || !b.trim() || a === b)
      continue;
    out.push({ a: a.trim(), b: b.trim() });
  }
  return out;
}

/** 这两张卡是不是一对（无序比较） */
export function areTwins(bonds: readonly TwinBond[], x: string, y: string): boolean {
  return bonds.some((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
}

/** 找 name 的羁绊对象（没有则 undefined） */
export function twinOf(bonds: readonly TwinBond[], name: string): string | undefined {
  for (const p of bonds) {
    if (p.a === name) return p.b;
    if (p.b === name) return p.a;
  }
  return undefined;
}

/**
 * 组合技判定（纯函数）：本拍打出的卡是伙伴卡、且它的双生**本场已经打出过** → 触发。
 *
 * 口径：**先后打出**即触发（不要求同拍）——「她们共享感官」，一个动另一个就应。
 * 每场每对只触发一次（由 `comboUsed` 账本去重；调用方传 `alreadyFired`）。
 */
export function resolveTwinCombo(input: {
  card: Pick<CardItem, 'name' | '词条'>;
  bonds: readonly TwinBond[];
  playedCards: readonly string[];
  alreadyFired: boolean;
  comboMult?: number;
}): { fired: boolean; power: number; note: string } {
  const { card, bonds, playedCards, alreadyFired } = input;
  if (alreadyFired) return { fired: false, power: 0, note: '' };
  if (cardKindOf(card.词条) !== '召唤') return { fired: false, power: 0, note: '' };
  const twin = twinOf(bonds, card.name);
  if (!twin || !playedCards.includes(twin)) return { fired: false, power: 0, note: '' };
  const mult = input.comboMult && input.comboMult > 1 ? input.comboMult : 2;
  return {
    fired: true,
    power: mult,
    note: `【双生羁绊】${card.name} 与 ${twin} 同频——组合技发动（行动值 ×${mult}）`,
  };
}

// ════════════════════════════════════════════════════════════════════
// 决斗（西部决斗礼仪）
// ════════════════════════════════════════════════════════════════════

/** 决斗规则：本场生效的两条改写 */
export interface DuelRules {
  /** 禁用在场伙伴卡（召唤/军团） */
  noCompanion: boolean;
}

/** 决斗中这张卡能不能打（伙伴卡不在场） */
export function duelBlocksCard(
  card: Pick<CardItem, 'name' | '词条'>,
  rules: DuelRules | undefined,
): { blocked: boolean; reason?: string } {
  if (!rules?.noCompanion) return { blocked: false };
  const kind = cardKindOf(card.词条);
  if (kind === '召唤' || kind === '军团') {
    return {
      blocked: true,
      reason: `【决斗】1v1 之中不容第三人插手——【${card.name}】不能上场`,
    };
  }
  return { blocked: false };
}

/** 决斗中该在场效果要不要结算（抑制外部的持续伤害与治疗） */
export function duelSuppressesEffect(type: string, rules: DuelRules | undefined): boolean {
  if (!rules) return false;
  // 「免疫一切外部伤害与治疗」：场地/第三方的持续伤害与治疗在决斗里不成立
  return type === 'dot' || type === 'regen';
}
