import { describe, it, expect } from 'vitest';
import { RARITY_LEVELS, type Rarity } from '../field-enums';
import {
  ENVIRONMENT_TABLE,
  FISH_SP_COST,
  FISH_TIME_MINUTES,
  GATHER_SP_COST,
  GATHER_TIME_MINUTES,
  planFish,
  planGather,
  riskDCFor,
  rollRiskEvent,
  type GatherEnvironment,
} from './gathering';
import { getTalentTemplate, hasWorkingMechanic, TALENT_CATALOG } from './talent-entry';

describe('ENVIRONMENT_TABLE', () => {
  it('六种环境全覆盖', () => {
    expect(Object.keys(ENVIRONMENT_TABLE)).toEqual(['森林', '矿山', '水域', '冰原', '沙漠', '沼泽']);
  });
  it('每个环境有特产+危险系数+素材表', () => {
    for (const [env, def] of Object.entries(ENVIRONMENT_TABLE)) {
      expect(def.specialty.length, env).toBeGreaterThan(0);
      expect(def.danger).toBeGreaterThanOrEqual(0);
      expect(Object.keys(def.materialTable).length, `${env} 素材表`).toBeGreaterThan(0);
    }
  });
});

describe('planGather', () => {
  const env: GatherEnvironment = '森林';
  const noBonus = { qualityBoost: 0, extraChance: 0 };

  it('产出 1~3 份素材', () => {
    const r = planGather(env, noBonus, 10, () => 0.5);
    expect(r.items.length).toBeGreaterThanOrEqual(1);
    expect(r.items.length).toBeLessThanOrEqual(3);
  });

  it('时间和体力消耗', () => {
    const r = planGather(env, noBonus, 10);
    expect(r.timeCost).toBe(GATHER_TIME_MINUTES);
    expect(r.staminaCost).toBe(GATHER_SP_COST);
  });

  it('summary 非空', () => {
    expect(planGather(env, noBonus, 10).summary.length).toBeGreaterThan(0);
  });

  it('天赋品质加成生效', () => {
    const rank = (r: Rarity) => RARITY_LEVELS.indexOf(r);
    const noBoost = planGather(env, noBonus, 5, () => 0.5);
    const boosted = planGather(env, { qualityBoost: 2, extraChance: 0 }, 5, () => 0.5);
    for (let i = 0; i < boosted.items.length; i++) {
      if (i < noBoost.items.length) {
        expect(rank(boosted.items[i].rarity)).toBeGreaterThanOrEqual(rank(noBoost.items[i].rarity));
      }
    }
  });
});

describe('planFish', () => {
  const noBonus = { depthBonus: 0, rareChance: 0 };

  it('浅水可能空手', () => {
    let found = false;
    for (let i = 0; i < 100; i++) {
      const r = planFish(1, noBonus, () => i / 100);
      if (!r.caught) { found = true; break; }
    }
    expect(found).toBe(true);
  });

  it('深水能钓到', () => {
    expect(planFish(3, noBonus, () => 0.5).caught).toBe(true);
  });

  it('消耗时间', () => {
    const r = planFish(2, noBonus, () => 0.5);
    expect(r.timeCost).toBe(FISH_TIME_MINUTES);
    expect(r.staminaCost).toBe(FISH_SP_COST);
  });

  it('summary 非空', () => {
    expect(planFish(2, noBonus, () => 0.5).summary.length).toBeGreaterThan(0);
  });
});

describe('rollRiskEvent / riskDCFor', () => {
  it('连续 3 次起才有风险', () => {
    expect(riskDCFor(0, '森林')).toBe(0);
    expect(riskDCFor(2, '森林')).toBe(0);
    expect(riskDCFor(3, '森林')).toBeGreaterThan(0);
  });

  it('DC 递增', () => {
    expect(riskDCFor(4, '森林')).toBeGreaterThan(riskDCFor(3, '森林'));
  });

  it('DC clamp 到 18', () => {
    expect(riskDCFor(99, '森林')).toBeLessThanOrEqual(18);
  });

  it('环境危险系数影响 DC', () => {
    expect(riskDCFor(3, '沼泽')).toBeGreaterThan(riskDCFor(3, '森林'));
  });

  it('触发→有事件类型', () => {
    const r = rollRiskEvent(1, 15, '森林');
    if (r.triggered) expect(r.eventType).toBeDefined();
  });
});

describe('天赋接线', () => {
  it('采集强化和垂钓强化条目种类存在且已实装', () => {
    for (const kind of ['采集强化', '垂钓强化'] as const) {
      const hits = TALENT_CATALOG.filter((t) => t.entries.some((e) => e.kind === kind));
      expect(hits.length, kind).toBeGreaterThan(0);
      for (const t of hits) {
        expect(hasWorkingMechanic(t), `${kind}/${t.name}`).toBe(true);
      }
    }
  });

  it('海底捞月(S)：采集强化 + 叙事', () => {
    const tpl = getTalentTemplate('海底捞月');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries.map((e) => e.kind)).toEqual(['采集强化', '叙事意图']);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('野外生存(C)：采集强化', () => {
    const tpl = getTalentTemplate('野外生存');
    expect(tpl?.grade).toBe('C');
    expect(tpl!.entries).toEqual([{ kind: '采集强化', channel: 'universal', params: { qualityBoost: 1, extraChance: 0 } }]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('深海垂钓者(B)：垂钓强化 + 配方解锁', () => {
    const tpl = getTalentTemplate('深海垂钓者');
    expect(tpl?.grade).toBe('B');
    expect(tpl!.entries.map((e) => e.kind)).toEqual(['垂钓强化', '配方解锁']);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('冰渊垂钓者(C)：垂钓强化', () => {
    const tpl = getTalentTemplate('冰渊垂钓者');
    expect(tpl?.grade).toBe('C');
    expect(tpl!.entries).toEqual([{ kind: '垂钓强化', channel: 'universal', params: { depthBonus: 1, rareChance: 15 } }]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });
});
