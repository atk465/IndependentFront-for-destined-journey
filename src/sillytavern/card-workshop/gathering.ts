/**
 * gathering.ts — 采集与垂钓系统（2026-09-18 设计访谈共识版）
 *
 * 触发方式：面板按钮（后续地图集成调同一动作）
 * 环境选择：自由选择，特产素材绑定环境（特产品质提升 / 非特产下降）
 * 素材名：具名素材表（每环境品质→素材名），入库前具名化
 * 垂钓产出：素材+垃圾，不产卡牌
 * 垂钓装备：钓竿装备卡（可放武器或副手）
 * 频率限制：时间+体力消耗 + 连续行动 d20 概率递增触发负面事件
 * 环境危险：每环境独立危险系数（数据驱动，留地图系统对接口）
 *
 * 纯度约束：纯函数、不 mutate、随机源由调用方注入。
 */

import type { Rarity } from '../field-enums';
import { RARITY_LEVELS } from '../field-enums';
import type { MidTierGathering } from '../types-map';

// ════════════════════════════════════════════════════════════════════
// 环境表（加环境 = 加两行数据：特产 + 危险系数）
// ════════════════════════════════════════════════════════════════════

/**
 * 环境名的**类型真源**（`GatherEnvironment` 由它派生）—— 仓库惯用写法，同
 * `field-enums.ts` 的 `CARD_TIERS`。当前没有运行时消费方（环境名从地图侧以
 * 联合类型传入，不走字符串解析），保持导出以备 UI/工具遍历环境表；
 * knip 视作未消费导出，已按「确属有意保留」入基线（见提交说明）。
 */
export const ENV_NAMES = ['森林', '矿山', '水域', '冰原', '沙漠', '沼泽'] as const;

export type GatherEnvironment = (typeof ENV_NAMES)[number];

/** 环境定义表——特产类型、危险系数、素材名表全部数据驱动 */
export interface EnvironmentDef {
  /** 特产素材类型前缀（此环境下品质 +2） */
  specialty: string;
  /** 危险系数（0 = 基线；越大风险判定越容易触发） */
  danger: number;
  /** 具名素材表：品质档索引(0=普通..4=星辉) → 素材名列表 */
  materialTable: Record<number, string[]>;
}

/**
 * 环境定义注册表（加环境 = 加一行数据）。
 *
 * 环境偏移模型：特产在自家环境品质 +2，非特产 −1。
 * 危险系数留数据口子——后续地图系统可通过覆写此表调整。
 */
export const ENVIRONMENT_TABLE: Readonly<Record<GatherEnvironment, EnvironmentDef>> = {
  森林: {
    specialty: '草药',
    danger: 0,
    materialTable: {
      0: ['止血草', '蒲公英'],
      1: ['月光苔', '铁木叶'],
      2: ['千年树心', '精灵花'],
      3: ['龙血草', '世界树叶'],
      4: ['世界树嫩芽'],
    },
  },
  矿山: {
    specialty: '矿石',
    danger: 1,
    materialTable: {
      0: ['铁矿', '铜矿'],
      1: ['秘银', '赤铁矿'],
      2: ['星陨石', '深山晶簇'],
      3: ['龙鳞矿', '泰坦核'],
      4: ['星核原石'],
    },
  },
  水域: {
    specialty: '水产',
    danger: 1,
    materialTable: {
      0: ['河蚌', '水草'],
      1: ['珍珠贝', '深海鱼鳞'],
      2: ['人鱼泪', '海妖之歌'],
      3: ['深渊珊瑚', '利维坦鳞'],
      4: ['海神之心'],
    },
  },
  冰原: {
    specialty: '霜晶',
    danger: 2,
    materialTable: {
      0: ['碎冰', '寒霜草'],
      1: ['霜晶', '冰蚕丝'],
      2: ['极光碎片', '永冻 core'],
      3: ['冰龙鳞', '极寒之心'],
      4: ['绝对零度结晶'],
    },
  },
  沙漠: {
    specialty: '砂晶',
    danger: 2,
    materialTable: {
      0: ['沙粒', '仙人掌刺'],
      1: ['玻璃砂', '沙漠玫瑰'],
      2: ['沙漠之星', '砂金石'],
      3: ['沙暴之眼', '金蝎壳'],
      4: ['沙漠心脏'],
    },
  },
  沼泽: {
    specialty: '沼泥',
    danger: 2,
    materialTable: {
      0: ['腐泥', '毒蘑菇'],
      1: ['沼气结晶', '蛙卵'],
      2: ['深沼之眼', '腐龙鳞'],
      3: ['九头蛇血', '沼泽女王花'],
      4: ['沼泽之心的碎片'],
    },
  },
};

