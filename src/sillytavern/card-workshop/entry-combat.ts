/**
 * entry-combat.ts — 词条战斗语义编译表（卡牌工坊 交锋拍制）
 *
 * 问题 4-② 双源制的交锋拍侧：卡片不直接造伤，影响 = 战力修正 + 反制标签命中
 * （设计共识 §8 问题 30-b）。本表把词条翻译成 CounterTag——AI 预提交的敌招带
 * 反制标签，玩家出卡能吃到克制加成靠的就是这里。
 *
 * 口径（初版 v1，数值总表终审对象）：
 * - 相生产物（燎原/霜冻/磁暴/虹耀/焚影）= 稀缺战斗词条 → **打断**（反制王牌）
 *   + 主元素色彩的基础标签；
 * - 九元素 → 基础标签：火/雷/暗/金 暴烈 → 强攻；风 迅捷 → 闪避；
 *   水/冰/土/光 厚缓庇护 → 防御；
 * - 形态词条（装备/技能/领域…）是形态不是效果 → 无标签；
 * - **未知词条安全无效果**（4-② 裁定原文）——不抛、不猜、不给标签。
 */

import type { CardItem } from '../types';
import type { CounterTag, SkirmishAction } from './skirmish';
import { COUNTER_TAGS } from './skirmish';
import { cardPower } from './deck-power';
import { cardKindOf } from './card-kind';
import { cardStatusEffect } from './entry-status';

/** 词条 → 反制标签（单一真源；key 必须与 card-fusion/material 的词条字面一致） */
export const ENTRY_COMBAT_TABLE: Readonly<Record<string, readonly CounterTag[]>> = {
  // 相生产物：稀缺 → 打断
  燎原: ['强攻', '打断'],
  磁暴: ['强攻', '打断'],
  焚影: ['强攻', '打断'],
  霜冻: ['防御', '打断'],
  虹耀: ['防御', '打断'],
  // 2026-09-17 元素表扩展产物
  雷暴: ['强攻', '打断'],
  凛冽: ['防御', '闪避'],
  熔岩: ['强攻', '防御'],
  玄冰: ['防御', '打断'],
  辉金: ['强攻', '闪避'],
  // 九元素：基础标签
  火: ['强攻'],
  雷: ['强攻'],
  暗: ['强攻'],
  金: ['强攻'],
  风: ['闪避'],
  水: ['防御'],
  冰: ['防御'],
  土: ['防御'],
  光: ['防御'],
};

/** 单词条查表；未知词条 → []（安全无效果） */
export function entryCombatTagsOf(entry: string): readonly CounterTag[] {
  return ENTRY_COMBAT_TABLE[entry] ?? [];
}

/**
 * 卡片词条列表 → 反制标签：逐条查表展开、去重、按 COUNTER_TAGS 序稳定输出
 * （同一张卡无论词条书写顺序如何，标签序列确定一致，审计渲染不抖动）。
 * 缺/非数组词条按无词条算（对齐 deck-power 的存档健壮性口径）。
 */
export function cardCombatTags(词条: readonly string[] | null | undefined): CounterTag[] {
  const words = Array.isArray(词条) ? 词条 : [];
  const found = new Set<CounterTag>();
  for (const word of words) {
    for (const tag of entryCombatTagsOf(word)) found.add(tag);
  }
  return COUNTER_TAGS.filter((t) => found.has(t));
}

// ========== 出卡行动装配（出卡 = 基础攻击的增强，不是替代） ==========

/**
 * 出卡反制行动：行动值 = 派生攻击 + 2×卡面战力，标签 = 词条反制标签。
 *
 * 🔴 2026-09-13 真机校准：最初出卡只用卡面战力（白铁 1 ~ 星辉 5+）当行动值，
 * 而基础强攻 = 派生攻击（Lv12 str16 = 44）——出卡永远比按强攻亏，「增强通道」
 * 共识（§8 问题 29）被数值倒挂。修正口径：**卡在攻击之上叠战力**，出卡严格 ≥
 * 对应基础应对，再叠加反制标签的克制收益；代价是消耗卡会耗掉、启封有风险。
 * label 携带拆解（攻44+卡6），战报审计行天然可复算。
 */
