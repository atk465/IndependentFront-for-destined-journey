/**
 * card-fusion.ts — 卡牌工坊确定性融合内核（卡兰大陆世界观 MVP）
 *
 * 设计原则（对齐数据字段规范）：
 * - 纯函数、零 AI 参与：卡牌的 tier / 词条 / 造价 / 评级全部由输入确定性推导。
 * - AI 只负责「叙事」与「提名素材」，绝不生成数字（铁律3）。
 * - 引擎级真数值：造价、相克折扣、评级区间都可单测复现。
 *
 * 融合语义：
 * - 叠加：主素材 + 同类元素副素材 → 同级升华（稳定）
 * - 相生：主副为相生元素对 → 复合出更高级词条，品质 +1，评级「精益求精」
 * - 相克：主副为相克元素对 → 不稳定，造价 ×0.7，基础评级「失败」（仅高骰可救回）
 */

import type { CardTier } from '../field-enums';
import type { CraftRating } from '../types';

/** 素材规格（确定性融合内核的输入；逻辑键=name） */
export interface MaterialSpec {
  name: string;
  /** 售价 GC */
  price: number;
  /** 素材稀有度 1-5（白铁~星辉对齐） */
  tier: number;
  /** 元素标签，用于融合判定（如 ['火']） */
  elements: string[];
}

/** 融合结果（与 types.ts FusionRecipe 对应，此处为纯计算层） */
export interface FusionResult {
  mainMaterial: string;
  subMaterials: string[];
  tier: CardTier;
  fusionKind: '叠加' | '相生' | '相克';
  cost: number;
  rating: CraftRating;
  /** 词条名列表（元素 + 复合产物） */
  词条: string[];
}

/** 品质 → 造价系数 */
export const CARD_TIER_COEFFICIENT: Record<CardTier, number> = {
  白铁: 1.0,
  青铜: 1.6,
  白银: 2.4,
  鎏金: 3.5,
  星辉: 5.0,
};

/** 相克造价折扣 */
export const CLASH_DISCOUNT = 0.7;

const TIER_ORDER: CardTier[] = ['白铁', '青铜', '白银', '鎏金', '星辉'];

/** 素材稀有度 1-5 → 卡牌品质 */
export function materialTierToCardTier(t: number): CardTier {
  const i = Math.max(0, Math.min(TIER_ORDER.length - 1, Math.round(t) - 1));
  return TIER_ORDER[i];
}

function tierIndex(t: CardTier): number {
  return TIER_ORDER.indexOf(t);
}

/** 稳定排序的成对 key（用于查相生/相克表） */
function pairKey(main: MaterialSpec, sub: MaterialSpec): string {
  return [...new Set([...main.elements, ...sub.elements])].sort().join('+');
}

/** 相生表：两元素复合产出更高级词条（key 按 UTF-16 code point 升序，与 pairKey 一致） */
const SYNERGY_TABLE: Record<string, string> = {
  '火+风': '燎原',
  '冰+水': '霜冻',
  '金+雷': '磁暴',
  '光+水': '虹耀',
  '暗+火': '焚影',
};

/** 相克表：冲突元素（key 按 UTF-16 code point 升序，与 pairKey 一致） */
const CLASH_TABLE = new Set<string>(['水+火', '暗+光', '土+风']);

/** 判定融合类型 */
export function classifyFusion(main: MaterialSpec, subs: MaterialSpec[]): '叠加' | '相生' | '相克' {
  if (subs.length === 0) return '叠加';
  // 优先级：同类叠加 > 相生复合 > 相克不稳定 > 中性叠加
  let hasSynergy = false;
  let hasClash = false;
  for (const s of subs) {
    if (s.elements.some((e) => main.elements.includes(e))) return '叠加';
    const key = pairKey(main, s);
    if (SYNERGY_TABLE[key]) hasSynergy = true;
    else if (CLASH_TABLE.has(key)) hasClash = true;
  }
  if (hasSynergy) return '相生';
  if (hasClash) return '相克';
  return '叠加';
}

/** 计算产出品质 */
export function computeTier(
  main: MaterialSpec,
  subs: MaterialSpec[],
  kind: '叠加' | '相生' | '相克',
): CardTier {
  const base = materialTierToCardTier(main.tier);
  if (kind === '相生') {
    const i = Math.min(TIER_ORDER.length - 1, tierIndex(base) + 1);
    return TIER_ORDER[i];
  }
  // 叠加 / 相克 均不升级（相克本就不稳定）
  return base;
}

/** 计算造价（GC） */
export function computeCost(
  main: MaterialSpec,
  subs: MaterialSpec[],
  tier: CardTier,
  kind: '叠加' | '相生' | '相克',
): number {
  const basePrice = main.price + subs.reduce((sum, s) => sum + s.price, 0);
  const coeff = CARD_TIER_COEFFICIENT[tier];
  const discount = kind === '相克' ? CLASH_DISCOUNT : 1;
  return Math.round(basePrice * coeff * discount);
}

/** 基础评级（确定性，由融合类型推导；最终成败由 rollCraftRating 裁定） */
export function expectedRating(kind: '叠加' | '相生' | '相克'): CraftRating {
  switch (kind) {
    case '相生':
      return '精益求精';
    case '相克':
      return '失败';
    case '叠加':
    default:
      return '成功';
  }
}

/** 推导词条（元素 + 复合产物） */
export function deriveEntries(
  main: MaterialSpec,
  subs: MaterialSpec[],
  kind: '叠加' | '相生' | '相克',
): string[] {
  const set = new Set<string>();
  for (const e of main.elements) set.add(e);
  for (const s of subs) for (const e of s.elements) set.add(e);
  if (kind === '相生') {
    for (const s of subs) {
      const product = SYNERGY_TABLE[pairKey(main, s)];
      if (product) set.add(product);
    }
  }
  return [...set];
}

/**
 * 融合主入口：主素材 + 0~2 副素材 → 确定性 FusionResult。
 * 副素材超过 2 个的，只取前 2 个（卡牌规则：1 主 + 0~2 副）。
 */
export function fuse(main: MaterialSpec, subs: MaterialSpec[] = []): FusionResult {
  const usedSubs = subs.slice(0, 2);
  const kind = classifyFusion(main, usedSubs);
  const tier = computeTier(main, usedSubs, kind);
  const cost = computeCost(main, usedSubs, tier, kind);
  const rating = expectedRating(kind);
  const 词条 = deriveEntries(main, usedSubs, kind);
  return {
    mainMaterial: main.name,
    subMaterials: usedSubs.map((s) => s.name),
    tier,
    fusionKind: kind,
    cost,
    rating,
    词条,
  };
}

/**
 * 用一次 d20 掷骰裁定最终制作评级（确定性、可回放）。
 * 相克基础「失败」仅 nat 18-20 可救回为「成功」；其余依阈值下探。
 * 引擎层（craft-gen-chain / dice-tape）调用此函数，不在本模块掷骰。
 */
export function rollCraftRating(base: CraftRating, d20: number): CraftRating {
  const roll = Math.max(1, Math.min(20, Math.floor(d20)));
  switch (base) {
    case '精益求精':
      return roll >= 10 ? '精益求精' : '成功';
    case '成功':
      return roll >= 6 ? '成功' : '失败';
    case '失败':
      return roll >= 18 ? '成功' : '失败';
    case '大失败':
    default:
      return '大失败';
  }
}
