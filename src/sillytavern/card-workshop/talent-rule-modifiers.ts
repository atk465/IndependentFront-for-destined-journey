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

import type { TalentEntry, TalentEntryKind } from './talent-entry';
import { ENTRY_STRENGTH_BASELINE } from './talent-entry';
import { diceTableByFaces, type FortuneDiceTable } from './fortune-dice';

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

/**
 * 玩家是否持有含指定条目种类的天赋（2026-09-17：吞噬/熔炼机制的天赋门槛）。
 *
 * 机制即天赋的兑现——「吞噬一切」解锁吞噬台、「军团熔炉」解锁熔炼台。
 */
export function hasEntryKind(
  talents: readonly { entries?: readonly TalentEntry[] }[] | undefined,
  kind: TalentEntryKind,
): boolean {
  for (const t of talents ?? []) {
    for (const e of t.entries ?? []) {
      if (e.kind === kind) return true;
    }
  }
  return false;
}

/** 基准值表的宽松视图（`as const` 的联合键不好索引，这里退化成普通表查） */
const BASELINE: Partial<Record<string, Partial<Record<string, number>>>> = ENTRY_STRENGTH_BASELINE;

/**
 * 收集玩家的「环境加成」条目（SS「黑潮之子」等）。
 *
 * 环境不是全局状态——它由**领域/场景卡在场**建立（见 entry-combat 的 ENV_ELEMENTS）。
 * 这里只负责把天赋声明的 (环境名, 百分比) 读出来，是否生效由调用方比对在场效果。
 */
export function envBonusesOf(
  talents: readonly { entries?: readonly TalentEntry[] }[] | undefined,
): { env: string; percent: number }[] {
  const out: { env: string; percent: number }[] = [];
  for (const t of talents ?? []) {
    for (const e of t.entries ?? []) {
      if (e.kind !== '环境加成') continue;
      const env = typeof e.params.env === 'string' ? e.params.env.trim() : '';
      const percent = e.params.percent;
      if (!env || typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0)
        continue;
      out.push({ env, percent });
    }
  }
  return out;
}

/**
 * 收集玩家持有的骰表（`日掷{faces}` → 面表）。
 *
 * 两条天赋（好运之骰十面 / 命运之骰六面）共用 `日掷` 种类，靠 faces 分派；
 * 玩家可能同时持有两张，所以这里返回**列表**而不是单张——面板一次列出全部。
 * 重复持有同一 faces 只算一张。
 */
export function diceTablesOf(
  talents: readonly { entries?: readonly TalentEntry[] }[] | undefined,
): FortuneDiceTable[] {
  const seen = new Set<string>();
  const out: FortuneDiceTable[] = [];
  for (const t of talents ?? []) {
    for (const e of t.entries ?? []) {
      if (e.kind !== '日掷') continue;
      const faces = e.params.faces;
      const table = diceTableByFaces(typeof faces === 'number' ? faces : 10);
      if (!table || seen.has(table.key)) continue;
      seen.add(table.key);
      out.push(table);
    }
  }
  return out;
}

/**
 * 取规则层条目某参数的**强度档值**（2026-09-17 参数化）。
 *
 * 口径：命中第一条声明了该数值参数的同类条目；**条目不写该字段 = 取基准值**
 * （基准 = 参数化之前的硬编码常量，所以存量天赋行为逐位不变）。
 * 与 `sumEntries` 的「多条累加」不同——阈值/拍数/反噬是**覆盖式**规则参数，
 * 累加没有意义（两条「终章」不会变成第 12 拍抹除）。
 *
 * @param kind 条目种类（如 '终章'）
 * @param param 参数名（如 'beats'）
 */
export function entryStrength(
  talents: readonly { entries?: readonly TalentEntry[] }[] | undefined,
  kind: TalentEntryKind,
  param: keyof TalentEntry['params'],
): number {
  for (const t of talents ?? []) {
    for (const e of t.entries ?? []) {
      if (e.kind !== kind) continue;
      const v = e.params[param];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  return BASELINE[kind]?.[param as string] ?? 0;
}
