/**
 * s-batch6.test.ts — 条件经验 / 炼金 / 真名 / 模块化（2026-09-17）
 *
 * 四条新管道：
 * 1. **条件经验**：宿敌（与宿敌战斗经验翻倍、胜之夺气运）与打脸（被嘲讽后打赢）
 * 2. **伙伴+素材炼金**（足之炼金术）
 * 3. **主动精神冲击**（真名看破系统）
 * 4. **载具部件热插拔**（模块化天才）
 */
import { describe, it, expect } from 'vitest';
import {
  FACE_SLAP_KEY,
  canRedeemFaceSlap,
  coerceNemesis,
  coerceTaunt,
  isNemesisBattle,
  nemesisExpMultiplier,
  settleFaceSlap,
  shouldMarkNemesis,
  tauntActiveToday,
} from './conditional-exp';
import { ALCHEMY_FORMS, alchemyFormOf, planFootAlchemy } from './partner-alchemy';
import { coerceTrueNames, hasTrueName, rememberTrueName, trueNameShockPower } from './true-name';
import { MODULAR_ENTRY, isModularCard, resolveHotSwap } from './battle-rules';
import { getTalentTemplate, hasWorkingMechanic, TALENT_CATALOG } from './talent-entry';
import type { CardItem } from '../types';
import type { Rarity } from '../field-enums';

const 卡 = (name: string, 词条: string[], tier: CardItem['cardTier'] = '白银'): CardItem => ({
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
    cost: 0,
    rating: '成功',
  },
});

// ════════════════════════════════════════════════════════════════════
// 1. 条件经验：宿敌
// ════════════════════════════════════════════════════════════════════

describe('宿敌认证系统', () => {
  it('宽读：脏值一律当没有宿敌', () => {
    for (const raw of [undefined, null, 'x', [], {}, { name: '' }, { name: '  ' }]) {
      expect(coerceNemesis(raw)).toBeUndefined();
    }
    expect(coerceNemesis({ name: '黑枪手', level: 14, since: 3 })).toEqual({
      name: '黑枪手',
      level: 14,
      since: 3,
    });
  });

  it('结仇口径：**败给更强的敌人**才算（赢家不会被当宿敌）', () => {
    expect(shouldMarkNemesis({ finished: '败北', enemyLevel: 15, playerLevel: 10 })).toBe(true);
    expect(shouldMarkNemesis({ finished: '败北', enemyLevel: 10, playerLevel: 10 })).toBe(false);
    expect(shouldMarkNemesis({ finished: '胜利', enemyLevel: 15, playerLevel: 10 })).toBe(false);
    expect(shouldMarkNemesis({ finished: null, enemyLevel: 15, playerLevel: 10 })).toBe(false);
  });

  it('只在与宿敌的战斗里翻倍', () => {
    const n = { name: '黑枪手', level: 14 };
    expect(isNemesisBattle(n, '黑枪手')).toBe(true);
    expect(isNemesisBattle(n, '路边的狗')).toBe(false);
  });

  it('经验倍率：持天赋 + 对上宿敌 → ×2 并给审计行', () => {
    const n = { name: '黑枪手', level: 14 };
    const hit = nemesisExpMultiplier({
      holdsTalent: true,
      nemesis: n,
      enemyName: '黑枪手',
      expMult: 2,
    });
    expect(hit.mult).toBe(2);
    expect(hit.note).toContain('宿敌认证');
  });

  it('零改动：不持天赋 / 不是宿敌 → ×1 且无文案', () => {
    const n = { name: '黑枪手', level: 14 };
    expect(
      nemesisExpMultiplier({ holdsTalent: false, nemesis: n, enemyName: '黑枪手', expMult: 2 }),
    ).toEqual({ mult: 1 });
    expect(
      nemesisExpMultiplier({ holdsTalent: true, nemesis: n, enemyName: '别人', expMult: 2 }),
    ).toEqual({ mult: 1 });
    expect(
      nemesisExpMultiplier({
        holdsTalent: true,
        nemesis: undefined,
        enemyName: '黑枪手',
        expMult: 2,
      }),
    ).toEqual({ mult: 1 });
  });

  it('模板带「宿敌」条目，且算已实装', () => {
    const tpl = getTalentTemplate('宿敌认证系统');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries).toEqual([{ kind: '宿敌', channel: 'universal', params: { expMult: 2 } }]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });
});

