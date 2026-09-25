/**
 * companion-capture.ts — 伙伴卡生成通道（2026-09-17）
 *
 * 一次实现四条 SSS 的底层机制：把**一次遭遇的产物**转化为伙伴卡。
 * - 「你是我的了」：战胜后将敌人**捕获**为伙伴卡
 * - 「种付支配」/「神孕之屌」：两张伙伴卡为双亲**孕育**子嗣卡（继承双亲词条）
 * - 「变肉便器吧」：把一张伙伴卡**转化**——词条兑成素材，卡退场
 *
 * 三条通道共用同一套确定性口径：卡 = 召唤卡（`词条` 含「召唤」），
 * 实体化由调用方复用 `companion.ts` 的 `buildSummonCompanion`（首召入库同源）。
 *
 * 纯度约束：纯函数、无 I/O；随机源由调用方注入（测试可确定）。
 */

import type { CardItem } from '../types';
import { CARD_TIERS, type CardTier, type Rarity } from '../field-enums';
import { cardKindOf } from './card-kind';
import { TIER_TO_RARITY } from './card-dismantle';
import { isDamaged } from './repair';
import { ENTRY_STRENGTH_BASELINE } from './talent-entry';

/** 捕获等级差上限的基准（条目 `捕获{levelBonus}` 未声明时用它 = 参数化前行为） */
const CAPTURE_LEVEL_BONUS = ENTRY_STRENGTH_BASELINE.捕获.levelBonus;

/** 等级 → 卡档（与 tier-constants 的 7 层级不同：这是**卡**的五档） */
export function tierForLevel(level: number): CardTier {
  const lv = Math.max(1, Math.round(level) || 1);
  if (lv <= 4) return '白铁';
  if (lv <= 8) return '青铜';
  if (lv <= 12) return '白银';
  if (lv <= 16) return '鎏金';
  return '星辉';
}

const ELEMENT_POOL = ['火', '水', '风', '土', '雷', '光', '暗', '冰', '金'] as const;

export interface CaptureValidation {
  ok: boolean;
  reason?: string;
}

// ════════════════════════════════════════════════════════════════════
// ① 捕获敌人（SSS「你是我的了」）
// ════════════════════════════════════════════════════════════════════

export interface CapturePlan {
  /** 产出的伙伴卡（调用方 add_item + 实体化 add_character） */
  card: CardItem;
  /** 捕获条件摘要（审计行） */
  summary: string;
}

/**
 * 规划一次捕获（纯函数）。
 *
 * 条件（对齐天赋「有概率将等级高于你一级内的敌人变成伙伴卡」）：
 * 敌人等级 ≤ 玩家等级 + levelBonus（越级太多者捕获不住）；已捕获过同名者由调用方去重。
 *
 * @param levelBonus 可捕获的等级差上限（条目 `捕获{levelBonus}` 的强度档；缺省 = 基准 +1）
 */