export function cardCounterAction(
  card: Pick<CardItem, 'name' | 'cardTier' | '词条' | 'cardPowerBonus'>,
  stats: { atk: number },
): SkirmishAction {
  const cardPart = 2 * cardPower(card);
  return {
    label: `打出 ${card.name}（攻${stats.atk}+卡${cardPart}）`,
    power: stats.atk + cardPart,
    tags: cardCombatTags(card.词条),
    cardName: card.name,
  };
}

// ========== 八类卡的交锋拍语义矩阵（真机裁定 2026-09-13） ==========
//
// 真机漏洞：交锋拍最初把所有卡压平成「直击」，导致领域卡反复打出、场地直接造伤。
// 修正后的矩阵（每张卡每场**只能打出一次**，会话账本按卡名记账）：
//   技能/物资（消耗）       → 直击（攻+2×卡力），结算后入已耗账
//   召唤/军团（永久）       → 登场直击（攻+2×卡力），此后每拍并肩助战（行动值 +2×卡力）
//   装备（永久）            → 不造伤，此后每拍加持（行动值 +2×卡力）
//   领域/场景（消耗）       → 不造伤（场地不能直接打人），攻系元素 → 每拍敌方持续伤
//                             2×卡力；防系/风 → 每拍行动值 +卡力
//   素材                    → 禁打（材料载体）
// 在场效果从**下一拍**开始生效；数值均为初稿，数值总表终审对象。

/** 在场生效类：打出后转入持续效果（每场一次） */
export const IN_PLAY_KINDS: ReadonlySet<string> = new Set(['装备', '召唤', '军团', '领域', '场景']);

/** 在场持续效果（数值初稿，终审对象）；name = 来源名（审计行用） */
export interface CardInPlayEffect {
  name: string;
  /** dot = 每拍拍末敌方持续损失；buff = 每拍玩家行动值加成；
   *  weaken = 每拍敌方威胁降低；stun = 敌方本拍放弃行动；
   *  regen = 每拍玩家 HP 回复（自身状态「吸魔」等） */
  type: 'dot' | 'buff' | 'weaken' | 'stun' | 'regen';
  amount: number;
  /** 持续拍数（缺省 = 整场）；每拍结束递减，归零移除 */
  beatsLeft?: number;
  /** 该效果**建立的环境**（只有领域/场景卡会带；环境加成天赋据此判定生效） */
  env?: string;
}

/**
 * 环境 → 建立它的元素。领域/场景卡带这些词条时，场上出现对应环境。
 *
 * 「深海环境」这类说法在引擎里原本没有载体；裁定（2026-09-17）挂在**领域/场景卡**
 * 上：水系/冰系的领域或场景卡在场 = 水下环境在场，卡退场环境即散。
 * 加环境 = 加一行数据。
 */
export const ENV_ELEMENTS: Readonly<Record<string, readonly string[]>> = {
  水下: ['水', '冰'],
};

/** 这张卡建立的环境（只有领域/场景卡算；无 → undefined） */
export function environmentOfCard(
  词条: readonly string[] | null | undefined,
  kind: string,
): string | undefined {
  if (kind !== '领域' && kind !== '场景') return undefined;
  const words = Array.isArray(词条) ? 词条 : [];
  for (const [env, elements] of Object.entries(ENV_ELEMENTS)) {
    if (elements.some((el) => words.includes(el))) return env;
  }
  return undefined;
}

/** 八类卡的出牌计划。`extra` = 卡上「战技附加」带来的第二条在场效果（旧卡无此字段） */
export type CardPlayPlan =
  | { mode: '直击'; action: SkirmishAction; extra?: CardInPlayEffect }
  | { mode: '在场'; action: SkirmishAction; effect: CardInPlayEffect; extra?: CardInPlayEffect }
  | { mode: '禁打'; reason: string };

