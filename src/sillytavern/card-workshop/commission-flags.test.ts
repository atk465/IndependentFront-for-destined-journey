/**
 * commission-flags.test.ts — 抵达对账纯函数：补足制 / 到访计数 / 抵达判定 / 连击与守卫
 */
import { describe, it, expect } from 'vitest';
import {
  ARRIVAL_DANGER_THRESHOLD,
  arrivalDCOf,
  advanceGatherStreak,
  alertPenaltyActive,
  coerceCommissionsFlags,
  gatherStreakCount,
  planArrivalSync,
  EXPLORATION_ROLL_COUNTER_KEY,
} from './commission-flags';
import { visitCounterKey } from './commission-active';

const BASE_FLAGS = {
  lastTileIdSeen: 3,
  lastMoveDay: 100,
  lastVisitMidTier: 'mt-capital',
};

describe('arrivalDCOf / 阈值', () => {
  it('危险 4 → DC 14，5 → 16，封顶 18', () => {
    expect(ARRIVAL_DANGER_THRESHOLD).toBe(4);
    expect(arrivalDCOf(4)).toBe(14);
    expect(arrivalDCOf(5)).toBe(16);
    expect(arrivalDCOf(9)).toBe(18);
    expect(arrivalDCOf(0)).toBe(6);
  });
});

describe('planArrivalSync：补足制（决议 #5）', () => {
  it('没移动 → 不补、不计数，只刷新记账格', () => {
    const out = planArrivalSync({
      flags: { ...BASE_FLAGS },
      lastTileId: 3,
      today: 105,
      routeDays: 2,
      midTier: { id: 'mt-capital', name: '王都' },
      d20: 10,
    });
    expect(out.topUpMinutes).toBe(0);
    expect(out.visitCounterKey).toBeUndefined();
    expect(out.threat).toBeUndefined();
    expect(out.flags.lastMoveDay).toBe(100);
  });

  it('实际流逝 < 旅程天数 → 补足差额（AI 偷懒引擎兜底）', () => {
    // 从地块3 → 地块7 要 3 天，实际只过了 1 天 → 补 2 天
    const out = planArrivalSync({
      flags: { ...BASE_FLAGS, lastTileIdSeen: 3 },
      lastTileId: 7,
      today: 101,
      routeDays: 3,
      midTier: { id: 'mt-north', name: '北境雪原' },
    });
    expect(out.topUpMinutes).toBe(2 * 1440);
    expect(out.flags.lastMoveDay).toBe(101);
    expect(out.flags.lastTileIdSeen).toBe(7);
  });

  it('AI 多走不回退（实际流逝 > 旅程天数 → 不补）', () => {
    const out = planArrivalSync({
      flags: { ...BASE_FLAGS, lastTileIdSeen: 3 },
      lastTileId: 7,
      today: 110,
      routeDays: 3,
      midTier: { id: 'mt-north', name: '北境雪原' },
    });
    expect(out.topUpMinutes).toBe(0);
  });

  it('寻路不通（routeDays null）→ 跳过对账但记账照写', () => {
    const out = planArrivalSync({
      flags: { ...BASE_FLAGS },
      lastTileId: 7,
      today: 102,
      routeDays: null,
      midTier: null,
    });
    expect(out.topUpMinutes).toBe(0);
    expect(out.flags.lastTileIdSeen).toBe(7);
    expect(out.flags.lastMoveDay).toBe(102);
  });

  it('首跑（没记账）→ 只记账不对账不补；但首次进入即抵达，判定与计数照常', () => {
    const out = planArrivalSync({
      flags: {},
      lastTileId: 7,
      today: 50,
      routeDays: 99,
      midTier: { id: 'mt-north', name: '北境雪原', danger: 5 },
      d20: 20, // > DC16：安全通过
    });
    expect(out.topUpMinutes).toBe(0);
    expect(out.visitCounterKey).toBe(visitCounterKey('mt-north'));
    expect(out.threat).toBeUndefined();
    expect(out.flags.lastMoveDay).toBe(50);

    // d20 1 → 判定失败（首跑的抵达也是抵达）
    const ambushed = planArrivalSync({
      flags: {},
      lastTileId: 7,
      today: 50,
      routeDays: 99,
      midTier: { id: 'mt-north', name: '北境雪原', danger: 5 },
      d20: 1,
    });
    expect(ambushed.threat).toBeDefined();
  });
});

describe('planArrivalSync：到访计数（决议 #3）', () => {
  it('中层变化 → 给计数键；同层不动', () => {
    const moved = planArrivalSync({
      flags: { ...BASE_FLAGS },
      lastTileId: 7,
      today: 101,
      routeDays: 1,
      midTier: { id: 'mt-north', name: '北境雪原' },
    });
    expect(moved.visitCounterKey).toBe('到访.mt-north');
    expect(moved.flags.lastVisitMidTier).toBe('mt-north');

    const same = planArrivalSync({
      flags: { ...BASE_FLAGS, lastVisitMidTier: 'mt-north' },
      lastTileId: 9,
      today: 102,
      routeDays: 1,
      midTier: { id: 'mt-north', name: '北境雪原' },
    });
    expect(same.visitCounterKey).toBeUndefined();
  });
});

