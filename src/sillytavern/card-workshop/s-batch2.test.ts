/**
 * s-batch2.test.ts — 败犬烙印 + S 近似复用四条（2026-09-17）
 *
 * 三件事：
 * 1. 累计计数原语（daily-ledger 的 counters 段）——**不随天失效**，与 daily 段只差这一点。
 * 2. 败犬烙印：战败累计、制卡烧一枚把评级上浮两档。
 * 3. S 的「近似复用、需一点小改」四条：无垢仙体 / 痛苦阶梯 / 不等价交换（雌雄双煞另议）。
 */
import { describe, it, expect } from 'vitest';
import { addCounter, coerceCounters, counterOf, spendCounter } from './daily-ledger';
import { planUnequalExchange } from './unequal-exchange';
import { getTalentTemplate, hasWorkingMechanic, TALENT_CATALOG } from './talent-entry';
import { materialNameOf } from './card-dismantle';
import type { CardCatalogItem } from '../start-catalog-mechanics';

// ════════════════════════════════════════════════════════════════════
// 累计计数原语
// ════════════════════════════════════════════════════════════════════

describe('coerceCounters —— 宽松读入', () => {
  it('正常表原样通过；非对象 → 空', () => {
    expect(coerceCounters({ 败犬烙印: 3 })).toEqual({ 败犬烙印: 3 });
    for (const raw of [undefined, null, 0, 'x', [], true]) {
      expect(coerceCounters(raw)).toEqual({});
    }
  });

  it('脏值逐条丢弃；负数/小数归一', () => {
    expect(coerceCounters({ 好: 2, 非数: 'x', 负数: -5, 小数: 3.7 })).toEqual({
      好: 2,
      负数: 0,
      小数: 3,
    });
  });
});

