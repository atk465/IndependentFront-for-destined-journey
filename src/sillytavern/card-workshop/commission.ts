/**
 * commission.ts — 委托引擎核心（卡牌工坊 可玩闭环 6/9）
 *
 * 共识裁定（playable-loop 设计 §3 分支 2 + 委托×地图闭环 2026-09-19 共识稿）：
 * - 验收 = **组合过滤器制**：minTier（品质下限）/ formEntry（形态词条）/
 *   elements（元素）/ exactName（精确卡名）全可选全组合，**全命中才合格**；
 *   纯函数判定，零 AI 参与（铁律③：Code 判数值）。
 * - 交付 = **上交制**：合格卡从背包移除，与奖励（GC/素材/声望/独家卡）同一次原子提交——
 *   防刷是结构性的（每次奖励背后都有一张真实消耗的卡）。
 * - 已契约召唤卡可自由交付（卡消失 = 契约解除、伙伴角色留存；UI 警告不硬禁）。
 *
 * 委托 × 地图闭环新增四种要求（四选一即可成立，至少要有一种）：
 *   requireCard（收卡，原有）/ requireMaterial（缴独家素材）/ requireVisit（到访计数，
 *   基线快照在 commission-active）/ finale（链终点三型场景获得）。
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

// ═══════════════════════════════════════════════════════════
// 委托 × 地图闭环（2026-09-19 设计共识稿，13 条决议）
// ═══════════════════════════════════════════════════════════

/** 委托品级（生成填充驻低级、手写链驻高级；A/S 级交付要走发布中层，见 requiresIssuerDelivery） */
export type CommissionGrade = 'D' | 'C' | 'B' | 'A' | 'S';

/** 品级显示顺序（UI 排序用） */
export const COMMISSION_GRADES: readonly CommissionGrade[] = ['D', 'C', 'B', 'A', 'S'];

/** 素材需求（素材即凭证：独家素材只在中层覆写表里出产，拿到 = 去过的证明） */
export interface MaterialRequirement {
  name: string;
  count: number;
}

/** 到访需求（到访即计：落格 +1 计数；接取时快照基线，`当前 ≥ 基线 + count` 才算数） */
export interface VisitRequirement {
  /** 目的地中层 id */
  midTier: string;
  count: number;
}

/** 链终点型（场景获得：卡在那座危险的地方被换来，不是回城被递过来） */
export type CommissionFinaleType = '谜题' | '强敌' | '场景制卡';

export interface CommissionFinale {
  type: CommissionFinaleType;
  /** 谜题型=终点事件名；强敌型=遭遇/敌人名；场景制卡型=目标卡名 */
  target?: string;
  /** 场景制卡型：配方（独家素材，人在目的地中层现场制出） */
  materials?: readonly { name: string; quantity: number }[];
}

/** 卡奖励（终点是机械承诺：Code 补丁保底 + AI 叙事拍给仪式，发放永不被叙事阻塞） */
export interface CardReward {
  /** 卡名——引用卡池/自定义卡（单一真源），不内嵌卡定义 */
  name: string;
  /** delivery=交付时发（默认）；scene=终点场景行为完成时发（finale 委托用） */
  grantAt?: 'delivery' | 'scene';
}

/** 委托定义（内容数据的引擎侧形状） */
export interface CommissionDef {
  name: string;
  description?: string;
  /** 卡验收（与素材/到访/终点四选其一即可成立，至少要有一种） */
  requireCard?: CommissionRequirement;
  /** 素材需求（采集委托：缴纳 N×独家素材） */
  requireMaterial?: MaterialRequirement;
  /** 到访需求（探索委托：接取后到目的地中层 N 次） */
  requireVisit?: VisitRequirement;
  /** 链终点（三型场景获得；场景行为完成 = 委托完成，无交付步骤） */
  finale?: CommissionFinale;
  /** 品级；缺省 = 普通委托（面板交付、无违约罚） */
  grade?: CommissionGrade;
  /** 目的地中层 id（「去哪儿」——素材在该层出产、到访在该层计数、终点在该层发生） */
  destMidTier?: string;
  /** 发布中层 id（A/S 级的交付地：必须人在此中层才能交差，「回来」是远征的收尾拍） */
  issuerMidTier?: string;
  /** 时限（天，自接取起算）；缺省 = 无时限。生成填充默认 7 */
  deadlineDays?: number;
  /** 任务链 id（同链按 chainOrder 升序，完成第 N 节解锁第 N+1 节） */
  chainId?: string;
  /** 链内节序（1 起） */
  chainOrder?: number;
  /** 奖励包：赏金（GC）/ 声望（'profile.reputation' delta）/ 素材（add_item）/ 独家卡 */
  rewards: {
    gc?: number;
    reputation?: number;
    materials?: readonly { name: string; quantity: number }[];
    /** 终点奖励：独家卡（发放 = Code 补丁；命名引用卡池/自定义卡） */
    card?: CardReward;
  };
}

