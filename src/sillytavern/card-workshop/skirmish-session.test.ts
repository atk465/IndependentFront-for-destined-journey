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
    expect(s.log[1]).toBe(
      '▸ 【岩爪兽】Lv.12 现身——2 式招已锁定（招式轮换，打到一方倒下或冒险者收手为止）',
    );
  });
  it('脏数据兜底：意图非数组 → 0 式招即「不战自溃」终局（UI 永不卡死），等级缺省 1', () => {
    const s = startSkirmish({ enemyName: '史莱姆', intents: '坏数据', playerHp: 100, enemyHp: 50 });
    expect(s.intents).toEqual([]);
    expect(s.enemyLevel).toBe(1);
    expect(s.playerMaxHp).toBe(100);
    expect(s.enemyMaxHp).toBe(50);
    expect(s.finished).toBe('胜利');
    expect(s.log[s.log.length - 1]).toBe('▸ 【史莱姆】毫无章法——不战自溃！');
  });
  it('currentIntent 逐拍揭示；序列打完按原序轮换（不限拍数）', () => {
    const s = 开战();
    expect(currentIntent(s)?.move).toBe('蓄力·崩山击');
    const after = playBeat(s, 卡行动, 17);
    expect(currentIntent(after)?.move).toBe('连环爪击');
    const cycled = playBeat(after, 应对, 10);
    expect(cycled.finished).toBeNull(); // 拍尽不再终局
    expect(currentIntent(cycled)?.move).toBe('蓄力·崩山击'); // 轮回第一式
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
  it('拍尽不再终局：招式轮换继续打（主人裁定：打到一方倒下或主动收手）', () => {
    let s = 开战();
    for (let i = 0; i < 5; i++) {
      s = playBeat(s, 应对, 1); // 行动值 32 高于两个威胁 → 全反制但打不死 320 HP
      expect(s.finished).toBeNull();
    }
    expect(s.beat).toBe(5);
    expect(s.counteredBeats).toBe(5);
  });

  it('出卡宣言（note）入账：置于拍审计之前的「意图」行', () => {
    const s = playBeat(开战(), { ...卡行动, note: '扬手掷符，火线掠地烧它后腿' }, 17);
    expect(s.log[2]).toBe('▸ 意图：扬手掷符，火线掠地烧它后腿');
    expect(s.log[3]).toContain('打出 燎原符卡：d20=17');
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
  it('玩家主动结束（主人裁定）：理由入审计行与 endReason 字段，供终局记叙参考', () => {
    const s = fleeSkirmish(开战(), '它已无战意，放它归山');
    expect(s.finished).toBe('撤退');
    expect(s.endReason).toBe('它已无战意，放它归山');
    expect(s.log[s.log.length - 2]).toBe('▸ 冒险者收手：「它已无战意，放它归山」');
  });
  it('玩家主动结束留空理由：不记意图行，endReason 缺省', () => {
    const s = fleeSkirmish(开战(), '   ');
    expect(s.endReason).toBeUndefined();
    expect(s.log[s.log.length - 1]).toBe('▸ 撤退成功——脱离接触（评价 C）');
  });
});

describe('settleSkirmish —— 终局结算数据', () => {
  it('未结束 → null', () => {
    expect(settleSkirmish(开战(), 9)).toBeNull();
  });
  it('全反制胜利：S 级、经验链可复算、参战卡 50% 分成（敌方 HP 压到两拍内打空）', () => {
    const base = startSkirmish({
      enemyName: '岩爪兽',
      enemyLevel: 12,
      intents: [
        { move: '蓄力·崩山击', threat: 18, counters: ['打断', '防御'] },
        { move: '连环爪击', threat: 12, counters: ['闪避'] },
      ],
      playerHp: 155,
      playerMaxHp: 155,
      enemyHp: 60,
      enemyMaxHp: 60,
      guard: 10,
    });
    const s = playBeat(playBeat(base, 卡行动, 17), { ...卡行动, tags: ['闪避' as const] }, 20);
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

describe('在场效果 —— 领域 DoT / 装备召唤助战（真机裁定 2026-09-13）', () => {
  const 开战 = () =>
    startSkirmish({
      enemyName: '岩爪兽',
      enemyLevel: 12,
      intents: [{ move: '蓄力·崩山击', threat: 18, counters: ['打断', '防御'] }],
      playerHp: 155,
      playerMaxHp: 155,
      enemyHp: 200, // 高血量：直击打不死，才能观察 DoT 行
      enemyMaxHp: 200,
      guard: 10,
    });
  const 应对 = { label: '防御', power: 32, tags: ['防御' as const] };

  it('激活行入账，效果自下一拍生效（激活当拍无加成行）', () => {
    const s = playBeat(开战(), 应对, 15, { name: '灼热盆地', type: 'dot', amount: 6 });
    expect(s.activeEffects).toEqual([{ name: '灼热盆地', type: 'dot', amount: 6 }]);
    // 激活当拍：无「在场持续」行（DoT 下一拍才烧），有激活行
    expect(s.log.some((l) => l.startsWith('▸ 在场持续'))).toBe(false);
    expect(s.log[s.log.length - 1]).toBe('▸ 【灼热盆地】灼烧生效——此后每拍敌方 −6');
  });

  it('DoT 拍末结算：审计行带前后 HP', () => {
    const activated = playBeat(开战(), 应对, 15, { name: '灼热盆地', type: 'dot', amount: 6 });
    const s = playBeat(activated, 应对, 15);
    const dotLine = s.log.find((l) => l.startsWith('▸ 在场持续'));
    expect(dotLine).toMatch(/敌方 −6（\d+ → \d+）/);
  });

  it('buff 下一拍起叠加行动值，审计单列加成行', () => {
    const activated = playBeat(开战(), 应对, 15, { name: '秘银长剑', type: 'buff', amount: 6 });
    const s = playBeat(activated, 应对, 1);
    // 防御 32 + 加成 6 = 38；d20=1 + 38 + 克制9 = 48 vs 威胁18 → 反制成功
    expect(s.log.some((l) => l === '▸ 在场加成：行动值 +6')).toBe(true);
    expect(s.log.some((l) => l.includes('行动值38'))).toBe(true);
  });

  it('DoT 收下人头 → 胜利（直击没打死、烧倒）', () => {
    const base = startSkirmish({
      enemyName: '残血兽',
      enemyLevel: 5,
      intents: [{ move: '咬', threat: 10, counters: ['防御'] }],
      playerHp: 100,
      enemyHp: 8,
      guard: 20,
    });
    // 激活拍：弱闪避（roll 2 < 10 反制失败，直击仍打 1）→ 敌方 8−1 = 7
    const activated = playBeat(base, { label: '闪避', power: 1, tags: ['闪避'] }, 1, {
      name: '灼热盆地',
      type: 'dot',
      amount: 9,
    });
    expect(activated.enemyHp).toBe(7);
    // 下一拍：直击 1 → 6，DoT 9 → 0 → 胜利
    const s = playBeat(activated, { label: '闪避', power: 1, tags: ['闪避'] }, 1);
    expect(s.finished).toBe('胜利');
    expect(s.enemyHp).toBe(0);
  });
});
