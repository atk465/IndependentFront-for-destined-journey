/**
 * card-craft-plan.ts — 制卡主路：**Code 侧一次算完**（2026-09-17 第三档改造）
 *
 * ## 为什么要有这个模块
 *
 * 改造前：制卡走 `craft_gen` agent 的工具循环（`craft_check` 掷骰 → `craft_settle`
 * 结算），消耗由**工具被不被调用**决定。问题不是「AI 可以随意定消耗」（损耗率与
 * 资源成本本来就在 craft-resolver 里算），而是：
 *  - `tool_choice: 'auto'` → AI 漏调 `craft_settle` 就一分素材不扣，**而且**
 *    链里那条 `!settlementPatches` 分支还会倒发 exp/fp（fail-open）；
 *  - Agentic 失败回退 `client.chat`（**无工具**）时，`<exp_gained>` 只能由 AI 编。
 *
 * 改造后：**玩家在制卡台选素材 + 写下想做成什么样 → 本模块一次算完档位/词条/造价/
 * 评级/消耗/经验 → 交给 AI 只写叙事与命名**。数值这条线上 AI 没有位置，也就没有
 * 「漏调工具」这个失败面。素材经济不再依赖 AI 的自觉。
 *
 * ## 与一般制作的分工
 *
 * 「锻造/炼金/烹饪/裁缝」那些泛用制作仍走 `craft_settle`（那套 DC/骰带/行业规则
 * 是它们的），**卡牌不走**：卡的档位/词条/造价本来就由融合内核算，不需要 AI 参与结算。
 *
 * 纯度约束：纯函数、不 mutate、**骰值由调用方传入**（与 skirmish 同一条铁律）。
 */

import type { CardItem, CraftRating, InventoryItem } from '../types';
import { CARD_TIERS, type CardTier } from '../field-enums';
import type { TalentEntry } from './talent-entry';
import { buildCardItem, resolveMaterialSpecs } from './craft-card';
import { rollCraftRating } from './card-fusion';
import {
  applyCraftTalentBonus,
  applyCraftEntryTalents,
  isDesireDominant,
} from './craft-talent-bonus';
import { liftCraftRating } from '../craft-gen-chain';
import { liftFromMisfortune } from './craft-flow-hooks';
import { blueprintCraftBonus } from './opponent-blueprints';

// ════════════════════════════════════════════════════════════════════
// 数值表（初稿，数值总表终审对象）
// ════════════════════════════════════════════════════════════════════

/** 制作经验：按产物档位（越高的卡越难做，给得越多） */
export const CRAFT_EXP_BY_TIER: Record<CardTier, number> = {
  白铁: 10,
  青铜: 25,
  白银: 50,
  鎏金: 90,
  星辉: 150,
};

/** 评级倍率：失败只给三成（吃了亏但学到了），大失败不给 */
export const CRAFT_RATING_MULT: Record<CraftRating, number> = {
  大失败: 0,
  失败: 0.3,
  成功: 1,
  精益求精: 1.5,
};

/** 评级算不算「没做成」 */
export function isFailedRating(rating: CraftRating): boolean {
  return rating === '失败' || rating === '大失败';
}

/**
 * 素材消耗规则（**Code 定，不是 AI 定**）：
 *  - 成功 / 精益求精 → 用到的素材全消耗（材料变成了卡）
 *  - 失败 → 只消耗**副素材**，主材保住（差一步，东西还在）
 *  - 大失败 → 全消耗（炸了）
 *
 * 与 `craft-resolver` 的百分比损耗是同一种精神（做坏了少亏一点），
 * 只是卡牌的素材通常是「一件一份」，所以用「保住主材」表达 50% 的减免。
 */
export function consumedByRating(
  rating: CraftRating,
  mainName: string,
  subNames: readonly string[],
): string[] {
  if (rating === '失败') return [...subNames];
  return [mainName, ...subNames];
}

/** 制作经验（Code 算） */
export function craftExpFor(tier: CardTier, rating: CraftRating): number {
  const base = CRAFT_EXP_BY_TIER[tier] ?? 10;
  const mult = CRAFT_RATING_MULT[rating] ?? 0;
  return Math.max(0, Math.round(base * mult));
}

// ════════════════════════════════════════════════════════════════════
// 计划
// ════════════════════════════════════════════════════════════════════

/** 评级上浮的来源（调用方按天赋算好，本模块只按顺序施加） */
interface CraftLiftContext {
  /** 制卡顺利 +1 / 败犬烙印 +2 等（已由调用方合并为一个档数） */
  baseLift?: number;
  /** 赌徒谬论：厄运层数与单次上限（只在相克流派兑现） */
  misfortune?: { layers: number; maxLift: number };
  /** 时间回溯：失败时再抬一档，代价由调用方落账 */
  rewind?: { armed: boolean; lift: number };
}

