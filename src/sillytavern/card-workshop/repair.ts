/**
 * repair.ts — 修复系统（卡牌工坊 可玩闭环 · 契约召唤 C' 制）
 *
 * 共识裁定（playable-loop 设计 §2 分支 3）：
 * - 伙伴本体永远安全，损伤由卡片承载：伙伴被打倒（HP 归零）→ 卡损坏（data.damaged）
 * - 修复双轨制：**档定模板素材直修必成功**（无检定）；**模板外额外素材强化**
 *   （修复同时强化，永不阻断修复）
 * - 强化词条制：额外素材 → 元素并入 + 相生复合（复用融合内核语义，Code 全程推导）
 * - 品质跃迁：素材品质 **高于** 卡品质 → 卡升一档（一次一档，溢出浪费）+
 *   属性包（世界内持久成长，角色 tier 同一次提交双写）+ 词条槽随档解锁
 * - 修复不加形态词条（类型出厂定死，问题 20 附带披露）
 *
 * 全部纯函数；落库由调用方走 commitChatState（update_item + remove_item + update_character）。
 */

import { CARD_TIERS, type CardTier } from '../field-enums';
import type { CardItem, InventoryItem } from '../types';
import { synergyProduct } from './card-fusion';
import { cardKindOf } from './card-kind';
import { deriveElements, itemTierToMaterialTier } from './material';

/** 损坏标记（CardItem.data 内的键；data 是物品自由扩展区） */
export const DAMAGED_FLAG = 'damaged';

/** 这张卡是否损坏 */
export function isDamaged(card: Pick<CardItem, 'data'>): boolean {
  return (card.data as Record<string, unknown> | undefined)?.[DAMAGED_FLAG] === true;
}

/** 修复配方表（品质档 → 模板需求）——结构定案，数值为初稿待主人终审（数值总表） */
export interface RepairRecipe {
  /** 模板素材数量 */
  materialCount: number;
  /** 模板素材的最低素材稀有度（1-5，material.ts 的 tier 口径） */
  minMaterialTier: number;
}

export const REPAIR_RECIPE: Record<CardTier, RepairRecipe> = {
  白铁: { materialCount: 2, minMaterialTier: 1 },
  青铜: { materialCount: 3, minMaterialTier: 1 },
  白银: { materialCount: 4, minMaterialTier: 2 },
  鎏金: { materialCount: 5, minMaterialTier: 3 },
  星辉: { materialCount: 6, minMaterialTier: 4 },
};

/** 品质跃迁属性包（每次升一档的增量；五维各 +1 初稿，数值总表待调） */
export const UPGRADE_ATTRIBUTE_DELTA: Record<string, number> = {
  str: 1,
  dex: 1,
  con: 1,
  int: 1,
  spi: 1,
};

/** 修复校验结果 */
export interface RepairValidation {
  ok: boolean;
  reason?: string;
}

/** 校验模板素材是否够修复一张该品质的损坏卡 */
export function validateRepairMaterials(
  cardTier: CardTier,
  materials: InventoryItem[],
): RepairValidation {
  const recipe = REPAIR_RECIPE[cardTier];
  if (materials.length < recipe.materialCount) {
    return {
      ok: false,
      reason: `素材不足：需要 ${recipe.materialCount} 份稀有度 ≥${recipe.minMaterialTier} 的素材`,
    };
  }
  const weak = materials.filter((m) => itemTierToMaterialTier(m) < recipe.minMaterialTier);
  if (weak.length > 0) {
    return {
      ok: false,
      reason: `有 ${weak.length} 份素材稀有度不足（需 ≥${recipe.minMaterialTier}）`,
    };
  }
  return { ok: true };
}

/** 强化：素材元素并入（去重）+ 相生复合（复用融合内核真源）；返回新词条与新增列表 */
function mergeStrengthen词条(
  词条: string[],
  materials: InventoryItem[],
): { 词条: string[]; added: string[] } {
  const next = [...词条];
  const added: string[] = [];
  for (const m of materials) {
    for (const e of deriveElements(m)) {
      if (!next.includes(e)) {
        next.push(e);
        added.push(e);
      }
    }
  }
  for (const newWord of [...added]) {
    for (const existing of next) {
      if (added.includes(existing)) continue;
      const product = synergyProduct(newWord, existing);
      if (product && !next.includes(product)) {
        next.push(product);
        added.push(product);
      }
    }
  }
  return { 词条: next, added };
}

/** 品质跃迁判定：素材最高档高于卡品质档 → 升一档（一次一档，溢出浪费） */
function tierUpgradeOf(
  cardTier: CardTier,
  materials: InventoryItem[],
): { upgraded: boolean; newTier: CardTier } {
  const maxExtraTier = materials.reduce((max, m) => Math.max(max, itemTierToMaterialTier(m)), 0);
  const tierIdx = CARD_TIERS.indexOf(cardTier);
  const materialIdx = Math.min(CARD_TIERS.length - 1, Math.max(0, maxExtraTier - 1));
  if (materialIdx > tierIdx && tierIdx < CARD_TIERS.length - 1) {
    return { upgraded: true, newTier: CARD_TIERS[tierIdx + 1] };
  }
  return { upgraded: false, newTier: cardTier };
}

