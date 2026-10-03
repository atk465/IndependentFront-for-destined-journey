/**
 * battle-dimensions.test.ts — 战斗维度扩展（2026-09-17 立项）
 *
 * 六个维度：暴击 / 卡的伤势 / 多敌 / 技能冷却 / 体型 / 负面状态。
 * 每个维度都是「引擎有这个量了」，天赋只是消费者。
 */
import { describe, it, expect } from 'vitest';
import { getTalentTemplate, hasWorkingMechanic, TALENT_CATALOG } from './talent-entry';
import {
  BODY_SCALES,
  HANGOVER_ACCURACY_PENALTY,
  HANGOVER_RAGE_MULT,
  NO_CRIT,
  activeCompanions,
  bodyScaleCrushBonus,
  companionEnters,
  companionsWear,
  coerceAffliction,
  coerceBodyScale,
  coerceEnemyCount,
  hangoverRage,
  afflictionActiveToday,
  isCriticalHealth,
  isFullHealth,
  isOnCooldown,
  massacreBuff,
  playerBodyScale,
  queenVersusMany,
  quickCastReduce,
  resolveCrit,
  startCooldown,
  tickCooldowns,
} from './battle-dimensions';

// ════════════════════════════════════════════════════════════════════
// 1. 暴击
// ════════════════════════════════════════════════════════════════════

