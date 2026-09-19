/**
 * companion-growth.ts — 伙伴卡成长三通道（2026-09-17）
 *
 * 一次实现三条 SSS 的伙伴域机制：
 * - 「最终兵器：她」：伙伴卡**自我进化**——每次战斗后按战况进化出克制的词条
 * - 「后宫之主系统」：好感达**爱恋**（≥90，量表最高档「誓死追随」）→ 结缘，
 *   永久获得她的一项词条（刻成你的天赋），并给她挂「后宫光环」
 * - 「后宫三千」：**位份系统**——封一位「皇后」为卡组核心（得全卡组伙伴 10% 战力），
 *   其余可封「妃」得少量加成
 *
 * 纯度约束：纯函数、无 I/O；随机源由调用方注入。
 */

import type { CardItem } from '../types';
import { cardKindOf } from './card-kind';
import { cardPower } from './deck-power';
import { ENTRY_STRENGTH_BASELINE } from './talent-entry';

/** 结缘好感阈值基准（条目 `结缘{threshold}` 未声明时用它 = 参数化前行为） */
const DEVOTION_THRESHOLD = ENTRY_STRENGTH_BASELINE.结缘.threshold;
/** 皇后加成的卡组占比基准（条目 `位份{percent}` 未声明时用它） */
const ENTHRONE_PERCENT = ENTRY_STRENGTH_BASELINE.位份.percent;

export const AFFECTION_DEVOTION = DEVOTION_THRESHOLD;

export interface GrowthValidation {
  ok: boolean;
  reason?: string;
}

// ════════════════════════════════════════════════════════════════════
// ① 自我进化（SSS「最终兵器：她」）
// ════════════════════════════════════════════════════════════════════

/** 克制词条池：按敌方特征选一条最贴的（确定性 = 战况驱动，非随机） */
const COUNTER_ENTRIES: readonly { match: (enemy: string) => boolean; entry: string }[] = [
  { match: (e) => /龙|蜥|鳞/.test(e), entry: '屠龙铭' },
  { match: (e) => /虫|蛛|巢/.test(e), entry: '破巢铭' },
  { match: (e) => /亡灵|尸|鬼|骸/.test(e), entry: '镇魂铭' },
  { match: (e) => /魔|妖|邪/.test(e), entry: '净魔铭' },
  { match: (e) => /兽|狼|熊|狮/.test(e), entry: '缚兽铭' },
  { match: (e) => /机|械|构装|铁/.test(e), entry: '锈蚀铭' },
  { match: (e) => /深|海|水|渊/.test(e), entry: '定海铭' },
  { match: (e) => /焰|火|炎/.test(e), entry: '熄焰铭' },
];

export interface EvolutionPlan {
  /** 进化后的完整词条 */
  new词条: string[];
  /** 新进化出的克制词条 */
  gainedEntry: string;
  /** 本场战斗转化的卡牌经验（按敌级） */
  expGain: number;
  summary: string;
}

/**
 * 规划一次自我进化（纯函数）：按敌名挑选克制词条 + 给卡经验。
 * 已有该克制词条则换用通用「精进铭」（保证每次战斗都有可感知的成长）。
 */