// ════════════════════════════════════════════════════════════════════
// 查表链：中层覆写 → 环境表（委托×地图闭环 决议 #6）
// ════════════════════════════════════════════════════════════════════

/**
 * 采集表解析：中层覆写表逐键优先，缺键逐键回退该地块地形对应的环境表。
 * 中层没写覆写 = 返回值与直接查环境表逐字段一致（存量地图包零迁移）。
 *
 * 🔴 素材表必须是**逐键合并**（`{...base, ...override}`）：覆写表只写独家素材的档位
 *    （如灰笺乡只写 1/3 两档），整表替换会让其余档位滚到「未知素材」——
 *    2026-09-23 真机验收抓到的就是这个。
 */
export function resolveGatherDef(
  environment: GatherEnvironment,
  midTier?: MidTierGathering,
): EnvironmentDef {
  const base = ENVIRONMENT_TABLE[environment];
  if (!midTier) return { ...base };
  return {
    specialty: midTier.specialty ?? base.specialty,
    danger: midTier.danger ?? base.danger,
    materialTable: { ...base.materialTable, ...midTier.materialTable },
  };
}

// ════════════════════════════════════════════════════════════════════
// 天赋加成（读自条目）
// ════════════════════════════════════════════════════════════════════

export interface GatherBonus {
  qualityBoost: number;
  extraChance: number;
}

export interface FishBonus {
  depthBonus: number;
  rareChance: number;
}

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

export interface GatherItem {
  name: string;
  rarity: Rarity;
  quantity: number;
  /** 是否为特产（品质提升的那些） */
  isSpecialty: boolean;
}

export interface GatherResult {
  items: GatherItem[];
  /** 消耗的时间（分钟） */
  timeCost: number;
  /** 消耗的体力（SP） */
  staminaCost: number;
  summary: string;
}

/** 每次采集的时间消耗（分钟，初稿） */
export const GATHER_TIME_MINUTES = 30;
/** 每次采集的体力消耗（SP，初稿） */
export const GATHER_SP_COST = 10;

function rarityAt(rank: number): Rarity {
  return RARITY_LEVELS[Math.max(0, Math.min(RARITY_LEVELS.length - 2, rank))] ?? '普通';
}

function pickName(table: Record<number, string[]>, rank: number, rng: () => number): string {
  const names = table[rank] ?? table[0] ?? ['未知素材'];
  return names[Math.floor(rng() * names.length) % names.length];
}

/**
 * 采集（纯函数）。
 *
 * 特产品质 +2 / 非特产品质 −1（环境特化模型）。
 * 产出 1~3 份素材，特产出现概率 60%、非特产 40%。
 * `midTier`：所在中层的采集覆写（缺省 = 纯环境表）——独家素材/危险系数从这来。
 */
export function planGather(
  environment: GatherEnvironment,
  bonus: GatherBonus,
  playerLevel: number,
  rng: () => number = Math.random,
  midTier?: MidTierGathering,
): GatherResult {
  const def = resolveGatherDef(environment, midTier);
  const count = 1 + Math.floor(rng() * 3); // 1~3 份
  const baseRank = Math.max(0, Math.min(4, Math.floor(playerLevel / 5)));
  const items: GatherItem[] = [];

  for (let i = 0; i < count; i++) {
    const isSpecialty = rng() < 0.6; // 60% 出特产
    const rank = isSpecialty
      ? Math.max(0, Math.min(4, baseRank + 2 + bonus.qualityBoost + (rng() < 0.2 ? 1 : 0)))
      : Math.max(0, Math.min(4, baseRank - 1 + (rng() < 0.2 ? 1 : 0)));
    const name = pickName(def.materialTable, rank, rng);
    items.push({ name, rarity: rarityAt(rank), quantity: 1, isSpecialty });
  }

  // 额外产出（天赋加成）
  if (bonus.extraChance > 0 && rng() * 100 < bonus.extraChance) {
    const rank = Math.max(0, Math.min(4, baseRank + 2 + bonus.qualityBoost));
    const name = pickName(def.materialTable, rank, rng);
    items.push({ name, rarity: rarityAt(rank), quantity: 1, isSpecialty: true });
  }

  const timeCost = GATHER_TIME_MINUTES;
  const staminaCost = GATHER_SP_COST;

  const parts = items.map((i) => `${i.name}（${i.rarity}）×${i.quantity}`);
  return {
    items,
    timeCost,
    staminaCost,
    summary: `${environment}采集：${parts.join('、')}`,
  };
}

