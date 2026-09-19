/**
 * opponent-blueprints.test.ts — 支配者倒影（S，2026-09-17）
 *
 * 「被敌人击败后，你可以复制对方的一个技能，并以此为蓝本，在制卡时创造出一张
 * 全新的技能卡。」
 *
 * 落地口径：战败时抄下敌方**威胁最高的一式**；制卡时选用蓝本 → 产物定格为技能卡
 * + 评级上浮一档；一份蓝本用一次。
 */
import { describe, it, expect } from 'vitest';
import {
  ENEMY_HOLDS,
  addBlueprint,
  blueprintCraftBonus,
  coerceBlueprints,
  consumeBlueprint,
  describeBlueprints,
  pickCopyTarget,
  threatTierOf,
} from './opponent-blueprints';
import { planCardCraft } from './card-craft-plan';
import { getTalentTemplate, hasWorkingMechanic } from './talent-entry';
import type { InventoryItem } from '../types';

describe('pickCopyTarget —— 抄哪一式', () => {
  const intents = [
    { move: '连环爪击', threat: 12, counters: ['闪避'] },
    { move: '蓄力·崩山击', threat: 18, counters: ['打断'] },
    { move: '扫尾', threat: 9, counters: ['防御'] },
  ];

  it('挑威胁最高的那一式（「崇拜把你踩在脚下的强者」= 崇拜他最强的一手）', () => {
    expect(pickCopyTarget(intents)).toEqual({ move: '蓄力·崩山击', threat: 18 });
  });

  it('威胁并列 → 取序列靠前的（确定性）', () => {
    const tied = [
      { move: '甲', threat: 10 },
      { move: '乙', threat: 10 },
    ];
    expect(pickCopyTarget(tied)?.move).toBe('甲');
  });

  it('脏数据：非数组 / 缺招式名 / 非数威胁 都不炸', () => {
    expect(pickCopyTarget(undefined)).toBeUndefined();
    expect(pickCopyTarget('x')).toBeUndefined();
    expect(pickCopyTarget([])).toBeUndefined();
    expect(pickCopyTarget([{ threat: 9 }, { move: '  ' }])).toBeUndefined();
    expect(pickCopyTarget([{ move: '拳', threat: 'x' }])).toEqual({ move: '拳', threat: 0 });
  });
});

describe('coerceBlueprints / addBlueprint / consumeBlueprint', () => {
  it('宽读：脏值逐条丢弃', () => {
    expect(coerceBlueprints('x')).toEqual([]);
    expect(
      coerceBlueprints([{ name: '拳', from: '他' }, { name: '' }, 1, { from: '无影' }]),
    ).toEqual([{ name: '拳', from: '他' }]);
  });

  it('同名不重复记（同一招抄两次没意义）', () => {
    const one = addBlueprint(undefined, { name: '崩山击', from: '岩爪兽' });
    expect(one).toHaveLength(1);
    expect(addBlueprint(one, { name: '崩山击', from: '别的兽' })).toHaveLength(1);
  });

  it('超出上限丢**最旧的**（新的更该留着）', () => {
    let list = addBlueprint(undefined, { name: '第0式', from: 'x' });
    for (let i = 1; i <= ENEMY_HOLDS; i++) {
      list = addBlueprint(list, { name: `第${i}式`, from: 'x' });
    }
    expect(list).toHaveLength(ENEMY_HOLDS);
    expect(list.some((b) => b.name === '第0式')).toBe(false);
    expect(list[list.length - 1].name).toBe(`第${ENEMY_HOLDS}式`);
  });

  it('不 mutate 入参；消耗按名移除', () => {
    const src = [
      { name: '甲', from: 'x' },
      { name: '乙', from: 'y' },
    ];
    const next = consumeBlueprint(src, '甲');
    expect(next).toEqual([{ name: '乙', from: 'y' }]);
    expect(src).toHaveLength(2);
    expect(consumeBlueprint(src, '不存在')).toHaveLength(2);
  });

  it('展示一行两种状态都给得出', () => {
    expect(describeBlueprints([])).toContain('败仗');
    expect(describeBlueprints([{ name: '崩山击', from: '岩爪兽' }])).toContain('岩爪兽');
  });

  it('威胁分档只作展示参考，不参与数值', () => {
    expect(threatTierOf(5)).toBe('白铁');
    expect(threatTierOf(18)).toBe('白银');
    expect(threatTierOf(40)).toBe('星辉');
    expect(threatTierOf(0)).toBeUndefined();
    expect(threatTierOf(undefined)).toBeUndefined();
  });
});

describe('blueprintCraftBonus —— 蓝本给什么', () => {
  it('两条：定格为技能卡 + 评级上浮一档（形态不是数值）', () => {
    const b = blueprintCraftBonus();
    expect(b.formEntry).toBe('技能');
    expect(b.ratingLift).toBe(1);
    expect(b.note).toContain('支配者倒影');
  });
});

describe('planCardCraft 用蓝本', () => {
  const 背包: InventoryItem[] = [
    { name: '赤铁矿', quantity: 1, type: '材料', rarity: '优良' } as InventoryItem,
    { name: '火晶', quantity: 1, type: '材料', rarity: '优良' } as InventoryItem,
  ];
  const base = {
    mainName: '赤铁矿',
    subNames: ['火晶'],
    intent: '照着他的招式做一张',
    inventory: 背包,
    d20: 8,
    fallbackName: '影技',
  };

  it('用了蓝本 → 产物词条含「技能」，并标记 blueprintUsed', () => {
    const r = planCardCraft({ ...base, blueprint: { name: '崩山击' } });
    expect(r.ok).toBe(true);
    expect(r.plan!.product.词条).toContain('技能');
    expect(r.plan!.blueprintUsed).toBe(true);
    expect(r.plan!.audit.join('\n')).toContain('崩山击');
  });

  it('不用蓝本 → 形态不变、blueprintUsed 为 false（零改动）', () => {
    const r = planCardCraft(base);
    expect(r.plan!.blueprintUsed).toBe(false);
    expect(r.plan!.product.词条).not.toContain('技能');
  });

  it('蓝本的上浮真的作用于评级（同骰值下不劣于不用）', () => {
    const rank = (x: string) => ['大失败', '失败', '成功', '精益求精'].indexOf(x);
    const plain = planCardCraft(base);
    const withBp = planCardCraft({ ...base, blueprint: { name: '崩山击' } });
    expect(rank(withBp.plan!.rating)).toBeGreaterThanOrEqual(rank(plain.plan!.rating));
  });

  it('蓝本不改变档位（档位仍由素材与融合内核决定）', () => {
    const plain = planCardCraft(base);
    const withBp = planCardCraft({ ...base, blueprint: { name: '崩山击' } });
    // 越阶等天赋可能改档，但蓝本本身不改——同一输入下两者档位应相同
    expect(withBp.plan!.product.cardTier).toBe(plain.plan!.product.cardTier);
  });
});

describe('支配者倒影 —— 天赋侧接线', () => {
  it('模板带「倒影」条目（含持有上限），且算已实装', () => {
    const tpl = getTalentTemplate('支配者倒影');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries).toEqual([{ kind: '倒影', channel: 'universal', params: { maxHold: 5 } }]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });
});
