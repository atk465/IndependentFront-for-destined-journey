/**
 * skirmish-strength-anchor.test.ts — 交锋强度锚（WT6-1）
 *
 * 钉住导演时长锚的反推口径：三档敌方气血 ≥ 标称中位拍数 × 玩家单拍伤害（AI 叙事值
 * 保留为下限）、杂兵 1~2 拍、威胁随玩家战力缩放并夹逼。夹具取自 2026-10-02 真机实测
 * （atk 16、AI 给 HP 6/38/75 → 拍数 0/2/4 的失控现场）。
 */
import { describe, it, expect } from 'vitest';
import { anchorEnemyStrength, BEAT_ANCHORS, coerceDifficulty } from './skirmish-strength-anchor';

/** 以实测单拍伤害（atk 16 × 碾压余量 1.5 = 24/拍）折算锚后拍数，应落在标称区间内 */
function beatsOf(hp: number): number {
  return hp / 24;
}

describe('强度锚 —— 三档拍数落回标称区间（WT6-1）', () => {
  it('真机失控现场：爽战/标准/长战 AI 给 6/38/75 → 锚后拍数全部落在 3~5/4~8/6~10', () => {
    const cases = [
      { difficulty: '爽战', aiHp: 6, lo: 3, hi: 5 },
      { difficulty: '标准', aiHp: 38, lo: 4, hi: 8 },
      { difficulty: '长战', aiHp: 75, lo: 6, hi: 10 },
    ] as const;
    for (const c of cases) {
      const r = anchorEnemyStrength({
        difficulty: c.difficulty,
        playerAtk: 16,
        enemyLevel: 3,
        playerLevel: 4,
        aiHp: c.aiHp,
        aiThreats: [18],
      });
      const beats = beatsOf(r.enemyHp);
      expect(beats).toBeGreaterThanOrEqual(c.lo);
      expect(beats).toBeLessThanOrEqual(c.hi);
      expect(r.hpRaised).toBe(true);
    }
  });

  it('AI 叙事值更高时保留 AI 值（锚只兜底不削）', () => {
    const r = anchorEnemyStrength({
      difficulty: '标准',
      playerAtk: 16,
      enemyLevel: 5,
      playerLevel: 5,
      aiHp: 500,
      aiThreats: [20],
    });
    expect(r.enemyHp).toBe(500);
    expect(r.hpRaised).toBe(false);
  });

  it('杂兵（等级 < 玩家一半）：锚 1.5 拍，1~2 拍可清', () => {
    const r = anchorEnemyStrength({
      difficulty: '爽战',
      playerAtk: 16,
      enemyLevel: 1,
      playerLevel: 4,
      aiHp: 6,
      aiThreats: [10],
    });
    expect(r.minion).toBe(true);
    expect(r.anchorBeat).toBe(1.5);
    const beats = beatsOf(r.enemyHp);
    expect(beats).toBeGreaterThanOrEqual(1);
    expect(beats).toBeLessThanOrEqual(2);
  });

  it('脏难度兜底「标准」；标称表与交接文档口径一致', () => {
    expect(coerceDifficulty('胡说')).toBe('标准');
    expect(coerceDifficulty('长战')).toBe('长战');
    expect(BEAT_ANCHORS['爽战']).toEqual([3, 5]);
    expect(BEAT_ANCHORS['标准']).toEqual([4, 8]);
    expect(BEAT_ANCHORS['长战']).toEqual([6, 10]);
  });
});