// ════════════════════════════════════════════════════════════════════
// 垂钓
// ════════════════════════════════════════════════════════════════════

interface FishCatch {
  name: string;
  rarity: Rarity;
  quantity: number;
}

export interface FishResult {
  caught: boolean;
  items: FishCatch[];
  /** 消耗的时间（分钟） */
  timeCost: number;
  /** 消耗的体力（SP） */
  staminaCost: number;
  summary: string;
}

/** 每次垂钓的时间消耗（分钟，初稿） */
export const FISH_TIME_MINUTES = 45;
/** 每次垂钓的体力消耗（SP，初稿） */
export const FISH_SP_COST = 8;

/**
 * 垂钓（纯函数）。
 *
 * @param depth 水体深度 1=浅水 / 2=深水 / 3=深渊
 */
export function planFish(
  depth: number,
  bonus: FishBonus,
  rng: () => number = Math.random,
): FishResult {
  const d = Math.max(1, Math.min(3, Math.round(depth) || 1));
  const emptyChance = Math.max(0.05, 0.3 - d * 0.07);
  const roll = rng();

  if (roll < emptyChance) {
    return {
      caught: false,
      items: [],
      timeCost: FISH_TIME_MINUTES,
      staminaCost: FISH_SP_COST,
      summary: '什么也没钓到。',
    };
  }

  const count = 1 + (rng() < 0.2 ? 1 : 0);
  const baseRank = Math.max(0, Math.min(4, d + bonus.depthBonus));
  const items: FishCatch[] = [];
  for (let i = 0; i < count; i++) {
    const rank = Math.max(0, Math.min(4, baseRank + (rng() < 0.3 ? 1 : 0)));
    items.push({ name: `渔获（${rarityAt(rank)}）`, rarity: rarityAt(rank), quantity: 1 });
  }

  const rareRoll = rng();
  if (rareRoll < 0.1 + bonus.rareChance / 100) {
    items.push({ name: '稀有渔获', rarity: rarityAt(Math.min(4, baseRank + 1)), quantity: 1 });
  }

  const parts = items.map((i) => `${i.name}×${i.quantity}`);
  return {
    caught: true,
    items,
    timeCost: FISH_TIME_MINUTES,
    staminaCost: FISH_SP_COST,
    summary: parts.join('、'),
  };
}

// ════════════════════════════════════════════════════════════════════
// 风险事件
// ════════════════════════════════════════════════════════════════════

/** 负面事件种类 */
export type RiskEventType =
  | '魔兽来袭' // 触发战斗
  | '路人打断' // 白干（素材丢失）
  | '素材损坏' // 产出品质降低
  | '空手而归'; // 什么都没得到

/**
 * 风险判定（纯函数）。
 *
 * d20 体系：骰值 ≤ 风险 DC 则触发负面事件。
 * DC = 12 + 连续行动次数 × 2 + 环境危险系数 − 15（d20 基线）
 * 简化：DC 由调用方算好传入，本函数只判骰值。
 *
 * @param d20 d20 骰值（调用方传入）
 * @param riskDC 风险 DC（骰值 ≤ DC 则触发；DC 越高越容易触发）
 * @param environment 当前环境（决定事件类型倾向）
 * @param midTier 所在中层的采集覆写（危险系数逐键覆写环境表）
 */
export function rollRiskEvent(
  d20: number,
  riskDC: number,
  environment: GatherEnvironment,
  midTier?: MidTierGathering,
): { triggered: boolean; eventType?: RiskEventType } {
  if (d20 > riskDC) return { triggered: false };
  const danger = resolveGatherDef(environment, midTier).danger;
  // 危险环境偏「魔兽来袭」；安全环境偏「空手/打断」
  const eventType: RiskEventType =
    danger >= 2 ? '魔兽来袭' : danger >= 1 ? (d20 % 2 === 0 ? '素材损坏' : '路人打断') : '空手而归';
  return { triggered: true, eventType };
}

/**
 * 计算风险 DC（纯函数）。
 *
 * 连续行动 3 次起开始有风险，每多一次 DC +2；环境危险系数加到 DC 上
 * （中层覆写表可拉高——「极度危险」是数据声明，引擎只认数字）。
 */
export function riskDCFor(
  consecutiveActions: number,
  environment: GatherEnvironment,
  midTier?: MidTierGathering,
): number {
  if (consecutiveActions < 3) return 0; // 前 3 次无风险
  const danger = resolveGatherDef(environment, midTier).danger;
  return Math.min(18, 12 + (consecutiveActions - 3) * 2 + danger);
}
