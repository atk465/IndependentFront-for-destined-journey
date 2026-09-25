/**
 * mental-resources.test.ts — 2026-09-25 访谈共识：智力/MP/SP 应用
 * 覆盖：理解修正 / 评级智力修正 / 启封双轴 / MP 门槛与档位 / SP 拍耗与力竭 / 旅途 SP
 */
import { describe, it, expect } from 'vitest';
import { insightModOf, deriveCombatStats } from './derived-stats';
import { judgeUnseal } from './unsealing';
import { cardPlayPlan, mpCostOf, CARD_MP_COST_BY_TIER } from './entry-combat';
import {
  startSkirmish,
  playBeat,
  SP_COST_PLAY,
  SP_COST_COUNTER,
} from './skirmish-session';
import { planArrivalSync, TRAVEL_SP_PER_DAY } from './commission-flags';
import { planCardCraft } from './card-craft-plan';

describe('insightModOf（理解修正=智力）', () => {
  it('⌊(智力−10)/2⌋ 口径；脏值按 10', () => {
    expect(insightModOf({ int: 10 })).toBe(0);
    expect(insightModOf({ int: 12 })).toBe(1);
    expect(insightModOf({ int: 16 })).toBe(3);
    expect(insightModOf({ int: 8 })).toBe(-1);
    expect(insightModOf(undefined)).toBe(0);
    expect(insightModOf({ int: Number.NaN })).toBe(0);
  });
});

describe('制卡评级吃理解修正', () => {
  it('智力 16（+3）能把临界骰抬上一档；智力 8（−1）压下一档', () => {
    const base = {
      mainName: '铁矿',
      subNames: [],
      intent: '',
      inventory: [{ name: '铁矿', quantity: 1, type: '材料' as const, rarity: '普通' as const }],
    };
    // 成功线 d20≥6：骰 5 + 修正
    const mid = { ...base, d20: 5 };
    expect(planCardCraft({ ...mid, insightMod: 0 }).plan?.rating).toBe('失败');
    expect(planCardCraft({ ...mid, insightMod: 1 }).plan?.rating).toBe('成功');
    const low = { ...base, d20: 6 };
    expect(planCardCraft({ ...low, insightMod: 0 }).plan?.rating).toBe('成功');
    expect(planCardCraft({ ...low, insightMod: -1 }).plan?.rating).toBe('失败');
  });
});

describe('启封双轴（意志+理解）', () => {
  const card = {
    name: '测试封印卡',
    cardTier: '星辉' as const,
    词条: ['技能'],
    cardPowerBonus: 0,
    recipe: { fusionKind: '叠加' as const },
  } as unknown as Parameters<typeof judgeUnseal>[0];
  it('理解修正提升判定裕度（DC 侧不变）', () => {
    const noInsight = judgeUnseal(card, 10, 0, 0);
    const withInsight = judgeUnseal(card, 10, 0, 3);
    expect(withInsight.margin).toBe(noInsight.margin + 3);
  });
});

describe('MP 硬门槛与档位扣费', () => {
  it('档位定价表；非主动形态免', () => {
    expect(CARD_MP_COST_BY_TIER['星辉']).toBe(55);
    expect(mpCostOf({ cardTier: '星辉', 词条: ['技能'] })).toBe(55);
    expect(mpCostOf({ cardTier: '星辉', 词条: ['装备'] })).toBe(0);
    expect(mpCostOf({ cardTier: '白铁', 词条: ['物资'] })).toBe(0);
  });
  it('MP 不足 → 禁打（带可见原因）；足够 → 正常', () => {
    const card = {
      name: '烈焰术',
      cardTier: '星辉' as const,
      词条: ['技能'],
      cardPowerBonus: 0,
      战技: undefined,
    } as never as Parameters<typeof cardPlayPlan>[0];
    const short = cardPlayPlan(card, { atk: 30 }, { mp: 10 });
    expect(short.mode).toBe('禁打');
    expect(short.mode === '禁打' && short.reason).toContain('55');
    const ok = cardPlayPlan(card, { atk: 30 }, { mp: 60 });
    expect(ok.mode).not.toBe('禁打');
    // 缺省 resources = 老调用零门槛
    expect(cardPlayPlan(card, { atk: 30 }).mode).not.toBe('禁打');
  });
});

