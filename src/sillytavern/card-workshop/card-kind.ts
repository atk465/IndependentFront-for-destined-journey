/**
 * card-kind.ts — 卡类型系统（形态词条制，八类）
 *
 * 裁定：docs/planning/2026-09-13-card-workshop-playable-loop-design.md §1（1.3a）
 *
 * 类型 = 形态词条：词条含对应形态词即该类型；八类皆无 = 技能卡（缺省）。
 * 多形态词条视为内容错误，按固定优先级取首个命中（防御性裁定，不炸）。
 * 「禁忌」是稀有类横切标记，不是类型（阶段 4 裁定）。
 *
 * 消耗分界（1.3）：技能/领域/场景 = 消耗（settlement 结算，哑火不耗）；
 * 装备/召唤/军团 = 永久；素材不可战斗打出（材料载体，炼制/修复/交易用）。
 *
 * 🔴 2026-09-18 主人裁决：**物资卡定位为纯道具卡**，脱离战斗体系 —— 不可编组、
 * 不计卡组战力、不可在交锋中打出；它的消耗发生在「道具使用」通道（卡册/背包页
 * 的使用按钮：消耗卡自身 + 按卡面 yield 产出物品），不参与 settlement 结算。
 * 由此 `isPlayable` 成为「能否编组 + 能否在战斗中打出」的**唯一判据**，
 * 编组面板 / deckPower / battleReadyCards 三处共用（此前它们零形态校验，
 * 素材卡禁打却可编组、还给开战防护加成）。
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

/** 类型判定（纯函数；词条含形态词即该类型，皆无 = 技能卡）。
 * 🔴 2026-09-13 真机：词条来自存档数据，**可能缺失或不是数组**（老档/AI 产物品/
 * 手工写入）——此前直接 .includes 会抛 TypeError 打断整个面板渲染。统一在此
 * 兜底成空数组（= 技能卡缺省），下游（deck-power/repair/commission/contract）
 * 全部经这里判定，一处兜底全链受益。 */
export function cardKindOf(词条: readonly string[] | null | undefined): CardKind {
  const words = Array.isArray(词条) ? 词条 : [];
  for (const kind of KIND_PRIORITY) {
    if (words.includes(KIND_ENTRY[kind])) return kind;
  }
  return DEFAULT_CARD_KIND;
}

/** 消耗性（1.3）：技能/领域/场景消耗；装备/召唤/军团永久。
 * 🔴 物资已退出战斗（2026-09-18 裁决）——它的消耗由道具使用通道处理，
 * 不再经 settlement，故此表不含物资。 */
const CONSUMABLE_KINDS: ReadonlySet<CardKind> = new Set<CardKind>(['技能', '领域', '场景']);

export function isConsumable(kind: CardKind): boolean {
  return CONSUMABLE_KINDS.has(kind);
}

/** 消耗性（string 宽接口）——跨模块投影边界用（CombatEvent 里的 kind 是 string） */
export function isConsumableKind(kind: string): boolean {
  return (CONSUMABLE_KINDS as ReadonlySet<string>).has(kind);
}

/**
 * 不可战斗打出的类型 —— **同时也是不可编入卡组的类型**：
 * - 素材：材料载体，炼制/修复/交易用
 * - 物资：纯道具卡（2026-09-18 裁决），走道具使用通道
 */
const UNPLAYABLE_KINDS: ReadonlySet<CardKind> = new Set<CardKind>(['素材', '物资']);

export function isPlayable(kind: CardKind): boolean {
  return !UNPLAYABLE_KINDS.has(kind);
}

/** 卡的便捷判定（供会话层/UI） */
export function cardKind(card: Pick<CardItem, '词条'>): CardKind {
  return cardKindOf(card.词条);
}

/** 这张卡能不能在战斗中打出（类型维度；实物维度（封印/损坏）由 battleReadyCards 把守）。
 * 编组资格 / 卡组战力 / 出卡候选三处共用这一条判据。 */
export function isPlayableCard(card: Pick<CardItem, '词条'>): boolean {
  return isPlayable(cardKindOf(card.词条));
}