describe('强度锚 —— 敌方战力锚（WT6-1 残留 1：不触发 ×2 碾压跳拍）', () => {
  it('非杂兵：enemyPower ≥ playerTotalPower / 1.8 → judgeCrush 必为 false', () => {
    // 真机现场：玩家综合 30，AI 给 enemyPower=2（Lv.2 兜底）→ 修复前 30≥4 照旧碾压跳拍
    const r = anchorEnemyStrength({
      difficulty: '爽战',
      playerAtk: 16,
      enemyLevel: 2,
      playerLevel: 4,
      aiHp: 60,
      aiThreats: [12],
      playerTotalPower: 30,
      aiPower: 2,
    });
    expect(r.powerRaised).toBe(true);
    expect(r.enemyPower).toBeGreaterThanOrEqual(Math.ceil(30 / 1.8)); // 17
    expect(r.enemyPower * 2).toBeGreaterThan(30); // 不满足 我方 ≥ 敌方×2
  });

  it('杂兵保留 AI 战力：被碾压速胜正是既定体验', () => {
    const r = anchorEnemyStrength({
      difficulty: '爽战',
      playerAtk: 16,
      enemyLevel: 1,
      playerLevel: 4,
      aiHp: 36,
      aiThreats: [8],
      playerTotalPower: 30,
      aiPower: 2,
    });
    expect(r.minion).toBe(true);
    expect(r.powerRaised).toBe(false);
    expect(r.enemyPower).toBe(2);
  });

  it('AI 战力已达标时不抬高；缺 aiPower 按 enemyLevel 兜底（parse 侧同款）', () => {
    const strong = anchorEnemyStrength({
      difficulty: '长战',
      playerAtk: 16,
      enemyLevel: 8,
      playerLevel: 8,
      aiHp: 192,
      aiThreats: [20],
      playerTotalPower: 30,
      aiPower: 40,
    });
    expect(strong.powerRaised).toBe(false);
    expect(strong.enemyPower).toBe(40);

    const fallback = anchorEnemyStrength({
      difficulty: '标准',
      playerAtk: 16,
      enemyLevel: 3,
      playerLevel: 4,
      aiHp: 144,
      aiThreats: [18],
    });
    expect(fallback.enemyPower).toBe(3); // 无 playerTotalPower → 不锚，仅兜底
  });
});

describe('强度锚 —— 威胁随玩家战力缩放', () => {
  it('高战力玩家（atk16）威胁 ×1.6：真机 16~29 → 26~46，反制不再必然成功', () => {
    const r = anchorEnemyStrength({
      difficulty: '标准',
      playerAtk: 16,
      enemyLevel: 3,
      playerLevel: 4,
      aiHp: 96,
      aiThreats: [16, 22, 29],
    });
    expect(r.threatFactor).toBeCloseTo(1.6);
    expect(r.threats).toEqual([26, 32, 32]); // 22×1.6=35、29×1.6=46 → 被上限 玩家行动值×2=32 夹住
  });

  it('夹逼：下限 3、上限玩家行动值×2；缩放系数夹 [0.5, 3]', () => {
    const r = anchorEnemyStrength({
      difficulty: '标准',
      playerAtk: 16,
      enemyLevel: 3,
      playerLevel: 4,
      aiHp: 96,
      aiThreats: [1, 999],
    });
    expect(r.threats[0]).toBe(3);
    expect(r.threats[1]).toBe(32); // 16×2

    const weak = anchorEnemyStrength({
      difficulty: '标准',
      playerAtk: 4,
      enemyLevel: 1,
      playerLevel: 1,
      aiHp: 24,
      aiThreats: [20],
    });
    expect(weak.threatFactor).toBe(0.5); // 4/10 → 下限 0.5
    expect(weak.threats).toEqual([8]); // 20×0.5=10 → 被上限 4×2=8 夹住

    const strong = anchorEnemyStrength({
      difficulty: '长战',
      playerAtk: 60,
      enemyLevel: 8,
      playerLevel: 8,
      aiHp: 480,
      aiThreats: [30],
    });
    expect(strong.threatFactor).toBe(3); // 60/10 → 上限 3
    expect(strong.threats).toEqual([90]); // 30×3=90 = 60×1.5 < ceil 120
  });

  it('威胁脏值按 1 兜底后再缩放（不产出 NaN）', () => {
    const r = anchorEnemyStrength({
      difficulty: '标准',
      playerAtk: 16,
      enemyLevel: 3,
      playerLevel: 4,
      aiHp: 96,
      aiThreats: [Number.NaN],
    });
    expect(r.threats).toEqual([3]); // NaN→1→1.6→round=2→夹下限3
  });
});
