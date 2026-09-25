/**
 * adventurer-rank.test.ts —— 冒险者等级 = 声望派生（阈值表 + 边界）
 */
import { describe, it, expect } from 'vitest';
import { ADVENTURER_RANK_TIERS, nextRankGap, rankForReputation } from './adventurer-rank';

describe('rankForReputation', () => {
  it('阈值边界：恰好达到 min 即晋升', () => {
    expect(rankForReputation(0)).toBe('未评级');
    expect(rankForReputation(19)).toBe('未评级');
    expect(rankForReputation(20)).toBe('D');
    expect(rankForReputation(59)).toBe('D');
    expect(rankForReputation(60)).toBe('C');
    expect(rankForReputation(150)).toBe('B');
    expect(rankForReputation(350)).toBe('A');
    expect(rankForReputation(700)).toBe('S');
  });

  it('远超最高档仍稳定在 S（不会越界）', () => {
    expect(rankForReputation(99999)).toBe('S');
  });

  it('非法输入安全回落「未评级」（声望写入口已钳非负，这里双保险）', () => {
    expect(rankForReputation(-5)).toBe('未评级');
    expect(rankForReputation(Number.NaN)).toBe('未评级');
    // 非有限值一律视为非法（Number.isFinite 守卫），哪怕 Infinity 在数学上 >= 700
    expect(rankForReputation(Number.POSITIVE_INFINITY)).toBe('未评级');
    // 小数向下取整：20.9 仍是 D
    expect(rankForReputation(20.9)).toBe('D');
  });

  it('阈值表升序且无重复名（结构性约束）', () => {
    for (let i = 1; i < ADVENTURER_RANK_TIERS.length; i++) {
      expect(ADVENTURER_RANK_TIERS[i].min).toBeGreaterThan(ADVENTURER_RANK_TIERS[i - 1].min);
    }
    const names = ADVENTURER_RANK_TIERS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('nextRankGap', () => {
  it('未评级 → 距 D 级差 20', () => {
    expect(nextRankGap(0)).toEqual({ name: 'D', remaining: 20 });
    expect(nextRankGap(13)).toEqual({ name: 'D', remaining: 7 });
  });

  it('最高档返回 null（没有下一级）', () => {
    expect(nextRankGap(700)).toBeNull();
    expect(nextRankGap(5000)).toBeNull();
  });

  it('中间档正确指向下一档', () => {
    expect(nextRankGap(100)).toEqual({ name: 'B', remaining: 50 });
  });
});
