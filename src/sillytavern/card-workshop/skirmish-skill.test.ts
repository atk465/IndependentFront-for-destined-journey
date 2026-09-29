/**
 * skirmish-skill.test.ts — v2 共识·替换制新轨单测（skill 上下文传入路径）
 * 旧定值轨由 skirmish-session.test/skirmish.test 覆盖；本文件锁新轨语义：
 * A 类公式化（难度表×派生+副轴）、B 类乘区加算、C 类威胁族、margin 在乘区外、dot 快照。
 */
import { describe, expect, it } from 'vitest';

import { startSkirmish, playBeat, type SkillContext } from './skirmish-session';

const 开战 = () =>
  startSkirmish({
    enemyName: '岩爪兽',
    enemyLevel: 12,
    intents: [{ move: '崩山击', threat: 30, counters: ['打断'] }],
    playerHp: 155,
    playerMaxHp: 155,
    enemyHp: 500,
    enemyMaxHp: 500,
    guard: 10,
  });

const skillCtx: SkillContext = {
  mainDerivation: 26,
  secondary: [{ axis: 'dex', bonus: 40, derivation: 10 }],
  difficulty: '标准',
};

describe('playBeat skill 轨（v2 替换制）', () => {
  it('伤害=公式值（力 120%×26=31 + 敏 40%×10=4=35）+ 碾压余量；行动值不进伤害', () => {
    const s = 开战();
    // d20=20 + 命中轴 52 + 克制15（打断命中反制面）= 87 vs 威胁30 → margin 57；伤害 = 35 + 57 = 92
    const next = playBeat(
      s,
      { label: '打出 烈焰斩', power: 52, tags: ['打断'], cardName: '烈焰斩' },
      20,
      {
        effects: [{ trigger: '打出时', target: '敌单体', action: '伤害', value: 8 }],
        skill: skillCtx,
      },
    );
    expect(next.enemyHp).toBe(500 - 92);
    expect(next.log.join('\n')).toContain('公式伤害35');
    expect(next.log.join('\n')).toContain('31+副轴4');
  });
  it('连击进乘区加算层：35 ×(1+50%) = floor 52 + margin；不吃命中轴', () => {
    const s = 开战();
    const next = playBeat(
      s,
      { label: '打出 连斩', power: 52, tags: ['打断'], cardName: '连斩' },
      20,
      {
        effects: [
          { trigger: '打出时', target: '敌单体', action: '伤害', value: 8 },
          { trigger: '打出时', target: '敌单体', action: '连击', value: 50 },
        ],
        skill: skillCtx,
      },
    );
    // margin = 87-30 = 57；floor(35×1.5)=52 + 57 = 109
    expect(next.enemyHp).toBe(500 - 109);
    expect(next.log.join('\n')).toContain('×伤害+50%');
  });
  it('dot 出手快照：中毒 amount = round(26×40/100) = 10/拍（Q12）', () => {
    const s = 开战();
    const next = playBeat(
      s,
      { label: '打出 蚀心蛊', power: 52, tags: ['打断'], cardName: '蚀心蛊' },
      20,
      {
        effects: [{ trigger: '打出时', target: '敌单体', action: '中毒', value: 3, duration: 3 }],
        skill: skillCtx,
      },
    );
    const dot = next.activeEffects.find((e) => e.type === 'dot');
    // 副轴项作用于卡上全部输出量：中毒 10 + 敏 40%×10=4 → 14
    expect(dot?.amount).toBe(14);
  });
  it('破防重诠释为威胁族（Q22）：weaken 4 挂场，次拍敌方威胁 −4；玩家防护不被削', () => {
    const s = 开战();
    const first = playBeat(
      s,
      { label: '打出 碎甲', power: 52, tags: ['打断'], cardName: '碎甲' },
      20,
      {
        effects: [{ trigger: '打出时', target: '敌单体', action: '破防', value: 4 }],
        skill: skillCtx,
      },
    );
    expect(first.activeEffects.some((e) => e.type === 'weaken' && e.amount === 4)).toBe(true);
    // 次拍：威胁 30 → 26；反制失败路径下玩家受伤 = 26 − ⌊防护10/2⌋ = 21（防护未被破防削）
    const second = playBeat(first, { label: '防御', power: 10, tags: ['防御'] }, 1, {
      skill: skillCtx,
    });
    expect(second.log.join('\n')).toContain('减速战技：敌方威胁 −4');
    expect(second.playerHp).toBe(155 - 21);
  });
  it('基础强攻拍（批次 3 接线口径：强攻注入 {action:伤害} 效果）= 公式值 31+4=35 + margin', () => {
    const s = 开战();
    // 批次 3 由 pipeline 给强攻拍注入基础强攻效果（主轴派生×BASIC_ATTACK_PCT）；
    // 此处提前锁定该口径：强攻不带 effects 时伤害基数 0（margin-only 语义不采用）
    const next = playBeat(s, { label: '强攻', power: 52, tags: ['强攻'] }, 20, {
      effects: [{ trigger: '打出时', target: '敌单体', action: '伤害', value: 8 }],
      skill: skillCtx,
    });
    // roll = 20+52+0（强攻无克制）= 72 vs 30 → margin 42；floor(35×1.0)+42 = 77
    expect(next.enemyHp).toBe(500 - 77);
  });
  it('兑现类治疗走治疗表：任务兑现 = 120%×26 = 31 HP（Q8 重定基）', () => {
    const s = 开战();
    let cur = playBeat(
      s,
      { label: '打出 委任状', power: 52, tags: ['打断'], cardName: '委任状' },
      20,
      {
        effects: [
          {
            trigger: '打出时',
            target: '自身',
            action: '任务',
            value: 3,
            duration: 3,
            cost: { mp: 5 },
          },
        ],
        skill: skillCtx,
      },
    );
    // 再打 3 张卡满足条件 → 拍末 quest 兑现（amount=3 张目标，events['出卡'] 逐拍累积）
    for (let i = 0; i < 3; i++) {
      cur = playBeat(
        cur,
        { label: `打出 卡${i}`, power: 52, tags: ['打断'], cardName: `卡${i}` },
        20,
        {
          effects: [{ trigger: '打出时', target: '敌单体', action: '伤害', value: 8 }],
          skill: skillCtx,
        },
      );
    }
    expect(cur.log.join('\n')).toContain('回复 31 HP');
  });
});
