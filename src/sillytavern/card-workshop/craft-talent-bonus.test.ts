import { describe, it, expect } from 'vitest';
import { applyCraftTalentBonus, isDesireDominant } from './craft-talent-bonus';
import type { CardItem } from '../types';

const 卡 = (tier: CardItem['cardTier'], 词条: string[], cost = 100): CardItem => ({
  name: '产物',
  quantity: 1,
  type: '卡牌',
  cardTier: tier,
  词条,
  sealed: false,
  recipe: { mainMaterial: '主', subMaterials: [], tier, fusionKind: '叠加', cost, rating: '成功' },
});

describe('applyCraftTalentBonus（制卡侧天赋加成）', () => {
  it('越阶（卡牌造物主）：品质 +1 且造价减半，审计行进 notes', () => {
    const { card, notes } = applyCraftTalentBonus(卡('青铜', ['火', '技能']), ['火晶'], {
      tierGain: 1,
      halveCost: true,
    });
    expect(card.cardTier).toBe('白银');
    expect(card.recipe.cost).toBe(50);
    expect(notes.join('')).toContain('卡牌造物主');
  });

  it('星辉已封顶 → 越阶无可再上（仍记审计行）', () => {
    const { card, notes } = applyCraftTalentBonus(卡('星辉', ['火', '技能']), [], {
      tierGain: 1,
    });
    expect(card.cardTier).toBe('星辉');
    expect(notes.join('')).toContain('已是星辉');
  });

  it('欲望主导（欲望魔神）：附情绪词条 + 贴合印', () => {
    const { card, notes } = applyCraftTalentBonus(卡('青铜', ['召唤']), ['情绪素材·傲慢'], {
      desireDominant: true,
    });
    expect(card.词条).toContain('傲慢');
    expect(card.词条).toContain('贴合');
    expect(notes.join('')).toContain('欲望魔神');
  });

  it('无天赋开关（缺省）→ 卡原样返回，零改动', () => {
    const src = 卡('青铜', ['火', '技能']);
    const { card, notes } = applyCraftTalentBonus(src, ['火晶'], {});
    expect(card).toEqual(src);
    expect(notes).toEqual([]);
  });

  it('isDesireDominant：情绪素材/情绪名命中即为真', () => {
    expect(isDesireDominant(['情绪素材·傲慢'])).toBe(true);
    expect(isDesireDominant(['暴怒素材'])).toBe(true);
    expect(isDesireDominant(['火晶'])).toBe(false);
  });
});
