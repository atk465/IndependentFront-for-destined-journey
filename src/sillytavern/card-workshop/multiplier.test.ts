/**
 * multiplier.test.ts — 技能倍率纯函数叶单测（2026-09-30 v2 共识）
 * 格值锁：三套难度表 = values-table 终审稿第二/三节；卡面 value（标准表）= 批次 2 池重写基准。
 */
import { describe, expect, it } from 'vitest';

import {
  BASIC_ATTACK_PCT,
  DEFAULT_DIFFICULTY,
  INFECTION_STEP,
  NUMERIC_TABLES,
  SECONDARY_POOL,
  aggregateDamage,
  coerceDifficulty,
  coerceSecondaryAxes,
  effectClassOf,
  numericPctOf,
  resolveSkillAmount,
  secondarySlotsOf,
  theoreticalExtremeMultiplier,
} from './multiplier';

describe(`四分类（Q8'）`, () => {
  it('A 输出量：直击/dot/防御量/兑现类', () => {
    for (const a of [
      '伤害',
      '吸血',
      '治疗',
      '中毒',
      '灼烧',
      '护盾',
      '格挡',
      '任务',
      '契约·血誓',
      '赌一手',
    ] as const) {
      expect(effectClassOf(a)).toBe('输出量');
    }
  });
  it('B 百分数：重定基 11 条 + 承伤/斩杀线/气血%', () => {
    for (const a of [
      '连击',
      '双击',
      '风怒',
      '觉醒',
      '狂暴',
      '进化',
      '时间裂缝',
      '连锁风暴',
      '夺式',
      '功业',
      '分支',
      '易伤',
      '诅咒',
      '斩杀',
      '剧毒',
      '汲取',
    ] as const) {
      expect(effectClassOf(a)).toBe('百分数');
    }
  });
  it('C 削敌：威胁族定点（Q22 归并后含破防/穿透）', () => {
    for (const a of [
      '破防',
      '穿透',
      '虚弱',
      '迟缓',
      '冰冻',
      '退化',
      '恐惧',
      '束缚',
      '封印',
      '断章',
      '变异',
    ] as const) {
      expect(effectClassOf(a)).toBe('削敌');
    }
  });
  it('D 控制：0 值/资源/信息类；池外动作兜底控制', () => {
    for (const a of [
      '眩晕',
      '沉睡',
      '沉默',
      '魅惑',
      '圣盾',
      '免疫',
      '支配',
      '窥探',
      '洞悉',
      '时之锚',
      '死亡倒计时',
      '先攻',
      '驱散',
    ] as const) {
      expect(effectClassOf(a)).toBe('控制');
    }
    expect(effectClassOf('不存在的动作' as never)).toBe('控制');
  });
});

