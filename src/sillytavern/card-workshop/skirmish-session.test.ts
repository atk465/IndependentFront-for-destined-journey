/**
 * skirmish-session.test.ts — 交锋拍会话账本全流程覆盖
 *
 * 开战 → 交锋 → 终局 → 结算的每一步可回放；账本纯函数不 mutate、结束态幂等。
 */
import { describe, it, expect } from 'vitest';
import type { SkirmishFinish } from './skirmish-session';
import {
  startSkirmish,
  currentIntent,
  playBeat,
  crushFinish,
  fleeSkirmish,
  settleSkirmish,
} from './skirmish-session';

/** 终局四态钉死（null = 交锋中不在此列） */
const 快速终局: SkirmishFinish = '碾压';
const 终局全集: readonly SkirmishFinish[] = ['胜利', '碾压', '撤退', '败北'];

const 开战 = () =>
  startSkirmish({
    enemyName: '岩爪兽',
    enemyLevel: 12,
    intents: [
      { move: '蓄力·崩山击', threat: 18, counters: ['打断', '防御'] },
      { move: '连环爪击', threat: 12, counters: ['闪避'] },
    ],
    playerHp: 155,
    playerMaxHp: 155,
    enemyHp: 320,
    enemyMaxHp: 320,
    guard: 10,
  });

const 卡行动 = { label: '打出 燎原符卡', power: 12, tags: ['打断' as const], cardName: '燎原符卡' };
const 应对 = { label: '防御', power: 32, tags: ['防御' as const] };

describe('startSkirmish —— 开战入账', () => {
  it('预提交意图夹逼入账，开场行两条', () => {
    const s = 开战();
    expect(s.intents).toHaveLength(2);
    expect(s.beat).toBe(0);
    expect(s.finished).toBeNull();
    expect(s.log[0]).toBe('◆ 战斗模式 · 交锋拍制 ◆');
    expect(s.log[1]).toBe('▸ 【岩爪兽】Lv.12 现身——2 拍意图已锁定');
  });
  it('脏数据兜底：意图非数组仍可开战（0 拍 → 开局即拍尽终局路径由集成层防），等级缺省 1', () => {
    const s = startSkirmish({ enemyName: '史莱姆', intents: '坏数据', playerHp: 100, enemyHp: 50 });
    expect(s.intents).toEqual([]);
    expect(s.enemyLevel).toBe(1);
    expect(s.playerMaxHp).toBe(100);
    expect(s.enemyMaxHp).toBe(50);
  });
  it('currentIntent 逐拍揭示，打完即 null', () => {
    const s = 开战();
    expect(currentIntent(s)?.move).toBe('蓄力·崩山击');
    const after = playBeat(s, 卡行动, 17);
    expect(currentIntent(after)?.move).toBe('连环爪击');
    const done = playBeat(after, 应对, 10);
    expect(currentIntent(done)).toBeNull();
  });
});

