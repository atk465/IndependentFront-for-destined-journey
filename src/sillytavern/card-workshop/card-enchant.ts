/**
 * card-enchant.ts — 附魔（2026-09-25 效果批四）
 *
 * 给已有战斗卡**追加**效果池内的效果：卡面登记效果（cardEffects）从现有条数
 * 扩到最多 2 条（与 AI 池内选的门禁上限一致）。规则：
 * - 只有可打出形态（技能/装备/领域/召唤/军团/场景）能附魔；物资/素材是道具/原料
 * - 单卡同名效果唯一（重复附魔同效果 = 拒绝）；总条数上限 2
 * - 造价 = 60 GC 基础 + 池内定值 × 2（效果越强越贵）；金钱不足拒绝
 * - 附魔不可逆（落库前 UI 有预览，本函数只算不写）
 *
 * 纯度约束：无 I/O、无 Vue。落库由调用方（game-store）提交。
 */

import type { CardTier } from '../field-enums';
import { cardKindOf } from './card-kind';
import {
  coerceCardEffects,
  poolEntryOf,
  type CardEffectDef,
  type CardEffects,
} from './card-effects';

/** 附魔单条造价：基础 60 GC + 池内定值 × 2 */
export const ENCHANT_BASE_COST = 60;

export interface EnchantInput {
  card: {
    name: string;
    cardTier: CardTier;
    词条: readonly string[] | null | undefined;
    cardEffects?: unknown;
  };
  /** 要附魔上去的效果（AI/玩家从池内选；此处再过门禁） */
  effect: { trigger: string; target: string; action: string; value: number; duration?: number };
  money: number;
}

export type EnchantPlan = {
  ok: boolean;
  reason?: string;
  /** 门禁后的新效果条（落库追加用） */
  effect?: CardEffectDef;
  /** 总造价（GC） */
  cost?: number;
  /** 附魔后的完整效果集（排序稳定，供预览与落库） */
  nextEffects?: CardEffectDef[];
};

/**
 * 附魔规划（纯函数）：校验（形态/重复/条数/门禁/造价）→ 追加后的效果集与造价。
 * 门禁口径与 craft_gen 池内选同源——动作必须在池内、数值逐字照抄定值。
 */
export function planEnchant(input: EnchantInput): EnchantPlan {
  const kind = cardKindOf(input.card.词条);
  if (kind === '物资' || kind === '素材') {
    return {
      ok: false,
      reason: `【${input.card.name}】是${kind}卡——物资走道具通道，素材是制卡原料，都不能附魔`,
    };
  }

  // 门禁：单条合法（池内动作 + 定值逐字）
  const gate = coerceSingle(input.effect);
  if (!gate) return { ok: false, reason: '该效果不在效果池内（或数值与池内定值不符）' };

  // 现有效果集（存档 cardEffects 可能是脏数据——逐条门禁后取合法集）
  const existing = coerceExisting(input.card.cardEffects);

  // 同名效果唯一：同一动作不重复登记
  if (existing.some((e) => e.action === gate.action)) {
    return {
      ok: false,
      reason: `【${input.card.name}】已有「${gate.action}」效果——同名效果不叠加，换个效果试试`,
    };
  }
  if (existing.length >= 2) {
    return { ok: false, reason: '每张卡最多登记 2 条效果——先选一张空位多的卡' };
  }

  const entry = poolEntryOf(gate.action)!;
  const cost = ENCHANT_BASE_COST + entry.value * 2;
  if (input.money < cost) {
    return { ok: false, reason: `附魔需要 ${cost} GC（当前 ${input.money}）` };
  }

  const nextEffects = [...existing, gate].sort((a, b) => a.action.localeCompare(b.action));
  return { ok: true, effect: gate, cost, nextEffects };
}

/** 单条门禁（复用 coerceCardEffects 的逐条口径：构造单条数组过筛） */
function coerceSingle(raw: {
  trigger: string;
  target: string;
  action: string;
  value: number;
  duration?: number;
}): CardEffectDef | undefined {
  const [one] = coerceCardEffects([raw]);
  return one;
}

/** 存档 cardEffects 宽读：脏数据逐条丢弃（与读侧门禁同口径） */
function coerceExisting(raw: unknown): CardEffects {
  return coerceCardEffects(raw);
}

/** 附魔后的动作名列表（UI 展示辅助） */
export function enchantSummary(effects: CardEffects): string {
  return effects.length > 0 ? effects.map((e) => e.action).join('、') : '（无登记效果）';
}
