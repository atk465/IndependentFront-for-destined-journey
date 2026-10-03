/**
 * companion-panel.ts — 伙伴实体初始面板（伙伴实体化 D7 公式锚定，批①任务书 §2.3）
 *
 * 公式（任务书定稿数值，零发明空间；艾拉卡面数字是风味参照非验收值）：
 * - 五维点总量 T = round(品阶基数 × 评级系数) + Σ(素材品质档) × 2
 * - 权重：初始全 1；卡词条每命中一个九元素，CARD_ELEMENT_AXIS 对应轴 +3（双元素=双轴加权）
 * - 各维 = max(1, floor(T × 该维权重 / Σ权重))；余数按权重降序逐维 +1 分完
 * - maxHp = 30 + con×8；maxMp = 15 + int×6 + spi×4；maxSp = 20 + con×4
 * - 面板构成写进 auditLine（进制卡审计与战报），零 AI 介入
 *
 * 纯函数；materialTiers 由调用方给定（品质档来源数组；空 = 目录入口）。
 */

import type { CardTier } from '../field-enums';
import type { CardItem, CharacterState, CraftRating, InventoryItem } from '../types';
import { CARD_ELEMENT_AXIS, type AttributeAxis } from './derived-stats';
import { cardKindOf } from './card-kind';
import { companionBagOf } from './companion';
import { CARD_EXP_CAP } from './skirmish';

/** 品阶基数（五维点总量基数） */
const PANEL_BASE: Record<CardTier, number> = { 黑铁: 20, 青铜: 28, 白银: 36, 鎏金: 46, 星辉: 58 };

/** 评级系数 */
const RATING_COEF: Record<CraftRating, number> = {
  大失败: 0.8,
  失败: 0.9,
  成功: 1.0,
  精益求精: 1.15,
};

/** 元素轴权重：命中轴 +3/元素，未命中轴 1（按卡词条内全部元素累计；无元素全 1） */
const AXIS_BONUS = 3;

/** 五维轴固定序（同权重时的余数分配次序，保证确定性） */
const AXES: readonly AttributeAxis[] = ['str', 'dex', 'con', 'int', 'spi'];

/** 审计行用的单字轴名（力/敏/体/智/神） */
const AXIS_CN: Readonly<Record<AttributeAxis, string>> = Object.freeze({
  str: '力',
  dex: '敏',
  con: '体',
  int: '智',
  spi: '神',
});

export interface CompanionPanel {
  attributes: { str: number; dex: number; con: number; int: number; spi: number };
  maxHp: number;
  maxMp: number;
  maxSp: number;
  auditLine: string;
}

/** 伙伴实体初始面板（获得即诞生时一次性定盘；升级成长见任务书 §2.3 成长表） */
export function buildCompanionPanel(input: {
  cardTier: CardTier;
  rating: CraftRating;
  词条: string[];
  /** 素材品质档合计的来源数组；空 = 目录入口（素材项 0） */
  materialTiers: number[];
}): CompanionPanel {
  const words = Array.isArray(input.词条) ? input.词条 : [];
  const materials = Array.isArray(input.materialTiers)
    ? input.materialTiers.filter((t) => typeof t === 'number' && Number.isFinite(t))
    : [];
  const materialSum = materials.reduce((a, b) => a + b, 0);
  const T = Math.round(PANEL_BASE[input.cardTier] * RATING_COEF[input.rating]) + materialSum * 2;

  const weights: Record<AttributeAxis, number> = { str: 1, dex: 1, con: 1, int: 1, spi: 1 };
  for (const w of words) {
    const axis = CARD_ELEMENT_AXIS[w];
    if (axis) weights[axis] += AXIS_BONUS;
  }
  const weightSum = AXES.reduce((a, k) => a + weights[k], 0);

  const dims = {} as Record<AttributeAxis, number>;
  for (const k of AXES) dims[k] = Math.max(1, Math.floor((T * weights[k]) / weightSum));

  // 余数按权重降序逐维 +1 分完（同权重按五维固定序，确定性）
  let used = AXES.reduce((a, k) => a + dims[k], 0);
  const order = [...AXES].sort(
    (a, b) => weights[b] - weights[a] || AXES.indexOf(a) - AXES.indexOf(b),
  );
  for (let i = 0; used < T; i = (i + 1) % order.length) {
    dims[order[i]] += 1;
    used += 1;
  }

  const maxHp = 30 + dims.con * 8;
  const maxMp = 15 + dims.int * 6 + dims.spi * 4;
  const maxSp = 20 + dims.con * 4;

  const auditLine =
    `面板：${input.cardTier}基数 × 评级「${input.rating}」${RATING_COEF[input.rating]}` +
    ` + 素材${materialSum}×2 → ` +
    `${AXIS_CN.str}${dims.str}/${AXIS_CN.dex}${dims.dex}/${AXIS_CN.con}${dims.con}/` +
    `${AXIS_CN.int}${dims.int}/${AXIS_CN.spi}${dims.spi}` +
    `，HP${maxHp}/MP${maxMp}/SP${maxSp}`;

  return {
    attributes: { str: dims.str, dex: dims.dex, con: dims.con, int: dims.int, spi: dims.spi },
    maxHp,
    maxMp,
    maxSp,
    auditLine,
  };
}