describe('playBeat —— 拍推进与记账', () => {
  it('反制成功拍：HP/审计/参战卡/反制计数入账', () => {
    const after = playBeat(开战(), 卡行动, 17);
    expect(after.beat).toBe(1);
    expect(after.enemyHp).toBe(288);
    expect(after.playerHp).toBe(155);
    expect(after.counteredBeats).toBe(1);
    expect(after.playedCards).toEqual(['燎原符卡']);
    expect(after.log[2]).toContain('打出 燎原符卡：d20=17');
  });
  it('同名参战卡去重（拍 1 与拍 2 出同一张只记一次）', () => {
    const a = playBeat(开战(), 卡行动, 17);
    const b = playBeat(a, { ...卡行动, tags: ['防御' as const] }, 10);
    expect(b.playedCards).toEqual(['燎原符卡']);
  });
  it('拍尽且敌未倒 → 胜利（打退攻势）', () => {
    let s = 开战();
    s = playBeat(s, 应对, 1); // 低骰也能撑到拍尽（行动值 32 高于两个威胁）
    s = playBeat(s, 应对, 1);
    expect(s.finished).toBe('胜利');
    expect(s.log[s.log.length - 1]).toBe('▸ 2 拍交锋打完，敌方攻势穷尽——打退了【岩爪兽】！');
  });
  it('敌方 HP 归零 → 胜利；玩家 HP 归零 → 败北', () => {
    const s = startSkirmish({
      enemyName: '残血史莱姆',
      enemyLevel: 1,
      intents: [{ move: '弹', threat: 1, counters: ['强攻'] }],
      playerHp: 3,
      enemyHp: 4,
      guard: 0,
    });
    expect(playBeat(s, { label: '强攻', power: 9, tags: ['强攻'] }, 20).finished).toBe('胜利');
    const s2 = startSkirmish({
      enemyName: '暴君',
      enemyLevel: 20,
      intents: [{ move: '灭世', threat: 99, counters: ['防御'] }],
      playerHp: 5,
      enemyHp: 500,
      guard: 0,
    });
    expect(playBeat(s2, 应对, 1).finished).toBe('败北');
  });
  it('结束态之后的行动幂等（原样返回）', () => {
    const fled = fleeSkirmish(开战());
    expect(playBeat(fled, 卡行动, 20)).toBe(fled);
    expect(crushFinish(fled)).toBe(fled);
    expect(fleeSkirmish(fled)).toBe(fled);
  });
});

describe('crushFinish / fleeSkirmish —— 快速终局', () => {
  it('终局四态齐全（钉类型契约）', () => {
    expect(快速终局).toBe('碾压');
    expect(终局全集).toEqual(['胜利', '碾压', '撤退', '败北']);
  });
  it('碾压：跳拍直接终局，审计行说明 ×2', () => {
    const s = crushFinish(开战());
    expect(s.finished).toBe('碾压');
    expect(s.log[s.log.length - 1]).toBe('▸ 数值碾压：我方战力达敌方 ×2 → 跳过交锋，直接结算');
  });
  it('撤退：评价 C', () => {
    const s = fleeSkirmish(开战());
    expect(s.finished).toBe('撤退');
  });
});

describe('settleSkirmish —— 终局结算数据', () => {
  it('未结束 → null', () => {
    expect(settleSkirmish(开战(), 9)).toBeNull();
  });
  it('全反制胜利：S 级、经验链可复算、参战卡 50% 分成', () => {
    const s = playBeat(playBeat(开战(), 卡行动, 17), { ...卡行动, tags: ['闪避' as const] }, 20);
    const got = settleSkirmish(s, 9);
    expect(got).not.toBeNull();
    expect(got?.finish).toBe('胜利');
    expect(got?.grade).toBe('S');
    expect(got?.exp.base).toBe(120);
    expect(got?.exp.total).toBe(312);
    expect(got?.cardExp).toEqual([{ name: '燎原符卡', gain: 156 }]);
    expect(got?.expLines[got.expLines.length - 1]).toBe('▸ 参战卡【燎原符卡】分得 156 卡牌经验');
  });
  it('撤退：C 级经验减半档；碾压：S 封顶', () => {
    const fled = settleSkirmish(fleeSkirmish(开战()), 9);
    expect(fled?.grade).toBe('C');
    expect(fled?.exp.total).toBe(78);
    const crushed = settleSkirmish(crushFinish(开战()), 9);
    expect(crushed?.grade).toBe('S');
    expect(crushed?.exp.total).toBe(312);
    expect(crushed?.cardExp).toEqual([]);
  });
  it('败北：C 级，HP 损失 100% 不额外惩罚（初稿口径）', () => {
    const lost = playBeat(
      startSkirmish({
        enemyName: '暴君',
        enemyLevel: 20,
        intents: [{ move: '灭世', threat: 99, counters: ['防御'] }],
        playerHp: 5,
        enemyHp: 500,
        guard: 0,
      }),
      应对,
      1,
    );
    const got = settleSkirmish(lost, 9);
    expect(got?.grade).toBe('C');
    expect(got?.exp.total).toBe(200); // 基础 200 × 等级差修正 2.0（封顶）× C 0.5
  });
});
