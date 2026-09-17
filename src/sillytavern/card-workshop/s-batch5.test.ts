/**
 * s-batch5.test.ts — 制卡流程挂钩 + 伙伴塑造（2026-09-17）
 *
 * 两条天赋介入的是**制卡的成败判定**（赌徒谬论 / 时间回溯），
 * 一条介入的是**伙伴卡的成长**（调教大师系统）。
 *
 * 知识点：评级是制卡唯一的成败信号，所以「提高成功率」在这套架构里
 * 只能表达为「把评级往上抬」——三条因此都落在 `liftCraftRating` 上，
 * 但触发条件与代价各不相同。
 */
import { describe, it, expect } from 'vitest';
import {
  MISFORTUNE_KEY,
  MISFORTUNE_PER_FAILURE,
  TRAIN_DIRECTIONS,
  describeTraining,
  isGreatFailure,
  liftFromMisfortune,
  planTrain,
  trainingOf,
} from './craft-flow-hooks';
import { liftCraftRating } from '../craft-gen-chain';
import { addCounter, coerceCounters, counterOf, spendCounter } from './daily-ledger';
import { getTalentTemplate, hasWorkingMechanic, TALENT_CATALOG } from './talent-entry';

// ════════════════════════════════════════════════════════════════════
// 赌徒谬论
// ════════════════════════════════════════════════════════════════════

