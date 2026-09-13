/**
 * derived-stats.ts — 派生战斗数值层（卡牌工坊 交锋拍制）
 *
 * 设计共识 §8 问题 31：玩家 RPG 面板复用既有 CharacterState（level/五维/HP/MP），
 * 本模块只补新增的「攻/防/敏」派生层——交锋拍的行动值、防御减免与状态栏
 * 「基础 + 装备加成」两段式渲染都从这里出数。
 *
 * 公式（初版 v1，数值总表终审对象；锚点 = 参考截图「攻击 73（基础38+35）」的
 * 基础段量级：str14、Lv9 → 2×14+9 = 37 ≈ 38）：
 * - 攻击 atk   = 2×str + level（拍内行动值 & 碾压判据输入）
 * - 防御 guard = 2×con + ⌊level/2⌋（反制失败时的减伤基数）
 * - 敏捷 agi   = 2×dex + ⌊level/2⌋（闪避应对的行动值）
 *
 * 确定性契约：纯函数；脏数据（缺五维/缺等级/NaN）兜底 —— 五维缺项按 10、
 * 等级缺按 1（types.ts 新档默认值同源），绝不抛。
 */

import type { BasicCounter, SkirmishAction } from './skirmish';

/** 派生战斗三维（初版 v1 公式见头注） */
export interface DerivedCombatStats {
  atk: number;
  guard: number;
  agi: number;
}

const attrOf = (attributes: Record<string, number> | undefined, key: string): number => {
  const raw = attributes?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 10;
};

/** 五维 + 等级 → 攻/防/敏（脏数据兜底，绝不抛） */
export function deriveCombatStats(input: {
  attributes?: Record<string, number>;
  level?: number;
}): DerivedCombatStats {
  const str = attrOf(input.attributes, 'str');
  const con = attrOf(input.attributes, 'con');
  const dex = attrOf(input.attributes, 'dex');
  const level =
    typeof input.level === 'number' && Number.isFinite(input.level)
      ? Math.max(1, Math.round(input.level))
      : 1;
  return {
    atk: 2 * str + level,
    guard: 2 * con + Math.floor(level / 2),
    agi: 2 * dex + Math.floor(level / 2),
  };
}

/** 基础应对 → 反制行动：行动值取对应派生维，标签 = 同名单标签 */
export function basicCounterAction(move: BasicCounter, stats: DerivedCombatStats): SkirmishAction {
  const power = move === '强攻' ? stats.atk : move === '防御' ? stats.guard : stats.agi;
  return { label: move, power, tags: [move] };
}