describe('SP 拍耗与力竭', () => {
  const intent = { label: '撕咬', threat: 5, dice: 10 };
  const mk = (sp?: number) =>
    startSkirmish({
      enemyName: '测试兽',
      intents: [intent],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 500,
      ...(sp !== undefined ? { playerSp: sp } : {}),
    });
  it('出卡 5 / 基础应对 3；拍拍入账', () => {
    expect(SP_COST_PLAY).toBe(5);
    expect(SP_COST_COUNTER).toBe(3);
    const s = mk(50);
    const afterPlay = playBeat(s, { label: '挥砍', power: 20, tags: [], cardName: '行旅短刃' }, 15);
    expect(afterPlay.spSpent).toBe(5);
    const afterCounter = playBeat(afterPlay, { label: '防御', power: 10, tags: ['防御'] }, 15);
    expect(afterCounter.spSpent).toBe(8);
  });
  it('MP 费用进会话账（mpSpent 累计）', () => {
    const s = mk(50);
    const after = playBeat(s, { label: '术', power: 20, tags: [], cardName: '烈焰术' }, 15, {
      mpCost: 55,
    });
    expect(after.mpSpent).toBe(55);
  });
  it('SP 归零 → 力竭败北（HP 还剩时）', () => {
    const s = mk(5);
    const after = playBeat(s, { label: '挥砍', power: 20, tags: [], cardName: '行旅短刃' }, 15);
    expect(after.finished).toBe('败北');
    expect(after.log.some((l) => l.includes('力竭'))).toBe(true);
  });
  it('无 playerSp 的旧调用零改动（不记账不判竭）', () => {
    const s = mk();
    const after = playBeat(s, { label: '挥砍', power: 20, tags: [], cardName: '行旅短刃' }, 15);
    expect(after.spSpent).toBeUndefined();
    expect(after.finished).toBeNull();
  });
});

describe('旅途 SP（每旅途日 4 点；人困马乏 DC+2）', () => {
  const BASE = { lastTileIdSeen: 1, lastMoveDay: 100 };
  it('旅途扣账进 outcome；没传 playerSp 为 0', () => {
    const withSp = planArrivalSync({
      flags: { ...BASE },
      lastTileId: 9,
      today: 105,
      routeDays: 3,
      midTier: null,
      playerSp: 50,
    });
    expect(withSp.travelSpCost).toBe(3 * TRAVEL_SP_PER_DAY);
    const noSp = planArrivalSync({
      flags: { ...BASE },
      lastTileId: 9,
      today: 105,
      routeDays: 3,
      midTier: null,
    });
    expect(noSp.travelSpCost).toBe(0);
  });
  it('SP < 20% → 抵达判定 DC+2（危险层足够时）', () => {
    const danger = { id: 'x', name: '裂隙', danger: 5 };
    const fresh = planArrivalSync({
      flags: { ...BASE },
      lastTileId: 9,
      today: 105,
      routeDays: 1,
      midTier: danger,
      playerSp: 100,
      d20: 17,
    });
    const tired = planArrivalSync({
      flags: { ...BASE },
      lastTileId: 9,
      today: 105,
      midTier: danger,
      playerSp: 20, // 五天旅途扣 20 → 0 < 20%：人困马乏
      d20: 17,
      routeDays: 5,
    });
    // 骰同、SP 差 → 疲者中招
    expect(tired.threat).toBeDefined();
    expect(fresh.threat).toBeUndefined();
  });
});

describe('派生值行数据（面板展示口径）', () => {
  it('deriveCombatStats 与修正修正同源', () => {
    const s = deriveCombatStats({ attributes: { str: 16, con: 14, dex: 12, int: 16, spi: 10 }, level: 12 });
    expect(s.atk).toBe(2 * 16 + 12);
    expect(s.guard).toBe(2 * 14 + 6);
    expect(s.agi).toBe(2 * 12 + 6);
    expect(insightModOf({ int: 16 })).toBe(3);
  });
});
