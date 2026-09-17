/**
 * craft-talent-bonus.ts — 制卡侧天赋加成（2026-09-17）
 *
 * 一次实现两条 SSS 的制卡域机制：
 * - 「卡牌造物主」：**无视素材等级限制**制卡——产物档位在素材允许的基础上**再越一阶**，
 *   且造价减半（对应描述里的「精神力消耗为正常制作的 1/2」，我们以 GC 造价表达）
 * - 「欲望魔神」：**欲望主导制卡**（以情绪素材为主素材）时产物必成 + 额外附带一条
 *   情绪词条 + 标「贴合」印（对应「一定贴合你的xp」）
 *
 * 由 craft-gen-chain 在 `buildCardItem` 之后调用（纯函数，注入式），
 * 天赋门控由调用方按条目种类判定（`越阶` / `欲望主导`）。
 */

import type { CardItem } from '../types';
import { CARD_TIERS, type CardTier } from '../field-enums';
import { EMOTIONS } from './emotion-material';
import { LAZY_ENTRY, LONE_ENTRY, MODULAR_ENTRY } from './battle-rules';
import { cardKindOf } from './card-kind';
/** 条目天赋的宽松输入：只看 kind 与 params 里用得上的那几项（不绑死某个窄类型） */
export interface CraftEntryTalentLike {
  name?: string;
  entries?: readonly { kind: string; params: Record<string, unknown> }[];
}

/** 入参：产物卡 + 该次制作用到的素材名（用于判定是否「欲望主导」） */
export interface CraftTalentContext {
  /** 产物品质越阶档数（卡牌造物主；缺省 0 = 不越阶；基准 1 见 ENTRY_STRENGTH_BASELINE.越阶） */
  tierGain?: number;
  /** 造价减半（卡牌造物主） */
  halveCost?: boolean;
  /** 欲望主导制卡（欲望魔神）：素材含情绪素材时为真 */
  desireDominant?: boolean;
}

export interface CraftTalentResult {
  card: CardItem;
  /** 审计行（进制作叙事，让玩家看到天赋确实生效） */
  notes: string[];
}

function tierUpOf(t: CardTier): { tier: CardTier; upgraded: boolean } {
  const idx = CARD_TIERS.indexOf(t);
  if (idx < 0 || idx >= CARD_TIERS.length - 1) return { tier: t, upgraded: false };
  return { tier: CARD_TIERS[idx + 1], upgraded: true };
}

/**
 * 应用制卡侧天赋加成（纯函数，不改入参）。
 *
 * @param card 融合内核产出的卡
 * @param materialNames 本次制作使用的素材名（判定欲望主导）
 * @param ctx 已由调用方按天赋判定的开关
 */
export function applyCraftTalentBonus(
  card: CardItem,
  materialNames: readonly string[] = [],
  ctx: CraftTalentContext = {},
): CraftTalentResult {
  const notes: string[] = [];
  let next: CardItem = { ...card, 词条: [...(card.词条 ?? [])] };

  // ① 卡牌造物主：越阶 tierGain 档 + 造价减半
  const gain = Math.max(0, Math.round(ctx.tierGain ?? 0));
  if (gain > 0) {
    let cur = next.cardTier ?? '白铁';
    let moved = 0;
    for (let i = 0; i < gain; i++) {
      const step = tierUpOf(cur);
      if (!step.upgraded) break;
      cur = step.tier;
      moved++;
    }
    if (moved > 0) {
      next = { ...next, cardTier: cur, recipe: { ...next.recipe, tier: cur } };
      notes.push(`【卡牌造物主】无视素材等级限制——品质越阶 ${moved} 档至 ${cur}`);
    } else {
      notes.push('【卡牌造物主】已是星辉——越阶无可再上');
    }
  }
  if (ctx.halveCost && typeof next.recipe?.cost === 'number') {
    const halved = Math.max(0, Math.round(next.recipe.cost / 2));
    next = { ...next, recipe: { ...next.recipe, cost: halved } };
    notes.push(`【卡牌造物主】精神力消耗减半——造价 ${next.recipe.cost} → ${halved} GC`);
  }

  // ② 欲望魔神：必成 + 情绪词条 + 贴合印
  if (ctx.desireDominant) {
    const emotion = EMOTIONS.find((e) => materialNames.some((n) => n.includes(e)));
    const gained: string[] = [];
    if (emotion && !(next.词条 ?? []).includes(emotion)) gained.push(emotion);
    if (!(next.词条 ?? []).includes('贴合')) gained.push('贴合');
    if (gained.length > 0) {
      next = { ...next, 词条: [...(next.词条 ?? []), ...gained] };
    }
    notes.push(
      `【欲望魔神】欲望主导制卡——免疫精神侵蚀、灵感必成${
        emotion ? `，汲取「${emotion}」之力` : ''
      }${gained.length ? `（附词条：${gained.join('、')}）` : ''}`,
    );
  }

  return { card: next, notes };
}

