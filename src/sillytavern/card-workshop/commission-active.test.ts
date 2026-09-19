/**
 * commission-active.test.ts — 接取状态：并行上限 / 基线快照 / 时限违约 / 素材到访交付
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_ACTIVE_COMMISSIONS,
  visitCounterKey,
  coerceActiveCommissions,
  canAcceptCommission,
  activeOf,
  planAccept,
  abandonActive,
  isActiveExpired,
  splitExpiredCommissions,
  breachPenaltyOf,
  countMaterialOf,
  materialShortfall,
  materialRequirementMet,
  visitProgressOf,
  visitRequirementMet,
  issuerDeliveryBlock,
  planMaterialDelivery,
  planVisitDelivery,
} from './commission-active';
import { coerceCommissions, requiresIssuerDelivery } from './commission';
import { addCounter } from './daily-ledger';
import type { CommissionDef } from './commission';
import type { CardItem } from '../types';

describe('visitCounterKey', () => {
  it('前缀 + 中层 id', () => {
    expect(visitCounterKey('mt-north')).toBe('到访.mt-north');
  });
});

describe('coerceActiveCommissions（容错解析）', () => {
  it('坏条目逐条丢；expiresDay/baselines 认不出就省略', () => {
    const list = coerceActiveCommissions([
      { defName: '雪莲采集', acceptDay: 10, expiresDay: 17, visitBaselines: { '到访.mt-north': 4 } },
      { defName: '', acceptDay: 1 },
      { defName: '无接取日' },
      { defName: '坏日期', acceptDay: 'x' },
      '垃圾',
      { defName: '无时限', acceptDay: 3, expiresDay: 0, visitBaselines: { 坏: 'x' } },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      defName: '雪莲采集',
      acceptDay: 10,
      expiresDay: 17,
      visitBaselines: { '到访.mt-north': 4 },
    });
    expect(list[1]).toEqual({ defName: '无时限', acceptDay: 3 });
  });
});

describe('接取：容量 / 基线快照 / 时限', () => {
  const def: CommissionDef = {
    name: '雪莲采集',
    requireMaterial: { name: '雪莲', count: 3 },
    destMidTier: 'mt-north',
    deadlineDays: 7,
    rewards: { gc: 500 },
  };

  it('并行上限 3', () => {
    expect(canAcceptCommission([])).toBe(true);
    const full = Array.from({ length: MAX_ACTIVE_COMMISSIONS }, (_, i) => ({
      defName: `委托${i}`,
      acceptDay: 1,
    }));
    expect(canAcceptCommission(full)).toBe(false);
    expect(canAcceptCommission(full.slice(0, 2))).toBe(true);
    expect(canAcceptCommission(undefined)).toBe(true);
  });

  it('planAccept 快照到访基线（接取前去过的不算）', () => {
    let counters = addCounter(undefined, visitCounterKey('mt-north'), 4);
    const active = planAccept({ def, counters, day: 100 });
    expect(active.defName).toBe('雪莲采集');
    expect(active.acceptDay).toBe(100);
    expect(active.visitBaselines?.[visitCounterKey('mt-north')]).toBe(4);
    expect(active.expiresDay).toBe(107);
    // 接取后又去 2 次 → 进度 2，不是 6
    counters = addCounter(counters, visitCounterKey('mt-north'), 2);
    const req = { midTier: 'mt-north', count: 3 };
    expect(visitProgressOf(active, counters, req)).toBe(2);
    expect(visitRequirementMet(active, counters, req)).toBe(false);
    counters = addCounter(counters, visitCounterKey('mt-north'), 1);
    expect(visitRequirementMet(active, counters, req)).toBe(true);
  });

  it('无时限委托没有 expiresDay；无到访要求不写基线', () => {
    const active = planAccept({
      def: { name: '收卡' },
      counters: undefined,
      day: 5.9,
    });
    expect(active.expiresDay).toBeUndefined();
    expect(active.visitBaselines).toBeUndefined();
    expect(active.acceptDay).toBe(5);
  });

  it('放弃 = 从清单摘除；重接重新快照', () => {
    const list = [
      planAccept({ def, counters: undefined, day: 1 }),
      planAccept({ def: { ...def, name: '另一条' }, counters: undefined, day: 1 }),
    ];
    const kept = abandonActive(list, '雪莲采集');
    expect(kept).toHaveLength(1);
    expect(kept[0].defName).toBe('另一条');
    expect(activeOf(list, '雪莲采集')).toBeDefined();
    expect(activeOf(kept, '雪莲采集')).toBeUndefined();
  });
});

describe('时限与违约', () => {
  it('expiresDay 当天仍有效，次日起算过期', () => {
    const active = { defName: 'x', acceptDay: 1, expiresDay: 8 };
    expect(isActiveExpired(active, 7)).toBe(false);
    expect(isActiveExpired(active, 8)).toBe(true);
    expect(isActiveExpired({ defName: 'y', acceptDay: 1 }, 999)).toBe(false);
  });

  it('splitExpiredCommissions 切成两半', () => {
    const list = [
      { defName: '活', acceptDay: 1 },
      { defName: '死', acceptDay: 1, expiresDay: 5 },
    ];
    const { kept, expired } = splitExpiredCommissions(list, 5);
    expect(kept.map((a) => a.defName)).toEqual(['活']);
    expect(expired.map((a) => a.defName)).toEqual(['死']);
  });

  it('违约罚：S=10 / A=5 / 低级与无品级不罚', () => {
    expect(breachPenaltyOf({ grade: 'S' })).toBe(10);
    expect(breachPenaltyOf({ grade: 'A' })).toBe(5);
    expect(breachPenaltyOf({ grade: 'B' })).toBe(0);
    expect(breachPenaltyOf({ grade: undefined })).toBe(0);
    expect(breachPenaltyOf(undefined)).toBe(0);
  });
});

describe('素材清点', () => {
  const inventory = [
    { name: '雪莲', quantity: 2 },
    { name: '雪莲', quantity: 1 },
    { name: '冰晶', quantity: 5 },
  ];
  it('countMaterialOf 按名累计', () => {
    expect(countMaterialOf(inventory, '雪莲')).toBe(3);
    expect(countMaterialOf(inventory, '冰晶')).toBe(5);
    expect(countMaterialOf(inventory, '没有')).toBe(0);
    expect(countMaterialOf(undefined, '雪莲')).toBe(0);
  });
  it('shortfall / met', () => {
    expect(materialShortfall(inventory, { name: '雪莲', count: 3 })).toBe(0);
    expect(materialShortfall(inventory, { name: '雪莲', count: 4 })).toBe(1);
    expect(materialRequirementMet(inventory, { name: '雪莲', count: 3 })).toBe(true);
    expect(materialRequirementMet(inventory, { name: '雪莲', count: 4 })).toBe(false);
  });
});

describe('交付地分流（A/S 级回发布中层）', () => {
  it('requiresIssuerDelivery 只认写了发布中层的 A/S 级', () => {
    expect(requiresIssuerDelivery({ grade: 'S', issuerMidTier: 'mt-capital' })).toBe(true);
    expect(requiresIssuerDelivery({ grade: 'A', issuerMidTier: 'mt-capital' })).toBe(true);
    expect(requiresIssuerDelivery({ grade: 'B', issuerMidTier: 'mt-capital' })).toBe(false);
    expect(requiresIssuerDelivery({ grade: 'S' })).toBe(false);
  });

  it('issuerDeliveryBlock：人不在发布中层拦下，D 级豁免', () => {
    const sDef: CommissionDef = {
      name: '远征',
      requireMaterial: { name: '雪莲', count: 3 },
      grade: 'S',
      issuerMidTier: 'mt-capital',
      rewards: {},
    };
    expect(issuerDeliveryBlock(sDef, 'mt-north')).toContain('发布地');
    expect(issuerDeliveryBlock(sDef, 'mt-capital')).toBeUndefined();
    const dDef: CommissionDef = {
      name: '小事',
      requireMaterial: { name: '铁矿', count: 1 },
      issuerMidTier: 'mt-capital',
      rewards: {},
    };
    expect(issuerDeliveryBlock(dDef, 'mt-north')).toBeUndefined();
  });
});

describe('planMaterialDelivery', () => {
  const def: CommissionDef = {
    name: '雪莲采集',
    requireMaterial: { name: '雪莲', count: 3 },
    destMidTier: 'mt-north',
    grade: 'A',
    issuerMidTier: 'mt-capital',
    rewards: { gc: 500, reputation: 3 },
  };

  it('素材不足给差额理由', () => {
    const plan = planMaterialDelivery({
      def,
      inventory: [{ name: '雪莲', quantity: 2 }],
      playerName: '玩家',
    });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain('还差 1');
    expect(plan.patches).toEqual([]);
  });

  it('人不在发布中层拒办（A 级）', () => {
    const plan = planMaterialDelivery({
      def,
      inventory: [{ name: '雪莲', quantity: 3 }],
      playerName: '玩家',
      currentMidTierId: 'mt-north',
    });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain('发布地');
  });

  it('凑齐 + 人在发布中层 → 扣素材 + 奖励一次出全', () => {
    const plan = planMaterialDelivery({
      def,
      inventory: [{ name: '雪莲', quantity: 3 }],
      playerName: '玩家',
      currentMidTierId: 'mt-capital',
    });
    expect(plan.ok).toBe(true);
    expect(plan.patches[0]).toMatchObject({
      op: 'remove_item',
      value: { name: '雪莲', quantity: 3 },
    });
    const gc = plan.patches.find((p) => p.op === 'update_character');
    expect(gc).toBeDefined();
    const rep = plan.patches.find((p) => p.op === 'delta_variable');
    expect(rep).toMatchObject({ target: 'profile.reputation', amount: 3 });
  });

  it('非素材委托拒走此路', () => {
    const plan = planMaterialDelivery({
      def: { name: '收卡', requireCard: {}, rewards: {} },
      inventory: [],
      playerName: '玩家',
    });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain('不是素材委托');
  });
});

describe('planVisitDelivery', () => {
  const def: CommissionDef = {
    name: '亲赴北境',
    requireVisit: { midTier: 'mt-north', count: 2 },
    destMidTier: 'mt-north',
    rewards: { gc: 300 },
  };

  it('没接取不给交', () => {
    const plan = planVisitDelivery({ def, active: undefined, counters: undefined, playerName: '玩家' });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain('接取');
  });

  it('进度不足给差额理由（接取后才去的才算）', () => {
    const active = planAccept({ def, counters: undefined, day: 1 });
    const counters = addCounter(undefined, visitCounterKey('mt-north'), 1);
    const plan = planVisitDelivery({ def, active, counters, playerName: '玩家' });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain('还要去 1 次');
  });

  it('进度凑齐 → 纯奖励补丁（人到即凭证，无物可扣）', () => {
    let counters = addCounter(undefined, visitCounterKey('mt-north'), 5);
    const active = planAccept({ def, counters, day: 1 });
    counters = addCounter(counters, visitCounterKey('mt-north'), 2);
    const plan = planVisitDelivery({ def, active, counters, playerName: '玩家' });
    expect(plan.ok).toBe(true);
    expect(plan.patches).toHaveLength(1);
    expect(plan.patches[0]).toMatchObject({
      op: 'update_character',
      value: { money: 300 },
    });
  });

  it('非探索委托拒走此路', () => {
    const plan = planVisitDelivery({
      def: { name: '收卡', requireCard: {}, rewards: {} },
      active: { defName: '收卡', acceptDay: 1 },
      counters: undefined,
      playerName: '玩家',
    });
    expect(plan.ok).toBe(false);
    expect(plan.reason).toContain('不是探索委托');
  });
});

describe('coerceCommissions：闭环新字段', () => {
  it('素材委托（无 requireCard）成立，grade/发布地/时限/链/卡奖励全解析', () => {
    const defs = coerceCommissions([
      {
        name: '雪莲采集',
        description: '北境雪原的雪莲只在夜里开',
        requireMaterial: { name: '雪莲', count: 3 },
        destMidTier: 'mt-north',
        issuerMidTier: 'mt-capital',
        grade: 'A',
        deadlineDays: 10,
        chainId: 'chain-xue',
        chainOrder: 2,
        rewards: { gc: 500, card: { name: '禁忌卡·雪葬' } },
      },
    ]);
    expect(defs).toHaveLength(1);
    expect(defs[0].requireMaterial).toEqual({ name: '雪莲', count: 3 });
    expect(defs[0].requireCard).toEqual({});
    expect(defs[0].destMidTier).toBe('mt-north');
    expect(defs[0].issuerMidTier).toBe('mt-capital');
    expect(defs[0].grade).toBe('A');
    expect(defs[0].deadlineDays).toBe(10);
    expect(defs[0].chainId).toBe('chain-xue');
    expect(defs[0].chainOrder).toBe(2);
    expect(defs[0].rewards.card).toEqual({ name: '禁忌卡·雪葬', grantAt: 'delivery' });
  });

  it('到访委托 + 链终点（场景制卡，grantAt scene）', () => {
    const defs = coerceCommissions([
      {
        name: '终焉之雪',
        requireVisit: { midTier: 'mt-north', count: 1 },
        finale: {
          type: '场景制卡',
          target: '禁忌卡·雪葬',
          materials: [{ name: '雪莲', quantity: 5 }],
        },
        destMidTier: 'mt-north',
        grade: 'S',
        rewards: { card: { name: '禁忌卡·雪葬', grantAt: 'scene' } },
      },
    ]);
    expect(defs[0].requireVisit).toEqual({ midTier: 'mt-north', count: 1 });
    expect(defs[0].finale?.type).toBe('场景制卡');
    expect(defs[0].finale?.target).toBe('禁忌卡·雪葬');
    expect(defs[0].finale?.materials).toEqual([{ name: '雪莲', quantity: 5 }]);
    expect(defs[0].rewards.card?.grantAt).toBe('scene');
  });

  it('四种要求一种都没有的空壳丢掉；坏字段逐格丢（有别的要求撑着就不丢整条）', () => {
    const defs = coerceCommissions([
      { name: '空壳', rewards: { gc: 1 } },
      { name: '坏品级', requireMaterial: { name: '雪莲', count: 1 }, grade: 'X' },
      { name: '坏素材数', requireMaterial: { name: '雪莲', count: 0 } },
      { name: '坏终点', requireVisit: { midTier: 'mt', count: 1 }, finale: { type: '无敌' } },
      { name: '坏时限', requireMaterial: { name: '雪莲', count: 1 }, deadlineDays: -3 },
    ]);
    expect(defs.map((d) => d.name)).toEqual(['坏品级', '坏终点', '坏时限']);
    expect(defs[0].grade).toBeUndefined();
    expect(defs[1].finale).toBeUndefined();
    expect(defs[1].requireVisit).toEqual({ midTier: 'mt', count: 1 });
    expect(defs[2].deadlineDays).toBeUndefined();
  });

  it('非法卡奖励丢 card 位不丢委托', () => {
    const defs = coerceCommissions([
      {
        name: '委托',
        requireCard: { minTier: '白银' },
        rewards: { card: '禁忌卡' },
      },
    ]);
    expect(defs).toHaveLength(1);
    expect(defs[0].rewards.card).toBeUndefined();
  });
});

describe('rewardPatches：独家卡发放补丁', () => {
  it('grantAt delivery 的卡奖励随交付补丁落库（完整卡定义由调用方解析）', async () => {
    const { buildDeliveryPatches } = await import('./commission');
    const card: CardItem = {
      name: '禁忌卡·雪葬',
      quantity: 1,
      type: '卡牌',
      cardTier: '星辉',
      词条: ['禁忌'],
      recipe: {
        mainMaterial: '雪莲',
        subMaterials: [],
        tier: '星辉',
        fusionKind: '叠加',
        cost: 100,
        rating: '成功',
      },
      sealed: false,
    };
    const def: CommissionDef = {
      name: '终焉之雪',
      requireVisit: { midTier: 'mt-north', count: 1 },
      rewards: { card: { name: '禁忌卡·雪葬', grantAt: 'delivery' } },
    };
    const patches = buildDeliveryPatches(def, { name: '凭证卡' }, '玩家', card);
    const cardPatch = patches.find((p) => p.op === 'add_item');
    expect(cardPatch).toBeDefined();
    expect(cardPatch).toMatchObject({
      target: 'characters.玩家',
      value: { name: '禁忌卡·雪葬', type: '卡牌' },
    });
  });
});
