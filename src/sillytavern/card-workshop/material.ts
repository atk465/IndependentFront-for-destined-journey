/**
 * material.ts — 库存物品 → 融合内核 MaterialSpec 的唯一映射（纯函数）
 *
 * InventoryItem 没有售价/元素字段（那是叙事侧的产出），制台预览按下面的
 * 确定性规则推导，零随机、零 AI：
 * - tier：7 级品质 → 1-5 档素材稀有度（普通=1 … 传说=5；神话/唯一封顶 5）
 * - price：data.price（有限非负数）优先 —— craft/item_gen 叙事侧若有标价就以它为准；
 *   否则按 10 × tier 估价（预览口径，UI 标注为「估价」）
 * - elements：内建素材元素档案（BUILTIN_MATERIAL_ELEMENTS）优先，内容包
 *   catalog.materialElements 可同名覆写；未登记的名字回落关键词推导
 *   （全词匹配不可行 —— AI 自由命名，按字面包含判定，宁可多提示一个元素
 *   也不静默漏掉相生/相克）
 */

import type { InventoryItem } from '../types';
import { QUALITY_RANK } from '../types';
import { RARITY_LEVELS, type Rarity } from '../field-enums';
import type { MaterialSpec } from './card-fusion';

/** 铭刻纪元九元素（覆盖融合内核相生/相克表用到的全部元素） */
export const ELEMENT_KEYWORDS = ['火', '水', '风', '土', '雷', '光', '暗', '冰', '金'] as const;

// ── 素材元素档案（2026-09-25：内容包 catalog.materialElements → 这里）──
//
// 名字关键词推导太稀：采集素材名（世界树嫩芽/精灵花/月光苔…）极少恰好含九元素
// 字样，按名猜的结果是大多数素材 elements 为空 → 制出的卡「无词条」。档案由
// 内容仓正典给定（材质语义 → 元素），运行时注册；未登记的名字回落关键词推导。
const materialElementOverrides = new Map<string, string[]>();

/** 注册素材元素档案（值只收九元素内的标签，脏值丢弃；同名覆盖） */
export function registerMaterialElements(map: Record<string, unknown> | undefined): void {
  if (!map) return;
  for (const [name, tags] of Object.entries(map)) {
    if (typeof name !== 'string' || !name.trim()) continue;
    if (!Array.isArray(tags)) continue;
    const clean = [...new Set(tags.filter((t): t is string => typeof t === 'string'))].filter(
      (t) => (ELEMENT_KEYWORDS as readonly string[]).includes(t),
    );
    if (clean.length === 0) continue;
    materialElementOverrides.set(name.trim(), clean);
  }
}

/**
 * 内建素材元素档案（2026-09-25）。
 *
 * 🔴 为什么在引擎不在内容包：这 54 个名字就是引擎采集表（gathering.ENVIRONMENT_TABLE）
 *    自己的产出——名字住在引擎，元素档案就跟着住在引擎（与 quest-chain-seeds 同款
 *    「builtin 运行时常驻」）。按名猜关键词太稀（月光苔/世界树嫩芽大多不含九元素字），
 *    真机实证词条成片为空。内容包 catalog.materialElements 通道保留作**覆写**：
 *    loadCustomContent 会再注册包面数据，同名以包为准。
 * 映射依据：物产志正典风味（月光苔泛冷光→光、赤铁矿火性足→火）+ 材质语义归类。
 */
export const BUILTIN_MATERIAL_ELEMENTS: Readonly<Record<string, string[]>> = Object.freeze({
  // 森林
  止血草: ['水'], 蒲公英: ['风'], 月光苔: ['光'], 铁木叶: ['金'],
  千年树心: ['土'], 精灵花: ['光'], 龙血草: ['火'], 世界树叶: ['光'],
  世界树嫩芽: ['风'],
  // 矿山
  铁矿: ['金'], 铜矿: ['金'], 秘银: ['光'], 赤铁矿: ['火'],
  星陨石: ['雷'], 深山晶簇: ['土'], 龙鳞矿: ['火'], 泰坦核: ['土'],
  星核原石: ['光'],
  // 水域
  河蚌: ['水'], 水草: ['水'], 珍珠贝: ['水'], 深海鱼鳞: ['冰'],
  人鱼泪: ['水'], 海妖之歌: ['暗'], 深渊珊瑚: ['暗'], 利维坦鳞: ['冰'],
  海神之心: ['水'],
  // 冰原
  碎冰: ['冰'], 寒霜草: ['冰'], 霜晶: ['冰'], 冰蚕丝: ['冰'],
  极光碎片: ['光'], '永冻 core': ['冰'], 冰龙鳞: ['冰'], 极寒之心: ['冰'],
  绝对零度结晶: ['冰'],
  // 沙漠
  沙粒: ['土'], 仙人掌刺: ['土'], 玻璃砂: ['光'], 沙漠玫瑰: ['土'],
  沙漠之星: ['光'], 砂金石: ['金'], 沙暴之眼: ['风'], 金蝎壳: ['金'],
  沙漠心脏: ['火'],
  // 沼泽
  腐泥: ['暗'], 毒蘑菇: ['暗'], 沼气结晶: ['火'], 蛙卵: ['水'],
  深沼之眼: ['暗'], 腐龙鳞: ['暗'], 九头蛇血: ['水'], 沼泽女王花: ['暗'],
  '沼泽之心的碎片': ['水'],
  // 商店杂货（可入工坊的）
  火绒盒: ['火'], 粗铁锭: ['金'],
});

