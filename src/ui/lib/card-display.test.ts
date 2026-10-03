/**
 * card-display.test.ts — 卡牌战斗面展示行组装的性质（2026-10-02 批次A）
 *
 * 1. **读侧过门禁**：效果走 deriveCardEffects 三级来源（登记>元素打底），副轴
 *    走 coerceSecondaryAxes（超槽/同主轴/档外丢弃）——展示的必须是会生效的那份。
 * 2. **措辞不另起真源**：效果行沿用 effectLineOf（UI 与 AI 提示词共用）。
 */
import { describe, it, expect } from 'vitest';
import type { CardItem } from '@engine/types';
import { cardAxisChips, cardEffectLines, cardWarSkillLine } from './card-display';

function card(over: Partial<CardItem> = {}): CardItem {
  return {
    name: '试卡',
    quantity: 1,
    type: '卡牌',
    cardTier: '白银',
    词条: ['火'],
    sealed: false,
    ...over,
  } as CardItem;
}

describe('效果行', () => {
  it('无登记效果时按元素派生打底（火→灼烧），措辞沿用池内定值', () => {
    expect(cardEffectLines(card())).toEqual(['【灼烧】每拍 65% 主属性伤害（2 拍）']);
  });
  it('卡面登记效果优先于元素打底', () => {
    const lines = cardEffectLines(
      card({
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
      }),
    );
    expect(lines).toEqual(['【连击】本拍伤害 +50%［代价 3SP］']);
  });
  it('池外/改数的选择被门禁丢弃 → 回落元素打底', () => {
    const lines = cardEffectLines(
      card({
        cardEffects: [
          { trigger: '打出时', target: '敌单体', action: '连击', value: 99, duration: 0 },
        ],
      }),
    );
    expect(lines).toEqual(['【灼烧】每拍 65% 主属性伤害（2 拍）']);
  });
});

describe('战技行', () => {
  it('有量状态标注类型与量/拍；表外状态按形状兜底', () => {
    expect(cardWarSkillLine(card({ 战技: { status: '中毒', power: 5, beats: 2 } }))).toBe(
      '战技「中毒」·持续伤害·量 5·2 拍',
    );
    expect(cardWarSkillLine(card({ 战技: { status: '眩晕', power: 0, beats: 1 } }))).toBe(
      '战技「眩晕」·夺行动权·1 拍',
    );
  });
  it('无量纯标记如实标注，不硬造机械效果', () => {
    expect(cardWarSkillLine(card({ 战技: { status: '无名印记', power: 0, beats: 0 } }))).toBe(
      '战技「无名印记」·纯标记（无机械效果）',
    );
  });
  it('无战技返回 undefined', () => {
    expect(cardWarSkillLine(card())).toBeUndefined();
  });
});

describe('副轴芯片', () => {
  it('档内合法副轴显示中文轴名+档位%', () => {
    expect(cardAxisChips(card({ cardSecondaryAxes: [{ axis: 'spi', bonus: 40 }] }))).toEqual([
      { label: '精神', bonus: 40 },
    ]);
  });
  it('同主轴/档外档位丢弃；黑铁无副轴槽', () => {
    expect(cardAxisChips(card({ cardSecondaryAxes: [{ axis: 'str', bonus: 40 }] }))).toEqual([]);
    expect(cardAxisChips(card({ cardSecondaryAxes: [{ axis: 'spi', bonus: 30 }] }))).toEqual([]);
    expect(
      cardAxisChips(card({ cardTier: '黑铁', cardSecondaryAxes: [{ axis: 'spi', bonus: 40 }] })),
    ).toEqual([]);
  });
});
