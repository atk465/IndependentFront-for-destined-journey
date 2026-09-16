import { describe, it, expect } from 'vitest';
import { matchFreeCardPlay, recommendCards } from './free-card-play';
import type { CardItem } from '../types';

const 卡 = (name: string, tier: CardItem['cardTier'], 词条: string[]): CardItem => ({
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
    cost: 10,
    rating: '成功',
  },
});

const HAND = [
  卡('凝神一击', '白铁', ['火', '技能']),
  卡('苍穹之翼', '白银', ['金', '装备']),
  卡('雾渊鲛姬', '鎏金', ['水', '召唤']),
];

describe('matchFreeCardPlay（L1 确定性快路径）', () => {
  it('句子含卡名 → 出卡，原句作宣言', () => {
    const r = matchFreeCardPlay('我用凝神一击打它的眼睛', HAND, []);
    expect(r.kind).toBe('卡');
    if (r.kind === '卡') {
      expect(r.choice.name).toBe('凝神一击');
      expect(r.choice.intent).toContain('凝神一击');
    }
  });

  it('多张命中 → 取名字最长（更具体的提名优先）', () => {
    const hand = [...HAND, 卡('凝神一击·改', '青铜', ['火', '技能'])];
    const r = matchFreeCardPlay('打出凝神一击·改', hand, []);
    expect(r.kind).toBe('卡');
    if (r.kind === '卡') expect(r.choice.name).toBe('凝神一击·改');
  });

  it('已打出过的卡不再命中（一场一次）', () => {
    const r = matchFreeCardPlay('再打一次凝神一击', HAND, ['凝神一击']);
    expect(r.kind).toBe('none');
  });

  it('基础应对关键词兜底', () => {
    const r = matchFreeCardPlay('这拍先防御', HAND, []);
    expect(r.kind).toBe('应对');
    if (r.kind === '应对') expect(r.choice.move).toBe('防御');
  });

  it('无命中 → none（走叙事管线照旧）', () => {
    expect(matchFreeCardPlay('我朝他大喊：你为什么背叛！', HAND, []).kind).toBe('none');
  });
});

describe('recommendCards（L3 推荐徽章）', () => {
  it('按当前意图的反制标签命中数排序并标记推荐', () => {
    const rows = recommendCards(
      [卡('苍穹之翼', '白银', ['金', '装备']), 卡('凝神一击', '白铁', ['火', '技能'])],
      ['打断'], // 敌方意图反制：打断
      [],
    );
    // 燎原系打断?此处两张都无打断标签 → 都不推荐，顺序稳定
    expect(rows.every((r) => !r.recommended)).toBe(true);
  });

  it('命中意图反制标签的卡获得推荐', () => {
    const rows = recommendCards(
      [卡('带打断的卡', '青铜', ['火', '燎原']), 卡('白铁之卡', '白铁', [])],
      ['打断'],
      [],
    );
    // 燎原 的反制标签含 打断（ENTRY_COMBAT_TABLE）→ 推荐且排前
    expect(rows[0].name).toBe('带打断的卡');
    expect(rows[0].recommended).toBe(true);
    expect(rows[0].counterHits).toBeGreaterThanOrEqual(1);
  });

  it('已打出过的卡不再推荐', () => {
    const rows = recommendCards(
      [卡('带打断的卡', '青铜', ['火', '燎原'])],
      ['打断'],
      ['带打断的卡'],
    );
    expect(rows[0].recommended).toBe(false);
  });
});
