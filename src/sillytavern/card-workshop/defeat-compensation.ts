/**
 * defeat-compensation.ts — 战败补偿（SSS「世界线的收束点」的机制兑现，2026-09-17）
 *
 * 天赋描述：「凡是你战败的，都将成为滋养你的养分。每次战斗失败后，系统会从无数
 * "if线"中随机抽取三种"如果你赢了"的可能性，并将其中的奖励（如经验、金钱、掉落物）
 * 直接赋予给你。」
 *
 * 本模块产出**三条 if 线**与其实得奖励（纯函数，随机源由调用方注入）：
 * - 每条 if 线给一项奖励：经验 / 金钱 / 素材
 * - 三条里**只兑现一条**（随机选中）——「从无数 if 线中抽取三种可能，并赋予其中奖励」，
 *   读作「展示三种可能、实得一种」，与天赋的博弈感一致（若三条全给，奖励会翻三倍，
 *   压过其它 SSS）
 *
 * 由 `talent-hooks` 的 defeatRewardMultiplier 钩子门控（世界线的收束点已登记），
 * 接线在 game-pipeline 的交锋结算：败北时把实得奖励并入同窗 patch。
 */

import type { CardTier } from '../field-enums';
import type { Rarity } from '../field-enums';

/** 一条 if 线的奖励类型（模块内部形状） */
type IfLineRewardKind = 'exp' | 'gold' | 'material';

export interface IfLine {
  /** if 线的一句话（叙事展示用） */
  text: string;
  rewardKind: IfLineRewardKind;
  /** 经验值（rewardKind='exp'） */
  exp?: number;
  /** 金钱 GC（rewardKind='gold'） */
  gold?: number;
  /** 素材（rewardKind='material'） */
  material?: { name: string; quantity: number; rarity: Rarity };
}

export interface DefeatCompensationPlan {
  /** 展示给玩家的三条 if 线 */
  lines: IfLine[];
  /** 实际兑现的那条（lines 的下标） */
  grantedIndex: number;
  /** 实得奖励 */
  granted: IfLine;
  summary: string;
}

/** if 线的叙事壳（与玩家等级挂钩，让奖励量与剧情自洽） */
const IF_LINE_TEXTS: readonly string[] = [
  '如果你当时先出了那张卡——',
  '如果那一拍你退半步而不是硬顶——',
  '如果你在开战前多问了那个人一句——',
  '如果那阵风早来一刻——',
  '如果你把那件东西留在身上——',
];

/**
 * 规划一次战败补偿（纯函数）。
 *
 * @param playerLevel 玩家等级（决定奖励量级）
 * @param tier 玩家当前卡组最高档（决定素材品质；缺省白铁）
 * @param rng 随机源（默认 Math.random；测试注入固定值）
 */
export function planDefeatCompensation(
  playerLevel: number,
  tier: CardTier = '白铁',
  rng: () => number = Math.random,
): DefeatCompensationPlan {
  const lv = Math.max(1, Math.round(playerLevel) || 1);
  const rarityByTier: Record<CardTier, Rarity> = {
    白铁: '普通',
    青铜: '优良',
    白银: '稀有',
    鎏金: '史诗',
    星辉: '传说',
  };
  const rarity = rarityByTier[tier] ?? '普通';

  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];
  const lines: IfLine[] = [
    {
      text: pick(IF_LINE_TEXTS),
      rewardKind: 'exp',
      exp: 20 * lv,
    },
    {
      text: pick(IF_LINE_TEXTS),
      rewardKind: 'gold',
      gold: 15 * lv,
    },
    {
      text: pick(IF_LINE_TEXTS),
      rewardKind: 'material',
      material: { name: `${rarity}素材残片`, quantity: 2, rarity },
    },
  ];

  const grantedIndex = Math.floor(rng() * lines.length) % lines.length;
  const granted = lines[grantedIndex];
  const rewardText =
    granted.rewardKind === 'exp'
      ? `经验 +${granted.exp}`
      : granted.rewardKind === 'gold'
        ? `金钱 +${granted.gold} G`
        : `${granted.material?.name}×${granted.material?.quantity}`;

  return {
    lines,
    grantedIndex,
    granted,
    summary: [
      '【世界线的收束点】战败亦是养分——底石给你看了三条「如果你赢了」：',
      ...lines.map((l, i) => `  ${i + 1}. ${l.text}（${describeReward(l)}）`),
      `其中一条成了真的：${rewardText}`,
    ].join('\n'),
  };
}

/** 单条 if 线奖励的可读描述 */
export function describeReward(l: IfLine): string {
  if (l.rewardKind === 'exp') return `经验 +${l.exp}`;
  if (l.rewardKind === 'gold') return `金钱 +${l.gold} G`;
  return `${l.material?.name}×${l.material?.quantity}`;
}