describe('三套难度表（values-table 第二节格值锁）', () => {
  it('主三格：伤害/吸血/治疗', () => {
    expect([NUMERIC_TABLES.爽战.伤害, NUMERIC_TABLES.标准.伤害, NUMERIC_TABLES.长战.伤害]).toEqual([
      150, 120, 100,
    ]);
    expect([NUMERIC_TABLES.爽战.吸血, NUMERIC_TABLES.标准.吸血, NUMERIC_TABLES.长战.吸血]).toEqual([
      120, 100, 80,
    ]);
    expect([NUMERIC_TABLES.爽战.治疗, NUMERIC_TABLES.标准.治疗, NUMERIC_TABLES.长战.治疗]).toEqual([
      180, 150, 120,
    ]);
  });
  it('dot 逐条（第三节格值锁，节奏差异保留）', () => {
    expect([NUMERIC_TABLES.标准.中毒, NUMERIC_TABLES.爽战.中毒, NUMERIC_TABLES.长战.中毒]).toEqual([
      40, 50, 30,
    ]);
    expect([NUMERIC_TABLES.标准.灼烧, NUMERIC_TABLES.爽战.灼烧, NUMERIC_TABLES.长战.灼烧]).toEqual([
      65, 80, 50,
    ]);
    expect([NUMERIC_TABLES.标准.流血, NUMERIC_TABLES.爽战.流血, NUMERIC_TABLES.长战.流血]).toEqual([
      35, 45, 30,
    ]);
    expect([NUMERIC_TABLES.标准.护盾, NUMERIC_TABLES.爽战.护盾, NUMERIC_TABLES.长战.护盾]).toEqual([
      25, 30, 20,
    ]);
  });
  it('兑现类治疗：任务/契约/赌一手', () => {
    expect([
      NUMERIC_TABLES.标准.任务,
      NUMERIC_TABLES.标准['契约·血誓'],
      NUMERIC_TABLES.标准.赌一手,
    ]).toEqual([120, 140, 150]);
    expect([NUMERIC_TABLES.爽战.任务, NUMERIC_TABLES.长战.任务]).toEqual([150, 100]);
  });
  it('基础强攻表与感染步长', () => {
    expect([BASIC_ATTACK_PCT.爽战, BASIC_ATTACK_PCT.标准, BASIC_ATTACK_PCT.长战]).toEqual([
      150, 120, 100,
    ]);
    expect([INFECTION_STEP.爽战, INFECTION_STEP.标准, INFECTION_STEP.长战]).toEqual([15, 10, 5]);
  });
  it('numericPctOf：B/C/D 类不进三表', () => {
    expect(numericPctOf('伤害', '标准')).toBe(120);
    expect(numericPctOf('连击', '标准')).toBeUndefined();
    expect(numericPctOf('破防', '标准')).toBeUndefined();
    expect(numericPctOf('眩晕', '标准')).toBeUndefined();
  });
});

describe('副轴门禁（Q4/Q6）', () => {
  const axes = { str: 12, dex: 10, con: 8, int: 16, spi: 10 };
  it('条数阶梯 0/1/1/2/2', () => {
    expect([
      secondarySlotsOf('黑铁'),
      secondarySlotsOf('青铜'),
      secondarySlotsOf('白银'),
      secondarySlotsOf('鎏金'),
      secondarySlotsOf('星辉'),
    ]).toEqual([0, 1, 1, 2, 2]);
  });
  it('黑铁 0 条：有副轴也整批丢弃', () => {
    expect(coerceSecondaryAxes([{ axis: 'dex', bonus: 40 }], 'str', '黑铁')).toEqual([]);
  });
  it('星辉 2 条合法；超量整批丢弃', () => {
    const two = [
      { axis: 'dex', bonus: 40 },
      { axis: 'spi', bonus: 20 },
    ];
    expect(coerceSecondaryAxes(two, 'str', '星辉')).toEqual(two);
    expect(coerceSecondaryAxes([...two, { axis: 'con', bonus: 60 }], 'str', '星辉')).toEqual([]);
  });
  it('副轴≠主轴、同轴不重复、bonus 必须在离散池', () => {
    expect(coerceSecondaryAxes([{ axis: 'str', bonus: 40 }], 'str', '星辉')).toEqual([]);
    expect(
      coerceSecondaryAxes(
        [
          { axis: 'dex', bonus: 40 },
          { axis: 'dex', bonus: 60 },
        ],
        'str',
        '星辉',
      ),
    ).toEqual([{ axis: 'dex', bonus: 40 }]);
    expect(coerceSecondaryAxes([{ axis: 'dex', bonus: 35 }], 'str', '星辉')).toEqual([]);
    expect(SECONDARY_POOL).toEqual([20, 40, 60, 100]);
  });
  it('脏数据兜底：非数组/缺属性 → 空集', () => {
    expect(coerceSecondaryAxes(null, 'str', '星辉')).toEqual([]);
    expect(coerceSecondaryAxes([null, 'dex'], 'str', '星辉')).toEqual([]);
    void axes;
  });
});

