/**
 * fortune-dice.test.ts — 好运之骰（SS，2026-09-17）
 *
 * 设计裁定：**十面 = 十条数据，每面自带兑现口径**。抽奖是本作唯一的纯随机入口，
 * 结果必须可复算、可审计——所以十面全部 Code 兑现，AI 只负责写成一段话。
 * 这里钉住面的完整性、区间、吉凶梯度与兑现分派。
 */
import { describe, it, expect } from 'vitest';
import {
  COMBAT_CRIT_MULTIPLIER,
  DAILY_BUFF_COMBAT_CRIT,
  DAILY_BUFF_CRAFT_LUCK,
  FORTUNE_DICE_FACES,
  FORTUNE_DICE_LEDGER_KEY,
  FORTUNE_DICE_PIPS,
  isRerollFace,
  rollFortuneDie,
} from './fortune-dice';
import { getTalentTemplate, hasWorkingMechanic } from './talent-entry';
import { liftCraftRating } from '../craft-gen-chain';
import type { CraftRating } from '../types';

describe('十面表 —— 完整性与区间', () => {
  it('恰好 10 面，且每点点数独占一面（1..10 无缺无重）', () => {
    expect(FORTUNE_DICE_FACES).toHaveLength(FORTUNE_DICE_PIPS);
    const pips = FORTUNE_DICE_FACES.map((f) => f.pip).sort((a, b) => a - b);
    expect(pips).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

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
    expect([...FORTUNE_DICE_FACES.map((f) => f.id)].sort()).toEqual([...描述十面].sort());
  });

  it('每面都有释义，且吉凶梯度是「点数越大越好」', () => {
    for (const f of FORTUNE_DICE_FACES) {
      expect(f.text.length, `${f.id} 应有释义`).toBeGreaterThan(0);
    }
    const 权重: Record<string, number> = { 凶: 0, 平: 1, 吉: 2, 大吉: 3 };
    for (let i = 1; i < FORTUNE_DICE_FACES.length; i++) {
      expect(
        权重[FORTUNE_DICE_FACES[i].tone],
        `${FORTUNE_DICE_FACES[i].id} 不该比前一面差`,
      ).toBeGreaterThanOrEqual(权重[FORTUNE_DICE_FACES[i - 1].tone]);
    }
  });
});

describe('rollFortuneDie —— 骰值 → 面', () => {
  it('每点都对上该点的面', () => {
    for (const face of FORTUNE_DICE_FACES) {
      expect(rollFortuneDie(face.pip).id).toBe(face.id);
    }
  });

  it('骰值夹到 1..10（脏值不抛）', () => {
    expect(rollFortuneDie(0).pip).toBe(1);
    expect(rollFortuneDie(-9).pip).toBe(1);
    expect(rollFortuneDie(99).pip).toBe(10);
    expect(rollFortuneDie(NaN).pip).toBe(1);
    expect(rollFortuneDie(3.9).pip).toBe(3);
  });
});

describe('兑现口径 —— 三类分派', () => {
  const face = (pip: number) => rollFortuneDie(pip);

  it('即时发放：金钱 / 素材 / 卡 / 等级 / 好感', () => {
    expect(face(1).reward).toEqual({ kind: 'money', amount: -50 });
    expect(face(4).reward).toEqual({ kind: 'money', amount: 150 });
    expect(face(6).reward.kind).toBe('affection');
    expect(face(7).reward.kind).toBe('material');
    expect(face(9).reward.kind).toBe('level');
    expect(face(10).reward.kind).toBe('card');
  });

  it('账本操作：只有「再来一次」退次数', () => {
    const 退次数的 = FORTUNE_DICE_FACES.filter(isRerollFace);
    expect(退次数的).toHaveLength(1);
    expect(退次数的[0].id).toBe('再来一次');
  });

  it('当日增益：刀刀暴击 / 制卡顺利各带一个 key', () => {
    const buffs = FORTUNE_DICE_FACES.filter((f) => f.reward.kind === 'dailyBuff');
    expect(buffs.map((f) => f.id).sort()).toEqual(['刀刀暴击', '制卡顺利'].sort());
    const keys = buffs.map((f) => (f.reward as { key: string }).key);
    expect(keys).toContain(DAILY_BUFF_COMBAT_CRIT);
    expect(keys).toContain(DAILY_BUFF_CRAFT_LUCK);
  });

  it('「谢谢惠顾」什么都不发（纯叙事一行）', () => {
    expect(face(2).reward).toEqual({ kind: 'none' });
  });

  it('暴击倍率是明确的常量', () => {
    expect(COMBAT_CRIT_MULTIPLIER).toBe(1.25);
  });
});

describe('liftCraftRating —— 评级上浮一档（「制卡顺利」的兑现）', () => {
  it('大失败 → 失败 → 成功 → 精益求精，封顶不再上浮', () => {
    expect(liftCraftRating('大失败')).toBe('失败');
    expect(liftCraftRating('失败')).toBe('成功');
    expect(liftCraftRating('成功')).toBe('精益求精');
    expect(liftCraftRating('精益求精')).toBe('精益求精');
  });

  it('未知评级原样返回（不抛）', () => {
    expect(liftCraftRating('???' as CraftRating)).toBe('???');
  });
});

describe('好运之骰 —— 天赋侧接线', () => {
  it('模板带「日掷」条目，且算已实装', () => {
    const tpl = getTalentTemplate('好运之骰');
    expect(tpl?.grade).toBe('SS');
    expect(tpl!.entries).toEqual([{ kind: '日掷', channel: 'universal', params: { perDay: 1 } }]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('账本 key 与天赋名一致（记账在面板上一眼认得）', () => {
    expect(FORTUNE_DICE_LEDGER_KEY).toBe('好运之骰');
  });
});
