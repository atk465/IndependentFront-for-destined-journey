/**
 * talent-rule-hooks.test.ts —— 规则层钩子边界覆盖（倒也可斩/素材扩展）
 */
import { describe, it, expect } from 'vitest';
import {
  daYeJaZhan,
  collectMaterialExpansions,
  RULE_MATERIAL_EXPANSIONS,
} from './talent-rule-hooks';
import type { TalentNameLike } from './talent-rule-hooks';

const T = (name: string): TalentNameLike => ({ name });

describe('daYeJaZhan —— 倒也可斩', () => {
  it('敌方 HP 砍半、玩家 HP/MP 90% 代价、本拍跳过', () => {
    const r = daYeJaZhan(200, 100, 50);
    expect(r.ok).toBe(true);
    expect(r.enemyDamagePercent).toBe(50);
    expect(r.lines.some((l) => l.includes('传说大剑豪一刀斩落'))).toBe(true);
    expect(r.lines.some((l) => l.includes('−100（200 → 100）'))).toBe(true);
    expect(r.lines.some((l) => l.includes('HP 100 → 10'))).toBe(true);
  });
  it('HP 1 时扣血代价 clamp 到 1（不产生负数）', () => {
    const r = daYeJaZhan(100, 1, 10);
    expect(r.lines.some((l) => l.includes('HP 1 → 0'))).toBe(true);
  });
});

describe('collectMaterialExpansions —— 素材扩展', () => {
  it('以人为本 → 失能生命；血伶人 → 活体', () => {
    const classes = collectMaterialExpansions([T('以人为本'), T('血伶人')]);
    expect(classes).toContain('失能生命');
    expect(classes).toContain('活体');
  });
  it('多渠道不重复', () => {
    const classes = collectMaterialExpansions([T('以人为本'), T('以人为本')]);
    expect(classes.filter((c) => c === '失能生命')).toHaveLength(1);
  });
  it('无规则天赋 → 空数组', () => {
    expect(collectMaterialExpansions(undefined)).toEqual([]);
    expect(collectMaterialExpansions([])).toEqual([]);
  });
  it('RULE_MATERIAL_EXPANSIONS 单一真源：四条规则钩子', () => {
    expect(RULE_MATERIAL_EXPANSIONS).toHaveLength(4);
  });
});