// 模块加载即注册内建档案（包面数据随后可同名覆盖）
registerMaterialElements(BUILTIN_MATERIAL_ELEMENTS);

/** 清空档案（测试用；会连内建一起清，测试里重注册即可） */
export function clearMaterialElementOverrides(): void {
  materialElementOverrides.clear();
}

/** 品质 → 素材稀有度 1-5（7 级品质的后两档封顶） */
export function itemTierToMaterialTier(item: InventoryItem): number {
  const rank = item.rarity ? QUALITY_RANK[item.rarity] + 1 : 1;
  return Math.min(5, Math.max(1, rank));
}

/** 素材价格：data.price 优先，否则按稀有度估价（GC） */
export function materialPriceOf(item: InventoryItem): number {
  const p = (item.data as Record<string, unknown> | undefined)?.['price'];
  if (typeof p === 'number' && Number.isFinite(p) && p >= 0) return Math.round(p);
  return 10 * itemTierToMaterialTier(item);
}

// ════════════════════════════════════════════════════════════════════
// 素材点金（S「素材点金」）：把一个素材的品质提升 n 档
// ════════════════════════════════════════════════════════════════════

export interface RarityUpgradePlan {
  /** 原名 */
  itemName: string;
  from: Rarity;
  to: Rarity;
  /** 实际提升的档数（封顶时可能小于请求值） */
  steps: number;
  summary: string;
}

/**
 * 规划一次素材升档（纯函数）。
 *
 * 口径：素材的 `rarity` 走 `RARITY_LEVELS`（普通→优良→稀有→史诗→传说→神话→唯一），
 * 每次升 steps 档、**封顶不越界**（已是「唯一」→ 拒绝，不静默吞掉一次每日机会）。
 *
 * 只吃素材（材料类物品）：卡牌/装备的成长走各自的通道，这里不越界。
 */
export function planRarityUpgrade(
  item: Pick<InventoryItem, 'name' | 'type' | 'rarity'>,
  steps = 1,
): { ok: boolean; reason?: string; plan?: RarityUpgradePlan } {
  if (item.type !== '材料') {
    return { ok: false, reason: `【${item.name}】不是素材——点金只对材料类物品有效` };
  }
  const from = (RARITY_LEVELS as readonly string[]).includes(item.rarity ?? '')
    ? (item.rarity as Rarity)
    : '普通';
  const idx = RARITY_LEVELS.indexOf(from);
  const want = Math.max(1, Math.round(steps) || 1);
  const nextIdx = Math.min(idx + want, RARITY_LEVELS.length - 1);
  if (nextIdx === idx) {
    return { ok: false, reason: `【${item.name}】已是最高品质（${from}）——点金无可再上` };
  }
  const to = RARITY_LEVELS[nextIdx];
  return {
    ok: true,
    plan: {
      itemName: item.name,
      from,
      to,
      steps: nextIdx - idx,
      summary: `点金【${item.name}】——品质 ${from} → ${to}`,
    },
  };
}

/** 推导元素标签：素材元素档案优先（内容包正典），未登记的名字再按关键词猜 */
export function deriveElements(item: InventoryItem): string[] {
  const hit = materialElementOverrides.get(item.name ?? '');
  if (hit && hit.length > 0) return hit;
  const hay = [item.name ?? '', ...Object.keys(item.effects ?? {})].join(' ');
  return ELEMENT_KEYWORDS.filter((e) => hay.includes(e));
}

/** InventoryItem → 融合内核输入 */
export function toMaterial(item: InventoryItem): MaterialSpec {
  return {
    name: item.name,
    price: materialPriceOf(item),
    tier: itemTierToMaterialTier(item),
    elements: deriveElements(item),
  };
}