export function planSelfEvolution(
  card: Pick<CardItem, 'name' | '词条'>,
  enemyName: string,
  enemyLevel: number,
): GrowthValidation & { plan?: EvolutionPlan } {
  const words = Array.isArray(card.词条) ? card.词条 : [];
  if (cardKindOf(words) !== '召唤') {
    return { ok: false, reason: '只有伙伴卡可以自我进化' };
  }
  const counter = COUNTER_ENTRIES.find((c) => c.match(enemyName))?.entry ?? '精进铭';
  const gained = words.includes(counter) ? '精进铭·改' : counter;
  const lv = Math.max(1, Math.round(enemyLevel) || 1);
  return {
    ok: true,
    plan: {
      new词条: [...new Set([...words, gained])],
      gainedEntry: gained,
      expGain: 30 * lv,
      summary: `【${card.name}】自战斗数据中进化——领悟「${gained}」（针对【${enemyName}】）`,
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// ② 结缘（SSS「后宫之主系统」）
// ════════════════════════════════════════════════════════════════════

export interface TributePlan {
  /** 她给出的词条（将来刻成你的天赋） */
  stolenEntry: string;
  /** 结缘后她的词条（追加「后宫光环」） */
  herNew词条: string[];
  summary: string;
}

/**
 * 规划一次结缘（纯函数）：好感达「爱恋」的伙伴，将她的一项词条**永久给你**，
 * 并给她挂「后宫光环」。
 *
 * 「一项最强的天赋或技能」在我们模型里 = 她词条中最具实质的一条（优先非形态/标记词条）。
 *
 * @param threshold 好感阈值（条目 `结缘{threshold}` 的强度档；缺省 = 基准 90）
 */
export function planAffectionTribute(
  card: Pick<CardItem, 'name' | '词条'>,
  affection: number | undefined,
  threshold: number = DEVOTION_THRESHOLD,
): GrowthValidation & { plan?: TributePlan } {
  const words = Array.isArray(card.词条) ? card.词条 : [];
  if (cardKindOf(words) !== '召唤') {
    return { ok: false, reason: '只有伙伴卡可以结缘' };
  }
  if (typeof affection !== 'number' || !Number.isFinite(affection)) {
    return { ok: false, reason: '没有这位伙伴的好感记录——先让故事发生' };
  }
  const need = Math.max(0, Math.round(threshold));
  if (affection < need) {
    return {
      ok: false,
      reason: `羁绊未到「爱恋」（当前 ${Math.round(affection)}，需 ≥${need}）`,
    };
  }
  if (words.includes('后宫光环')) {
    return { ok: false, reason: `你与【${card.name}】已经结缘过了` };
  }
  const SUBSTANTIVE = words.filter(
    (w) => w && !['召唤', '军团', '捕获', '深海', '深渊压制', '后宫光环'].includes(w),
  );
  const stolen = SUBSTANTIVE[0] ?? words.find((w) => w !== '召唤') ?? '同心';
  return {
    ok: true,
    plan: {
      stolenEntry: stolen,
      herNew词条: [...new Set([...words, '后宫光环'])],
      summary: `与【${card.name}】结缘——她把自己最拿手的「${stolen}」教给了你（永久），并为你点亮「后宫光环」`,
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// ③ 位份 / 皇后核心（SSS「后宫三千」）
// ════════════════════════════════════════════════════════════════════

/** 位份（皇后唯一，其余为妃阶） */
export const CONSORT_RANKS = ['皇后', '贵妃', '妃', '嫔', '贵人'] as const;
export type ConsortRank = (typeof CONSORT_RANKS)[number];

/** 位份战力加成（皇后 = 全卡组伙伴卡战力的 10%；其余为固定小加成） */
export const RANK_BONUS: Record<ConsortRank, number> = {
  皇后: 0, // 动态：由 planEnthrone 按卡组计算
  贵妃: 4,
  妃: 3,
  嫔: 2,
  贵人: 1,
};

export interface EnthronePlan {
  /** 被册封的卡名 */
  cardName: string;
  rank: ConsortRank;
  /** 该位份带来的战力加成 */
  bonus: number;
  /** 册封后卡上应写的词条（追加位份标记） */
  new词条: string[];
  summary: string;
}

/**
 * 规划一次册封（纯函数）。
 *
 * 皇后：得**全卡组其他伙伴卡战力合计的 percent%**（上限 percent×2，防滚雪球）；同一时刻只应有一位皇后。
 * 其余位份：固定小加成（RANK_BONUS）。
 *
 * @param card 被册封的伙伴卡
 * @param rank 目标位份
 * @param deckCompanions 卡组内其他伙伴卡（皇后加成按它们计算；可空）
 * @param percent 皇后加成的卡组占比（条目 `位份{percent}` 的强度档；缺省 = 基准 10）
 */
export function planEnthrone(
  card: Pick<CardItem, 'name' | '词条' | 'cardTier' | 'cardPowerBonus'>,
  rank: ConsortRank,
  deckCompanions: readonly Pick<CardItem, 'cardTier' | '词条' | 'cardPowerBonus'>[] = [],
  percent: number = ENTHRONE_PERCENT,
): GrowthValidation & { plan?: EnthronePlan } {
  const words = Array.isArray(card.词条) ? card.词条 : [];
  if (cardKindOf(words) !== '召唤') {
    return { ok: false, reason: '只有伙伴卡可以册封位份' };
  }
  if (!CONSORT_RANKS.includes(rank)) {
    return { ok: false, reason: `未知位份「${rank}」` };
  }
  const others = deckCompanions.filter((c) => cardKindOf(c.词条 ?? []) === '召唤');
  const pct = Math.max(0, Math.round(percent));
  const bonus =
    rank === '皇后'
      ? Math.min(
          pct * 2,
          Math.round(others.reduce((sum, c) => sum + cardPower(c), 0) * (pct / 100)),
        )
      : RANK_BONUS[rank];
  return {
    ok: true,
    plan: {
      cardName: card.name,
      rank,
      bonus,
      new词条: [...new Set([...words, `位份·${rank}`])],
      summary:
        rank === '皇后'
          ? `册封【${card.name}】为皇后——她统摄后宫，得全卡组伙伴战力 +${bonus}（其余妃嫔亦随她增辉）`
          : `册封【${card.name}】为${rank}——战力 +${bonus}`,
    },
  };
}
