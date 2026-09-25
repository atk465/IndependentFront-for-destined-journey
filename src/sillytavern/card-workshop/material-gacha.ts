/**
 * material-gacha.ts — 素材抽奖内核（S「素材十连系统」）
 *
 * 天赋描述：「每天获得一次免费的素材十连抽机会，保底获得一张不低于自身等级的
 * 稀有素材，有极小概率抽出高阶突变词条。」
 *
 * 三段兑现：
 * 1. **十连**：一次抽 `times` 发（条目档位），每发按权重落在稀有度上；
 * 2. **保底**：整批里至少一份稀有度 ≥ `floorRarity`（由玩家等级换算）——
 *    保底不靠"最后一发必出"，而是**抽完后补齐**，所以前面抽得好也不吃亏；
 * 3. **突变**：极小概率（`MUTATION_CHANCE`）抽到「突变素材」——带一条高阶突变词条的
 *    特殊素材，是这批货里唯一能上桌的东西。
 *
 * 权重口径（初稿，数值总表终审对象）：越稀有越难，但保底会把整批的下限托住。
 *
 * 纯度约束：纯函数、不 mutate、随机源由调用方注入（测试可确定）。
 */

import { RARITY_LEVELS, type Rarity } from '../field-enums';
import { TIER_TO_RARITY } from './card-dismantle';
import { tierForLevel } from './companion-capture';

/** 抽奖结果：一发（形状只在模块内与 store 的返回映射上用） */
interface GachaRoll {
  rarity: Rarity;
  /** 是否是突变素材（带高阶突变词条） */
  mutated: boolean;
  /** 突变词条名（未突变 = 空） */
  mutationEntry?: string;
}

export interface GachaResult {
  rolls: GachaRoll[];
  /** 保底补齐出的那一发（若有），便于审计「这批为什么有稀有」 */
  floorFilled: boolean;
  /** 本批最低/最高稀有度（面板一行摘要） */
  lowest: Rarity;
  highest: Rarity;
  /** 突变发数 */
  mutatedCount: number;
  summary: string;
}

/** 突变概率（「极小概率」；初稿 3%） */
export const MUTATION_CHANCE = 0.03;

/** 突变词条池（内容侧可再命名；这里是机械标签） */
const MUTATION_ENTRIES: readonly string[] = ['噬魂', '不息', '逆生', '渊默', '焚天', '无垢'];

/**
 * 基础权重：稀有度越高越难抽。**与保底配合**——保底把整批下限托住，
 * 所以这张表可以放心做得陡。
 */
const RARITY_WEIGHTS: Record<Rarity, number> = {
  普通: 40,
  优良: 30,
  稀有: 18,
  史诗: 8,
  传说: 3,
  神话: 1,
  唯一: 0,
};

/** 按权重滚一次稀有度（d100 由 rng 产出） */
function rollRarity(rng: () => number): Rarity {
  const roll = Math.max(1, Math.min(100, Math.floor(rng() * 100) + 1));
  let acc = 0;
  for (const rarity of RARITY_LEVELS) {
    acc += RARITY_WEIGHTS[rarity] ?? 0;
    if (roll <= acc) return rarity;
  }
  return '普通';
}

/** 稀有度序号（比较用） */
function rankOf(rarity: Rarity): number {
  return RARITY_LEVELS.indexOf(rarity);
}

/**
 * 等级 → 保底稀有度（「不低于自身等级」）。
 *
 * 走**卡档**这条既有映射：等级 → `CardTier`（白铁…星辉）→ `Rarity`。
 * 与 companion-capture 的 `tierForLevel`、拆解的 `TIER_TO_RARITY` 同源，
 * 不在抽奖里另起一套等级口径。
 */
export function floorRarityForLevel(level: number): Rarity {
  const lv = Number.isFinite(level) ? Math.max(1, Math.round(level)) : 1;
  return TIER_TO_RARITY[tierForLevel(lv)] ?? '优良';
}

/**
 * 抽一批素材（纯函数）。
 *
 * @param times 抽几发（素材十连 = 10）
 * @param floorRarity 保底稀有度（整批至少一份 ≥ 它）
 * @param rng 随机源（默认 Math.random）
 */
export function planMaterialGacha(
  times: number,
  floorRarity: Rarity,
  rng: () => number = Math.random,
): GachaResult {
  const count = Math.max(1, Math.min(50, Math.round(times) || 1));
  const rolls: GachaRoll[] = [];
  for (let i = 0; i < count; i++) {
    const mutated = rng() < MUTATION_CHANCE;
    rolls.push({
      rarity: rollRarity(rng),
      mutated,
      ...(mutated
        ? {
            mutationEntry:
              MUTATION_ENTRIES[
                Math.floor(rng() * MUTATION_ENTRIES.length) % MUTATION_ENTRIES.length
              ],
          }
        : {}),
    });
  }

  // 保底：整批里若有 ≥ floor 的就不动；否则把**最差的那一发**提升到保底档
  const floorRank = rankOf(floorRarity);
  let floorFilled = false;
  const hasFloor = rolls.some((r) => rankOf(r.rarity) >= floorRank);
  if (!hasFloor && floorRank > 0) {
    let worst = 0;
    for (let i = 1; i < rolls.length; i++) {
      if (rankOf(rolls[i].rarity) < rankOf(rolls[worst].rarity)) worst = i;
    }
    rolls[worst] = { ...rolls[worst], rarity: floorRarity };
    floorFilled = true;
  }

  const ranks = rolls.map((r) => rankOf(r.rarity));
  const lowest = RARITY_LEVELS[Math.min(...ranks)];
  const highest = RARITY_LEVELS[Math.max(...ranks)];
  const mutatedCount = rolls.filter((r) => r.mutated).length;

  const parts = [`${count} 连：最低 ${lowest}、最高 ${highest}`];
  if (floorFilled) parts.push(`保底补齐至 ${floorRarity}`);
  if (mutatedCount > 0) parts.push(`突变 ${mutatedCount} 发`);
  return {
    rolls,
    floorFilled,
    lowest,
    highest,
    mutatedCount,
    summary: parts.join('，'),
  };
}
