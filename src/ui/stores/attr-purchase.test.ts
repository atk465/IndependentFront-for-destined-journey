import { beforeEach, describe, expect, it } from 'vitest';
import { useCreateStore } from '../stores/create-store';
import { createPinia, setActivePinia } from 'pinia';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('属性购买', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    setActivePinia(createPinia());
    store = useCreateStore();
    store.name = '测试';
    store.selectDifficulty('simple');
  });

  it('购买属性花 100 转生点', () => {
    const costBefore = store.totalCost;
    store.buyPurchasedPoint('力量');
    expect(store.purchasedTotal).toBe(1);
    expect(store.purchasedAttrCost).toBe(100);
    expect(store.totalCost).toBe(costBefore + 100);
  });

  it('每维上限 4（第 5 次购买被拒）', () => {
    for (let i = 0; i < 4; i++) store.buyPurchasedPoint('体质');
    expect(store.purchasedPerAttr('体质')).toBe(4);
    store.buyPurchasedPoint('体质'); // 第 5 次
    expect(store.purchasedPerAttr('体质')).toBe(4); // 没变
  });

  it('finalAttributes 包含购买属性', () => {
    store.buyPurchasedPoint('体质');
    expect(store.finalAttributes['体质']).toBeGreaterThanOrEqual(1);
  });

  it('退回属性 totalCost 减少', () => {
    store.buyPurchasedPoint('力量');
    const before = store.totalCost;
    store.refundPurchasedPoint('力量');
    expect(store.totalCost).toBe(before - 100);
  });

  it('不同维可以各自买到上限', () => {
    for (const attr of ['力量', '敏捷', '体质']) {
      for (let j = 0; j < 4; j++) store.buyPurchasedPoint(attr);
    }
    expect(store.purchasedPerAttr('力量')).toBe(4);
    expect(store.purchasedPerAttr('敏捷')).toBe(4);
    expect(store.purchasedPerAttr('体质')).toBe(4);
    expect(store.purchasedTotal).toBe(12);
  });
});
