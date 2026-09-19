/**
 * custom-content.ts — 开发者模式自定义内容（2026-09-18）
 *
 * 开发者可通过可视化编辑器创建自定义天赋模板和购卡池卡牌。
 * 数据存 `worldFlags.customTalents` / `worldFlags.customCards`，
 * 读取时与内置目录合并（自定义优先——同名覆盖内置）。
 *
 * 设计要点：
 *  - 自定义天赋必须通过 `validateTalentEntries`（AI 零编数门禁照旧）
 *  - 自定义卡牌只做形状校验（id/name/cardTier/formEntry/cost 必填）
 *  - 合并策略：自定义条目按 name/id 去重后**追加**到内置列表尾部
 *
 * 纯度约束：合并/校验为纯函数；读写由调用方走 worldFlags。
 */

import type { TalentTemplate } from './talent-entry';
import { validateTalentEntries } from './talent-entry';
import type { CardCatalogItem } from '../start-catalog-mechanics';
import { CARD_TIERS, type CardTier } from '../field-enums';

// ════════════════════════════════════════════════════════════════════
// 自定义天赋
// ════════════════════════════════════════════════════════════════════

/** 宽读自定义天赋列表（脏值丢弃，绝不抛） */
export function coerceCustomTalents(raw: unknown): TalentTemplate[] {
  if (!Array.isArray(raw)) return [];
  const out: TalentTemplate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Partial<TalentTemplate>;
    if (typeof t.name !== 'string' || !t.name.trim()) continue;
    if (typeof t.grade !== 'string' || !t.grade) continue;
    if (!Array.isArray(t.entries)) continue;
    const v = validateTalentEntries(t.entries);
    if (!v.ok) continue;
    out.push({
      name: t.name.trim(),
      source: (t.source === 'creation' ||
      t.source === 'story' ||
      t.source === 'exchange' ||
      t.source === 'fusion'
        ? t.source
        : 'universal') as TalentTemplate['source'],
      grade: t.grade as TalentTemplate['grade'],
      description: typeof t.description === 'string' ? t.description : '',
      entries: v.normalized,
    });
  }
  return out;
}

/**
 * 合并内置目录 + 自定义天赋（纯函数）。
 *
 * 同名时自定义覆盖内置（开发者显式创建的同名天赋意味着"我要替换它"）。
 */
export function mergeTalents(
  base: readonly TalentTemplate[],
  custom: readonly TalentTemplate[],
): TalentTemplate[] {
  const customNames = new Set(custom.map((t) => t.name));
  const filtered = base.filter((t) => !customNames.has(t.name));
  return [...filtered, ...custom];
}

// ════════════════════════════════════════════════════════════════════
// 自定义购卡
// ════════════════════════════════════════════════════════════════════

/**
 * 自定义卡的**运行时真源**（2026-09-18 真机修）。
 *
 * 🔴 为什么要这一层：卡此前只有「存档级 `worldFlags.customCards`」一条路 ——
 *    而编辑器在**设置页**，多半没有活跃存档，`addCustomCard` 直接静默 return
 *    → 卡没存住 → 导出只有天赋、购卡池也看不到自己加的卡（提示却写着「已添加」）。
 *    天赋那侧一开始就是「内存 map 为运行时真源 + 存档做持久化」，卡现在对齐它。
 *
 * 读写链：编辑器写这里（立即生效）→ 有活跃存档时顺带持久化 → 进游戏时从存档灌回。
 */
const customCardMap = new Map<string, CardCatalogItem>();

/** 注册/覆盖一张自定义卡（按 id 去重） */
export function registerCustomCard(card: CardCatalogItem): void {
  // 同名不同 id 时丢弃旧条目：编辑器每次保存都新生成 id，不清理会在池子里
  // 留下两张同名卡，而按名查定义只会命中先注册的那张（旧版本）—— 见 findCardDefinition。
  for (const [id, existing] of customCardMap) {
    if (existing.name === card.name && id !== card.id) customCardMap.delete(id);
  }
  customCardMap.set(card.id, card);
}

/** 注销一张自定义卡 */
export function unregisterCustomCard(id: string): void {
  customCardMap.delete(id);
}

/** 当前全部自定义卡（运行时真源） */
export function getCustomCards(): CardCatalogItem[] {
  return [...customCardMap.values()];
}

/** 用给定列表整体替换运行时注册表（从存档灌回时用） */
export function replaceCustomCards(list: readonly CardCatalogItem[]): void {
  customCardMap.clear();
  for (const c of list) customCardMap.set(c.id, c);
}

/** 宽读自定义卡池（脏值丢弃，绝不抛） */
export function coerceCustomCards(raw: unknown): CardCatalogItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CardCatalogItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Partial<CardCatalogItem>;
    if (typeof c.id !== 'string' || !c.id.trim()) continue;
    if (typeof c.name !== 'string' || !c.name.trim()) continue;
    if (!CARD_TIERS.includes(c.cardTier as CardTier)) continue;
    if (typeof c.cost !== 'number' || !Number.isFinite(c.cost) || c.cost < 0) continue;
    const y = coerceCardYield(c.yield);
    out.push({
      id: c.id.trim(),
      name: c.name.trim(),
      cardTier: c.cardTier as CardTier,
      formEntry: (c.formEntry ?? '装备') as CardCatalogItem['formEntry'],
      element: typeof c.element === 'string' ? c.element : undefined,
      description: typeof c.description === 'string' ? c.description : '',
      cost: Math.max(0, Math.round(c.cost)),
      ...(c.companion ? { companion: c.companion } : {}),
      ...(y ? { yield: y } : {}),
    });
  }
  return out;
}

/**
 * 宽读物资卡产出定义（2026-09-18）。
 *
 * 🔴 为什么要留这个字段：`useSupplyCard` 的门槛就是「有 yield」，而**没有 yield
 *    的物资卡是纯废卡**（点了没反应）。手写模板/导入 JSON 的作者没法通过编辑器
 *    补这个字段 —— 编辑器没有产出输入框 —— 所以这里至少别在导入时把它吃掉。
 * 无 `name` 也无 `gc` 的产出视为无定义（与 useSupplyCard 的门槛同口径）。
 */
function coerceCardYield(raw: unknown): CardCatalogItem['yield'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const y = raw as NonNullable<CardCatalogItem['yield']>;
  const name = typeof y.name === 'string' && y.name.trim() ? y.name.trim() : undefined;
  const gc =
    typeof y.gc === 'number' && Number.isFinite(y.gc) && y.gc > 0 ? Math.round(y.gc) : undefined;
  if (!name && !gc) return undefined;
  return {
    ...(name ? { name } : {}),
    quantity:
      typeof y.quantity === 'number' && Number.isFinite(y.quantity) && y.quantity > 0
        ? Math.round(y.quantity)
        : 1,
    itemType: y.itemType === '材料' ? '材料' : '消耗品',
    ...(gc ? { gc } : {}),
  };
}

/**
 * 合并内置卡池 + 自定义卡（纯函数）。
 *
 * 同 id 时自定义覆盖内置。
 */
export function mergeCards(
  base: readonly CardCatalogItem[],
  custom: readonly CardCatalogItem[],
): CardCatalogItem[] {
  const customIds = new Set(custom.map((c) => c.id));
  const filtered = base.filter((c) => !customIds.has(c.id));
  return [...filtered, ...custom];
}
