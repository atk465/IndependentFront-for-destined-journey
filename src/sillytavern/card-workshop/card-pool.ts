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
import { QUEST_CHAIN_CARD_SEEDS } from './quest-chain-seeds';

/**
 * 禁忌卡七链的七张卡（六正本 + 第一行残铭）——**内置只读内容**（builtin 模式，
 * 照 builtin-worldbooks 先例）：常驻卡池、不落库、玩家不可编辑（它们是链的终点
 * 奖励，不是素材）。同名自定义卡可覆盖（开发者想调(description/元素)时有用）。
 */
function mergeQuestChainCards(base: CardCatalogItem[]): CardCatalogItem[] {
  const names = new Set(base.map((c) => c.name));
  return [...base, ...QUEST_CHAIN_CARD_SEEDS.filter((c) => !names.has(c.name))];
}

/**
 * 当前卡池：内容仓 `catalog.cardPool` + 自定义卡（同 id 覆盖内置）。
 *
 * 纯读取、无缓存 —— 调用方每次拿到的是最新快照（注册表是普通 Map，
 * 抽卡/查定义这类**调用时刻**读取天然是最新的；需要响应式的地方
 * 由调用方自己持有版本号，见 create-store 的 customVersion）。
 */
export function getCardPool(): CardCatalogItem[] {
  const base = parseCatalogData(getContentRegistry().catalog).cardPool;
  return mergeQuestChainCards(mergeCards(base, getCustomCards()));
}

/** 可购买卡池（排除禁忌仿卡与禁忌正本——前者只能仿制产出，后者只能经任务链获取） */
export function getPurchasableCardPool(): CardCatalogItem[] {
  return getCardPool().filter((c) => !c.imitation && !c.forbidden);
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
  const seed = QUEST_CHAIN_CARD_SEEDS.find((c) => c.name === name);
  if (seed) return seed;
  return parseCatalogData(getContentRegistry().catalog).cardPool.find((c) => c.name === name);
}
