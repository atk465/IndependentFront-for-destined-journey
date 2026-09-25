/**
 * card-devour.ts — 卡牌吞噬（SSS 天赋「吞噬一切」的机制兑现，2026-09-17）
 *
 * 天赋描述：「你的卡牌均带有【吞噬】词条，可以直接吞噬等级不高于你制卡师等级一级的
 * 【卡牌】或【素材】成长，在吸收其所有基础属性的同时，还会随机吸收被吞噬者的一个【词条】。」
 *
 * 本模块把「基础属性」映射到引擎既有的卡牌成长模型：
 *   - 燃料（卡牌/素材）折算为经验增益 → 目标卡 cardExp 满管转 cardPowerBonus（战力）
 *     （复用 skirmish.applyCardExp，与交锋经验同一套满管规则）
 *   - 随机吸收燃料的一个词条并入目标卡（去重；只吸收目标没有的）
 * 燃料被消耗（remove_item），目标卡更新（update_item）。
 *
 * 纯度约束：纯函数、无 I/O；随机源由调用方注入（默认 Math.random），便于测试确定性。
 */

import type { CardItem, InventoryItem } from '../types';
import { CARD_TIERS, type CardTier } from '../field-enums';
import { CARD_EXP_CAP, growCardByRawExp } from './skirmish';
import { cardPower } from './deck-power';
import { isDamaged } from './repair';

/** 吞噬结果 */
export interface DevourPlan {
  /** 目标卡成长后的经验（未满管余数） */
  cardExp: number;
  /** 目标卡成长后的战力加成 */
  cardPowerBonus: number;
  /** 本次满管转化的战力点数（审计行展示） */
  powerUps: number;
  /** 随机吸收到的词条（无可用词条时 undefined） */
  absorbedEntry?: string;
  /** 目标卡最终词条（含吸收） */
  new词条: string[];
  /** 燃料被消耗后的名称（调用方 remove_item 用） */
  fuelName: string;
  summary: string;
}

export interface DevourValidation {
  ok: boolean;
  reason?: string;
}

/** 档位索引（燃料档位越高，经验增益越大） */
function tierIndex(t: CardTier): number {
  return Math.max(0, CARD_TIERS.indexOf(t));
}

/**
 * 燃料折算的经验增益。
 * 口径：燃料档位越高给得越多（白铁 1 管 / 青铜 1.5 管 / 白银 2 管 / 鎏金 3 管 / 星辉 4 管），
 * 素材（材料）按等价白铁一管折算——素材是可用素材，吞素材是「贱用」，但兼容。
 */
export function devourExpGain(fuel: Pick<CardItem, 'cardTier'>, isMaterial: boolean): number {
  if (isMaterial) return CARD_EXP_CAP['白铁'];
  const mults = [1, 1.5, 2, 3, 4];
  const idx = tierIndex(fuel.cardTier ?? '白铁');
  const cap = CARD_EXP_CAP[fuel.cardTier ?? '白铁'] ?? CARD_EXP_CAP['白铁'];
  return Math.round(cap * (mults[idx] ?? 1));
}

/**
 * 规划一次吞噬（纯函数）。
 *
 * @param target 目标卡（被打出/成长的那张）
 * @param fuel 燃料（一张卡或一件素材）
 * @param rng 随机源（默认 Math.random；测试注入固定值）
 * @param maxTierIndex 允许吞噬的最高燃料档位索引（调用方按「制卡师等级+1」换算；缺省不限）
 */
export function planDevour(
  target: Pick<CardItem, 'name' | 'cardTier' | '词条' | 'cardExp' | 'cardPowerBonus'>,
  fuel: InventoryItem,
  rng: () => number = Math.random,
  maxTierIndex?: number,
): DevourValidation & { plan?: DevourPlan } {
  if (fuel.type === '卡牌' && fuel.name === target.name) {
    return { ok: false, reason: '不能吞噬自己' };
  }
  const isCard = fuel.type === '卡牌';
  const isMaterial = fuel.type === '材料';
  if (!isCard && !isMaterial) {
    return { ok: false, reason: '燃料必须是卡牌或素材（材料）' };
  }
  if (isCard && isDamaged(fuel as CardItem)) {
    return { ok: false, reason: '损坏的卡不能作为燃料（先修复）' };
  }
  if (isCard && maxTierIndex !== undefined) {
    const fuelIdx = tierIndex((fuel as CardItem).cardTier ?? '白铁');
    if (fuelIdx > maxTierIndex) {
      return {
        ok: false,
        reason: `燃料档位高于可吞噬上限（${CARD_TIERS[maxTierIndex] ?? '?'}）`,
      };
    }
  }

  const gain = devourExpGain(fuel as CardItem, isMaterial);
  // 走无分成内核：吞噬吃进燃料的全部经验（不适用「参战卡 50% 分成」的交战规则）
  const grown = growCardByRawExp(
    { cardTier: target.cardTier, cardExp: target.cardExp, cardPowerBonus: target.cardPowerBonus },
    gain,
  );

  // 词条吸收：只在燃料是卡牌时（素材无词条）；从目标没有的词条里随机一个
  const targetEntries = Array.isArray(target.词条) ? target.词条 : [];
  const fuelEntries = isCard ? ((fuel as CardItem).词条 ?? []) : [];
  const candidates = fuelEntries.filter((w) => w && !targetEntries.includes(w));
  const absorbedEntry =
    candidates.length > 0 ? candidates[Math.floor(rng() * candidates.length)] : undefined;
  const new词条 = absorbedEntry ? [...targetEntries, absorbedEntry] : [...targetEntries];

  const parts: string[] = [`吞噬【${fuel.name}】`];
  if (grown.powerUps > 0) parts.push(`战力 +${grown.powerUps}`);
  if (absorbedEntry) parts.push(`吸收词条【${absorbedEntry}】`);
  if (grown.powerUps === 0 && !absorbedEntry) parts.push('经验累积，暂无跃升');

  return {
    ok: true,
    plan: {
      cardExp: grown.cardExp,
      cardPowerBonus: grown.cardPowerBonus,
      powerUps: grown.powerUps,
      ...(absorbedEntry ? { absorbedEntry } : {}),
      new词条,
      fuelName: fuel.name,
      summary: `${parts.join('，')}——目标【${target.name}】当前战力 ${cardPower({
        cardTier: target.cardTier,
        词条: new词条,
        cardPowerBonus: grown.cardPowerBonus,
      })}。`,
    },
  };
}
