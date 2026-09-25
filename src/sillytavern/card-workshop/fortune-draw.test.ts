import { describe, it, expect } from 'vitest';
import { FORTUNE_MODES, drawFortuneCard, rollFortuneTier } from './fortune-draw';
import type { CardCatalogItem } from '../start-catalog-mechanics';

function poolCard(id: string, tier: CardCatalogItem['cardTier']): CardCatalogItem {
  return { id, name: `卡${id}`, cardTier: tier, formEntry: '装备', description: '', cost: 10 };
}

const POOL = [
  poolCard('a', '白铁'),
  poolCard('b', '青铜'),
  poolCard('c', '白银'),
  poolCard('d', '鎏金'),
];

describe('rollFortuneTier（d100 → 品质档）', () => {
  it('帝冕币口径：1-40 白铁 / 41-75 青铜 / 76-95 白银 / 96-100 鎏金，星辉不出', () => {
    expect(rollFortuneTier('coin', 1)).toBe('白铁');
    expect(rollFortuneTier('coin', 40)).toBe('白铁');
    expect(rollFortuneTier('coin', 41)).toBe('青铜');
    expect(rollFortuneTier('coin', 75)).toBe('青铜');
    expect(rollFortuneTier('coin', 76)).toBe('白银');
    expect(rollFortuneTier('coin', 95)).toBe('白银');
    expect(rollFortuneTier('coin', 96)).toBe('鎏金');
    expect(rollFortuneTier('coin', 100)).toBe('鎏金');
  });

  it('命运点口径：1-60 白银 / 61-90 鎏金 / 91-100 星辉（必得中品以上）', () => {
    expect(rollFortuneTier('fp', 1)).toBe('白银');
    expect(rollFortuneTier('fp', 60)).toBe('白银');
    expect(rollFortuneTier('fp', 61)).toBe('鎏金');
    expect(rollFortuneTier('fp', 90)).toBe('鎏金');
    expect(rollFortuneTier('fp', 91)).toBe('星辉');
    expect(rollFortuneTier('fp', 100)).toBe('星辉');
  });

  it('越界输入收敛到 1-100', () => {
    expect(rollFortuneTier('coin', 0)).toBe(rollFortuneTier('coin', 1));
    expect(rollFortuneTier('coin', 999)).toBe(rollFortuneTier('coin', 100));
  });

  it('口径表自检：币抽不出星辉，FP 抽不出白铁青铜', () => {
    expect(FORTUNE_MODES.coin.weights['星辉']).toBe(0);
    expect(FORTUNE_MODES.fp.weights['白铁']).toBe(0);
    expect(FORTUNE_MODES.fp.weights['青铜']).toBe(0);
  });
});

describe('drawFortuneCard（按档抽卡，向下顺延）', () => {
  it('该档有卡 → 恰好抽到该档之一', () => {
    for (let i = 0; i < 20; i++) {
      const c = drawFortuneCard(POOL, '青铜');
      expect(c?.cardTier).toBe('青铜');
    }
  });

  it('该档为空 → 向下顺延（星辉请求落到鎏金）', () => {
    const c = drawFortuneCard(POOL, '星辉');
    expect(c?.cardTier).toBe('鎏金');
  });

  it('空池 → undefined', () => {
    expect(drawFortuneCard([], '白铁')).toBeUndefined();
  });
});
