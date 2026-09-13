/**
 * skirmish.test.ts — 交锋拍制内核边界逐格覆盖（战斗形态改版）
 *
 * 判定必须可回放：同骰值同输入 → 同结果；本文件同时是拍结算公式与
 * 经验公式链的文档（参考截图锚点：TL12 vs PL9、S 级 → 312 EXP）。
 */
import { describe, it, expect } from 'vitest';
import type { EnemyIntent, SkirmishAction } from './skirmish';
import {
  MAX_BEATS,
  CRUSH_RATIO,
  GRADE_MULTIPLIER,
  CARD_EXP_CAP,
  CARD_EXP_SHARE,
  EXP_PER_ENEMY_LEVEL,
  LEVEL_MULT_MIN,
  LEVEL_MULT_MAX,
  COUNTER_TAGS,
  BASIC_COUNTERS,
  coerceIntents,
  counterBonusOf,
  resolveBeat,
  judgeCrush,
  gradeBattle,
  battleExpChain,
  formatExpAudit,
  cardExpGain,
  applyCardExp,
} from './skirmish';

/** 出卡反制的典型装配形状（集成层把词条标签和战力装进来；此处钉类型契约） */
const 出卡行动: SkirmishAction = { label: '打出 燎原符卡', power: 12, tags: ['打断'] };

describe('数值表（单一真源）', () => {
  it('拍数/碾压/分成/基础经验锚点', () => {
    expect(MAX_BEATS).toBe(3);
    expect(CRUSH_RATIO).toBe(2);
    expect(CARD_EXP_SHARE).toBe(0.5);
    expect(EXP_PER_ENEMY_LEVEL).toBe(10);
  });
  it('评价倍率：S ×2.0 / A ×1.5 / B ×1.0 / C ×0.5', () => {
    expect(GRADE_MULTIPLIER).toEqual({ S: 2.0, A: 1.5, B: 1.0, C: 0.5 });
  });
  it('卡牌经验上限随品质翻倍：200/400/800/1600/3200', () => {
    expect(CARD_EXP_CAP).toEqual({ 白铁: 200, 青铜: 400, 白银: 800, 鎏金: 1600, 星辉: 3200 });
  });
  it('反制标签白名单与基础应对三选项', () => {
    expect(COUNTER_TAGS).toEqual(['强攻', '防御', '闪避', '打断']);
    expect(BASIC_COUNTERS).toEqual(['强攻', '防御', '闪避']);
  });
  it('等级差修正夹逼区间（审计行渲染的真源）', () => {
    expect(LEVEL_MULT_MIN).toBe(0.2);
    expect(LEVEL_MULT_MAX).toBe(2);
  });
  it('出卡行动形状钉死：标签 + 行动值 + 反制标签', () => {
    expect(出卡行动.label).toContain('燎原符卡');
    expect(出卡行动.power).toBe(12);
    expect(出卡行动.tags).toEqual(['打断']);
  });
});

describe('coerceIntents —— AI 预提交数据不可信', () => {
  it('非数组输入 → 空序列，绝不抛', () => {
    expect(coerceIntents(null)).toEqual([]);
    expect(coerceIntents('蓄力')).toEqual([]);
    expect(coerceIntents({ threat: 18 })).toEqual([]);
  });
  it('合法意图透传；钩子保留', () => {
    const raw = [
      { move: '蓄力·崩山击', threat: 18, counters: ['打断', '防御'], hook: '岩爪兽后肢刨地' },
    ];
    expect(coerceIntents(raw)).toEqual([
      { move: '蓄力·崩山击', threat: 18, counters: ['打断', '防御'], hook: '岩爪兽后肢刨地' },
    ]);
  });
  it('威胁夹逼 1..99 取整；非法威胁兜底 1', () => {
    expect(coerceIntents([{ threat: 0 }])[0].threat).toBe(1);
    expect(coerceIntents([{ threat: 999 }])[0].threat).toBe(99);
    expect(coerceIntents([{ threat: 18.6 }])[0].threat).toBe(19);
    expect(coerceIntents([{ threat: '高' }])[0].threat).toBe(1);
  });
  it('反制标签过滤白名单并去重；滤空兜底 防御', () => {
    expect(coerceIntents([{ counters: ['打断', '打断', '火球'] }])[0].counters).toEqual(['打断']);
    expect(coerceIntents([{ counters: [] }])[0].counters).toEqual(['防御']);
    expect(coerceIntents([{ counters: '打断' }])[0].counters).toEqual(['防御']);
  });
  it('招式名非字符串 → 未知招式；钩子非字符串丢弃', () => {
    const got = coerceIntents([{ move: 42, counters: ['防御'], hook: 7 }])[0];
    expect(got.move).toBe('未知招式');
    expect(got.hook).toBeUndefined();
  });
  it('条数截到拍数上限（上限可传参放宽 Boss 战）', () => {
    const raw = [1, 2, 3, 4, 5].map((i) => ({ move: `招${i}`, threat: i, counters: ['防御'] }));
    expect(coerceIntents(raw)).toHaveLength(3);
    expect(coerceIntents(raw, 5)).toHaveLength(5);
  });
});

