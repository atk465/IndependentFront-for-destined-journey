import { describe, it, expect } from 'vitest';
import { describeReward, planDefeatCompensation } from './defeat-compensation';

describe('planDefeatCompensation（战败补偿）', () => {
  it('三条 if 线，奖励类型齐全（经验/金钱/素材），只兑现一条', () => {
    const p = planDefeatCompensation(10, '白银', () => 0.5);
    expect(p.lines).toHaveLength(3);
    expect(p.lines.map((l) => l.rewardKind).sort()).toEqual(['exp', 'gold', 'material']);
    expect(p.grantedIndex).toBeGreaterThanOrEqual(0);
    expect(p.grantedIndex).toBeLessThan(3);
    expect(p.granted).toBe(p.lines[p.grantedIndex]);
    expect(p.summary).toContain('世界线的收束点');
  });

  it('奖励量随等级增长；素材品质随卡档', () => {
    const low = planDefeatCompensation(1, '白铁', () => 0);
    const high = planDefeatCompensation(20, '星辉', () => 0);
    expect(high.lines[0].exp!).toBeGreaterThan(low.lines[0].exp!);
    expect(high.lines[2].material!.rarity).toBe('传说');
  });

  it('describeReward 逐类可读', () => {
    const p = planDefeatCompensation(5, '青铜', () => 0);
    expect(describeReward(p.lines[0])).toContain('经验');
    expect(describeReward(p.lines[1])).toContain('金钱');
    expect(describeReward(p.lines[2])).toContain('素材');
  });
});