describe('技能公式（替换制结算基数）', () => {
  it('values-table 示例：力 120%×26=31 + 敏 40%×10=4 → 35', () => {
    const r = resolveSkillAmount({
      action: '伤害',
      difficulty: '标准',
      mainDerivation: 26,
      secondary: [{ bonus: 40, derivation: 10 }],
    });
    expect(r.mainAmount).toBe(31);
    expect(r.mainPct).toBe(120);
    expect(r.secondaryAmount).toBe(4);
    expect(r.amount).toBe(35);
  });
  it('黑铁无副轴：纯主项', () => {
    const r = resolveSkillAmount({
      action: '伤害',
      difficulty: '标准',
      mainDerivation: 26,
      secondary: [],
    });
    expect(r.amount).toBe(31);
  });
  it('难度换表：爽战 150% / 长战 100%', () => {
    expect(
      resolveSkillAmount({ action: '伤害', difficulty: '爽战', mainDerivation: 26, secondary: [] })
        .mainAmount,
    ).toBe(39);
    expect(
      resolveSkillAmount({ action: '伤害', difficulty: '长战', mainDerivation: 26, secondary: [] })
        .mainAmount,
    ).toBe(26);
  });
  it('脏派生兜底不抛（负值钳 0 语义交调用方；此处验 NaN 不产生 NaN）', () => {
    const r = resolveSkillAmount({
      action: '治疗',
      difficulty: '标准',
      mainDerivation: Number.NaN,
      secondary: [],
    });
    expect(Number.isFinite(r.amount)).toBe(true);
  });
});

describe(`乘区聚合器（Q13' 同层加算·跨层乘算）`, () => {
  it('values-table 示例：35 × 连击1.5 → floor 52', () => {
    const r = aggregateDamage(35, { powerBonusPct: 50, vulnerabilityPct: 0 });
    expect(r.total).toBe(52);
    expect(r.trace.join('')).toContain('×伤害+50%');
  });
  it('同层加算：连击50+狂暴50 = 一层 ×2，而非 ×1.5×1.5', () => {
    expect(aggregateDamage(100, { powerBonusPct: 100 }).total).toBe(200);
    expect(aggregateDamage(100, { powerBonusPct: 100 }).total).not.toBe(225);
  });
  it('跨层乘算：伤害层 × 承伤层独立', () => {
    // 100 × 2 × 1.25 = 250
    expect(aggregateDamage(100, { powerBonusPct: 100, vulnerabilityPct: 25 }).total).toBe(250);
  });
  it('护卫减免封顶 60%', () => {
    expect(aggregateDamage(100, { guardWingPct: 80 }).total).toBe(40);
    expect(aggregateDamage(100, { guardWingPct: 20 }).total).toBe(80);
  });
  it('懒惰 ×2 与暴击/好感独立乘算；碾压余量不在本函数（调用方追加）', () => {
    expect(aggregateDamage(10, { lazy: true, crit: 1.5, affection: 1.5 }).total).toBe(45);
  });
  it('脏 bundle 兜底：负值/NaN 按 0/1 处理', () => {
    expect(aggregateDamage(100, { powerBonusPct: -50, vulnerabilityPct: Number.NaN }).total).toBe(
      100,
    );
    expect(aggregateDamage(100, { crit: Number.NaN, affection: -1 }).total).toBe(100);
  });
  it('理论极值锚 ≈×44（values-table 第六节复算）', () => {
    const m = theoreticalExtremeMultiplier();
    expect(m).toBeGreaterThan(43);
    expect(m).toBeLessThan(45);
  });
});

describe(`难度档兜底（Q10'）`, () => {
  it('脏数据 → 标准表；合法值原样通过', () => {
    expect(coerceDifficulty(undefined)).toBe(DEFAULT_DIFFICULTY);
    expect(coerceDifficulty('碾压')).toBe('标准');
    expect(coerceDifficulty('爽战')).toBe('爽战');
    expect(coerceDifficulty('长战')).toBe('长战');
  });
});
