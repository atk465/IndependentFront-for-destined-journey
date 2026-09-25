/**
 * commission-active.ts — 委托的**接取状态**纯函数叶（委托×地图闭环，2026-09-19）
 *
 * 装什么：接取记录（`ActiveCommission`：接取日/过期日/到访基线快照）、并行上限、
 *         到访进度对账、素材持有清点、素材/到访两种委托的交付规划、违约罚。
 * 不装什么：任何 I/O、任何 Dexie、任何 AI。落库（worldFlags.activeCommissions）与
 *           落格计数钩子在 state-manager / game-store，本模块只算。
 *
 * 设计要点（共识稿 #3/#4/#9/#12）：
 * - 最多并行 3 个：接取从免费动作变成承诺动作；过期释放接取位。
 * - 到访基线：接取瞬间快照「到访·<中层>」计数，`当前 ≥ 基线 + 要求` 才算数——
 *   挡「接委托之前就去过」的漏洞；放弃重接 = 基线重快照（链不卡死的软恢复）。
 * - 交付地分流：A/S 级有发布中层的委托必须人在发布中层才能交（requiresIssuerDelivery
 *   在 commission.ts）；D/C/B 级面板交付不受限。
 * - 违约（过期）罚声望不罚钱：声望是委托系统的货币（rewards.reputation 同源）。
 *
 * 纯度约束：无 I/O、无 Dexie、无 Vue。
 */

import type { StatePatch, CardItem } from '../types';
import type { CommissionDef, MaterialRequirement, VisitRequirement } from './commission';
import { midTierRefHit, rewardPatches, requiresIssuerDelivery } from './commission';
import type { Counters } from './daily-ledger';
import { counterOf } from './daily-ledger';

// ═══════════════════════════════════════════════════════════
// 接取记录
// ═══════════════════════════════════════════════════════════

/** 同时最多进行的委托数（常数起步，够用；要数据驱动时再挪进包配置） */
export const MAX_ACTIVE_COMMISSIONS = 3;

/** 生成填充委托的缺省保质期（gameDay；手写委托看 deadlineDays 有没有写） */
export const GENERATED_COMMISSION_TTL_DAYS = 7;

/** 到访计数的账本键前缀（counters 段，永不过期——到过就是到过） */
const VISIT_COUNTER_PREFIX = '到访.';

/** 到访计数键：`到访.<中层id>` */
export function visitCounterKey(midTierId: string): string {
  return `${VISIT_COUNTER_PREFIX}${midTierId}`;
}

/** 一条进行中的委托（存 `worldFlags.activeCommissions`） */
export interface ActiveCommission {
  /** 委托名（逻辑键，同 commission.name） */
  defName: string;
  /** 接取日（gameDay） */
  acceptDay: number;
  /** 过期日（gameDay；缺省/0 = 无时限） */
  expiresDay?: number;
  /** 接取时的到访计数快照（键 = visitCounterKey(midTier)，值 = 当时的计数） */
  visitBaselines?: Record<string, number>;
}

/** 容错解析接取清单（非数组/坏条目逐条丢，永不抛） */
export function coerceActiveCommissions(raw: unknown): ActiveCommission[] {
  if (!Array.isArray(raw)) return [];
  const out: ActiveCommission[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    if (typeof a['defName'] !== 'string' || a['defName'].length === 0) continue;
    if (typeof a['acceptDay'] !== 'number' || !Number.isFinite(a['acceptDay'])) continue;
    const baselines: Record<string, number> = {};
    if (a['visitBaselines'] && typeof a['visitBaselines'] === 'object') {
      for (const [k, v] of Object.entries(a['visitBaselines'] as Record<string, unknown>)) {
        if (typeof k !== 'string' || k.length === 0) continue;
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        baselines[k] = Math.max(0, Math.floor(v));
      }
    }
    out.push({
      defName: a['defName'],
      acceptDay: Math.floor(a['acceptDay']),
      ...(typeof a['expiresDay'] === 'number' &&
      Number.isFinite(a['expiresDay']) &&
      a['expiresDay'] > 0
        ? { expiresDay: Math.floor(a['expiresDay']) }
        : {}),
      ...(Object.keys(baselines).length > 0 ? { visitBaselines: baselines } : {}),
    });
  }
  return out;
}

