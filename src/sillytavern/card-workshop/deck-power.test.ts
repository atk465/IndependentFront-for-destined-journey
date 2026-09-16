/**
 * deck-power.test.ts — 卡组战力（阶段 3a）：权重表 / 复合词条加成 / 重复与漂移位
 */
import { describe, it, expect } from 'vitest';
import { TIER_POWER, battleReadyCards, cardPower, deckGuardBonus, deckPower } from './deck-power';
import type { CardItem } from '../types';

const 卡 = (tier: CardItem['cardTier'], 词条: string[] = []): CardItem =>
  ({
    name: `${tier}卡`,
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
      cost: 10,
      rating: '成功',
    },
  }) as CardItem;

describe('TIER_POWER（单一真源）', () => {
  it('白铁 1 → 星辉 5', () => {
    expect(TIER_POWER).toEqual({ 白铁: 1, 青铜: 2, 白银: 3, 鎏金: 4, 星辉: 5 });
  });
});

describe('cardPower', () => {
  it('纯元素卡 = 品质权重', () => {
    expect(cardPower(卡('白银', ['火']))).toBe(3);
  });
  it('复合词条每个 +2', () => {
    expect(cardPower(卡('青铜', ['火', '风', '燎原']))).toBe(2 + 2);
    expect(cardPower(卡('星辉', ['虹耀', '焚影']))).toBe(5 + 2 * 2);
  });
  it('无词条卡也有底权重', () => {
    expect(cardPower(卡('白铁'))).toBe(1);
  });
  it('卡牌经验满管转化的 cardPowerBonus 逐点累加（交锋拍制）', () => {
    expect(cardPower({ ...卡('白铁'), cardPowerBonus: 3 })).toBe(1 + 3);
    expect(cardPower({ ...卡('星辉', ['燎原']), cardPowerBonus: 2 })).toBe(5 + 2 + 2);
  });
});

describe('存档数据缺字段的健壮性（2026-09-13 真机：deckPower 曾被 null 词条打崩）', () => {
  it('词条缺失 → 无复合加成，不抛', () => {
    expect(cardPower({ cardTier: '白银' } as never)).toBe(3);
    expect(cardPower({ cardTier: '白银', 词条: null } as never)).toBe(3);
  });
  it('品质缺失 → 白铁兜底，不抛', () => {
    expect(cardPower({ 词条: ['火'] } as never)).toBe(1);
  });
});

describe('deckPower', () => {
  const cardOf = (name: string): CardItem | undefined =>
    name === '燎原之卡' ? 卡('青铜', ['燎原']) : name === '白铁之卡' ? 卡('白铁') : undefined;
  it('逐张累加，同名两张计两份', () => {
    expect(deckPower(['燎原之卡', '燎原之卡', '白铁之卡'], cardOf)).toBe(4 + 4 + 1);
  });
  it('查不到实物的编入位按 0 跳过（不炸不猜）', () => {
    expect(deckPower(['幽灵卡', '白铁之卡'], cardOf)).toBe(1);
    expect(deckPower([], cardOf)).toBe(0);
  });
});

// ===== deck 战斗化（2026-09-17）：出卡资格收敛 + 防护加成 =====

describe('battleReadyCards（出卡资格）', () => {
  const inv: CardItem[] = [
    { ...卡('青铜', ['火', '技能']), name: '已编组卡' },
    { ...卡('白银'), name: '未编组卡' },
    { ...卡('鎏金', []), name: '封印卡', sealed: true },
    { ...卡('白铁', []), name: '损坏卡', data: { damaged: true } },
  ];
  const deck = ['已编组卡'];

  it('限卡组：只有编入的卡可出', () => {
    const ready = battleReadyCards(inv, deck);
    expect(ready.map((c) => c.name)).toEqual(['已编组卡']);
  });

  it('空组回退：未整备时全背包可出（不惩罚老档）', () => {
    const ready = battleReadyCards(inv, []);
    expect(ready.map((c) => c.name)).toEqual(['已编组卡', '未编组卡']);
  });

  it('两条过滤恒生效：损坏与未启封永远不可出', () => {
    for (const d of [[], deck]) {
      const names = battleReadyCards(inv, d).map((c) => c.name);
      expect(names).not.toContain('封印卡');
      expect(names).not.toContain('损坏卡');
    }
  });
});

describe('deckGuardBonus（开战防护）', () => {
  it('⌊战力/3⌋，非负', () => {
    expect(deckGuardBonus(0)).toBe(0);
    expect(deckGuardBonus(8)).toBe(2);
    expect(deckGuardBonus(60)).toBe(20);
    expect(deckGuardBonus(-5)).toBe(0);
  });
});
