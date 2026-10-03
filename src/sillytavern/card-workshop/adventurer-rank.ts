/**
 * adventurer-rank.ts — 冒险者等级 = 声望的纯派生（不落库）
 *
 * 为什么是派生而不是字段：声望（SaveProfile.reputation）是唯一真相来源，
 * 「声望到阈值自动更新等级」用纯函数映射天然成立 —— 声望一变，派生结果即变，
 * 不存在同步、不落库、无第二真相来源（铁律 4）。
 *
 * 历史注记：原 CharacterState.adventurerRank 字段（逐角色存字符串）已删除，
 * 由本模块取代 —— 旧档里的残留字符串原样留在存档中，不再有任何读口。
 *
 * 纯度约束：无 I/O、无 Dexie、无 Vue。
 */

/** 一档称号：达到 min 声望即持有该称号（取满足阈值的最高档） */
export interface AdventurerRankTier {
  /** 声望下限（含） */
  min: number;
  /** 称号名（与旧字段口径一致：'未评级' | D | C | B | A | S） */
  name: string;
}

/**
 * 阈值表（升序）。量级对齐委托奖励：单次委托 4~15 声望 ——
 * D 级约 3~5 次小委托，S 级需要长期经营。
 */
export const ADVENTURER_RANK_TIERS: readonly AdventurerRankTier[] = [
  { min: 0, name: '未评级' },
  { min: 20, name: 'D' },
  { min: 60, name: 'C' },
  { min: 150, name: 'B' },
  { min: 350, name: 'A' },
  { min: 700, name: 'S' },
] as const;

/**
 * 声望 → 冒险者等级称号。取满足阈值的**最高**一档。
 * 负数/非法值安全回落到「未评级」（声望写入口已钳非负，这里是双保险）。
 */
export function rankForReputation(reputation: number): string {
  const rep =
    typeof reputation === 'number' && Number.isFinite(reputation) && reputation > 0
      ? Math.floor(reputation)
      : 0;
  let current = ADVENTURER_RANK_TIERS[0].name;
  for (const tier of ADVENTURER_RANK_TIERS) {
    if (rep >= tier.min) current = tier.name;
    else break;
  }
  return current;
}

/**
 * 距下一档还差多少（UI 进度提示用）。已在最高档 → null。
 */
export function nextRankGap(reputation: number): { name: string; remaining: number } | null {
  const rep =
    typeof reputation === 'number' && Number.isFinite(reputation) && reputation > 0
      ? Math.floor(reputation)
      : 0;
  for (let i = 0; i < ADVENTURER_RANK_TIERS.length; i++) {
    const tier = ADVENTURER_RANK_TIERS[i];
    if (rep < tier.min) {
      return { name: tier.name, remaining: tier.min - rep };
    }
  }
  return null;
}
