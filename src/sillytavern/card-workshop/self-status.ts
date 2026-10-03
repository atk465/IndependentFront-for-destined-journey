/**
 * self-status.ts — 自身战斗状态（S「蛇符咒」隐身 / S「贝蒙斯坦」吸魔）
 *
 * 与 `entry-status.ts`（战技附加）的分工：
 *  - 战技附加 → 授给**制出的卡**，打出那张卡时生效；
 *  - 自身状态 → 授给**玩家自己**，开战即生效、整场持续。
 *
 * 状态是数据（名字 + 量），落成两种拍内可算的东西：
 *  - `threatDown`：敌方威胁按比例下降（隐身 = 打不中你）——开战时直接缩放意图；
 *  - `regen`：每拍回复玩家 HP（吸魔 = 把吸收的攻击转成血）——落成在场效果。
 *
 * 认不出的状态名 → 无效果（对齐 entry-combat「未知词条安全无效果」的裁定）。
 *
 * 纯度约束：纯函数、不 mutate。
 */

import type { CardInPlayEffect } from './entry-combat';

/** 自身状态的机械形态 */
export type SelfStatusKind = 'threatDown' | 'regen';

/** 状态名 → 机械形态（加状态 = 加一行数据） */
export const SELF_STATUS_TABLE: Readonly<Record<string, SelfStatusKind>> = {
  隐身: 'threatDown',
  潜行: 'threatDown',
  吸魔: 'regen',
  噬能: 'regen',
};

/** 玩家的一条自身状态（读自天赋条目） */
export interface SelfStatus {
  status: string;
  power: number;
  kind: SelfStatusKind;
}

/**
 * 从天赋条目收集自身状态（`自身状态{status, power}`）。
 *
 * 未知状态名**不进列表**（宁可没有效果，也不给一个引擎看不懂的状态占位）。
 */
export function selfStatusesOf(
  talents:
    | readonly { entries?: readonly { kind: string; params: Record<string, unknown> }[] }[]
    | undefined,
): SelfStatus[] {
  const out: SelfStatus[] = [];
  for (const t of talents ?? []) {
    for (const e of t.entries ?? []) {
      if (e.kind !== '自身状态') continue;
      const status = typeof e.params.status === 'string' ? e.params.status.trim() : '';
      const kind = SELF_STATUS_TABLE[status];
      const power = e.params.power;
      if (!kind || typeof power !== 'number' || !Number.isFinite(power) || power <= 0) continue;
      out.push({ status, power: Math.round(power), kind });
    }
  }
  return out;
}

/** 同形态多条时的合计（如两条 threatDown 叠加） */
export function totalSelfStatus(statuses: readonly SelfStatus[], kind: SelfStatusKind): number {
  return statuses.filter((s) => s.kind === kind).reduce((sum, s) => sum + s.power, 0);
}

/**
 * 自身状态 → 开战时的初始在场效果（只有 `regen` 这类需要每拍结算的才落成效果）。
 *
 * `threatDown` 不在这里——它由调用方在开战前直接缩放敌方意图（更省、更可审计）。
 */
export function initialSelfEffects(statuses: readonly SelfStatus[]): CardInPlayEffect[] {
  const regen = totalSelfStatus(statuses, 'regen');
  if (regen <= 0) return [];
  return [{ name: '自身状态·吸魔', type: 'regen', amount: regen }];
}