describe('打脸升级系统', () => {
  const mark = { by: '某个贵族', day: 7 };

  it('宽读嘲讽标记：缺 day 的不算标记', () => {
    expect(coerceTaunt(undefined)).toBeUndefined();
    expect(coerceTaunt({ by: '某人' })).toBeUndefined();
    expect(coerceTaunt({ day: 7 })).toEqual({ by: '有人', day: 7 });
  });

  it('标记**当天**有效，隔夜作废', () => {
    expect(tauntActiveToday(mark, 7)).toBe(true);
    expect(tauntActiveToday(mark, 8)).toBe(false);
    expect(tauntActiveToday(undefined, 7)).toBe(false);
  });

  it('兑现条件：标记当天 + 打赢', () => {
    const ok = settleFaceSlap({
      holdsTalent: true,
      mark,
      today: 7,
      finished: '胜利',
      expBonus: 100,
      pointsPerWin: 1,
    });
    expect(ok.expBonus).toBe(100);
    expect(ok.points).toBe(1);
    expect(ok.note).toContain('打脸');
  });

  it('没打赢 / 标记过期 / 不持天赋 → 一律不给', () => {
    const base = {
      holdsTalent: true,
      mark,
      today: 7,
      finished: '胜利',
      expBonus: 100,
      pointsPerWin: 1,
    };
    expect(settleFaceSlap({ ...base, finished: '败北' }).points).toBe(0);
    expect(settleFaceSlap({ ...base, finished: '撤退' }).points).toBe(0);
    expect(settleFaceSlap({ ...base, today: 8 }).points).toBe(0);
    expect(settleFaceSlap({ ...base, holdsTalent: false }).points).toBe(0);
    // 碾压也算打赢
    expect(settleFaceSlap({ ...base, finished: '碾压' }).points).toBe(1);
  });

  it('点数够才可兑换', () => {
    expect(canRedeemFaceSlap(10, 10)).toBe(true);
    expect(canRedeemFaceSlap(9, 10)).toBe(false);
    expect(canRedeemFaceSlap(0, 10)).toBe(false);
  });

  it('点数 key 与烙印/厄运同住一张 counters 表', () => {
    expect(FACE_SLAP_KEY).toBe('打脸点数');
  });

  it('模板带「打脸」条目，且算已实装', () => {
    const tpl = getTalentTemplate('打脸升级系统');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries[0].kind).toBe('打脸');
    expect(tpl!.entries[0].params.pointsPerWin).toBe(1);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. 足之炼金术
// ════════════════════════════════════════════════════════════════════

describe('足之炼金术 —— 伙伴踩踏素材', () => {
  const 伙伴 = 卡('岩爪', ['召唤', '土'], '白银');
  const 素材 = (name: string, rarity: Rarity = '优良') => ({
    name,
    type: '材料' as const,
    rarity,
  });

  it('素材类别决定产物形态（描述里那两个例子）', () => {
    expect(alchemyFormOf('赤铁矿').form).toBe('金属锭');
    expect(alchemyFormOf('止血草').form).toBe('药剂');
  });

  it('认不出的素材走通用形态（不猜但也不空手）', () => {
    expect(alchemyFormOf('莫名其妙的东西').form).toBe('炼物');
  });

  it('类别表是一行数据，且每类都带词条', () => {
    expect(ALCHEMY_FORMS.length).toBeGreaterThan(0);
    for (const row of ALCHEMY_FORMS) {
      expect(row.match.length).toBeGreaterThan(0);
      expect(row.词条.length).toBeGreaterThan(0);
    }
  });

  it('产物是道具卡（物资形态词条），档位取伙伴与素材里较高的那个', () => {
    const r = planFootAlchemy(伙伴, 素材('赤铁矿', '稀有'));
    expect(r.ok).toBe(true);
    expect(r.plan!.product.词条).toContain('物资');
    expect(r.plan!.product.cardTier).toBe('白银'); // 伙伴白银 vs 素材稀有(白银) → 白银
  });

  it('档位按 maxTier 夹逼', () => {
    const 星辉伙伴 = 卡('巨兽', ['召唤', '土'], '星辉');
    const r = planFootAlchemy(星辉伙伴, 素材('星辰铁', '传说'), 1);
    expect(r.plan!.product.cardTier).toBe('青铜'); // 封到 1
  });

  it('只吃素材——卡牌/装备踩不动', () => {
    expect(planFootAlchemy(伙伴, { name: '某剑', type: '装备', rarity: '普通' }).ok).toBe(false);
    expect(planFootAlchemy(伙伴, 卡('别的卡', ['技能'])).ok).toBe(false);
  });

  it('素材被消耗、伙伴不消耗（计划里只列素材）', () => {
    const r = planFootAlchemy(伙伴, 素材('赤铁矿'));
    expect(r.plan!.consumedMaterial).toBe('赤铁矿');
    expect(r.plan!.partner).toBe('岩爪');
    expect(r.plan!.summary).toContain('岩爪');
  });

  it('模板带「炼金」条目，且算已实装', () => {
    const tpl = getTalentTemplate('足之炼金术');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries[0].kind).toBe('炼金');
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. 真名看破
// ════════════════════════════════════════════════════════════════════

describe('真名看破系统 —— 精神冲击', () => {
  it('真名表：去重、去空、脏值丢弃', () => {
    expect(coerceTrueNames(['甲', '甲', '', '  ', 1, null, '乙'])).toEqual(['甲', '乙']);
    expect(coerceTrueNames('x')).toEqual([]);
    expect(hasTrueName(['甲'], '甲')).toBe(true);
    expect(hasTrueName(['甲'], '乙')).toBe(false);
  });

  it('记住真名：不重复、不 mutate', () => {
    const src = ['甲'];
    const next = rememberTrueName(src, '乙');
    expect(next).toEqual(['甲', '乙']);
    expect(src).toEqual(['甲']);
    expect(rememberTrueName(next, '甲')).toEqual(['甲', '乙']);
  });

  it('威力 = 基础 + 每级 × 玩家等级（**不走敌方 HP 百分比**）', () => {
    const s = trueNameShockPower({
      base: 20,
      perLevel: 2,
      playerLevel: 12,
      alreadyKnown: false,
    });
    expect(s.power).toBe(44);
    expect(s.note).toContain('精神冲击');
  });

  it('认过的名字威力加成（「洞悉真名」的兑现）', () => {
    const fresh = trueNameShockPower({
      base: 20,
      perLevel: 2,
      playerLevel: 10,
      alreadyKnown: false,
    });
    const known = trueNameShockPower({
      base: 20,
      perLevel: 2,
      playerLevel: 10,
      alreadyKnown: true,
    });
    expect(known.power).toBeGreaterThan(fresh.power);
    expect(known.note).toContain('早就认下');
  });

  it('脏等级兜底成 1，不抛', () => {
    const s = trueNameShockPower({ base: 20, perLevel: 2, playerLevel: NaN, alreadyKnown: false });
    expect(s.power).toBe(22);
  });

  it('模板带「真名」条目，且算已实装', () => {
    const tpl = getTalentTemplate('真名看破系统');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries[0].kind).toBe('真名');
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. 模块化天才
// ════════════════════════════════════════════════════════════════════

describe('模块化天才 —— 部件热插拔', () => {
  const 载具 = 卡('铁马', ['装备', '金', MODULAR_ENTRY]);
  const 普通装备 = 卡('长剑', ['装备', '金']);

  it('只认带印记的卡', () => {
    expect(isModularCard(载具)).toBe(true);
    expect(isModularCard(普通装备)).toBe(false);
  });

  it('热插拔 = 在场形态对调（助战 ↔ 灼烧）', () => {
    const r = resolveHotSwap({
      card: 载具,
      current: { name: '铁马', type: 'buff', amount: 6 },
      used: 0,
      maxSwaps: 1,
    });
    expect(r.ok).toBe(true);
    expect(r.switched).toEqual({ name: '铁马', type: 'dot', amount: 6 });
    expect(r.note).toContain('模块化');
  });

  it('dot 也能换回 buff', () => {
    const r = resolveHotSwap({
      card: 载具,
      current: { name: '铁马', type: 'dot', amount: 4 },
      used: 0,
      maxSwaps: 1,
    });
    expect(r.switched!.type).toBe('buff');
  });

  it('不是模块化载具 → 换不了；没上过场 → 没有可插拔的模块', () => {
    expect(
      resolveHotSwap({
        card: 普通装备,
        current: { name: '长剑', type: 'buff', amount: 3 },
        used: 0,
        maxSwaps: 1,
      }).ok,
    ).toBe(false);
    expect(resolveHotSwap({ card: 载具, current: undefined, used: 0, maxSwaps: 1 }).ok).toBe(false);
  });

  it('每场次数用尽就停', () => {
    const r = resolveHotSwap({
      card: 载具,
      current: { name: '铁马', type: 'buff', amount: 6 },
      used: 1,
      maxSwaps: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('次数用尽');
  });

  it('模板带「模块化」条目，且算已实装', () => {
    const tpl = getTalentTemplate('模块化天才');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries).toEqual([
      { kind: '模块化', channel: 'universal', params: { slots: 2, swaps: 1 } },
    ]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 体质检查
// ════════════════════════════════════════════════════════════════════

describe('本批之后 —— 五条 S 都离开了「仅叙事」', () => {
  it('宿敌认证系统 / 打脸升级系统 / 足之炼金术 / 真名看破系统 / 模块化天才', () => {
    for (const name of [
      '宿敌认证系统',
      '打脸升级系统',
      '足之炼金术',
      '真名看破系统',
      '模块化天才',
    ]) {
      const tpl = TALENT_CATALOG.find((t) => t.name === name);
      expect(tpl, name).toBeDefined();
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });

  it('三条条件资源（烙印/厄运/打脸点数）同住一张 counters 表', () => {
    // 这条只是把「一套原语服务多条天赋」的事实钉住
    expect(FACE_SLAP_KEY).not.toBe('厄运');
    expect(FACE_SLAP_KEY).not.toBe('败犬烙印');
  });
});