/**
 * 在场效果入参：单条或数组。**战技附加**会让一张卡同时带基础效果与战技，
 * 所以「激活」从单条放宽成数组；单条仍是最常见形态，故两种都收。
 */
export type ActivateInput = CardInPlayEffect | readonly CardInPlayEffect[];

/** 归一化成数组（调用方懒得判单条/多条时用；测试断言也走这里） */
export function activateListOf(v: ActivateInput | undefined): CardInPlayEffect[] {
  if (!v) return [];
  return Array.isArray(v) ? [...(v as readonly CardInPlayEffect[])] : [v as CardInPlayEffect];
}

/** 出牌计划里的在场效果（含战技），归一成数组——交给会话层的 activate 通道 */
export function planEffects(plan: CardPlayPlan): CardInPlayEffect[] {
  if (plan.mode === '禁打') return [];
  const list: CardInPlayEffect[] = [];
  if (plan.mode === '在场') list.push(plan.effect);
  if (plan.extra) list.push(plan.extra);
  return list;
}

/** 八类 → 交锋拍出牌计划（纯函数；数值见矩阵注释） */
export function cardPlayPlan(
  card: Pick<CardItem, 'name' | 'cardTier' | '词条' | 'cardPowerBonus' | '战技'>,
  stats: { atk: number },
): CardPlayPlan {
  const kind = cardKindOf(card.词条);
  if (kind === '素材') {
    return { mode: '禁打', reason: '素材卡是材料载体，不能在战斗中打出' };
  }
  // 战技附加（2026-09-17）：制卡时授予的战斗状态，打出此卡即生效（第二条在场效果）
  const extra = cardStatusEffect(card.战技, card.name);
  if (!IN_PLAY_KINDS.has(kind)) {
    return { mode: '直击', action: cardCounterAction(card, stats), ...(extra ? { extra } : {}) };
  }
  const power = cardPower(card);
  const tags = cardCombatTags(card.词条);
  // 领域/场景卡建立环境（水系/冰系 → 水下）；环境随该效果的生命周期存续
  const env = environmentOfCard(card.词条, kind);
  let effect: CardInPlayEffect;
  if (kind === '装备' || kind === '召唤' || kind === '军团') {
    effect = { name: card.name, type: 'buff', amount: 2 * power };
  } else {
    // 领域/场景：攻系元素（强攻/打断标签）→ 持续伤害；防系/风/无战斗词条 → 玩家加成
    effect =
      tags.includes('强攻') || tags.includes('打断')
        ? { name: card.name, type: 'dot', amount: 2 * power }
        : { name: card.name, type: 'buff', amount: power };
  }
  if (env) effect = { ...effect, env };
  const verb =
    kind === '装备'
      ? `装备 ${card.name}`
      : kind === '召唤' || kind === '军团'
        ? `祭出 ${card.name}`
        : `展开 ${card.name}`;
  const action: SkirmishAction = {
    label: `${verb}（${effect.type === 'dot' ? `此后每拍灼烧−${effect.amount}` : `此后每拍行动值+${effect.amount}`}）`,
    power: kind === '召唤' || kind === '军团' ? stats.atk + 2 * power : stats.atk,
    tags,
    cardName: card.name,
  };
  return { mode: '在场', action, effect, ...(extra ? { extra } : {}) };
}

// ========== 封印卡的交锋拍出牌（启封判定接入拍内，真机积压 2026-09-14） ==========
//
// 此前封印卡在交锋拍被一刀切「不能用」。裁定：打封印卡 = 这一拍的行动就是**启封
// 判定**（d20 + 意志修正 vs 封印 DC），照阶段 2 内核分级：
//   启封 → 封印破，卡效果本拍全额发动；哑火 → 封印扛住，本拍空过（不记已用账）；
//   暴走 → 封印破、效果发动，但失控反冲（玩家 −⌈反噬伤害/2⌉）；
//   反噬 → 封印破但效果炸空，玩家 −反噬伤害，本拍空过。
// 破封的卡在会话账本记 unsealedCards，由结算同窗持久化 sealed:false。