describe('planArrivalSync：抵达判定（决议 #8）', () => {
  const extreme = { id: 'mt-abyss', name: '深渊废墟', danger: 5 };

  it('危险层 + 中层变化 + 骰低 → 判定失败（ambush / alerted 交替）', () => {
    const ambush = planArrivalSync({
      flags: { ...BASE_FLAGS },
      lastTileId: 7,
      today: 101,
      routeDays: 1,
      midTier: extreme,
      d20: 14, // ≤ DC16 → 失败；偶数 = ambush
    });
    expect(ambush.threat).toMatchObject({ kind: 'ambush', d20: 14, dc: 16 });
    expect(ambush.flags.arrivalThreat?.kind).toBe('ambush');

    const alerted = planArrivalSync({
      flags: { ...BASE_FLAGS },
      lastTileId: 7,
      today: 101,
      routeDays: 1,
      midTier: extreme,
      d20: 13, // ≤ DC16 → 失败；奇数 = alerted
    });
    expect(alerted.threat?.kind).toBe('alerted');
    expect(alerted.flags.alertedMidTier).toEqual({ midTierId: 'mt-abyss', day: 101 });
  });

  it('骰高（> DC）→ 安全通过，无 threat', () => {
    const out = planArrivalSync({
      flags: { ...BASE_FLAGS },
      lastTileId: 7,
      today: 101,
      routeDays: 1,
      midTier: extreme,
      d20: 17,
    });
    expect(out.threat).toBeUndefined();
    expect(out.flags.arrivalThreat).toBeUndefined();
  });

  it('普通层（危险 < 4）→ 不判定', () => {
    const out = planArrivalSync({
      flags: { ...BASE_FLAGS },
      lastTileId: 7,
      today: 101,
      routeDays: 1,
      midTier: { id: 'mt-north', name: '北境雪原', danger: 2 },
      d20: 1,
    });
    expect(out.threat).toBeUndefined();
  });

  it('惊动守卫跨日失效', () => {
    const out = planArrivalSync({
      flags: { ...BASE_FLAGS, alertedMidTier: { midTierId: 'mt-north', day: 99 } },
      lastTileId: 3,
      today: 101,
      routeDays: null,
      midTier: { id: 'mt-capital', name: '王都' },
    });
    expect(out.flags.alertedMidTier).toBeUndefined();
  });
});

describe('采集连击与惊动守卫', () => {
  it('同日累加、跨日清零', () => {
    const first = advanceGatherStreak(undefined, 100);
    expect(first).toEqual({ next: { day: 100, count: 1 }, consecutive: 1 });
    const second = advanceGatherStreak(first.next, 100);
    expect(second.consecutive).toBe(2);
    const reset = advanceGatherStreak(second.next, 101);
    expect(reset.consecutive).toBe(1);
    expect(gatherStreakCount({ day: 100, count: 4 }, 101)).toBe(0);
    expect(gatherStreakCount({ day: 100, count: 4 }, 100)).toBe(4);
    expect(gatherStreakCount(undefined, 100)).toBe(0);
  });

  it('alertPenaltyActive：同层当日才生效', () => {
    const alert = { midTierId: 'mt-abyss', day: 100 };
    expect(alertPenaltyActive(alert, 'mt-abyss', 100)).toBe(true);
    expect(alertPenaltyActive(alert, 'mt-abyss', 101)).toBe(false);
    expect(alertPenaltyActive(alert, 'mt-north', 100)).toBe(false);
    expect(alertPenaltyActive(undefined, 'mt-abyss', 100)).toBe(false);
  });
});

describe('coerceCommissionsFlags（容错解析）', () => {
  it('坏格子逐格丢', () => {
    const flags = coerceCommissionsFlags({
      active: [
        { defName: '雪莲采集', acceptDay: 10, expiresDay: 17 },
        { defName: '' },
        '垃圾',
      ],
      completed: { a: 5, b: 'x' },
      finaleEvidence: { c: 'battle', d: 3 },
      lastTileIdSeen: 'x',
      lastMoveDay: 3.9,
      gatherStreak: { day: 1, count: 2 },
      unknownField: true,
    });
    expect(flags.active).toHaveLength(1);
    expect(flags.completed).toEqual({ a: 5 });
    expect(flags.finaleEvidence).toEqual({ c: 'battle' });
    expect(flags.lastTileIdSeen).toBeUndefined();
    expect(flags.lastMoveDay).toBe(3);
    expect(flags.gatherStreak).toEqual({ day: 1, count: 2 });
  });

  it('非对象 / 数组 → 空袋', () => {
    expect(coerceCommissionsFlags(null)).toEqual({});
    expect(coerceCommissionsFlags([1, 2])).toEqual({});
    expect(coerceCommissionsFlags('x')).toEqual({});
  });

  it('探索掷骰计数键是稳定的常量', () => {
    expect(EXPLORATION_ROLL_COUNTER_KEY).toBe('探索掷骰');
  });
});
