/**
 * talent-rule-modifiers.ts — 规则层天赋的确定性修正集合
 *
 * 规则层天赋（SSS/SS）改变的是游戏规则而非加几个点。本模块定义**可在
 * 交锋拍与终局结算中确定性生效**的规则修正：连战递增/击杀掠取/威压/体魄/
 * 判定取优/产出数量/风险系数/金钱加投/经验倍率/HP倍率/全属性倍率。
 *
 * 纯叙事规则（作者/第四面墙/GM权限/模组加载等）不在此处——由 {{TALENT}} 注入
 * 交给 AI 演绎。
 *
 * 确定性契约：纯函数、不 mutate。
 */

import type { TalentEntry } from './talent-entry';

/** 从天赋条目列表中汇总指定 kind 的数值合计 */
function sumEntries(
  entries: readonly TalentEntry[] | undefined,
  kind: string,
  param: string,
): number {
  let total = 0;
  for (const e of entries ?? []) {
    if (e.kind === kind) {
      const v = e.params[param as keyof TalentEntry['params']];
      if (typeof v === 'number' && Number.isFinite(v)) total += Math.max(0, v);
    }
  }
  return total;
}

/** 从玩家天赋条目中汇总连战递增加成 */
export function totalChainBonus(entries: readonly TalentEntry[] | undefined): number {
  return sumEntries(entries, '连战递增', 'amount');
}

/** 从玩家天赋条目中汇总击杀掠取赏金 */
export function totalKillGc(entries: readonly TalentEntry[] | undefined): number {
  return sumEntries(entries, '击杀掠取', 'gold');
}

/** 从玩家天赋条目中汇总威压百分比 */
export function totalIntimidation(entries: readonly TalentEntry[] | undefined): number {
  return sumEntries(entries, '威压', 'percent');
}

/** 从玩家天赋条目中检查是否拥有体魄天赋 */
export function hasTitanPhysique(entries: readonly TalentEntry[] | undefined): boolean {
  for (const e of entries ?? []) {
    if (e.kind === '体魄') return true;
  }
  return false;
}

/** 从玩家天赋条目中检查是否拥有判定取优天赋 */
export function hasBetterRoll(entries: readonly TalentEntry[] | undefined): boolean {
  for (const e of entries ?? []) {
    if (e.kind === '判定取优') return true;
  }
  return false;
}

/** 从玩家天赋条目中检查是否拥有产出数量天赋 */
export function totalCopies(entries: readonly TalentEntry[] | undefined): number {
  return sumEntries(entries, '产出数量', 'copies');
}
