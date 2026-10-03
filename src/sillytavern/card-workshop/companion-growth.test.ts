import { describe, it, expect } from 'vitest';
import {
  AFFECTION_DEVOTION,
  CONSORT_RANKS,
  RANK_BONUS,
  planAffectionTribute,
  planEnthrone,
  planSelfEvolution,
  planEmbedOffering,
  planCompanionEvolution,
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

// ═══ 2026-10-02 批次C：进化倾向三选一 + 投喂 ═══

import {
  EVOLUTION_ROUTES,
  evolutionRouteOf,
  planEvolutionDirection,
  planFeedCompanion,
} from './companion-growth';
import type { InventoryItem } from '../types';

const 材料 = (name: string, over: Partial<InventoryItem> = {}): InventoryItem => ({
  name,
  quantity: 1,
  type: '材料',
  ...over,
});

describe('进化倾向（批次C：三选一路线，存 data.倾向）', () => {
  it('倾向只在克制空档补位：战况克制仍最优先', () => {
    const routed = { ...召唤('她', '白银', ['火', '召唤']), data: { 倾向: '炽野' } };
    expect(planSelfEvolution(routed, '岩爪兽', 5).plan!.gainedEntry).toBe('缚兽铭');
    expect(planSelfEvolution(routed, '无名氏', 3).plan!.gainedEntry).toBe('炽野铭');
    const learned = { ...召唤('她', '白银', ['炽野铭', '召唤']), data: { 倾向: '炽野' } };
    expect(planSelfEvolution(learned, '骨龙', 5).plan!.gainedEntry).toBe('屠龙铭');
    expect(planSelfEvolution(learned, '无名氏', 3).plan!.gainedEntry).toBe('精进铭');
    const plain = 召唤('她', '白银', ['缚兽铭', '召唤']);
    expect(planSelfEvolution(plain, '狼', 5).plan!.gainedEntry).toBe('精进铭·改');
  });

  it('planEvolutionDirection：定下/转向措辞、未知路线与非伙伴卡拒绝', () => {
    const card = 召唤('她', '白银', ['火', '召唤']);
    expect(planEvolutionDirection(card, '贯城').plan!.summary).toContain('定下进化倾向「贯城」');
    expect(
      planEvolutionDirection({ ...card, data: { 倾向: '炽野' } }, '镜影').plan!.summary,
    ).toContain('由「炽野」转向「镜影」');
    expect(planEvolutionDirection(card, '无敌' as never).ok).toBe(false);
    expect(planEvolutionDirection({ name: '剑', 词条: ['金', '装备'] }, '贯城').ok).toBe(false);
    expect(EVOLUTION_ROUTES).toHaveLength(3);
  });

  it('evolutionRouteOf 脏值安全回落', () => {
    expect(evolutionRouteOf(undefined)).toBeUndefined();
    expect(evolutionRouteOf({ 倾向: '不存在的路线' })).toBeUndefined();
    expect(evolutionRouteOf({ 倾向: '镜影' })?.entry).toBe('镜影铭');
  });
});

describe('投喂（批次C：素材按元素匹配换卡面成长）', () => {
  it('同源 ×2 / 相生 ×1.5 / 相克 ×0.5 / 中性 ×1（优先级同 classifyFusion）', () => {
    const fire = 召唤('她', '黑铁', ['火', '召唤']);
    expect(planFeedCompanion(fire, 材料('龙血草')).plan!.matchLabel).toBe('火·同源共鸣 ×2');
    expect(planFeedCompanion(fire, 材料('龙血草')).plan!.rawExp).toBe(50);
    expect(planFeedCompanion(fire, 材料('蒲公英')).plan!.matchLabel).toBe('相生共鸣 ×1.5');
    expect(planFeedCompanion(fire, 材料('止血草')).plan!.matchLabel).toBe('相克相冲 ×0.5');
    expect(planFeedCompanion(fire, 材料('铁矿')).plan!.matchLabel).toBe('中性滋养 ×1');
    const plain = 召唤('她', '黑铁', ['召唤']);
    expect(planFeedCompanion(plain, 材料('龙血草')).plan!.matchLabel).toBe('中性滋养 ×1');
  });

  it('满管溢出 → 卡面战力 +1（传说火素材喂黑铁火卡 = 250 经验 > 200 管容）', () => {
    const fed = planFeedCompanion(
      召唤('她', '黑铁', ['火', '召唤']),
      材料('龙血草', { rarity: '传说' }),
    );
    expect(fed.plan!.rawExp).toBe(250);
    expect(fed.plan!.powerUps).toBe(1);
    expect(fed.plan!.cardExp).toBe(50);
    expect(fed.plan!.cardPowerBonus).toBe(1);
  });

  it('非伙伴卡 / 非材料拒绝', () => {
    expect(
      planFeedCompanion({ name: '剑', 词条: ['金', '装备'], cardTier: '黑铁' }, 材料('铁矿')).ok,
    ).toBe(false);
    expect(
      planFeedCompanion(召唤('她', '黑铁', ['火', '召唤']), {
        name: '燎原',
        quantity: 1,
        type: '卡牌',
      } as unknown as InventoryItem).ok,
    ).toBe(false);
  });
});

// ═══ 进化仪式（伙伴实体化 D13，批⑤ B5.1）═══

describe('planEmbedOffering（祭品嵌入矩阵）', () => {
  const card = { name: '愤怨瓷心·艾拉', cardTier: '黑铁' as const };
  const mat = (
    name: string,
    rarity: '普通' | '稀有' | '史诗',
    elements: string[],
  ): import('../types').InventoryItem =>
    ({
      name,
      quantity: 1,
      type: '材料',
      rarity,
      data: { elements },
    }) as import('../types').InventoryItem;

  it('元素交集命中 → 通过（炽野要火）', () => {
    const r = planEmbedOffering(card, mat('火岩', '稀有', ['火']), '炽野', []);
    expect(r.ok).toBe(true);
    expect(r.plan?.offerings).toEqual(['火岩']);
  });
  it('元素不符 → 拒绝', () => {
    expect(planEmbedOffering(card, mat('寒水', '稀有', ['水']), '炽野', []).ok).toBe(false);
  });
  it('品质档低于卡档 → 拒绝（白银卡要稀有+）', () => {
    const silver = { name: '卡', cardTier: '白银' as const };
    expect(planEmbedOffering(silver, mat('火渣', '普通', ['火']), '炽野', []).ok).toBe(false);
    expect(planEmbedOffering(silver, mat('火晶', '稀有', ['火']), '炽野', []).ok).toBe(true);
  });
  it('上限 3 份 → 拒绝第四份', () => {
    expect(planEmbedOffering(card, mat('火岩', '稀有', ['火']), '炽野', ['a', 'b', 'c']).ok).toBe(
      false,
    );
  });
});

describe('planCompanionEvolution（四门槛）', () => {
  const base = {
    level: 10,
    cardTier: '黑铁' as const,
    archetype: '炽野' as string | undefined,
    offerings: ['a', 'b', 'c'],
    affection: 50,
    cardName: '艾拉',
  };
  it('四门槛全过 → plan（品阶升青铜）', () => {
    const r = planCompanionEvolution(base);
    expect(r.ok).toBe(true);
    expect(r.plan?.newTier).toBe('青铜');
  });
  it('逐项未达给 reason', () => {
    const r = planCompanionEvolution({
      ...base,
      level: 9,
      archetype: undefined,
      offerings: ['a'],
      affection: 10,
    });
    expect(r.ok).toBe(false);
    expect(r.gates.reasons.join()).toContain('等级不足');
    expect(r.gates.reasons.join()).toContain('倾向未定');
    expect(r.gates.reasons.join()).toContain('祭品不全');
    expect(r.gates.reasons.join()).toContain('忠诚不足');
  });
  it('星辉已是顶阶 → newTier 原档', () => {
    const r = planCompanionEvolution({ ...base, cardTier: '星辉', level: 25 });
    expect(r.ok).toBe(true);
    expect(r.plan?.newTier).toBe('星辉');
  });
});
