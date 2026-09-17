/**
 * ss-batch3.test.ts — SS 批次③首批（2026-09-17）
 *
 * 这一批把三条「写好了但没人接」的线接上，并新增两条机制：
 *  - 战技附加实装（48 处死条目 + SS「退化射线」）
 *  - 下克上（等级差战斗加成）
 *  - 威压/体魄/判定取优/产出数量（talent-rule-modifiers 里早就写好、但一直没被调用）
 *  - 制卡师等级上限接到吞噬/拆解/融合
 */
import { describe, it, expect } from 'vitest';
import { TALENT_CATALOG, IMPLEMENTED_ENTRY_KINDS, hasWorkingMechanic } from './talent-entry';
import { getTalentTemplate } from './talent-entry';
import { cardPlayPlan, planEffects } from './entry-combat';
import { playBeat, startSkirmish } from './skirmish-session';
import { planDevour } from './card-devour';
import { planDismantle } from './card-dismantle';
import { planMultiFusion } from './card-smelt';
import { craftTierCeilingIndex } from './craft-rank';
import {
  totalCopies,
  hasBetterRoll,
  hasTitanPhysique,
  totalIntimidation,
} from './talent-rule-modifiers';
import type { CardItem } from '../types';

const 卡 = (
  name: string,
  tier: CardItem['cardTier'] = '白银',
  词条: string[] = ['火', '技能'],
  extra: Partial<CardItem> = {},
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
    cost: 100,
    rating: '成功',
  },
  ...extra,
});

// ════════════════════════════════════════════════════════════════════
// 战技附加：从死条目到真的生效
// ════════════════════════════════════════════════════════════════════

