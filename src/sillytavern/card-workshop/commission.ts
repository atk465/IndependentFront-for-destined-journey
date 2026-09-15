/**
 * commission.ts — 委托引擎核心（卡牌工坊 可玩闭环 6/9）
 *
 * 共识裁定（playable-loop 设计 §3 分支 2）：
 * - 验收 = **组合过滤器制**：minTier（品质下限）/ formEntry（形态词条）/
 *   elements（元素）/ exactName（精确卡名）全可选全组合，**全命中才合格**；
 *   纯函数判定，零 AI 参与（铁律③：Code 判数值）。
 * - 交付 = **上交制**：合格卡从背包移除，与奖励（GC/素材/声望）同一次原子提交——
 *   防刷是结构性的（每次奖励背后都有一张真实消耗的卡）。
 * - 已契约召唤卡可自由交付（卡消失 = 契约解除、伙伴角色留存；UI 警告不硬禁）。
 *
 * 委托模板 = 内容数据（内容包第 15 分节 / 世界书承载，注入面后续接线）；
 * 本模块只做模板的容错解析与交付规划，被内容注册表/UI 消费。
 */

import { CARD_TIERS, type CardTier } from '../field-enums';
import type { CardItem, StatePatch } from '../types';
import { cardKindOf } from './card-kind';

/** 验收过滤器（全字段可选；空对象 = 万能收购） */
export interface CommissionRequirement {
  /** 品质下限（cardTier 档位 ≥） */
  minTier?: CardTier;
  /** 形态词条（八类之一，如「地景」「召唤」） */
  formEntry?: string;
  /** 元素要求（词条须全部包含） */
  elements?: readonly string[];
  /** 精确卡名（剧情委托专用，如「寻回失窃的传家卡」） */
  exactName?: string;
}

/** 委托定义（内容数据的引擎侧形状） */
export interface CommissionDef {
  name: string;
  description?: string;
  requireCard: CommissionRequirement;
  /** 奖励包：赏金（GC）/ 声望（'profile.reputation' delta）/ 素材（add_item） */
  rewards: {
    gc?: number;
    reputation?: number;
    materials?: readonly { name: string; quantity: number }[];
  };
}

// ═══════════════════════════════════════════════════════════
// 事件委托（随机事件 × 委托板融合，2026-09-16）
// ═══════════════════════════════════════════════════════════

/**
 * 事件委托模板 —— 随机事件定义（`RandomEventDef.commission`）里声明的委托形状。
 * = 委托定义 + 有效期；被 AI 认领事件结算时实例化进存档（`worldFlags.randomEvents.eventCommissions`）。
 */
export interface EventCommissionTemplate extends CommissionDef {
  /** 有效期（gameDay）；缺省 7 天。过期自动清理（`pruneEventCommissions`） */
  ttlDays?: number;
}

/** 已实例化的动态委托（每存档，落在 `worldFlags.randomEvents.eventCommissions`） */
export interface EventCommission {
  /** 委托定义本体（交付/注入直接吃它，与静态委托同形状） */
  def: CommissionDef;
  /** 来源事件名（溯源与同名去重） */
  sourceEvent: string;
  /** 触发日（gameDay） */
  armedDay: number;
  /** 过期日（gameDay；armedDay + ttlDays） */
  expiresDay: number;
}

/**
 * 容错解析委托清单（照 random-event-pack 口径：非数组 → []；
 * name 非串 / requireCard 非对象的条目逐条丢，永不抛）。
 */
export function coerceCommissions(raw: unknown): CommissionDef[] {
  if (!Array.isArray(raw)) return [];
  const out: CommissionDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    if (typeof c['name'] !== 'string' || c['name'].length === 0) continue;
    if (!c['requireCard'] || typeof c['requireCard'] !== 'object') continue;
    const req = c['requireCard'] as Record<string, unknown>;
    const rewards = (c['rewards'] ?? {}) as Record<string, unknown>;
    const elements = Array.isArray(req['elements'])
      ? (req['elements'] as unknown[]).filter((e): e is string => typeof e === 'string')
      : undefined;
    const materials = Array.isArray(rewards['materials'])
      ? (rewards['materials'] as unknown[])
          .filter(
            (m): m is { name: string; quantity: number } =>
              !!m &&
              typeof m === 'object' &&
              typeof (m as Record<string, unknown>)['name'] === 'string',
          )
          .map((m) => ({
            name: (m as Record<string, unknown>)['name'] as string,
            quantity:
              typeof (m as Record<string, unknown>)['quantity'] === 'number'
                ? ((m as Record<string, unknown>)['quantity'] as number)
                : 1,
          }))
      : undefined;
    out.push({
      name: c['name'],
      description: typeof c['description'] === 'string' ? c['description'] : undefined,
      requireCard: {
        minTier: (CARD_TIERS as readonly string[]).includes(req['minTier'] as string)
          ? (req['minTier'] as CardTier)
          : undefined,
        formEntry: typeof req['formEntry'] === 'string' ? req['formEntry'] : undefined,
        elements,
        exactName: typeof req['exactName'] === 'string' ? req['exactName'] : undefined,
      },
      rewards: {
        gc: typeof rewards['gc'] === 'number' ? rewards['gc'] : undefined,
        reputation: typeof rewards['reputation'] === 'number' ? rewards['reputation'] : undefined,
        materials,
      },
    });
  }
  return out;
}

