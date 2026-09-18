/**
 * gathering.ts — 采集与垂钓（2026-09-18）
 *
 * 引擎此前没有「采集」「垂钓」这类资源获取动作——海底捞月(S)、深海垂钓者(B)、
 * 冰渊垂钓者(C)、野外生存(C)、矿工之友(D) 都卡在这里。
 *
 * 本模块提供**环境驱动的资源获取纯函数**：
 *  - `planGather(environment, talents, rng)` → 1~3 份素材（品质由环境+天赋决定）
 *  - `planFish(waterDepth, talents, rng)` → 0~2 条渔获（垃圾~稀有）
 *
 * 设计要点：
 *  - **不依赖地图系统**：环境名由调用方传入（AI 从叙事判断或地图地块属性）
 *  - **天赋加成通过条目读取**，不硬编码天赋名
 *  - **品质分布由环境加权**：不同环境产出不同倾向的素材
 *
 * 纯度约束：纯函数、不 mutate、随机源由调用方注入。
 */

import type { Rarity } from '../field-enums';
import { RARITY_LEVELS } from '../field-enums';

// ════════════════════════════════════════════════════════════════════
// 环境
// ════════════════════════════════════════════════════════════════════

/** 采集环境（加环境 = 加一行数据） */
export const GATHER_ENVIRONMENTS = [
  '森林',
  '矿山',
  '水域',
  '冰原',
  '沙漠',
  '沼泽',
  '通用',
] as const;
export type GatherEnvironment = (typeof GATHER_ENVIRONMENTS)[number];

/** 环境素材名称映射（产出物前缀） */
const ENV_MATERIAL_PREFIX: Record<GatherEnvironment, string> = {
  森林: '草药',
  矿山: '矿石',
  水域: '水产',
  冰原: '霜晶',
  沙漠: '砂晶',
  沼泽: '沼泥',
  通用: '野生素材',
};

/** 环境品质偏移（矿山/冰原偏高品质，通用偏低） */
const ENV_QUALITY_OFFSET: Record<GatherEnvironment, number> = {
  森林: 0,
  矿山: 1,
  水域: 0,
  冰原: 1,
  沙漠: 0,
  沼泽: -1,
  通用: -1,
};

// ════════════════════════════════════════════════════════════════════
// 天赋加成
// ════════════════════════════════════════════════════════════════════

/** 采集加成（读自天赋条目） */
export interface GatherBonus {
  /** 品质提升档数（0 = 无加成） */
  qualityBoost: number;
  /** 额外产出概率（%，0 = 无） */
  extraChance: number;
}

/** 从天赋条目读取采集加成 */
export function gatherBonusOf(
  talents:
    | readonly { entries?: readonly { kind: string; params: Record<string, unknown> }[] }[]
    | undefined,
): GatherBonus {
  let qualityBoost = 0;
  let extraChance = 0;
  for (const t of talents ?? []) {
    for (const e of t.entries ?? []) {
      if (e.kind === '采集强化') {
        qualityBoost += Math.max(0, Math.round(Number(e.params.qualityBoost) || 0));
        extraChance += Math.max(0, Math.round(Number(e.params.extraChance) || 0));
      }
    }
  }
  return { qualityBoost, extraChance };
}

/** 垂钓加成（读自天赋条目） */
export interface FishBonus {
  /** 深水加成（0 = 无；提高好东西概率） */
  depthBonus: number;
  /** 稀有捕获概率提升（%） */
  rareChance: number;
}

export function fishBonusOf(
  talents:
    | readonly { entries?: readonly { kind: string; params: Record<string, unknown> }[] }[]
    | undefined,
): FishBonus {
  let depthBonus = 0;
  let rareChance = 0;
  for (const t of talents ?? []) {
    for (const e of t.entries ?? []) {
      if (e.kind !== '垂钓强化') continue;
      depthBonus += Math.max(0, Math.round(Number(e.params.depthBonus) || 0));
      rareChance += Math.max(0, Math.round(Number(e.params.rareChance) || 0));
    }
  }
  return { depthBonus, rareChance };
}