describe('counterBonusOf —— 读招打对的奖励', () => {
  const intent: EnemyIntent = { move: '蓄力', threat: 18, counters: ['打断', '防御'] };
  it('命中任一标签 → ⌈威胁/2⌉', () => {
    expect(counterBonusOf(intent, ['打断'])).toBe(9);
    expect(counterBonusOf(intent, ['强攻', '防御'])).toBe(9);
  });
  it('未命中 → 0', () => {
    expect(counterBonusOf(intent, ['闪避'])).toBe(0);
    expect(counterBonusOf(intent, [])).toBe(0);
  });
});

describe('resolveBeat —— 拍结算公式', () => {
  const intent: EnemyIntent = { move: '蓄力·崩山击', threat: 18, counters: ['打断', '防御'] };
  it('反制成功：碾压伤 = 行动值 + 余量，玩家无伤', () => {
    const got = resolveBeat({
      intent,
      action: { label: '打出 燎原符卡', power: 12, tags: ['打断'] },
      playerHp: 155,
      enemyHp: 320,
      guard: 5,
      dice: 17,
    });
    expect(got.countered).toBe(true);
    expect(got.counterBonus).toBe(9);
    expect(got.roll).toBe(38);
    expect(got.margin).toBe(20);
    expect(got.enemyDamage).toBe(32);
    expect(got.playerDamage).toBe(0);
    expect(got.enemyHp).toBe(288);
    expect(got.playerHp).toBe(155);
    expect(got.audit).toEqual([
      '▸ 打出 燎原符卡：d20=17 + 行动值12 + 克制+9 = 38 vs 威胁18 → 反制成功（余量20）',
      '▸ 敌方 HP 320 → 288（−32 = 行动值12 + 碾压余量20）',
      '▸ 玩家 HP 155 → 155（无伤）',
    ]);
  });
  it('反制失败：玩家吃 威胁−⌊防御/2⌋，敌方仍吃行动值', () => {
    const got = resolveBeat({
      intent,
      action: { label: '强攻', power: 12, tags: ['强攻'] },
      playerHp: 155,
      enemyHp: 320,
      guard: 10,
      dice: 3,
    });
    expect(got.countered).toBe(false);
    expect(got.counterBonus).toBe(0);
    expect(got.roll).toBe(15);
    expect(got.margin).toBe(-3);
    expect(got.playerDamage).toBe(13);
    expect(got.enemyDamage).toBe(12);
    expect(got.playerHp).toBe(142);
    expect(got.enemyHp).toBe(308);
    expect(got.audit[0]).toBe('▸ 强攻：d20=3 + 行动值12 + 克制+0 = 15 vs 威胁18 → 反制失败（差3）');
    expect(got.audit[1]).toBe('▸ 玩家 HP 155 → 142（−13 = 威胁18 − 防御减免5）');
    expect(got.audit[2]).toBe('▸ 敌方 HP 320 → 308（−12 = 行动值12）');
  });
  it('防御减免可以压过威胁，但玩家伤害下限 1', () => {
    const got = resolveBeat({
      intent,
      action: { label: '闪避', power: 1, tags: ['闪避'] },
      playerHp: 50,
      enemyHp: 10,
      guard: 200,
      dice: 1,
    });
    expect(got.playerDamage).toBe(1);
    expect(got.playerHp).toBe(49);
  });
  it('HP clamp 到 0，不出现负数', () => {
    const got = resolveBeat({
      intent,
      action: { label: '打出 燎原符卡', power: 99, tags: ['打断'] },
      playerHp: 5,
      enemyHp: 8,
      guard: 0,
      dice: 20,
    });
    expect(got.enemyHp).toBe(0);
    expect(got.playerHp).toBe(5);
  });
  it('骰值越界夹逼 1..20；脏数据不抛', () => {
    const base = {
      intent,
      action: { label: '防御', power: 5, tags: ['防御'] as const },
      playerHp: 100,
      enemyHp: 100,
      guard: 4,
    };
    expect(resolveBeat({ ...base, dice: 0 }).dice).toBe(1);
    expect(resolveBeat({ ...base, dice: 99 }).dice).toBe(20);
    expect(resolveBeat({ ...base, dice: NaN }).dice).toBe(1);
  });
  it('脏 HP 入参兜底 0，绝不产生 NaN', () => {
    const got = resolveBeat({
      intent: { move: 'x', threat: 10, counters: ['防御'] },
      action: { label: 'x', power: 5, tags: [] },
      playerHp: NaN,
      enemyHp: NaN,
      guard: NaN,
      dice: 10,
    });
    expect(got.playerHp).toBe(0);
    expect(got.enemyHp).toBe(0);
  });
});

