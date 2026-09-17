/**
 * daily-ledger.ts — 每日限次账本（2026-09-17）
 *
 * 一句话能力：**「今天这个能力用过没有」**。多个天赋共用同一套记账，
 * 而不是各自造一个 `lastXxxDay` 字段。
 *
 * 存档落点：`worldFlags.dailyUses.<key>`（与情绪素材的 `worldFlags.emotionExtract`
 * 同一格，走既有的 `set_variable` 补丁通道，不新增 SaveProfile 字段）。
 *
 * 为什么不是「一次性消费」而是「按天记账」：这些能力（素材点金/每日一击/每日骰）
 * 第二天就该恢复——记账要能自然过期，所以存的是 **gameDay**，不是布尔开关。
 *
 * 本模块同时托管**不随天失效的累计计数**（counters 段，如败犬烙印）：
 * 它们是同一族「存档账本原语」，分两个文件会让人找两次。区别只在语义——
 * daily 段比对 gameDay，counter 段只累加/消耗。
 *
 * 纯度约束：纯函数、不 mutate 入参、不读时钟（today 一律由调用方传入）。
 */

/** 账本条目：某 key 最后一次使用的 gameDay 与当日已用次数（形状只在模块内用） */
interface DailyUse {
  day: number;
  used: number;
}

/** 账本：key → 最近一次使用记录（key 建议用天赋名或「天赋名·用途」） */
export type DailyLedger = Record<string, DailyUse>;

const 非法 = (v: unknown): boolean => typeof v !== 'number' || !Number.isFinite(v);

/**
 * 宽松读入 → 归一化账本。
 *
 * 存档里的值可能是任何东西（旧档、AI 手写、被别处覆盖），所以这里逐条校验：
 * 只保留 `{ day: 有限数, used: 有限数 ≥ 0 }` 的条目，其余静默丢弃——绝不抛。
 */
export function coerceLedger(raw: unknown): DailyLedger {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: DailyLedger = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const { day, used } = value as Partial<DailyUse>;
    if (非法(day) || 非法(used)) continue;
    out[key] = { day: Math.floor(day as number), used: Math.max(0, Math.floor(used as number)) };
  }
  return out;
}

/**
 * 该 key 今天已用几次。**跨天自动归零**——账本里记的是哪一天，只有同一天才算数。
 */
export function usedToday(ledger: DailyLedger | undefined, key: string, today: number): number {
  const entry = ledger?.[key];
  if (!entry) return 0;
  return entry.day === Math.floor(today) ? entry.used : 0;
}

/** 今日剩余次数（clamp ≥ 0）。perDay 缺省 1。 */
export function remainingToday(
  ledger: DailyLedger | undefined,
  key: string,
  today: number,
  perDay = 1,
): number {
  const cap = Math.max(0, Math.floor(perDay) || 0);
  return Math.max(0, cap - usedToday(ledger, key, today));
}

/** 今天还能不能用（perDay 缺省 1 = 每天一次） */
export function canUseToday(
  ledger: DailyLedger | undefined,
  key: string,
  today: number,
  perDay = 1,
): boolean {
  return remainingToday(ledger, key, today, perDay) > 0;
}

/** 记一次使用（返回新账本，不改入参）。跨天则从 1 重新起算。 */
export function markUsed(ledger: DailyLedger | undefined, key: string, today: number): DailyLedger {
  const day = Math.floor(today);
  const base = ledger ?? {};
  const used = usedToday(base, key, day) + 1;
  return { ...base, [key]: { day, used } };
}

// ════════════════════════════════════════════════════════════════════
// 当日增益（worldFlags.dailyBuffs.<key> = gameDay）
// ════════════════════════════════════════════════════════════════════
//
// 与账本同一格思路：存 day 而不是布尔开关，**跨天自动失效**，不需要重置逻辑。
// 消费者：好运之骰的「刀刀暴击」（战斗）/「制卡顺利」（制卡）。

/** 当日增益表：key → 生效的那个 gameDay */
export type DailyBuffs = Record<string, number>;

/** 宽松读入 → 归一化增益表（脏值逐条丢弃，绝不抛） */
export function coerceBuffs(raw: unknown): DailyBuffs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: DailyBuffs = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || 非法(value)) continue;
    out[key] = Math.floor(value as number);
  }
  return out;
}

/** 该当日增益此刻是否生效（只在登记的当天生效） */
export function buffActiveToday(
  buffs: DailyBuffs | undefined,
  key: string,
  today: number,
): boolean {
  return buffs?.[key] === Math.floor(today);
}

/** 登记一条当日增益（返回新表，不改入参） */
export function markBuff(buffs: DailyBuffs | undefined, key: string, today: number): DailyBuffs {
  return { ...(buffs ?? {}), [key]: Math.floor(today) };
}

/**
 * 判断 + 记账一步到位（调用方最常用的形态）。
 *
 * @returns ok=false 时 next 原样返回，reason 可直接给玩家看
 */
export function tryUseToday(
  ledger: DailyLedger | undefined,
  key: string,
  today: number,
  perDay = 1,
  label = '这个能力',
): { ok: boolean; next: DailyLedger; reason?: string; remaining: number } {
  const cap = Math.max(0, Math.floor(perDay) || 0);
  const left = remainingToday(ledger, key, today, cap);
  if (left <= 0) {
    return {
      ok: false,
      next: ledger ?? {},
      reason: `【${label}】今日份已经用尽了（每天 ${cap} 次）——明天再来`,
      remaining: 0,
    };
  }
  const next = markUsed(ledger, key, today);
  return { ok: true, next, remaining: remainingToday(next, key, today, cap) };
}

// ════════════════════════════════════════════════════════════════════
// 累计计数（**不**随天失效）：worldFlags.counters.<key> = number
// ════════════════════════════════════════════════════════════════════
//
// 与 daily 段的区别只有一条：**不比对 gameDay**。用于「战败累计烙印」这类
// 跨战斗攒出来的资源——攒多少就是多少，明天不会清零。

/** 计数表：key → 累计值 */
export type Counters = Record<string, number>;

/** 宽松读入 → 归一化计数表（脏值逐条丢弃，绝不抛） */
export function coerceCounters(raw: unknown): Counters {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Counters = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || 非法(value)) continue;
    out[key] = Math.max(0, Math.floor(value as number));
  }
  return out;
}

/** 当前累计值（缺省 0） */
export function counterOf(counters: Counters | undefined, key: string): number {
  const v = counters?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

/** 累加（返回新表，不改入参；delta 为负时按消耗处理并 clamp 到 0） */
export function addCounter(counters: Counters | undefined, key: string, delta: number): Counters {
  const step = Number.isFinite(delta) ? Math.round(delta) : 0;
  const next = Math.max(0, counterOf(counters, key) + step);
  return { ...(counters ?? {}), [key]: next };
}

/**
 * 消耗计数（判断 + 扣减一步到位）。
 *
 * @returns ok=false 时 next 原样返回，reason 可直接给玩家看
 */
export function spendCounter(
  counters: Counters | undefined,
  key: string,
  amount = 1,
  label = key,
): { ok: boolean; next: Counters; reason?: string; left: number } {
  const need = Math.max(1, Math.round(amount) || 1);
  const have = counterOf(counters, key);
  if (have < need) {
    return {
      ok: false,
      next: counters ?? {},
      reason: `【${label}】不足（当前 ${have}，需要 ${need}）`,
      left: have,
    };
  }
  const next = addCounter(counters, key, -need);
  return { ok: true, next, left: counterOf(next, key) };
}