// ════════════════════════════════════════════════════════════════════
// 采集
// ════════════════════════════════════════════════════════════════════

export interface GatherResult {
  /** 产出的素材列表 */
  items: { name: string; rarity: Rarity; quantity: number }[];
  summary: string;
}

/** 品质索引 → Rarity */
function rarityAt(rank: number): Rarity {
  return RARITY_LEVELS[Math.max(0, Math.min(RARITY_LEVELS.length - 2, rank))] ?? '普通';
}

/**
 * 采集（纯函数）。
 *
 * @param environment 采集环境（决定素材名前缀和品质偏移）
 * @param bonus 天赋加成
 * @param playerLevel 玩家等级（影响基础品质）
 * @param rng 随机源（0..1）
 */
export function planGather(
  environment: GatherEnvironment,
  bonus: GatherBonus,
  playerLevel: number,
  rng: () => number = Math.random,
): GatherResult {
  const count = 1 + Math.floor(rng() * 3); // 1~3 份
  const baseRank = Math.max(0, Math.min(4, Math.floor(playerLevel / 5))); // 等级→品质 0..4
  const envOffset = ENV_QUALITY_OFFSET[environment] ?? 0;
  const prefix = ENV_MATERIAL_PREFIX[environment] ?? '野生素材';

  const items: GatherResult['items'] = [];
  for (let i = 0; i < count; i++) {
    const rank = Math.max(
      0,
      Math.min(4, baseRank + envOffset + bonus.qualityBoost + (rng() < 0.2 ? 1 : 0)),
    );
    const rarity = rarityAt(rank);
    items.push({ name: `${prefix}（${rarity}）`, rarity, quantity: 1 });
  }

  // 额外产出
  if (bonus.extraChance > 0 && rng() * 100 < bonus.extraChance) {
    const rank = Math.max(0, Math.min(4, baseRank + envOffset + bonus.qualityBoost));
    items.push({
      name: `${prefix}（额外）（${rarityAt(rank)}）`,
      rarity: rarityAt(rank),
      quantity: 1,
    });
  }

  const parts = items.map((i) => `${i.name}×${i.quantity}`);
  return { items, summary: parts.join('、') };
}

// ════════════════════════════════════════════════════════════════════
// 垂钓
// ════════════════════════════════════════════════════════════════════

export interface FishResult {
  /** 0 = 什么也没钓到 */
  caught: boolean;
  items: { name: string; rarity: Rarity; quantity: number }[];
  summary: string;
}

/**
 * 垂钓（纯函数）。
 *
 * @param depth 水体深度（1=浅水 / 2=深水 / 3=深渊；影响品质）
 * @param bonus 垂钓天赋加成
 * @param rng 随机源
 */
export function planFish(
  depth: number,
  bonus: FishBonus,
  rng: () => number = Math.random,
): FishResult {
  const d = Math.max(1, Math.min(3, Math.round(depth) || 1));
  const emptyChance = 0.3 - d * 0.05; // 深水空手概率低
  const roll = rng();

  if (roll < emptyChance) {
    return { caught: false, items: [], summary: '什么也没钓到。' };
  }

  const count = 1 + (rng() < 0.2 ? 1 : 0); // 20% 双渔获
  const baseRank = d + bonus.depthBonus; // 深水 + 天赋 → 高品质
  const items: FishResult['items'] = [];
  for (let i = 0; i < count; i++) {
    const rank = Math.max(0, Math.min(4, baseRank + (rng() < 0.3 ? 1 : 0)));
    const rarity = rarityAt(rank);
    items.push({ name: `渔获（${rarity}）`, rarity, quantity: 1 });
  }

  // 稀有捕获
  const rareRoll = rng();
  if (rareRoll < 0.1 + bonus.rareChance / 100) {
    const rare = rarityAt(Math.min(4, baseRank + 1));
    items.push({ name: `稀有渔获（${rare}）`, rarity: rare, quantity: 1 });
  }

  return { caught: true, items, summary: items.map((i) => `${i.name}×${i.quantity}`).join('、') };
}