/** 修复 + 强化计划（纯计算，不落库） */
export interface RepairPlan {
  /** 修复后卡的数据补丁（damaged 清除；调用方与 cardTier 一起 update_item） */
  cardData: Record<string, unknown>;
  /** 跃迁后的卡牌品质（未跃迁 = 原品质；跃迁时调用方把 cardTier 一起 update_item） */
  newTier: CardTier;
  /** 是否发生品质跃迁（调用方需同步角色 tier + 属性包，一次提交双写） */
  upgraded: boolean;
  /** 强化新增词条（元素并入 + 相生复合；可空） */
  new词条: string[];
  /** 跃迁属性包（世界内持久成长；更新角色 attributes 用） */
  attributeDelta: Record<string, number>;
  /** 强化说明（卡面/叙事用） */
  summary: string;
}

/**
 * 规划一次修复 + 强化（纯函数）。
 *
 * @param card 损坏的战斗卡（素材卡无修复意义，isRepairable 先判）
 * @param templateMaterials 模板素材（只承担修复）
 * @param extraMaterials 额外素材（强化：元素并入 + 相生复合；品质高于卡则跃迁）
 */
export function planRepair(
  card: Pick<CardItem, 'name' | 'cardTier' | '词条'>,
  templateMaterials: InventoryItem[],
  extraMaterials: InventoryItem[],
): RepairValidation & { plan: RepairPlan } {
  const validation = validateRepairMaterials(card.cardTier, templateMaterials);
  const base: RepairPlan = {
    cardData: { [DAMAGED_FLAG]: false },
    newTier: card.cardTier,
    upgraded: false,
    new词条: [],
    attributeDelta: {},
    summary: `修复【${card.name}】`,
  };
  if (!validation.ok) return { ok: false, reason: validation.reason, plan: base };

  // 强化：额外素材的元素并入（去重）+ 相生复合（素材元素 × 卡面元素查融合内核真源）
  const strengthened = mergeStrengthen词条(card.词条, extraMaterials);
  const plan: RepairPlan = { ...base, new词条: strengthened.added };

  // 品质跃迁：额外素材最高稀有度 > 卡品质档 → 升一档（一次一档，溢出浪费）
  const jump = tierUpgradeOf(card.cardTier, extraMaterials);
  if (jump.upgraded) {
    plan.upgraded = true;
    plan.newTier = jump.newTier;
    plan.attributeDelta = { ...UPGRADE_ATTRIBUTE_DELTA };
    plan.summary = `修复【${card.name}】并以高品素材淬炼——品质跃迁 ${card.cardTier} → ${plan.newTier}`;
    if (strengthened.added.length > 0)
      plan.summary += `，新增词条：${strengthened.added.join('、')}`;
  } else if (strengthened.added.length > 0) {
    plan.summary = `修复【${card.name}】，词条强化：${strengthened.added.join('、')}`;
  }
  return { ok: true, plan };
}

/** 淬炼计划（纯计算，不落库）：健康卡的词条强化与品质跃迁 */
export interface QuenchPlan {
  /** 淬炼后的完整词条（调用方整体 update_item） */
  new词条: string[];
  /** 跃迁后的卡牌品质（未跃迁 = 原品质） */
  newTier: CardTier;
  /** 是否发生品质跃迁（调用方需同步角色 tier + 属性包，一次提交双写） */
  upgraded: boolean;
  /** 跃迁属性包（世界内持久成长；更新角色 attributes 用） */
  attributeDelta: Record<string, number>;
  /** 淬炼说明（卡面/叙事用） */
  summary: string;
}

/**
 * 规划一次淬炼（健康卡 + 素材 → 词条强化/品质跃迁；纯函数）。
 *
 * 与 planRepair 共享强化/跃迁内核，但没有修复语义：不需要模板配额、不检定必成，
 * 卡也不必处于损坏态。素材卡不能淬炼（它们是材料载体）。
 *
 * @param card 健康的战斗卡（素材卡无淬炼意义，调用方先以 cardKindOf 排除）
 * @param materials 消耗的素材（≥1；元素并入 + 相生复合；品质高于卡则跃迁）
 */
export function planQuench(
  card: Pick<CardItem, 'name' | 'cardTier' | '词条'>,
  materials: InventoryItem[],
): RepairValidation & { plan: QuenchPlan } {
  const base: QuenchPlan = {
    new词条: [...card.词条],
    newTier: card.cardTier,
    upgraded: false,
    attributeDelta: {},
    summary: `淬炼【${card.name}】`,
  };
  if (materials.length === 0) {
    return { ok: false, reason: '至少需要 1 份素材', plan: base };
  }
  const strengthened = mergeStrengthen词条(card.词条, materials);
  const jump = tierUpgradeOf(card.cardTier, materials);
  const plan: QuenchPlan = {
    new词条: strengthened.词条,
    newTier: jump.newTier,
    upgraded: jump.upgraded,
    attributeDelta: jump.upgraded ? { ...UPGRADE_ATTRIBUTE_DELTA } : {},
    summary: '',
  };
  if (jump.upgraded) {
    plan.summary = `以高品素材淬炼【${card.name}】——品质跃迁 ${card.cardTier} → ${plan.newTier}`;
  } else {
    plan.summary = `淬炼【${card.name}】`;
  }
  if (strengthened.added.length > 0) {
    plan.summary += `，词条强化：${strengthened.added.join('、')}`;
  } else if (!jump.upgraded) {
    return {
      ok: false,
      reason: '素材没有带来新的元素或相生变化，也无更高品质——这次淬炼不会有任何效果',
      plan,
    };
  }
  return { ok: true, plan };
}

/** 类型守卫：只有可打出的战斗卡才谈修复（素材卡是材料载体，损坏即弃） */
export function isRepairable(card: Pick<CardItem, '词条' | 'data'>): boolean {
  return cardKindOf(card.词条) !== '素材' && isDamaged(card);
}