// ═══ 战斗基座（伙伴实体化 D5「面板接管基座」，批②任务书 B2.1）═══
//
// 卡的直击/压场/技能基座从玩家属性换成伙伴实体面板——公式链形状不动，基座换人：
// 命中条件 = isSummonCard(卡) && 按名找到实体 && present === true && 袋未标重伤。
// 未命中返回 null（调用方照旧用玩家属性，零回归）。

/** 基座命中时供给战斗取数的实体快照 */
export interface CompanionBase {
  name: string;
  attributes: CharacterState['attributes'];
  level: number;
  mp: number;
  maxMp: number;
  hp: number;
  /** 挡刀位建账需要（companionGuard.maxHp；任务书返回形状的必要补列） */
  maxHp: number;
}

/** 召唤卡 → 伙伴实体战斗基座（未命中/沉眠/重伤返回 null）。
 * 传 inventory 时按 B4.3 effective 面板（佩戴加算区并入五维）；缺省裸面板（旧调用零改动）。 */
export function companionBaseOf(
  card: Pick<CardItem, 'name' | '词条'>,
  characters: CharacterState[],
  inventory?: InventoryItem[],
): CompanionBase | null {
  if (cardKindOf(card.词条) !== '召唤') return null;
  const roster = Array.isArray(characters) ? characters : [];
  const entity = roster.find((c) => c?.name === card.name);
  if (!entity || entity.type !== 'summon' || entity.present !== true) return null;
  const bag = companionBagOf(entity);
  if (bag?.injured === true) return null;
  const attributes =
    inventory !== undefined
      ? companionEffectivePanel(entity, inventory).attributes
      : entity.attributes;
  return {
    name: entity.name,
    attributes,
    level: entity.level,
    mp: entity.mp,
    maxMp: entity.maxMp,
    hp: entity.hp,
    maxHp: entity.maxHp,
  };
}

// ═══ 佩戴（伙伴实体化 D10，批④任务书 B4.1/B4.3/B4.4）═══

export type CompanionEquipSlot = 'hand' | 'body' | 'charm';

/**
 * 物品 → 伙伴佩戴槽（B4.1）：type==='装备' 按 equippedSlot 映射（武器/副手→hand；
 * 头部/身体/手部/脚部/腰带→body；饰品→charm）；装备卡（卡牌+装备 kind）→hand；其余 null。
 * 🔴 引擎口径：unequip 会把 equippedSlot 置空（槽位本性随之丢失）——躺背包且未佩戴的
 * 装备物品无法映射槽位，实际可佩戴面以装备卡为主（规格现状，记录于批④汇报）。
 */
export function companionEquipSlotOf(
  item: (Pick<InventoryItem, 'type' | 'equippedSlot'> & { 词条?: readonly string[] }) | undefined,
): CompanionEquipSlot | null {
  if (!item) return null;
  if (item.type === '装备') {
    switch (item.equippedSlot ?? '') {
      case '武器':
      case '副手':
        return 'hand';
      case '头部':
      case '身体':
      case '手部':
      case '脚部':
      case '腰带':
        return 'body';
      case '饰品':
        return 'charm';
      default:
        return null;
    }
  }
  if (item.type === '卡牌' && cardKindOf(item.词条 ?? []) === '装备') return 'hand';
  return null;
}

/**
 * effective 面板（B4.3）：实体五维 + Σ 佩戴装备物品 stats 中 str/dex/con/int/spi
 * 数值键（其余键忽略；装备卡佩戴仅语义位不加算）。
 */
export function companionEffectivePanel(
  entity: CharacterState,
  inventory: InventoryItem[],
): { attributes: CharacterState['attributes'] } {
  const attrs: CharacterState['attributes'] = { ...entity.attributes };
  const bag = (entity.customFields as Record<string, unknown> | undefined)?.companion as
    { equip?: Record<string, string | undefined> } | undefined;
  const items = Array.isArray(inventory) ? inventory : [];
  for (const wornName of Object.values(bag?.equip ?? {})) {
    if (typeof wornName !== 'string' || wornName.length === 0) continue;
    // 装备卡佩戴仅语义位不加算（只有 type==='装备' 的实物的 stats 数值键入算）
    const worn = items.find((i) => i?.name === wornName && i.type === '装备');
    if (!worn?.stats) continue;
    for (const key of ['str', 'dex', 'con', 'int', 'spi'] as const) {
      const v = Number((worn.stats as Record<string, unknown>)[key]);
      if (Number.isFinite(v)) attrs[key] += v;
    }
  }
  return { attributes: attrs };
}