/**
 * 制卡侧**条目天赋**的产物加成（2026-09-17 抽取为共用函数）。
 *
 * 与 `applyCraftTalentBonus` 的分工：那个管「越阶 / 欲望主导」两个带参数的开关；
 * 这个管「看一眼条目就打在产物上」的几个印记与数量——
 *  - **模块化天才**（`模块化`）：装备/载具卡打「模块化」印记 + 改装槽位数
 *  - **懒惰天才**（`惰性`）：召唤/军团卡打「懒惰」印记
 *  - **产出数量**（`产出数量`）：额外产出 n 份
 *  - **战技附加**（`战技附加`）：产物附带一条战斗状态（多条取条目序第一条）
 *
 * ⚠️ **制卡主路（card-craft-plan）与 craft_gen 链共用这一个函数**——
 * 两条路径的加成口径不许漂。改这里就是改两处。
 *
 * 纯函数，不改入参。
 */
export function applyCraftEntryTalents(
  card: CardItem,
  talents: readonly CraftEntryTalentLike[] | undefined,
): CraftTalentResult {
  const notes: string[] = [];
  let next: CardItem = { ...card, 词条: [...(card.词条 ?? [])] };
  const entries = (talents ?? []).flatMap((t) => t.entries ?? []);
  const strengthOf = (kind: string, param: string): number => {
    for (const e of entries) {
      if (e.kind !== kind) continue;
      const v = e.params[param];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return 0;
  };

  const kind = cardKindOf(next.词条);

  // 模块化天才：载具/装备卡
  if (entries.some((e) => e.kind === '模块化') && kind === '装备') {
    const slots = strengthOf('模块化', 'slots');
    if (!next.词条.includes(MODULAR_ENTRY)) next.词条 = [...next.词条, MODULAR_ENTRY];
    next = { ...next, data: { ...(next.data ?? {}), 改装槽: slots } };
    notes.push(`【模块化天才】载具卡带 ${slots} 个改装槽——战斗中可热插拔换形态`);
  }

  // 孤狼（A）：生物卡带「独行」印记——场上没有其它友方时效果翻倍
  if (entries.some((e) => e.kind === '独行') && (kind === '召唤' || kind === '军团')) {
    if (!next.词条.includes(LONE_ENTRY)) next.词条 = [...next.词条, LONE_ENTRY];
    notes.push(`【孤狼】${kind}卡带「${LONE_ENTRY}」印记——独自在场时效果翻倍`);
  }

  // 懒惰天才：生物卡
  if (entries.some((e) => e.kind === '惰性') && (kind === '召唤' || kind === '军团')) {
    if (!next.词条.includes(LAZY_ENTRY)) next.词条 = [...next.词条, LAZY_ENTRY];
    notes.push(`【懒惰天才】${kind}卡带「${LAZY_ENTRY}」印记——可能摸鱼，但动手就是暴击`);
  }

  // 产出数量：额外 n 份
  const copies = entries
    .filter((e) => e.kind === '产出数量')
    .reduce((sum, e) => sum + Math.max(0, Math.round(Number(e.params.copies) || 0)), 0);
  if (copies > 0) {
    next = { ...next, quantity: (next.quantity ?? 1) + copies };
    notes.push(`【产出数量】额外产出 ${copies} 份（共 ${next.quantity} 份）`);
  }

  // 战技附加：产物带一条战斗状态（取条目序第一条，确定性）
  const statusEntry = entries.find((e) => e.kind === '战技附加');
  const status = statusEntry?.params.status;
  if (typeof status === 'string' && status.trim()) {
    const 战技 = {
      status: status.trim(),
      power: Math.max(0, Math.round(Number(statusEntry!.params.power) || 0)),
      beats: Math.max(0, Math.round(Number(statusEntry!.params.beats) || 0)),
    };
    next = { ...next, 战技 };
    notes.push(`【战技附加】产物附带战技「${战技.status}」（量 ${战技.power} / ${战技.beats} 拍）`);
  }

  return { card: next, notes };
}

/** 判定该次制作是否「欲望主导」（主素材为情绪素材） */
export function isDesireDominant(materialNames: readonly string[]): boolean {
  return materialNames.some((n) => n.includes('情绪素材') || EMOTIONS.some((e) => n.includes(e)));
}
