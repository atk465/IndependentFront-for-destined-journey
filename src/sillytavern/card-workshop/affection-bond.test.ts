/**
 * affection-bond.test.ts —— 好感共鸣（伙伴卡 × 好感度）数值表与边界
 */
import { describe, it, expect } from 'vitest';
import {
  applyBond,
  bondForCard,
  bondMultiplier,
  BOND_NEUTRAL_MULTIPLIER,
  BOND_TIERS,
} from './affection-bond';

describe('bondMultiplier —— 好感档 → 乘区', () => {
  it('档位边界：恰好达到下限即进档', () => {
    expect(bondMultiplier(90)).toBe(1.5); // 誓死追随
    expect(bondMultiplier(70)).toBe(1.4); // 深厚羁绊
    expect(bondMultiplier(50)).toBe(1.3); // 友好信任
    expect(bondMultiplier(30)).toBe(1.2); // 好感
    expect(bondMultiplier(10)).toBe(1.1); // 略有善意
  });

  it('档内取最高满足档（89 仍是深厚羁绊档 1.4，不是 1.3）', () => {
    expect(bondMultiplier(89)).toBe(1.4);
    expect(bondMultiplier(69)).toBe(1.3);
  });

  it('中立（-9..9）不加不减', () => {
    expect(bondMultiplier(0)).toBe(BOND_NEUTRAL_MULTIPLIER);
    expect(bondMultiplier(9)).toBe(BOND_NEUTRAL_MULTIPLIER);
    expect(bondMultiplier(-9)).toBe(BOND_NEUTRAL_MULTIPLIER);
  });

  it('反感及以下消极怠工 ×0.8（含 -100 极值）', () => {
    expect(bondMultiplier(-10)).toBe(0.8);
    expect(bondMultiplier(-50)).toBe(0.8);
    expect(bondMultiplier(-100)).toBe(0.8);
  });

  it('超界输入先钳制（>100 按 100 = 1.5；<-100 按 -100 = 0.8）', () => {
    expect(bondMultiplier(150)).toBe(1.5);
    expect(bondMultiplier(-999)).toBe(0.8);
  });
});

describe('bondForCard —— 名字即羁绊查账', () => {
  it('账本有同名记录 → 返回好感/标签/乘区', () => {
    const bond = bondForCard('莉薇娅', { 莉薇娅: 55 });
    expect(bond).not.toBeNull();
    expect(bond!.affection).toBe(55);
    expect(bond!.label).toBe('友好信任');
    expect(bond!.multiplier).toBe(1.3);
  });

  it('账本无记录 → null（沉默的多数不出审计行）', () => {
    expect(bondForCard('陌生人', { 莉薇娅: 55 })).toBeNull();
    expect(bondForCard('任何人', undefined)).toBeNull();
  });

  it('记录为 0 也是有效记录 → 中立乘区 1（不出加成，但 label 可读）', () => {
    const bond = bondForCard('路人', { 路人: 0 });
    expect(bond).not.toBeNull();
    expect(bond!.multiplier).toBe(1);
    expect(bond!.label).toBe('中立');
  });

  it('坏数据（NaN/Infinity）按无记录处理', () => {
    expect(bondForCard('坏档', { 坏档: Number.NaN })).toBeNull();
    expect(bondForCard('坏档', { 坏档: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe('applyBond —— 乘区取整', () => {
  it('四舍五入取整（交锋数值全整数）', () => {
    expect(applyBond(12, 1.5)).toBe(18);
    expect(applyBond(15, 1.3)).toBe(20); // 19.5 → 20
    expect(applyBond(10, 0.8)).toBe(8);
    expect(applyBond(7, 1.1)).toBe(8); // 7.7 → 8
  });

  it('零威力不加成（0 × 任何倍率 = 0）', () => {
    expect(applyBond(0, 1.5)).toBe(0);
  });
});

describe('BOND_TIERS 表 —— 结构性约束', () => {
  it('阈值降序且乘区严格递减（取满足的最高档）', () => {
    for (let i = 1; i < BOND_TIERS.length; i++) {
      expect(BOND_TIERS[i].min).toBeLessThan(BOND_TIERS[i - 1].min);
      expect(BOND_TIERS[i].multiplier).toBeLessThan(BOND_TIERS[i - 1].multiplier);
    }
  });
});