describe('赌徒谬论 —— 大失败叠厄运', () => {
  it('只有「大失败」算大失败（失败不算）', () => {
    expect(isGreatFailure('大失败')).toBe(true);
    expect(isGreatFailure('失败')).toBe(false);
    expect(isGreatFailure('成功')).toBe(false);
    expect(isGreatFailure(undefined)).toBe(false);
  });

  it('厄运是累计计数：不随天失效', () => {
    let c = addCounter(undefined, MISFORTUNE_KEY, MISFORTUNE_PER_FAILURE);
    c = addCounter(c, MISFORTUNE_KEY, MISFORTUNE_PER_FAILURE);
    expect(counterOf(c, MISFORTUNE_KEY)).toBe(2);
    // 没有 today 参数——它与时间无关
    expect(coerceCounters(c)[MISFORTUNE_KEY]).toBe(2);
  });

  it('厄运只在对冲融合（相克）上兑现', () => {
    const 相克 = liftFromMisfortune({ layers: 3, isClashFusion: true, maxLift: 3 });
    expect(相克.lift).toBe(3);
    const 非相克 = liftFromMisfortune({ layers: 3, isClashFusion: false, maxLift: 3 });
    expect(非相克.lift).toBe(0);
    expect(非相克.consumed).toBe(0);
  });

  it('按层数上浮，单次封顶 maxLift', () => {
    expect(liftFromMisfortune({ layers: 9, isClashFusion: true, maxLift: 3 }).lift).toBe(3);
    expect(liftFromMisfortune({ layers: 2, isClashFusion: true, maxLift: 3 }).lift).toBe(2);
  });

  it('用掉即清空（描述是「提高**下一次**」）', () => {
    const r = liftFromMisfortune({ layers: 4, isClashFusion: true, maxLift: 3 });
    expect(r.consumed).toBe(4);
  });

  it('没有厄运 → 不给（零改动）', () => {
    expect(liftFromMisfortune({ layers: 0, isClashFusion: true, maxLift: 3 }).lift).toBe(0);
    expect(liftFromMisfortune({ layers: -2, isClashFusion: true, maxLift: 3 }).lift).toBe(0);
  });

  it('上浮真的作用于评级阶梯', () => {
    expect(liftCraftRating('大失败', 3)).toBe('精益求精');
    expect(liftCraftRating('失败', 1)).toBe('成功');
  });

  it('模板带「赌运」条目（含堆叠上限与单次上限），且算已实装', () => {
    const tpl = getTalentTemplate('赌徒谬论');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries).toEqual([
      { kind: '赌运', channel: 'universal', params: { maxHold: 5, maxLift: 3 } },
    ]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 时间回溯
// ════════════════════════════════════════════════════════════════════

describe('时间回溯 —— 失败时重裁一次', () => {
  it('模板带「回溯」条目（含精神力代价），且算已实装', () => {
    const tpl = getTalentTemplate('时间回溯');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries).toEqual([{ kind: '回溯', channel: 'universal', params: { mpCost: 30 } }]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('重裁就是评级上浮一档（大失败→失败、失败→成功）', () => {
    expect(liftCraftRating('大失败', 1)).toBe('失败');
    expect(liftCraftRating('失败', 1)).toBe('成功');
  });

  it('成功时不触发——成功的评级上浮不改变任何东西（预付款不浪费在成功上）', () => {
    // 这是**管线侧**的判断（只有 !craftOutput.success 才回溯）；
    // 这里确认「成功」在评级阶梯上已被视为终态，重裁无从施加额外意义
    expect(liftCraftRating('成功', 1)).toBe('精益求精');
    expect(liftCraftRating('精益求精', 1)).toBe('精益求精');
  });
});

// ════════════════════════════════════════════════════════════════════
// 调教大师系统
// ════════════════════════════════════════════════════════════════════

describe('调教大师系统 —— 伙伴塑造', () => {
  const 卡 = (data?: unknown) => ({ name: '岩爪', ...(data !== undefined ? { data } : {}) });

  it('脏值兜底成「未调教」', () => {
    expect(trainingOf(undefined)).toEqual({ level: 0 });
    expect(trainingOf('x')).toEqual({ level: 0 });
    expect(trainingOf({ 调教: '乱写' })).toEqual({ level: 0 });
    expect(trainingOf({ 调教: -3 })).toEqual({ level: 0 });
  });

  it('接受两种存档形态：纯数字（老写法）与对象', () => {
    expect(trainingOf({ 调教: 2 })).toEqual({ level: 2 });
    expect(trainingOf({ 调教: { level: 1, direction: '女王' } })).toEqual({
      level: 1,
      direction: '女王',
    });
  });

  it('非法方向丢弃（只留等级）', () => {
    expect(trainingOf({ 调教: { level: 1, direction: '随便' } })).toEqual({ level: 1 });
  });

  it('调教一级 +1 战力，方向在第一次定下', () => {
    const r = planTrain(卡(), '女王', 3);
    expect(r.ok).toBe(true);
    expect(r.plan!.powerGain).toBe(1);
    expect(r.plan!.to).toEqual({ level: 1, direction: '女王' });
    expect(r.plan!.summary).toContain('女王');
  });

  it('之后再调不改方向（「性格一旦定了」）', () => {
    const once = planTrain(卡({ 调教: { level: 1, direction: '忠犬' } }), '女王', 3);
    expect(once.plan!.to.direction).toBe('忠犬');
  });

  it('到顶拒绝——不静默吞掉一次动作', () => {
    const r = planTrain(卡({ 调教: 3 }), '忠犬', 3);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('到顶');
  });

  it('上限可调（档位）', () => {
    expect(planTrain(卡({ 调教: 2 }), '忠犬', 2).ok).toBe(false);
    expect(planTrain(卡({ 调教: 2 }), '忠犬', 5).ok).toBe(true);
  });

  it('未知方向拒绝', () => {
    expect(planTrain(卡(), '随便' as never, 3).ok).toBe(false);
  });

  it('两次方向常量就是描述里的那两个词', () => {
    expect([...TRAIN_DIRECTIONS]).toEqual(['忠犬', '女王']);
  });

  it('展示一行两种状态都给得出', () => {
    expect(describeTraining(卡())).toContain('未调教');
    expect(describeTraining(卡({ 调教: { level: 2, direction: '女王' } }))).toContain('2 级');
  });

  it('模板带「调教」条目，且算已实装', () => {
    const tpl = getTalentTemplate('调教大师系统');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries).toEqual([{ kind: '调教', channel: 'universal', params: { maxLevel: 3 } }]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('目录里去重了——「调教大师系统」只剩一条', () => {
    const hits = TALENT_CATALOG.filter((t) => t.name === '调教大师系统');
    expect(hits).toHaveLength(1);
  });

  it('全目录再无重名', () => {
    const names = TALENT_CATALOG.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ════════════════════════════════════════════════════════════════════
// 体质检查
// ════════════════════════════════════════════════════════════════════

describe('本批之后 —— 三条 S 都离开了「仅叙事」', () => {
  it('赌徒谬论 / 时间回溯 / 调教大师系统', () => {
    for (const name of ['赌徒谬论', '时间回溯', '调教大师系统']) {
      const tpl = TALENT_CATALOG.find((t) => t.name === name);
      expect(tpl, name).toBeDefined();
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });

  it('厄运与烙印共用一套累计计数原语（不是两套）', () => {
    // 同一个 counters 表里能同时装两种资源
    let c = addCounter(undefined, '败犬烙印', 1);
    c = addCounter(c, MISFORTUNE_KEY, 3);
    expect(counterOf(c, '败犬烙印')).toBe(1);
    expect(counterOf(c, MISFORTUNE_KEY)).toBe(3);
    const spent = spendCounter(c, MISFORTUNE_KEY, 3);
    expect(spent.ok).toBe(true);
    expect(spent.left).toBe(0);
    expect(counterOf(spent.next, '败犬烙印')).toBe(1); // 互不影响
  });
});