export function planCaptureEnemy(
  enemyName: string,
  enemyLevel: number,
  playerLevel: number,
  rng: () => number = Math.random,
  levelBonus: number = CAPTURE_LEVEL_BONUS,
): CaptureValidation & { plan?: CapturePlan } {
  const name = String(enemyName ?? '').trim();
  if (!name) return { ok: false, reason: '没有可捕获的目标' };
  const el = Math.max(1, Math.round(enemyLevel) || 1);
  const pl = Math.max(1, Math.round(playerLevel) || 1);
  const cap = Math.max(0, Math.round(levelBonus) || 0);
  if (el > pl + cap) {
    return { ok: false, reason: `【${name}】高出你太多（Lv${el} vs Lv${pl}）——捕获不住` };
  }
  const tier = tierForLevel(el);
  const element = ELEMENT_POOL[Math.floor(rng() * ELEMENT_POOL.length) % ELEMENT_POOL.length];
  const card: CardItem = {
    name,
    quantity: 1,
    type: '卡牌',
    rarity: '普通',
    cardTier: tier,
    词条: [element, '召唤', '捕获'],
    sealed: false,
    recipe: {
      mainMaterial: name,
      subMaterials: [],
      tier,
      fusionKind: '叠加',
      cost: 0,
      rating: '成功',
    },
  };
  return {
    ok: true,
    plan: {
      card,
      summary: `捕获【${name}】（Lv${el} → ${tier}召唤卡）——她的意志由你处置，此后与你同行`,
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// ② 孕育子嗣（SSS「种付支配」/「神孕之屌」）
// ════════════════════════════════════════════════════════════════════

export interface OffspringPlan {
  /** 子嗣卡（继承双亲各一词条） */
  card: CardItem;
  /** 继承到的词条 */
  inherited: string[];
  summary: string;
}

/**
 * 规划一次孕育（纯函数）：双亲各出一张伙伴卡 → 子嗣卡继承双亲各一词条。
 *
 * 档位取双亲较高者（**不** +1 —— 孕育不是融合，强度靠继承词条体现）。
 * 双亲须为不同的伙伴卡（同名同卡无法孕育），未损坏。
 */
export function planOffspring(
  mother: Pick<CardItem, 'name' | 'cardTier' | '词条'>,
  father: Pick<CardItem, 'name' | 'cardTier' | '词条'>,
  rng: () => number = Math.random,
): CaptureValidation & { plan?: OffspringPlan } {
  for (const p of [mother, father]) {
    if (!cardKindOf(p.词条 ?? [])) return { ok: false, reason: `【${p.name}】不是卡牌` };
    if (cardKindOf(p.词条 ?? []) !== '召唤') {
      return { ok: false, reason: `【${p.name}】不是伙伴卡——孕育只以伙伴为亲` };
    }
  }
  if (mother.name === father.name) {
    return { ok: false, reason: '同一张卡不能自为双亲' };
  }
  const mi = CARD_TIERS.indexOf(mother.cardTier ?? '白铁');
  const fi = CARD_TIERS.indexOf(father.cardTier ?? '白铁');
  const tier = CARD_TIERS[Math.max(mi, fi)] ?? '白铁';

  // 双亲各取一词条（排除形态/标记类，优先未重复的实际词条）
  const pickFrom = (p: { name: string; 词条?: string[] }): string | undefined => {
    const words = (p.词条 ?? []).filter((w) => w && w !== '召唤');
    if (words.length === 0) return undefined;
    return words[Math.floor(rng() * words.length) % words.length];
  };
  const inherited = [pickFrom(mother), pickFrom(father)].filter(
    (w): w is string => typeof w === 'string' && w.length > 0,
  );
  const entries = [...new Set([...inherited, '召唤', '子嗣'])];

  const nameBase = mother.name.length <= father.name.length ? mother.name : father.name;
  const cardName = `${nameBase}·子嗣`;
  const element = ELEMENT_POOL[Math.floor(rng() * ELEMENT_POOL.length) % ELEMENT_POOL.length];
  const card: CardItem = {
    name: cardName,
    quantity: 1,
    type: '卡牌',
    rarity: '普通',
    cardTier: tier,
    词条: entries.includes(element) ? entries : [element, ...entries],
    sealed: false,
    recipe: {
      mainMaterial: mother.name,
      subMaterials: [father.name],
      tier,
      fusionKind: '相生',
      cost: 0,
      rating: '成功',
    },
  };
  return {
    ok: true,
    plan: {
      card,
      inherited,
      summary: `【${mother.name}】与【${father.name}】的子嗣诞生——【${cardName}】（${tier}），继承：${
        inherited.join('、') || '（无）'
      }`,
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// ③ 转化伙伴卡（SSS「变肉便器吧」）
// ════════════════════════════════════════════════════════════════════

export interface CorruptPlan {
  /** 被转化卡名的退场（调用方 remove_item） */
  sourceName: string;
  /** 词条兑出的素材（每词条一份；调用方逐项 add_item） */
  materials: { name: string; quantity: number; type: '材料'; rarity: Rarity }[];
  summary: string;
}

/**
 * 规划一次转化（纯函数）：伙伴卡退场，其词条逐条兑成素材。
 *
 * 素材品质按卡的档位（与拆解同口径）；词条数为 0 时至少给一份保底素材
 * （避免「消耗了卡却什么都没得到」）。
 */
export function planCorruptCompanion(
  card: Pick<CardItem, 'name' | 'cardTier' | '词条' | 'data'>,
): CaptureValidation & { plan?: CorruptPlan } {
  if (!cardKindOf(card.词条 ?? [])) return { ok: false, reason: `【${card.name}】不是卡牌` };
  if (cardKindOf(card.词条 ?? []) !== '召唤') {
    return { ok: false, reason: `【${card.name}】不是伙伴卡——只有伙伴可被转化` };
  }
  if (isDamaged(card as CardItem)) {
    return { ok: false, reason: `【${card.name}】已损坏——先修复再转化` };
  }
  const rarity = TIER_TO_RARITY[(card.cardTier ?? '白铁') as CardTier] ?? '普通';
  const words = (card.词条 ?? []).filter((w) => w && w !== '召唤');
  const list = words.length > 0 ? words : ['残念'];
  const materials = list.map((w) => ({
    name: `${w}素材`,
    quantity: 1,
    type: '材料' as const,
    rarity,
  }));
  return {
    ok: true,
    plan: {
      sourceName: card.name,
      materials,
      summary: `转化【${card.name}】——${materials.length} 条词条兑成素材：${materials
        .map((m) => m.name)
        .join('、')}（卡退场）`,
    },
  };
}
