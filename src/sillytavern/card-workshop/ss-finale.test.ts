/**
 * ss-finale.test.ts — SS 收尾八条（2026-09-18）
 *
 * 本名武器管道（天生剑骨/战意破苍穹）、同契经验同步（爱）、
 * 鬼话连篇/绝对母权/永恒航路/卡组生态（通道复用或降档）、千秋证果（名字钩子）。
 */
import { describe, it, expect } from 'vitest';
import {
  SOUL_WEAPON_TYPES,
  findSoulWeapon,
  planSoulWeapon,
  shouldUpgradeSoulWeapon,
  soulWeaponTierForLevel,
} from './soul-weapon';
import { getTalentTemplate, hasWorkingMechanic, TALENT_CATALOG } from './talent-entry';
import { collectRuleHooks, statMultiplierOf } from './talent-hooks';
import { CARD_TIERS } from '../field-enums';

describe('本名武器 —— 纯函数', () => {
  it('武器类型表：剑/弓（加类型 = 加一行）', () => {
    expect([...SOUL_WEAPON_TYPES]).toEqual(['剑', '弓']);
  });

  it('档位按 tierForLevel 从等级换算', () => {
    expect(soulWeaponTierForLevel(1)).toBe('白铁');
    expect(soulWeaponTierForLevel(9)).toBe('白银');
    expect(soulWeaponTierForLevel(17)).toBe('星辉');
  });

  it('生成：词条含「本名」+ 武器类型，data.soulBound = 持有者', () => {
    const 剑 = planSoulWeapon('我', '剑', 12);
    expect(剑.词条).toContain('本名');
    expect(剑.词条).toContain('剑');
    expect(剑.词条).toContain('装备');
    expect(剑.cardTier).toBe('白银');
    expect((剑.data as Record<string, unknown>).soulBound).toBe('我');
    // 弓：预设名「麒麟殒天弓」+ 因果词条
    const 弓 = planSoulWeapon('我', '弓', 12);
    expect(弓.name).toBe('麒麟殒天弓');
    expect(弓.词条).toContain('因果');
  });

  it('自定名覆盖预设名', () => {
    expect(planSoulWeapon('我', '剑', 5, '斩月').name).toBe('斩月');
  });

  it('升档判定：档位低于等级应给的 → 需要升', () => {
    const 白铁剑 = planSoulWeapon('我', '剑', 4);
    expect(shouldUpgradeSoulWeapon(白铁剑, 9)).toBe(true); // 白铁→白银
    expect(shouldUpgradeSoulWeapon(白铁剑, 4)).toBe(false); // 同级不升
    expect(shouldUpgradeSoulWeapon(undefined, 9)).toBe(false); // 无卡不算升（走生成）
  });

  it('从背包找本名武器：soulBound 或「本名」词条都认', () => {
    const inv = [{ type: '材料', name: '矿' }, planSoulWeapon('我', '剑', 4)];
    expect(findSoulWeapon(inv, '我')?.name).toBe('本名剑');
    expect(findSoulWeapon([], '我')).toBeUndefined();
  });

  it('档位永远在 CARD_TIERS 内（只升不降的上界）', () => {
    for (const lv of [1, 10, 100]) {
      expect(CARD_TIERS).toContain(soulWeaponTierForLevel(lv));
    }
  });
});

describe('SS 收尾 —— 天赋接线', () => {
  it('天生剑骨：本名武器(剑) + 品质突破(剑类) + 叙事', () => {
    const tpl = getTalentTemplate('天生剑骨（东方）');
    expect(tpl!.entries.map((e) => e.kind)).toEqual(['本名武器', '品质突破', '叙事意图']);
    expect(tpl!.entries[0].params).toEqual({ weapon: '剑' });
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('战意破苍穹：本名武器(弓)', () => {
    const tpl = getTalentTemplate('战意破苍穹');
    expect(tpl!.entries).toEqual([
      { kind: '本名武器', channel: 'universal', params: { weapon: '弓' } },
    ]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('鬼话连篇：成品限定非伙伴 + 叙事（主人公成伙伴由 AI 裁量）', () => {
    const tpl = getTalentTemplate('鬼话连篇');
    expect(tpl!.entries.map((e) => e.kind)).toEqual(['成品限定', '叙事意图']);
    expect(tpl!.entries[0].params).toEqual({ productClass: '非伙伴卡' });
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('爱：同契（syncPct 50）+ 叙事（首召免材/性转由 AI 演绎）', () => {
    const tpl = getTalentTemplate('爱');
    expect(tpl!.entries.map((e) => e.kind)).toEqual(['同契', '叙事意图']);
    expect(tpl!.entries[0].params).toEqual({ syncPct: 50 });
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('绝对母权：守护/母爱必附 + 威压 + 叙事（母爱惩戒）', () => {
    const tpl = getTalentTemplate('绝对母权');
    expect(tpl!.entries.map((e) => e.kind)).toEqual(['词条加权', '威压', '叙事意图']);
    const 加权 = tpl!.entries[0];
    expect(加权.params.weight).toBe(3);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('千秋证果：statMultiplier 1.5 名字钩子（属性高一档那半）', () => {
    const hooks = collectRuleHooks([{ name: '千秋证果' }]);
    expect(statMultiplierOf(hooks)).toBe(1.5);
    expect(hasWorkingMechanic(getTalentTemplate('千秋证果')!)).toBe(true); // 名字钩子路径
  });

  it('永恒航路 / 卡组生态：有意的叙事降档（描述注释写明）', () => {
    for (const name of ['永恒航路', '卡组生态']) {
      const tpl = getTalentTemplate(name);
      expect(
        tpl!.entries.map((e) => e.kind),
        name,
      ).toEqual(['叙事意图']);
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });
});

describe('SS 收官 —— 全品级体质', () => {
  it('八条全部离开「仅叙事」', () => {
    for (const name of [
      '天生剑骨（东方）',
      '战意破苍穹',
      '鬼话连篇',
      '爱',
      '绝对母权',
      '千秋证果',
      '永恒航路',
      '卡组生态',
    ]) {
      const tpl = TALENT_CATALOG.find((t) => t.name === name);
      expect(tpl, name).toBeDefined();
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });

  it('SS 已实装数不低于 46（本批推进的硬底线——SS 收官）', () => {
    const ss = TALENT_CATALOG.filter((t) => t.grade === 'SS');
    expect(ss.filter(hasWorkingMechanic).length).toBeGreaterThanOrEqual(46);
  });
});
