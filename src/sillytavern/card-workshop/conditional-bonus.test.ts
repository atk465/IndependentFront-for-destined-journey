/**
 * conditional-bonus.test.ts — 条件数值加成（A 级批次③，2026-09-17）
 *
 * 三条 A 级天赋共用一套「条件成立 → 数值变化」：
 *  - 荒野镖客：卡组无伙伴卡 → 全属性 +25%
 *  - 战争之王：伙伴卡越多，在场助战越强（每张 +5%）
 *  - 集群母狗：某类单位 ≥ 4（= 描述里的「超过 3 个」）→ +10%，每多一个 +2%
 *
 * 阈值语义统一为「达到即触发」（≥），所以「超过 3」写成 threshold: 4。
 */
import { describe, it, expect } from 'vitest';
import {
  COND_RULES,
  coerceCondBonus,
  condBonusesOf,
  countMatching,
  deckCards,
  evalCondBonus,
  totalCondBonus,
} from './conditional-bonus';
import { TALENT_CATALOG, getTalentTemplate, hasWorkingMechanic } from './talent-entry';
import type { CardItem, InventoryItem } from '../types';

const 卡 = (name: string, 词条: string[]): CardItem =>
  ({
    name,
    quantity: 1,
    type: '卡牌',
    cardTier: '白银',
    词条,
    sealed: false,
    recipe: {
      mainMaterial: '主',
      subMaterials: [],
      tier: '白银',
      fusionKind: '叠加',
      cost: 0,
      rating: '成功',
    },
  }) as CardItem;

const 卡池 = [
  卡('岩爪', ['召唤', '土']),
  卡('风隼', ['召唤', '风', '犬']),
  卡('猎犬', ['军团', '犬']),
  卡('夜刃', ['技能', '暗']),
];
const 背包: InventoryItem[] = 卡池.map((c) => c as unknown as InventoryItem);
const 卡组 = (names: string[]) => names;

describe('coerceCondBonus —— 认不出的条件不生效', () => {
  it('认得的三条条件原样通过', () => {
    expect(coerceCondBonus({ cond: '无伙伴卡', threshold: 0, percent: 25, perExtra: 0 })).toEqual({
      cond: '无伙伴卡',
      threshold: 0,
      percent: 25,
      perExtra: 0,
    });
  });

  it('未知条件名 → undefined（宁可不生效，也不乱算）', () => {
    expect(coerceCondBonus({ cond: '不存在的条件' })).toBeUndefined();
    expect(coerceCondBonus({})).toBeUndefined();
    expect(coerceCondBonus({ cond: 123 })).toBeUndefined();
  });

  it('数值缺省成 0、负数夹到 0，不抛', () => {
    expect(coerceCondBonus({ cond: '伙伴卡数' })).toEqual({
      cond: '伙伴卡数',
      threshold: 0,
      percent: 0,
      perExtra: 0,
    });
    expect(coerceCondBonus({ cond: '伙伴卡数', threshold: -5, percent: NaN })).toEqual({
      cond: '伙伴卡数',
      threshold: 0,
      percent: 0,
      perExtra: 0,
    });
  });

  it('条件表是一行数据（加条件 = 加一行）', () => {
    expect(Object.keys(COND_RULES)).toEqual(['无伙伴卡', '伙伴卡数', '犬类卡数']);
  });
});

describe('countMatching / deckCards', () => {
  it('按卡类计数（召唤 + 军团都算伙伴）', () => {
    const cards = deckCards(卡组(['岩爪', '夜刃']), 背包);
    expect(countMatching(cards, COND_RULES['伙伴卡数'])).toBe(1);
  });

  it('按关键词计数（犬类：词条或卡名含「犬」）', () => {
    const cards = deckCards(卡组(['风隼', '猎犬', '岩爪']), 背包);
    expect(countMatching(cards, COND_RULES['犬类卡数'])).toBe(2);
  });

  it('卡组里的名字取不到真卡 → 跳过（不炸）', () => {
    expect(deckCards(卡组(['不存在']), 背包)).toEqual([]);
    expect(deckCards(undefined, 背包)).toEqual([]);
  });
});

