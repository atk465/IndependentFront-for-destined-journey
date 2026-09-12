/**
 * craft-card.ts — 制卡桥（卡牌工坊 阶段 3b）：craft 链 → 确定性 CardItem
 *
 * 「制卡」行业走既有 craft 链（<craft_request> marker / craft_settle 工具），
 * 但产物不是泛用物品而是 CardItem —— 且 tier / 词条 / 造价 / 封印全部由
 * 融合内核（fuse）确定性组装，AI 只负责两件叙事事：**提名素材、给卡起名**
 * （ADR-11：数值归 Code；铁律3：AI 填叙事字段，Code 补账务字段）。
 *
 * 材料名单来自 craftParams.materials（AI 抄写的素材名，顿号/逗号/分号/换行
 * 分隔），由调用方解析后对照背包解析成 MaterialSpec（material.ts），本模块
 * 保持纯函数：查不到的素材名静默跳过 —— 宁可产出一张元素少点的卡，
 * 也不让一次拼写失误炸掉整条制作链。
 */

import { CARD_TIERS, type CardTier } from '../field-enums';
import type { CardItem, CraftRating, InventoryItem, QualityLevel } from '../types';
import { fuse, type MaterialSpec } from './card-fusion';
import { toMaterial } from './material';

/** 高阶卡起才有封印物（types.ts CardItem.sealed：「高阶卡封印物」）——鎏金/星辉 */
export function isHighTierCard(tier: CardTier): boolean {
  return CARD_TIERS.indexOf(tier) >= CARD_TIERS.indexOf('鎏金');
}

/** 解析 craftParams.materials 名单：顿号/逗号/分号/换行分隔；首个为主素材 */
export function parseMaterialNames(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[、,，;；\n\r]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 背包 → 素材规格（按名单顺序解析；查不到的跳过，主素材缺失由 buildCardItem 兜底） */
export function resolveMaterialSpecs(names: string[], inventory: InventoryItem[]): MaterialSpec[] {
  const specs: MaterialSpec[] = [];
  for (const name of names) {
    const item = inventory.find((i) => i.name === name);
    if (item) specs.push(toMaterial(item));
  }
  return specs;
}

export interface BuildCardItemInput {
  /** 卡名（AI 叙事面） */
  productName: string;
  description?: string;
  quantity: number;
  /** craft 链评级品质 → 7 级 rarity（展示面）；不影响卡牌 tier/词条/造价 */
  quality: QualityLevel;
  /** craft 链实际评级（DC+骰带裁定）→ recipe.rating */
  rating: CraftRating;
  /** 已解析素材规格：首个主素材，其余为副素材（fuse 只取前 2 副） */
  materialSpecs: MaterialSpec[];
}

/** 由融合内核确定性组装一张卡（纯函数） */
export function buildCardItem(input: BuildCardItemInput): CardItem {
  const main = input.materialSpecs[0] ?? {
    name: input.productName,
    price: 0,
    tier: 1,
    elements: [],
  };
  const result = fuse(main, input.materialSpecs.slice(1));
  return {
    name: input.productName,
    description: input.description,
    quantity: Math.max(1, Math.floor(input.quantity) || 1),
    type: '卡牌',
    rarity: input.quality,
    cardTier: result.tier,
    词条: result.词条,
    recipe: {
      mainMaterial: result.mainMaterial,
      subMaterials: result.subMaterials,
      tier: result.tier,
      fusionKind: result.fusionKind,
      cost: result.cost,
      rating: input.rating,
    },
    sealed: isHighTierCard(result.tier),
  };
}
