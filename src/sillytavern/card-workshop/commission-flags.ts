/**
 * commission-flags.ts — 委托×地图闭环的**存档旗纯函数叶**（2026-09-19 共识稿）
 *
 * 装什么: `worldFlags.commissions` 的形状与容错解析、抵达对账的纯规划
 *         （`planArrivalSync`：到访计数 + 补足 + 抵达判定一次算完）、采集连击、
 *         惊动守卫（抵达判定失败的叙事性惩罚）的生效判据。
 * 不装什么: 任何 I/O、任何地图查表、任何随机 —— findPath / midTierOfTile / d20 都由
 *           调用方（state-manager 接线层）解析好传进来，本模块只算。
 *
 * 设计要点（共识稿 #3/#4/#5/#8）：
 * - 到访即计：中层变化 → `到访.<中层id>` 计数 +1（counter 键由本模块给，加法由调用方做）。
 * - 补足制：上次落位即出发基线。到账 = `旅程天数 − 实际流逝天数` 的正差额；AI 多走不回退；
 *   寻路不通（null）跳过对账（传送/剧情跳转是合法叙事）。
 * - 抵达判定：危险系数 ≥ 阈值的中层，中层变化落格时掷 d20 —— 失败 = 遭遇战提示或
 *   惊动守卫（本层当日采集 DC +2）。「极度危险」由覆写表 danger 声明，引擎只认数字。
 *
 * 纯度约束：无 I/O、无随机、无时钟；改入参一律禁止，变化全部走返回值。
 */

import type { ActiveCommission } from './commission-active';
import { coerceActiveCommissions, visitCounterKey } from './commission-active';
import type { CommissionDef } from './commission';

// ═══════════════════════════════════════════════════════════
// 生成填充委托（共识稿 #7：D/C/B 模板生成填充，S/A 手写链）
// ═══════════════════════════════════════════════════════════

/** 一条已实例化的生成委托（存档内随存档走；过期由保洁摘除） */
export interface GeneratedCommission {
  /** 委托定义本体（与静态委托同形状，下游无感） */
  def: CommissionDef;
  /** 生成日（gameDay） */
  armedDay: number;
  /** 过期日（gameDay；armedDay + 保质期） */
  expiresDay: number;
}

/** 生成委托此刻是否有效（过期日当天仍可接可交，与 EventCommission 同口径） */
export function isGeneratedCommissionActive(gc: GeneratedCommission, day: number): boolean {
  if (typeof day !== 'number' || !Number.isFinite(day)) return false;
  return Math.floor(day) < gc.expiresDay;
}

