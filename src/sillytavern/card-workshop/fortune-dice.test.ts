/**
 * fortune-dice.test.ts — 每日骰（2026-09-17）
 *
 * 两张表（好运之骰十面 / 命运之骰六面）共用一套机制，靠 `faces` 分派。
 * 设计裁定：骰面是数据、兑现是 Code——抽奖是本作唯一的纯随机入口，结果必须可复算。
 */
import { describe, it, expect } from 'vitest';
import {
  COMBAT_CRIT_MULTIPLIER,
  DAILY_BUFF_COMBAT_CRIT,
  DAILY_BUFF_CRAFT_LUCK,
  FORTUNE_DICE_TABLES,
  diceTableByFaces,
  diceTableOf,
  isRerollFace,
  rollOnTable,
  type FortuneDiceFace,
} from './fortune-dice';
import { diceTablesOf } from './talent-rule-modifiers';
import { getTalentTemplate, hasWorkingMechanic } from './talent-entry';
import { liftCraftRating } from '../craft-gen-chain';
import type { CraftRating } from '../types';

const 十面 = diceTableOf('好运之骰')!;
const 六面 = diceTableOf('命运之骰')!;

describe('骰表登记表', () => {
  it('两张表，面数与 key 对得上', () => {
    expect(FORTUNE_DICE_TABLES).toHaveLength(2);
    expect(十面.faces).toBe(10);
    expect(六面.faces).toBe(6);
    expect(十面.key).toBe('好运之骰');
    expect(六面.key).toBe('命运之骰');
  });

  it('每张表的面数完整、点数独占、释义齐备', () => {
    for (const table of FORTUNE_DICE_TABLES) {
      expect(table.faceList, table.key).toHaveLength(table.faces);
      const pips = table.faceList.map((f) => f.pip).sort((a, b) => a - b);
      expect(pips, table.key).toEqual(Array.from({ length: table.faces }, (_, i) => i + 1));
      for (const f of table.faceList) {
        expect(f.text.length, `${table.key}/${f.id} 应有释义`).toBeGreaterThan(0);
      }
    }
  });

  it('每张表的吉凶梯度都是「点数越大越好」', () => {
    const 权重: Record<string, number> = { 凶: 0, 平: 1, 吉: 2, 大吉: 3 };
    for (const table of FORTUNE_DICE_TABLES) {
      for (let i = 1; i < table.faceList.length; i++) {
        const 前 = table.faceList[i - 1];
        const 今 = table.faceList[i];
        expect(权重[今.tone], `${table.key}/${今.id} 不该比 ${前.id} 差`).toBeGreaterThanOrEqual(
          权重[前.tone],
        );
      }
    }
  });

  it('faces 档位分派：6 → 命运之骰、10 → 好运之骰', () => {
    expect(diceTableByFaces(6)?.key).toBe('命运之骰');
    expect(diceTableByFaces(10)?.key).toBe('好运之骰');
  });

  it('未知 faces / 未知 key → undefined（fail closed，不静默塞一张错表）', () => {
    // 白名单只放 6/10；出现别的值说明内容与代码脱钩，宁可不给骰子也不能给错表
    expect(diceTableByFaces(7)).toBeUndefined();
    expect(diceTableByFaces(20)).toBeUndefined();
    expect(diceTableOf('不存在')).toBeUndefined();
    expect(
      diceTablesOf([
        {
          entries: [{ kind: '日掷' as const, channel: 'universal' as const, params: { faces: 7 } }],
        },
      ]),
    ).toEqual([]);
  });
});

describe('rollOnTable —— 骰值 → 面', () => {
  it('每点对上该点的面（两张表都测）', () => {
    for (const table of FORTUNE_DICE_TABLES) {
      for (const face of table.faceList) {
        expect(rollOnTable(table, face.pip).id).toBe(face.id);
      }
    }
  });

  it('骰值按各表面数夹逼（脏值不抛）', () => {
    expect(rollOnTable(六面, 0).pip).toBe(1);
    expect(rollOnTable(六面, 99).pip).toBe(6);
    expect(rollOnTable(六面, NaN).pip).toBe(1);
    expect(rollOnTable(十面, 99).pip).toBe(10);
    expect(rollOnTable(十面, 3.9).pip).toBe(3);
  });
});

