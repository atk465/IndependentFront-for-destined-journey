/**
 * 交锋强度锚（values-table 批次6 / 2026-10-02 工单 WT6-1）。
 *
 * 🔴 设计真源 = **导演时长锚**（拍数标称区间）：爽战 3~5 / 标准 4~8 / 长战 6~10 拍，
 * 杂兵 1~2 拍清。此前敌人生成（skirmish_eval）自由给 HP/威胁，实测三档拍数 0/2/4——
 * 全部只有应有量级的一半或更少，档位失去区分度。
 *
 * 反推口径：敌方气血下限 = 标称中位拍数 × 玩家单拍伤害（单拍伤害以主轴行动值为代理，
 * 实测偏差 ~±20% 且方向偏保守）；AI 叙事给的 HP 保留为**下限**（AI 说这东西皮糙就真
 * 皮糙，锚只兜底不削）。威胁值随玩家战力缩放（AI 的数值以低战力基线校准，高战力玩家
 * 面前反制必然成功 → 威胁 ×(玩家行动值/基线)），夹逼 [3, 玩家行动值×2]。
 *
 * 杂兵判定：敌方等级 < 玩家等级一半 → 杂兵（锚 1.5 拍），不套档位区间。
 *
 * 纯函数叶：零 I/O、零时钟、零 Math.random。
 */

export type SkirmishDifficulty = '爽战' | '标准' | '长战';

import { CRUSH_RATIO } from './skirmish';

/** 单拍伤害的碾压余量系数：实战单拍 ≈ 行动值 × 1.5（2026-10-02 第三轮实测 24/16） */
const CRUSH_SURPLUS = 1.5;

/** 档位 → 标称拍数区间（设计真源，交接文档 §六 验收口径） */
export const BEAT_ANCHORS: Readonly<Record<SkirmishDifficulty, readonly [number, number]>> = {
  爽战: [3, 5],
  标准: [4, 8],
  长战: [6, 10],
};

/** 威胁缩放的基线行动值：AI 给的威胁值以这个战力量级校准 */
const THREAT_BASELINE_ATK = 10;

/** 杂兵的拍数锚（1~2 拍清，取中位 1.5） */
const MINION_ANCHOR_BEATS = 1.5;

export function coerceDifficulty(v: unknown): SkirmishDifficulty {
  return v === '爽战' || v === '长战' ? v : '标准';
}

export interface StrengthAnchorInput {
  difficulty: unknown;
  /** 玩家主轴行动值（单拍伤害的代理） */
  playerAtk: number;
  enemyLevel: number;
  playerLevel: number;
  /** AI 叙事给的敌方气血（保留为下限） */
  aiHp: number;
  /** AI 给的各招式威胁值（随战力缩放的对象） */
  aiThreats: readonly number[];
  /** 玩家综合战力（三维 + 卡组；碾压判定与敌方战力锚的基准） */
  playerTotalPower?: number;
  /** AI 估的敌方战力（碾压判定用；脏值由调用方按 enemyLevel 兜底） */
  aiPower?: number;
}

export interface StrengthAnchorResult {
  difficulty: SkirmishDifficulty;
  enemyHp: number;
  threats: number[];
  /** 本场采用的拍数锚（杂兵 = 1.5） */
  anchorBeat: number;
  /** 敌方等级 < 玩家一半 → 杂兵 */
  minion: boolean;
  /** 气血是否被锚抬高（AI 值已达标则为 false） */
  hpRaised: boolean;
  /** 威胁缩放系数（供战报/日志留痕） */
  threatFactor: number;
  /** 锚后的敌方战力（非杂兵保证不触发 ×2 碾压跳拍；杂兵保留 AI 值可被碾压速胜） */
  enemyPower: number;
  /** 敌方战力是否被锚抬高 */
  powerRaised: boolean;
}

export function anchorEnemyStrength(input: StrengthAnchorInput): StrengthAnchorResult {
  const difficulty = coerceDifficulty(input.difficulty);
  const atk = Math.max(0, Math.round(input.playerAtk));
  // 单拍伤害含**期望碾压余量**（实测 ≈ 1.5×行动值：2026-10-02 第三轮 120 HP ÷ 5 拍 = 24/拍
  // vs atk 16）——纯行动值是保守下界，长战只够 5 拍（WT6-1 残留 2）。
  const beatDamage = Math.max(1, Math.round(atk * CRUSH_SURPLUS));
  const playerLevel = Math.max(1, Math.round(input.playerLevel));
  const enemyLevel = Math.max(1, Math.round(input.enemyLevel));

  const minion = enemyLevel * 2 < playerLevel;
  const [lo, hi] = BEAT_ANCHORS[difficulty];
  const anchorBeat = minion ? MINION_ANCHOR_BEATS : (lo + hi) / 2;
  const anchorHp = Math.max(1, Math.round(anchorBeat * beatDamage));
  const enemyHp = Math.max(Math.max(1, Math.round(input.aiHp)), anchorHp);

  // 威胁随玩家战力缩放：基线 10 行动值；夹逼 [3, 玩家行动值×2]（绝不高于两拍必反制的量级）
  const threatFactor = Math.min(3, Math.max(0.5, atk / THREAT_BASELINE_ATK));
  const threatCeil = Math.max(3, atk * 2);
  const threats = input.aiThreats.map((t) => {
    const base = typeof t === 'number' && Number.isFinite(t) ? t : 1;
    return Math.min(threatCeil, Math.max(3, Math.round(base * threatFactor)));
  });

  // 敌方战力锚（WT6-1 残留 1）：非杂兵保证不触发 ×2 碾压跳拍——
  // enemyPower ≥ playerTotalPower / (CRUSH_RATIO − 0.2)，留 0.2 余量而非贴着阈值。
  // 杂兵保留 AI 值：被碾压速胜正是杂兵的既定体验。
  const aiPowerRaw = Math.max(0, Math.round(input.aiPower ?? enemyLevel));
  const powerFloor =
    !minion && input.playerTotalPower !== undefined && input.playerTotalPower > 0
      ? Math.ceil(Math.max(1, input.playerTotalPower) / (CRUSH_RATIO - 0.2))
      : 0;
  const enemyPower = Math.max(aiPowerRaw, powerFloor);

  return {
    difficulty,
    enemyHp,
    threats,
    anchorBeat,
    minion,
    hpRaised: enemyHp > Math.round(input.aiHp),
    threatFactor,
    enemyPower,
    powerRaised: enemyPower > aiPowerRaw,
  };
}
