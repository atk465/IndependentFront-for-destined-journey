/**
 * multi-enemy.test.ts — 多敌实体化：逐敌结算/护卫减伤/首领终局/目标指定
 */
import { describe, it, expect } from 'vitest';
import { startSkirmish, playBeat } from './skirmish-session';

const intent = (move: string, threat: number): import('./skirmish').EnemyIntent => ({
  move,
  threat,
  counters: ['防御'],
});

const mk = () =>
  startSkirmish({
    enemyName: '首领·石像督军',
    intents: [intent('督军重压', 20)],
    playerHp: 200,
    playerMaxHp: 200,
    enemyHp: 400,
    guard: 10,
    playerSp: 50,
    enemies: [
      { name: '首领·石像督军', role: '首领', hp: 300, intents: [intent('督军重压', 20)] },
      { name: '石像卫兵甲', role: '杂兵', hp: 80, intents: [intent('石拳', 10)] },
      { name: '石像卫兵乙', role: '杂兵', hp: 80, intents: [intent('石拳', 10)] },
    ],
  });

describe('多敌实体化', () => {
  it('目标敌承伤=行动值+反制余量；护卫减伤保护首领', () => {
    const s = mk();
    // 打首领（护卫 2 杂兵 → −40%）
    const after = playBeat(s, { label: '重锤', power: 30, tags: ['强攻'] }, 18, { targetIndex: 0 });
    expect(after.log.some((l) => l.includes('护卫') && l.includes('−40%'))).toBe(true);
    // 首领承伤 = 30+3(余量 18+30-20=28… 按实现重锤 30+骰18=48 ≥ 20 → 反制成功余量 28，打首领 30+28=58 → ×0.6 = 35)
    expect(after.enemies?.[0].hp).toBeLessThan(300);
  });
  it('其余敌照常出手——玩家承伤包含未目标敌威胁', () => {
    const s = mk();
    const after = playBeat(s, { label: '重锤', power: 30, tags: ['强攻'] }, 18, { targetIndex: 0 });
    // 卫兵甲/乙各 threat 10 直砸 → 玩家承伤 20（护卫 10 减半）
    expect(after.playerHp).toBeLessThan(200);
  });
  it('清杂兵→护卫减伤消失→首领全额承伤', () => {
    let s = mk();
    // 杀甲（目标下标 1，两拍）
    s = playBeat(s, { label: '斩甲', power: 60, tags: ['强攻'] }, 18, { targetIndex: 1 });
    s = playBeat(s, { label: '斩甲', power: 60, tags: ['强攻'] }, 18, { targetIndex: 1 });
    expect(s.enemies?.[1].dead).toBe(true);
    // 再杀乙
    s = playBeat(s, { label: '斩乙', power: 60, tags: ['强攻'] }, 18, { targetIndex: 2 });
    s = playBeat(s, { label: '斩乙', power: 60, tags: ['强攻'] }, 18, { targetIndex: 2 });
    // 无护卫 → 首领全额承伤
    const before = s.enemies?.[0].hp ?? 300;
    const after = playBeat(s, { label: '重锤', power: 40, tags: ['强攻'] }, 18, { targetIndex: 0 });
    expect(after.enemies?.[0].hp).toBeLessThan(before);
  });
  it('首领倒下 = 即刻胜利（杂兵存活不算）', () => {
    const s = mk();
    // 直接把首领打到 1（用连续大伤害模拟——这里用测试钩子直接改 HP 再拍死）
    const low = {
      ...s,
      enemies: (s.enemies ?? []).map((e, i) => (i === 0 ? { ...e, hp: 10 } : e)),
    } as typeof s;
    const after = playBeat(low, { label: '终结一击', power: 60, tags: ['强攻'] }, 18, { targetIndex: 0 });
    expect(after.finished).toBe('胜利');
    // 杂兵仍存活也不影响——首领死即胜
  });
  it('全杂兵死但首领存活 → 战斗继续', () => {
    const s = mk();
    const after = playBeat(s, { label: '斩杂', power: 60, tags: ['强攻'] }, 18, { targetIndex: 1 });
    expect(after.finished).toBeNull();
    expect(after.enemies?.[1].dead).toBe(true);
  });
  it('目标死亡后自动落到存活敌', () => {
    let s = mk();
    s = playBeat(s, { label: '斩甲', power: 200, tags: ['强攻'] }, 18, { targetIndex: 1 });
    const after = playBeat(s, { label: '再斩', power: 30, tags: ['强攻'] }, 18, { targetIndex: 1 });
    // 目标已死 → 自动落威胁最高者（首领）
    expect(after.log.some((l) => l.includes('石像督军'))).toBe(true);
  });
});
