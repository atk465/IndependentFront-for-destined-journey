/**
 * daily-ledger.test.ts — 每日账本（2026-09-17）
 *
 * 一句话能力：「今天这个能力用过没有」。多个天赋共用同一套记账。
 * 重点覆盖**跨天自动恢复**与**脏值兜底**（存档里可能是任何东西）。
 */
import { describe, it, expect } from 'vitest';
import {
  canUseToday,
  coerceLedger,
  markUsed,
  remainingToday,
  tryUseToday,
  usedToday,
} from './daily-ledger';

describe('coerceLedger —— 宽松读入', () => {
  it('正常账本原样通过', () => {
    expect(coerceLedger({ 素材点金: { day: 3, used: 1 } })).toEqual({
      素材点金: { day: 3, used: 1 },
    });
  });

  it('非对象/数组/null → 空账本（绝不抛）', () => {
    for (const raw of [undefined, null, 0, 'x', [], true]) {
      expect(coerceLedger(raw)).toEqual({});
    }
  });

  it('脏条目逐条丢弃，好条目保留', () => {
    const got = coerceLedger({
      好: { day: 5, used: 2 },
      缺天数: { used: 1 },
      缺次数: { day: 1 },
      天数非数: { day: 'x', used: 1 },
      次数负数: { day: 1, used: -3 },
      值是数字: 7,
      值是数组: [1, 2],
    });
    expect(got).toEqual({ 好: { day: 5, used: 2 }, 次数负数: { day: 1, used: 0 } });
  });

  it('小数向下取整', () => {
    expect(coerceLedger({ k: { day: 3.9, used: 1.8 } })).toEqual({ k: { day: 3, used: 1 } });
  });
});

describe('usedToday / remainingToday / canUseToday', () => {
  const today = 10;
  const 今天用过 = { 素材点金: { day: 10, used: 1 } };

  it('同一天算数；**跨天自动归零**', () => {
    expect(usedToday(今天用过, '素材点金', today)).toBe(1);
    expect(usedToday(今天用过, '素材点金', today + 1)).toBe(0);
    expect(canUseToday(今天用过, '素材点金', today)).toBe(false);
    expect(canUseToday(今天用过, '素材点金', today + 1)).toBe(true);
  });

  it('没记过 / 空账本 → 可用', () => {
    expect(canUseToday(undefined, 'k', today)).toBe(true);
    expect(canUseToday({}, 'k', today)).toBe(true);
    expect(usedToday(undefined, 'k', today)).toBe(0);
  });

  it('perDay > 1：次数用尽才拦住', () => {
    const 用过一次 = { k: { day: 10, used: 1 } };
    expect(canUseToday(用过一次, 'k', today, 2)).toBe(true);
    expect(remainingToday(用过一次, 'k', today, 2)).toBe(1);
    expect(canUseToday({ k: { day: 10, used: 2 } }, 'k', today, 2)).toBe(false);
    expect(remainingToday({ k: { day: 10, used: 2 } }, 'k', today, 2)).toBe(0);
  });

  it('perDay = 0 / 负数 → 永不可用（clamp 到 0）', () => {
    expect(canUseToday({}, 'k', today, 0)).toBe(false);
    expect(remainingToday({}, 'k', today, -5)).toBe(0);
  });
});

describe('markUsed —— 记账', () => {
  it('首次记 day=today, used=1', () => {
    expect(markUsed(undefined, 'k', 7)).toEqual({ k: { day: 7, used: 1 } });
  });

  it('同一天叠加次数', () => {
    expect(markUsed({ k: { day: 7, used: 1 } }, 'k', 7)).toEqual({ k: { day: 7, used: 2 } });
  });

  it('跨天从 1 重新起算（不是继续叠）', () => {
    expect(markUsed({ k: { day: 7, used: 3 } }, 'k', 8)).toEqual({ k: { day: 8, used: 1 } });
  });

  it('不 mutate 入参', () => {
    const src = { k: { day: 7, used: 1 } };
    const next = markUsed(src, 'k', 7);
    expect(src).toEqual({ k: { day: 7, used: 1 } });
    expect(next).not.toBe(src);
    expect(next.k).not.toBe(src.k);
  });

  it('多 key 互不影响（同一账本装多个天赋）', () => {
    let l = markUsed(undefined, '甲', 1);
    l = markUsed(l, '乙', 1);
    expect(l).toEqual({ 甲: { day: 1, used: 1 }, 乙: { day: 1, used: 1 } });
  });
});

describe('tryUseToday —— 判断 + 记账一步到位', () => {
  it('可用 → ok + 新账本 + 剩余数', () => {
    const r = tryUseToday(undefined, '素材点金', 4, 1, '素材点金');
    expect(r.ok).toBe(true);
    expect(r.next).toEqual({ 素材点金: { day: 4, used: 1 } });
    expect(r.remaining).toBe(0);
  });

  it('用尽 → ok=false、账本原样返回、reason 可直接给玩家看', () => {
    const used = { 素材点金: { day: 4, used: 1 } };
    const r = tryUseToday(used, '素材点金', 4, 1, '素材点金');
    expect(r.ok).toBe(false);
    expect(r.next).toBe(used);
    expect(r.reason).toContain('素材点金');
    expect(r.reason).toContain('每天 1 次');
  });

  it('第二天恢复', () => {
    const used = { 素材点金: { day: 4, used: 1 } };
    const r = tryUseToday(used, '素材点金', 5, 1, '素材点金');
    expect(r.ok).toBe(true);
    expect(r.next).toEqual({ 素材点金: { day: 5, used: 1 } });
  });

  it('perDay=2 时第二次仍可用，第三次才拒', () => {
    let l = {};
    const a = tryUseToday(l, 'k', 1, 2, 'k');
    l = a.next;
    const b = tryUseToday(l, 'k', 1, 2, 'k');
    l = b.next;
    const c = tryUseToday(l, 'k', 1, 2, 'k');
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, false]);
    expect(b.remaining).toBe(0);
  });
});
