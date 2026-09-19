import { describe, it, expect } from 'vitest';
import {
  buildCardFromEquipment,
  buildCardFromSkill,
  tierFromItemQuality,
} from './item-card-bridge';

describe('tierFromItemQuality（7 级品质 → 5 级卡 tier）', () => {
  it('逐档映射（普通/优良合流白铁，神话/唯一合流星辉）', () => {
    expect(tierFromItemQuality('普通')).toBe('白铁');
    expect(tierFromItemQuality('优良')).toBe('白铁');
    expect(tierFromItemQuality('稀有')).toBe('青铜');
    expect(tierFromItemQuality('史诗')).toBe('白银');
    expect(tierFromItemQuality('传说')).toBe('鎏金');
    expect(tierFromItemQuality('神话')).toBe('星辉');
    expect(tierFromItemQuality('唯一')).toBe('星辉');
  });

  it('缺失/脏值落最低档（不抛）', () => {
    expect(tierFromItemQuality(undefined)).toBe('白铁');
    expect(tierFromItemQuality('传说级')).toBe('白铁');
    expect(tierFromItemQuality('')).toBe('白铁');
  });
});

describe('buildCardFromEquipment（装备卡 · 双身份）', () => {
  const equip = {
    slot: '武器',
    name: '火焰长剑',
    description: '刀身烧红',
    stats: { 攻击力: 30 },
    durability: 50,
    quality: '史诗',
    modifiers: [{ checkType: '命中', bonus: 2 }],
  } as never;

  it('卡牌侧：type=卡牌 + 品质映射 + 形态与元素词条', () => {
    const card = buildCardFromEquipment(equip, '武器');
    expect(card.type).toBe('卡牌');
    expect(card.cardTier).toBe('白银'); // 史诗 → 白银
    expect(card.词条).toContain('装备');
    expect(card.词条).toContain('火'); // 「火焰」字面命中九元素关键词
    expect(card.sealed).toBe(false);
    expect(card.recipe.tier).toBe('白银');
  });

  it('穿戴侧：equippedSlot/stats/durability/modifiers 原样保留（被动加成不断链）', () => {
    const card = buildCardFromEquipment(equip, '武器');
    expect(card.equippedSlot).toBe('武器');
    expect(card.stats).toEqual({ 攻击力: 30 });
    expect(card.durability).toBe(50);
    expect(card.maxDurability).toBe(50);
    expect(card.modifiers).toHaveLength(1);
  });

  it('slot 为 null（留背包）：equippedSlot 落 null，不编造槽位', () => {
    expect(buildCardFromEquipment(equip, null).equippedSlot).toBeNull();
  });
});

describe('buildCardFromSkill（技能卡）', () => {
  const skill = {
    name: '火焰斩',
    description: '一道火刃',
    type: 'active',
    cost: { type: 'MP', amount: 30 },
    skillPower: 400,
    quality: '稀有',
    automata: [{ kind: 'x' }],
  } as never;

  it('转卡：type=卡牌 + 形态/元素词条 + 品质映射', () => {
    const card = buildCardFromSkill(skill);
    expect(card.type).toBe('卡牌');
    expect(card.cardTier).toBe('青铜');
    expect(card.词条).toContain('技能');
    expect(card.词条).toContain('火');
  });

  it('不透传 skillPower/cost（属已删除的 v3 技能链，避免留死字段）', () => {
    const card = buildCardFromSkill(skill) as unknown as Record<string, unknown>;
    expect(card.skillPower).toBeUndefined();
    expect(card.cost).toBeUndefined();
  });

  it('通用战斗声明仍透传（automata 未来接线可直接生效）', () => {
    expect(buildCardFromSkill(skill).automata).toHaveLength(1);
  });
});
