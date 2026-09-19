/**
 * talent-strength.test.ts — 规则层强度档（2026-09-17 参数化）
 *
 * 两条契约：
 * 1. **零回归**：条目未声明档位时，每个消费点的行为与硬编码时代逐位一致
 *    （基准值 = 当年的常量，且模块默认参数就是它）。
 * 2. **档位生效**：显式声明档位时，结果随档位变化 —— 这正是 SS 与 SSS 共用
 *    一条机制、强度不同的依据。
 */
import { describe, it, expect } from 'vitest';
import { ENTRY_STRENGTH_BASELINE, validateTalentEntries } from './talent-entry';
import { entryStrength } from './talent-rule-modifiers';
import type { TalentEntry, TalentEntryKind } from './talent-entry';
import {
  CONTRACT_AFFECTION_THRESHOLD,
  planAbyssContract,
  planContract,
  planMultiFusion,
  planSmelt,
} from './card-smelt';
import { planCaptureEnemy } from './companion-capture';
import { AFFECTION_DEVOTION, planAffectionTribute, planEnthrone } from './companion-growth';
import { playBeat, startSkirmish, FINAL_CHAPTER_BEAT, NUKE_PERCENT } from './skirmish-session';
import { applyCraftTalentBonus } from './craft-talent-bonus';
import type { CardItem } from '../types';