export interface CardCraftPlan {
  /** 产物卡（**名字是临时的**——AI 命名后由调用方覆盖 name 字段） */
  product: CardItem;
  /** 被消耗的素材名（调用方逐项 remove_item） */
  consumed: string[];
  /** 评级的完整轨迹（审计用：每一步谁抬的） */
  rating: CraftRating;
  baseRating: CraftRating;
  /** 造价（GC = 融合内核算的 recipe.cost，代表精神力消耗折算） */
  cost: number;
  /** 制作经验（Code 算） */
  exp: number;
  /** 天赋审计行（进制作叙事，让玩家看到天赋真的生效） */
  notes: string[];
  /** 审计链（逐条可复算） */
  audit: string[];
  /** 支配者倒影：本次是否真的用了蓝本（调用方据此消耗掉那一份） */
  blueprintUsed: boolean;
  /** 赌徒谬论用掉了几层厄运（调用方据此清零） */
  misfortuneConsumed: number;
  /** 时间回溯是否真的发动（调用方据此扣 MP、清预付开关） */
  rewindUsed: boolean;
}

export interface CardCraftInput {
  /** 主素材名 */
  mainName: string;
  /** 副素材名（最多 2 个，融合内核只取前 2） */
  subNames: readonly string[];
  /** 玩家写下「想做成什么样」——**只进叙事，不进数值** */
  intent: string;
  inventory: readonly InventoryItem[];
  /** Code 侧掷的 d20（1..20，调用方传入） */
  d20: number;
  /**
   * 理解修正（2026-09-25 访谈共识：智力=制卡轴）——评级掷骰加 ⌊(智力−10)/2⌋，
   * 调用方算好传入（planCardCraft 是纯函数不读角色）。缺省 0 = 智力 10。
   */
  insightMod?: number;
  /** 产物名的临时兜底（AI 命名失败时用；AI 成功后调用方覆盖） */
  fallbackName?: string;
  /** 玩家天赋列表（应用制卡侧条目加成） */
  talents?: readonly { name?: string; entries?: readonly TalentEntry[] }[];
  /** 评级上浮上下文 */
  lift?: CraftLiftContext;
  /**
   * 技能蓝本（S「支配者倒影」）：从败仗里抄来的敌方招式。
   * 用了它 → 产物**定格为技能卡** + 评级上浮一档（照成名招式做，比凭空摸索稳）。
   */
  /** 通用经验倍率（C「快速成长」等；缺省 1） */
  expMult?: number;
  blueprint?: { name: string };
}