describe('evalCondBonus —— 三条各自的语义', () => {
  const 邪 = { cond: '无伙伴卡' as const, threshold: 0, percent: 25, perExtra: 0 };

  it('无伙伴卡是**反向**条件：无伙伴才触发', () => {
    expect(evalCondBonus(邪, deckCards(卡组(['夜刃']), 背包)).met).toBe(true);
    expect(evalCondBonus(邪, deckCards(卡组(['夜刃']), 背包)).bonus).toBe(25);
    expect(evalCondBonus(邪, deckCards(卡组(['岩爪']), 背包)).met).toBe(false);
    expect(evalCondBonus(邪, deckCards(卡组(['猎犬']), 背包)).met).toBe(false);
  });

  it('战争之王：每张伙伴 +5%，0 张时不给', () => {
    const spec = { cond: '伙伴卡数' as const, threshold: 0, percent: 0, perExtra: 5 };
    expect(evalCondBonus(spec, deckCards(卡组(['岩爪', '风隼']), 背包)).bonus).toBe(10);
    expect(evalCondBonus(spec, deckCards(卡组(['岩爪']), 背包)).bonus).toBe(5);
    expect(evalCondBonus(spec, deckCards(卡组(['夜刃']), 背包)).bonus).toBe(0);
  });

  it('集群母狗：≥4 才触发（= 描述里的「超过 3 个」），每多一个 +2%', () => {
    const spec = { cond: '犬类卡数' as const, threshold: 4, percent: 10, perExtra: 2 };
    const 造 = (n: number) => Array.from({ length: n }, (_, i) => 卡(`犬${i}`, ['召唤', '犬']));
    expect(evalCondBonus(spec, 造(3)).met).toBe(false); // 3 个 = 没超过 3
    expect(evalCondBonus(spec, 造(3)).bonus).toBe(0);
    expect(evalCondBonus(spec, 造(4)).bonus).toBe(10); // 刚好超过 3
    expect(evalCondBonus(spec, 造(6)).bonus).toBe(14); // 10 + 2×2
  });

  it('触发时给审计行，未触发时不给', () => {
    const spec = { cond: '伙伴卡数' as const, threshold: 1, percent: 10, perExtra: 5 };
    expect(evalCondBonus(spec, deckCards(卡组(['岩爪']), 背包)).note).toContain('伙伴卡数');
    expect(evalCondBonus(spec, deckCards(卡组(['夜刃']), 背包)).note).toBeUndefined();
  });
});

describe('totalCondBonus —— 多条并存时相加', () => {
  it('三条同时成立 → 百分比相加，审计行齐全', () => {
    const 犬 = Array.from({ length: 4 }, (_, i) => 卡(`犬${i}`, ['召唤', '犬']));
    const inv = 犬.map((c) => c as unknown as InventoryItem);
    const talents = [
      {
        entries: [
          { kind: '条件加成', params: { cond: '伙伴卡数', threshold: 0, percent: 0, perExtra: 5 } },
        ],
      },
      {
        entries: [
          {
            kind: '条件加成',
            params: { cond: '犬类卡数', threshold: 4, percent: 10, perExtra: 2 },
          },
        ],
      },
    ];
    const r = totalCondBonus(
      talents,
      犬.map((c) => c.name),
      inv,
    );
    // 伙伴 4 张 → 20%；犬 4 个 → 10% + 0 = 10%
    expect(r.percent).toBe(30);
    expect(r.notes).toHaveLength(2);
  });

  it('没有条件条目 → 0 与空审计（零改动）', () => {
    const r = totalCondBonus([], 卡组(['岩爪']), 背包);
    expect(r.percent).toBe(0);
    expect(r.notes).toEqual([]);
    expect(condBonusesOf(undefined)).toEqual([]);
  });

  it('认不出的条件条目被丢掉，不影响其它条目', () => {
    const talents = [
      { entries: [{ kind: '条件加成', params: { cond: '无中生有' } }] },
      {
        entries: [
          {
            kind: '条件加成',
            params: { cond: '无伙伴卡', threshold: 0, percent: 25, perExtra: 0 },
          },
        ],
      },
    ];
    expect(condBonusesOf(talents)).toHaveLength(1);
    expect(totalCondBonus(talents, 卡组(['夜刃']), 背包).percent).toBe(25);
  });
});

describe('三条天赋侧接线', () => {
  it('条目逐条对得上（含阈值语义）', () => {
    const 期望: Record<string, Record<string, number | string>> = {
      荒野镖客: { cond: '无伙伴卡', threshold: 0, percent: 25, perExtra: 0 },
      战争之王: { cond: '伙伴卡数', threshold: 0, percent: 0, perExtra: 5 },
      集群母狗: { cond: '犬类卡数', threshold: 4, percent: 10, perExtra: 2 },
    };
    for (const [name, params] of Object.entries(期望)) {
      const tpl = getTalentTemplate(name);
      expect(tpl, name).toBeDefined();
      expect(tpl!.grade, name).toBe('A');
      // 荒野镖客在战斗维度批次追加了暴击条目，这里只断言「条件加成」仍在
      expect(
        tpl!.entries.map((e) => e.kind),
        name,
      ).toContain('条件加成');
      const condEntry = tpl!.entries.find((e) => e.kind === '条件加成')!;
      expect(condEntry.params, name).toEqual(params);
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });

  it('A 级已实装数不低于 111（本批推进的硬底线）', () => {
    const a = TALENT_CATALOG.filter((t) => t.grade === 'A');
    expect(a.filter(hasWorkingMechanic).length).toBeGreaterThanOrEqual(111);
  });
});
