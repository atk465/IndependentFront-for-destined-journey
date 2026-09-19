/**
 * s-batch3.test.ts — 新管道首批（2026-09-17）
 *
 * 三组：
 * 1. **抽奖内核**：素材十连（保底 + 十连 + 突变面）
 * 2. **免死 / 复活**：绞刑架幸存者（战中锁血）与再生（战后复生）——两条分工不同
 * 3. **自身战斗状态**：蛇符咒（隐身 → 削敌威胁）与贝蒙斯坦（吸魔 → 每拍回血）
 */
import { describe, it, expect } from 'vitest';
import { MUTATION_CHANCE, floorRarityForLevel, planMaterialGacha } from './material-gacha';
import {
  SELF_STATUS_TABLE,
  initialSelfEffects,
  selfStatusesOf,
  totalSelfStatus,
} from './self-status';
import { playBeat, startSkirmish } from './skirmish-session';
import { TIER_TO_RARITY } from './card-dismantle';
import { RARITY_LEVELS } from '../field-enums';
import { getTalentTemplate, hasWorkingMechanic, TALENT_CATALOG } from './talent-entry';

// ════════════════════════════════════════════════════════════════════
// 1. 抽奖内核
// ════════════════════════════════════════════════════════════════════

describe('planMaterialGacha —— 十连 + 保底 + 突变', () => {
  /** 骰值固定：rng 永远返回 0.5（稀有度落在中段、不突变） */
  const 平 = () => 0.5;

  it('抽满 times 发', () => {
    const r = planMaterialGacha(10, '优良', 平);
    expect(r.rolls).toHaveLength(10);
    expect(r.summary).toContain('10 连');
  });

  it('times 夹逼（脏值不抛）', () => {
    expect(planMaterialGacha(0, '普通', 平).rolls).toHaveLength(1);
    expect(planMaterialGacha(NaN, '普通', 平).rolls).toHaveLength(1);
    expect(planMaterialGacha(999, '普通', 平).rolls).toHaveLength(50);
  });

  it('保底：整批没人达到 floor → 把最差的一发抬上来', () => {
    // rng 恒 0 → 每发都滚到最低档（普通），保底必须补齐
    const r = planMaterialGacha(10, '史诗', () => 0);
    expect(r.floorFilled).toBe(true);
    expect(r.rolls.filter((x) => x.rarity === '史诗').length).toBeGreaterThanOrEqual(1);
    expect(r.summary).toContain('保底补齐至 史诗');
  });

  it('保底不白吃：本来就有 ≥floor 的就不动它', () => {
    // 地板 = 普通，而所有骰值都落在普通 → 已经达标，不该再补
    const 全普通 = planMaterialGacha(10, '普通', () => 0);
    expect(全普通.floorFilled).toBe(false);

    // 第一发的稀有度骰刻意拉满（rng 调用序是 [突变判定, 稀有度] 成对出现）
    let n = 0;
    const 首发拉满 = () => {
      n++;
      return n === 2 ? 0.999 : 0;
    };
    const r = planMaterialGacha(10, '稀有', 首发拉满);
    expect(RARITY_LEVELS.indexOf(r.highest)).toBeGreaterThanOrEqual(RARITY_LEVELS.indexOf('稀有'));
    expect(r.floorFilled).toBe(false);
  });

  it('突变：概率极低，但真出时会带一条突变词条', () => {
    expect(MUTATION_CHANCE).toBeLessThan(0.1);
    // rng 恒 0 → 每发都判成突变（0 < MUTATION_CHANCE）
    const all = planMaterialGacha(10, '普通', () => 0);
    expect(all.mutatedCount).toBe(10);
    expect(all.rolls.every((x) => !!x.mutationEntry)).toBe(true);
    // rng 恒 0.5 → 不突变
    expect(planMaterialGacha(10, '普通', 平).mutatedCount).toBe(0);
  });

  it('最低/最高稀有度写得对（面板一行摘要用）', () => {
    const r = planMaterialGacha(10, '传说', () => 0);
    expect(RARITY_LEVELS.indexOf(r.highest)).toBeGreaterThanOrEqual(RARITY_LEVELS.indexOf('传说'));
  });
});