const 召唤 = (
  name: string,
  tier: CardItem['cardTier'],
  词条: string[] = ['土', '召唤'],
): CardItem => ({
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

/** 造一条天赋条目（只填被断言用到的字段） */
const 条目 = (kind: TalentEntryKind, params: TalentEntry['params'] = {}): TalentEntry => ({
  kind,
  channel: 'universal',
  params,
});

const 开战 = (enemyHp = 320) =>
  startSkirmish({
    enemyName: '岩爪兽',
    enemyLevel: 12,
    intents: [
      { move: '蓄力·崩山击', threat: 18, counters: ['打断', '防御'] },
      { move: '连环爪击', threat: 12, counters: ['闪避'] },
    ],
    playerHp: 155,
    playerMaxHp: 155,
    enemyHp,
    enemyMaxHp: enemyHp,
    guard: 10,
  });
/** 轻击（低行动值 + 低骰）：让敌方活够拍数，把「第几拍抹除」隔离出来测 */
const 轻击 = { label: '轻推', power: 1, tags: [] as const };

// ════════════════════════════════════════════════════════════════════
// 基准表本身
// ════════════════════════════════════════════════════════════════════

describe('ENTRY_STRENGTH_BASELINE —— 基准 = 参数化前的常量', () => {
  it('每条基准都等于改造前硬编码的那个数', () => {
    expect(ENTRY_STRENGTH_BASELINE.终章.beats).toBe(6);
    expect(ENTRY_STRENGTH_BASELINE.合同.backlash).toBe(8);
    expect(ENTRY_STRENGTH_BASELINE.捕获.levelBonus).toBe(1);
    expect(ENTRY_STRENGTH_BASELINE.熔炼.threshold).toBe(70);
    expect(ENTRY_STRENGTH_BASELINE.熔炼.tierGain).toBe(1);
    expect(ENTRY_STRENGTH_BASELINE.结缘.threshold).toBe(90);
    expect(ENTRY_STRENGTH_BASELINE.深渊契约.percent).toBe(40);
    expect(ENTRY_STRENGTH_BASELINE.位份.percent).toBe(10);
    expect(ENTRY_STRENGTH_BASELINE.融合.tierGain).toBe(1);
    expect(ENTRY_STRENGTH_BASELINE.越阶.tierGain).toBe(1);
    expect(ENTRY_STRENGTH_BASELINE.越阶.halveCost).toBe(1);
  });

  it('模块导出的常量就是基准（单一真源，不会各自漂移）', () => {
    expect(CONTRACT_AFFECTION_THRESHOLD).toBe(ENTRY_STRENGTH_BASELINE.熔炼.threshold);
    expect(AFFECTION_DEVOTION).toBe(ENTRY_STRENGTH_BASELINE.结缘.threshold);
    expect(FINAL_CHAPTER_BEAT).toBe(ENTRY_STRENGTH_BASELINE.终章.beats);
    expect(NUKE_PERCENT).toBe(50);
  });
});

// ════════════════════════════════════════════════════════════════════
// 取值口径
// ════════════════════════════════════════════════════════════════════

describe('entryStrength —— 声明优先，缺省回退基准', () => {
  it('无天赋 / 无该条目 → 基准', () => {
    expect(entryStrength(undefined, '终章', 'beats')).toBe(6);
    expect(entryStrength([], '捕获', 'levelBonus')).toBe(1);
    expect(entryStrength([{ entries: [条目('吞噬')] }], '终章', 'beats')).toBe(6);
  });

  it('条目声明了该数值 → 用声明的', () => {
    expect(entryStrength([{ entries: [条目('终章', { beats: 4 })] }], '终章', 'beats')).toBe(4);
    expect(
      entryStrength([{ entries: [条目('捕获', { levelBonus: 2 })] }], '捕获', 'levelBonus'),
    ).toBe(2);
  });

  it('同 kind 但没声明该字段 → 仍回退基准（不是 0）', () => {
    expect(entryStrength([{ entries: [条目('熔炼', { tierGain: 2 })] }], '熔炼', 'threshold')).toBe(
      70,
    );
  });

  it('多条同类 → 取第一条声明者（覆盖式，不累加）', () => {
    const list = [{ entries: [条目('终章', { beats: 4 }), 条目('终章', { beats: 5 })] }];
    expect(entryStrength(list, '终章', 'beats')).toBe(4);
  });
});

// ════════════════════════════════════════════════════════════════════
// 零回归：默认 = 硬编码时代的行为
// ════════════════════════════════════════════════════════════════════

describe('零回归 —— 不传档位就是老行为', () => {
  it('熔炼：默认跃升 1 档（= 传 1）', () => {
    const src = [召唤('岩爪', '青铜'), 召唤('风隼', '白铁')];
    const 默认 = planSmelt(src);
    const 显式一档 = planSmelt(src, 1);
    expect(默认.ok).toBe(true);
    expect(默认.plan!.product.cardTier).toBe('白银');
    expect(默认.plan).toEqual(显式一档.plan);
  });

  it('缔约：默认阈值 70（69 不够、70 够）', () => {
    const card = 召唤('岩爪', '白银');
    expect(planContract(card, 69).ok).toBe(false);
    expect(planContract(card, 70).ok).toBe(true);
    expect(planContract(card, 70)).toEqual(planContract(card, 70, 70));
  });

  it('捕获：默认只吃 +1 级（+1 可、+2 不可）', () => {
    expect(planCaptureEnemy('岩爪兽', 11, 10).ok).toBe(true);
    expect(planCaptureEnemy('岩爪兽', 12, 10).ok).toBe(false);
    expect(planCaptureEnemy('岩爪兽', 12, 10)).toEqual(
      planCaptureEnemy('岩爪兽', 12, 10, Math.random, 1),
    );
  });

  it('结缘：默认阈值 90', () => {
    const card = 召唤('岩爪', '白银');
    expect(planAffectionTribute(card, 89).ok).toBe(false);
    expect(planAffectionTribute(card, 90).ok).toBe(true);
  });

  it('深渊契约：默认文案 +40%', () => {
    const r = planAbyssContract(召唤('潮汐兽', '白银', ['水', '召唤']));
    expect(r.ok).toBe(true);
    expect(r.plan!.summary).toContain('+40%');
  });

  it('终章：默认第 6 拍发动（第 5 拍还不抹除）', () => {
    let s = 开战();
    for (let i = 0; i < 5; i++) s = playBeat(s, 轻击, 1, { finalChapter: true });
    expect(s.finished).toBeNull();
    expect(s.enemyHp).toBeGreaterThan(0);
    const last = playBeat(s, 轻击, 1, { finalChapter: true });
    expect(last.finished).toBe('胜利');
  });
});

// ════════════════════════════════════════════════════════════════════
// 档位生效：同一条机制，档位不同强度不同
// ════════════════════════════════════════════════════════════════════

describe('档位生效 —— 同机制不同强度', () => {
  it('熔炼 tierGain=2 → 跃升 2 档', () => {
    const src = [召唤('岩爪', '青铜'), 召唤('风隼', '白铁')];
    expect(planSmelt(src, 2).plan!.product.cardTier).toBe('鎏金');
  });

  it('缔约 threshold=50 → 好感 55 即可（默认 70 不够）', () => {
    const card = 召唤('岩爪', '白银');
    expect(planContract(card, 55).ok).toBe(false);
    expect(planContract(card, 55, 50).ok).toBe(true);
  });

  it('捕获 levelBonus=0 → 只能抓同级以下；levelBonus=2 → 可抓 +2 级', () => {
    expect(planCaptureEnemy('岩爪兽', 11, 10, Math.random, 0).ok).toBe(false);
    expect(planCaptureEnemy('岩爪兽', 11, 10, Math.random, 1).ok).toBe(true);
    expect(planCaptureEnemy('岩爪兽', 12, 10, Math.random, 2).ok).toBe(true);
  });

  it('结缘 threshold=70 → 好感 75 即可', () => {
    const card = 召唤('岩爪', '白银');
    expect(planAffectionTribute(card, 75).ok).toBe(false);
    expect(planAffectionTribute(card, 75, 70).ok).toBe(true);
  });

  it('深渊契约 percent=60 → 文案随档位走', () => {
    const r = planAbyssContract(召唤('潮汐兽', '白银', ['水', '召唤']), 60);
    expect(r.plan!.summary).toContain('+60%');
  });

  it('位份 percent=20 → 皇后按卡组 20% 计（默认 10%）', () => {
    const 后宫 = [召唤('甲', '白银'), 召唤('乙', '白银'), 召唤('丙', '白银')];
    const 低 = planEnthrone(召唤('后', '白银'), '皇后', 后宫);
    const 高 = planEnthrone(召唤('后', '白银'), '皇后', 后宫, 20);
    expect(高.plan!.bonus).toBeGreaterThan(低.plan!.bonus);
  });

  it('终章 beats=4 → 第 4 拍就抹除（默认要等到第 6 拍）', () => {
    let s = 开战();
    const opts = { finalChapter: true, finalChapterBeats: 4 } as const;
    for (let i = 0; i < 3; i++) s = playBeat(s, 轻击, 1, opts);
    expect(s.finished).toBeNull();
    const last = playBeat(s, 轻击, 1, opts);
    expect(last.finished).toBe('胜利');
  });

  it('倒也可斩 nukePercent=100 → 一击抹除（默认 50% 只打掉一半）', () => {
    const 半 = playBeat(开战(200), 轻击, 1, { nuke: true });
    expect(半.enemyHp).toBeGreaterThan(0);
    const 全 = playBeat(开战(200), 轻击, 1, { nuke: true, nukePercent: 100 });
    expect(全.enemyHp).toBe(0);
  });

  it('越阶的 halveCost 可分开关：盗火者只越阶、不减造价（卡牌造物主两样都有）', () => {
    const src = { ...召唤('产物', '青铜'), recipe: { ...召唤('产物', '青铜').recipe, cost: 100 } };
    const 造物主 = applyCraftTalentBonus(src, [], { tierGain: 1, halveCost: true });
    const 盗火者 = applyCraftTalentBonus(src, [], { tierGain: 1, halveCost: false });
    expect(造物主.card.cardTier).toBe('白银');
    expect(盗火者.card.cardTier).toBe('白银');
    expect(造物主.card.recipe.cost).toBe(50);
    expect(盗火者.card.recipe.cost).toBe(100);
  });

  it('融合 tierGain=2 → 三卡融合跃升 2 档', () => {
    const src = [召唤('甲', '青铜'), 召唤('乙', '青铜'), 召唤('丙', '白铁')];
    expect(planMultiFusion(src, () => 0, 1).plan!.product.cardTier).toBe('白银');
    expect(planMultiFusion(src, () => 0, 2).plan!.product.cardTier).toBe('鎏金');
  });
});

// ════════════════════════════════════════════════════════════════════
// AI 零编数：档位值必须命中白名单
// ════════════════════════════════════════════════════════════════════

describe('强度档也走档位白名单（AI 零编数）', () => {
  it('白名单内的档位过校验', () => {
    for (const [kind, params] of [
      ['终章', { beats: 4 }],
      ['合同', { backlash: 12 }],
      ['捕获', { levelBonus: 2 }],
      ['熔炼', { tierGain: 2, threshold: 90 }],
      ['结缘', { threshold: 70 }],
      ['深渊契约', { percent: 60 }],
      ['位份', { percent: 20 }],
      ['融合', { tierGain: 2 }],
      ['越阶', { tierGain: 2, halveCost: 0 }],
    ] as const) {
      expect(validateTalentEntries([条目(kind, params)]).ok, `${kind}`).toBe(true);
    }
  });

  it('编出的档位（不在白名单）一律拒绝', () => {
    expect(validateTalentEntries([条目('终章', { beats: 3 })]).ok).toBe(false);
    expect(validateTalentEntries([条目('终章', { beats: 99 })]).ok).toBe(false);
    expect(validateTalentEntries([条目('合同', { backlash: 20 })]).ok).toBe(false);
    expect(validateTalentEntries([条目('捕获', { levelBonus: 5 })]).ok).toBe(false);
    expect(validateTalentEntries([条目('熔炼', { threshold: 60 })]).ok).toBe(false);
    expect(validateTalentEntries([条目('深渊契约', { percent: 100 })]).ok).toBe(false);
    expect(validateTalentEntries([条目('位份', { percent: 50 })]).ok).toBe(false);
  });

  it('越阶的 halveCost 也走白名单：编个 2 出来要被拒', () => {
    expect(validateTalentEntries([条目('越阶', { halveCost: 2 })]).ok).toBe(false);
  });

  it('强度档是选填的：不写该字段合法（= 取基准），存量 SSS 条目不被参数化打掉', () => {
    // 卡牌造物主 / 律师函警告 / 第六终章 当年都是 params: {}
    for (const kind of [
      '越阶',
      '合同',
      '终章',
      '捕获',
      '熔炼',
      '结缘',
      '融合',
      '位份',
      '深渊契约',
    ] as const) {
      expect(validateTalentEntries([条目(kind)]).ok, kind).toBe(true);
    }
  });

  it('对照：真正的必填档位缺字段仍被拒（选填没有把门禁放开）', () => {
    expect(validateTalentEntries([条目('成功率加成')]).ok).toBe(false);
    expect(validateTalentEntries([条目('启封加值')]).ok).toBe(false);
    expect(validateTalentEntries([条目('威压')]).ok).toBe(false);
  });
});
