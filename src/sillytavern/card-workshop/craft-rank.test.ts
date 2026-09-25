/**
 * craft-rank.test.ts — 制卡师等级 = 冒险者等级（2026-09-17）
 *
 * 世界观里「制卡师等级」被反复引用（吞噬/拆解/融合都写「等级不高于你制卡师等级
 * （+1）的…」），本模块把它和冒险者等级**对应**起来。这里钉住对应关系与档位换算。
 */
import { describe, it, expect } from 'vitest';
import { craftLevelOf, craftTierCeiling, craftTierCeilingIndex } from './craft-rank';
import { CARD_TIERS } from '../field-enums';

describe('craftLevelOf —— 制卡师等级 = 冒险者等级（1:1）', () => {
  it('等级原样对应（不缩放、不加偏）', () => {
    for (const lv of [1, 3, 9, 16, 25]) {
      expect(craftLevelOf(lv)).toBe(lv);
    }
  });

  it('脏数据兜底成 1（与 deriveCombatStats 同口径，绝不抛）', () => {
    expect(craftLevelOf(undefined)).toBe(1);
    expect(craftLevelOf(NaN)).toBe(1);
    expect(craftLevelOf(-5)).toBe(1);
    expect(craftLevelOf(7.4)).toBe(7);
  });
});

describe('craftTierCeiling —— 制卡师能处理的最高卡档', () => {
  it('按 tierForLevel 的分界走（+1 级）', () => {
    // lv3+1=4 → 白铁；lv4+1=5 → 青铜；lv8+1=9 → 白银；lv12+1=13 → 鎏金；lv16+1=17 → 星辉
    expect(craftTierCeiling(3, 1)).toBe('白铁');
    expect(craftTierCeiling(4, 1)).toBe('青铜');
    expect(craftTierCeiling(8, 1)).toBe('白银');
    expect(craftTierCeiling(12, 1)).toBe('鎏金');
    expect(craftTierCeiling(16, 1)).toBe('星辉');
  });

  it('等级差档位可调：levelBonus=0 更严、=2 更宽', () => {
    // lv11：+0 → 11（白银）／+1 → 12（白银）／+2 → 13（鎏金）
    expect(craftTierCeiling(11, 0)).toBe('白银');
    expect(craftTierCeiling(11, 1)).toBe('白银');
    expect(craftTierCeiling(11, 2)).toBe('鎏金');
    // 更小等级一眼看得出收紧
    expect(craftTierCeiling(8, 0)).toBe('青铜');
    expect(craftTierCeiling(8, 1)).toBe('白银');
  });

  it('索引口径与 CARD_TIERS 对齐（planDevour/planDismantle 的 maxTierIndex）', () => {
    expect(CARD_TIERS[craftTierCeilingIndex(4, 1)]).toBe('青铜');
    expect(CARD_TIERS[craftTierCeilingIndex(16, 1)]).toBe('星辉');
    expect(craftTierCeilingIndex(99, 1)).toBe(CARD_TIERS.length - 1);
  });
});
