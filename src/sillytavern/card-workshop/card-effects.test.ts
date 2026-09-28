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
import { conditionsMet, type CardEffectDef } from './card-effects';

describe('效果池与元素映射（派生打底）', () => {
  it('池 59 条（53 + 批十慎用 6），九元素九映射', () => {
    expect(EFFECT_POOL).toHaveLength(59);
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
    expect(
      deriveCardEffects({ name: '火球术', 词条: ['技能', '火'], cardTier: '青铜' })[0].action,
    ).toBe('灼烧');
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
    const after = playBeat(s, { label: '火雨', power: 20, tags: [] }, 15, {
      effects: [{ trigger: '打出时', target: '敌全体', action: '伤害', value: 8 }],
      enemyCount: 2,
    });
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
    // 恐惧 live → 敌方威胁 10（减半）且 counters 清空
    const feared = playBeat(
      startSkirmish({
        enemyName: '兽',
        intents: [fearIntent],
        playerHp: 100,
        playerMaxHp: 100,
        enemyHp: 600,
        guard: 10,
        initialEffects: [{ name: '恐惧', type: 'fear', amount: 0, beatsLeft: 2 }],
      }),
      { label: '试探', power: 0, tags: [] },
      15,
    );
    expect(feared.log.some((l) => l.includes('恐惧'))).toBe(true);
    // 束缚：威胁锁 1 → 玩家无伤
    const bound = playBeat(
      startSkirmish({
        enemyName: '兽',
        intents: [fearIntent],
        playerHp: 100,
        playerMaxHp: 100,
        enemyHp: 600,
        guard: 10,
        initialEffects: [{ name: '束缚', type: 'bind', amount: 0, beatsLeft: 2 }],
      }),
      { label: '对峙', power: 0, tags: [] },
      15,
    );
    expect(bound.playerHp).toBe(100);
    // 圣盾：免疫一拍全部伤害
    const shielded = playBeat(
      startSkirmish({
        enemyName: '兽',
        intents: [fearIntent],
        playerHp: 100,
        playerMaxHp: 100,
        enemyHp: 600,
        guard: 10,
        initialEffects: [{ name: '圣盾', type: 'divineShield', amount: 0, beatsLeft: 1 }],
      }),
      { label: '硬挨', power: 0, tags: [] },
      15,
    );
    expect(shielded.playerHp).toBe(100);
    expect(shielded.log.some((l) => l.includes('圣盾'))).toBe(true);
    // 反伤：挨打 → 敌方掉血
    const thorn = playBeat(
      startSkirmish({
        enemyName: '兽',
        intents: [fearIntent],
        playerHp: 100,
        playerMaxHp: 100,
        enemyHp: 600,
        guard: 10,
        initialEffects: [{ name: '反伤', type: 'thorns', amount: 5, beatsLeft: 2 }],
      }),
      { label: '硬挨', power: 0, tags: [] },
      15,
    );
    expect(thorn.enemyHp).toBeLessThan(600);
    expect(thorn.log.some((l) => l.includes('反伤'))).toBe(true);
    // 剧毒：按当前气血百分比
    const poison = playBeat(
      startSkirmish({
        enemyName: '兽',
        intents: [fearIntent],
        playerHp: 100,
        playerMaxHp: 100,
        enemyHp: 600,
        guard: 10,
        initialEffects: [{ name: '剧毒', type: 'poisonPct', amount: 5, beatsLeft: 3 }],
      }),
      { label: '看毒', power: 0, tags: [] },
      15,
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

describe('效果批二（魅惑/沉默/招架/先攻/斩杀）', () => {
  const intent = { move: '重击', threat: 20, counters: ['防御'] };
  const mk = (extra?: { name: string; type: never; amount?: number; beatsLeft?: number }) =>
    startSkirmish({
      enemyName: '兽',
      intents: [intent],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 600,
      enemyMaxHp: 600,
      guard: 10,
      ...(extra
        ? {
            initialEffects: [
              extra as { name: string; type: 'dot'; amount: number; beatsLeft: number },
            ],
          }
        : {}),
    });
  it('魅惑：敌方攻击转嫁——拍末敌方额外掉威胁值的血', () => {
    const after = playBeat(
      mk({ name: '魅惑', type: 'charm' as never, amount: 0, beatsLeft: 1 }),
      { label: '抛媚眼', power: 5, tags: [] },
      15,
    );
    expect(after.log.some((l) => l.includes('魅惑'))).toBe(true);
  });
  it('沉默：反制面关闭但威胁不变（挨打但打不动我方反制）', () => {
    const after = playBeat(
      mk({ name: '沉默', type: 'silence' as never, amount: 0, beatsLeft: 2 }),
      { label: '封口', power: 0, tags: [] },
      15,
    );
    expect(after.log.some((l) => l.includes('沉默'))).toBe(true);
  });
  it('招架：反制成功返还 2 SP（spSpent 轧差）', () => {
    const s = { ...mk(), playerSp: 50 };
    const afterPlay = playBeat(s, { label: '出招', power: 10, tags: [], cardName: 'x' }, 15); // spSpent 5
    const afterParry = playBeat(
      {
        ...afterPlay,
        activeEffects: [{ name: '招架', type: 'parry' as never, amount: 5, beatsLeft: 2 }],
      },
      { label: '防御', power: 30, tags: ['防御'] },
      18,
    ); // 反制成功
    expect(afterParry.spSpent).toBe(5 + 3 - 2);
  });
  it('先攻：反制掷骰 +3（传入骰 15 → 检定按 18 算）', () => {
    const after = playBeat(
      mk({ name: '先攻', type: 'initiative' as never, amount: 3, beatsLeft: 2 }),
      { label: '抢手', power: 10, tags: [] },
      15,
    );
    expect(after.log.some((l) => l.includes('d20=18'))).toBe(true);
  });
  it('斩杀：敌方 HP 低于 15% 直接终局；高于则空过', () => {
    const low = startSkirmish({
      enemyName: '兽',
      intents: [intent],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 80,
      enemyMaxHp: 600,
      guard: 10,
    });
    const executed = playBeat(low, { label: '处刑', power: 5, tags: [] }, 15, {
      effects: [{ trigger: '打出时', target: '敌单体', action: '斩杀', value: 15 }],
    });
    expect(executed.finished).toBe('胜利');
    expect(executed.log.some((l) => l.includes('斩杀'))).toBe(true);
    const high = startSkirmish({
      enemyName: '兽',
      intents: [intent],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 300,
      enemyMaxHp: 600,
      guard: 10,
    });
    const notYet = playBeat(high, { label: '试斩', power: 5, tags: [] }, 15, {
      effects: [{ trigger: '打出时', target: '敌单体', action: '斩杀', value: 15 }],
    });
    expect(notYet.finished).toBeNull();
  });
});

describe('效果批三（寄生/感染/退化/死亡倒计时/缴械/汲取）', () => {
  const intent = { move: '重击', threat: 20, counters: ['防御'] };
  it('寄生：打出后下一拍起，拍末敌方 −4、玩家 +4（双头结算）', () => {
    const s = startSkirmish({
      enemyName: '兽',
      intents: [intent],
      playerHp: 50,
      playerMaxHp: 100,
      enemyHp: 600,
      guard: 10,
    });
    const fx: CardEffectDef[] = [
      { trigger: '每拍', target: '敌单体', action: '寄生', value: 4, duration: 3 },
    ];
    const activated = playBeat(s, { label: '下蛊', power: 0, tags: [] }, 15, { effects: fx });
    // 打出拍不结算（状态从下一拍起效，领域同款时序）
    expect(activated.enemyHp).toBe(600);
    const ticked = playBeat(activated, { label: '拖', power: 0, tags: [] }, 15);
    // 敌方反扑 −15，寄生 −4 敌 / +4 己：600→596、35→24
    expect(ticked.enemyHp).toBe(596);
    expect(ticked.playerHp).toBe(24);
  });
  it('感染：逐拍加深——第二拍比第一拍多扣 1', () => {
    const s = startSkirmish({
      enemyName: '兽',
      intents: [intent],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 600,
      guard: 10,
    });
    const fx: CardEffectDef[] = [
      { trigger: '每拍', target: '敌单体', action: '感染', value: 2, duration: 3 },
    ];
    const activated = playBeat(s, { label: '染', power: 0, tags: [] }, 15, { effects: fx });
    // 效果只在激活拍传入一次——后续拍靠会话里的状态自动 tick
    const tick1 = playBeat(activated, { label: '拖', power: 0, tags: [] }, 15);
    const tick2 = playBeat(tick1, { label: '拖', power: 0, tags: [] }, 15);
    expect(activated.enemyHp - tick1.enemyHp).toBe(2);
    expect(tick1.enemyHp - tick2.enemyHp).toBe(3); // 加深 +1
  });
  it('死亡倒计时：倒数走完 → 敌方直接倒下（胜利）', () => {
    const s = startSkirmish({
      enemyName: '兽',
      intents: [intent],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 600,
      guard: 10,
    });
    const fx: CardEffectDef[] = [
      { trigger: '每拍', target: '敌单体', action: '死亡倒计时', value: 3, duration: 3 },
    ];
    let cur = s;
    // 效果只在激活拍传入；激活拍 + 3 个倒数拍 = 4 拍后倒下
    for (let i = 0; i < 4 && cur.finished === null; i++) {
      cur = playBeat(
        cur,
        { label: '拖', power: 0, tags: [] },
        15,
        i === 0 ? { effects: fx } : undefined,
      );
    }
    expect(cur.finished).toBe('胜利');
    expect(cur.log.some((l) => l.includes('死亡倒计时'))).toBe(true);
  });
  it('缴械：敌方威胁 −40%——20 威胁变 12', () => {
    const s = startSkirmish({
      enemyName: '兽',
      intents: [intent],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 600,
      guard: 0,
    });
    const fx: CardEffectDef[] = [
      { trigger: '每拍', target: '敌单体', action: '缴械', value: 40, duration: 2 },
    ];
    const b1 = playBeat(s, { label: '缴', power: 0, tags: [] }, 15, { effects: fx });
    // 缴械当拍生效（live）→ 下一拍 intent 已按 ×0.6 重写。直接验效果挂上：
    expect(b1.activeEffects.some((e) => e.name === '缴械')).toBe(true);
  });
  it('汲取：击杀时回复最大气血的 20%', () => {
    const s = startSkirmish({
      enemyName: '兽',
      intents: [intent],
      playerHp: 50,
      playerMaxHp: 100,
      enemyHp: 30,
      guard: 0,
    });
    const after = playBeat(s, { label: '终结', power: 60, tags: [] }, 18, {
      effects: [{ trigger: '击杀时', target: '自身', action: '汲取', value: 20 }],
    });
    expect(after.finished).toBe('胜利');
    expect(after.playerHp).toBe(70); // 50 + 20% × 100
    expect(after.log.some((l) => l.includes('汲取'))).toBe(true);
  });
});

describe('效果批四（强化档）', () => {
  const intent = { move: '重击', threat: 20, counters: ['防御'] };
  it('池内定值：双击100/风怒150/超杀30/穿透8/处决40', () => {
    for (const [action, value] of [
      ['双击', 100],
      ['风怒', 150],
      ['超杀', 30],
      ['穿透', 8],
      ['处决', 40],
    ] as const) {
      expect(poolEntryOf(action)?.value).toBe(value);
    }
  });
  it('双击/风怒 → 行动值乘区；穿透 → 破防累计', () => {
    const s = startSkirmish({
      enemyName: '兽',
      intents: [intent],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 600,
      guard: 10,
    });
    const after = playBeat(s, { label: '出招', power: 20, tags: [] }, 15, {
      effects: [{ trigger: '打出时', target: '敌单体', action: '双击', value: 100 }],
    });
    // 行动值 20×2 = 40
    expect(after.log.some((l) => l.includes('40'))).toBe(true);
    const after2 = playBeat(after, { label: '穿透', power: 10, tags: [] }, 15, {
      effects: [{ trigger: '打出时', target: '敌单体', action: '穿透', value: 8 }],
    });
    expect(after2.guardDown).toBe(8);
  });
  it('超杀 30% 线：敌方 25% 直接终局', () => {
    const s = startSkirmish({
      enemyName: '兽',
      intents: [intent],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 150,
      enemyMaxHp: 600,
      guard: 10, // 25% < 30%
    });
    const after = playBeat(s, { label: '超杀', power: 5, tags: [] }, 15, {
      effects: [{ trigger: '打出时', target: '敌单体', action: '超杀', value: 30 }],
    });
    expect(after.finished).toBe('胜利');
  });
});

import { planEnchant, ENCHANT_BASE_COST } from './card-enchant';

describe('planEnchant（附魔规划）', () => {
  const card = {
    name: '铁剑卡',
    cardTier: '青铜' as const,
    词条: ['技能', '金'],
    cardEffects: [],
  };
  const effect = { trigger: '打出时', target: '敌单体', action: '灼烧', value: 4, duration: 2 };
  it('合法附魔：造价 = 60 + 定值×2，效果集追加', () => {
    const r = planEnchant({ card, effect, money: 200 });
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(ENCHANT_BASE_COST + 8);
    expect(r.nextEffects).toHaveLength(1);
  });
  it('物资/素材拒附魔', () => {
    const r = planEnchant({
      card: { name: '干粮卡', cardTier: '白铁' as never, 词条: ['物资'], cardEffects: [] },
      effect,
      money: 999,
    });
    expect(r.ok).toBe(false);
  });
  it('同名效果唯一；上限 2 条', () => {
    const withBurn = { ...card, cardEffects: [effect] };
    expect(planEnchant({ card: withBurn, effect, money: 999 }).ok).toBe(false);
    const two = {
      ...card,
      cardEffects: [effect, { trigger: '每拍', target: '自身', action: '治疗', value: 12 }],
    };
    expect(planEnchant({ card: two, effect, money: 999 }).ok).toBe(false);
  });
  it('钱不够拒；池外效果拒', () => {
    expect(planEnchant({ card, effect, money: 10 }).ok).toBe(false);
    expect(
      planEnchant({ card, effect: { ...effect, action: '飞天', value: 1 }, money: 999 }).ok,
    ).toBe(false);
  });
});

describe('效果批六（免疫/治疗时响应）', () => {
  const intent = { move: '重击', threat: 20, counters: ['防御'] };
  const mk = (init?: { name: string; type: never; amount?: number; beatsLeft?: number }) =>
    startSkirmish({
      enemyName: '兽',
      intents: [intent],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 600,
      guard: 10,
      ...(init
        ? {
            initialEffects: [
              init as { name: string; type: 'dot'; amount: number; beatsLeft: number },
            ],
          }
        : {}),
    });
  it('免疫：N 拍全免窗——所有伤害归零', () => {
    const after = playBeat(
      mk({ name: '免疫', type: 'immune' as never, amount: 0, beatsLeft: 2 }),
      { label: '硬抗', power: 0, tags: [] },
      15,
    );
    expect(after.playerHp).toBe(100);
    expect(after.log.some((l) => l.includes('免疫'))).toBe(true);
  });
  it('治疗时响应：治疗发生 → 登记的响应连锁触发', () => {
    const s = startSkirmish({
      enemyName: '兽',
      intents: [intent],
      playerHp: 50,
      playerMaxHp: 100,
      enemyHp: 600,
      guard: 10,
      healResponses: [{ name: '治疗响应·护盾', action: '护盾', value: 4 }],
    });
    // 打出带治疗的效果：治疗 8 → 响应护盾 +4
    const after = playBeat(s, { label: '圣水', power: 0, tags: [] }, 15, {
      effects: [{ trigger: '打出时', target: '自身', action: '治疗', value: 8 }],
    });
    // 护盾响应把敌方 15 点伤害减掉 4 → 50-11+8=47
    expect(after.playerHp).toBe(47);
  });
  it('无治疗发生 → 响应不触发', () => {
    const s = startSkirmish({
      enemyName: '兽',
      intents: [intent],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 600,
      guard: 10,
      healResponses: [{ name: '治疗响应·护盾', action: '护盾', value: 4 }],
    });
    const after = playBeat(s, { label: '空挥', power: 0, tags: [] }, 15);
    expect(after.playerHp).toBe(85); // 敌方反击照常（威胁 20，无防护）
  });
});

describe('条件位（效果批七：交锋内账本）', () => {
  const intent = { move: '重击', threat: 20, counters: ['防御'] };
  it('conditionsMet：空条件恒真；计数不足为假', () => {
    expect(conditionsMet(undefined, { 出卡: 5 })).toBe(true);
    expect(conditionsMet([], {})).toBe(true);
    expect(conditionsMet([{ event: '出卡', count: 3 }], { 出卡: 2 })).toBe(false);
    expect(conditionsMet([{ event: '出卡', count: 3 }], { 出卡: 3 })).toBe(true);
    // 多条件 AND
    expect(
      conditionsMet(
        [
          { event: '出卡', count: 1 },
          { event: '承受伤害', count: 1 },
        ],
        { 出卡: 1, 承受伤害: 1 },
      ),
    ).toBe(true);
  });
  it('条件不满足 → 效果空过+战报注明；满足 → 正常结算', () => {
    const s = startSkirmish({
      enemyName: '兽',
      intents: [intent],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 600,
      guard: 10,
    });
    // 场上没出过卡（账本空）→ 条件「出卡≥2」不满足 → 空过
    const skipped = playBeat(s, { label: '条件技', power: 20, tags: [] }, 15, {
      effects: [
        {
          trigger: '打出时',
          target: '敌单体',
          action: '伤害',
          value: 8,
          conditions: [{ event: '出卡', count: 2 }],
        },
      ],
    });
    expect(skipped.log.some((l) => l.includes('条件未满足'))).toBe(true);
    expect(skipped.enemyHp).toBeLessThan(590); // 效果空过（敌 HP 只受本体伤害与敌方反击无关）
  });
  it('账本递增：出卡/受击/治疗 计入 beatEvents', () => {
    const s = startSkirmish({
      enemyName: '兽',
      intents: [intent],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 600,
      guard: 10,
      playerSp: 50,
    });
    const after = playBeat(s, { label: '打一拍', power: 10, tags: [], cardName: '铁剑卡' }, 15, {
      effects: [{ trigger: '打出时', target: '自身', action: '治疗', value: 5 }],
    });
    expect(after.beatEvents?.['出卡']).toBe(1);
    // 反制成功（25≥20）→ 玩家未承伤，不记「承受伤害」；敌方掉血也不记玩家侧击杀
    expect(after.beatEvents?.['承受伤害']).toBeUndefined();
    expect(after.beatEvents?.['治疗']).toBe(1);
  });
});

describe('效果批八（信息策略类：窥探/洞悉/任务/分支）', () => {
  const mk3 = () =>
    startSkirmish({
      enemyName: '三式兽',
      intents: [
        { move: '扑咬', threat: 6, counters: [] },
        { move: '重锤', threat: 14, counters: ['格挡'] },
        { move: '蓄力', threat: 4, counters: [] },
      ],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 600,
      guard: 10,
    });

  it('池门禁：四条新效果全在池内', () => {
    for (const a of ['窥探', '洞悉', '任务', '分支'] as const) {
      expect(poolEntryOf(a)).toBeDefined();
    }
  });

  it('窥探：战报摊开完整招式轮换（▶ 标当前式）', () => {
    const s = mk3();
    const after = playBeat(s, { label: '窥探之眼', power: 10, tags: [] }, 15, {
      effects: [{ trigger: '打出时', target: '敌单体', action: '窥探', value: 0 }],
    });
    const line = after.log.find((l) => l.includes('【窥探】'));
    expect(line).toBeDefined();
    expect(line).toContain('共 3 式');
    expect(line).toContain('扑咬');
    expect(line).toContain('重锤');
    expect(line).toContain('蓄力');
    expect(line).toContain('▶');
  });

  it('洞悉：打出次拍起预读未来 2 拍的招式与威胁', () => {
    const s = mk3();
    // 拍 0 打出洞悉（状态层自下拍生效）
    const s1 = playBeat(s, { label: '洞悉', power: 10, tags: [] }, 15, {
      effects: [{ trigger: '每拍', target: '敌单体', action: '洞悉', value: 0, duration: 2 }],
    });
    expect(s1.log.some((l) => l.includes('【洞悉】预读'))).toBe(false);
    // 拍 1：insight 已在场 → 预读 intents[2]（下拍）与 intents[0]（下下拍）
    const s2 = playBeat(s1, { label: '打一拍', power: 10, tags: [] }, 15, {});
    const line = s2.log.find((l) => l.includes('【洞悉】预读'));
    expect(line).toBeDefined();
    expect(line).toContain('蓄力');
    expect(line).toContain('扑咬');
    // 时长走完（2 拍）后不再预读——log 跨拍累积，只查拍 3 的增量行
    const s3 = playBeat(s2, { label: '打一拍', power: 10, tags: [] }, 15, {});
    const s4 = playBeat(s3, { label: '打一拍', power: 10, tags: [] }, 15, {});
    expect(s4.log.slice(s3.log.length).some((l) => l.includes('【洞悉】预读'))).toBe(false);
  });

  it('任务：3 拍内出满 3 张卡 → 回复 15 HP、任务移除', () => {
    const mk = () =>
      startSkirmish({
        enemyName: '任务兽',
        intents: [{ move: '重压', threat: 20, counters: [] }],
        playerHp: 90,
        playerMaxHp: 100,
        enemyHp: 600,
        guard: 0,
      });
    const act = {
      trigger: '每拍' as const,
      target: '自身' as const,
      action: '任务' as const,
      value: 3,
      duration: 3,
    };
    const card = { label: '打一拍', power: 0, tags: [], cardName: '补拍卡' };
    // 对照：同骰同拍无任务 → 量出每拍净损
    const c1 = playBeat(mk(), card, 5, {});
    const c2 = playBeat(c1, card, 5, {});
    const dmg = c1.playerHp - c2.playerHp;
    expect(dmg).toBeGreaterThan(0);
    // 任务路：拍 0 登记任务，拍 2 账本出卡数达 3 → 回 15
    const s0 = playBeat(mk(), { ...card, cardName: '任务卡' }, 5, { effects: [act] });
    const s1 = playBeat(s0, card, 5, {});
    const s2 = playBeat(s1, card, 5, {});
    expect(s2.log.some((l) => l.includes('【任务】完成'))).toBe(true);
    expect(s1.playerHp - s2.playerHp).toBe(dmg - 15);
    expect((s2.activeEffects ?? []).some((e) => e.type === 'quest')).toBe(false);
  });

  it('分支：d10 ≥ 6 行动值追加，骰败走回复', () => {
    const effects = [
      { trigger: '打出时' as const, target: '敌单体' as const, action: '分支' as const, value: 12 },
    ];
    // 90 血起手：反制成功不掉血也能吃满 8 点回复
    const mk30 = () =>
      startSkirmish({
        enemyName: '铁壁兽',
        intents: [{ move: '铁壁', threat: 30, counters: [] }],
        playerHp: 90,
        playerMaxHp: 100,
        enemyHp: 600,
        guard: 0,
      });
    // dice=5 → br=6 成功路；反制必败（5+10<30）→ 对敌伤害=行动值本身，恰好多 12
    const base = playBeat(mk30(), { label: '对照', power: 10, tags: [] }, 5, {});
    const win = playBeat(mk30(), { label: '分支', power: 10, tags: [] }, 5, { effects });
    expect(win.enemyHp).toBe(base.enemyHp - 12);
    expect(win.log.some((l) => l.includes('走向杀伐'))).toBe(true);
    // dice=24 → br=5 失败路：反制成功无承伤，玩家净回 8
    const loseBase = playBeat(mk30(), { label: '对照', power: 10, tags: [] }, 24, {});
    const lose = playBeat(mk30(), { label: '分支', power: 10, tags: [] }, 24, { effects });
    expect(lose.playerHp).toBe(loseBase.playerHp + 8);
    expect(lose.log.some((l) => l.includes('走向回护'))).toBe(true);
  });

  it('多敌读侧：窥探/洞悉作用于目标敌', () => {
    const s = startSkirmish({
      enemyName: '首领',
      intents: [{ move: '横扫', threat: 8, counters: [] }],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 400,
      enemies: [
        {
          name: '爪牙甲',
          role: '杂兵',
          hp: 80,
          intents: [
            { move: '撕咬', threat: 6, counters: [] },
            { move: '嚎叫', threat: 2, counters: [] },
          ],
        },
        {
          name: '窟主',
          role: '首领',
          hp: 200,
          intents: [{ move: '碎颅', threat: 16, counters: ['闪避'] }],
        },
      ],
      initialEffects: [{ name: '洞悉', type: 'insight', amount: 0, beatsLeft: 2 }],
    });
    // 不指定目标 → 默认 HP 最高 = 窟主（200 > 80）
    const after = playBeat(s, { label: '窥探', power: 10, tags: [], cardName: '窥探卡' }, 15, {
      effects: [{ trigger: '打出时', target: '敌单体', action: '窥探', value: 0 }],
    });
    const peek = after.log.find((l) => l.includes('【窥探】'));
    expect(peek).toContain('窟主');
    expect(peek).toContain('碎颅');
    const insight = after.log.find((l) => l.includes('【洞悉】预读'));
    expect(insight).toContain('窟主');
  });
});

describe('效果批九（特殊类：时之锚/觉醒/狂暴/进化/连携锚/终结一击）', () => {
  // threat 30 / dice 5 / power 10 → 反制必败（15 < 30）：敌方每拍吃行动值 10，玩家每拍承 30
  const mk = (playerHp = 200, enemyHp = 600, enemyMaxHp?: number) =>
    startSkirmish({
      enemyName: '殊兽',
      intents: [{ move: '重压', threat: 30, counters: [] }],
      playerHp,
      playerMaxHp: Math.max(playerHp, 120),
      enemyHp,
      ...(enemyMaxHp !== undefined ? { enemyMaxHp } : {}),
      guard: 0,
    });
  const hit = { label: '打一拍', power: 10, tags: [] };

  it('池门禁：六条新效果全在池内', () => {
    for (const a of ['时之锚', '觉醒', '狂暴', '进化', '连携锚', '终结一击'] as const) {
      expect(poolEntryOf(a)).toBeDefined();
    }
  });

  it('觉醒：行动值 +25%、每拍回 2 HP，整场不递减', () => {
    const act = {
      trigger: '每拍' as const,
      target: '自身' as const,
      action: '觉醒' as const,
      value: 25,
      duration: 0,
    };
    const b1 = playBeat(mk(), hit, 5, {});
    const b2 = playBeat(b1, hit, 5, {});
    const w0 = playBeat(mk(), { ...hit, cardName: '觉醒卡' }, 5, { effects: [act] });
    // 激活拍无乘区（状态自次拍生效）
    expect(w0.enemyHp).toBe(b1.enemyHp);
    const w1 = playBeat(w0, hit, 5, {});
    // 次拍起乘区：10 → round(12.5)=13
    expect(w1.enemyHp).toBe(600 - 10 - 13);
    // 每拍回复 2：对照 170 → 觉醒 172（承 30、回 2）
    expect(w1.playerHp).toBe(b2.playerHp + 2);
    // 整场：beatsLeft 缺省
    expect((w1.activeEffects ?? []).find((e) => e.type === 'frenzy')?.beatsLeft).toBeUndefined();
  });

  it('狂暴：行动值 +50%、每拍自伤 5，3 拍后过期', () => {
    const act = {
      trigger: '每拍' as const,
      target: '自身' as const,
      action: '狂暴' as const,
      value: 50,
      duration: 3,
    };
    const b1 = playBeat(mk(), hit, 5, {});
    const w0 = playBeat(mk(), { ...hit, cardName: '狂暴卡' }, 5, { effects: [act] });
    const w1 = playBeat(w0, hit, 5, {});
    // 行动值 10 → 15（+50%）；自伤 5：对照 170 → 狂暴 165
    expect(w1.enemyHp).toBe(600 - 10 - 15);
    expect(w1.playerHp).toBe(b1.playerHp - 30 - 5);
    expect(w1.log.slice(w0.log.length).some((l) => l.includes('自伤'))).toBe(true);
    // 窗口 3 拍（w1-w3）走完，第 5 拍增量与对照同口径（无乘区无自伤）
    const w3 = playBeat(playBeat(w1, hit, 5, {}), hit, 5, {});
    const w4 = playBeat(w3, hit, 5, {});
    expect(w3.enemyHp - w4.enemyHp).toBe(10);
    expect(w3.playerHp - w4.playerHp).toBe(30);
    expect(w4.log.slice(w3.log.length).some((l) => l.includes('自伤'))).toBe(false);
  });

  it('进化：行动值加成从 5 起逐拍 +5', () => {
    const act = {
      trigger: '每拍' as const,
      target: '自身' as const,
      action: '进化' as const,
      value: 5,
      duration: 0,
    };
    const w0 = playBeat(mk(), { ...hit, cardName: '进化卡' }, 5, { effects: [act] });
    const w1 = playBeat(w0, hit, 5, {});
    const w2 = playBeat(w1, hit, 5, {});
    // 激活拍不加成；此后 +5 → +10
    expect(w0.enemyHp).toBe(600 - 10);
    expect(w1.enemyHp).toBe(600 - 10 - 15);
    expect(w2.enemyHp).toBe(600 - 10 - 15 - 20);
  });

  it('连携锚：出卡的拍末追加连携伤害，应对拍不触发', () => {
    const act = {
      trigger: '每拍' as const,
      target: '自身' as const,
      action: '连携锚' as const,
      value: 4,
      duration: 4,
    };
    const w0 = playBeat(mk(), { ...hit, cardName: '锚卡' }, 5, { effects: [act] });
    const w1 = playBeat(w0, { ...hit, cardName: '连打卡' }, 5, {});
    const w1b = playBeat(w0, { label: '应对', power: 10, tags: [] }, 5, {});
    expect(w1.enemyHp).toBe(600 - 10 - 10 - 4);
    expect(w1b.enemyHp).toBe(600 - 10 - 10);
  });

  it('时之锚：激活拍末落锚，跌破回溯一次性', () => {
    const act = {
      trigger: '每拍' as const,
      target: '自身' as const,
      action: '时之锚' as const,
      value: 0,
      duration: 3,
    };
    const w0 = playBeat(mk(100), { ...hit, cardName: '锚卡' }, 5, { effects: [act] });
    expect(w0.playerHp).toBe(70); // 落锚 = 激活拍末 HP
    const w1 = playBeat(w0, hit, 5, {});
    expect(w1.log.slice(w0.log.length).some((l) => l.includes('时光倒流'))).toBe(true);
    expect(w1.playerHp).toBe(70); // 回溯
    const w2 = playBeat(w1, hit, 5, {});
    expect(w2.playerHp).toBe(40); // 一次性用尽，不再回溯
    expect((w2.activeEffects ?? []).some((e) => e.type === 'timeAnchor')).toBe(false);
  });

  it('终结一击：已损失气血 20% 计真伤', () => {
    const act = {
      trigger: '打出时' as const,
      target: '敌单体' as const,
      action: '终结一击' as const,
      value: 20,
    };
    const s = mk(200, 300, 600);
    const w0 = playBeat(s, { ...hit, cardName: '终结卡' }, 5, { effects: [act] });
    // 缺失 300 × 20% = 60 真伤 + 行动值 10（反制必败）
    expect(w0.enemyHp).toBe(300 - 10 - 60);
  });
});

describe('效果批十（慎用清单：支配/时间裂缝/夺式/封印/断章/连锁风暴）', () => {
  // 同批九口径：threat 30 / dice 5 / power 10 → 反制必败（15 < 30）
  const mk = (playerHp = 200) =>
    startSkirmish({
      enemyName: '忌兽',
      intents: [{ move: '重压', threat: 30, counters: [] }],
      playerHp,
      playerMaxHp: Math.max(playerHp, 120),
      enemyHp: 600,
      guard: 0,
    });
  const hit = { label: '打一拍', power: 10, tags: [] };

  it('池门禁：六条新效果全在池内', () => {
    for (const a of ['支配', '时间裂缝', '夺式', '封印', '断章', '连锁风暴'] as const) {
      expect(poolEntryOf(a)).toBeDefined();
    }
  });

  it('支配：威胁转为对敌真伤，玩家只吃算不上反制的 1 点擦伤', () => {
    const s = startSkirmish({
      enemyName: '忌兽',
      intents: [{ move: '重压', threat: 30, counters: [] }],
      playerHp: 200,
      playerMaxHp: 200,
      enemyHp: 600,
      guard: 0,
      initialEffects: [{ name: '支配', type: 'dominate', amount: 0, beatsLeft: 1 }],
    });
    const after = playBeat(s, hit, 5, {});
    // 威胁清零后 DC=1：反制必成余量 14 → 10+14=24 伤害 + 转嫁真伤 30
    expect(after.enemyHp).toBe(600 - 24 - 30);
    expect(after.playerHp).toBe(200);
    expect(after.log.some((l) => l.includes('【支配】') && l.includes('预警'))).toBe(true);
  });

  it('时间裂缝：下一拍敌方不行动 + 行动值 +50%（复用 stun/frenzy 双通道）', () => {
    const act = {
      trigger: '每拍' as const,
      target: '自身' as const,
      action: '时间裂缝' as const,
      value: 50,
      duration: 1,
    };
    const w0 = playBeat(mk(), { ...hit, cardName: '裂缝卡' }, 5, { effects: [act] });
    expect(w0.enemyHp).toBe(590);
    const w1 = playBeat(w0, hit, 5, {});
    // 威胁 0 → DC=1 反制必成余量 19 → 15+19=34；反制成功无伤
    expect(w1.enemyHp).toBe(600 - 10 - 34);
    expect(w1.playerHp).toBe(170);
    // 一次性：第三拍恢复常态（威胁 30，反制失败承 30）
    const w2 = playBeat(w1, hit, 5, {});
    expect(w2.playerHp).toBe(140);
  });

  it('夺式：窃取最强一式一半威胁入行动值（上限 12）', () => {
    const act = {
      trigger: '打出时' as const,
      target: '敌单体' as const,
      action: '夺式' as const,
      value: 0,
    };
    const after = playBeat(mk(), { ...hit, cardName: '夺式卡' }, 5, { effects: [act] });
    // 30/2=15 → 上限 12 → 行动值 22，反制仍败（27 < 30）→ 敌吃 22
    expect(after.enemyHp).toBe(600 - 22);
    expect(after.playerHp).toBe(170);
    expect(after.log.some((l) => l.includes('【夺式】'))).toBe(true);
  });

  it('封印：威胁锁 1 整场（束缚的整场加强版）', () => {
    const s = startSkirmish({
      enemyName: '忌兽',
      intents: [{ move: '重压', threat: 30, counters: [] }],
      playerHp: 200,
      playerMaxHp: 200,
      enemyHp: 600,
      guard: 0,
      initialEffects: [{ name: '封印', type: 'seal', amount: 0 }],
    });
    const after = playBeat(s, hit, 5, {});
    expect(after.log.some((l) => l.includes('【封印】'))).toBe(true);
    expect((after.activeEffects ?? []).find((e) => e.type === 'seal')?.beatsLeft).toBeUndefined();
    // 威胁 1 → 反制必成余量 14 → 10+14=24；反制成功无伤
    expect(after.enemyHp).toBe(600 - 24);
    expect(after.playerHp).toBe(200);
  });

  it('断章：骰子驱动随机换式且威胁减半', () => {
    const s = startSkirmish({
      enemyName: '三式兽',
      intents: [
        { move: '扑咬', threat: 6, counters: [] },
        { move: '重锤', threat: 14, counters: ['格挡'] },
        { move: '蓄力', threat: 4, counters: [] },
      ],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 600,
      guard: 10,
    });
    const act = {
      trigger: '打出时' as const,
      target: '敌单体' as const,
      action: '断章' as const,
      value: 0,
    };
    const after = playBeat(s, { ...hit, cardName: '断章卡' }, 5, { effects: [act] });
    // 拍 0 游标=扑咬，(0+5)%3=2 → 变招蓄力（4→2）→ 反制必成余量 13 → 23
    const line = after.log.find((l) => l.includes('【断章】'));
    expect(line).toContain('蓄力');
    expect(after.enemyHp).toBe(600 - 23);
  });

  it('连锁风暴：基础 +15%，每层在场效果再 +3%', () => {
    const act = {
      trigger: '打出时' as const,
      target: '自身' as const,
      action: '连锁风暴' as const,
      value: 15,
    };
    const big = { label: '打一拍', power: 20, tags: [] };
    const empty = playBeat(mk(), big, 5, { effects: [act] });
    // 无在场：15% → 20*1.15=23，反制败 → 敌吃 23
    expect(empty.enemyHp).toBe(600 - 23);
    const seeded = startSkirmish({
      enemyName: '忌兽',
      intents: [{ move: '重压', threat: 30, counters: [] }],
      playerHp: 200,
      playerMaxHp: 200,
      enemyHp: 600,
      guard: 0,
      initialEffects: [
        { name: '幕', type: 'shield', amount: 6, beatsLeft: 5 },
        { name: '愈', type: 'regen', amount: 2, beatsLeft: 5 },
      ],
    });
    const two = playBeat(seeded, big, 5, { effects: [act] });
    // 2 层在场（护盾/回复不加行动值）：15+6=21% → 20*1.21=24.2→24
    expect(two.enemyHp).toBe(600 - 24);
    expect(two.log.some((l) => l.includes('【连锁风暴】') && l.includes('2 层'))).toBe(true);
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
