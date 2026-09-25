/**
 * card-smelt.ts — 伙伴卡熔炼与缔约（SSS 天赋「军团熔炉」的机制兑现，2026-09-17）
 *
 * 天赋描述：「通过献祭至少三张伙伴卡，你能将它们的灵魂、天赋和技能糅合成一张全新的、
 * 拥有复数天赋的【集合体】或【神格】卡。这是一条通往人造神祇的禁忌之路。」
 *
 * 两台机制（同一模块，纯函数）：
 * 1. **熔炼**：N 张伙伴卡（召唤卡）→ 1 张集合体卡。
 *    - N=2 称「融合」，N≥3 称「献祭」（对齐天赋描述）
 *    - 产出档位 = 各源最高档 + 1（封顶星辉，溢出不退）
 *    - 产出词条 = 各源各取一个（去重）+「集合体」标记；同名只计一次
 *    - 产出名 = 最高档源名 +「·熔铸」
 * 2. **缔约**：好感 ≥ 契约阈值（70，深厚羁绊）的召唤卡 → 档位跃迁一阶（持久落库）。
 *    这是「契约 = 高好感 + 专属卡高阶形态」的落地（对接首召入库与好感共鸣）。
 *
 * 纯度约束：纯函数、无 I/O；顺序确定性（源序即玩家选择序）。
 */

import type { CardItem } from '../types';
import { CARD_TIERS, type CardTier } from '../field-enums';
import { cardKindOf } from './card-kind';
import { isDamaged } from './repair';
import { ENTRY_STRENGTH_BASELINE } from './talent-entry';

/** 熔炼/融合品阶跃迁档数的基准（条目 `{tierGain}` 未声明时用它 = 参数化前行为） */
const SMELT_TIER_GAIN = ENTRY_STRENGTH_BASELINE.熔炼.tierGain;
/** 缔约好感阈值基准（条目 `熔炼{threshold}` 未声明时用它） */
const CONTRACT_THRESHOLD = ENTRY_STRENGTH_BASELINE.熔炼.threshold;
/** 深渊契约水下加成基准（条目 `深渊契约{percent}` 未声明时用它） */
const ABYSS_PERCENT = ENTRY_STRENGTH_BASELINE.深渊契约.percent;

export interface SmeltValidation {
  ok: boolean;
  reason?: string;
}

export interface SmeltPlan {
  /** 产出卡（调用方 add_item 落库；id 缺省，逻辑键=名字） */
  product: CardItem;
  /** 产出的展示名 */
  productName: string;
  /** 消耗的源卡名（调用方逐张 remove_item） */
  consumed: string[];
  /** 熔炼模式（2 源=融合 / ≥3 源=献祭，与天赋描述口径一致） */
  mode: '融合' | '献祭';
  summary: string;
}

/** 升一阶（封顶星辉，溢出不退） */
function tierUpOf(t: CardTier): CardTier {
  const idx = CARD_TIERS.indexOf(t);
  if (idx < 0) return t;
  return CARD_TIERS[Math.min(idx + 1, CARD_TIERS.length - 1)];
}

/** 升 n 阶（封顶星辉，溢出不退） */
function tierUpBy(t: CardTier, n: number): CardTier {
  let cur = t;
  for (let i = 0; i < Math.max(0, Math.round(n)); i++) cur = tierUpOf(cur);
  return cur;
}

/** 契约好感阈值（基准 70，对齐 affection-system 的「深厚羁绊」） */
export const CONTRACT_AFFECTION_THRESHOLD = CONTRACT_THRESHOLD;

/** 是否为可熔炼的伙伴卡（召唤卡；军团卡是群像，不个体化，不可熔炼） */
export function isSmeltable(card: Pick<CardItem, '词条'>): boolean {
  return cardKindOf(card.词条 ?? []) === '召唤';
}

/**
 * 规划一次熔炼（纯函数）。
 *
 * @param sources 源卡（≥2 张，全部须为召唤/伙伴卡且未损坏）
 * @param tierGain 品阶跃迁档数（条目 `熔炼{tierGain}` 的强度档；缺省 = 基准 1 档）
 */
