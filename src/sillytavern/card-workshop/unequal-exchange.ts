/**
 * unequal-exchange.ts — 不等价交换（S「不等价交换」）
 *
 * 天赋描述：「你可以将自己的素材和卡牌放弃，天赋会给你带来 1-2 个类型相同，
 * 品质不高于原来的回报。」
 *
 * 口径：
 *  - **素材** → 同稀有度的素材 1~2 份（名字走 `materialNameOf`，与拆解同源）
 *  - **卡牌** → 从内容池按「不高于原档」抽一张（复用 `drawFortuneCard` 的
 *    向下顺延规则：该档为空就往下找，绝不给空手）
 *  - 装备/道具不在交换范围（描述只说素材和卡牌），原样拒绝、**不消耗**
 *
 * 「不等价」体现在**随机**：给几份、抽到哪张都由骰值决定，可能换亏——这正是
 * 天赋描述的字面意思（放弃 = 认了）。
 *
 * 纯度约束：纯函数、不 mutate、随机源由调用方注入。
 */

import type { InventoryItem } from '../types';
import { RARITY_LEVELS, type CardTier, type Rarity } from '../field-enums';
import type { CardCatalogItem } from '../start-catalog-mechanics';
import { cardCatalogToItem } from '../start-catalog-mechanics';
import { drawFortuneCard } from './fortune-draw';
import { materialNameOf } from './card-dismantle';

/** 可交换的物品形状（素材用 rarity、卡牌用 cardTier） */
export type Exchangeable = Pick<InventoryItem, 'name' | 'type'> & {
  rarity?: string;
  cardTier?: CardTier;
};

export interface ExchangePlan {
  /** 被放弃的物品名（调用方 remove_item） */
  sourceName: string;
  /** 换回的回报（调用方逐项 add_item；卡牌是完整 CardItem） */
  gains: InventoryItem[];
  summary: string;
}

export interface ExchangeValidation {
  ok: boolean;
  reason?: string;
}

/**
 * 规划一次不等价交换（纯函数）。
 *
 * @param item 被放弃的物品（素材或卡牌）
 * @param pool 卡池（卡牌交换用；素材交换不需要，可传空数组）
 * @param rng 随机源（默认 Math.random；测试注入固定值）
 * @param maxReturn 最多换回几份（条目 `置换{maxReturn}` 档位；缺省 2，上限 2）
 */
export function planUnequalExchange(
  item: Exchangeable,
  pool: readonly CardCatalogItem[] = [],
  rng: () => number = Math.random,
  maxReturn = 2,
): ExchangeValidation & { plan?: ExchangePlan } {
  const cap = Math.min(2, Math.max(1, Math.round(maxReturn) || 1));
  // 回报份数：1..cap —— 横竖要吃一次随机，可能只给一份（这就是「不等价」）
  const count = 1 + Math.floor(Math.max(0, Math.min(0.999, rng())) * cap);

  if (item.type === '材料') {
    const rarity = (
      (RARITY_LEVELS as readonly string[]).includes(item.rarity ?? '') ? item.rarity : '普通'
    ) as Rarity;
    const name = materialNameOf(rarity);
    return {
      ok: true,
      plan: {
        sourceName: item.name,
        gains: [{ name, quantity: count, type: '材料', rarity } as InventoryItem],
        summary: `放弃【${item.name}】，换回「${name}」×${count}——同类型、同品质，份数看天意。`,
      },
    };
  }

  if (item.type === '卡牌') {
    const picked = drawFortuneCard(pool, item.cardTier ?? '白铁');
    if (!picked) {
      return { ok: false, reason: '命运卡堆是空的（需安装内容包）——暂无可换的卡' };
    }
    const card = cardCatalogToItem(picked);
    return {
      ok: true,
      plan: {
        sourceName: item.name,
        gains: [card as unknown as InventoryItem],
        summary: `放弃【${item.name}】，换回【${card.name}】（${card.cardTier}）——不高于原档，好坏认命。`,
      },
    };
  }

  return { ok: false, reason: `【${item.name}】不在交换范围——只有素材和卡牌可以放弃` };
}
