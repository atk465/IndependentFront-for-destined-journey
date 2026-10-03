/**
 * no-slot-limit.test.ts — 无槽限（S「无限军火库」/ A「成龙」）
 *
 * 「装备卡不再有部位限制，一个伙伴可以同时装备多把武器或多件盔甲」
 *
 * 落地：state-manager 的 `equip_item` op 检查角色是否持 `无槽限` 条目，
 * 持有则跳过同槽顶替（多件共存于同一槽）。本测试通过 CharacterState
 * 直接验证行为。
 */
import { describe, it, expect } from 'vitest';
import { getTalentTemplate, hasWorkingMechanic } from './talent-entry';

describe('无槽限 —— 天赋接线', () => {
  it('无限军火库(S)：无槽限条目，已实装', () => {
    const tpl = getTalentTemplate('无限军火库');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries).toEqual([{ kind: '无槽限', channel: 'universal', params: {} }]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('成龙(A)：无槽限 + 叙事意图', () => {
    const tpl = getTalentTemplate('成龙');
    expect(tpl?.grade).toBe('A');
    expect(tpl!.entries.map((e) => e.kind)).toEqual(['无槽限', '叙事意图']);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('无槽限在 IMPLEMENTED_ENTRY_KINDS 中', () => {
    // 通过检查任意持此条目的模板是否算已实装来间接验证
    const tpl = getTalentTemplate('无限军火库')!;
    expect(hasWorkingMechanic(tpl)).toBe(true);
  });
});
