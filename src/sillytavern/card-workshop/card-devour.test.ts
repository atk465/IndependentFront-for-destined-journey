import { describe, it, expect } from 'vitest';
import { devourExpGain, planDevour } from './card-devour';
import type { CardItem, InventoryItem } from '../types';

const 卡 = (name: string, tier: CardItem['cardTier'], 词条: string[] = []): CardItem => ({
  name,
  quantity: 1,
  type: '卡牌',
  cardTier: tier,
  词条,
  sealed: false,
  recipe: {
    mainMaterial: '主',
    subMaterials: [],
    tier,
    fusionKind: '叠加',
    cost: 0,
    rating: '成功',
  },
});

const 素材 = (name: string): InventoryItem => ({ name, quantity: 1, type: '材料' });

describe('planDevour（吞噬：成长 + 词条吸收）', () => {
  it('吞一张卡 → 目标卡战力跃升 + 随机吸收一词条', () => {
    const target = 卡('本命剑', '青铜', ['金']);
    const fuel = 卡('战利品', '青铜', ['火', '淬火']);
    const r = planDevour(target, fuel, () => 0);
    expect(r.ok).toBe(true);
    expect(r.plan!.powerUps).toBeGreaterThanOrEqual(1);
    expect(r.plan!.absorbedEntry).toBe('火');
    expect(r.plan!.new词条).toEqual(['金', '火']);
    expect(r.plan!.fuelName).toBe('战利品');
  });

  it('吞素材 → 只涨经验不吸词条（素材无词条）', () => {
    const r = planDevour(卡('本命剑', '白铁', ['金']), 素材('铁屑'), () => 0);
    expect(r.ok).toBe(true);
    expect(r.plan!.absorbedEntry).toBeUndefined();
    expect(r.plan!.new词条).toEqual(['金']);
  });

  it('燃料档位越高经验越多（白铁 < 星辉）', () => {
    expect(devourExpGain(卡('a', '星辉'), false)).toBeGreaterThan(
      devourExpGain(卡('b', '白铁'), false),
    );
  });

  it('拒绝：不能吞自己 / 非卡非素材 / 燃料超上限', () => {
    const t = 卡('本命剑', '白铁');
    expect(planDevour(t, t).ok).toBe(false);
    expect(planDevour(t, { name: '石头', quantity: 1, type: '装备' } as InventoryItem).ok).toBe(
      false,
    );
    expect(planDevour(t, 卡('神卡', '星辉'), () => 0, 1).ok).toBe(false);
  });
});