describe('judgeCrush —— 数值碾压速胜', () => {
  it('我方 ≥ 敌方 ×2 → 速胜（边界含等号）', () => {
    expect(judgeCrush(20, 10)).toBe(true);
    expect(judgeCrush(19, 10)).toBe(false);
    expect(judgeCrush(0, 10)).toBe(false);
  });
  it('敌方战力 0 不得触发（防除零语义漏洞）', () => {
    expect(judgeCrush(100, 0)).toBe(false);
  });
});

describe('gradeBattle —— 终局评价', () => {
  it('撤退 = C，无条件', () => {
    expect(gradeBattle({ fled: true, totalBeats: 3, counteredBeats: 3, hpLossRatio: 0 })).toBe('C');
  });
  it('S = 全拍反制且 HP 损失 ≤25%', () => {
    expect(gradeBattle({ fled: false, totalBeats: 3, counteredBeats: 3, hpLossRatio: 0.25 })).toBe(
      'S',
    );
    expect(gradeBattle({ fled: false, totalBeats: 3, counteredBeats: 3, hpLossRatio: 0.26 })).toBe(
      'A',
    );
    expect(gradeBattle({ fled: false, totalBeats: 3, counteredBeats: 2, hpLossRatio: 0 })).toBe(
      'A',
    );
  });
  it('A = 胜利且 HP 损失 ≤50%；其余 B；零拍保底不除零', () => {
    expect(gradeBattle({ fled: false, totalBeats: 3, counteredBeats: 0, hpLossRatio: 0.5 })).toBe(
      'A',
    );
    expect(gradeBattle({ fled: false, totalBeats: 3, counteredBeats: 0, hpLossRatio: 0.51 })).toBe(
      'B',
    );
    expect(gradeBattle({ fled: false, totalBeats: 0, counteredBeats: 0, hpLossRatio: 0 })).toBe(
      'A',
    );
    expect(gradeBattle({ fled: false, totalBeats: 3, counteredBeats: 0, hpLossRatio: NaN })).toBe(
      'B',
    );
  });
});

describe('battleExpChain —— 参考截图公式链', () => {
  it('锚点回归：TL12 vs PL9、S 级 → 312 EXP', () => {
    const got = battleExpChain(12, 9, 'S');
    expect(got.base).toBe(120);
    expect(got.levelMult).toBeCloseTo(1.3);
    expect(got.gradeMult).toBe(2.0);
    expect(got.total).toBe(312);
  });
  it('等级差修正夹逼 0.2..2.0 两端', () => {
    expect(battleExpChain(1, 25, 'B').levelMult).toBe(0.2);
    expect(battleExpChain(40, 1, 'B').levelMult).toBe(2);
  });
  it('评价走表；脏等级兜底 1（修正被夹到 0.2）', () => {
    expect(battleExpChain(10, 10, 'C').total).toBe(50);
    expect(battleExpChain(NaN, 10, 'B').total).toBe(2);
  });
  it('审计行逐项可复算', () => {
    expect(formatExpAudit(battleExpChain(12, 9, 'S'))).toEqual([
      '▸ 基础经验 = 10 × 敌方等级12 = 120',
      '▸ 等级差修正 = max(0.2, min(2, 1+(12−9)×0.1)) = ×1.3',
      '▸ 战斗评价 S 级 → ×2',
      '▸ 战斗经验 = 312 EXP',
    ]);
  });
});

describe('cardExpGain / applyCardExp —— 卡牌经验 50% 分成', () => {
  it('分成 = round(总经验 × 0.5)；负数归零', () => {
    expect(cardExpGain(312)).toBe(156);
    expect(cardExpGain(5)).toBe(3);
    expect(cardExpGain(-1)).toBe(0);
  });
  it('满管 → 卡面战力 +1、余量进下一管（不丢经验）', () => {
    const got = applyCardExp({ cardTier: '白铁', cardExp: 190, cardPowerBonus: 0 }, 100);
    expect(got).toEqual({ cardExp: 40, cardPowerBonus: 1, powerUps: 1 });
  });
  it('一次巨量经验可连升多管', () => {
    const got = applyCardExp({ cardTier: '白铁' }, 1000);
    expect(got).toEqual({ cardExp: 100, cardPowerBonus: 2, powerUps: 2 });
  });
  it('旧存档缺字段 / 未知品质兜底，不抛（400 经验 50% 分成 = 200 恰满一管白铁）', () => {
    expect(applyCardExp({ cardTier: '白铁' }, 10)).toEqual({
      cardExp: 5,
      cardPowerBonus: 0,
      powerUps: 0,
    });
    expect(
      applyCardExp({ cardTier: '不存在' as never, cardExp: NaN, cardPowerBonus: -5 }, 400),
    ).toEqual({
      cardExp: 0,
      cardPowerBonus: 1,
      powerUps: 1,
    });
  });
});
