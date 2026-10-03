/**
 * card-display.test.ts — 战备简报组装的性质（引擎侧，2026-10-02 批次B）。
 *
 * 效果/战技/副轴三助手的行为测试在 src/ui/lib/card-display.test.ts（经转发 shim 共用）；
 * 本文件钉住批次B 新增的叙事侧口径：单卡定值行 + deck 顺序战备清单。
 */
import { describe, it, expect } from 'vitest';
import type { CardItem } from '../types';
import { cardBriefLine, deckBriefCards } from './card-display';

function card(name: string, over: Partial<CardItem> = {}): CardItem {
  return {
    name,
    quantity: 1,
    type: '卡牌',
    cardTier: '青铜',
    词条: ['火'],
    sealed: false,
    ...over,
  } as CardItem;
}

describe('cardBriefLine', () => {
  it('全段齐活：效果/战技/副轴/未启封，各段按池内定值措辞', () => {
    const line = cardBriefLine(
      card('燎原', {
        cardEffects: [
          {
            trigger: '打出时',
            target: '敌单体',
            action: '连击',
            value: 50,
            duration: 0,
            cost: { sp: 3 },
          },
        ],
        战技: { status: '中毒', power: 5, beats: 2 },
        cardSecondaryAxes: [{ axis: 'spi', bonus: 40 }],
        sealed: true,
      }),
    );
    expect(line).toBe(
      '【燎原】青铜｜效果：【连击】本拍伤害 +50%［代价 3SP］｜战技「中毒」·持续伤害·量 5·2 拍｜副轴：精神 +40%｜未启封',
    );
  });
  it('无元素无登记 → 只有名字与品阶（不硬造段落）', () => {
    expect(cardBriefLine(card('素卡', { 词条: [] }))).toBe('【素卡】青铜');
  });
});

describe('deckBriefCards', () => {
  it('deck 顺序、同名去重、跳过漂移位与物资卡', () => {
    const a = card('燎原');
    const b = card('盾墙', { 词条: ['土'] });
    const junk = card('废料', { 词条: ['火', '物资'] });
    const out = deckBriefCards({
      inventory: [a, b, junk],
      cardAlbum: {
        owned: ['盾墙', '燎原', '废料'],
        deck: ['盾墙', '燎原', '燎原', '废料', '幽灵'],
        capacity: 60,
      },
    });
    expect(out.map((c) => c.name)).toEqual(['盾墙', '燎原']);
  });
  it('空卡组/空背包 → []（调用方按零 token 处理）', () => {
    expect(deckBriefCards({})).toEqual([]);
  });
});
