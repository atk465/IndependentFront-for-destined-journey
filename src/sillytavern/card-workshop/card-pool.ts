/**
 * card-pool.ts — 铭刻卡池的**唯一读取口径**（2026-09-18）
 *
 * 🔴 为什么要有这个模块：内容仓的卡池此前被 8 处各自
 *    `parseCatalogData(getContentRegistry().catalog).cardPool` 直读 ——
 *    开发者模式在设置页加的自定义卡（`worldFlags.customCards` → 运行时注册表）
 *    于是**一条读取路径都进不去**：抽封铭卡抽不到、购卡池看不见、按名查定义也查不到。
 *    天赋那侧没有这个问题（`getCreationCatalog()` 等访问器内部就合并了自定义天赋），
 *    卡这侧补齐同一个形状：内容仓卡池 + 运行时自定义卡（**同 id 覆盖**）。
 *
 * 用法：任何要读「当前可用卡池」的地方都走这里，不要再直读 catalog.cardPool。
 */

import { parseCatalogData, type CardCatalogItem } from '../start-catalog-mechanics';
import { getContentRegistry } from '../content-registry-runtime';
import { getCustomCards, mergeCards } from './custom-content';

/**
 * 当前卡池：内容仓 `catalog.cardPool` + 自定义卡（同 id 覆盖内置）。
 *
 * 纯读取、无缓存 —— 调用方每次拿到的是最新快照（注册表是普通 Map，
 * 抽卡/查定义这类**调用时刻**读取天然是最新的；需要响应式的地方
 * 由调用方自己持有版本号，见 create-store 的 customVersion）。
 */
export function getCardPool(): CardCatalogItem[] {
  const base = parseCatalogData(getContentRegistry().catalog).cardPool;
  return mergeCards(base, getCustomCards());
}

/** 可购买卡池（排除禁忌仿卡 —— 仿卡只能靠仿制配方产出，不在商店出售） */
export function getPurchasableCardPool(): CardCatalogItem[] {
  return getCardPool().filter((c) => !c.imitation);
}

/**
 * 按卡名查卡池定义（自定义卡优先）。
 *
 * 自定义卡与内置卡 id 不同但同名时，`mergeCards` 按 id 去重不会覆盖它 ——
 * 而开发者写同名卡的意图就是"我要替换它"，所以这里按 **name** 先查自定义。
 */
export function findCardDefinition(name: string): CardCatalogItem | undefined {
  const custom = getCustomCards().find((c) => c.name === name);
  if (custom) return custom;
  return parseCatalogData(getContentRegistry().catalog).cardPool.find((c) => c.name === name);
}