/** 佩戴中物品名集合（B4.4）：任一伙伴 bag.equip 引用到的物品名（出售/拆解/祭出前置拦截） */
export function companionWearingNames(characters: CharacterState[]): Set<string> {
  const worn = new Set<string>();
  for (const c of Array.isArray(characters) ? characters : []) {
    const bag = (c?.customFields as Record<string, unknown> | undefined)?.companion as
      { equip?: Record<string, string | undefined> } | undefined;
    for (const name of Object.values(bag?.equip ?? {})) {
      if (typeof name === 'string' && name.length > 0) worn.add(name);
    }
  }
  return worn;
}

// ═══ 升级成长（伙伴实体化 D8，批③任务书 B3.1）═══
//
// 经验入实体账本：满管 → level+1、+3 五维点按当前词条元素权重比分入、
// HP/MP/SP 上限按 §2.3 公式重算并等比抬当前值（不超新上限）。到品阶上限：
// 溢出经验丢弃（等进化蜕变重锚）。纯函数；落库由调用方翻译成 patch。

/** 品阶等级上限（新表，批③任务书 B3.1） */
export const LEVEL_CAP_BY_TIER: Record<CardTier, number> = {
  黑铁: 10,
  青铜: 14,
  白银: 18,
  鎏金: 22,
  星辉: 25,
};

/** 升级入参的实体快照（调用方从 CharacterState 投影） */
export interface CompanionEntityLite {
  level: number;
  totalExp: number;
  attributes: { str: number; dex: number; con: number; int: number; spi: number };
  maxHp: number;
  maxMp: number;
  maxSp: number;
  hp: number;
  mp: number;
  sp: number;
  词条: string[];
}

export interface CompanionExpResult {
  level: number;
  totalExp: number;
  expToNext: number;
  attributes: { str: number; dex: number; con: number; int: number; spi: number };
  maxHp: number;
  maxMp: number;
  maxSp: number;
  hp: number;
  mp: number;
  sp: number;
  auditLines: string[];
}

/**
 * 经验入实体账本（纯函数）：循环升级直到经验不足或达品阶上限。
 * hp/mp/sp 只被上限抬升等比抬高（Δmax），本函数不扣减当前值。
 */
export function applyCompanionExp(
  entity: CompanionEntityLite,
  rawExp: number,
  cardTier: CardTier,
): CompanionExpResult {
  const expToNext = CARD_EXP_CAP[cardTier] ?? CARD_EXP_CAP['黑铁'];
  const cap = LEVEL_CAP_BY_TIER[cardTier] ?? LEVEL_CAP_BY_TIER['黑铁'];
  const attrs: CompanionEntityLite['attributes'] = { ...entity.attributes };
  let level = Math.max(1, Math.round(entity.level) || 1);
  let totalExp =
    Math.max(0, Math.round(entity.totalExp) || 0) + Math.max(0, Math.round(rawExp) || 0);

  // 权重算法与 §2.3 同源：词条每命中一个九元素，对应轴 +3（无元素全 1）
  const words = Array.isArray(entity.词条) ? entity.词条 : [];
  const weights: Record<AttributeAxis, number> = { str: 1, dex: 1, con: 1, int: 1, spi: 1 };
  for (const w of words) {
    const axis = CARD_ELEMENT_AXIS[w];
    if (axis) weights[axis] += AXIS_BONUS;
  }
  const order = [...AXES].sort(
    (a, b) => weights[b] - weights[a] || AXES.indexOf(a) - AXES.indexOf(b),
  );

  const auditLines: string[] = [];
  let capped = false;
  while (totalExp >= expToNext && level < cap) {
    level += 1;
    totalExp -= expToNext;
    // +3 五维点按权重比分入（逐点轮转权重降序，同 §2.3 余数口径）
    for (let i = 0; i < 3; i += 1) {
      attrs[order[i % order.length]] += 1;
    }
  }
  if (totalExp >= expToNext && level >= cap) {
    // 到 cap：溢出经验丢弃（清管归零，等进化仪式重锚后再攒）
    capped = true;
    totalExp = 0;
    auditLines.push(
      `▸ 已达${cardTier}品阶上限（Lv${cap}）——需进化蜕变才能继续成长（溢出经验不再累计）`,
    );
  }

  const maxHp = 30 + attrs.con * 8;
  const maxMp = 15 + attrs.int * 6 + attrs.spi * 4;
  const maxSp = 20 + attrs.con * 4;
  // 等比抬当前值（Δmax），不超新上限
  const hp = Math.min(maxHp, entity.hp + Math.max(0, maxHp - entity.maxHp));
  const mp = Math.min(maxMp, entity.mp + Math.max(0, maxMp - entity.maxMp));
  const sp = Math.min(maxSp, entity.sp + Math.max(0, maxSp - entity.maxSp));
  if (level > entity.level) {
    auditLines.unshift(`▸ 升级：Lv${entity.level} → Lv${level}（+3 五维点按词条权重分入）`);
  }

  return {
    level,
    totalExp,
    expToNext,
    attributes: attrs,
    maxHp,
    maxMp,
    maxSp,
    hp,
    mp,
    sp,
    auditLines: level > entity.level || capped ? auditLines : [],
  };
}
