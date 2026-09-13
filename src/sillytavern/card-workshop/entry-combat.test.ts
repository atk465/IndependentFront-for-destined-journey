/**
 * entry-combat.test.ts — 词条战斗语义编译表边界覆盖
 *
 * 表内词条 → 标签翻译必须确定一致；未知词条安全无效果（4-② 裁定）。
 */
import { describe, it, expect } from 'vitest';
import {
  ENTRY_COMBAT_TABLE,
  entryCombatTagsOf,
  cardCombatTags,
  cardCounterAction,
} from './entry-combat';

describe('ENTRY_COMBAT_TABLE（单一真源）', () => {
  it('相生产物带稀缺的打断标签', () => {
    expect(ENTRY_COMBAT_TABLE['燎原']).toEqual(['强攻', '打断']);
    expect(ENTRY_COMBAT_TABLE['霜冻']).toEqual(['防御', '打断']);
    expect(ENTRY_COMBAT_TABLE['虹耀']).toEqual(['防御', '打断']);
  });
  it('九元素各归基础标签', () => {
    expect(ENTRY_COMBAT_TABLE['火']).toEqual(['强攻']);
    expect(ENTRY_COMBAT_TABLE['风']).toEqual(['闪避']);
    expect(ENTRY_COMBAT_TABLE['土']).toEqual(['防御']);
  });
  it('形态词条不进表（形态不是效果）', () => {
    expect(ENTRY_COMBAT_TABLE['装备']).toBeUndefined();
    expect(ENTRY_COMBAT_TABLE['召唤']).toBeUndefined();
  });
});

describe('entryCombatTagsOf —— 未知词条安全无效果', () => {
  it('表内词条返回标签', () => {
    expect(entryCombatTagsOf('磁暴')).toEqual(['强攻', '打断']);
  });
  it('表外词条 → 空数组，不抛', () => {
    expect(entryCombatTagsOf('不存在的词条')).toEqual([]);
    expect(entryCombatTagsOf('')).toEqual([]);
  });
});

describe('cardCombatTags —— 多词条展开去重且输出序稳定', () => {
  it('多词条合并去重，按 强攻→防御→闪避→打断 序输出', () => {
    expect(cardCombatTags(['火', '风', '燎原'])).toEqual(['强攻', '闪避', '打断']);
    expect(cardCombatTags(['燎原', '风', '火'])).toEqual(['强攻', '闪避', '打断']);
  });
  it('无战斗词条的卡 → 空标签（基础战力仍由 cardPower 承担，无死卡）', () => {
    expect(cardCombatTags([])).toEqual([]);
    expect(cardCombatTags(['装备', '技能'])).toEqual([]);
  });
  it('存档数据缺/脏词条不抛（对齐 deck-power 口径）', () => {
    expect(cardCombatTags(null)).toEqual([]);
    expect(cardCombatTags(undefined)).toEqual([]);
    expect(cardCombatTags('火' as never)).toEqual([]);
  });
});

describe('cardCounterAction —— 出卡 = 基础攻击的增强（真机校准 2026-09-13）', () => {
  const stats = { atk: 44 };
  const 卡 = (overrides: Record<string, unknown>) =>
    ({ name: '苍穹之翼', cardTier: '白银', 词条: ['风'], ...overrides }) as never;

  it('行动值 = 攻击 + 2×卡面战力；label 带拆解，审计可复算', () => {
    // 白银 3 + 复合词条 0 → 卡部分 6
    const got = cardCounterAction(卡({ name: '苍穹之翼' }), stats);
    expect(got.power).toBe(50);
    expect(got.label).toBe('打出 苍穹之翼（攻44+卡6）');
    expect(got.cardName).toBe('苍穹之翼');
  });
  it('反制标签随词条走（风 → 闪避）', () => {
    expect(cardCounterAction(卡({}), stats).tags).toEqual(['闪避']);
    expect(cardCounterAction(卡({ 词条: ['火', '燎原'] }), stats).tags).toEqual(['强攻', '打断']);
  });
  it('出卡严格优于裸强攻（44 + 正卡力），无死卡', () => {
    const weak = cardCounterAction(卡({ cardTier: '白铁', 词条: [] }), stats);
    expect(weak.power).toBeGreaterThan(44);
  });
  it('cardPowerBonus 计入卡面战力（卡牌经验满管转化）', () => {
    const got = cardCounterAction(卡({ cardTier: '白铁', 词条: [], cardPowerBonus: 3 }), stats);
    expect(got.power).toBe(44 + 2 * (1 + 3));
  });
});