describe('战技附加 —— 死条目实装', () => {
  it('已进 IMPLEMENTED 表（抽卡池与面板标记跟着走）', () => {
    expect(IMPLEMENTED_ENTRY_KINDS.has('战技附加' as never)).toBe(true);
  });

  it('目录里带战技附加的模板现在都算「已实装」', () => {
    const withStatus = TALENT_CATALOG.filter((t) => t.entries.some((e) => e.kind === '战技附加'));
    expect(withStatus.length).toBeGreaterThan(0);
    for (const t of withStatus) {
      expect(hasWorkingMechanic(t), t.name).toBe(true);
    }
  });

  it('SS「退化射线」抽得到也用得上', () => {
    const tpl = getTalentTemplate('退化射线');
    expect(tpl?.grade).toBe('SS');
    expect(tpl!.entries.some((e) => e.kind === '战技附加' && e.params.status === '退化')).toBe(
      true,
    );
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('带战技的卡打出时多一条在场效果（直击卡也吃得到）', () => {
    const 毒刃 = 卡('毒刃', '白银', ['火', '技能'], {
      战技: { status: '中毒', power: 3, beats: 3 },
    });
    const plan = cardPlayPlan(毒刃, { atk: 40 });
    expect(plan.mode).toBe('直击');
    const fx = planEffects(plan);
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({ type: 'dot', amount: 3, beatsLeft: 3 });
  });

  it('在场卡 = 基础效果 + 战技 两条并存', () => {
    const 图腾 = 卡('图腾', '白银', ['土', '召唤'], {
      战技: { status: '眩晕', power: 0, beats: 1 },
    });
    const plan = cardPlayPlan(图腾, { atk: 40 });
    expect(plan.mode).toBe('在场');
    const fx = planEffects(plan);
    expect(fx).toHaveLength(2);
    expect(fx[0].type).toBe('buff'); // 召唤 = 此后每拍助战
    expect(fx[1].type).toBe('stun'); // 战技 = 敌方本拍放弃
  });

  it('无战技的旧卡零改动（效果数组长度不变）', () => {
    expect(planEffects(cardPlayPlan(卡('旧卡', '白银', ['土', '召唤']), { atk: 40 }))).toHaveLength(
      1,
    );
    expect(
      planEffects(cardPlayPlan(卡('旧卡2', '白银', ['火', '技能']), { atk: 40 })),
    ).toHaveLength(0);
  });

  it('会话说「战技」生效：打出带战技的卡后敌方威胁被削减', () => {
    const 开战 = () =>
      startSkirmish({
        enemyName: '岩爪兽',
        enemyLevel: 12,
        intents: [{ move: '痛击', threat: 20, counters: ['防御'] }],
        playerHp: 155,
        playerMaxHp: 155,
        enemyHp: 400,
        enemyMaxHp: 400,
        guard: 0,
      });
    const 退化刀 = 卡('退化刀', '白银', ['火', '技能'], {
      战技: { status: '退化', power: 6, beats: 2 },
    });
    const plan = cardPlayPlan(退化刀, { atk: 10 });
    if (plan.mode === '禁打') throw new Error('测试用卡不该是禁打');
    const s1 = playBeat(开战(), plan.action, 1, { activate: planEffects(plan) });
    expect(s1.log.join('\n')).toContain('战技·退化');
    expect(s1.activeEffects.some((e) => e.type === 'weaken' && e.amount === 6)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 下克上：等级差战斗加成
// ════════════════════════════════════════════════════════════════════

describe('下克上 —— 等级差加成', () => {
  it('SS「下克上」条目带档位，且算已实装', () => {
    const tpl = getTalentTemplate('下克上');
    expect(tpl?.grade).toBe('SS');
    expect(tpl!.entries).toEqual([
      { kind: '克上', channel: 'universal', params: { vsHigherLevel: 30 } },
    ]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('档位白名单只收 20/30/50（AI 零编数）', () => {
    // 由 talent-strength.test.ts 的白名单用例统一覆盖；这里只确认 kind 已登记
    expect(IMPLEMENTED_ENTRY_KINDS.has('克上' as never)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 三条「写好了没人接」的数值条目
// ════════════════════════════════════════════════════════════════════

describe('威压 / 体魄 / 判定取优 / 产出数量 —— 接线', () => {
  const 条 = (kind: string, params: Record<string, number>) => ({ entries: [{ kind, params }] });

  it('威压：percent 求和', () => {
    expect(totalIntimidation(条('威压', { percent: 30 }).entries as never)).toBe(30);
    expect(totalIntimidation(undefined)).toBe(0);
  });

  it('体魄：命中即真（量在条目 `体魄{percent}` 上）', () => {
    expect(hasTitanPhysique(条('体魄', { percent: 200 }).entries as never)).toBe(true);
    expect(hasTitanPhysique([])).toBe(false);
  });

  it('判定取优：命中即真', () => {
    expect(hasBetterRoll(条('判定取优', {}).entries as never)).toBe(true);
    expect(hasBetterRoll([])).toBe(false);
  });

  it('产出数量：copies 求和', () => {
    expect(
      totalCopies([
        ...条('产出数量', { copies: 1 }).entries,
        ...条('产出数量', { copies: 3 }).entries,
      ] as never),
    ).toBe(4);
    expect(totalCopies(undefined)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// 制卡师等级上限：吞噬 / 拆解 / 融合
// ════════════════════════════════════════════════════════════════════

describe('制卡师等级上限 —— 先前未生效的限制现在生效', () => {
  it('吞噬：燃料档位不得超过「制卡师等级 + 档位」', () => {
    const target = 卡('目标', '白铁');
    const 高燃料 = 卡('星辉料', '星辉');
    // Lv4 制卡师（+1 → 青铜上限）吞不了星辉
    const cap = craftTierCeilingIndex(4, 1);
    expect(planDevour(target, 高燃料, () => 0, cap).ok).toBe(false);
    // Lv16 制卡师（+1 → 星辉上限）吞得下
    expect(planDevour(target, 高燃料, () => 0, craftTierCeilingIndex(16, 1)).ok).toBe(true);
    // 不传上限 = 不限（旧口径，供纯函数调用方保留）
    expect(planDevour(target, 高燃料).ok).toBe(true);
  });

  it('拆解：同理按档位上限拦', () => {
    const 星辉卡 = 卡('星辉卡', '星辉');
    expect(planDismantle(星辉卡, craftTierCeilingIndex(4, 1)).ok).toBe(false);
    expect(planDismantle(星辉卡, craftTierCeilingIndex(16, 1)).ok).toBe(true);
  });

  it('融合：三张里有一张超档就拒（描述说「不高于你制卡师等级」）', () => {
    const 甲 = 卡('甲', '白铁');
    const 乙 = 卡('乙', '白铁');
    const 丙 = 卡('丙', '白铁');
    const 高 = 卡('高', '星辉');
    expect(planMultiFusion([甲, 乙, 高], () => 0, 1, craftTierCeilingIndex(4, 0)).ok).toBe(false);
    expect(planMultiFusion([甲, 乙, 丙], () => 0, 1, craftTierCeilingIndex(4, 0)).ok).toBe(true);
  });
});