/** 数值兜底：非有限值按 0（脏数据绝不抛） */
function finiteOr0(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/** 从天赋列表摊平条目 */
function flatEntries(
  talents: readonly { entries?: readonly TalentEntry[] }[] | undefined,
): readonly TalentEntry[] {
  return (talents ?? []).flatMap((t) => t.entries ?? []);
}

/**
 * 规划一次制卡（纯函数）——**这是卡牌制作的唯一数值真源**。
 *
 * 流程：素材解析 → 融合内核定档位/造价/词条 → 基础评级 → Code 侧掷骰 → 天赋上浮
 * → 素材消耗 → 经验。AI 不参与以上任何一步。
 */
export function planCardCraft(input: CardCraftInput): {
  ok: boolean;
  reason?: string;
  plan?: CardCraftPlan;
} {
  const mainName = String(input.mainName ?? '').trim();
  if (!mainName) return { ok: false, reason: '没有选主素材' };
  const names = [mainName, ...input.subNames.map((s) => String(s ?? '').trim()).filter(Boolean)];
  // 去重（同一件素材不能既作主又作副）
  const unique = [...new Set(names)];

  const specs = resolveMaterialSpecs(unique, input.inventory as InventoryItem[]);
  if (specs.length === 0) {
    return { ok: false, reason: `背包里找不到【${mainName}】——先确认素材在手上` };
  }
  if (specs.length < unique.length) {
    const missing = unique.filter((n) => !input.inventory.some((i) => i.name === n));
    return { ok: false, reason: `背包里找不到：${missing.join('、')}` };
  }

  const audit: string[] = [`素材：${unique.join(' + ')}`];
  const notes: string[] = [];

  // ① 融合内核：档位 / 词条 / 造价 全部确定性
  const base = buildCardItem({
    productName: input.fallbackName?.trim() || `${mainName}·卡`,
    description: input.intent?.trim() || undefined,
    quantity: 1,
    quality: '普通',
    rating: '成功',
    materialSpecs: specs,
  });
  audit.push(
    `融合：${base.recipe.fusionKind} → 档位 ${base.cardTier}，词条 [${base.词条.join('、')}]，造价 ${base.recipe.cost} GC`,
  );

  // ② 基础评级 + Code 侧掷骰（评级是制卡唯一的成败信号）
  const baseRating = base.recipe.rating;
  const insight = Math.round(finiteOr0(input.insightMod));
  let rating = rollCraftRating(baseRating, input.d20 + insight);
  const insightTag = insight ? `${insight > 0 ? '+' : ''}${insight}（理解）` : '';
  audit.push(
    `检定：d20=${Math.max(1, Math.min(20, Math.round(input.d20)))}${insightTag} → 评级「${rating}」`,
  );

  // ③ 天赋上浮：制卡顺利/烙印 → 相克厄运 → 时间回溯
  let card = base;
  const baseLift = Math.max(0, Math.round(input.lift?.baseLift ?? 0));
  if (baseLift > 0) {
    const lifted = liftCraftRating(rating, baseLift);
    if (lifted !== rating) {
      audit.push(`天赋上浮 ${baseLift} 档：「${rating}」→「${lifted}」`);
      rating = lifted;
    }
  }
  let misfortuneConsumed = 0;
  const foe = input.lift?.misfortune;
  if (foe && foe.layers > 0) {
    const rolled = liftFromMisfortune({
      layers: foe.layers,
      isClashFusion: card.recipe.fusionKind === '相克',
      maxLift: foe.maxLift,
    });
    if (rolled.lift > 0) {
      const lifted = liftCraftRating(rating, rolled.lift);
      if (lifted !== rating) rating = lifted;
      misfortuneConsumed = rolled.consumed;
      audit.push(`赌徒谬论 ${rolled.consumed} 层厄运押上 → 评级「${rating}」`);
    }
  }
  let rewindUsed = false;
  if (input.lift?.rewind?.armed && isFailedRating(rating)) {
    const lifted = liftCraftRating(rating, Math.max(1, input.lift.rewind.lift));
    if (lifted !== rating) {
      rating = lifted;
      rewindUsed = true;
      audit.push(`时间回溯重裁 → 评级「${rating}」`);
    }
  }

  // ④ 技能蓝本（支配者倒影）：定格为技能卡 + 评级上浮一档
  let blueprintUsed = false;
  if (input.blueprint?.name) {
    const bonus = blueprintCraftBonus();
    if (!card.词条.includes(bonus.formEntry)) {
      card = { ...card, 词条: [bonus.formEntry, ...card.词条] };
    }
    if (!card.recipe) card = { ...card, recipe: base.recipe };
    // 形态换成技能卡后，融合类型字段保留（那是「怎么做的」，不是「做成了什么」）
    const lifted = liftCraftRating(rating, bonus.ratingLift);
    if (lifted !== rating) {
      rating = lifted;
      blueprintUsed = true;
      audit.push(`${bonus.note}（蓝本：${input.blueprint.name}）`);
    }
    notes.push(bonus.note);
  }

  // ⑤ 制卡侧条目加成（越阶 / 惰性 / 模块化 / 战技附加 / 产出数量 / 欲望主导）
  //    —— 与 `craft_gen` 链共用同一个函数，两条路径的加成口径不会漂。
  const talentList = input.talents ?? [];
  const entries = flatEntries(talentList);
  const has = (kind: string) => entries.some((e) => e.kind === kind);
  const { card: boosted, notes: bonusNotes } = applyCraftTalentBonus(card, unique, {
    tierGain: has('越阶') ? entryStrengthOf(talentList, '越阶', 'tierGain') : 0,
    halveCost: has('越阶') && entryStrengthOf(talentList, '越阶', 'halveCost') > 0,
    desireDominant: has('欲望主导') && isDesireDominant(unique),
  });
  card = boosted;
  notes.push(...bonusNotes);
  const entryBoost = applyCraftEntryTalents(card, talentList);
  card = entryBoost.card;
  notes.push(...entryBoost.notes);

  // ⑥ 评级与档位落回卡上（词条/档位可能已被越阶改过）
  card = { ...card, recipe: { ...card.recipe, rating } };
  if (rating === '大失败' || rating === '失败') {
    // 失败品不是成品：保留卡（残料也是东西），但不封印、不视为高阶
    card = { ...card, sealed: false };
  }

  // ⑦ 消耗与经验（Code 定）
  const consumed = consumedByRating(rating, mainName, unique.slice(1));
  const exp = Math.round(craftExpFor(card.cardTier, rating) * Math.max(1, input.expMult ?? 1));
  audit.push(`消耗：${consumed.join('、') || '（无）'}`);
  audit.push(`经验：${exp}（${CARD_TIERS.indexOf(card.cardTier)} 档 × 评级「${rating}」）`);

  return {
    ok: true,
    plan: {
      product: card,
      consumed,
      rating,
      baseRating,
      cost: card.recipe.cost,
      exp,
      notes,
      audit,
      misfortuneConsumed,
      rewindUsed,
      blueprintUsed,
    },
  };
}

/** 条目强度档取值（与 talent-rule-modifiers.entryStrength 同口径的最小实现） */
function entryStrengthOf(
  talents: readonly { entries?: readonly TalentEntry[] }[] | undefined,
  kind: string,
  param: string,
): number {
  for (const t of talents ?? []) {
    for (const e of t.entries ?? []) {
      if (e.kind !== kind) continue;
      const v = e.params[param as keyof TalentEntry['params']];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  return 0;
}
