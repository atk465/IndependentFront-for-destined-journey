import { describe, it, expect } from 'vitest';
import { MAX_DISCOUNT_PCT, buyPrice, sellPrice, shopDiscountOf } from './shop-system';
import { getTalentTemplate, hasWorkingMechanic } from './talent-entry';

describe('shopDiscountOf', () => {
  const 持 = (pct: number) => [
    {
      entries: [
        { kind: '交易折扣' as const, channel: 'universal' as const, params: { discountPct: pct } },
      ],
    },
  ];

  it('单条折扣', () => {
    expect(shopDiscountOf(持(5))).toBe(5);
    expect(shopDiscountOf(持(10))).toBe(10);
  });

  it('多条叠加', () => {
    expect(shopDiscountOf([...持(5), ...持(10)])).toBe(15);
  });

  it('clamp 到 50（防滚雪球）', () => {
    expect(shopDiscountOf([...持(30), ...持(30)])).toBe(50);
  });

  it('无天赋 → 0', () => {
    expect(shopDiscountOf(undefined)).toBe(0);
    expect(shopDiscountOf([])).toBe(0);
  });

  it('负数/脏值夹到 0', () => {
    expect(shopDiscountOf(持(-5))).toBe(0);
  });
});

describe('buyPrice / sellPrice', () => {
  it('买价 = 原价 × (1 − 折扣%)', () => {
    expect(buyPrice(100, 5)).toBe(95);
    expect(buyPrice(100, 50)).toBe(50);
    expect(buyPrice(100, 0)).toBe(100);
  });

  it('买价下限 1（不白送）', () => {
    expect(buyPrice(1, 50)).toBe(1);
  });

  it('卖价 = 原价 × 系数（缺省半价回收）', () => {
    expect(sellPrice(100)).toBe(50);
    expect(sellPrice(100, 80)).toBe(80);
    expect(sellPrice(0)).toBe(1); // 下限 1
  });
});

describe('天赋接线', () => {
  it('讨价还价(C)：交易折扣 5%', () => {
    const tpl = getTalentTemplate('讨价还价');
    expect(tpl?.grade).toBe('C');
    expect(tpl!.entries).toEqual([
      { kind: '交易折扣', channel: 'universal', params: { discountPct: 5 } },
    ]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('黑市贵宾(A)：交易折扣 10% + 叙事', () => {
    const tpl = getTalentTemplate('黑市贵宾');
    expect(tpl?.grade).toBe('A');
    expect(tpl!.entries.map((e) => e.kind)).toEqual(['交易折扣', '叙事意图']);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('MAX_DISCOUNT_PCT 是明确常量', () => {
    expect(MAX_DISCOUNT_PCT).toBe(50);
  });
});
