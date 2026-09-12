/**
 * craft-card.test.ts — 制卡桥（阶段 3b）：名单解析 / 素材解析 / 确定性组装
 */
import { describe, it, expect } from 'vitest';
import {
  isHighTierCard,
  parseMaterialNames,
  resolveMaterialSpecs,
  buildCardItem,
} from './craft-card';
import type { InventoryItem } from '../types';

describe('parseMaterialNames（craftParams.materials 名单）', () => {
  it('顿号/逗号/分号/换行都认', () => {
    expect(parseMaterialNames('火晶、疾风羽，寒水珠;玄铁')).toEqual([
      '火晶',
      '疾风羽',
      '寒水珠',
      '玄铁',
    ]);
    expect(parseMaterialNames('火晶\n疾风羽')).toEqual(['火晶', '疾风羽']);
  });
  it('空白项剔除；undefined/空串 → 空数组', () => {
    expect(parseMaterialNames('火晶、 、，')).toEqual(['火晶']);
    expect(parseMaterialNames(undefined)).toEqual([]);
    expect(parseMaterialNames('')).toEqual([]);
  });
});

describe('resolveMaterialSpecs（对照背包，查不到跳过）', () => {
  const inventory: InventoryItem[] = [
    { name: '火晶', quantity: 1, type: '材料', data: { price: 20 } },
    { name: '疾风羽', quantity: 1, type: '材料' },
  ];
  it('按名单顺序产出 MaterialSpec（首个为主素材）', () => {
    const specs = resolveMaterialSpecs(['火晶', '疾风羽'], inventory);
    expect(specs.map((s) => s.name)).toEqual(['火晶', '疾风羽']);
    expect(specs[0].price).toBe(20); // data.price 优先
  });
  it('查不到的名字跳过，不抛错', () => {
    expect(resolveMaterialSpecs(['幽灵素材', '疾风羽'], inventory).map((s) => s.name)).toEqual([
      '疾风羽',
    ]);
  });
});

describe('isHighTierCard（鎏金/星辉才带封印物）', () => {
  it.each([
    ['白铁', false],
    ['青铜', false],
    ['白银', false],
    ['鎏金', true],
    ['星辉', true],
  ] as const)('%s → %s', (tier, sealed) => {
    expect(isHighTierCard(tier)).toBe(sealed);
  });
});

describe('buildCardItem（数值全部来自融合内核）', () => {
  const 火晶 = { name: '火晶', price: 20, tier: 1, elements: ['火'] };
  const 风羽 = { name: '风羽', tier: 1, price: 10, elements: ['风'] };

  it('火+风 相生：升档青铜 + 燎原词条 + 造价公式', () => {
    const card = buildCardItem({
      productName: '燎原符卡',
      description: '一团被驯服的野火',
      quantity: 1,
      quality: '稀有',
      rating: '精益求精',
      materialSpecs: [火晶, 风羽],
    });
    expect(card.type).toBe('卡牌');
    expect(card.cardTier).toBe('青铜'); // 主白铁 +1
    expect(card.词条).toContain('燎原');
    expect(card.recipe.cost).toBe(Math.round((20 + 10) * 1.6)); // 48
    expect(card.recipe.fusionKind).toBe('相生');
    expect(card.recipe.rating).toBe('精益求精'); // 沿用 craft 链实际评级
    expect(card.sealed).toBe(false); // 青铜无封印物
    expect(card.rarity).toBe('稀有'); // 7 级展示面与卡牌 tier 正交
  });
  it('鎏金产物自带封印（sealed=true）；星辉同理', () => {
    const 史诗料 = { name: '地脉髓', price: 400, tier: 4, elements: ['土'] };
    expect(
      buildCardItem({
        productName: '厚土之卡',
        quantity: 1,
        quality: '史诗',
        rating: '成功',
        materialSpecs: [史诗料],
      }),
    ).toMatchObject({ cardTier: '鎏金', sealed: true });
    const 星辉料 = { name: '星核', price: 900, tier: 5, elements: ['光'] };
    expect(
      buildCardItem({
        productName: '星辉之卡',
        quantity: 1,
        quality: '传说',
        rating: '成功',
        materialSpecs: [星辉料],
      }),
    ).toMatchObject({ cardTier: '星辉', sealed: true });
  });
  it('主素材缺失兜底：白铁无素卡，不炸', () => {
    const card = buildCardItem({
      productName: '空白卡',
      quantity: 2,
      quality: '普通',
      rating: '成功',
      materialSpecs: [],
    });
    expect(card.cardTier).toBe('白铁');
    expect(card.quantity).toBe(2);
    expect(card.recipe.mainMaterial).toBe('空白卡');
  });
  it('数量钳制 ≥1；脏数量兜底 1', () => {
    const base = {
      productName: '卡',
      quality: '普通' as const,
      rating: '成功' as const,
      materialSpecs: [火晶],
    };
    expect(buildCardItem({ ...base, quantity: 0 }).quantity).toBe(1);
    expect(buildCardItem({ ...base, quantity: 3 }).quantity).toBe(3);
    expect(buildCardItem({ ...base, quantity: Number.NaN }).quantity).toBe(1);
  });
});
