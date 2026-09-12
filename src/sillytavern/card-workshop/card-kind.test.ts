/**
 * card-kind.test.ts — 卡类型系统（八类形态词条制）
 */
import { describe, it, expect } from 'vitest';
import {
  CARD_KINDS,
  DEFAULT_CARD_KIND,
  KIND_ENTRY,
  cardKindOf,
  isConsumable,
  isPlayable,
  cardKind,
  isPlayableCard,
} from './card-kind';

describe('八类类型与形态词条', () => {
  it('类型表八类齐备', () => {
    expect([...CARD_KINDS]).toEqual([
      '装备',
      '技能',
      '领域',
      '召唤',
      '军团',
      '物资',
      '场景',
      '素材',
    ]);
  });
  it('形态词条判定：各类命中', () => {
    expect(cardKindOf(['火', '装备'])).toBe('装备');
    expect(cardKindOf(['地景'])).toBe('领域'); // 领域卡沿用「地景」词条（combat-v3 通道判据）
    expect(cardKindOf(['土', '召唤'])).toBe('召唤');
    expect(cardKindOf(['召唤', '岩爪'])).toBe('召唤');
    expect(cardKindOf(['军团'])).toBe('军团');
    expect(cardKindOf(['物资'])).toBe('物资');
    expect(cardKindOf(['场景'])).toBe('场景');
    expect(cardKindOf(['素材'])).toBe('素材');
    expect(cardKindOf(['技能'])).toBe('技能');
  });
  it('皆无形态词 = 技能卡（缺省类型）', () => {
    expect(cardKindOf(['火', '风', '燎原'])).toBe(DEFAULT_CARD_KIND);
    expect(cardKindOf([])).toBe(DEFAULT_CARD_KIND);
  });
  it('多形态词条 = 内容错误防御：按固定优先级取首个命中', () => {
    // 召唤 > 装备：同时携带时判召唤
    expect(cardKindOf(['装备', '召唤'])).toBe('召唤');
    expect(cardKindOf(['素材', '装备'])).toBe('装备');
  });
  it('KIND_ENTRY 与优先级表覆盖一致（结构自检）', () => {
    expect(Object.keys(KIND_ENTRY).sort()).toEqual([...CARD_KINDS].sort());
  });
});

describe('消耗性（1.3 裁定）', () => {
  it('技能/领域/场景/物资 = 消耗', () => {
    expect(isConsumable('技能')).toBe(true);
    expect(isConsumable('领域')).toBe(true);
    expect(isConsumable('场景')).toBe(true);
    expect(isConsumable('物资')).toBe(true);
  });
  it('装备/召唤/军团 = 永久', () => {
    expect(isConsumable('装备')).toBe(false);
    expect(isConsumable('召唤')).toBe(false);
    expect(isConsumable('军团')).toBe(false);
    expect(isConsumable('素材')).toBe(false); // 素材不可打出，谈不上消耗
  });
});

describe('可打出性', () => {
  it('素材卡不可战斗打出（材料载体）', () => {
    expect(isPlayable('素材')).toBe(false);
    for (const kind of CARD_KINDS) {
      if (kind !== '素材') expect(isPlayable(kind), kind).toBe(true);
    }
  });
});

describe('便捷判定', () => {
  it('cardKind / isPlayableCard 直接吃卡', () => {
    expect(cardKind({ 词条: ['地景'] })).toBe('领域');
    expect(isPlayableCard({ 词条: ['素材', '火'] })).toBe(false);
    expect(isPlayableCard({ 词条: ['火', '风'] })).toBe(true);
  });
});
