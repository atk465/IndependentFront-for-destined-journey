/**
 * unsealing.test.ts — 启封判定边界逐格覆盖（卡牌工坊 阶段 2）
 *
 * 判定必须可回放：同骰值同输入 → 同结果；本文件同时是 DC/分级边界的文档。
 */
import { describe, it, expect } from 'vitest';
import {
  UNSEAL_DC,
  UNSEAL_SLOT_COST,
  CLASH_DC_BONUS,
  sealBreaks,
  willModifierOf,
  unsealDC,
  judgeUnseal,
} from './unsealing';
import type { CardTier } from '../field-enums';

const 卡 = (tier: CardTier, fusionKind: '叠加' | '相生' | '相克' = '叠加') => ({
  cardTier: tier,
  recipe: { fusionKind },
});

describe('数值表（单一真源）', () => {
  it('封印 DC 五档单调上升', () => {
    expect(UNSEAL_DC).toEqual({ 白铁: 8, 青铜: 11, 白银: 14, 鎏金: 17, 星辉: 20 });
  });
  it('启封槽位成本：鎏金/星辉要 2 个动作槽', () => {
    expect(UNSEAL_SLOT_COST).toEqual({ 白铁: 1, 青铜: 1, 白银: 1, 鎏金: 2, 星辉: 2 });
  });
  it('相克 DC +3', () => {
    expect(unsealDC(卡('白银'))).toBe(14);
    expect(unsealDC(卡('白银', '相克'))).toBe(14 + CLASH_DC_BONUS);
    expect(unsealDC(卡('星辉', '相生'))).toBe(20); // 相生不加值
  });
});

describe('willModifierOf（意志修正 = floor((精神-10)/2)）', () => {
  it('两端与中性', () => {
    expect(willModifierOf({ spi: 8 })).toBe(-1);
    expect(willModifierOf({ spi: 10 })).toBe(0);
    expect(willModifierOf({ spi: 20 })).toBe(5);
  });
  it('脏数据兜底按 10（修正 0）', () => {
    expect(willModifierOf(undefined)).toBe(0);
    expect(willModifierOf({})).toBe(0);
    expect(willModifierOf({ spi: Number.NaN })).toBe(0);
  });
});

describe('judgeUnseal 分级边界（willMod=0，DC 8 白铁）', () => {
  const 白铁 = 卡('白铁'); // DC 8
  it.each([
    [8, '启封'], // margin 0
    [7, '哑火'], // margin -1
    [5, '哑火'], // margin -3
    [4, '暴走'], // margin -4
  ] as const)('d20=%i → %s', (roll, kind) => {
    expect(judgeUnseal(白铁, roll, 0).kind).toBe(kind);
  });
  it('margin 六条边界：0 / -1 / -3 → 启封·哑火·哑火', () => {
    expect(judgeUnseal(白铁, 8, 0)).toEqual({ kind: '启封', margin: 0 });
    expect(judgeUnseal(白铁, 7, 0)).toEqual({ kind: '哑火', margin: -1 });
    expect(judgeUnseal(白铁, 5, 0)).toEqual({ kind: '哑火', margin: -3 });
  });
  it('margin 边界：-4 / -7 / -8 → 暴走·暴走·反噬（星辉 DC 20）', () => {
    const 星辉 = 卡('星辉');
    expect(judgeUnseal(星辉, 16, 0)).toEqual({ kind: '暴走', margin: -4 });
    expect(judgeUnseal(星辉, 13, 0)).toEqual({ kind: '暴走', margin: -7 });
    expect(judgeUnseal(星辉, 12, 0)).toEqual({ kind: '反噬', margin: -8 });
  });
});

describe('边界规则：nat 20 / nat 1', () => {
  it('nat 20 自动突破——即便星辉+相克 DC 23、修正为负', () => {
    const 恶卡 = 卡('星辉', '相克'); // DC 23
    const r = judgeUnseal(恶卡, 20, -1);
    expect(r.kind).toBe('启封');
    expect(r.margin).toBe(-4); // margin 仍如实记录
  });
  it('nat 1 必定抗命：名义 margin 为正也压成哑火（封印物反噬意志最黑的时刻）', () => {
    expect(judgeUnseal(卡('白铁'), 1, 10).kind).toBe('哑火'); // 名义 margin +3
  });
  it('nat 1 按 margin 分档：白铁 nat1 → 暴走（margin -7）；星辉 nat1 → 反噬（margin -19）', () => {
    expect(judgeUnseal(卡('白铁'), 1, 0)).toEqual({ kind: '暴走', margin: -7 });
    expect(judgeUnseal(卡('星辉'), 1, 0)).toEqual({ kind: '反噬', margin: -19 });
  });
});

describe('sealBreaks（哑火保封印，其余破裂）', () => {
  it.each([
    ['启封', true],
    ['哑火', false],
    ['暴走', true],
    ['反噬', true],
  ] as const)('%s → 封印破裂 %s', (kind, breaks) => {
    expect(sealBreaks({ kind, margin: 0 })).toBe(breaks);
  });
});

describe('纯函数不变式', () => {
  it('不 mutate 入参、同骰值同结果（可回放）', () => {
    const 卡片 = 卡('鎏金', '相克');
    const snapshot = JSON.stringify(卡片);
    const a = judgeUnseal(卡片, 14, 2);
    const b = judgeUnseal(卡片, 14, 2);
    expect(a).toEqual(b);
    expect(JSON.stringify(卡片)).toBe(snapshot);
  });
  it('骰值越界收拢到 1..20（防御调用方）', () => {
    expect(judgeUnseal(卡('白铁'), 0, 0)).toEqual(judgeUnseal(卡('白铁'), 1, 0));
    expect(judgeUnseal(卡('白铁'), 99, 0)).toEqual(judgeUnseal(卡('白铁'), 20, 0));
  });
});
