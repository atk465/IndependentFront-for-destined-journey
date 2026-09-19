import { describe, it, expect } from 'vitest';
import {
  CONTRACT_AFFECTION_THRESHOLD,
  isSmeltable,
  planAbyssContract,
  planContract,
  planMultiFusion,
  planReshape,
  planSmelt,
} from './card-smelt';
import type { CardItem } from '../types';

const 召唤 = (
  name: string,
  tier: CardItem['cardTier'],
  词条: string[] = ['土', '召唤'],
): CardItem => ({
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

describe('isSmeltable', () => {
  it('召唤卡可熔炼；军团/装备不可', () => {
    expect(isSmeltable(召唤('岩爪', '鎏金'))).toBe(true);
    expect(isSmeltable({ 词条: ['土', '军团'] })).toBe(false);
    expect(isSmeltable({ 词条: ['金', '装备'] })).toBe(false);
  });
});

describe('planSmelt（融合 2 源 / 献祭 ≥3 源）', () => {
  it('献祭 3 张 → 档位 +1（取最高源）+ 各源取一词条 + 集合体', () => {
    const r = planSmelt([
      召唤('岩爪', '鎏金', ['土', '召唤']),
      召唤('炎狮', '白银', ['火', '召唤']),
      召唤('麋王', '青铜', ['雷', '召唤']),
    ]);
    expect(r.ok).toBe(true);
    expect(r.plan!.mode).toBe('献祭');
    expect(r.plan!.product.cardTier).toBe('星辉'); // 鎏金 +1
    expect(r.plan!.product.词条).toEqual(['土', '火', '雷', '集合体']);
    expect(r.plan!.product.name).toContain('·熔铸');
    expect(r.plan!.consumed).toHaveLength(3);
  });

  it('2 源 = 融合模式', () => {
    expect(planSmelt([召唤('a', '青铜'), 召唤('b', '青铜')]).plan!.mode).toBe('融合');
  });

  it('拒绝：<2 张 / 非伙伴卡 / 同名重复', () => {
    expect(planSmelt([召唤('a', '青铜')]).ok).toBe(false);
    expect(planSmelt([召唤('a', '青铜'), { ...召唤('b', '青铜'), 词条: ['金', '装备'] }]).ok).toBe(
      false,
    );
    expect(planSmelt([召唤('a', '青铜'), 召唤('a', '青铜')]).ok).toBe(false);
  });
});

describe('planContract（缔约：好感阈值）', () => {
  it('好感达阈值 → 档位跃迁一阶', () => {
    const r = planContract(召唤('灰笺', '白银'), 80);
    expect(r.ok).toBe(true);
    expect(r.plan!.newTier).toBe('鎏金');
  });

  it('好感不足 / 无记录 / 非伙伴卡 / 已封顶 → 拒绝', () => {
    expect(planContract(召唤('灰笺', '白银'), CONTRACT_AFFECTION_THRESHOLD - 1).ok).toBe(false);
    expect(planContract(召唤('灰笺', '白银'), undefined).ok).toBe(false);
    expect(planContract({ name: 'x', cardTier: '青铜', 词条: ['金', '装备'] }, 99).ok).toBe(false);
    expect(planContract(召唤('灰笺', '星辉'), 99).ok).toBe(false);
  });
});

// ===== 多卡融合（SSS「万物归一」）=====

describe('planMultiFusion（恰好 3 张任意卡）', () => {
  const 任意卡 = (name: string, tier: CardItem['cardTier'], 词条: string[]): CardItem => ({
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

  it('3 张 → 档位 +1、各源取一词条、随机专属词条、归一标记', () => {
    const r = planMultiFusion(
      [任意卡('甲', '白银', ['金']), 任意卡('乙', '青铜', ['火']), 任意卡('丙', '白铁', ['风'])],
      () => 0,
    );
    expect(r.ok).toBe(true);
    expect(r.plan!.product.cardTier).toBe('鎏金');
    expect(r.plan!.product.词条).toContain('金');
    expect(r.plan!.product.词条).toContain('火');
    expect(r.plan!.product.词条).toContain('风');
    expect(r.plan!.product.词条).toContain('归一');
    expect(r.plan!.bonusEntry).toBeDefined();
    expect(r.plan!.product.name).toContain('·归一');
  });

  it('拒绝：张数不是 3 / 同名重复', () => {
    expect(planMultiFusion([任意卡('甲', '白铁', [])]).ok).toBe(false);
    expect(
      planMultiFusion([
        任意卡('甲', '白铁', []),
        任意卡('甲', '白铁', []),
        任意卡('乙', '白铁', []),
      ]).ok,
    ).toBe(false);
  });
});

// ===== 深渊契约（SSS「深渊领主」）与形态改造（SSS「突变巫师」）=====

describe('planAbyssContract（深渊契约）', () => {
  it('深海系（水/冰）伙伴卡 → 获深海/深渊压制词条 + 跃迁一阶', () => {
    const r = planAbyssContract(召唤('雾渊鲛姬', '白银', ['水', '召唤']));
    expect(r.ok).toBe(true);
    expect(r.plan!.new词条).toContain('深海');
    expect(r.plan!.new词条).toContain('深渊压制');
    expect(r.plan!.newTier).toBe('鎏金');
  });

  it('非深海系 / 非伙伴卡 / 已契约 → 拒绝', () => {
    expect(planAbyssContract(召唤('焰鬃炎狮', '白银', ['火', '召唤'])).ok).toBe(false);
    expect(planAbyssContract({ name: 'x', cardTier: '青铜', 词条: ['金', '装备'] }).ok).toBe(false);
    expect(planAbyssContract(召唤('a', '青铜', ['水', '召唤', '深海', '深渊压制'])).ok).toBe(false);
  });
});

describe('planReshape（形态改造）', () => {
  it('追加形态词条；素材卡拒绝；已同形态幂等拒绝', () => {
    const r = planReshape({ name: '铁羽鹫', 词条: ['金', '召唤'] }, '龙娘');
    expect(r.ok).toBe(true);
    expect(r.plan!.new词条).toContain('龙娘');
    expect(planReshape({ name: '碎料', 词条: ['素材'] }, '猫娘').ok).toBe(false);
    expect(planReshape({ name: 'x', 词条: ['猫娘', '召唤'] }, '猫娘').ok).toBe(false);
    expect(planReshape({ name: 'x', 词条: ['召唤'] }, '  ').ok).toBe(false);
  });
});