describe('暴击', () => {
  it('骰值落在几率内 → 行动值按倍率放大', () => {
    const r = resolveCrit(40, { chance: 20, mult: 1.5 }, 15);
    expect(r.crit).toBe(true);
    expect(r.power).toBe(60);
    expect('note' in r && r.note).toContain('暴击');
  });

  it('骰值没中 → 原样', () => {
    expect(resolveCrit(40, { chance: 20, mult: 1.5 }, 50)).toEqual({ crit: false, power: 40 });
  });

  it('边界：骰值正好等于几率算暴击（≤）', () => {
    expect(resolveCrit(40, { chance: 20, mult: 1.5 }, 20).crit).toBe(true);
    expect(resolveCrit(40, { chance: 20, mult: 1.5 }, 21).crit).toBe(false);
  });

  it('无参数 = 零改动（永不出暴击）', () => {
    expect(resolveCrit(40, NO_CRIT, 1)).toEqual({ crit: false, power: 40 });
    expect(resolveCrit(40, NO_CRIT, 100)).toEqual({ crit: false, power: 40 });
  });

  it('脏骰值夹逼 1..100（不抛）', () => {
    expect(resolveCrit(40, { chance: 100, mult: 2 }, 0).crit).toBe(true);
    expect(resolveCrit(40, { chance: 1, mult: 2 }, 999).crit).toBe(false);
    expect(resolveCrit(40, { chance: 100, mult: 2 }, NaN).crit).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. 卡的伤势
// ════════════════════════════════════════════════════════════════════

describe('卡的伤势（会话级近似）', () => {
  it('进场 = 满状态', () => {
    expect(companionEnters(undefined, '岩爪')).toEqual({ 岩爪: 100 });
  });

  it('每拍按敌方 dot 掉伤势，下限 0', () => {
    let t = companionEnters(undefined, '岩爪');
    t = companionsWear(t, 30, ['岩爪']);
    expect(t['岩爪']).toBe(70);
    t = companionsWear(t, 200, ['岩爪']);
    expect(t['岩爪']).toBe(0);
  });

  it('dot 为 0 不磨损（不产生新键）', () => {
    const t = companionsWear(undefined, 0, ['岩爪']);
    expect(t).toEqual({});
  });

  it('满血 ≥ 90；重伤 ≤ 30', () => {
    const t = { 甲: 95, 乙: 25, 丙: 60 };
    expect(isFullHealth(t, '甲')).toBe(true);
    expect(isFullHealth(t, '丙')).toBe(false);
    expect(isCriticalHealth(t, '乙')).toBe(true);
    expect(isCriticalHealth(t, '丙')).toBe(false);
    // 没记录过的卡按满状态算（刚进场的伙伴）
    expect(isFullHealth(t, '新')).toBe(true);
    expect(isCriticalHealth(t, '新')).toBe(false);
  });

  it('在场伙伴名单 = buff 型效果', () => {
    expect(
      activeCompanions([
        { name: '岩爪', type: 'buff' },
        { name: '毒雾', type: 'dot' },
        { name: '风隼', type: 'buff' },
      ]),
    ).toEqual(['岩爪', '风隼']);
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. 多敌
// ════════════════════════════════════════════════════════════════════

describe('多敌', () => {
  it('数量夹逼 1..6（脏值按 1）', () => {
    expect(coerceEnemyCount(undefined)).toBe(1);
    expect(coerceEnemyCount(0)).toBe(1);
    expect(coerceEnemyCount(99)).toBe(6);
    expect(coerceEnemyCount(3)).toBe(3);
    expect(coerceEnemyCount(NaN)).toBe(1);
  });

  it('小人国的女王：复数 + 全部更低等级 → 越多越强', () => {
    expect(queenVersusMany({ enemyCount: 1, allLowerLevel: true })).toEqual({ percent: 0 });
    expect(queenVersusMany({ enemyCount: 3, allLowerLevel: false })).toEqual({ percent: 0 });
    const ok = queenVersusMany({ enemyCount: 3, allLowerLevel: true });
    expect(ok.percent).toBe(15);
    expect(queenVersusMany({ enemyCount: 6, allLowerLevel: true }).percent).toBe(30);
  });

  it('碾压快感：范围技 + 多敌 + 本拍有击杀 → 叠层', () => {
    expect(massacreBuff({ enemyCount: 4, killedThisBeat: true, ranged: true }).amount).toBe(12);
    expect(massacreBuff({ enemyCount: 4, killedThisBeat: false, ranged: true }).amount).toBe(0);
    expect(massacreBuff({ enemyCount: 4, killedThisBeat: true, ranged: false }).amount).toBe(0);
    expect(massacreBuff({ enemyCount: 1, killedThisBeat: true, ranged: true }).amount).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. 技能冷却
// ════════════════════════════════════════════════════════════════════

describe('技能冷却', () => {
  it('打出后进入冷却；beatCooldown=0 不记账', () => {
    expect(startCooldown(undefined, '火球', 3)).toEqual({ 火球: 3 });
    expect(startCooldown(undefined, '火球', 0)).toEqual({});
  });

  it('每拍递减，归零移除', () => {
    let t = startCooldown(undefined, '火球', 2);
    t = tickCooldowns(t);
    expect(t).toEqual({ 火球: 1 });
    expect(isOnCooldown(t, '火球')).toBe(true);
    t = tickCooldowns(t);
    expect(t).toEqual({});
    expect(isOnCooldown(t, '火球')).toBe(false);
  });

  it('多卡互不影响；不 mutate', () => {
    const src = { 甲: 2 };
    const t = startCooldown(src, '乙', 3);
    expect(src).toEqual({ 甲: 2 });
    const t2 = tickCooldowns(t);
    expect(t2).toEqual({ 甲: 1, 乙: 2 });
  });

  it('快速咏唱：冷却与 MP 各减半（冷却向下取整、MP 向上）', () => {
    expect(quickCastReduce(5, 7)).toEqual({ cd: 2, mp: 4 });
    expect(quickCastReduce(0, 0)).toEqual({ cd: 0, mp: 0 });
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. 体型
// ════════════════════════════════════════════════════════════════════

describe('体型', () => {
  it('五档齐全，玩家体型按等级派生', () => {
    expect(BODY_SCALES).toEqual(['小巧', '娇小', '常人', '巨躯', '巨像']);
    expect(playerBodyScale(1)).toBe('常人');
    expect(playerBodyScale(12)).toBe('巨躯');
    expect(playerBodyScale(20)).toBe('巨像');
  });

  it('敌方体型未知按常人（不炸）', () => {
    expect(coerceBodyScale('巨像')).toBe('巨像');
    expect(coerceBodyScale('莫名其妙')).toBe('常人');
    expect(coerceBodyScale(undefined)).toBe('常人');
  });

  it('体格差压制：差距 ≥ 2 才给（「远小于」）', () => {
    expect(bodyScaleCrushBonus('巨像', '常人', 20).percent).toBe(20);
    expect(bodyScaleCrushBonus('巨躯', '小巧', 20).percent).toBe(20);
    expect(bodyScaleCrushBonus('巨躯', '常人', 20).percent).toBe(0); // 差 1
    expect(bodyScaleCrushBonus('常人', '巨像', 20).percent).toBe(0); // 反向不算
    expect(bodyScaleCrushBonus('巨像', '小巧', 0).percent).toBe(0); // 量 0
  });
});

// ════════════════════════════════════════════════════════════════════
// 6. 负面状态
// ════════════════════════════════════════════════════════════════════

describe('负面状态（玩家侧标记）', () => {
  it('宽读：缺 day 的不算标记', () => {
    expect(coerceAffliction(undefined)).toBeUndefined();
    expect(coerceAffliction({ name: '中毒' })).toBeUndefined();
    expect(coerceAffliction({ day: 7 })).toEqual({ name: '负面状态', day: 7 });
    expect(coerceAffliction({ name: '醉酒', day: 7 })).toEqual({ name: '醉酒', day: 7 });
  });

  it('当天有效，隔夜作废（与嘲讽标记同款）', () => {
    const mark = { name: '醉酒', day: 7 };
    expect(afflictionActiveToday(mark, 7)).toBe(true);
    expect(afflictionActiveToday(mark, 8)).toBe(false);
  });

  it('宿醉狂暴：攻击 ×1.5 ×0.9（命中惩罚）；未处于负面 → 原样', () => {
    const mark = { name: '醉酒', day: 7 };
    const r = hangoverRage(mark, 7, 100);
    expect(r.power).toBe(Math.round(100 * HANGOVER_RAGE_MULT * HANGOVER_ACCURACY_PENALTY));
    expect(r.note).toContain('宿醉狂暴');
    expect(hangoverRage(mark, 8, 100)).toEqual({ power: 100 });
    expect(hangoverRage(undefined, 7, 100)).toEqual({ power: 100 });
  });
});

// ════════════════════════════════════════════════════════════════════
// 天赋侧接线
// ════════════════════════════════════════════════════════════════════

describe('战斗维度 —— 天赋接线', () => {
  it('荒野镖客：条件加成 + 暴击（描述里的「暴击率+15%」终于有数值面）', () => {
    const tpl = getTalentTemplate('荒野镖客');
    expect(tpl!.entries.map((e) => e.kind)).toEqual(['条件加成', '暴击']);
    expect(tpl!.entries[1].params).toEqual({ chance: 15, critPower: 2 });
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('战场直觉：暴击 20%', () => {
    const tpl = getTalentTemplate('战场直觉');
    expect(tpl!.entries).toEqual([
      { kind: '暴击', channel: 'universal', params: { chance: 20, critPower: 2 } },
    ]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('虐待狂化：嗜血（伤势 ≤30% → 攻击 +50%）', () => {
    const tpl = getTalentTemplate('虐待狂化');
    expect(tpl!.entries).toEqual([
      { kind: '嗜血', channel: 'universal', params: { hurtPct: 30, boostPct: 50 } },
    ]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('处刑者：处决（伤势 ≤15% → 震慑伤 10）', () => {
    const tpl = getTalentTemplate('处刑者');
    expect(tpl!.entries).toEqual([
      { kind: '处决', channel: 'universal', params: { hurtPct: 15, shockPower: 10 } },
    ]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('小人国的女王：群威（多敌维度落地）', () => {
    const tpl = getTalentTemplate('小人国的女王');
    expect(tpl!.entries).toEqual([
      { kind: '群威', channel: 'universal', params: { threshold: 2, percent: 15, perExtra: 5 } },
    ]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('快速咏唱：快咏（冷却与 MP 减半）', () => {
    const tpl = getTalentTemplate('快速咏唱');
    expect(tpl!.entries).toEqual([{ kind: '快咏', channel: 'universal', params: { percent: 50 } }]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('体格差压制：体型压制（差距 ≥2 → +30%）', () => {
    const tpl = getTalentTemplate('体格差压制');
    expect(tpl!.entries).toEqual([
      { kind: '体型压制', channel: 'universal', params: { crushPct: 30 } },
    ]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('宿醉狂暴：狂化（负面状态 → 攻击 ×2）', () => {
    const tpl = getTalentTemplate('宿醉狂暴');
    expect(tpl!.entries).toEqual([{ kind: '狂化', channel: 'universal', params: { rageMult: 2 } }]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('8 个新条目种类全部进 IMPLEMENTED 表', () => {
    for (const kind of [
      '暴击',
      '嗜血',
      '处决',
      '群威',
      '快咏',
      '体型压制',
      '狂化',
      '独行',
    ] as const) {
      const hits = TALENT_CATALOG.filter((t) => t.entries.some((e) => e.kind === kind));
      expect(hits.length, kind).toBeGreaterThan(0);
      for (const t of hits) {
        expect(hasWorkingMechanic(t), `${kind}/${t.name}`).toBe(true);
      }
    }
  });
});
