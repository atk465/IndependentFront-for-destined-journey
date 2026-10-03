/**
 * companion-talent.ts — 伙伴天赋池（伙伴实体化 D11，批④任务书 B4.6）
 *
 * 借用玩家天赋骨架池：kind 全部取既有 TalentEntryKind、channel 固定 'universal'。
 * AI 叙事只选 kind（限池内）与 name（≤12 字）——「AI 只选不改数」：
 * params 由引擎按品阶系数定标（round(base × coef)），回落表按卡首元素定 kind。
 *
 * Code 路径直写（buildSummonCompanion 组装 talents），不经 state-manager 天赋门禁。
 * 消费点（批④ B4.7）：行动值/防御/体魄/威压在基座与挡刀位建立处；
 * 嗜血/暴击在行动值组装处（照玩家既有暴击/连战语义）。
 */

import type { CardTier } from '../field-enums';
import type { CharacterState } from '../types';
import type { TalentEntryKind } from './talent-entry';

/** 伙伴天赋池（kind + params 基数；kind 均为既有 TalentEntryKind） */
export const COMPANION_TALENT_POOL: readonly { kind: TalentEntryKind; base: number }[] = [
  { kind: '行动值加成', base: 4 }, // 基座行动值 +bonus
  { kind: '防御加值', base: 3 }, // 伙伴防派生 +bonus
  { kind: '体魄', base: 10 }, // maxHp ×(1+pct/100)
  { kind: '威压', base: 8 }, // session 威胁 ×(1−pct/100)
  { kind: '嗜血', base: 15 }, // guard.hp<30% 时行动值 ×(1+pct/100)
  { kind: '暴击', base: 8 }, // 反制掷骰暴击判定（照玩家既有暴击语义）
] as const;

/** 品阶系数（round 取整：params = round(base × coef)） */
export const COMPANION_TALENT_TIER_COEF: Record<CardTier, number> = {
  黑铁: 1.0,
  青铜: 1.25,
  白银: 1.5,
  鎏金: 1.8,
  星辉: 2.2,
};

/** kind 是否在伙伴池内（AI 提名白名单校验） */
export function isCompanionTalentKind(kind: string | undefined): kind is TalentEntryKind {
  if (!kind) return false;
  return COMPANION_TALENT_POOL.some((t) => t.kind === kind);
}

/** params 定标：round(基数 × 品阶系数) */
export function companionTalentParamsOf(cardTier: CardTier, kind: TalentEntryKind): number {
  const def = COMPANION_TALENT_POOL.find((t) => t.kind === kind);
  if (!def) return 0;
  const coef = COMPANION_TALENT_TIER_COEF[cardTier] ?? 1;
  return Math.round(def.base * coef);
}

/**
 * 回落表（B4.6）：AI 未给合法 <talent_kind> 时按卡首命中元素定 kind——
 * 火→嗜血 / 暗→暴击 / 土→体魄 / 金→防御加值 / 雷·风→行动值加成 /
 * 水·冰·光→威压 / 无元素（或未命中表）→行动值加成。
 */
const FALLBACK_BY_ELEMENT: Record<string, TalentEntryKind> = {
  火: '嗜血',
  暗: '暴击',
  土: '体魄',
  金: '防御加值',
  雷: '行动值加成',
  风: '行动值加成',
  水: '威压',
  冰: '威压',
  光: '威压',
};

export function fallbackTalentKindOf(词条: readonly string[] | null | undefined): TalentEntryKind {
  const words = Array.isArray(词条) ? 词条 : [];
  for (const w of words) {
    const kind = FALLBACK_BY_ELEMENT[w];
    if (kind) return kind;
  }
  return '行动值加成';
}

/** 消费侧读取：entity.talents.list[0] 的条目命中伙伴池 → { kind, params }（否则 null） */
export function companionTalentOf(
  entity: CharacterState | undefined,
): { kind: TalentEntryKind; params: number } | null {
  const first = entity?.talents?.list?.[0];
  if (!first) return null;
  for (const entry of first.entries ?? []) {
    if (isCompanionTalentKind(entry.kind)) {
      const bonus = Number(entry.params?.bonus);
      return { kind: entry.kind, params: Number.isFinite(bonus) ? bonus : 0 };
    }
  }
  return null;
}

/** 建账（B4.6）：AI 提名的 kind/name 非法时按回落表与 `${品阶}·${kind}` 兜底 */
export function buildCompanionTalent(
  cardTier: CardTier,
  词条: readonly string[],
  talentKind?: string,
  talentName?: string,
): { name: string; kind: TalentEntryKind; params: number } {
  const kind = isCompanionTalentKind(talentKind) ? talentKind : fallbackTalentKindOf(词条);
  const name = (talentName ?? '').trim().slice(0, 12) || `${cardTier}·${kind}`;
  return { name, kind, params: companionTalentParamsOf(cardTier, kind) };
}