/** 还能再接吗（并行上限） */
export function canAcceptCommission(list: readonly ActiveCommission[] | undefined): boolean {
  return (list ?? []).length < MAX_ACTIVE_COMMISSIONS;
}

/** 找一条进行中的委托 */
export function activeOf(
  list: readonly ActiveCommission[] | undefined,
  defName: string,
): ActiveCommission | undefined {
  return (list ?? []).find((a) => a.defName === defName);
}

/** 接取规划（纯函数）：快照到访基线 + 折算过期日。容量检查由调用方先做（canAcceptCommission）。 */
export function planAccept(input: {
  def: Pick<CommissionDef, 'name' | 'requireVisit' | 'destMidTier' | 'deadlineDays'>;
  counters: Counters | undefined;
  day: number;
}): ActiveCommission {
  const day = Math.floor(input.day);
  const baselines: Record<string, number> = {};
  const midTiers = new Set<string>();
  if (input.def.requireVisit?.midTier) midTiers.add(input.def.requireVisit.midTier);
  if (input.def.destMidTier) midTiers.add(input.def.destMidTier);
  for (const mt of midTiers) {
    const key = visitCounterKey(mt);
    baselines[key] = counterOf(input.counters, key);
  }
  const deadline =
    typeof input.def.deadlineDays === 'number' &&
    Number.isFinite(input.def.deadlineDays) &&
    input.def.deadlineDays > 0
      ? day + Math.floor(input.def.deadlineDays)
      : undefined;
  return {
    defName: input.def.name,
    acceptDay: day,
    ...(deadline ? { expiresDay: deadline } : {}),
    ...(Object.keys(baselines).length > 0 ? { visitBaselines: baselines } : {}),
  };
}

/** 放弃（基线作废；重接则重新快照）——返回保留下来的清单，原列表不变 */
export function abandonActive(
  list: readonly ActiveCommission[] | undefined,
  defName: string,
): ActiveCommission[] {
  return (list ?? []).filter((a) => a.defName !== defName);
}

// ═══════════════════════════════════════════════════════════
// 时限与违约
// ═══════════════════════════════════════════════════════════

/** 过期判定（expiresDay 当天仍有效，与 EventCommission 同口径） */
export function isActiveExpired(active: ActiveCommission, day: number): boolean {
  if (!active.expiresDay) return false;
  if (typeof day !== 'number' || !Number.isFinite(day)) return false;
  return Math.floor(day) >= active.expiresDay;
}

/**
 * 保洁：把清单切成「仍有效 / 已过期」两半。过期的交给调用方走违约结算
 * （A/S 级扣声望、链节回榜可重接），普通的静默摘除。
 */
export function splitExpiredCommissions(
  list: readonly ActiveCommission[] | undefined,
  day: number,
): { kept: ActiveCommission[]; expired: ActiveCommission[] } {
  const kept: ActiveCommission[] = [];
  const expired: ActiveCommission[] = [];
  for (const a of list ?? []) {
    if (isActiveExpired(a, day)) expired.push(a);
    else kept.push(a);
  }
  return { kept, expired };
}

/** 违约声望罚（正数，由调用方取负入账；D/C/B 级静默过期不罚） */
export function breachPenaltyOf(def: Pick<CommissionDef, 'grade'> | undefined): number {
  if (!def) return 0;
  if (def.grade === 'S') return 10;
  if (def.grade === 'A') return 5;
  return 0;
}

// ═══════════════════════════════════════════════════════════
// 素材 / 到访：进度清点
// ═══════════════════════════════════════════════════════════

/** 背包里某素材的持有量（按名清点，材料是普通物品） */
export function countMaterialOf(
  inventory: readonly { name: string; quantity: number }[] | undefined,
  name: string,
): number {
  let total = 0;
  for (const item of inventory ?? []) {
    if (item.name === name) total += Math.max(0, Math.floor(item.quantity) || 0);
  }
  return total;
}

/** 素材需求还差多少（0 = 够了） */
export function materialShortfall(
  inventory: readonly { name: string; quantity: number }[] | undefined,
  req: MaterialRequirement,
): number {
  return Math.max(0, req.count - countMaterialOf(inventory, req.name));
}

/** 素材需求是否已满足 */
export function materialRequirementMet(
  inventory: readonly { name: string; quantity: number }[] | undefined,
  req: MaterialRequirement,
): boolean {
  return materialShortfall(inventory, req) <= 0;
}

