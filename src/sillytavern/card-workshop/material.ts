/**
 * material.ts — 库存物品 → 融合内核 MaterialSpec 的唯一映射（纯函数）
 *
 * InventoryItem 没有售价/元素字段（那是叙事侧的产出），制台预览按下面的
 * 确定性规则推导，零随机、零 AI：
 * - tier：7 级品质 → 1-5 档素材稀有度（普通=1 … 传说=5；神话/唯一封顶 5）
 * - price：data.price（有限非负数）优先 —— craft/item_gen 叙事侧若有标价就以它为准；
 *   否则按 10 × tier 估价（预览口径，UI 标注为「估价」）
 * - elements：名字 + 效果词条名里命中的元素关键词（全词匹配不可行 —— AI 自由命名，
 *   按字面包含判定，宁可多提示一个元素也不静默漏掉相生/相克）
 */

import type { InventoryItem } from '../types';
import { QUALITY_RANK } from '../types';
import type { MaterialSpec } from './card-fusion';

/** 铭刻纪元九元素（覆盖融合内核相生/相克表用到的全部元素） */
export const ELEMENT_KEYWORDS = ['火', '水', '风', '土', '雷', '光', '暗', '冰', '金'] as const;

/** 品质 → 素材稀有度 1-5（7 级品质的后两档封顶） */
export function itemTierToMaterialTier(item: InventoryItem): number {
  const rank = item.rarity ? QUALITY_RANK[item.rarity] + 1 : 1;
  return Math.min(5, Math.max(1, rank));
}

/** 素材价格：data.price 优先，否则按稀有度估价（GC） */
export function materialPriceOf(item: InventoryItem): number {
  const p = (item.data as Record<string, unknown> | undefined)?.['price'];
  if (typeof p === 'number' && Number.isFinite(p) && p >= 0) return Math.round(p);
  return 10 * itemTierToMaterialTier(item);
}

/** 推导元素标签：名字 + 效果词条名中命中的元素关键词（去重，按 ELEMENT_KEYWORDS 序） */
export function deriveElements(item: InventoryItem): string[] {
  const hay = [item.name ?? '', ...Object.keys(item.effects ?? {})].join(' ');
  return ELEMENT_KEYWORDS.filter((e) => hay.includes(e));
}

/** InventoryItem → 融合内核输入 */
export function toMaterial(item: InventoryItem): MaterialSpec {
  return {
    name: item.name,
    price: materialPriceOf(item),
    tier: itemTierToMaterialTier(item),
    elements: deriveElements(item),
  };
}
