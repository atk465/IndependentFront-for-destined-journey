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

import type { CardItem, InventoryItem } from '../types';
import { cardKindOf } from './card-kind';
import { cardPower } from './deck-power';
import { ENTRY_STRENGTH_BASELINE } from './talent-entry';
import { CARD_ELEMENT_AXIS } from './derived-stats';
import { isClashPair, synergyProduct } from './card-fusion';
import { CARD_TIERS } from '../field-enums';
import { itemTierToMaterialTier, toMaterial } from './material';
import { growCardByRawExp } from './skirmish';
import { LEVEL_CAP_BY_TIER } from './companion-panel';

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
 *
 * 2026-10-02 批次C 倾向偏置：卡在 `data.倾向` 定了进化路线时，克制已学/无克制
 * 可学的空档改学倾向铭文（战况克制仍最优先——倾向只填空档，不抢戏）。
 */
export function planSelfEvolution(
  card: Pick<CardItem, 'name' | '词条' | 'data'>,
  enemyName: string,
  enemyLevel: number,
): GrowthValidation & { plan?: EvolutionPlan } {
  const words = Array.isArray(card.词条) ? card.词条 : [];
  if (cardKindOf(words) !== '召唤') {
    return { ok: false, reason: '只有伙伴卡可以自我进化' };
  }
  const counter = COUNTER_ENTRIES.find((c) => c.match(enemyName))?.entry;
  const route = evolutionRouteOf(card.data);
  let gained: string;
  if (counter && !words.includes(counter)) {
    gained = counter;
  } else if (route && !words.includes(route.entry)) {
    gained = route.entry;
  } else {
    gained = counter && words.includes(counter) ? '精进铭·改' : '精进铭';
  }
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
// ④ 进化倾向（2026-10-02 批次C：三选一的成长路线，存 `data.倾向` 数据袋）
// ════════════════════════════════════════════════════════════════════

/**
 * 三条进化路线（玩家在工坊选定，随时可转向）。
 * 机制 = planSelfEvolution 的空档偏置（见上）；铭文与「屠龙铭」系同一习语。
 */
export const EVOLUTION_ROUTES = [
  { id: '炽野', entry: '炽野铭', desc: '群体爆裂——无特定克制可学时，向面杀伤的战法生长' },
  { id: '贯城', entry: '贯城铭', desc: '单体破城——无特定克制可学时，向穿甲贯穿的战法生长' },
  { id: '镜影', entry: '镜影铭', desc: '分身共鸣——无特定克制可学时，向镜像连携的战法生长' },
] as const;
export type EvolutionRoute = (typeof EVOLUTION_ROUTES)[number];
export type EvolutionRouteId = EvolutionRoute['id'];

/** 读卡的倾向段（数据袋口径对齐调教 `data.调教`；脏值安全回落 undefined） */
export function evolutionRouteOf(data: unknown): EvolutionRoute | undefined {
  const route = (data as { 倾向?: unknown } | null | undefined)?.倾向;
  return EVOLUTION_ROUTES.find((r) => r.id === route);
}

export interface EvolutionDirectionPlan {
  routeId: EvolutionRouteId;
  /** 该路线的倾向铭文（自我进化空档时习得） */
  entry: string;
  summary: string;
}

/**
 * 规划一次倾向选定/转向（纯函数）：写 `data.倾向`，不碰词条——
 * 倾向是「将来时」，只有此后自我进化的空档才会长出倾向铭文。
 */
export function planEvolutionDirection(
  card: Pick<CardItem, 'name' | '词条' | 'data'>,
  routeId: EvolutionRouteId,
): GrowthValidation & { plan?: EvolutionDirectionPlan } {
  const words = Array.isArray(card.词条) ? card.词条 : [];
  if (cardKindOf(words) !== '召唤') {
    return { ok: false, reason: '只有伙伴卡可以选择进化倾向' };
  }
  const route = EVOLUTION_ROUTES.find((r) => r.id === routeId);
  if (!route) {
    return { ok: false, reason: `未知的进化倾向「${String(routeId)}」` };
  }
  const prev = evolutionRouteOf(card.data);
  return {
    ok: true,
    plan: {
      routeId: route.id,
      entry: route.entry,
      summary: prev
        ? `【${card.name}】的进化倾向由「${prev.id}」转向「${route.id}」——${route.desc}`
        : `【${card.name}】定下进化倾向「${route.id}」——${route.desc}`,
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// ⑤ 投喂（2026-10-02 批次C：素材按元素匹配换卡面成长——炼制之外的第二消耗出口）
// ════════════════════════════════════════════════════════════════════

/** 基准经验 = 25 × 素材品阶(1~5)，再乘元素匹配系数（对齐管容 黑铁200~星辉3200 的量级） */
const FEED_BASE_EXP = 25;

export interface FeedPlan {
  /** 消耗的素材名（逻辑键） */
  materialName: string;
  /** 元素匹配说明（进 summary 与 UI 预览） */
  matchLabel: string;
  /** 入账的原始卡牌经验（不打交锋 5 折，同吞噬口径） */
  rawExp: number;
  /** growCardByRawExp 结果：入账后的卡经验/战力/满管次数 */
  cardExp: number;
  cardPowerBonus: number;
  powerUps: number;
  summary: string;
}

/**
 * 规划一次投喂（纯函数）：素材按元素对卡的匹配度换卡牌经验。
 * 匹配优先级与 classifyFusion 同款：同源 > 相生 > 相克 > 中性；
 * 经验走 growCardByRawExp（满管溢出 → 卡面战力 +1，永不丢经验）。
 */
export function planFeedCompanion(
  card: Pick<CardItem, 'name' | '词条' | 'cardTier' | 'cardExp' | 'cardPowerBonus'>,
  material: InventoryItem,
): GrowthValidation & { plan?: FeedPlan } {
  const words = Array.isArray(card.词条) ? card.词条 : [];
  if (cardKindOf(words) !== '召唤') {
    return { ok: false, reason: '只有伙伴卡可以投喂' };
  }
  if (material.type !== '材料') {
    return { ok: false, reason: '只能投喂素材（材料）——卡牌请走吞噬' };
  }
  const cardElement = words.find((w) => w in CARD_ELEMENT_AXIS);
  const matElements = toMaterial(material).elements;
  let matchLabel: string;
  let mult: number;
  if (!cardElement || matElements.length === 0) {
    matchLabel = '中性滋养 ×1';
    mult = 1;
  } else if (matElements.includes(cardElement)) {
    matchLabel = `${cardElement}·同源共鸣 ×2`;
    mult = 2;
  } else if (matElements.some((e) => synergyProduct(cardElement, e))) {
    matchLabel = '相生共鸣 ×1.5';
    mult = 1.5;
  } else if (matElements.some((e) => isClashPair(cardElement, e))) {
    matchLabel = '相克相冲 ×0.5';
    mult = 0.5;
  } else {
    matchLabel = '中性滋养 ×1';
    mult = 1;
  }
  const tier = Math.max(1, Math.round(itemTierToMaterialTier(material)) || 1);
  const rawExp = Math.max(1, Math.round(FEED_BASE_EXP * tier * mult));
  const grown = growCardByRawExp(
    {
      cardTier: card.cardTier,
      ...(card.cardExp !== undefined ? { cardExp: card.cardExp } : {}),
      ...(card.cardPowerBonus !== undefined ? { cardPowerBonus: card.cardPowerBonus } : {}),
    },
    rawExp,
  );
  const powerNote = grown.powerUps > 0 ? `，卡面战力 +${grown.powerUps}` : '';
  return {
    ok: true,
    plan: {
      materialName: material.name,
      matchLabel,
      rawExp,
      cardExp: grown.cardExp,
      cardPowerBonus: grown.cardPowerBonus,
      powerUps: grown.powerUps,
      summary: `【${card.name}】吃下【${material.name}】（${matchLabel}）——卡面经验 +${rawExp}${powerNote}`,
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

// ════════════════════════════════════════════════════════════════════
// ④ 进化仪式（伙伴实体化 D13，批⑤任务书 B5.1）
// ════════════════════════════════════════════════════════════════════

/** 倾向 → 祭品元素类（三系；任务书 B5.1 定稿） */
export const ARCHETYPE_ELEMENTS: Record<'炽野' | '贯城' | '镜影', readonly string[]> = {
  炽野: ['火'],
  贯城: ['金', '土'],
  镜影: ['水', '冰', '光', '暗'],
};

export interface EmbedOfferingValidation {
  ok: boolean;
  reason?: string;
}

export interface EmbedOfferingPlan {
  /** 要嵌入的素材名（remove_item 由调用方发） */
  materialName: string;
  /** 嵌入后的祭品列表（append 一项） */
  offerings: string[];
  summary: string;
}

/**
 * 规划一次祭品嵌入（纯函数）：
 * - 材料元素与 ARCHETYPE_ELEMENTS[archetype] 有交集；
 * - 素材品质档 index ≥ 当前卡档 index（itemTierToMaterialTier−1 vs CARD_TIERS 序）；
 * - 上限 3 份（currentOfferings.length < 3）。
 */
export function planEmbedOffering(
  card: Pick<CardItem, 'name' | 'cardTier'>,
  material: InventoryItem,
  archetype: '炽野' | '贯城' | '镜影',
  currentOfferings: readonly string[],
): EmbedOfferingValidation & { plan?: EmbedOfferingPlan } {
  const spec = toMaterial(material);
  const allowed = ARCHETYPE_ELEMENTS[archetype];
  if (!spec.elements.some((e) => allowed.includes(e))) {
    return {
      ok: false,
      reason: `「${material.name}」的元素不在【${archetype}】所要的 ${allowed.join('/')} 之内`,
    };
  }
  const matIdx = Math.max(1, Math.round(itemTierToMaterialTier(material)) || 1) - 1;
  const cardIdx = CARD_TIERS.indexOf(card.cardTier);
  if (matIdx < cardIdx) {
    return {
      ok: false,
      reason: `「${material.name}」品质档低于【${card.name}】的 ${card.cardTier}——压不住仪式`,
    };
  }
  if (currentOfferings.length >= 3) {
    return { ok: false, reason: '祭品槽已满（3/3）' };
  }
  return {
    ok: true,
    plan: {
      materialName: material.name,
      offerings: [...currentOfferings, material.name],
      summary: `【${material.name}】嵌入【${card.name}】的${archetype}祭品槽（${currentOfferings.length + 1}/3）`,
    },
  };
}

export interface EvolutionGates {
  levelOk: boolean;
  archetypeOk: boolean;
  offeringsOk: boolean;
  affectionOk: boolean;
  reasons: string[];
}

export interface CompanionEvolutionPlan {
  newTier: (typeof CARD_TIERS)[number];
  summary: string;
}

/**
 * 进化仪式四门槛（纯函数）：level 达品阶上限 + 倾向已选 + 祭品 3/3 + 忠诚 ≥ 50。
 * 未达门槛逐项给出 reason（UI 实时显示用）。
 */
export function planCompanionEvolution(input: {
  level: number;
  cardTier: (typeof CARD_TIERS)[number];
  archetype: string | undefined;
  offerings: readonly string[];
  affection: number;
  cardName: string;
}): { ok: boolean; gates: EvolutionGates; plan?: CompanionEvolutionPlan } {
  const cap = LEVEL_CAP_BY_TIER[input.cardTier] ?? LEVEL_CAP_BY_TIER['黑铁'];
  const levelOk = input.level >= cap;
  const archetypeOk = !!input.archetype;
  const offeringsOk = input.offerings.length === 3;
  const affectionOk = input.affection >= 50;
  const reasons: string[] = [];
  if (!levelOk) reasons.push(`等级不足（Lv${input.level}/${cap}）`);
  if (!archetypeOk) reasons.push('倾向未定');
  if (!offeringsOk) reasons.push(`祭品不全（${input.offerings.length}/3）`);
  if (!affectionOk) reasons.push(`忠诚不足（${Math.round(input.affection)}/50）`);
  const gates: EvolutionGates = { levelOk, archetypeOk, offeringsOk, affectionOk, reasons };
  if (reasons.length > 0) return { ok: false, gates };
  const newTier = CARD_TIERS[CARD_TIERS.indexOf(input.cardTier) + 1] ?? input.cardTier;
  return {
    ok: true,
    gates,
    plan: {
      newTier,
      summary: `【${input.cardName}】进化仪式成——品阶 ${input.cardTier} → ${newTier}（面板重锚、天赋升标、祭品化灰）`,
    },
  };
}
