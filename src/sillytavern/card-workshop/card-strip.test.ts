import { describe, it, expect } from 'vitest';
import { peekMaterialEntries, planStripEntry } from './card-strip';
import type { CardItem } from '../types';

const 卡 = (name: string, tier: CardItem['cardTier'], 词条: string[]): CardItem => ({
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

describe('planStripEntry（词条剥离）', () => {
  it('剥离一个词条 → 卡的其余词条保留 + 产出同品质素材', () => {
    const r = planStripEntry(卡('本命剑', '白银', ['金', '火', '装备']), '火');
    expect(r.ok).toBe(true);
    expect(r.plan!.new词条).toEqual(['金', '装备']);
    expect(r.plan!.material.name).toBe('火素材');
    expect(r.plan!.material.rarity).toBe('稀有');
  });

  it('形态/标记词条不可剥；不存在的词条拒绝；素材卡拒绝', () => {
    expect(planStripEntry(卡('a', '白铁', ['召唤', '火']), '召唤').ok).toBe(false);
    expect(planStripEntry(卡('a', '白铁', ['火']), '冰').ok).toBe(false);
    expect(planStripEntry(卡('a', '白铁', ['素材']), '素材').ok).toBe(false);
    expect(planStripEntry(卡('a', '白铁', ['火']), '  ').ok).toBe(false);
  });

  it('peekMaterialEntries：素材的隐藏词条 = 名字推导的元素', () => {
    expect(peekMaterialEntries({ name: '火晶' })).toContain('火');
    expect(peekMaterialEntries({ name: '无属性碎料' })).toEqual([]);
  });
});