describe('floorRarityForLevel —— 保底按等级换算', () => {
  it('走既有的「等级 → 卡档 → 稀有度」这条链，不另起口径', () => {
    // tierForLevel 的分界：≤4 白铁 / ≤8 青铜 / ≤12 白银 / ≤16 鎏金 / 否则星辉
    expect(floorRarityForLevel(1)).toBe(TIER_TO_RARITY['白铁']);
    expect(floorRarityForLevel(5)).toBe(TIER_TO_RARITY['青铜']);
    expect(floorRarityForLevel(9)).toBe(TIER_TO_RARITY['白银']);
    expect(floorRarityForLevel(13)).toBe(TIER_TO_RARITY['鎏金']);
    expect(floorRarityForLevel(17)).toBe(TIER_TO_RARITY['星辉']);
  });

  it('等级越高保底越好（单调不降）', () => {
    let prev = -1;
    for (const lv of [1, 5, 9, 13, 17, 30]) {
      const rank = RARITY_LEVELS.indexOf(floorRarityForLevel(lv));
      expect(rank).toBeGreaterThanOrEqual(prev);
      prev = rank;
    }
  });

  it('脏值兜底成 1 级', () => {
    expect(floorRarityForLevel(NaN)).toBe(floorRarityForLevel(1));
    expect(floorRarityForLevel(-5)).toBe(floorRarityForLevel(1));
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. 免死 / 复活
// ════════════════════════════════════════════════════════════════════

/** 敌方威胁极高、玩家行动值极低 → 必定反制失败并被打到 0 */
const 必死局 = () =>
  startSkirmish({
    enemyName: '绞刑者',
    enemyLevel: 20,
    intents: [{ move: '绞杀', threat: 99, counters: ['防御'] }],
    playerHp: 5,
    playerMaxHp: 100,
    enemyHp: 999,
    enemyMaxHp: 999,
    guard: 0,
  });
const 轻击 = { label: '轻推', power: 1, tags: [] as const };

describe('免死（绞刑架幸存者）—— 战中锁血', () => {
  it('不传免死开关 → 该倒就倒（零改动）', () => {
    const s = playBeat(必死局(), 轻击, 1);
    expect(s.playerHp).toBe(0);
    expect(s.lastStandUsed).toBeUndefined();
  });

  it('传了 → 锁血到 hpFloor，本场标记已用', () => {
    const s = playBeat(必死局(), 轻击, 1, { lastStand: { hpFloor: 1 } });
    expect(s.playerHp).toBe(1);
    expect(s.lastStandUsed).toBe(true);
    expect(s.log.join('\n')).toContain('绞刑架幸存者');
  });

  it('每场一次：第二拍不再救（会话守卫）', () => {
    const s1 = playBeat(必死局(), 轻击, 1, { lastStand: { hpFloor: 1 } });
    const s2 = playBeat(s1, 轻击, 1, { lastStand: { hpFloor: 1 } });
    expect(s2.playerHp).toBe(0);
  });

  it('hpFloor 可调（档位）', () => {
    expect(playBeat(必死局(), 轻击, 1, { lastStand: { hpFloor: 2 } }).playerHp).toBe(2);
  });
});

describe('复活（再生）—— 战后不真死', () => {
  it('模板带「复生」条目，且算已实装', () => {
    const tpl = getTalentTemplate('再生');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries).toEqual([{ kind: '复生', channel: 'universal', params: { hpFloor: 1 } }]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('绞刑架幸存者与再生是两条不同分工的通道', () => {
    const 绞刑架 = getTalentTemplate('绞刑架幸存者')!;
    const 再生 = getTalentTemplate('再生')!;
    expect(绞刑架.entries[0].kind).toBe('免死'); // 战中
    expect(再生.entries[0].kind).toBe('复生'); // 战后
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. 自身战斗状态
// ════════════════════════════════════════════════════════════════════

describe('selfStatusesOf —— 状态表与收集', () => {
  const 持 = (status: string, power: number) => [
    { entries: [{ kind: '自身状态', params: { status, power } }] },
  ];

  it('认得的状态进列表，带机械形态', () => {
    expect(selfStatusesOf(持('隐身', 30))).toEqual([
      { status: '隐身', power: 30, kind: 'threatDown' },
    ]);
    expect(selfStatusesOf(持('吸魔', 20))).toEqual([{ status: '吸魔', power: 20, kind: 'regen' }]);
  });

  it('认不出的状态名不进列表（不给引擎看不懂的状态占位）', () => {
    expect(selfStatusesOf(持('莫名状态', 30))).toEqual([]);
    expect(selfStatusesOf(持('', 30))).toEqual([]);
    expect(selfStatusesOf(undefined)).toEqual([]);
  });

  it('量非正/非数 → 丢弃', () => {
    expect(selfStatusesOf(持('隐身', 0))).toEqual([]);
    expect(selfStatusesOf(持('隐身', -5))).toEqual([]);
  });

  it('同形态多条合计（两条隐身叠加）', () => {
    const list = [...持('隐身', 20), ...持('潜行', 10)];
    expect(totalSelfStatus(selfStatusesOf(list), 'threatDown')).toBe(30);
  });
});

describe('initialSelfEffects —— 只有需要每拍结算的才落成效果', () => {
  it('吸魔 → regen 效果；隐身 → 不落效果（由调用方缩放敌方威胁）', () => {
    expect(
      initialSelfEffects(
        selfStatusesOf([
          { entries: [{ kind: '自身状态', params: { status: '吸魔', power: 20 } }] },
        ]),
      ),
    ).toEqual([{ name: '自身状态·吸魔', type: 'regen', amount: 20 }]);
    expect(
      initialSelfEffects(
        selfStatusesOf([
          { entries: [{ kind: '自身状态', params: { status: '隐身', power: 30 } }] },
        ]),
      ),
    ).toEqual([]);
  });

  it('没有自身状态 → 空数组（零改动）', () => {
    expect(initialSelfEffects([])).toEqual([]);
  });
});

describe('吸魔 —— 每拍回血真的结算', () => {
  const 开战吸魔 = (amount: number) =>
    startSkirmish({
      enemyName: '岩爪兽',
      enemyLevel: 12,
      intents: [{ move: '痛击', threat: 99, counters: ['防御'] }],
      playerHp: 50,
      playerMaxHp: 100,
      enemyHp: 999,
      enemyMaxHp: 999,
      guard: 0,
      initialEffects: [{ name: '自身状态·吸魔', type: 'regen', amount }],
    });

  it('开战即入账，每拍末按量回复', () => {
    const s = 开战吸魔(20);
    const s1 = playBeat(s, 轻击, 1);
    // 被打掉一些后用 regen 补回来，且写审计行
    expect(s1.log.join('\n')).toContain('自身状态·吸魔');
    expect(s1.playerHp).toBeGreaterThan(0);
  });

  it('回复封顶 HP 上限（不会溢出）', () => {
    // 玩家满血 + 高回血 → 仍是 100 上限，不会涨过 maxHp
    const s = startSkirmish({
      enemyName: '木桩',
      enemyLevel: 12,
      intents: [{ move: '轻拍', threat: 1, counters: ['防御'] }],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 999,
      enemyMaxHp: 999,
      guard: 999,
      initialEffects: [{ name: '自身状态·吸魔', type: 'regen', amount: 50 }],
    });
    const s1 = playBeat(s, { label: '闪避', power: 999, tags: ['防御'] }, 20);
    expect(s1.playerHp).toBeLessThanOrEqual(100);
  });
});

// ════════════════════════════════════════════════════════════════════
// 体质检查
// ════════════════════════════════════════════════════════════════════

describe('本批之后 —— 五条 S 都离开了「仅叙事」', () => {
  it('素材十连系统 / 绞刑架幸存者 / 再生 / 蛇符咒 / 贝蒙斯坦', () => {
    for (const name of ['素材十连系统', '绞刑架幸存者', '再生', '蛇符咒', '贝蒙斯坦']) {
      const tpl = TALENT_CATALOG.find((t) => t.name === name);
      expect(tpl, name).toBeDefined();
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });

  it('状态表只放引擎认得的形态', () => {
    const allowed = new Set(['threatDown', 'regen']);
    for (const [name, kind] of Object.entries(SELF_STATUS_TABLE)) {
      expect(allowed.has(kind), name).toBe(true);
    }
  });
});