describe('counterOf / addCounter / spendCounter', () => {
  it('缺省 0；累加不 mutate 入参', () => {
    expect(counterOf(undefined, 'k')).toBe(0);
    const src = { k: 2 };
    const next = addCounter(src, 'k', 1);
    expect(src).toEqual({ k: 2 });
    expect(next.k).toBe(3);
  });

  it('**不随天失效**——这就是与 daily 段的全部区别', () => {
    // daily 段：记 day，跨天归零；counter 段：只累加，明天照样在
    const counters = addCounter(undefined, '败犬烙印', 3);
    expect(counterOf(counters, '败犬烙印')).toBe(3);
    // 没有 today 参数可传——计数与时间无关
    expect(addCounter(counters, '败犬烙印', 1)).toEqual({ 败犬烙印: 4 });
  });

  it('减到 0 就停（不会变负数）', () => {
    expect(addCounter({ k: 1 }, 'k', -5)).toEqual({ k: 0 });
  });

  it('spendCounter：够则扣、不够则原样返回 + reason', () => {
    const have = { 败犬烙印: 2 };
    const ok = spendCounter(have, '败犬烙印', 1, '败犬烙印');
    expect(ok.ok).toBe(true);
    expect(ok.left).toBe(1);
    expect(have).toEqual({ 败犬烙印: 2 }); // 未 mutate

    const 不够 = spendCounter({ 败犬烙印: 0 }, '败犬烙印', 1, '败犬烙印');
    expect(不够.ok).toBe(false);
    expect(不够.reason).toContain('败犬烙印');
    expect(不够.left).toBe(0);
  });

  it('amount 缺省 1、非法值按 1', () => {
    expect(spendCounter({ k: 1 }, 'k').ok).toBe(true);
    expect(spendCounter({ k: 2 }, 'k', 0).ok).toBe(true);
    expect(spendCounter({ k: 2 }, 'k', NaN).left).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════
// 败犬烙印（SS）
// ════════════════════════════════════════════════════════════════════

describe('败犬烙印 —— 天赋侧接线', () => {
  it('模板带「烙印」条目（含持有上限档位），且算已实装', () => {
    const tpl = getTalentTemplate('败犬烙印');
    expect(tpl?.grade).toBe('SS');
    expect(tpl!.entries).toEqual([{ kind: '烙印', channel: 'universal', params: { maxHold: 9 } }]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('持有上限进了白名单（AI 零编数）', () => {
    expect(TALENT_CATALOG.find((t) => t.name === '败犬烙印')!.entries[0].params.maxHold).toBe(9);
  });
});

// ════════════════════════════════════════════════════════════════════
// S 近似复用四条
// ════════════════════════════════════════════════════════════════════

describe('S 近似复用 —— 无垢仙体 / 痛苦阶梯 / 不等价交换', () => {
  it('无垢仙体（东方）→ 复用剥离通道（净化 = 剥夺词条）', () => {
    const tpl = getTalentTemplate('无垢仙体（东方）');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries.map((e) => e.kind)).toEqual(['剥离']);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('痛苦阶梯 → 复用自我进化通道（战后永久成长）', () => {
    const tpl = getTalentTemplate('痛苦阶梯');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries.map((e) => e.kind)).toEqual(['自我进化']);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('不等价交换 → 置换通道', () => {
    const tpl = getTalentTemplate('不等价交换');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries).toEqual([
      { kind: '置换', channel: 'universal', params: { maxReturn: 2 } },
    ]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });
});

describe('不变价交换 —— planUnequalExchange', () => {
  const 素材 = (rarity: string) => ({ name: '火晶', type: '材料' as const, rarity });
  const 池: CardCatalogItem[] = [
    {
      id: 'c1',
      name: '青铜剑',
      cardTier: '青铜',
      formEntry: '装备',
      description: '',
      cost: 20,
    },
    {
      id: 'c2',
      name: '白铁盾',
      cardTier: '白铁',
      formEntry: '装备',
      description: '',
      cost: 10,
    },
  ];

  it('素材 → 同稀有度素材 1~2 份（份数由骰值定）', () => {
    const 少 = planUnequalExchange(素材('稀有'), [], () => 0.01, 2);
    expect(少.ok).toBe(true);
    expect(少.plan!.gains[0].quantity).toBe(1);
    expect(少.plan!.gains[0].name).toBe(materialNameOf('稀有'));
    const 多 = planUnequalExchange(素材('稀有'), [], () => 0.99, 2);
    expect(多.plan!.gains[0].quantity).toBe(2);
  });

  it('maxReturn=1 → 恒为 1 份（档位可调）', () => {
    expect(planUnequalExchange(素材('普通'), [], () => 0.99, 1).plan!.gains[0].quantity).toBe(1);
  });

  it('卡牌 → 从池里抽「不高于原档」的一张', () => {
    const r = planUnequalExchange(
      { name: '旧卡', type: '卡牌', cardTier: '青铜' },
      池,
      () => 0.5,
      2,
    );
    expect(r.ok).toBe(true);
    expect(r.plan!.gains).toHaveLength(1);
    expect(r.plan!.gains[0].name).toBe('青铜剑');
  });

  it('池里没有原档 → 向下顺延（绝不空手）', () => {
    const r = planUnequalExchange(
      { name: '旧卡', type: '卡牌', cardTier: '星辉' },
      池,
      () => 0.5,
      2,
    );
    expect(r.ok).toBe(true);
    expect(r.plan!.gains[0].name).toBe('青铜剑'); // 池里最高就是青铜
  });

  it('卡池为空 → 拒绝（不消耗玩家的卡）', () => {
    const r = planUnequalExchange({ name: '旧卡', type: '卡牌', cardTier: '青铜' }, [], () => 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('命运卡堆是空的');
  });

  it('装备/道具不在范围（描述只说素材和卡牌）', () => {
    const r = planUnequalExchange({ name: '长剑', type: '装备' }, 池, () => 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('不在交换范围');
  });
});

describe('本批之后的体质', () => {
  it('四条都从「仅叙事」里出来了', () => {
    for (const name of ['败犬烙印', '无垢仙体（东方）', '痛苦阶梯', '不等价交换', '命运之骰']) {
      const tpl = TALENT_CATALOG.find((t) => t.name === name);
      expect(tpl, name).toBeDefined();
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });
});