import { judgeUnseal, unsealDC, REBOUND_DAMAGE, sealBreaks, type UnsealOutcome } from './unsealing';

/** 封印卡出牌的完整裁定（纯数据；HP/账本落地由会话层执行） */
export interface SealedPlayResult {
  outcome: UnsealOutcome;
  dc: number;
  action: SkirmishAction;
  /** 启封判定审计行（置于拍审计之前） */
  prepend: string[];
  /** 破封卡名（哑火缺省）——会话账本记入 unsealedCards，结算持久化 sealed:false */
  sealBroke?: string;
  /** 暴走/反噬反冲伤害（拍末玩家 HP −n，可致死） */
  recoil?: number;
  /** 卡效果是否实际发动（启封/暴走 = true；哑火/反噬 = false） */
  effectFired: boolean;
  /** 在场卡激活（effectFired 且该卡有在场效果/战技时存在；两条以上时为数组） */
  activate?: ActivateInput;
}

const 空过行动 = (label: string): SkirmishAction => ({ label, power: 0, tags: [] });

/** 封印卡出牌裁定：启封判定 + 按四态分级装配行动/反冲/破封账 */
export function sealedCardPlay(
  card: Pick<CardItem, 'name' | 'cardTier' | '词条' | 'cardPowerBonus' | 'recipe'>,
  stats: { atk: number },
  d20: number,
  willMod: number,
): SealedPlayResult {
  const outcome = judgeUnseal(card, d20, willMod);
  const dc = unsealDC(card);
  const prepend = [
    `▸ 启封判定：d20=${d20}+意志${willMod} vs DC${dc} → ${outcome.kind}（${outcome.margin >= 0 ? '+' : ''}${outcome.margin}）`,
  ];
  const rebound = REBOUND_DAMAGE[card.cardTier] ?? REBOUND_DAMAGE['白铁'];

  if (!sealBreaks(outcome)) {
    // 哑火：封印扛住——本拍空过，卡不记已用账（下拍可再试）
    return {
      outcome,
      dc,
      action: 空过行动(`启封 ${card.name}（哑火——这一拍空过）`),
      prepend,
      effectFired: false,
    };
  }

  // 反噬：封印破但效果炸空——全额反冲，本拍空过（卡已可正常使用，下拍再打）
  if (outcome.kind === '反噬') {
    return {
      outcome,
      dc,
      action: 空过行动(`启封 ${card.name}（反噬——效果炸空，这一拍空过）`),
      prepend,
      sealBroke: card.name,
      effectFired: false,
      recoil: rebound,
    };
  }

  const plan = cardPlayPlan(card, stats);
  if (plan.mode === '禁打') {
    // 破封的是素材卡：无战斗效果（暴走仍半额反冲）
    return {
      outcome,
      dc,
      action: 空过行动(`启封 ${card.name}（破封——无战斗效果）`),
      prepend,
      sealBroke: card.name,
      effectFired: false,
      ...(outcome.kind === '暴走' ? { recoil: Math.max(1, Math.ceil(rebound / 2)) } : {}),
    };
  }
  const effects = planEffects(plan);
  return {
    outcome,
    dc,
    action: plan.action,
    prepend,
    sealBroke: card.name,
    effectFired: true,
    ...(effects.length === 1
      ? { activate: effects[0] }
      : effects.length > 1
        ? { activate: effects }
        : {}),
    // 暴走：效果发动但失控反冲（半额反噬伤害）
    ...(outcome.kind === '暴走' ? { recoil: Math.max(1, Math.ceil(rebound / 2)) } : {}),
  };
}
