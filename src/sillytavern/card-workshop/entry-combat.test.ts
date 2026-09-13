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
  cardPlayPlan,
  IN_PLAY_KINDS,
  sealedCardPlay,
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

describe('cardPlayPlan —— 八类卡语义矩阵（真机裁定 2026-09-13）', () => {
  const stats = { atk: 44 };
  const 卡 = (overrides: Record<string, unknown>) =>
    ({ name: '测试卡', cardTier: '白银', 词条: [], ...overrides }) as never;

  it('技能/物资（缺省技能）→ 直击：攻+2×卡力，审计拆解进 label', () => {
    const plan = cardPlayPlan(卡({ 词条: ['技能', '火'] }), stats);
    expect(plan.mode).toBe('直击');
    if (plan.mode === '直击') {
      expect(plan.action.power).toBe(50); // 44 + 2×白银3（火是元素词条，不计复合）
      expect(plan.action.tags).toEqual(['强攻']);
    }
  });
  it('领域（攻系元素）→ 在场 DoT 2×卡力；当拍不造伤', () => {
    const plan = cardPlayPlan(卡({ name: '灼热盆地', 词条: ['地景', '火'] }), stats);
    expect(plan.mode).toBe('在场');
    if (plan.mode === '在场') {
      expect(plan.effect).toEqual({ name: '灼热盆地', type: 'dot', amount: 6 }); // 白银3 → 2×3
      expect(plan.action.power).toBe(44); // 场地不能直接打人
      expect(plan.action.label).toContain('灼烧−6');
    }
  });
  it('领域（防系/风元素）→ 在场 buff 卡力', () => {
    const plan = cardPlayPlan(卡({ name: '静水湖畔', 词条: ['地景', '水'] }), stats);
    expect(plan.mode).toBe('在场');
    if (plan.mode === '在场')
      expect(plan.effect).toEqual({ name: '静水湖畔', type: 'buff', amount: 3 });
  });
  it('装备 → 在场 buff 2×卡力；召唤 → 登场直击 + 助战 buff', () => {
    const equip = cardPlayPlan(卡({ name: '秘银长剑', 词条: ['装备', '金'] }), stats);
    expect(equip.mode).toBe('在场');
    if (equip.mode === '在场') {
      expect(equip.effect).toEqual({ name: '秘银长剑', type: 'buff', amount: 6 }); // 2×白银3
    }
  });
  it('召唤 → 登场直击 + 助战 buff', () => {
    const plan = cardPlayPlan(
      卡({ name: '远古巨兽', cardTier: '鎏金', 词条: ['召唤', '土'] }),
      stats,
    );
    expect(plan.mode).toBe('在场');
    if (plan.mode === '在场') {
      expect(plan.action.power).toBe(44 + 2 * 4); // 鎏金4，土防系不计直击加成? 直击 = 攻 + 2×卡力
      expect(plan.effect).toEqual({ name: '远古巨兽', type: 'buff', amount: 8 });
    }
  });
  it('素材 → 禁打', () => {
    const plan = cardPlayPlan(卡({ name: '巨兽骨', cardTier: '白铁', 词条: ['素材'] }), stats);
    expect(plan.mode).toBe('禁打');
  });
});

describe('IN_PLAY_KINDS（单一真源）', () => {
  it('在场生效类 = 装备/召唤/军团/领域/场景；技能物资直击、素材禁打', () => {
    expect([...IN_PLAY_KINDS].sort()).toEqual(['召唤', '场景', '装备', '军团', '领域'].sort());
  });
});

describe('sealedCardPlay —— 封印卡的交锋拍启封（积压 2026-09-14）', () => {
  const stats = { atk: 44 };
  const 封印卡 = (overrides: Record<string, unknown> = {}) =>
    ({
      name: '远古巨兽·岩爪',
      cardTier: '鎏金',
      词条: ['召唤', '土'],
      recipe: { fusionKind: '叠加' },
      ...overrides,
    }) as never;

  it('nat20 → 必启封：效果全额发动 + 破封账', () => {
    const r = sealedCardPlay(封印卡(), stats, 20, -5); // 鎏金 DC17，20-5=15 ≥ 17? 靠 nat20 必成
    expect(r.outcome.kind).toBe('启封');
    expect(r.effectFired).toBe(true);
    expect(r.sealBroke).toBe('远古巨兽·岩爪');
    expect(r.recoil).toBeUndefined();
    expect(r.prepend[0]).toContain('→ 启封');
    expect(r.activate?.name).toBe('远古巨兽·岩爪'); // 召唤 = 在场助战
  });

  it('哑火 → 本拍空过（行动值 0、无标签、不记已用、不破封）', () => {
    const r = sealedCardPlay(封印卡(), stats, 10, 0); // 10 vs 17 → margin -7 → 暴走！
    // 上面的骰值会落暴走——哑火用高意志托住：17-3=14 ≥ margin -3
    const r2 = sealedCardPlay(封印卡(), stats, 15, 0); // 15 vs 17 → -2 → 哑火
    expect(r2.outcome.kind).toBe('哑火');
    expect(r2.effectFired).toBe(false);
    expect(r2.sealBroke).toBeUndefined();
    expect(r2.recoil).toBeUndefined();
    expect(r2.action.power).toBe(0);
    expect(r2.action.tags).toEqual([]);
    expect(r2.action.cardName).toBeUndefined();
    void r;
  });

  it('暴走 → 效果发动 + 反冲 ⌈反噬/2⌉（鎏金 16 → 8）', () => {
    const r = sealedCardPlay(封印卡(), stats, 10, 0); // 10 vs 17 → margin -7 → 暴走
    expect(r.outcome.kind).toBe('暴走');
    expect(r.effectFired).toBe(true);
    expect(r.sealBroke).toBe('远古巨兽·岩爪');
    expect(r.recoil).toBe(8);
  });

  it('反噬 → 效果炸空 + 全额反冲（nat1 且 margin ≤ -8）', () => {
    const r = sealedCardPlay(封印卡({ cardTier: '星辉' }), stats, 1, -5); // 星辉 DC20：1-5-20 = -24 → 反噬
    expect(r.outcome.kind).toBe('反噬');
    expect(r.effectFired).toBe(false);
    expect(r.sealBroke).toBe('远古巨兽·岩爪');
    expect(r.recoil).toBe(20); // REBOUND 星辉 20 全额
    expect(r.action.power).toBe(0);
  });
});
