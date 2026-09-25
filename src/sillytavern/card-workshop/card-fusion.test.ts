/**
 * card-fusion.ts 单元测试（卡牌工坊确定性融合内核）
 */
import { describe, it, expect } from 'vitest';
import {
  fuse,
  classifyFusion,
  computeTier,
  computeCost,
  expectedRating,
  deriveEntries,
  materialTierToCardTier,
  rollCraftRating,
  CLASH_DISCOUNT,
  CARD_TIER_COEFFICIENT,
  type MaterialSpec,
} from './card-fusion';

const 火草: MaterialSpec = { name: '炎心草', price: 28, tier: 2, elements: ['火'] };
const 风羽: MaterialSpec = { name: '疾风羽', price: 30, tier: 2, elements: ['风'] };
const 寒泉: MaterialSpec = { name: '寒泉露', price: 26, tier: 2, elements: ['水'] };
const 玄铁: MaterialSpec = { name: '玄铁锭', price: 40, tier: 3, elements: ['金'] };

describe('materialTierToCardTier', () => {
  it('1-5 映射到 5 级品质', () => {
    expect(materialTierToCardTier(1)).toBe('白铁');
    expect(materialTierToCardTier(3)).toBe('白银');
    expect(materialTierToCardTier(5)).toBe('星辉');
  });
  it('越界被夹取', () => {
    expect(materialTierToCardTier(0)).toBe('白铁');
    expect(materialTierToCardTier(99)).toBe('星辉');
  });
});

describe('classifyFusion', () => {
  it('无副素材 → 叠加', () => {
    expect(classifyFusion(火草, [])).toBe('叠加');
  });
  it('同类元素副素材 → 叠加', () => {
    expect(classifyFusion(火草, [火草])).toBe('叠加');
  });
  it('相生元素对 → 相生', () => {
    expect(classifyFusion(火草, [风羽])).toBe('相生');
  });
  it('相克元素对 → 相克', () => {
    expect(classifyFusion(火草, [寒泉])).toBe('相克');
  });
  it('无关异元素（无相生无相克）→ 叠加', () => {
    // 火 + 金 不在表中 → 中性叠加
    expect(classifyFusion(火草, [玄铁])).toBe('叠加');
  });
});

describe('computeTier', () => {
  it('相生品质 +1', () => {
    expect(computeTier(火草, [风羽], '相生')).toBe('白银'); // 主 tier=2(青铜) +1
  });
  it('叠加/相克 不升级', () => {
    expect(computeTier(火草, [], '叠加')).toBe('青铜'); // 主 tier=2
    expect(computeTier(火草, [寒泉], '相克')).toBe('青铜');
  });
  it('相生上限封顶', () => {
    const 星辉料: MaterialSpec = { name: '星核', price: 999, tier: 5, elements: ['火'] };
    const 风料: MaterialSpec = { name: '星风', price: 999, tier: 5, elements: ['风'] };
    expect(computeTier(星辉料, [风料], '相生')).toBe('星辉');
  });
});

describe('computeCost', () => {
  it('叠加造价 = 售价和 × 系数', () => {
    const tier = computeTier(火草, [], '叠加');
    expect(computeCost(火草, [], tier, '叠加')).toBe(
      Math.round((28 + 0) * CARD_TIER_COEFFICIENT[tier]),
    );
  });
  it('相克造价 ×0.7 折扣', () => {
    const tier = computeTier(火草, [寒泉], '相克'); // 相克
    const 无折 = Math.round((28 + 26) * CARD_TIER_COEFFICIENT[tier]);
    expect(computeCost(火草, [寒泉], tier, '相克')).toBe(Math.round(无折 * CLASH_DISCOUNT));
  });
  it('副素材超过 2 只取前 2', () => {
    const r = fuse(火草, [风羽, 寒泉, 玄铁]);
    expect(r.subMaterials.length).toBe(2);
  });
});

describe('expectedRating / deriveEntries', () => {
  it('相生 → 精益求精 + 复合词条', () => {
    expect(expectedRating('相生')).toBe('精益求精');
    const 词条 = deriveEntries(火草, [风羽], '相生');
    expect(词条).toContain('燎原'); // 火+风 复合
    expect(词条).toContain('火');
    expect(词条).toContain('风');
  });
  it('叠加 → 成功，无复合词条', () => {
    expect(expectedRating('叠加')).toBe('成功');
    expect(deriveEntries(火草, [], '叠加')).toEqual(['火']);
  });
  it('相克 → 失败', () => {
    expect(expectedRating('相克')).toBe('失败');
  });
});

describe('fuse 端到端', () => {
  it('相生融合产出来自确定性输入', () => {
    const r = fuse(火草, [风羽]);
    expect(r.fusionKind).toBe('相生');
    expect(r.tier).toBe('白银'); // 主 tier=2(青铜) +1
    expect(r.rating).toBe('精益求精');
    expect(r.词条).toContain('燎原');
  });
  it('相克融合带折扣且基础失败', () => {
    const r = fuse(火草, [寒泉]);
    expect(r.fusionKind).toBe('相克');
    expect(r.rating).toBe('失败');
  });
});

describe('rollCraftRating', () => {
  it('成功基础：掷骰 >=6 保成功，否则失败', () => {
    expect(rollCraftRating('成功', 6)).toBe('成功');
    expect(rollCraftRating('成功', 5)).toBe('失败');
    expect(rollCraftRating('成功', 20)).toBe('成功');
  });
  it('相克失败基础：仅 nat 18-20 救回', () => {
    expect(rollCraftRating('失败', 17)).toBe('失败');
    expect(rollCraftRating('失败', 18)).toBe('成功');
    expect(rollCraftRating('失败', 20)).toBe('成功');
  });
  it('精益求精基础：>=10 保精益求精', () => {
    expect(rollCraftRating('精益求精', 10)).toBe('精益求精');
    expect(rollCraftRating('精益求精', 9)).toBe('成功');
  });
  it('大失败不可救回', () => {
    expect(rollCraftRating('大失败', 20)).toBe('大失败');
  });
  it('掷骰越界被夹取', () => {
    expect(rollCraftRating('成功', 0)).toBe('失败');
    expect(rollCraftRating('成功', 999)).toBe('成功');
  });
});
