/**
 * card-strip.ts — 词条剥离（SSS「词条之王」的机制兑现，2026-09-17）
 *
 * 天赋描述：「你天生能看到素材中所有隐藏的词条，并且剥离词条时精神力消耗减半。」
 *
 * 两条落地：
 * 1. **透视**：素材的隐藏词条 = 由 `deriveElements`（名字/效果关键词推导）得到的元素，
 *    由 UI 只读展示（见 CraftBench「词条剥离」区的素材清单）。
 * 2. **剥离**：把一张卡上的一个词条**摘下来**变成素材（本模块，纯函数）。
 *    与「吞噬」互为逆操作：吞噬是词条并进去，剥离是词条取出来。
 *
 * 纯度约束：纯函数、无 I/O。
 */

import type { CardItem } from '../types';
import { type Rarity } from '../field-enums';
import { cardKindOf } from './card-kind';
import { deriveElements } from './material';

/** 档位 → 材料品质（与拆解/转化同口径） */
const TIER_TO_RARITY: Record<string, Rarity> = {
  白铁: '普通',
  青铜: '优良',
  白银: '稀有',
  鎏金: '史诗',
  星辉: '传说',
};

/** 不可剥离的结构性词条（剥离它们等于把卡拆坏） */
const STRUCTURAL_ENTRIES: ReadonlySet<string> = new Set([
  '召唤',
  '军团',
  '装备',
  '技能',
  '领域',
  '物资',
  '素材',
  '集合体',
  '归一',
  '子嗣',
  '捕获',
]);

export interface StripValidation {
  ok: boolean;
  reason?: string;
}

export interface StripPlan {
  /** 剥离后的剩余词条 */
  new词条: string[];
  /** 产出素材（一条词条一份） */
  material: { name: string; quantity: number; type: '材料'; rarity: Rarity };
  summary: string;
}

/**
 * 规划一次词条剥离（纯函数）。
 *
 * @param card 目标卡
 * @param entry 要剥离的词条（必须是该卡现有词条）
 */
export function planStripEntry(
  card: Pick<CardItem, 'name' | 'cardTier' | '词条'>,
  entry: string,
): StripValidation & { plan?: StripPlan } {
  const words = Array.isArray(card.词条) ? card.词条 : [];
  if (cardKindOf(words) === '素材') {
    return { ok: false, reason: '素材卡已是材料载体——没有可剥离的词条' };
  }
  const target = entry.trim();
  if (!target) return { ok: false, reason: '未指定要剥离的词条' };
  if (!words.includes(target)) {
    return { ok: false, reason: `【${card.name}】上没有词条「${target}」` };
  }
  if (STRUCTURAL_ENTRIES.has(target)) {
    return { ok: false, reason: `「${target}」是形态/标记词条——剥掉它这张卡就不成形了` };
  }
  const rarity = TIER_TO_RARITY[(card.cardTier ?? '白铁') as string] ?? '普通';
  return {
    ok: true,
    plan: {
      new词条: words.filter((w) => w !== target),
      material: { name: `${target}素材`, quantity: 1, type: '材料', rarity },
      summary: `自【${card.name}】剥离词条「${target}」——得「${target}素材」×1（品质 ${rarity}）`,
    },
  };
}

/** 素材的「隐藏词条」（透视）：由名字/效果推导的元素，UI 只读展示用 */
export function peekMaterialEntries(material: {
  name?: string;
  effects?: Record<string, unknown>;
}): string[] {
  return deriveElements(material as never);
}