/** 容错解析生成委托清单（坏条目逐条丢，永不抛） */
function coerceGeneratedCommissions(raw: unknown): GeneratedCommission[] {
  if (!Array.isArray(raw)) return [];
  const out: GeneratedCommission[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const g = item as Record<string, unknown>;
    if (!g['def'] || typeof g['def'] !== 'object') continue;
    if (typeof g['armedDay'] !== 'number' || !Number.isFinite(g['armedDay'])) continue;
    if (typeof g['expiresDay'] !== 'number' || !Number.isFinite(g['expiresDay'])) continue;
    // def 的形状校验从宽（有名字即可）——完整校验由 coerceCommissions 在消费侧做
    const def = g['def'] as Record<string, unknown>;
    if (typeof def['name'] !== 'string' || def['name'].length === 0) continue;
    out.push({
      def: def as unknown as CommissionDef,
      armedDay: Math.floor(g['armedDay']),
      expiresDay: Math.floor(g['expiresDay']),
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// 旗袋形状（worldFlags.commissions）
// ═══════════════════════════════════════════════════════════

/** 当前所在中层的快照（采集/交付/终点判定都从这读，UI 不用自己查地图包） */
interface CurrentMidTierSnapshot {
  id: string;
  name: string;
  /** 该中层的采集覆写（缺键回退由 gathering.resolveGatherDef 在使用侧做） */
  specialty?: string;
  danger?: number;
  /** 品质档 → 素材名（中层独家素材表） */
  materialTable?: Record<number, string[]>;
}

/** 抵达判定的结果记录（UI 展示 + AI 注入共用） */
interface ArrivalThreat {
  midTierId: string;
  midTierName: string;
  day: number;
  /** ambush=遭遇战提示（走既有战斗流程）；alerted=惊动守卫（本层当日采集 DC +2） */
  kind: 'ambush' | 'alerted';
  d20: number;
  dc: number;
}

/** `worldFlags.commissions` 的形状。全字段可选——空袋是合法起点。 */
export interface CommissionsFlags {
  /** 进行中的委托（commission-active.ActiveCommission） */
  active?: ActiveCommission[];
  /** 已完成的委托名 → 完成日（gameDay）——链解锁判据（完成第 N 节解锁第 N+1 节） */
  completed?: Record<string, number>;
  /** 生成填充委托（D/C/B 级；每日保洁过期 + 补充到目标数） */
  generated?: GeneratedCommission[];
  /**
   * 终点证据暂存（defName → 证据种类）：强敌型由战斗胜利结算写入、谜题型由
   * 事件足迹判读，`scanFinaleCommissions` 消费后清除。场景制卡型不走这里
   * （制卡路径当场结算，无需暂存）。
   */
  finaleEvidence?: Record<string, string>;
  /** 最近一次抵达判定（展示用；换中层或非危险层自动清除） */
  arrivalThreat?: ArrivalThreat;
  /** 惊动守卫：该中层当日采集 DC +2（次日自然失效） */
  alertedMidTier?: { midTierId: string; day: number };
  /** 钩子记账：上一块已见地块（对账的「从哪出发」） */
  lastTileIdSeen?: number;
  /** 钩子记账：上次落位的 gameDay（补足的出发基线） */
  lastMoveDay?: number;
  /** 钩子记账：上次所在中层 id（到访计数的变化判据） */
  lastVisitMidTier?: string;
  /** 当前所在中层快照（每次抵达刷新；没装地图包 = 缺席） */
  currentMidTier?: CurrentMidTierSnapshot;
  /** 采集连击（当日；风险 DC 递增用） */
  gatherStreak?: { day: number; count: number };
}

/** 容错解析（坏格子逐格丢，永不抛） */
export function coerceCommissionsFlags(raw: unknown): CommissionsFlags {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const c = raw as Record<string, unknown>;
  const out: CommissionsFlags = {};

  const active = coerceActiveCommissions(c['active']);
  if (active.length > 0) out.active = active;

  const generated = coerceGeneratedCommissions(c['generated']);
  if (generated.length > 0) out.generated = generated;

  const completed = c['completed'];
  if (completed && typeof completed === 'object' && !Array.isArray(completed)) {
    const record: Record<string, number> = {};
    for (const [name, day] of Object.entries(completed as Record<string, unknown>)) {
      if (typeof name !== 'string' || name.length === 0) continue;
      if (typeof day !== 'number' || !Number.isFinite(day)) continue;
      record[name] = Math.max(0, Math.floor(day));
    }
    if (Object.keys(record).length > 0) out.completed = record;
  }

  const evidence = c['finaleEvidence'];
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
    const record: Record<string, string> = {};
    for (const [name, kind] of Object.entries(evidence as Record<string, unknown>)) {
      if (typeof name !== 'string' || name.length === 0) continue;
      if (typeof kind !== 'string' || kind.length === 0) continue;
      record[name] = kind;
    }
    if (Object.keys(record).length > 0) out.finaleEvidence = record;
  }

  const threat = c['arrivalThreat'];
  if (
    threat &&
    typeof threat === 'object' &&
    !Array.isArray(threat) &&
    typeof (threat as Record<string, unknown>)['midTierId'] === 'string' &&
    typeof (threat as Record<string, unknown>)['day'] === 'number'
  ) {
    const t = threat as Record<string, unknown>;
    const kind = t['kind'];
    if (kind === 'ambush' || kind === 'alerted') {
      out.arrivalThreat = {
        midTierId: t['midTierId'] as string,
        midTierName: typeof t['midTierName'] === 'string' ? (t['midTierName'] as string) : '',
        day: t['day'] as number,
        kind,
        d20: typeof t['d20'] === 'number' ? (t['d20'] as number) : 0,
        dc: typeof t['dc'] === 'number' ? (t['dc'] as number) : 0,
      };
    }
  }

  const alert = c['alertedMidTier'];
  if (
    alert &&
    typeof alert === 'object' &&
    !Array.isArray(alert) &&
    typeof (alert as Record<string, unknown>)['midTierId'] === 'string' &&
    typeof (alert as Record<string, unknown>)['day'] === 'number'
  ) {
    const a = alert as Record<string, unknown>;
    out.alertedMidTier = {
      midTierId: a['midTierId'] as string,
      day: a['day'] as number,
    };
  }

  if (typeof c['lastTileIdSeen'] === 'number' && Number.isFinite(c['lastTileIdSeen'])) {
    out.lastTileIdSeen = Math.floor(c['lastTileIdSeen']);
  }
  if (typeof c['lastMoveDay'] === 'number' && Number.isFinite(c['lastMoveDay'])) {
    out.lastMoveDay = Math.floor(c['lastMoveDay']);
  }
  if (typeof c['lastVisitMidTier'] === 'string' && c['lastVisitMidTier'].length > 0) {
    out.lastVisitMidTier = c['lastVisitMidTier'];
  }

  const midTier = c['currentMidTier'];
  if (midTier && typeof midTier === 'object' && !Array.isArray(midTier)) {
    const m = midTier as Record<string, unknown>;
    if (typeof m['id'] === 'string' && m['id'].length > 0) {
      out.currentMidTier = {
        id: m['id'],
        name: typeof m['name'] === 'string' ? m['name'] : (m['id'] as string),
        ...(typeof m['specialty'] === 'string' ? { specialty: m['specialty'] as string } : {}),
        ...(typeof m['danger'] === 'number' && Number.isFinite(m['danger'])
          ? { danger: m['danger'] as number }
          : {}),
        ...(m['materialTable'] && typeof m['materialTable'] === 'object'
          ? { materialTable: m['materialTable'] as Record<number, string[]> }
          : {}),
      };
    }
  }

  const streak = c['gatherStreak'];
  if (
    streak &&
    typeof streak === 'object' &&
    !Array.isArray(streak) &&
    typeof (streak as Record<string, unknown>)['day'] === 'number' &&
    typeof (streak as Record<string, unknown>)['count'] === 'number'
  ) {
    const s = streak as Record<string, unknown>;
    out.gatherStreak = { day: s['day'] as number, count: s['count'] as number };
  }

  return out;
}

// ═══════════════════════════════════════════════════════════
// 抵达对账（补足 + 到访 + 抵达判定）
// ═══════════════════════════════════════════════════════════

/** 抵达判定的危险阈值（共识稿 #8：≥4 的中层才算「极度危险」） */
export const ARRIVAL_DANGER_THRESHOLD = 4;

/** 探索掷骰的动作序号计数键（counters 段）——掷骰种子的盐，同日多次探索各自独立 */
export const EXPLORATION_ROLL_COUNTER_KEY = '探索掷骰';

/** 抵达判定 DC：2×危险系数 + 6（危险 4 → 14，5 → 16），封顶 18（与采集 DC 同一上限） */
export function arrivalDCOf(danger: number): number {
  return Math.min(18, Math.max(0, Math.floor(danger)) * 2 + 6);
}

/** 一个游戏日的分钟数（与 time-system.MINUTES_PER_GAME_DAY 同值；独立声明避免环） */
const MINUTES_PER_DAY = 1440;

export interface ArrivalSyncInput {
  /** 当前旗袋（调用方已 coerce） */
  flags: CommissionsFlags;
  /** 刚落位的地块（mapFlags.lastTileId；null = 没装包/没落位 → 整段不动） */
  lastTileId: number | null;
  /** 当前 gameDay */
  today: number;
  /** 从上一次见过的地块到当前地块的旅程天数；null = 不连通/无法对账（跳过补足） */
  routeDays: number | null;
  /** 当前所在中层（midTierOfTile 解析；null = 不在任何中层） */
  midTier: CurrentMidTierSnapshot | null;
  /** 抵达判定的 d20 骰值（1~20；缺省 = 不掷判定） */
  d20?: number;
}

export interface ArrivalSyncOutcome {
  /** 下一份旗袋（整份覆盖；无中层/没移动也会更新记账格） */
  flags: CommissionsFlags;
  /** 到访计数要 +1 的键（中层变化时；调用方执行加法） */
  visitCounterKey?: string;
  /** 补足的分钟数（0 = 不补） */
  topUpMinutes: number;
  /** 本次抵达判定结果（未掷/未触发 = 缺省） */
  threat?: ArrivalThreat;
}

/**
 * 抵达对账规划（纯函数）——补足制 + 到访计数 + 抵达判定一次算完。
 *
 * @param input.routeDays 由调用方 `findPath(上次地块 → 当前地块)` 得来；
 *        「上次地块」= `flags.lastTileIdSeen`。首跑（没记账）只记账不对账。
 */
export function planArrivalSync(input: ArrivalSyncInput): ArrivalSyncOutcome {
  const prev: CommissionsFlags = { ...input.flags };
  const today = Math.floor(input.today);
  const moved =
    input.lastTileId !== null &&
    prev.lastTileIdSeen !== undefined &&
    prev.lastTileIdSeen !== input.lastTileId;
  const firstRun = input.lastTileId !== null && prev.lastTileIdSeen === undefined;

  // ── 补足制 ──
  let topUpMinutes = 0;
  if (moved && input.routeDays !== null && prev.lastMoveDay !== undefined) {
    const elapsed = Math.max(0, today - prev.lastMoveDay);
    const deficit = Math.max(0, Math.floor(input.routeDays) - elapsed);
    topUpMinutes = deficit * MINUTES_PER_DAY;
  }

  // ── 到访计数（中层变化） ──
  const midTierChanged = input.midTier !== null && input.midTier.id !== prev.lastVisitMidTier;
  const visitCounterKey_ =
    midTierChanged && input.midTier !== null ? visitCounterKey(input.midTier.id) : undefined;

  // ── 抵达判定（中层变化 × 危险层 × 给了骰值） ──
  let threat: ArrivalThreat | undefined;
  if (
    midTierChanged &&
    input.midTier !== null &&
    typeof input.midTier.danger === 'number' &&
    input.midTier.danger >= ARRIVAL_DANGER_THRESHOLD &&
    typeof input.d20 === 'number' &&
    Number.isFinite(input.d20)
  ) {
    const dc = arrivalDCOf(input.midTier.danger);
    const roll = Math.max(1, Math.min(20, Math.floor(input.d20)));
    if (roll <= dc) {
      threat = {
        midTierId: input.midTier.id,
        midTierName: input.midTier.name,
        day: today,
        kind: roll % 2 === 0 ? 'ambush' : 'alerted',
        d20: roll,
        dc,
      };
    }
  }

  // ── 下一份旗袋 ──
  const next: CommissionsFlags = {
    ...prev,
    ...(input.midTier !== null
      ? { currentMidTier: { ...input.midTier } }
      : { currentMidTier: prev.currentMidTier }),
  };
  if (input.lastTileId !== null) next.lastTileIdSeen = input.lastTileId;
  if (moved) next.lastMoveDay = today;
  if (firstRun) {
    // 首跑只记账：没有「上次」可比，补足与判定都不成立
    next.lastMoveDay = today;
  }
  if (input.midTier !== null) next.lastVisitMidTier = input.midTier.id;

  // 惊动守卫：跨日自然失效；换了中层也失效
  if (next.alertedMidTier && next.alertedMidTier.day !== today) {
    delete next.alertedMidTier;
  }
  if (threat) {
    next.arrivalThreat = threat;
    if (threat.kind === 'alerted')
      next.alertedMidTier = { midTierId: threat.midTierId, day: today };
  } else if (midTierChanged) {
    delete next.arrivalThreat;
  }

  return {
    flags: next,
    ...(visitCounterKey_ ? { visitCounterKey: visitCounterKey_ } : {}),
    topUpMinutes,
    ...(threat ? { threat } : {}),
  };
}

// ═══════════════════════════════════════════════════════════
// 采集连击与惊动守卫
// ═══════════════════════════════════════════════════════════

/** 采集连击推进（纯函数）：跨日清零，同日 +1。返回下一份连击格与当前连击数。 */
export function advanceGatherStreak(
  streak: CommissionsFlags['gatherStreak'],
  today: number,
): { next: CommissionsFlags['gatherStreak']; consecutive: number } {
  const day = Math.floor(today);
  if (streak && streak.day === day) {
    const count = streak.count + 1;
    return { next: { day, count }, consecutive: count };
  }
  return { next: { day, count: 1 }, consecutive: 1 };
}

/** 当前采集连击数（读侧；跨日读 0） */
export function gatherStreakCount(streak: CommissionsFlags['gatherStreak'], today: number): number {
  if (!streak || streak.day !== Math.floor(today)) return 0;
  return Math.max(0, streak.count);
}

/**
 * 惊动守卫是否生效（本中层当日）：采集 DC +2。
 */
export function alertPenaltyActive(
  alert: CommissionsFlags['alertedMidTier'],
  midTierId: string | undefined,
  today: number,
): boolean {
  if (!alert || !midTierId) return false;
  return alert.midTierId === midTierId && alert.day === Math.floor(today);
}
