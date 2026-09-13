/**
 * repair.test.ts — 修复系统（契约召唤 C' 制）：配方校验 / 强化词条 / 品质跃迁
 */
import { describe, it, expect } from 'vitest';
import {
  DAMAGED_FLAG,
  REPAIR_RECIPE,
  UPGRADE_ATTRIBUTE_DELTA,
  isDamaged,
  isRepairable,
  validateRepairMaterials,
  planRepair,
} from './repair';
import type { CardItem, InventoryItem } from '../types';

function material(name: string, rarity: keyof typeof tierByRarity): InventoryItem {
  return { name, quantity: 1, type: '材料', rarity };
}
const tierByRarity = {
  普通: 1,
  优良: 2,
  稀有: 3,
  史诗: 4,
  传说: 5,
} as const;

function card(
  tier: CardItem['cardTier'],
  词条: string[],
): Pick<CardItem, 'name' | 'cardTier' | '词条' | 'data'> {
  return { name: '测试卡', cardTier: tier, 词条, data: { [DAMAGED_FLAG]: true } };
}

describe('isDamaged / isRepairable', () => {
  it('data.damaged 判定', () => {
    expect(isDamaged({ data: { damaged: true } })).toBe(true);
    expect(isDamaged({ data: {} })).toBe(false);
    expect(isDamaged({})).toBe(false);
  });
  it('素材卡不可修复；未损坏不可修复', () => {
    expect(isRepairable({ 词条: ['素材'], data: { damaged: true } })).toBe(false);
    expect(isRepairable({ 词条: ['火', '召唤'], data: {} })).toBe(false);
    expect(isRepairable({ 词条: ['火', '召唤'], data: { damaged: true } })).toBe(true);
  });
});

describe('validateRepairMaterials（模板配方）', () => {
  it('白铁：2 份 ≥普通素材', () => {
    expect(
      validateRepairMaterials('白铁', [material('甲', '普通'), material('乙', '普通')]).ok,
    ).toBe(true);
    expect(validateRepairMaterials('白铁', [material('甲', '普通')]).ok).toBe(false);
  });
  it('白银：4 份且 ≥优良；劣质素材计入不足', () => {
    const good = [
      material('甲', '优良'),
      material('乙', '稀有'),
      material('丙', '优良'),
      material('丁', '史诗'),
    ];
    expect(validateRepairMaterials('白银', good).ok).toBe(true);
    const withWeak = [...good.slice(1), material('劣', '普通')];
    expect(validateRepairMaterials('白银', withWeak).ok).toBe(false);
  });
});

describe('planRepair（修复 + 强化 + 跃迁）', () => {
  it('无额外素材：纯修复（清损坏标记，无词条/跃迁）', () => {
    const r = planRepair(
      card('白银', ['火', '地景']),
      [
        material('甲', '优良'),
        material('乙', '稀有'),
        material('丙', '优良'),
        material('丁', '史诗'),
      ],
      [],
    );
    expect(r.ok).toBe(true);
    expect(r.plan.cardData[DAMAGED_FLAG]).toBe(false);
    expect(r.plan.upgraded).toBe(false);
    expect(r.plan.newTier).toBe('白银');
    expect(r.plan.new词条).toEqual([]);
  });
  it('额外素材：元素并入 + 相生复合（风素材 + 已有火 → 燎原）', () => {
    const r = planRepair(
      card('青铜', ['火']),
      [material('甲', '普通'), material('乙', '普通'), material('丙', '普通')],
      [material('疾风草', '普通')],
    );
    expect(r.ok).toBe(true);
    expect(r.plan.new词条).toContain('风');
    expect(r.plan.new词条).toContain('燎原'); // 火×风 相生复合
    expect(r.plan.upgraded).toBe(false);
  });
  it('越级喂养：素材稀有度高于卡品质 → 升一档 + 属性包', () => {
    // 青铜卡（档1）+ 传说素材（素材档4=鎏金位）→ 跃迁白银
    const r = planRepair(
      card('青铜', ['火']),
      [material('甲', '普通'), material('乙', '普通'), material('丙', '普通')],
      [material('星髓', '传说')],
    );
    expect(r.plan.upgraded).toBe(true);
    expect(r.plan.newTier).toBe('白银');
    expect(r.plan.attributeDelta).toEqual(UPGRADE_ATTRIBUTE_DELTA);
    expect(r.plan.cardData[DAMAGED_FLAG]).toBe(false);
  });
  it('跃迁一次一档：星辉素材喂青铜也只到白银（溢出浪费）', () => {
    const r = planRepair(
      card('青铜', ['火']),
      [material('甲', '普通'), material('乙', '普通'), material('丙', '普通')],
      [material('星核', '传说')],
    );
    expect(r.plan.newTier).toBe('白银');
  });
  it('顶档不跃迁：星辉卡喂传说素材保持星辉', () => {
    const r = planRepair(
      card('星辉', ['火']),
      [
        material('甲', '传说'),
        material('乙', '传说'),
        material('丙', '传说'),
        material('丁', '传说'),
        material('戊', '传说'),
        material('己', '传说'),
      ],
      [material('星核', '传说')],
    );
    expect(r.plan.upgraded).toBe(false);
    expect(r.plan.newTier).toBe('星辉');
  });
  it('模板不足 → 校验失败、计划为纯修复基线（不抛）', () => {
    const r = planRepair(card('星辉', ['火']), [], [material('星核', '传说')]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('素材不足');
    expect(r.plan.upgraded).toBe(false);
  });
});
