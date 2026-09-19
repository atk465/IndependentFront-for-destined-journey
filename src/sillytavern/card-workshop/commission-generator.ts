/**
 * commission-generator.ts — 生成填充委托（委托×地图闭环 2026-09-19 决议 #7）
 *
 * 设计（共识稿 #7「混合供给」的生成半边）：
 * - 只生成 **D/C/B 级**日常填充；S/A 级是手写链，生成器永不碰
 * - 素材池**自动取自中层覆写表**（决议 #6 的数据复用）——内容包给中层写了什么
 *   独家素材，委托板上就能出现什么征集，作者零额外负担
 * - 品级由素材品质档决定（0-1 档 = D，2 档 = C，3 档 = B）：品质越高赏金越厚
 * - 全部.requireMaterial（素材凭证）；发布地不写（面板交付豁免，决议 #11）
 * - 时限 = 生成委托缺省保质期（7 天，决议 #12）
 *
 * 纯度约束：无 I/O、无时钟、随机源由调用方注入；`input.existingNames` 防重名。
 */

import type { CommissionGrade } from './commission';
import type { GeneratedCommission } from './commission-flags';
import { GENERATED_COMMISSION_TTL_DAYS } from './commission-active';

/** 生成委托的目标在板数（常数起步；打开委托板时保洁 + 补充） */
export const GENERATED_COMMISSION_TARGET_COUNT = 4;

/** 生成委托的名称后缀（区分于手写委托；玩家看到的是完整名） */
const FILLER_NAME_TAIL = '征集';

/** 生成委托内部的生成器输入中层形状（= MapMidTier 的最小面） */
export interface GeneratorMidTier {
  id: string;
  name: string;
  gathering?: {
    specialty?: string;
    danger?: number;
    materialTable?: Record<number, string[]>;
  };
}

export interface GenerateFillerInput {
  /** 有覆写表的中层（调用方从 MapPack.midTiers 过滤；无表的中层产不了独家素材） */
  midTiers: readonly GeneratorMidTier[];
  /** 目标在板数（缺省 GENERATED_COMMISSION_TARGET_COUNT） */
  count?: number;
  /** 当前 gameDay（armedDay / expiresDay） */
  day: number;
  /** 随机源（调用方注入 Math.random） */
  rng: () => number;
  /** 已占用名（静态 + 事件 + 生成 + 进行中）——生成名撞车时加序号重试 */
  existingNames: ReadonlySet<string>;
}

/** 品质档 → 品级（0-1 档 D / 2 档 C / 3 档 B；4 档星辉是手写链的领地，生成器不碰） */
export function gradeForRank(rank: number): CommissionGrade {
  if (rank >= 3) return 'B';
  if (rank >= 2) return 'C';
  return 'D';
}

/** 品级 → 赏金区间（GC；D 最薄、B 最厚） */
function gcRangeFor(grade: CommissionGrade): { min: number; max: number } {
  if (grade === 'B') return { min: 200, max: 500 };
  if (grade === 'C') return { min: 80, max: 200 };
  return { min: 30, max: 80 };
}

/** 品级 → 声望（B 级给小额声望，D/C 级只给钱） */
function reputationFor(grade: CommissionGrade): number | undefined {
  if (grade === 'B') return 3;
  if (grade === 'C') return 1;
  return undefined;
}

/**
 * 生成一批填充委托（纯函数）。原料不足（没写覆写表的中层 / 表全空）返回空数组——
 * 生成填充是**填充**，没有原料就安静地让委托板空着，绝不凭空造要求。
 */
export function generateFillerCommissions(
  input: GenerateFillerInput,
): GeneratedCommission[] {
  const count = Math.max(0, Math.floor(input.count ?? GENERATED_COMMISSION_TARGET_COUNT));
  const day = Math.floor(input.day);
  if (count === 0) return [];

  // 素材池：中层 × 品质档 × 素材名（只收有表的行；4 档留给手写链）
  interface PoolEntry {
    midTier: GeneratorMidTier;
    rank: number;
    material: string;
  }
  const pool: PoolEntry[] = [];
  for (const midTier of input.midTiers) {
    const table = midTier.gathering?.materialTable;
    if (!table) continue;
    for (const [key, names] of Object.entries(table)) {
      const rank = Number(key);
      if (!Number.isInteger(rank) || rank < 0 || rank > 3) continue;
      if (!Array.isArray(names)) continue;
      for (const material of names) {
        if (typeof material === 'string' && material.length > 0) {
          pool.push({ midTier, rank, material });
        }
      }
    }
  }
  if (pool.length === 0) return [];

  const usedNames = new Set(input.existingNames);
  const out: GeneratedCommission[] = [];
  let serial = 1;

  for (let i = 0; i < count; i++) {
    const picked = pool[Math.floor(input.rng() * pool.length) % pool.length];
    const grade = gradeForRank(picked.rank);
    // 数量：B 级 1 份（高品素材难得），C 级 1~2，D 级 1~3
    const maxCount = grade === 'B' ? 1 : grade === 'C' ? 2 : 3;
    const need = 1 + Math.floor(input.rng() * maxCount);
    const gcRange = gcRangeFor(grade);
    const gc = Math.round(gcRange.min + input.rng() * (gcRange.max - gcRange.min));
    const rep = reputationFor(grade);

    // 名字：`「素材」征集·中层名`；撞车加序号
    let name = `${picked.material}${FILLER_NAME_TAIL}·${picked.midTier.name}`;
    while (usedNames.has(name)) {
      serial += 1;
      name = `${picked.material}${FILLER_NAME_TAIL}·${picked.midTier.name}·${serial}`;
    }
    usedNames.add(name);

    out.push({
      def: {
        name,
        description: `公会在收${picked.midTier.name}出产的${picked.material}——品质越好的越值钱。`,
        requireMaterial: { name: picked.material, count: need },
        grade,
        destMidTier: picked.midTier.id,
        deadlineDays: GENERATED_COMMISSION_TTL_DAYS,
        rewards: {
          gc,
          ...(rep !== undefined ? { reputation: rep } : {}),
        },
      },
      armedDay: day,
      expiresDay: day + GENERATED_COMMISSION_TTL_DAYS,
    });
  }
  return out;
}

/**
 * 保洁 + 补充（纯函数）：摘掉过期的生成委托，不足目标数就补。
 * `existingNames` 含仍在板上的生成委托名（补生成时不与自己撞名）。
 */
export function refreshGeneratedCommissions(input: {
  existing: readonly GeneratedCommission[] | undefined;
  midTiers: readonly GeneratorMidTier[];
  today: number;
  rng: () => number;
  reservedNames: ReadonlySet<string>;
  count?: number;
}): { kept: GeneratedCommission[]; generated: GeneratedCommission[] } {
  const today = Math.floor(input.today);
  const kept = (input.existing ?? []).filter((gc) => today < gc.expiresDay);
  const reserved = new Set(input.reservedNames);
  for (const gc of kept) reserved.add(gc.def.name);
  const shortfall =
    Math.max(0, Math.floor(input.count ?? GENERATED_COMMISSION_TARGET_COUNT)) - kept.length;
  if (shortfall <= 0) return { kept, generated: [] };
  const generated = generateFillerCommissions({
    midTiers: input.midTiers,
    count: shortfall,
    day: today,
    rng: input.rng,
    existingNames: reserved,
  });
  return { kept, generated };
}