export function planSmelt(
  sources: readonly CardItem[],
  tierGain: number = SMELT_TIER_GAIN,
): SmeltValidation & { plan?: SmeltPlan } {
  if (sources.length < 2) {
    return { ok: false, reason: '至少需要 2 张伙伴卡（献祭需 ≥3 张）' };
  }
  const names = new Set<string>();
  for (const c of sources) {
    if (!isSmeltable(c)) {
      return { ok: false, reason: `【${c.name}】不是伙伴卡（召唤卡）——熔炼只吃伙伴卡` };
    }
    if (isDamaged(c)) {
      return { ok: false, reason: `【${c.name}】已损坏——先修复或换一张` };
    }
    if (names.has(c.name)) {
      return { ok: false, reason: `同名伙伴卡【${c.name}】不能在同一炉里重复献祭` };
    }
    names.add(c.name);
  }

  // 产出档位：各源最高档 + tierGain（封顶星辉）
  const topTier = sources.reduce<CardTier>((best, c) => {
    const bi = CARD_TIERS.indexOf(best);
    const ci = CARD_TIERS.indexOf(c.cardTier ?? '白铁');
    return ci > bi ? (c.cardTier ?? '白铁') : best;
  }, '白铁');
  const productTier = tierUpBy(topTier, tierGain);

  // 词条：各源各取一个（源序确定性），去重 + 集合体标记
  const entries: string[] = [];
  for (const c of sources) {
    const first = (c.词条 ?? []).find((w) => w && !entries.includes(w));
    if (first) entries.push(first);
  }
  if (!entries.includes('集合体')) entries.push('集合体');

  // 命名：取最高档源的名字
  const topSource = sources.find((c) => (c.cardTier ?? '白铁') === topTier) ?? sources[0];
  const productName = `${topSource.name}·熔铸`;
  const mode: SmeltPlan['mode'] = sources.length >= 3 ? '献祭' : '融合';

  const product: CardItem = {
    name: productName,
    quantity: 1,
    type: '卡牌',
    rarity: '普通',
    cardTier: productTier,
    词条: entries,
    sealed: false,
    recipe: {
      mainMaterial: topSource.name,
      subMaterials: sources.filter((c) => c !== topSource).map((c) => c.name),
      tier: productTier,
      fusionKind: '叠加',
      cost: 0,
      rating: '成功',
    },
  };

  return {
    ok: true,
    plan: {
      product,
      productName,
      consumed: sources.map((c) => c.name),
      mode,
      summary: `${mode} ${sources.length} 张伙伴卡（${sources
        .map((c) => c.name)
        .join('、')}）→ 【${productName}】（${productTier}，词条：${entries.join('、')}）`,
    },
  };
}

/** 缔约计划 */
export interface ContractPlan {
  /** 缔约后的档位（跃迁一阶） */
  newTier: CardTier;
  /** 是否发生跃迁（已是星辉则 false） */
  upgraded: boolean;
  summary: string;
}

/**
 * 规划一次缔约（纯函数）：好感达阈值的召唤卡 → 档位跃迁一阶。
 * 「契约 = 羁绊的婚姻形态」——只有深厚羁绊才够格。
 *
 * @param threshold 好感阈值（条目 `熔炼{threshold}` 的强度档；缺省 = 基准 70）
 */
