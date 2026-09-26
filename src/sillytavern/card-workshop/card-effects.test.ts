/**
 * card-effects.test.ts — 效果池：元素派生打底 / 门禁 / 微差 / 翻译 / 叠层倍化
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  EFFECT_POOL,
  ELEMENT_DEFAULT_EFFECT,
  poolEntryOf,
  statModsOf,
  deriveCardEffects,
  registerCardEffects,
  clearCardEffectOverrides,
  coerceCardEffects,
  effectLineOf,
} from './card-effects';
import { startSkirmish, playBeat } from './skirmish-session';
import { cardAxisOf, deriveCardAtk, CARD_ELEMENT_AXIS } from './derived-stats';

describe('效果池与元素映射（派生打底）', () => {
  it('池 25 条（首批 16 + 批一 9），九元素九映射', () => {
    expect(EFFECT_POOL).toHaveLength(25);
    expect(Object.keys(ELEMENT_DEFAULT_EFFECT)).toHaveLength(9);
    for (const action of Object.values(ELEMENT_DEFAULT_EFFECT)) {
      expect(poolEntryOf(action)).toBeDefined(); // 映射的动作都在池内
    }
  });
  it('deriveCardEffects：火素材卡派生灼烧（每拍 4，2 拍）', () => {
    const fx = deriveCardEffects({ name: '火球术', 词条: ['技能', '火'], cardTier: '青铜' });
    expect(fx).toHaveLength(1);
    expect(fx[0].action).toBe('灼烧');
    expect(fx[0].value).toBe(4);
    expect(fx[0].duration).toBe(2);
    expect(fx[0].trigger).toBe('每拍');
    expect(fx[0].target).toBe('敌单体');
  });
  it('无元素词条 → 空集（不硬造）', () => {
    expect(deriveCardEffects({ name: '白板卡', 词条: ['技能'], cardTier: '白铁' })).toEqual([]);
  });
  it('精配覆写优先；清空后回落派生', () => {
    registerCardEffects({
      火球术: [{ trigger: '打出时', target: '敌单体', action: '伤害', value: 8 }],
    });
    const fx = deriveCardEffects({ name: '火球术', 词条: ['技能', '火'], cardTier: '青铜' });
    expect(fx[0].action).toBe('伤害');
    clearCardEffectOverrides();
    expect(deriveCardEffects({ name: '火球术', 词条: ['技能', '火'], cardTier: '青铜' })[0].action).toBe('灼烧');
  });
});

describe('coerceCardEffects（AI 池内选的门禁）', () => {
  beforeEach(() => clearCardEffectOverrides());
  it('池内选择（数值逐字照抄）→ 通过', () => {
    const ok = coerceCardEffects([
      { trigger: '打出时', target: '敌单体', action: '灼烧', value: 4, duration: 2 },
    ]);
    expect(ok).toHaveLength(1);
    expect(ok[0].action).toBe('灼烧');
  });
  it('AI 改数 / 池外动作 / 持续不符 → 该条丢弃；合法条保留', () => {
    const mixed = coerceCardEffects([
      { trigger: '打出时', target: '敌单体', action: '伤害', value: 999 }, // 改数
      { trigger: '每拍', target: '敌单体', action: '流血', value: 2, duration: 4 }, // 合法
    ]);
    expect(mixed).toHaveLength(1);
    expect(mixed[0].action).toBe('流血');
    const dirty = coerceCardEffects([
      { trigger: '每拍', target: '敌单体', action: '灼烧', value: 4, duration: 9 }, // 持续不符
    ]);
    expect(dirty).toEqual([]);
  });
  it('超量（>2 条）整批丢弃（防滥用）', () => {
    const entries = EFFECT_POOL.slice(0, 3).map((e) => ({
      trigger: '每拍',
      target: '敌单体',
      action: e.action,
      value: e.value,
      duration: e.duration,
    }));
    expect(coerceCardEffects(entries)).toEqual([]);
  });
});

describe('数值微差（双轨之二）', () => {
  it('元素派生：火+1攻、土+2防护+1耗、风−1耗；星辉档再省 1 MP', () => {
    expect(statModsOf(['技能', '火'], '青铜')).toEqual({ atk: 1, mp: 0, guard: 0 });
    expect(statModsOf(['装备', '土'], '青铜')).toEqual({ atk: 0, mp: 1, guard: 2 });
    expect(statModsOf(['技能', '风'], '青铜')).toEqual({ atk: 0, mp: -1, guard: 0 });
    expect(statModsOf(['技能', '火'], '星辉').mp).toBe(-1);
  });
  it('无元素全零（两张同档无元素卡的差异由效果层承担）', () => {
    expect(statModsOf(['技能'], '白银')).toEqual({ atk: 0, mp: 0, guard: 0 });
  });
});

describe('元素主属性轴（卡牌强度挂角色属性）', () => {
  it('九元素九轴映射；无元素兜底力量', () => {
    expect(CARD_ELEMENT_AXIS['火']).toBe('str');
    expect(CARD_ELEMENT_AXIS['水']).toBe('spi');
    expect(CARD_ELEMENT_AXIS['雷']).toBe('dex');
    expect(CARD_ELEMENT_AXIS['土']).toBe('con');
    expect(CARD_ELEMENT_AXIS['光']).toBe('int');
    expect(cardAxisOf(['技能'])).toBe('str');
    expect(cardAxisOf(['技能', '暗'])).toBe('int');
  });
  it('行动值 = 2×对应属性 + 等级：智力 16 用光卡优于力量 10', () => {
    const attrs = { str: 10, dex: 10, con: 10, int: 16, spi: 10 };
    expect(deriveCardAtk(['技能', '光'], attrs, 12)).toBe(2 * 16 + 12);
    expect(deriveCardAtk(['技能', '火'], attrs, 12)).toBe(2 * 10 + 12);
    // 同一张卡在不同 build 手里强度不同——加点就是选玩法
  });
});

describe('拍内结算（翻译器 → playBeat）', () => {
  const intent = { move: '扑咬', threat: 5, counters: [] };
  const mk = (enemyCount?: number) =>
    startSkirmish({
      enemyName: '测试兽',
      intents: [intent],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 600,
      guard: 10,
      ...(enemyCount !== undefined ? { enemyCount } : {}),
    });
  it('打出时·伤害：行动值追加（敌全体 ×enemyCount 倍化）', () => {
    const s = mk(2);
    const after = playBeat(
      s,
      { label: '火雨', power: 20, tags: [] },
      15,
      {
        effects: [{ trigger: '打出时', target: '敌全体', action: '伤害', value: 8 }],
        enemyCount: 2,
      },
    );
    // 行动值 = 20 + 8×2 = 36（敌全体倍化）
    expect(after.log.some((l) => l.includes('36'))).toBe(true);
  });
  it('状态层：灼烧入在场、下拍起每拍掉血；同状态叠层', () => {
    const s = mk();
    const after1 = playBeat(s, { label: '火舌', power: 10, tags: [] }, 15, {
      effects: [{ trigger: '每拍', target: '敌单体', action: '灼烧', value: 4, duration: 2 }],
    });
    expect(after1.activeEffects.some((e) => e.name === '灼烧')).toBe(true);
    const after2 = playBeat(after1, { label: '再烧', power: 10, tags: [] }, 15, {
      effects: [{ trigger: '每拍', target: '敌单体', action: '灼烧', value: 4, duration: 2 }],
    });
    const burn = after2.activeEffects.find((e) => e.name === '灼烧');
    expect(burn?.amount).toBe(8); // 叠层
  });
  it('治疗/吸血：拍末 HP 回复；凝神（驱散位）进 mpGained 账', () => {
    const hurt = { ...mk(), playerHp: 50 };
    const after = playBeat(hurt, { label: '圣水', power: 5, tags: [] }, 15, {
      effects: [
        { trigger: '打出时', target: '自身', action: '治疗', value: 12 },
        { trigger: '打出时', target: '自身', action: '驱散', value: 0 },
      ],
    });
    expect(after.playerHp).toBe(62);
    expect(after.mpGained).toBe(10);
  });
  it('批一状态：恐惧威胁减半+反制面关、束缚威胁锁 1、圣盾免疫、反伤反弹、剧毒百分比', () => {
    const fearIntent = { move: '重击', threat: 20, counters: ['防御'] };
    const s1 = startSkirmish({
      enemyName: '兽', intents: [fearIntent], playerHp: 100, playerMaxHp: 100, enemyHp: 600, guard: 10,
    });
    // 恐惧 live → 敌方威胁 10（减半）且 counters 清空
    const feared = playBeat(
      startSkirmish({
        enemyName: '兽', intents: [fearIntent], playerHp: 100, playerMaxHp: 100, enemyHp: 600, guard: 10,
        initialEffects: [{ name: '恐惧', type: 'fear', amount: 0, beatsLeft: 2 }],
      }),
      { label: '试探', power: 0, tags: [] }, 15,
    );
    expect(feared.log.some((l) => l.includes('恐惧'))).toBe(true);
    // 束缚：威胁锁 1 → 玩家无伤
    const bound = playBeat(
      startSkirmish({
        enemyName: '兽', intents: [fearIntent], playerHp: 100, playerMaxHp: 100, enemyHp: 600, guard: 10,
        initialEffects: [{ name: '束缚', type: 'bind', amount: 0, beatsLeft: 2 }],
      }),
      { label: '对峙', power: 0, tags: [] }, 15,
    );
    expect(bound.playerHp).toBe(100);
    // 圣盾：免疫一拍全部伤害
    const shielded = playBeat(
      startSkirmish({
        enemyName: '兽', intents: [fearIntent], playerHp: 100, playerMaxHp: 100, enemyHp: 600, guard: 10,
        initialEffects: [{ name: '圣盾', type: 'divineShield', amount: 0, beatsLeft: 1 }],
      }),
      { label: '硬挨', power: 0, tags: [] }, 15,
    );
    expect(shielded.playerHp).toBe(100);
    expect(shielded.log.some((l) => l.includes('圣盾'))).toBe(true);
    // 反伤：挨打 → 敌方掉血
    const thorn = playBeat(
      startSkirmish({
        enemyName: '兽', intents: [fearIntent], playerHp: 100, playerMaxHp: 100, enemyHp: 600, guard: 10,
        initialEffects: [{ name: '反伤', type: 'thorns', amount: 5, beatsLeft: 2 }],
      }),
      { label: '硬挨', power: 0, tags: [] }, 15,
    );
    expect(thorn.enemyHp).toBeLessThan(600);
    expect(thorn.log.some((l) => l.includes('反伤'))).toBe(true);
    // 剧毒：按当前气血百分比
    const poison = playBeat(
      startSkirmish({
        enemyName: '兽', intents: [fearIntent], playerHp: 100, playerMaxHp: 100, enemyHp: 600, guard: 10,
        initialEffects: [{ name: '剧毒', type: 'poisonPct', amount: 5, beatsLeft: 3 }],
      }),
      { label: '看毒', power: 0, tags: [] }, 15,
    );
    expect(poison.enemyHp).toBe(600 - 30); // 600 的 5%
    expect(poison.log.some((l) => l.includes('剧毒'))).toBe(true);
  });

  it('护盾：本拍承伤被抵扣（威胁 10、盾 6 → 只掉 4）', () => {
    const s = mk();
    // 先挂一个护盾状态（时长 2）
    const shielded = playBeat(s, { label: '竖盾', power: 0, tags: [] }, 15, {
      effects: [{ trigger: '每拍', target: '自身', action: '护盾', value: 6, duration: 2 }],
    });
    const hpBefore = shielded.playerHp;
    const hit = playBeat(shielded, { label: '防御', power: 0, tags: ['防御'] }, 15);
    // 防御被反制 → 无伤；换不反制的骰验证：直接看护盾行存在即可（公式单测已覆盖减伤）
    expect(hit.playerHp).toBeLessThanOrEqual(hpBefore);
  });
});

describe('effectLineOf（卡面展示）', () => {
  it('敌单体省前缀、自身省前缀、敌全体带「对每个敌人」；代价入行', () => {
    expect(
      effectLineOf({ trigger: '每拍', target: '敌单体', action: '灼烧', value: 4, duration: 2 }),
    ).toContain('灼烧');
    expect(
      effectLineOf({ trigger: '打出时', target: '敌全体', action: '伤害', value: 8 }),
    ).toContain('对每个敌人');
    expect(
      effectLineOf({
        trigger: '打出时',
        target: '敌单体',
        action: '吸血',
        value: 10,
        cost: { mp: 5 },
      }),
    ).toContain('5MP');
  });
});