/** A/S 级交付地校验：有发布中层的 A/S 级委托必须人在发布中层才能交差（品级分流） */
export function requiresIssuerDelivery(def: Pick<CommissionDef, 'grade' | 'issuerMidTier'>): boolean {
  return (def.grade === 'A' || def.grade === 'S') && !!def.issuerMidTier;
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
 * name 非串 / 四种要求（卡/素材/到访/终点）一种都没有的条目逐条丢，永不抛）。
 */
export function coerceCommissions(raw: unknown): CommissionDef[] {
  if (!Array.isArray(raw)) return [];
  const out: CommissionDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    if (typeof c['name'] !== 'string' || c['name'].length === 0) continue;
    const req = isRecord(c['requireCard']) ? (c['requireCard'] as Record<string, unknown>) : {};
    const rewards = isRecord(c['rewards']) ? (c['rewards'] as Record<string, unknown>) : {};
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
    const requireCard: CommissionRequirement = {
      minTier: (CARD_TIERS as readonly string[]).includes(req['minTier'] as string)
        ? (req['minTier'] as CardTier)
        : undefined,
      formEntry: typeof req['formEntry'] === 'string' ? req['formEntry'] : undefined,
      elements,
      exactName: typeof req['exactName'] === 'string' ? req['exactName'] : undefined,
    };
    const requireMaterial = coerceMaterialRequirement(c['requireMaterial']);
    const requireVisit = coerceVisitRequirement(c['requireVisit']);
    const finale = coerceFinale(c['finale']);
    // 至少要有一种要求，否则这条委托没有成立条件（空壳丢掉）。
    // requireCard 是**对象就算数**（空对象 = 万能收购，既有语义）；没有 requireCard
    // 键的条目则必须靠素材/到访/终点成立。
    const hasCardReq = isRecord(c['requireCard']);
    if (!hasCardReq && !requireMaterial && !requireVisit && !finale) continue;
    const grade = (COMMISSION_GRADES as readonly string[]).includes(c['grade'] as string)
      ? (c['grade'] as CommissionGrade)
      : undefined;
    const rawCard = isRecord(rewards['card']) ? (rewards['card'] as Record<string, unknown>) : undefined;
    out.push({
      name: c['name'],
      description: typeof c['description'] === 'string' ? c['description'] : undefined,
      requireCard,
      ...(requireMaterial ? { requireMaterial } : {}),
      ...(requireVisit ? { requireVisit } : {}),
      ...(finale ? { finale } : {}),
      ...(grade ? { grade } : {}),
      ...(typeof c['destMidTier'] === 'string' && c['destMidTier'].length > 0
        ? { destMidTier: c['destMidTier'] }
        : {}),
      ...(typeof c['issuerMidTier'] === 'string' && c['issuerMidTier'].length > 0
        ? { issuerMidTier: c['issuerMidTier'] }
        : {}),
      ...(typeof c['deadlineDays'] === 'number' && Number.isFinite(c['deadlineDays']) && c['deadlineDays'] > 0
        ? { deadlineDays: Math.floor(c['deadlineDays']) }
        : {}),
      ...(typeof c['chainId'] === 'string' && c['chainId'].length > 0 ? { chainId: c['chainId'] } : {}),
      ...(typeof c['chainOrder'] === 'number' && Number.isFinite(c['chainOrder'])
        ? { chainOrder: Math.max(1, Math.floor(c['chainOrder'])) }
        : {}),
      rewards: {
        gc: typeof rewards['gc'] === 'number' ? rewards['gc'] : undefined,
        reputation: typeof rewards['reputation'] === 'number' ? rewards['reputation'] : undefined,
        materials,
        ...(rawCard && typeof rawCard['name'] === 'string' && rawCard['name'].length > 0
          ? {
              card: {
                name: rawCard['name'] as string,
                grantAt: rawCard['grantAt'] === 'scene' ? 'scene' : 'delivery',
              } as CardReward,
            }
          : {}),
      },
    });
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function coerceMaterialRequirement(raw: unknown): MaterialRequirement | undefined {
  if (!isRecord(raw)) return undefined;
  const name = raw['name'];
  const count = raw['count'];
  if (typeof name !== 'string' || name.length === 0) return undefined;
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return undefined;
  return { name, count: Math.max(1, Math.floor(count)) };
}

function coerceVisitRequirement(raw: unknown): VisitRequirement | undefined {
  if (!isRecord(raw)) return undefined;
  const midTier = raw['midTier'];
  const count = raw['count'];
  if (typeof midTier !== 'string' || midTier.length === 0) return undefined;
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return undefined;
  return { midTier, count: Math.max(1, Math.floor(count)) };
}

function coerceFinale(raw: unknown): CommissionFinale | undefined {
  if (!isRecord(raw)) return undefined;
  const type = raw['type'];
  if (type !== '谜题' && type !== '强敌' && type !== '场景制卡') return undefined;
  const materials = Array.isArray(raw['materials'])
    ? (raw['materials'] as unknown[])
        .map((m) => coerceFinaleMaterial(m))
        .filter((m): m is { name: string; quantity: number } => !!m)
    : undefined;
  return {
    type,
    ...(typeof raw['target'] === 'string' && raw['target'].length > 0
      ? { target: raw['target'] as string }
      : {}),
    ...(materials && materials.length > 0 ? { materials } : {}),
  };
}

/** 终点配方条目（quantity 键为主，兼容 count 键） */
function coerceFinaleMaterial(raw: unknown): { name: string; quantity: number } | undefined {
  if (!isRecord(raw)) return undefined;
  const name = raw['name'];
  if (typeof name !== 'string' || name.length === 0) return undefined;
  const n = raw['quantity'] ?? raw['count'];
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return undefined;
  return { name, quantity: Math.max(1, Math.floor(n)) };
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

/** 从清单里找出卡能满足的所有委托（UI 可选卡时高亮可交付项；非卡委托天然不命中） */
export function matchingCommissions(
  card: Pick<CardItem, 'name' | 'cardTier' | '词条'>,
  commissions: readonly CommissionDef[],
): CommissionDef[] {
  return commissions.filter((c) => matchesCommission(card, c.requireCard ?? {}));
}

/** 奖励补丁（赏金 + 声望 + 素材 + 独家卡）——卡交付/素材交付两条交付路共用 */
export function rewardPatches(
  def: CommissionDef,
  playerName: string,
  rewardCard?: CardItem,
): StatePatch[] {
  const patches: StatePatch[] = [];
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
  if (rewardCard) {
    patches.push({
      op: 'add_item',
      target: `characters.${playerName}`,
      value: rewardCard as unknown as Record<string, unknown>,
    });
  }
  return patches;
}

/**
 * 交付 patches 规划（上交制）：卡移除 + 奖励同一次原子提交（不变量④由调用方的
 * commitChatState 保证）。素材不足的奖励条目由调用方按背包校验后传入。
 * `rewardCard`：rewards.card 的交付时发放（grantAt='delivery'）——调用方先按卡名从
 * 卡池/自定义卡解析出完整卡定义再传入（委托数据只存引用，不内嵌卡定义）。
 */
export function buildDeliveryPatches(
  def: CommissionDef,
  card: Pick<CardItem, 'name'>,
  playerName: string,
  rewardCard?: CardItem,
): StatePatch[] {
  const patches: StatePatch[] = [
    // 上交：卡从背包移除（quantity 1——每次交付一张）
    {
      op: 'remove_item',
      target: `characters.${playerName}`,
      value: { name: card.name, quantity: 1 },
    },
    ...rewardPatches(def, playerName, rewardCard),
  ];
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
  // 卡交付规划器只管卡委托；素材/到访/终点委托各有各的完成路（commission-active / 管线钩子）
  if (def.requireMaterial || def.requireVisit || def.finale) {
    return {
      ok: false,
      reason: `「${def.name}」不是收卡委托，走对应的交付流程`,
      patches: [],
    };
  }
  if (!input.card) {
    return {
      ok: false,
      reason: `背包里没有可交付的【${input.commissionName}】目标卡`,
      patches: [],
    };
  }
  if (!matchesCommission(input.card, def.requireCard ?? {})) {
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
