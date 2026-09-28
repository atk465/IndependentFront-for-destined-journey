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

/**
 * 心智修正（2026-09-25 访谈共识：智力=制卡轴）——⌊(属性−10)/2⌋ 同款口径：
 * - 意志修正（精神）：启封判定的意志轴（unsealing.willModifierOf，同公式）
 * - 理解修正（智力）：制卡评级掷骰修正 + 启封判定的理解轴 + 叙事面「眼力」演绎素材
 * 智力 10±0、12+1、16+3、8−1；脏值按 10。
 */
export function insightModOf(attributes: Record<string, number> | undefined): number {
  return Math.floor((attrOf(attributes, 'int') - 10) / 2);
}

/** 五维 + 等级 → 攻/防/敏（脏数据兜底，绝不抛） */
export function deriveCombatStats(input: {
  attributes?: Record<string, number>;
  level?: number;
}): DerivedCombatStats {
  return applyStatMultiplier(deriveBaseCombatStats(input), 1);
}

// ═══ 元素主属性轴（2026-09-25 访谈共识：卡牌强度挂角色属性）═══
//
// 每张卡的行动值改用「元素主属性」派生（2×对应属性+等级）：火金走力量、
// 水冰走精神、雷风走敏捷、土走体质、光暗走智力、无元素兜底力量。
// 角色 build 决定哪套卡组强——加点就是选玩法；五维全部进战斗面。
export type AttributeAxis = 'str' | 'dex' | 'con' | 'int' | 'spi';

export const CARD_ELEMENT_AXIS: Readonly<Record<string, AttributeAxis>> = Object.freeze({
  火: 'str',
  金: 'str',
  水: 'spi',
  冰: 'spi',
  雷: 'dex',
  风: 'dex',
  土: 'con',
  光: 'int',
  暗: 'int',
});

export const AXIS_LABEL: Readonly<Record<AttributeAxis, string>> = Object.freeze({
  str: '力量',
  dex: '敏捷',
  con: '体质',
  int: '智力',
  spi: '精神',
});

/** 卡的主属性轴：词条中首个命中九元素的映射；无元素/未知 → 力量（现状口径） */
export function cardAxisOf(词条: readonly string[] | null | undefined): AttributeAxis {
  const words = Array.isArray(词条) ? 词条 : [];
  for (const w of words) {
    const axis = CARD_ELEMENT_AXIS[w];
    if (axis) return axis;
  }
  return 'str';
}

/** 按卡的主属性轴派生行动值：2×对应属性 + 等级（脏数据兜底与 deriveCombatStats 同口径） */
export function deriveCardAtk(
  词条: readonly string[] | null | undefined,
  attributes: Record<string, number> | undefined,
  level: number,
): number {
  const axis = cardAxisOf(词条);
  const lv =
    typeof level === 'number' && Number.isFinite(level) ? Math.max(1, Math.round(level)) : 1;
  return 2 * attrOf(attributes, axis) + lv;
}

/** 基础派生（不含天赋倍率） */
export function deriveBaseCombatStats(input: {
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

/**
 * 全属性倍率（规则钩子 `statMultiplier`，如 SSS「女王领域」+50%）。
 * 倍率 1 = 原样（零改动）；脏值按 1。
 */
export function applyStatMultiplier(
  stats: DerivedCombatStats,
  multiplier: number,
): DerivedCombatStats {
  const m =
    typeof multiplier === 'number' && Number.isFinite(multiplier) && multiplier > 0
      ? multiplier
      : 1;
  if (m === 1) return stats;
  return {
    atk: Math.round(stats.atk * m),
    guard: Math.round(stats.guard * m),
    agi: Math.round(stats.agi * m),
  };
}

/** 基础应对 → 反制行动：行动值取对应派生维，标签 = 同名单标签 */
export function basicCounterAction(move: BasicCounter, stats: DerivedCombatStats): SkirmishAction {
  const power = move === '强攻' ? stats.atk : move === '防御' ? stats.guard : stats.agi;
  return { label: move, power, tags: [move] };
}
