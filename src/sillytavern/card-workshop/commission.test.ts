/**
 * commission.test.ts — 委托引擎核心：容错解析 / 组合过滤器 / 交付规划
 */
import { describe, it, expect } from 'vitest';
import {
  coerceCommissions,
  matchesCommission,
  matchingCommissions,
  buildDeliveryPatches,
  isDeliverableCard,
  type CommissionDef,
  planCommissionDelivery,
} from './commission';
import type { CardItem } from '../types';

function card(
  name: string,
  tier: CardItem['cardTier'],
  词条: string[],
): Pick<CardItem, 'name' | 'cardTier' | '词条'> {
  return { name, cardTier: tier, 词条 };
}

const req = {
  minTier: '白银',
  formEntry: '地景',
  elements: ['火'],
} as const;

describe('coerceCommissions（容错解析）', () => {
  it('合法清单解析；缺 name / requireCard 的条目逐条丢', () => {
    const defs = coerceCommissions([
      { name: '猎魔委托', requireCard: { minTier: '白银' }, rewards: { gc: 200 } },
      { requireCard: {} }, // 无 name → 丢
      { name: '无名' }, // 无 requireCard → 丢
      '垃圾',
    ]);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('猎魔委托');
    expect(defs[0].rewards.gc).toBe(200);
  });
  it('非数组 → 空数组（永不抛）', () => {
    expect(coerceCommissions(undefined)).toEqual([]);
    expect(coerceCommissions({})).toEqual([]);
  });
  it('非法 minTier 丢弃该字段；materials 补缺省数量', () => {
    const defs = coerceCommissions([
      {
        name: '委托',
        requireCard: { minTier: '神级' },
        rewards: { materials: [{ name: '火晶' }, { name: '星核', quantity: 3 }] },
      },
    ]);
    expect(defs[0].requireCard.minTier).toBeUndefined();
    expect(defs[0].rewards.materials).toEqual([
      { name: '火晶', quantity: 1 },
      { name: '星核', quantity: 3 },
    ]);
  });
});

const 白银火地景 = card('灼热盆地', '白银', ['火', '地景']);

describe('matchesCommission（组合过滤器，全命中才合格）', () => {
  it('各维度独立命中', () => {
    expect(matchesCommission(白银火地景, { minTier: '白银' })).toBe(true);
    expect(matchesCommission(白银火地景, { formEntry: '地景' })).toBe(true);
    expect(matchesCommission(白银火地景, { elements: ['火'] })).toBe(true);
    expect(matchesCommission(白银火地景, { exactName: '灼热盆地' })).toBe(true);
  });
  it('组合全命中；任一不命中即否', () => {
    expect(matchesCommission(白银火地景, req)).toBe(true);
    expect(matchesCommission(card('青铜矿脉', '青铜', ['土', '地景']), req)).toBe(false); // 品质不足
    expect(matchesCommission(card('寒霜领域', '白银', ['冰', '地景']), req)).toBe(false); // 元素不合
  });
  it('品质下限：更高品质合格', () => {
    expect(matchesCommission(card('星辉卡', '星辉', ['火', '地景']), req)).toBe(true);
  });
  it('空要求 = 万能收购（模板侧应避免）', () => {
    expect(matchesCommission(白银火地景, {})).toBe(true);
  });
  it('matchingCommissions 找出全部可满足委托', () => {
    const defs: CommissionDef[] = [
      { name: '甲', requireCard: { minTier: '白银' }, rewards: {} },
      { name: '乙', requireCard: { elements: ['冰'] }, rewards: {} },
    ];
    expect(matchingCommissions(白银火地景, defs).map((d) => d.name)).toEqual(['甲']);
  });
});

describe('buildDeliveryPatches（上交制：卡移除 + 奖励同窗）', () => {
  const def: CommissionDef = {
    name: '猎魔委托',
    requireCard: req,
    rewards: { gc: 200, reputation: 15, materials: [{ name: '火晶', quantity: 2 }] },
  };
  it('patches 形状：remove_item 卡 + money delta + 声望 delta + 素材 add_item', () => {
    const patches = buildDeliveryPatches(def, 白银火地景, '艾拉');
    expect(patches[0]).toEqual({
      op: 'remove_item',
      target: 'characters.艾拉',
      value: { name: '灼热盆地', quantity: 1 },
    });
    const money = patches.find((p) => p.op === 'update_character');
    expect(money).toMatchObject({
      target: 'characters.艾拉',
      value: { money: 200 },
      metadata: { delta: true },
    });
    const rep = patches.find((p) => p.op === 'delta_variable');
    expect(rep).toMatchObject({ target: 'profile.reputation', amount: 15 });
    const loot = patches.filter((p) => p.op === 'add_item');
    expect(loot).toHaveLength(1);
  });
  it('空奖励：只有上交一条', () => {
    const patches = buildDeliveryPatches({ ...def, rewards: {} }, 白银火地景, '艾拉');
    expect(patches).toHaveLength(1);
  });
});

describe('isDeliverableCard', () => {
  it('素材卡不可交付', () => {
    expect(isDeliverableCard({ 词条: ['素材'] })).toBe(false);
    expect(isDeliverableCard({ 词条: ['火', '技能'] })).toBe(true);
  });
});

describe('planCommissionDelivery —— 交付规划（切片 C）', () => {
  const 委托 = {
    name: '清剿矿坑魔物',
    requireCard: { minTier: '白银' as const, formEntry: '召唤' },
    rewards: { gc: 120, reputation: 8, materials: [{ name: '魔物结晶', quantity: 2 }] },
  };
  const 合格卡 = { name: '远古巨兽·岩爪', cardTier: '鎏金' as const, 词条: ['召唤', '土'] };

  it('委托名不存在 → 明示原因', () => {
    const got = planCommissionDelivery({
      commissions: [委托],
      commissionName: '不存在的',
      card: 合格卡,
      playerName: '莱恩',
    });
    expect(got.ok).toBe(false);
    expect(got.reason).toContain('没有');
    expect(got.patches).toEqual([]);
  });
  it('背包无目标卡 → 明示原因', () => {
    const got = planCommissionDelivery({
      commissions: [委托],
      commissionName: '清剿矿坑魔物',
      card: undefined,
      playerName: '莱恩',
    });
    expect(got.ok).toBe(false);
    expect(got.reason).toContain('背包');
  });
  it('验收不过（品质/类型不符）→ 明示原因', () => {
    const 差卡 = { name: '燃魂打击', cardTier: '青铜' as const, 词条: ['技能', '火'] };
    const got = planCommissionDelivery({
      commissions: [委托],
      commissionName: '清剿矿坑魔物',
      card: 差卡,
      playerName: '莱恩',
    });
    expect(got.ok).toBe(false);
    expect(got.reason).toContain('不符合');
  });
  it('验收通过 → 上交 + 赏金 + 声望 + 素材全部在补丁里（原子同窗）', () => {
    const got = planCommissionDelivery({
      commissions: [委托],
      commissionName: '清剿矿坑魔物',
      card: 合格卡,
      playerName: '莱恩',
    });
    expect(got.ok).toBe(true);
    const ops = got.patches.map((p) => p.op);
    expect(ops[0]).toBe('remove_item'); // 上交第一
    expect(ops).toContain('delta_variable'); // 声望
    expect(got.patches.length).toBe(4); // remove + gc + reputation + material
    const rep = got.patches.find((p) => p.op === 'delta_variable');
    expect((rep as { target: string }).target).toBe('profile.reputation');
    expect((rep as { metadata?: { source?: string } }).metadata?.source).toBe('commission');
  });
});
