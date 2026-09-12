/**
 * card-kind.ts — 卡类型系统（形态词条制，八类）
 *
 * 裁定：docs/planning/2026-09-13-card-workshop-playable-loop-design.md §1（1.3a）
 *
 * 类型 = 形态词条：词条含对应形态词即该类型；八类皆无 = 技能卡（缺省）。
 * 多形态词条视为内容错误，按固定优先级取首个命中（防御性裁定，不炸）。
 * 「禁忌」是稀有类横切标记，不是类型（阶段 4 裁定）。
 *
 * 消耗分界（1.3）：技能/领域/场景/物资 = 消耗（settlement 结算，哑火不耗）；
 * 装备/召唤/军团 = 永久；素材不可战斗打出（材料载体，炼制/修复/交易用）。
 */

import { LANDSCAPE_ENTRY } from './landscape';
import type { CardItem } from '../types';

/** 八类卡类型（中文集中定义） */
export const CARD_KINDS = ['装备', '技能', '领域', '召唤', '军团', '物资', '场景', '素材'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** 缺省类型：技能卡（词条无任何形态词） */
export const DEFAULT_CARD_KIND: CardKind = '技能';

/** 类型 → 形态词条（领域卡沿用「地景」词条——combat-v3 的地景通道判据） */
export const KIND_ENTRY: Readonly<Record<CardKind, string>> = {
  装备: '装备',
  技能: '技能',
  领域: LANDSCAPE_ENTRY,
  召唤: '召唤',
  军团: '军团',
  物资: '物资',
  场景: '场景',
  素材: '素材',
};

/** 多形态词条时的判定优先级（缺省技能不参与循环） */
const KIND_PRIORITY: readonly CardKind[] = ['召唤', '军团', '装备', '领域', '场景', '物资', '素材'];

/** 类型判定（纯函数；词条含形态词即该类型，皆无 = 技能卡） */
export function cardKindOf(词条: readonly string[]): CardKind {
  for (const kind of KIND_PRIORITY) {
    if (词条.includes(KIND_ENTRY[kind])) return kind;
  }
  return DEFAULT_CARD_KIND;
}

/** 消耗性（1.3）：技能/领域/场景/物资消耗；装备/召唤/军团永久 */
const CONSUMABLE_KINDS: ReadonlySet<CardKind> = new Set<CardKind>(['技能', '领域', '场景', '物资']);

export function isConsumable(kind: CardKind): boolean {
  return CONSUMABLE_KINDS.has(kind);
}

/** 消耗性（string 宽接口）——跨模块投影边界用（CombatEvent 里的 kind 是 string） */
export function isConsumableKind(kind: string): boolean {
  return (CONSUMABLE_KINDS as ReadonlySet<string>).has(kind);
}

/** 不可战斗打出的类型（素材 = 材料载体，炼制/修复/交易用） */
const UNPLAYABLE_KINDS: ReadonlySet<CardKind> = new Set<CardKind>(['素材']);

export function isPlayable(kind: CardKind): boolean {
  return !UNPLAYABLE_KINDS.has(kind);
}

/** 卡的便捷判定（供会话层/UI） */
export function cardKind(card: Pick<CardItem, '词条'>): CardKind {
  return cardKindOf(card.词条);
}

/** 这张卡能不能在战斗中打出（类型维度；编组/实物维度由会话层解析器把守） */
export function isPlayableCard(card: Pick<CardItem, '词条'>): boolean {
  return isPlayable(cardKindOf(card.词条));
}
