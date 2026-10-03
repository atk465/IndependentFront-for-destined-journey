/**
 * entry-status.ts — 战技状态编译（天赋条目「战技附加」的消费方，2026-09-17）
 *
 * 背景：`战技附加` 在条目池里躺了很久没有消费方——48 处条目（含 SS「退化射线」）
 * 都写着「产出的卡带战斗状态（中毒/减速/眩晕…）」，但引擎从来没把它变成效果。
 * 本模块把「状态名 + 量 + 拍数」编译成交锋拍的 `CardInPlayEffect`。
 *
 * 分类口径（对齐条目池里实际出现的 20 种状态名）：
 *  - 显式表 `STATUS_TYPE_OVERRIDE` 认得的名字 → 按表定类型（减速/退化这类是 weaken，
 *    眩晕/麻痹这类是 stun）；
 *  - 表外的名字按**形状**兜底：power > 0 = 有持续伤害（dot）；
 *    power = 0 且 beats ≥ 1 = 无量的控制状态（stun，敌方本拍放弃行动）；
 *    power = 0 且 beats = 0 = 纯标记，无战斗效果。
 *
 * 与 `entry-combat`「未知词条安全无效果」同源：认不出又不带量的状态绝不乱猜数值。
 * 纯度约束：纯函数、不 mutate。
 */

import type { CardInPlayEffect } from './entry-combat';

/** 战技状态名 → 效果类型（显式表；表外的名字走形状兜底） */
export const STATUS_TYPE_OVERRIDE: Readonly<Record<string, CardInPlayEffect['type']>> = {
  // 削敌方威胁（「降低一个等级」这类落地为威胁降低）
  减速: 'weaken',
  退化: 'weaken',
  虚弱: 'weaken',
  破甲: 'weaken',
  // 夺行动权
  眩晕: 'stun',
  麻痹: 'stun',
  定身: 'stun',
  僵直: 'stun',
  滑倒: 'stun',
  恐惧: 'weaken',
  诅咒: 'weaken',
};

/** 单张卡携带的战技（写进 `CardItem.战技`） */
export interface CardStatus {
  status: string;
  /** 量（DoT 伤害 / 威胁降低值；0 = 无量状态） */
  power: number;
  /** 持续拍数 */
  beats: number;
}

/**
 * 状态 → 交锋拍在场效果（纯函数）。
 *
 * 返回 undefined = 这个状态在战斗里没有机械效果（纯标记 / 未知且无量）。
 */
export function statusEffectOf(
  status: string,
  power: number,
  beats: number,
  sourceName = status,
): CardInPlayEffect | undefined {
  const name = String(status ?? '').trim();
  if (!name) return undefined;
  const p = Math.max(0, Math.round(power) || 0);
  const b = Math.max(0, Math.round(beats) || 0);
  const type = STATUS_TYPE_OVERRIDE[name] ?? (p > 0 ? 'dot' : b >= 1 ? 'stun' : undefined);
  if (!type) return undefined;
  // 无量状态（stun）没有可展示的量；有量状态必须有量才成立
  if (type !== 'stun' && p === 0) return undefined;
  return {
    name: sourceName === name ? `战技·${name}` : `战技·${name}（${sourceName}）`,
    type,
    amount: p,
    ...(b > 0 ? { beatsLeft: b } : {}),
  };
}

/** 卡上的战技 → 在场效果（对上面那个函数的一层便利包装） */
export function cardStatusEffect(
  status: CardStatus | undefined,
  sourceName?: string,
): CardInPlayEffect | undefined {
  if (!status) return undefined;
  return statusEffectOf(status.status, status.power, status.beats, sourceName);
}
