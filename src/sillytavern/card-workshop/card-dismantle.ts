/**
 * card-dismantle.ts — 素材拆解（SSS 天赋「素材之王」的机制兑现，2026-09-17）
 *
 * 天赋描述：「战斗时，你可以主动催动天赋，有概率直接将等级不高于你制卡师等级一级的
 * 敌人拆解为【素材】；在非战斗状态下，你也可以消耗精神力将等级不高于你制卡师等级一级
 * 的无主物品拆解为【素材】。」
 *
 * 本模块实现**非战斗侧**：把背包里的物品（卡牌/装备/道具）拆解为素材（材料）。
 * 战斗侧的「胜利额外素材」由 talent-hooks 的 victoryMaterial 钩子承担（同一天赋的另一半）。
 *
 * 确定性口径：
 * - 卡牌档位 → 材料品质（白铁→普通 / 青铜→优良 / 白银→稀有 / 鎏金→史诗 / 星辉→传说），
 *   产出 2 份；装备/道具按自身品质产出 1 份。
 * - 素材本身（材料）不可再拆——避免无限套娃。
 *
 * 纯度约束：纯函数、无 I/O。
 */

import type { InventoryItem } from '../types';
import { CARD_TIERS, type CardTier, type Rarity } from '../field-enums';

/**
 * 卡牌档位 → 材料品质（5 档映射到 7 级品质的前 5 级，传说封顶）。
 *
 * **单一真源**：拆解、转化（companion-capture）与素材抽奖（material-gacha）共用这一张，
 * 不给同一条映射留第二份副本。
 */
export const TIER_TO_RARITY: Record<CardTier, Rarity> = {
  白铁: '普通',
  青铜: '优良',
  白银: '稀有',
  鎏金: '史诗',
  星辉: '传说',
};

/** 拆解产物：一份材料（模块内部形状；对外经 DismantlePlan.yields 消费） */
interface DismantleYield {
  name: string;
  quantity: number;
  type: '材料';
  rarity: Rarity;
}

export interface DismantlePlan {
  /** 被拆解的物品名（调用方 remove_item） */
  sourceName: string;
  /** 拆解产出（调用方逐项 add_item） */
  yields: DismantleYield[];
  summary: string;
}

export interface DismantleValidation {
  ok: boolean;
  reason?: string;
}

/** 材料名：按品质给通用素材名（内容侧可再命名） */
/** 素材命名（拆解与好运之骰的「材料秘境」共用同一口径，避免两套名字） */
export function materialNameOf(rarity: Rarity): string {
  return `${rarity}素材残片`;
}

/**
 * 规划一次拆解（纯函数）。
 *
 * @param item 待拆解物品
 * @param maxTierIndex 允许拆解的最高卡牌档位索引（调用方按「制卡师等级+1」换算；缺省不限）
 */
export function planDismantle(
  item: InventoryItem,
  maxTierIndex?: number,
): DismantleValidation & { plan?: DismantlePlan } {
  if (item.type === '材料') {
    return { ok: false, reason: '素材不能再拆解（避免无限套娃）' };
  }

  let rarity: Rarity = '普通';
  let copies = 1;
  if (item.type === '卡牌') {
    const tier = ((item as { cardTier?: CardTier }).cardTier ?? '白铁') as CardTier;
    const idx = CARD_TIERS.indexOf(tier);
    if (maxTierIndex !== undefined && idx > maxTierIndex) {
      return {
        ok: false,
        reason: `超出可拆解档位（当前上限：${CARD_TIERS[maxTierIndex] ?? '?'}）`,
      };
    }
    rarity = TIER_TO_RARITY[tier] ?? '普通';
    copies = 2; // 卡牌结构复杂，拆出两份
  } else {
    // 装备/道具：按自身品质
    rarity = (item.rarity as Rarity) ?? '普通';
  }

  const yields: DismantleYield[] = [
    { name: materialNameOf(rarity), quantity: copies, type: '材料', rarity },
  ];
  return {
    ok: true,
    plan: {
      sourceName: item.name,
      yields,
      summary: `拆解【${item.name}】→ ${yields.map((y) => `${y.name}×${y.quantity}`).join('、')}`,
    },
  };
}