export function planContract(
  card: Pick<CardItem, 'name' | 'cardTier' | '词条'>,
  affection: number | undefined,
  threshold: number = CONTRACT_THRESHOLD,
): SmeltValidation & { plan?: ContractPlan } {
  if (!isSmeltable(card)) {
    return { ok: false, reason: '只有伙伴卡（召唤卡）可以缔约' };
  }
  if (typeof affection !== 'number' || !Number.isFinite(affection)) {
    return { ok: false, reason: '没有这位伙伴的好感记录——先让故事发生' };
  }
  const need = Math.max(0, Math.round(threshold));
  if (affection < need) {
    return {
      ok: false,
      reason: `羁绊不足（当前 ${Math.round(affection)}，需 ≥${need}）`,
    };
  }
  const before = card.cardTier ?? '白铁';
  const newTier = tierUpOf(before);
  if (newTier === before) {
    return { ok: false, reason: '已是星辉——契约形态封顶' };
  }
  return {
    ok: true,
    plan: {
      newTier,
      upgraded: true,
      summary: `缔结契约【${card.name}】——忠诚的回应：${before} → ${newTier}`,
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// 多卡融合（SSS「万物归一」）——任意三张卡（不论类型）→ 一张全新卡
// ════════════════════════════════════════════════════════════════════
//
// 描述：「你可以将任意三张等级不高于你制卡师等级的卡牌（不论类型）融合成一张全新的、
// 未知的卡牌，新卡牌将继承三张卡牌的部分词条并有概率产生更高级的专属词条。」
//
// 与「熔炼（军团熔炉）」的分工：熔炼只吃伙伴卡（召唤卡）、产出集合体；多卡融合吃任意卡、
// 产出「归一」卡并**额外随机继承一个元素词条**（对应描述里的「更高级专属词条」）。

/** 九元素（专属词条的随机来源，与 material.ts 的元素词汇表同源） */
const ELEMENT_POOL = ['火', '水', '风', '土', '雷', '光', '暗', '冰', '金'] as const;

export interface FusionPlan {
  product: CardItem;
  consumed: string[];
  /** 随机继承到的专属词条（无可用时 undefined） */
  bonusEntry?: string;
  summary: string;
}

/**
 * 规划一次多卡融合（纯函数）。
 *
 * @param sources 源卡（**恰好 3 张**，任意类型，未损坏）
 * @param rng 随机源（默认 Math.random；测试注入固定值）
 * @param tierGain 品阶跃迁档数（条目 `融合{tierGain}` 的强度档；缺省 = 基准 1 档）
 * @param maxTierIndex 允许投入的最高卡档索引（描述：「等级不高于你制卡师等级的卡牌」，
 *   调用方按 `craft-rank.craftTierCeilingIndex` 换算；缺省不限）
 */
export function planMultiFusion(
  sources: readonly CardItem[],
  rng: () => number = Math.random,
  tierGain: number = SMELT_TIER_GAIN,
  maxTierIndex?: number,
): SmeltValidation & { plan?: FusionPlan } {
  if (sources.length !== 3) {
    return { ok: false, reason: '多卡融合需要恰好 3 张卡牌' };
  }
  const names = new Set<string>();
  for (const c of sources) {
    if (isDamaged(c)) return { ok: false, reason: `【${c.name}】已损坏——先修复` };
    if (names.has(c.name)) return { ok: false, reason: `同名卡【${c.name}】不能重复投入` };
    if (maxTierIndex !== undefined) {
      const idx = CARD_TIERS.indexOf(c.cardTier ?? '白铁');
      if (idx > maxTierIndex) {
        return {
          ok: false,
          reason: `【${c.name}】超出可融合档位（当前上限：${CARD_TIERS[maxTierIndex] ?? '?'}）`,
        };
      }
    }
    names.add(c.name);
  }

  const topTier = sources.reduce<CardTier>((best, c) => {
    const bi = CARD_TIERS.indexOf(best);
    const ci = CARD_TIERS.indexOf(c.cardTier ?? '白铁');
    return ci > bi ? (c.cardTier ?? '白铁') : best;
  }, '白铁');
  const productTier = tierUpBy(topTier, tierGain);

  // 继承：各源各取一个词条（源序确定性）
  const entries: string[] = [];
  for (const c of sources) {
    const first = (c.词条 ?? []).find((w) => w && !entries.includes(w));
    if (first) entries.push(first);
  }
  // 专属词条：从九元素里随机取一个尚未继承的（「有概率产生更高级的专属词条」）
  const elementCandidates = ELEMENT_POOL.filter((e) => !entries.includes(e));
  const bonusEntry =
    elementCandidates.length > 0
      ? elementCandidates[Math.floor(rng() * elementCandidates.length)]
      : undefined;
  if (bonusEntry) entries.push(bonusEntry);
  if (!entries.includes('归一')) entries.push('归一');

  const nameBase = sources[0].name;
  const productName = `${nameBase}·归一`;
  const product: CardItem = {
    name: productName,
    quantity: 1,
    type: '卡牌',
    rarity: '普通',
    cardTier: productTier,
    词条: entries,
    sealed: false,
    recipe: {
      mainMaterial: nameBase,
      subMaterials: sources.slice(1).map((c) => c.name),
      tier: productTier,
      fusionKind: '相生',
      cost: 0,
      rating: '成功',
    },
  };

  const parts = [
    `融合 3 张卡（${sources.map((c) => c.name).join('、')}）→ 【${productName}】（${productTier}）`,
  ];
  if (bonusEntry) parts.push(`专属词条【${bonusEntry}】`);
  parts.push(`词条：${entries.join('、')}`);

  return {
    ok: true,
    plan: {
      product,
      consumed: sources.map((c) => c.name),
      ...(bonusEntry ? { bonusEntry } : {}),
      summary: parts.join('，'),
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// 深渊契约（SSS「深渊领主」）：深海巨魔 → 契约伙伴卡
// ════════════════════════════════════════════════════════════════════
//
// 描述：「你可以与深海中任何超过你等级的巨型魔物建立"深渊契约"。契约成功后，
// 该魔物会化为一张特殊的【伙伴卡】，保留其全部深海词条，且自带"深渊压制"被动
// ——在水下环境中，全属性额外提升40%。」
//
// 落地：对一张**召唤卡**缔结深渊契约——要求它是深海系（词条含水/冰），
// 契约后获得「深海」「深渊压制」词条并跃迁一阶（封顶星辉）。

/** 深海系元素（水下环境的判定依据） */
const DEEP_SEA_ELEMENTS: readonly string[] = ['水', '冰'];

export interface AbyssContractPlan {
  /** 契约后的完整词条（含新增） */
  new词条: string[];
  newTier: CardTier;
  upgraded: boolean;
  summary: string;
}

/**
 * 规划一次深渊契约（纯函数）。
 *
 * @param card 目标召唤卡（须为伙伴卡且属深海系：词条含水/冰）
 * @param percent 水下环境全属性加成百分比（条目 `深渊契约{percent}` 的强度档；缺省 = 基准 40）
 */
export function planAbyssContract(
  card: Pick<CardItem, 'name' | 'cardTier' | '词条'>,
  percent: number = ABYSS_PERCENT,
): SmeltValidation & { plan?: AbyssContractPlan } {
  if (!isSmeltable(card)) {
    return { ok: false, reason: '深渊契约只对伙伴卡（召唤卡）可行' };
  }
  const words = Array.isArray(card.词条) ? card.词条 : [];
  if (!words.some((w) => DEEP_SEA_ELEMENTS.includes(w))) {
    return { ok: false, reason: '这不是深海系的魔物——契约只对「水」「冰」之属有效' };
  }
  const added: string[] = [];
  for (const w of ['深海', '深渊压制']) {
    if (!words.includes(w)) added.push(w);
  }
  if (added.length === 0) {
    return { ok: false, reason: '这份契约已经缔结过了' };
  }
  const before = card.cardTier ?? '白铁';
  const newTier = tierUpOf(before);
  const upgraded = newTier !== before;
  return {
    ok: true,
    plan: {
      new词条: [...words, ...added],
      newTier,
      upgraded,
      summary: `深渊契约【${card.name}】——深海的回声应允了：获词条「${added.join('、')}」${
        upgraded ? `，品质 ${before} → ${newTier}` : ''
      }（水下环境全属性 +${Math.max(0, Math.round(percent))}%）`,
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// 肉体改造（SSS「突变巫师」）：改写卡牌形态
// ════════════════════════════════════════════════════════════════════
//
// 描述：「你可以自由自在的操控自己与其他事物的身体，将其改变为任何模样。」
//
// 落地：把一张卡「改造」为指定形态系列——追加一条形态词条（与制卡的形态转化同源），
// 已有同系列词条则为幂等拒绝。自身改造走叙事意图通道（{{NARRATIVE_INTENTS}}）。

export interface ReshapePlan {
  /** 改造后的完整词条 */
  new词条: string[];
  /** 追加的形态词条 */
  added: string;
  summary: string;
}

/**
 * 规划一次卡牌改造（纯函数）。
 *
 * @param card 目标卡（任意类型；素材卡无形态语义，拒绝）
 * @param series 目标形态系列（如「猫娘」「龙娘」「泰坦」）
 */
export function planReshape(
  card: Pick<CardItem, 'name' | '词条'>,
  series: string,
): SmeltValidation & { plan?: ReshapePlan } {
  const target = series.trim();
  if (!target) return { ok: false, reason: '未指定改造形态' };
  const words = Array.isArray(card.词条) ? card.词条 : [];
  if (cardKindOf(words) === '素材') {
    return { ok: false, reason: '素材卡没有形态可言——改造只作用于有实体的卡' };
  }
  if (words.includes(target)) {
    return { ok: false, reason: `【${card.name}】已经是「${target}」形态了` };
  }
  return {
    ok: true,
    plan: {
      new词条: [...words, target],
      added: target,
      summary: `改造【${card.name}】——血肉重塑为「${target}」形态`,
    },
  };
}
