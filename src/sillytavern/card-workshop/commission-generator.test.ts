/**
 * commission-generator.test.ts — 生成填充委托：素材池取自中层覆写表 / 品级分档 / 保洁补充
 */
import { describe, it, expect } from 'vitest';
import {
  GENERATED_COMMISSION_TARGET_COUNT,
  gradeForRank,
  generateFillerCommissions,
  refreshGeneratedCommissions,
  type GeneratorMidTier,
} from './commission-generator';
import { GENERATED_COMMISSION_TTL_DAYS } from './commission-active';

const NORTH: GeneratorMidTier = {
  id: 'mt-north',
  name: '北境雪原',
  gathering: {
    specialty: '雪莲',
    danger: 2,
    materialTable: {
      0: ['碎冰'],
      1: ['冰蚕丝'],
      2: ['雪莲'],
      3: ['极寒之心'],
      4: ['绝对零度结晶'],
    },
  },
};
const SOUTH: GeneratorMidTier = {
  id: 'mt-south',
  name: '南境火山',
  gathering: { materialTable: { 2: ['火晶'] } },
};

describe('gradeForRank（品质档 → 品级）', () => {
  it('0-1 档 D / 2 档 C / 3 档 B / 4 档也归 B（星辉档生成器不收进池）', () => {
    expect(gradeForRank(0)).toBe('D');
    expect(gradeForRank(1)).toBe('D');
    expect(gradeForRank(2)).toBe('C');
    expect(gradeForRank(3)).toBe('B');
    expect(gradeForRank(4)).toBe('B');
  });
});

describe('generateFillerCommissions', () => {
  it('生成到目标数；全部是 D/C/B 级素材委托，带目的地与 7 天时限', () => {
    const out = generateFillerCommissions({
      midTiers: [NORTH, SOUTH],
      count: 4,
      day: 100,
      rng: () => 0.5,
      existingNames: new Set(),
    });
    expect(out).toHaveLength(4);
    for (const gc of out) {
      expect(['D', 'C', 'B']).toContain(gc.def.grade);
      expect(gc.def.requireMaterial).toBeDefined();
      expect(gc.def.requireCard).toBeUndefined();
      expect(gc.def.requireVisit).toBeUndefined();
      expect(['mt-north', 'mt-south']).toContain(gc.def.destMidTier);
      expect(gc.def.deadlineDays).toBe(GENERATED_COMMISSION_TTL_DAYS);
      // 生成委托不写发布地（面板交付豁免）
      expect(gc.def.issuerMidTier).toBeUndefined();
      expect(gc.armedDay).toBe(100);
      expect(gc.expiresDay).toBe(100 + GENERATED_COMMISSION_TTL_DAYS);
    }
  });

  it('素材只出自覆写表（雪莲/火晶在池里；星辉档绝不出现）', () => {
    const out = generateFillerCommissions({
      midTiers: [NORTH, SOUTH],
      count: 10,
      day: 100,
      rng: Math.random,
      existingNames: new Set(),
    });
    const seen = new Set(out.map((gc) => gc.def.requireMaterial!.name));
    for (const material of seen) {
      expect(['碎冰', '冰蚕丝', '雪莲', '极寒之心', '火晶']).toContain(material);
    }
    expect(seen.has('绝对零度结晶')).toBe(false);
  });

  it('重名避开 existingNames（撞车加序号，不覆盖手写委托）', () => {
    const out = generateFillerCommissions({
      midTiers: [SOUTH],
      count: 3,
      day: 100,
      rng: () => 0.99, // 恒选池尾（rank 2 的火晶）
      existingNames: new Set(['火晶征集·南境火山']),
    });
    expect(out).toHaveLength(3);
    const unique = new Set(out.map((gc) => gc.def.name));
    expect(unique.size).toBe(3);
    expect(unique.has('火晶征集·南境火山')).toBe(false);
    expect(unique.has('火晶征集·南境火山·2')).toBe(true);
  });

  it('没写覆写表的中层不进池；全空 → 空数组（填充安静让位）', () => {
    expect(
      generateFillerCommissions({
        midTiers: [{ id: 'mt-bare', name: '无表中层' }],
        count: 4,
        day: 100,
        rng: Math.random,
        existingNames: new Set(),
      }),
    ).toEqual([]);
  });

  it('赏金随品级抬升（B 级下限高于 D 级上限）', () => {
    // 确定性循环随机源：依次命中池里 rank 0/1/2/3 四档（北境表恰有四档），不 flaky
    const cycle = [0.05, 0.3, 0.55, 0.8];
    let i = 0;
    const rng = () => cycle[i++ % cycle.length];
    const out = generateFillerCommissions({
      midTiers: [NORTH],
      count: 24,
      day: 100,
      rng,
      existingNames: new Set(['碎冰征集·北境雪原']),
    });
    const bRanks = out.filter((gc) => gc.def.grade === 'B');
    const dRanks = out.filter((gc) => gc.def.grade === 'D');
    for (const gc of bRanks) expect(gc.def.rewards.gc!).toBeGreaterThanOrEqual(200);
    for (const gc of dRanks) expect(gc.def.rewards.gc!).toBeLessThan(80);
    expect(bRanks.length).toBeGreaterThan(0);
    expect(dRanks.length).toBeGreaterThan(0);
  });
});

describe('refreshGeneratedCommissions（保洁 + 补充）', () => {
  it('过期摘除、未过期保留、补到目标数', () => {
    const existing = [
      {
        def: { name: '旧的', requireMaterial: { name: '碎冰', count: 1 }, rewards: {} },
        armedDay: 90,
        expiresDay: 97, // 今天 100 → 已过期
      },
      {
        def: { name: '还在', requireMaterial: { name: '雪莲', count: 1 }, rewards: {} },
        armedDay: 95,
        expiresDay: 102, // 还活着
      },
    ];
    const { kept, generated } = refreshGeneratedCommissions({
      existing,
      midTiers: [NORTH, SOUTH],
      today: 100,
      rng: Math.random,
      reservedNames: new Set(),
    });
    expect(kept.map((gc) => gc.def.name)).toEqual(['还在']);
    expect(kept.length + generated.length).toBe(GENERATED_COMMISSION_TARGET_COUNT);
    expect(generated.every((gc) => gc.armedDay === 100)).toBe(true);
  });

  it('在板生成委托的名占用命名空间（补充不与自己撞名）', () => {
    const existing = [
      {
        def: { name: '碎冰征集·北境雪原', requireMaterial: { name: '碎冰', count: 1 }, rewards: {} },
        armedDay: 96,
        expiresDay: 103,
      },
    ];
    const { kept, generated } = refreshGeneratedCommissions({
      existing,
      midTiers: [NORTH],
      today: 100,
      rng: () => 0.001, // 恒选池首（碎冰）
      reservedNames: new Set(),
      count: 3,
    });
    expect(kept).toHaveLength(1);
    const names = new Set([...kept, ...generated].map((gc) => gc.def.name));
    expect(names.size).toBe(3);
  });

  it('reservedNames（手写/事件/进行中）占用命名空间', () => {
    const { generated } = refreshGeneratedCommissions({
      existing: [],
      midTiers: [SOUTH],
      today: 100,
      rng: () => 0.99,
      reservedNames: new Set(['火晶征集·南境火山']),
      count: 2,
    });
    expect(generated).toHaveLength(2);
    for (const gc of generated) expect(gc.def.name).not.toBe('火晶征集·南境火山');
  });
});
