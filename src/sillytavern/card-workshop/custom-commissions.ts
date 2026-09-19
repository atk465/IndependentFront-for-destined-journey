/**
 * custom-commissions.ts — 开发者模式自定义委托与链节探索事件（2026-09-19）
 *
 * 委托编写器（ContentEditor 第三标签）的数据层，照 custom-content.ts 同款模式：
 *   · 运行时注册表 = 内存 Map（引擎层不引 Vue，computed 读它建立不了依赖）
 *   · 存档持久化 = `worldFlags.customCommissions` / `worldFlags.customExplorationEvents`
 *   · 读取时与内容包合并（自定义优先——同名覆盖内置）
 *
 * 校验完全复用既有门禁：
 *   · 委托 → `coerceCommissions`（四类要求/品级/时限/链字段/卡奖励全解析，坏条目丢）
 *   · 探索事件 → `coerceRandomEventPack`（单条 def 包一层数组过同一套校验）
 *
 * 纯度约束：合并/校验纯函数；读写由调用方走 worldFlags。
 */

import { coerceCommissions, type CommissionDef } from './commission';
import { coerceRandomEventPack } from '../random-event-pack';
import type { RandomEventDef } from '../types-random-events';

// ═══════════════════════════════════════════════════════════
// 自定义委托
// ═══════════════════════════════════════════════════════════

const customCommissionMap = new Map<string, CommissionDef>();

/** 注册/覆盖一条自定义委托（按名去重；同名不同键时清旧键，防编辑器多次保存留双份） */
export function registerCustomCommission(def: CommissionDef): void {
  for (const [key, existing] of customCommissionMap) {
    if (existing.name === def.name && key !== def.name) customCommissionMap.delete(key);
  }
  customCommissionMap.set(def.name, def);
}

/** 注销一条自定义委托 */
export function unregisterCustomCommission(name: string): void {
  customCommissionMap.delete(name);
}

/** 当前全部自定义委托（运行时真源） */
export function getCustomCommissions(): CommissionDef[] {
  return [...customCommissionMap.values()];
}

/** 用给定列表整体替换运行时注册表（读档灌回时用） */
export function replaceCustomCommissions(list: readonly CommissionDef[]): void {
  customCommissionMap.clear();
  for (const d of list) customCommissionMap.set(d.name, d);
}

/** 宽读自定义委托（照 coerceCommissions 全套门禁；坏条目丢，绝不抛） */
export function coerceCustomCommissions(raw: unknown): CommissionDef[] {
  return coerceCommissions(raw);
}

/**
 * 合并内置清单 + 自定义委托（纯函数）。同名时自定义覆盖内置
 * （开发者显式创建的同名委托意味着「我要替换它」）。
 */
export function mergeCommissions(
  base: readonly CommissionDef[],
  custom: readonly CommissionDef[],
): CommissionDef[] {
  const customNames = new Set(custom.map((d) => d.name));
  return [...base.filter((d) => !customNames.has(d.name)), ...custom];
}

// ═══════════════════════════════════════════════════════════
// 自定义链节探索事件
// ═══════════════════════════════════════════════════════════

const customEventMap = new Map<string, RandomEventDef>();

/** 注册/覆盖一条自定义探索事件（按名去重，同委托注册表） */
export function registerCustomEvent(def: RandomEventDef): void {
  for (const [key, existing] of customEventMap) {
    if (existing.name === def.name && key !== def.name) customEventMap.delete(key);
  }
  customEventMap.set(def.name, def);
}

/** 注销一条自定义探索事件 */
export function unregisterCustomEvent(name: string): void {
  customEventMap.delete(name);
}

/** 当前全部自定义探索事件（运行时真源） */
export function getCustomEvents(): RandomEventDef[] {
  return [...customEventMap.values()];
}

/** 用给定列表整体替换运行时注册表（读档灌回时用） */
export function replaceCustomEvents(list: readonly RandomEventDef[]): void {
  customEventMap.clear();
  for (const d of list) customEventMap.set(d.name, d);
}

/**
 * 宽读单条随机事件定义（复用 `coerceRandomEventPack` 的全套门禁：坏 def 丢弃并带
 * 诊断；只认 exploration 触发器——这个注册表就是给链节终点事件用的，混进 mtth
 * 反而是作者笔误）。
 */
export function coerceCustomEvents(raw: unknown): RandomEventDef[] {
  if (!Array.isArray(raw)) return [];
  const pack = coerceRandomEventPack({ config: {}, defs: raw });
  return pack.defs.filter((d) => d.trigger?.type === 'exploration');
}

/**
 * 合并事件包定义 + 自定义探索事件（纯函数）。同名时自定义覆盖内置。
 */
export function mergeEventDefs(
  base: readonly RandomEventDef[],
  custom: readonly RandomEventDef[],
): RandomEventDef[] {
  const customNames = new Set(custom.map((d) => d.name));
  return [...base.filter((d) => !customNames.has(d.name)), ...custom];
}
