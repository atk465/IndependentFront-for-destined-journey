/**
 * commission-runtime.ts — 当前委托板的**注入缝**（卡牌工坊 委托接线，照 random-event-runtime 先例）
 *
 * 装什么: 「当前装着哪一份委托清单」这一个模块级事实。`installCommissionPack` 由前端
 *         （内容注册表第 15 面 `commissions`）在存档加载 / 换包时调用，引擎侧
 *         （`{{COMMISSIONS}}` 注入块的 resolver、委托板 UI）只读。
 * 不装什么: **任何 I/O**、任何容错解析、任何策略。容错在
 *           `card-workshop/commission.coerceCommissions`（调用方在装之前过一遍）。
 *
 * 为什么一条缝而不是让引擎读注册表: 逐字同 `random-event-runtime.ts` / `map-runtime.ts`
 * 的理由——引擎要的是「当前生效的委托清单」这个**能力**，不是「某张表」这个位置。
 *
 * 没装时返回**空数组**——那是兜底合同不是异常：委托板显示空、`{{COMMISSIONS}}`
 * 注入走空串出口，游戏一个字节都不受影响（引擎仓零内置委托，承内容-引擎分离）。
 *
 * 🔴 本文件里不许出现任何中文字面量之外的运行时文案（照 random-event-runtime 纪律，
 *    注释中文是对的）。
 */

import type { CommissionDef } from './card-workshop/commission';

let installed: readonly CommissionDef[] = [];

/**
 * 开发者自定义委托的**独立槽**（委托×地图闭环 2026-09-19：委托编写器）。
 *
 * 🔴 为什么是独立槽而不是让调用方重装整份清单：清单由内容注册表第 15 面在换包/读档时装，
 *    而自定义委托随存档走 —— 两条生命周期，塞进同一个安装动作就会出现「装包时自定义
 *    还没灌回 / 灌回后换包把自定义冲掉」的时序赛。两个槽各装各的，读取时合并。
 */
let customDefs: readonly CommissionDef[] = [];

/**
 * 装入开发者自定义委托（调用方先过 `coerceCustomCommissions` 容错）。
 * 每次换包 / 清空注册表都必须重装。
 */
export function installCustomCommissions(defs: readonly CommissionDef[] | null): void {
  customDefs = Array.isArray(defs) ? [...defs] : [];
}

/**
 * 装入当前委托清单（调用方先过 `coerceCommissions` 容错）。
 * 每次换包 / 清空注册表都必须重装，否则会沿上一份清单出委托（随机事件同款症状）。
 */
export function installCommissionPack(defs: readonly CommissionDef[]): void {
  installed = Array.isArray(defs) ? [...defs] : [];
}

/** 当前生效的委托清单 = 包清单 + 自定义（自定义覆盖同名内置）；没装过 = 空数组 */
export function getCommissionDefs(): readonly CommissionDef[] {
  if (customDefs.length === 0) return installed;
  const customNames = new Set(customDefs.map((d) => d.name));
  return [...installed.filter((d) => !customNames.has(d.name)), ...customDefs];
}

/** 空包判定（委托板空态 / 注入空串出口共用） */
export function isEmptyCommissionPack(): boolean {
  return installed.length === 0;
}