/**
 * 到访进度：当前计数 − 接取基线（没快照过 = 基线 0，兼容旧数据）。
 * `当前 ≥ 基线 + 要求` 才算数——「接委托之前去过」不算。
 */
export function visitProgressOf(
  active: ActiveCommission | undefined,
  counters: Counters | undefined,
  req: VisitRequirement,
): number {
  if (!active || !req.midTier) return 0;
  const key = visitCounterKey(req.midTier);
  const baseline = active.visitBaselines?.[key] ?? 0;
  return Math.max(0, counterOf(counters, key) - baseline);
}

/** 到访需求是否已满足 */
export function visitRequirementMet(
  active: ActiveCommission | undefined,
  counters: Counters | undefined,
  req: VisitRequirement,
): boolean {
  return visitProgressOf(active, counters, req) >= req.count;
}

// ═══════════════════════════════════════════════════════════
// 交付规划（素材 / 到访两种委托的交差）
// ═══════════════════════════════════════════════════════════

export interface CommissionDeliveryPlan {
  ok: boolean;
  reason?: string;
  patches: StatePatch[];
}

/**
 * 交付前置检查：A/S 级有发布中层的委托，必须人在发布中层（「回来」是远征的收尾拍）。
 * 发布地引用与当前中层按名字或 id 任一命中即同层（`midTierRefHit`，口径双容忍）。
 */
export function issuerDeliveryBlock(
  def: CommissionDef,
  currentMidTier: { id?: string; name?: string } | undefined,
): string | undefined {
  if (!requiresIssuerDelivery(def)) return undefined;
  if (midTierRefHit(def.issuerMidTier, currentMidTier)) return undefined;
  return `「${def.name}」是${def.grade}级委托，要回发布地交差`;
}

/**
 * 素材委托交付规划：校验（素材够 + 发布地）→ 扣素材 + 奖励一次出全补丁。
 * `rewardCard`：rewards.card（grantAt='delivery'）的发放——调用方先按卡名从
 * 卡池/自定义卡解析出完整卡定义再传入。提交由调用方做——上交与奖励同窗原子。
 */
export function planMaterialDelivery(input: {
  def: CommissionDef;
  inventory: readonly { name: string; quantity: number }[] | undefined;
  playerName: string;
  currentMidTier?: { id?: string; name?: string };
  rewardCard?: CardItem;
}): CommissionDeliveryPlan {
  const req = input.def.requireMaterial;
  if (!req) {
    return { ok: false, reason: `「${input.def.name}」不是素材委托`, patches: [] };
  }
  const shortfall = materialShortfall(input.inventory, req);
  if (shortfall > 0) {
    return {
      ok: false,
      reason: `「${req.name}」还差 ${shortfall} 份（要 ${req.count}）`,
      patches: [],
    };
  }
  const block = issuerDeliveryBlock(input.def, input.currentMidTier);
  if (block) return { ok: false, reason: block, patches: [] };
  const patches: StatePatch[] = [
    {
      op: 'remove_item',
      target: `characters.${input.playerName}`,
      value: { name: req.name, quantity: req.count },
    },
    ...rewardPatches(input.def, input.playerName, input.rewardCard),
  ];
  return { ok: true, patches };
}

/**
 * 到访委托交付规划：校验（进度够 + 发布地）→ 纯奖励补丁（人到了就是凭证，无物可扣）。
 */
export function planVisitDelivery(input: {
  def: CommissionDef;
  active: ActiveCommission | undefined;
  counters: Counters | undefined;
  playerName: string;
  currentMidTier?: { id?: string; name?: string };
}): CommissionDeliveryPlan {
  const req = input.def.requireVisit;
  if (!req) {
    return { ok: false, reason: `「${input.def.name}」不是探索委托`, patches: [] };
  }
  if (!input.active) {
    return {
      ok: false,
      reason: `「${input.def.name}」还没接取（到访要接了之后才计数）`,
      patches: [],
    };
  }
  const progress = visitProgressOf(input.active, input.counters, req);
  if (progress < req.count) {
    return {
      ok: false,
      reason: `「${req.midTier}」还要去 ${req.count - progress} 次（接取后已到 ${progress}/${req.count}）`,
      patches: [],
    };
  }
  const block = issuerDeliveryBlock(input.def, input.currentMidTier);
  if (block) return { ok: false, reason: block, patches: [] };
  return { ok: true, patches: rewardPatches(input.def, input.playerName) };
}
