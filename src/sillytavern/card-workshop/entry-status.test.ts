/**
 * entry-status.test.ts — 战技附加的状态编译（2026-09-17，③ 首批）
 *
 * `战技附加` 在条目池里躺了很久没有消费方（48 处条目，含 SS「退化射线」）。
 * 这里钉住「状态名 + 量 + 拍数 → 在场效果」的编译口径，重点覆盖**认不出也别乱猜**。
 */
import { describe, it, expect } from 'vitest';
import { STATUS_TYPE_OVERRIDE, cardStatusEffect, statusEffectOf } from './entry-status';

describe('statusEffectOf —— 状态编译', () => {
  it('显式表认得的名字按表定类型（减速/退化 = 削威胁，眩晕 = 夺行动权）', () => {
    expect(statusEffectOf('减速', 4, 2)?.type).toBe('weaken');
    expect(statusEffectOf('退化', 6, 2)?.type).toBe('weaken');
    expect(statusEffectOf('眩晕', 0, 1)?.type).toBe('stun');
  });

  it('表外的名字按形状兜底：有量 = 持续伤', () => {
    expect(statusEffectOf('中毒', 3, 3)).toEqual({
      name: '战技·中毒',
      type: 'dot',
      amount: 3,
      beatsLeft: 3,
    });
    expect(statusEffectOf('蚀血', 4, 2)?.type).toBe('dot');
    expect(statusEffectOf('吸血', 3, 2)?.type).toBe('dot');
  });

  it('表外且无量但有拍数 = 控制状态（敌方本拍放弃行动）', () => {
    // 条目池里大量 power=0/beats=1 的怪名状态（麻痹/驯服/畏缩/魅惑…）走这一支
    for (const name of ['麻痹', '驯服', '畏缩', '魅惑', '痴迷', '审批', '破贞']) {
      const fx = statusEffectOf(name, 0, 1);
      expect(fx?.type, name).toBe('stun');
      expect(fx?.amount, name).toBe(0);
    }
  });

  it('无量又无拍数 = 纯标记，无战斗效果', () => {
    expect(statusEffectOf('破贞', 0, 0)).toBeUndefined();
    expect(statusEffectOf('', 3, 3)).toBeUndefined();
  });

  it('显式表里的「有量类型」缺量 → 不成立（宁可无效果，也不给 0 伤 DoT）', () => {
    expect(statusEffectOf('减速', 0, 2)).toBeUndefined();
    expect(statusEffectOf('退化', 0, 3)).toBeUndefined();
    // 对照：同样缺量但走形状兜底的未知名 → 落成控制状态
    expect(statusEffectOf('莫名状态', 0, 1)?.type).toBe('stun');
  });

  it('来源名会写进效果名（战报里看得出是谁给的）', () => {
    expect(statusEffectOf('中毒', 3, 3, '褪色短刀')?.name).toBe('战技·中毒（褪色短刀）');
  });

  it('负值/脏值夹到 0，不抛', () => {
    expect(statusEffectOf('中毒', -5, -2)).toBeUndefined();
    expect(statusEffectOf('中毒', 3.6, 2.4)?.amount).toBe(4);
  });
});

describe('cardStatusEffect —— 卡上战技', () => {
  it('无战技 → undefined（旧卡零改动）', () => {
    expect(cardStatusEffect(undefined)).toBeUndefined();
  });

  it('有战技 → 编译出效果', () => {
    expect(cardStatusEffect({ status: '中毒', power: 3, beats: 3 }, '毒刃')).toEqual({
      name: '战技·中毒（毒刃）',
      type: 'dot',
      amount: 3,
      beatsLeft: 3,
    });
  });
});

describe('STATUS_TYPE_OVERRIDE —— 表本身', () => {
  it('只放四种效果类型', () => {
    const allowed = new Set(['dot', 'buff', 'weaken', 'stun']);
    for (const [name, type] of Object.entries(STATUS_TYPE_OVERRIDE)) {
      expect(allowed.has(type), name).toBe(true);
    }
  });
});
