import { describe, it, expect } from 'vitest';
import {
  planCaptureEnemy,
  planCorruptCompanion,
  planOffspring,
  tierForLevel,
} from './companion-capture';
import type { CardItem } from '../types';

const 召唤 = (name: string, tier: CardItem['cardTier'], 词条: string[]): CardItem => ({
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

describe('tierForLevel（等级→卡档）', () => {
  it('按等级区间映射五档', () => {
    expect(tierForLevel(1)).toBe('白铁');
    expect(tierForLevel(6)).toBe('青铜');
    expect(tierForLevel(10)).toBe('白银');
    expect(tierForLevel(15)).toBe('鎏金');
    expect(tierForLevel(30)).toBe('星辉');
  });
});

describe('planCaptureEnemy（捕获敌人）', () => {
  it('等级相近 → 产出召唤卡（含召唤/捕获词条，档位随敌级）', () => {
    const r = planCaptureEnemy('岩爪兽', 10, 10, () => 0);
    expect(r.ok).toBe(true);
    expect(r.plan!.card.name).toBe('岩爪兽');
    expect(r.plan!.card.cardTier).toBe('白银');
    expect(r.plan!.card.词条).toContain('召唤');
    expect(r.plan!.card.词条).toContain('捕获');
  });

  it('敌人越级太多（>玩家+1）→ 拒绝；无名拒绝', () => {
    expect(planCaptureEnemy('冠军', 20, 10).ok).toBe(false);
    expect(planCaptureEnemy('老冠军', 11, 10).ok).toBe(true);
    expect(planCaptureEnemy('  ', 5, 10).ok).toBe(false);
  });
});

describe('planOffspring（孕育子嗣）', () => {
  it('双亲各取一词条 + 子嗣标记，档位取较高者（不 +1）', () => {
    const r = planOffspring(
      召唤('雾渊鲛姬', '白银', ['水', '召唤']),
      召唤('焰鬃炎狮', '青铜', ['火', '召唤']),
      () => 0,
    );
    expect(r.ok).toBe(true);
    expect(r.plan!.inherited).toContain('水');
    expect(r.plan!.inherited).toContain('火');
    expect(r.plan!.card.词条).toContain('子嗣');
    expect(r.plan!.card.cardTier).toBe('白银');
  });

  it('非伙伴卡 / 同名自亲 → 拒绝', () => {
    expect(
      planOffspring(
        { name: '剑', cardTier: '青铜', 词条: ['金', '装备'] },
        召唤('a', '青铜', ['召唤']),
      ).ok,
    ).toBe(false);
    expect(
      planOffspring(召唤('a', '青铜', ['水', '召唤']), 召唤('a', '青铜', ['水', '召唤'])).ok,
    ).toBe(false);
  });
});

describe('planCorruptCompanion（转化伙伴卡）', () => {
  it('词条逐条兑素材（品质随卡档），卡退场', () => {
    const r = planCorruptCompanion(召唤('灰笺', '鎏金', ['风', '召唤', '向导']));
    expect(r.ok).toBe(true);
    expect(r.plan!.sourceName).toBe('灰笺');
    expect(r.plan!.materials).toHaveLength(2);
    expect(r.plan!.materials[0].rarity).toBe('史诗');
    expect(r.plan!.materials.map((m) => m.name)).toEqual(['风素材', '向导素材']);
  });

  it('非伙伴卡 / 损坏卡 → 拒绝；无词条给保底素材', () => {
    expect(planCorruptCompanion({ name: '剑', cardTier: '青铜', 词条: ['金', '装备'] }).ok).toBe(
      false,
    );
    expect(
      planCorruptCompanion({ name: 'x', cardTier: '青铜', 词条: ['召唤'], data: { damaged: true } })
        .ok,
    ).toBe(false);
    const r = planCorruptCompanion(召唤('空卡', '白铁', ['召唤']));
    expect(r.ok).toBe(true);
    expect(r.plan!.materials).toHaveLength(1);
  });
});
