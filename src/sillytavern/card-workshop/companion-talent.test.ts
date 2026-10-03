import { describe, it, expect } from 'vitest';
import {
  COMPANION_TALENT_POOL,
  COMPANION_TALENT_TIER_COEF,
  companionTalentParamsOf,
  fallbackTalentKindOf,
  isCompanionTalentKind,
  companionTalentOf,
  buildCompanionTalent,
} from './companion-talent';
import type { CharacterState } from '../types';

describe('companion-talent（伙伴实体化 D11 天赋池，批④ B4.6）', () => {
  it('池定标：params = round(基数 × 品阶系数)', () => {
    expect(companionTalentParamsOf('黑铁', '嗜血')).toBe(15); // 15×1.0
    expect(companionTalentParamsOf('青铜', '嗜血')).toBe(19); // round(15×1.25)
    expect(companionTalentParamsOf('星辉', '行动值加成')).toBe(9); // round(4×2.2)
    expect(companionTalentParamsOf('鎏金', '体魄')).toBe(18); // round(10×1.8)
  });

  it('品阶系数表五档齐备且递增', () => {
    const coefs = ['黑铁', '青铜', '白银', '鎏金', '星辉'].map(
      (t) => COMPANION_TALENT_TIER_COEF[t as keyof typeof COMPANION_TALENT_TIER_COEF],
    );
    expect(coefs).toEqual([1.0, 1.25, 1.5, 1.8, 2.2]);
    expect(COMPANION_TALENT_POOL.length).toBe(6);
  });

  it('回落表按元素直映：火→嗜血 / 暗→暴击 / 土→体魄 / 金→防御加值 / 雷·风→行动值加成 / 水·冰·光→威压', () => {
    expect(fallbackTalentKindOf(['火', '召唤'])).toBe('嗜血');
    expect(fallbackTalentKindOf(['暗', '召唤'])).toBe('暴击');
    expect(fallbackTalentKindOf(['土', '召唤'])).toBe('体魄');
    expect(fallbackTalentKindOf(['金', '召唤'])).toBe('防御加值');
    expect(fallbackTalentKindOf(['雷', '召唤'])).toBe('行动值加成');
    expect(fallbackTalentKindOf(['风', '召唤'])).toBe('行动值加成');
    expect(fallbackTalentKindOf(['水', '召唤'])).toBe('威压');
    expect(fallbackTalentKindOf(['冰', '召唤'])).toBe('威压');
    expect(fallbackTalentKindOf(['光', '召唤'])).toBe('威压');
    expect(fallbackTalentKindOf(['召唤'])).toBe('行动值加成');
    expect(fallbackTalentKindOf([])).toBe('行动值加成');
    // 首命中元素优先：火 在前按火
    expect(fallbackTalentKindOf(['火', '暗', '召唤'])).toBe('嗜血');
  });

  it('白名单：池内 kind 通过，池外/空拒绝', () => {
    expect(isCompanionTalentKind('嗜血')).toBe(true);
    expect(isCompanionTalentKind('暴击')).toBe(true);
    expect(isCompanionTalentKind('越阶')).toBe(false); // 玩家池的 kind，但不在伙伴池
    expect(isCompanionTalentKind(undefined)).toBe(false);
    expect(isCompanionTalentKind('')).toBe(false);
  });

  it('companionTalentOf：读 talents.list[0] 命中池；无天赋/池外条目 → null', () => {
    const withTalent = {
      talents: {
        capacity: 1,
        list: [
          {
            name: '黑铁·嗜血',
            source: 'universal' as const,
            entries: [{ kind: '嗜血', channel: 'universal' as const, params: { bonus: 15 } }],
          },
        ],
      },
    } as unknown as CharacterState;
    expect(companionTalentOf(withTalent)).toEqual({ kind: '嗜血', params: 15 });

    const withoutTalent = { talents: undefined } as unknown as CharacterState;
    expect(companionTalentOf(withoutTalent)).toBeNull();

    const outsidePool = {
      talents: {
        capacity: 1,
        list: [
          {
            name: '玩家系',
            source: 'creation' as const,
            entries: [{ kind: '越阶', channel: 'creation' as const, params: { tierGain: 1 } }],
          },
        ],
      },
    } as unknown as CharacterState;
    expect(companionTalentOf(outsidePool)).toBeNull();
    expect(companionTalentOf(undefined)).toBeNull();
  });

  it('buildCompanionTalent：AI 提名合法透传；池外/未给走回落表；name 回落品阶·kind', () => {
    const ai = buildCompanionTalent('黑铁', ['火', '召唤'], '暴击', '怨火之瞳');
    expect(ai).toEqual({ name: '怨火之瞳', kind: '暴击', params: 8 });

    const fallback = buildCompanionTalent('黑铁', ['火', '召唤'], '越阶', undefined);
    expect(fallback.kind).toBe('嗜血'); // 池外提名 → 回落表
    expect(fallback.name).toBe('黑铁·嗜血');

    const unnamed = buildCompanionTalent('青铜', ['土', '召唤'], undefined, '   ');
    expect(unnamed.kind).toBe('体魄');
    expect(unnamed.name).toBe('青铜·体魄');
    expect(unnamed.params).toBe(13); // round(10×1.25)
  });
});
