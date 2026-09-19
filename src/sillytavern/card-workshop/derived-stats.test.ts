/**
 * derived-stats.test.ts — 派生战斗数值层边界覆盖
 *
 * 公式锚点 = 参考截图基础段量级（str14、Lv9 → 攻 37）；脏数据兜底绝不抛。
 */
import { describe, it, expect } from 'vitest';
import { deriveCombatStats, basicCounterAction } from './derived-stats';

describe('deriveCombatStats —— 五维派生公式（v1）', () => {
  it('锚点：str14 Lv9 → 攻 37；con14 Lv9 → 防 32；dex12 Lv9 → 敏 28', () => {
    expect(deriveCombatStats({ attributes: { str: 14, con: 14, dex: 12 }, level: 9 })).toEqual({
      atk: 37,
      guard: 32,
      agi: 28,
    });
  });
  it('等级参与攻防敏（⌊level/2⌋ 入防敏）', () => {
    const got = deriveCombatStats({ attributes: { str: 10, con: 10, dex: 10 }, level: 1 });
    expect(got).toEqual({ atk: 21, guard: 20, agi: 20 });
  });
  it('缺五维按 10 兜底、缺等级按 1 兜底，不抛', () => {
    expect(deriveCombatStats({})).toEqual({ atk: 21, guard: 20, agi: 20 });
    expect(deriveCombatStats({ attributes: undefined, level: undefined })).toEqual({
      atk: 21,
      guard: 20,
      agi: 20,
    });
  });
  it('脏五维/脏等级按缺项兜底；等级取整且下限 1', () => {
    expect(
      deriveCombatStats({ attributes: { str: NaN, con: '高', dex: null } as never, level: NaN }),
    ).toEqual({
      atk: 21,
      guard: 20,
      agi: 20,
    });
    expect(deriveCombatStats({ attributes: { str: 20 }, level: 0 }).atk).toBe(41);
    expect(deriveCombatStats({ attributes: { str: 20 }, level: 9.6 }).atk).toBe(50);
  });
});

describe('basicCounterAction —— 基础应对装配', () => {
  const stats = { atk: 37, guard: 32, agi: 28 };
  it('三选项各取对应派生维，标签 = 同名单标签', () => {
    expect(basicCounterAction('强攻', stats)).toEqual({ label: '强攻', power: 37, tags: ['强攻'] });
    expect(basicCounterAction('防御', stats)).toEqual({ label: '防御', power: 32, tags: ['防御'] });
    expect(basicCounterAction('闪避', stats)).toEqual({ label: '闪避', power: 28, tags: ['闪避'] });
  });
});
