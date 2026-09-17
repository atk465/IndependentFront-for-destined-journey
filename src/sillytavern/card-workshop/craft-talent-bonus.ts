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

/** 判定该次制作是否「欲望主导」（主素材为情绪素材） */
export function isDesireDominant(materialNames: readonly string[]): boolean {
  return materialNames.some((n) => n.includes('情绪素材') || EMOTIONS.some((e) => n.includes(e)));
}