describe('好运之骰（十面）—— 面名与兑现', () => {
  it('面名与天赋描述里那十个词逐字一致', () => {
    const 描述十面 = [
      '谢谢惠顾',
      '福缘天降',
      '再来一次',
      '红鸾天喜',
      '提升一级',
      '刀刀暴击',
      '制卡顺利',
      '材料秘境',
      '屠龙宝刀',
      '杂鱼杂鱼',
    ];
    expect([...十面.faceList.map((f) => f.id)].sort()).toEqual([...描述十面].sort());
  });

  it('三类兑现都有代表面', () => {
    const byPip = (pip: number): FortuneDiceFace => rollOnTable(十面, pip);
    expect(byPip(1).reward).toEqual({ kind: 'money', amount: -50 }); // 即时发放
    expect(isRerollFace(byPip(3))).toBe(true); // 账本操作
    expect(byPip(5).reward.kind).toBe('dailyBuff'); // 当日增益
    expect(byPip(2).reward).toEqual({ kind: 'none' }); // 落空
    expect(byPip(10).reward).toEqual({ kind: 'card', cardTier: '星辉' });
    expect(byPip(9).reward).toEqual({ kind: 'level', steps: 1 });
  });

  it('「再来一次」全表唯一', () => {
    const 退次数的 = FORTUNE_DICE_TABLES.flatMap((t) => t.faceList).filter(isRerollFace);
    expect(退次数的).toHaveLength(1);
    expect(退次数的[0].id).toBe('再来一次');
  });
});

describe('命运之骰（六面）—— 面名与兑现', () => {
  it('面名与天赋描述里那六个词逐字一致', () => {
    const 描述六面 = ['天灾', '倒霉透顶', '略有不顺', '略有好运', '诸事顺利', '福缘天降'];
    expect([...六面.faceList.map((f) => f.id)].sort()).toEqual([...描述六面].sort());
  });

  it('比十面弱：不给卡、不给等级，顶层给金钱', () => {
    const kinds = new Set(六面.faceList.map((f) => f.reward.kind));
    expect(kinds.has('card')).toBe(false);
    expect(kinds.has('level')).toBe(false);
    expect(rollOnTable(六面, 6).reward).toEqual({ kind: 'money', amount: 200 });
  });

  it('「诸事顺利」复用制卡顺利那条当日增益（两张表共用同一 key）', () => {
    const 十面的制卡顺利 = rollOnTable(十面, 5).reward;
    const 六面的诸事顺利 = rollOnTable(六面, 5).reward;
    expect(十面的制卡顺利).toEqual(六面的诸事顺利);
    expect(六面的诸事顺利).toMatchObject({ key: DAILY_BUFF_CRAFT_LUCK });
  });
});

describe('diceTablesOf —— 玩家持有哪些骰表', () => {
  const 持 = (faces: number) => [
    { entries: [{ kind: '日掷' as const, channel: 'universal' as const, params: { faces } }] },
  ];

  it('按 faces 映射到表', () => {
    expect(diceTablesOf(持(10)).map((t) => t.key)).toEqual(['好运之骰']);
    expect(diceTablesOf(持(6)).map((t) => t.key)).toEqual(['命运之骰']);
  });

  it('两张都持有 → 两张都列出（面板一次列全）', () => {
    const both = [...持(10), ...持(6)];
    expect(
      diceTablesOf(both)
        .map((t) => t.key)
        .sort(),
    ).toEqual(['命运之骰', '好运之骰']);
  });

  it('重复持有同一 faces 只算一张；没天赋 → 空', () => {
    expect(diceTablesOf([...持(10), ...持(10)])).toHaveLength(1);
    expect(diceTablesOf(undefined)).toEqual([]);
    expect(
      diceTablesOf([
        { entries: [{ kind: '吞噬' as const, channel: 'universal' as const, params: {} }] },
      ]),
    ).toEqual([]);
  });
});

describe('关联机制', () => {
  it('暴击倍率是明确的常量', () => {
    expect(COMBAT_CRIT_MULTIPLIER).toBe(1.25);
    expect(DAILY_BUFF_COMBAT_CRIT).toBe('刀刀暴击');
  });

  it('liftCraftRating —— 制卡顺利与败犬烙印共用的评级上浮', () => {
    expect(liftCraftRating('大失败', 1)).toBe('失败');
    expect(liftCraftRating('大失败', 2)).toBe('成功'); // 败犬烙印：两档
    expect(liftCraftRating('成功', 1)).toBe('精益求精');
    expect(liftCraftRating('成功', 2)).toBe('精益求精'); // 封顶不越界
    expect(liftCraftRating('精益求精', 2)).toBe('精益求精');
    expect(liftCraftRating('???' as CraftRating, 1)).toBe('???');
  });

  it('两条骰子天赋都算已实装', () => {
    for (const name of ['好运之骰', '命运之骰']) {
      const tpl = getTalentTemplate(name);
      expect(tpl, name).toBeDefined();
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });
});
