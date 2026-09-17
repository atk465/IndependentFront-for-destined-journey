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
