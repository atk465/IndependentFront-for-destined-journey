/**
 * conditional-bonus.ts — 条件数值加成（2026-09-17，A 级批次③）
 *
 * 三条 A 级天赋的共同形状：**条件成立 → 数值变化**。条件都可判定（卡组构成 /
 * 某类卡数量），所以抽成一个共用模块，而不是给每条天赋写一套分支。
 *
 *  - **荒野镖客**：卡组里没有伙伴卡 → 全属性 +25%
 *  - **战争之王**：伙伴卡越多，所有伙伴卡攻击越高（每张 +5%）
 *  - **集群母狗**：某类单位 ≥ 4 → 全属性 +10%，每多一个 +2%
 *
 * 阈值语义统一为**「达到即触发」（≥）**——所以描述里的「超过 3 个」写成
 * `threshold: 4`（超过 3 = 至少 4），不为「严格大于」另开一种语义。
 *
 * 加一条条件 = 加一行 `COND_RULES` + 必要时加一个求值分支；加一条天赋 = 加一个条目。
 *
 * 纯度约束：纯函数、不 mutate。
 */

import type { CardItem, InventoryItem } from '../types';
import { cardKindOf } from './card-kind';

/** 条件种类（引擎认得的；认不出的条件 → 不生效） */
export type CondKind = '无伙伴卡' | '伙伴卡数' | '犬类卡数';

/** 条件求值规则（加条件 = 加一行） */
export const COND_RULES: Readonly<
  Record<CondKind, { kinds?: readonly string[]; keyword?: string }>
> = {
  无伙伴卡: { kinds: ['召唤', '军团'] },
  伙伴卡数: { kinds: ['召唤', '军团'] },
  // 「母狗单位」在引擎里无法区分性别/物种语义，按**词条或卡名含「犬」**近似
  犬类卡数: { keyword: '犬' },
};

/** 一条条件加成（读自天赋条目） */
export interface CondBonus {
  cond: CondKind;
  threshold: number;
  percent: number;
  perExtra: number;
}

/** 宽读一条条目；认不出的条件名 → undefined（宁可不生效，也不乱算） */
export function coerceCondBonus(raw: {
  cond?: unknown;
  threshold?: unknown;
  percent?: unknown;
  perExtra?: unknown;
}): CondBonus | undefined {
  const cond = typeof raw.cond === 'string' ? (raw.cond.trim() as CondKind) : undefined;
  if (!cond || !(cond in COND_RULES)) return undefined;
  const num = (v: unknown, fallback = 0): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    cond,
    threshold: Math.max(0, Math.round(num(raw.threshold))),
    percent: Math.max(0, Math.round(num(raw.percent))),
    perExtra: Math.max(0, Math.round(num(raw.perExtra))),
  };
}

/** 从天赋条目收集条件加成 */
export function condBonusesOf(
  talents:
    | readonly { entries?: readonly { kind: string; params: Record<string, unknown> }[] }[]
    | undefined,
): CondBonus[] {
  const out: CondBonus[] = [];
  for (const t of talents ?? []) {
    for (const e of t.entries ?? []) {
      if (e.kind !== '条件加成') continue;
      const spec = coerceCondBonus(e.params);
      if (spec) out.push(spec);
    }
  }
  return out;
}

/** 卡组里的卡（按名从背包取真卡；取不到的跳过） */
export function deckCards(
  deck: readonly string[] | undefined,
  inventory: readonly InventoryItem[] | undefined,
): CardItem[] {
  const out: CardItem[] = [];
  for (const name of deck ?? []) {
    const hit = (inventory ?? []).find((i) => i.name === name && i.type === '卡牌');
    if (hit) out.push(hit as CardItem);
  }
  return out;
}

/** 数一数符合条件的卡有几张 */
export function countMatching(
  cards: readonly CardItem[],
  rule: { kinds?: readonly string[]; keyword?: string },
): number {
  let n = 0;
  for (const c of cards) {
    if (rule.kinds && !rule.kinds.includes(cardKindOf(c.词条 ?? []))) continue;
    if (rule.keyword) {
      const hit =
        (c.词条 ?? []).some((w) => w.includes(rule.keyword!)) || c.name.includes(rule.keyword);
      if (!hit) continue;
    }
    n++;
  }
  return n;
}

/** 单条条件的求值结果 */
export interface CondEval {
  spec: CondBonus;
  /** 实际数到的数量 */
  count: number;
  /** 是否触发 */
  met: boolean;
  /** 触发时的总加成百分比（percent + perExtra × 超出部分） */
  bonus: number;
  note?: string;
}

/**
 * 求值一条条件（纯函数）。
 *
 * 「无伙伴卡」是**反向条件**：数量为 0 才触发（阈值不参与）；
 * 其余条件为「数量 ≥ 阈值」。
 */
export function evalCondBonus(spec: CondBonus, cards: readonly CardItem[]): CondEval {
  const rule = COND_RULES[spec.cond];
  const count = countMatching(cards, rule);
  if (spec.cond === '无伙伴卡') {
    const met = count === 0;
    return {
      spec,
      count,
      met,
      bonus: met ? spec.percent : 0,
      ...(met ? { note: `【孤狼】卡组里没有伙伴卡——全属性 +${spec.percent}%` } : {}),
    };
  }
  const met = count >= spec.threshold;
  if (!met) return { spec, count, met: false, bonus: 0 };
  const extra = Math.max(0, count - spec.threshold);
  const bonus = spec.percent + spec.perExtra * extra;
  return {
    spec,
    count,
    met: true,
    bonus,
    note: `【${spec.cond}】${count} 个 → 加成 +${bonus}%`,
  };
}

/** 汇总玩家全部条件加成（只返回触发的那几条） */
export function totalCondBonus(
  talents:
    | readonly { entries?: readonly { kind: string; params: Record<string, unknown> }[] }[]
    | undefined,
  deck: readonly string[] | undefined,
  inventory: readonly InventoryItem[] | undefined,
): { percent: number; notes: string[]; evals: CondEval[] } {
  const cards = deckCards(deck, inventory);
  const evals = condBonusesOf(talents).map((s) => evalCondBonus(s, cards));
  const met = evals.filter((e) => e.met);
  return {
    percent: met.reduce((sum, e) => sum + e.bonus, 0),
    notes: met.map((e) => e.note ?? '').filter(Boolean),
    evals,
  };
}