/**
 * 组合过滤器（全命中才合格）：品质下限 / 形态词条 / 元素全含 / 精确名。
 * 空要求对象 = 任何卡都合格（万能收购；模板侧应避免无差别要求）。
 */
export function matchesCommission(
  card: Pick<CardItem, 'name' | 'cardTier' | '词条'>,
  req: CommissionRequirement,
): boolean {
  if (
    req.minTier !== undefined &&
    CARD_TIERS.indexOf(card.cardTier) < CARD_TIERS.indexOf(req.minTier)
  ) {
    return false;
  }
  if (req.formEntry !== undefined && !card.词条.includes(req.formEntry)) return false;
  if (req.elements?.some((e) => !card.词条.includes(e))) return false;
  if (req.exactName !== undefined && card.name !== req.exactName) return false;
  return true;
}

/** 从清单里找出卡能满足的所有委托（UI 可选卡时高亮可交付项） */
export function matchingCommissions(
  card: Pick<CardItem, 'name' | 'cardTier' | '词条'>,
  commissions: readonly CommissionDef[],
): CommissionDef[] {
  return commissions.filter((c) => matchesCommission(card, c.requireCard));
}

/**
 * 交付 patches 规划（上交制）：卡移除 + 奖励同一次原子提交（不变量④由调用方的
 * commitChatState 保证）。素材不足的奖励条目由调用方按背包校验后传入。
 */
export function buildDeliveryPatches(
  def: CommissionDef,
  card: Pick<CardItem, 'name'>,
  playerName: string,
): StatePatch[] {
  const patches: StatePatch[] = [
    // 上交：卡从背包移除（quantity 1——每次交付一张）
    {
      op: 'remove_item',
      target: `characters.${playerName}`,
      value: { name: card.name, quantity: 1 },
    },
  ];
  if (def.rewards.gc) {
    patches.push({
      op: 'update_character',
      target: `characters.${playerName}`,
      value: { money: def.rewards.gc },
      metadata: { delta: true, source: 'commission' },
    });
  }
  if (def.rewards.reputation) {
    patches.push({
      op: 'delta_variable',
      target: 'profile.reputation',
      amount: def.rewards.reputation,
      metadata: { source: 'commission' },
    });
  }
  for (const m of def.rewards.materials ?? []) {
    patches.push({
      op: 'add_item',
      target: `characters.${playerName}`,
      value: { name: m.name, quantity: m.quantity, type: '材料' },
    });
  }
  return patches;
}

/** 交付类型的便捷判定（素材卡不可交付——它是材料载体不是供给物） */
export function isDeliverableCard(card: Pick<CardItem, '词条'>): boolean {
  return cardKindOf(card.词条) !== '素材';
}

// ========== 交付规划（切片 C：校验 + 补丁一步；调用方只管原子提交） ==========

export interface CommissionDeliveryPlan {
  ok: boolean;
  reason?: string;
  patches: StatePatch[];
}

/**
 * 委托交付规划：校验（委托存在 / 卡在背包且可交付 / matchesCommission 验收）
 * → buildDeliveryPatches 一次性出全部补丁（上交 + 赏金 + 声望 + 素材）。
 * 提交（commitChatState）由调用方做——不变量④：上交与奖励同窗原子。
 */
export function planCommissionDelivery(input: {
  commissions: readonly CommissionDef[];
  commissionName: string;
  card: Pick<CardItem, 'name' | 'cardTier' | '词条'> | undefined;
  playerName: string;
}): CommissionDeliveryPlan {
  const def = input.commissions.find((c) => c.name === input.commissionName);
  if (!def)
    return { ok: false, reason: `委托板上没有「${input.commissionName}」这张委托`, patches: [] };
  if (!input.card) {
    return {
      ok: false,
      reason: `背包里没有可交付的【${input.commissionName}】目标卡`,
      patches: [],
    };
  }
  if (!matchesCommission(input.card, def.requireCard)) {
    return {
      ok: false,
      reason: `【${input.card.name}】不符合「${def.name}」的收卡要求`,
      patches: [],
    };
  }
  return {
    ok: true,
    patches: buildDeliveryPatches(def, { name: input.card.name }, input.playerName),
  };
}
