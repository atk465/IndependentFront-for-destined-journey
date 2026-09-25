import { describe, it, expect } from 'vitest';
import {
  AFFECTION_DEVOTION,
  CONSORT_RANKS,
  RANK_BONUS,
  planAffectionTribute,
  planEnthrone,
  planSelfEvolution,
} from './companion-growth';
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

describe('planSelfEvolution（最终兵器：自我进化）', () => {
  it('按敌名选出克制词条（确定性，非随机）', () => {
    expect(
      planSelfEvolution(召唤('她', '白银', ['火', '召唤']), '岩爪兽', 10).plan!.gainedEntry,
    ).toBe('缚兽铭');
    expect(
      planSelfEvolution(召唤('她', '白银', ['火', '召唤']), '骨龙', 10).plan!.gainedEntry,
    ).toBe('屠龙铭');
    expect(
      planSelfEvolution(召唤('她', '白银', ['火', '召唤']), '无名氏', 3).plan!.gainedEntry,
    ).toBe('精进铭');
  });

  it('已有同名克制词条 → 换「精进铭·改」；经验随敌级；非伙伴卡拒绝', () => {
    expect(
      planSelfEvolution(召唤('她', '白银', ['缚兽铭', '召唤']), '狼', 5).plan!.gainedEntry,
    ).toBe('精进铭·改');
    expect(planSelfEvolution(召唤('她', '白银', ['召唤']), '狼', 10).plan!.expGain).toBe(300);
    expect(planSelfEvolution({ name: '剑', 词条: ['金', '装备'] }, '狼', 5).ok).toBe(false);
  });
});

describe('planAffectionTribute（结缘）', () => {
  it('好感达「爱恋」(≥90) → 得她一词条 + 她挂后宫光环', () => {
    const r = planAffectionTribute(
      召唤('灰笺', '白银', ['风', '向导', '召唤']),
      AFFECTION_DEVOTION,
    );
    expect(r.ok).toBe(true);
    expect(r.plan!.stolenEntry).toBe('风');
    expect(r.plan!.herNew词条).toContain('后宫光环');
  });

  it('好感不足 / 无记录 / 非伙伴卡 / 已结缘 → 拒绝', () => {
    expect(planAffectionTribute(召唤('a', '白银', ['风', '召唤']), 89).ok).toBe(false);
    expect(planAffectionTribute(召唤('a', '白银', ['风', '召唤']), undefined).ok).toBe(false);
    expect(planAffectionTribute({ name: 'x', 词条: ['金', '装备'] }, 99).ok).toBe(false);
    expect(planAffectionTribute(召唤('a', '白银', ['风', '召唤', '后宫光环']), 99).ok).toBe(false);
  });
});

describe('planEnthrone（位份）', () => {
  it('皇后得全卡组伙伴战力 10%（上限 20）；其余位份固定加成', () => {
    const deck = [召唤('a', '鎏金', ['召唤']), 召唤('b', '鎏金', ['召唤'])];
    const empress = planEnthrone(召唤('后', '白银', ['召唤']), '皇后', deck);
    expect(empress.ok).toBe(true);
    // 两张鎏金召唤卡 = 各 4 战力 → 8 × 10% ≈ 1
    expect(empress.plan!.bonus).toBe(1);
    expect(planEnthrone(召唤('妃', '白银', ['召唤']), '贵妃').plan!.bonus).toBe(RANK_BONUS.贵妃);
    expect(planEnthrone(召唤('妃', '白银', ['召唤']), '贵妃').plan!.new词条).toContain('位份·贵妃');
  });

  it('非伙伴卡 / 未知位份 → 拒绝；位份表含皇后且唯一', () => {
    expect(planEnthrone({ name: '剑', cardTier: '青铜', 词条: ['金', '装备'] }, '妃').ok).toBe(
      false,
    );
    expect(planEnthrone(召唤('a', '白银', ['召唤']), '答应' as never).ok).toBe(false);
    expect(CONSORT_RANKS.filter((r) => r === '皇后')).toHaveLength(1);
  });
});
