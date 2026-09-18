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
    out.push({
      id: c.id.trim(),
      name: c.name.trim(),
      cardTier: c.cardTier as CardTier,
      formEntry: (c.formEntry ?? '装备') as CardCatalogItem['formEntry'],
      element: typeof c.element === 'string' ? c.element : undefined,
      description: typeof c.description === 'string' ? c.description : '',
      cost: Math.max(0, Math.round(c.cost)),
      ...(c.companion ? { companion: c.companion } : {}),
    });
  }
  return out;
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
