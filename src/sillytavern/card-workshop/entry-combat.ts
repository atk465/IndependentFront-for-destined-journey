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

import type { CounterTag } from './skirmish';
import { COUNTER_TAGS } from './skirmish';

/** 词条 → 反制标签（单一真源；key 必须与 card-fusion/material 的词条字面一致） */
export const ENTRY_COMBAT_TABLE: Readonly<Record<string, readonly CounterTag[]>> = {
  // 相生产物：稀缺 → 打断
  燎原: ['强攻', '打断'],
  磁暴: ['强攻', '打断'],
  焚影: ['强攻', '打断'],
  霜冻: ['防御', '打断'],
  虹耀: ['防御', '打断'],
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
