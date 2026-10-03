/**
 * talent-rule-modifiers.test.ts —— 规则层确定性修正覆盖
 */
import { describe, it, expect } from 'vitest';
import {
  totalChainBonus,
  totalKillGc,
  totalIntimidation,
  hasTitanPhysique,
  hasBetterRoll,
  totalCopies,
} from './talent-rule-modifiers';
import type { TalentEntry } from './talent-entry';

const E = (kind: string, amount?: number): TalentEntry =>
  ({ kind, params: amount !== undefined ? { amount } : {} }) as unknown as TalentEntry;

describe('规则层确定性修正', () => {
  it('totalChainBonus：连战递增合计', () => {
    expect(totalChainBonus([E('连战递增', 3), E('连战递增', 2)])).toBe(5);
    expect(totalChainBonus([])).toBe(0);
  });
  it('totalKillGc：击杀掠取赏金合计', () => {
    const 击杀10: TalentEntry = {
      kind: '击杀掠取',
      channel: 'universal',
      params: { gold: 10 },
    } as never;
    const 击杀5: TalentEntry = {
      kind: '击杀掠取',
      channel: 'universal',
      params: { gold: 5 },
    } as never;
    expect(totalKillGc([击杀10, 击杀5])).toBe(15);
    expect(totalKillGc([])).toBe(0);
  });
  it('totalIntimidation：威压百分比合计', () => {
    const 威压30: TalentEntry = {
      kind: '威压',
      channel: 'universal',
      params: { percent: 30 },
    } as never;
    expect(totalIntimidation([威压30])).toBe(30);
    expect(totalIntimidation([])).toBe(0);
  });
  it('hasTitanPhysique / hasBetterRoll / totalCopies', () => {
    const 体魄: TalentEntry = { kind: '体魄', channel: 'universal', params: {} } as never;
    const 判定: TalentEntry = { kind: '判定取优', channel: 'universal', params: {} } as never;
    expect(hasTitanPhysique([体魄])).toBe(true);
    expect(hasTitanPhysique([])).toBe(false);
    expect(hasBetterRoll([判定])).toBe(true);
    const 产出: TalentEntry = {
      kind: '产出数量',
      channel: 'universal',
      params: { copies: 3 },
    } as never;
    expect(totalCopies([产出])).toBe(3);
  });
});
