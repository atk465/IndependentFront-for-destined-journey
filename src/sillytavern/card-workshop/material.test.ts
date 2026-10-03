/**
 * material.ts 单元测试 — 库存物品 → MaterialSpec 的确定性映射
 */
import { describe, it, expect } from 'vitest';
import {
  ELEMENT_KEYWORDS,
  itemTierToMaterialTier,
  materialPriceOf,
  deriveElements,
  registerMaterialElements,
  clearMaterialElementOverrides,
  toMaterial,
} from './material';
import type { InventoryItem } from '../types';

function item(over: Partial<InventoryItem> = {}): InventoryItem {
  return { name: '无名素材', quantity: 1, ...over };
}

describe('itemTierToMaterialTier（7 级品质 → 1-5）', () => {
  it('前五档逐级对齐', () => {
    expect(itemTierToMaterialTier(item({ rarity: '普通' }))).toBe(1);
    expect(itemTierToMaterialTier(item({ rarity: '优良' }))).toBe(2);
    expect(itemTierToMaterialTier(item({ rarity: '稀有' }))).toBe(3);
    expect(itemTierToMaterialTier(item({ rarity: '史诗' }))).toBe(4);
    expect(itemTierToMaterialTier(item({ rarity: '传说' }))).toBe(5);
  });
  it('神话/唯一封顶 5；缺 rarity 兜底 1', () => {
    expect(itemTierToMaterialTier(item({ rarity: '神话' }))).toBe(5);
    expect(itemTierToMaterialTier(item({ rarity: '唯一' }))).toBe(5);
    expect(itemTierToMaterialTier(item())).toBe(1);
  });
});

describe('materialPriceOf（data.price 优先，否则 10×tier 估价）', () => {
  it('读 data.price 并取整', () => {
    expect(materialPriceOf(item({ data: { price: 27.6 } }))).toBe(28);
  });
  it('非法/负数/缺失 price 一律回落估价', () => {
    expect(materialPriceOf(item({ rarity: '稀有' }))).toBe(30);
    expect(materialPriceOf(item({ data: { price: -3 } }))).toBe(10);
    expect(materialPriceOf(item({ data: { price: '贵' } }))).toBe(10);
    expect(materialPriceOf(item({ data: { price: Number.NaN } }))).toBe(10);
  });
});

describe('deriveElements（名字 + 效果词条命中元素关键词）', () => {
  it('名字命中元素', () => {
    expect(deriveElements(item({ name: '火焰草' }))).toEqual(['火']);
    expect(deriveElements(item({ name: '冰河水晶' }))).toEqual(['水', '冰']);
  });
  it('效果词条名也参与命中；无命中返回空', () => {
    expect(deriveElements(item({ effects: { 雷蚀: '麻痹' } }))).toEqual(['雷']);
    expect(deriveElements(item({ name: '鹅卵石' }))).toEqual([]);
  });
  it('元素关键词表覆盖融合内核相生/相克全部元素', () => {
    // 火+风/冰+水/金+雷/光+水 相生；水+火/暗+光/土+风 相克
    for (const e of ['火', '水', '风', '冰', '金', '雷', '光', '暗', '土']) {
      expect(ELEMENT_KEYWORDS).toContain(e);
    }
  });
  it('素材元素档案优先于名字推导（2026-09-25：采集素材名多不含元素字）', () => {
    registerMaterialElements({ 世界树嫩芽: ['风'], 精灵花: ['光'], 脏值: [] });
    expect(deriveElements(item({ name: '世界树嫩芽' }))).toEqual(['风']);
    expect(deriveElements(item({ name: '精灵花' }))).toEqual(['光']);
    // 未登记的名字回落关键词推导
    expect(deriveElements(item({ name: '火焰草' }))).toEqual(['火']);
    clearMaterialElementOverrides();
    expect(deriveElements(item({ name: '世界树嫩芽' }))).toEqual([]);
  });
});

describe('toMaterial（端到端形状）', () => {
  it('产出 MaterialSpec 四件套', () => {
    const spec = toMaterial(item({ name: '疾风羽', rarity: '优良', data: { price: 30 } }));
    expect(spec).toEqual({ name: '疾风羽', price: 30, tier: 2, elements: ['风'] });
  });
});
