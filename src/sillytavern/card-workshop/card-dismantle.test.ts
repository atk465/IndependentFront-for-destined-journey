import { describe, it, expect } from 'vitest';
import { planDismantle } from './card-dismantle';
import type { CardItem, InventoryItem } from '../types';

const 卡 = (tier: CardItem['cardTier']): CardItem => ({
  name: '测试卡',
  quantity: 1,
  type: '卡牌',
  cardTier: tier,
  词条: [],
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

describe('planDismantle（素材拆解）', () => {
  it('卡牌 → 两份对应品质素材（档位映射）', () => {
    const r = planDismantle(卡('鎏金'));
    expect(r.ok).toBe(true);
    expect(r.plan!.yields).toHaveLength(1);
    expect(r.plan!.yields[0].rarity).toBe('史诗');
    expect(r.plan!.yields[0].quantity).toBe(2);
  });

  it('装备/道具 → 按自身品质产出一份', () => {
    const eq: InventoryItem = { name: '钢剑', quantity: 1, type: '装备', rarity: '稀有' };
    const r = planDismantle(eq);
    expect(r.ok).toBe(true);
    expect(r.plan!.yields[0].rarity).toBe('稀有');
    expect(r.plan!.yields[0].quantity).toBe(1);
  });

  it('材料不可再拆（防套娃）；超档位拒绝', () => {
    expect(planDismantle({ name: '铁屑', quantity: 1, type: '材料' }).ok).toBe(false);
    expect(planDismantle(卡('星辉'), 1).ok).toBe(false);
  });
});
