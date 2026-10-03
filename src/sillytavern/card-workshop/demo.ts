/**
 * demo.ts — 演示卡注入（仅 dev 模式，开发/调试用）
 *
 * 设计（playable-loop 真机走查配套工具）：
 * - 给玩家背包塞 4 张覆盖八类的演示卡，并自动编入卡组（卡组条立刻可见）
 * - 全部确定性、无 LLM、不接 craft_gen 链；专用于「无 LLM 也能立刻验证玩卡链路」
 * - 生产构建通过 import.meta.env.DEV 守卫，main bundle 零残留（仅 dev 入口可见）
 *
 * 演示卡选型：
 * - 地景「灼热盆地」白银：火系领域（持久环境 + automata 触发）
 * - 召唤「远古巨兽·岩爪」鎏金：召唤契约伙伴（首召入库）
 * - 技能「燃魂打击」青铜：火系技能（消耗卡，打出即生效）
 * - 装备「苍穹之翼」白银：装备光环（持久注册，攻击窗口 heal）
 */

import type { CardItem, InventoryItem, StatePatch } from '@engine/types';
import { CARD_TIERS } from '@engine/field-enums';

/** 八类演示卡（覆盖每类至少 1 张）+ 战前自动编入卡组 */
const DEMO_CARDS: CardItem[] = [
  // 地景：领域卡
  {
    name: '灼热盆地',
    quantity: 1,
    type: '卡牌',
    rarity: '优良',
    cardTier: '白银',
    词条: ['火', '地景'],
    sealed: false,
    recipe: {
      mainMaterial: '火晶',
      subMaterials: [],
      tier: '白银',
      fusionKind: '叠加',
      cost: 50,
      rating: '成功',
    },
  },
  // 召唤：伙伴卡
  {
    name: '远古巨兽·岩爪',
    quantity: 1,
    type: '卡牌',
    rarity: '史诗',
    cardTier: '鎏金',
    词条: ['土', '召唤'],
    sealed: false,
    recipe: {
      mainMaterial: '地脉髓',
      subMaterials: [],
      tier: '鎏金',
      fusionKind: '叠加',
      cost: 200,
      rating: '成功',
    },
  },
  // 技能：消耗卡
  {
    name: '燃魂打击',
    quantity: 1,
    type: '卡牌',
    rarity: '优良',
    cardTier: '青铜',
    词条: ['火', '技能'],
    sealed: false,
    recipe: {
      mainMaterial: '火晶',
      subMaterials: ['炎心草'],
      tier: '青铜',
      fusionKind: '相生',
      cost: 80,
      rating: '成功',
    },
  },
  // 装备：光环卡
  {
    name: '苍穹之翼',
    quantity: 1,
    type: '卡牌',
    rarity: '优良',
    cardTier: '白银',
    词条: ['风', '装备'],
    sealed: false,
    recipe: {
      mainMaterial: '疾风羽',
      subMaterials: [],
      tier: '白银',
      fusionKind: '叠加',
      cost: 60,
      rating: '成功',
    },
  },
];

/** 配套素材（让主人制卡台也有得用，不只是战斗演示卡） */
const DEMO_MATERIALS: InventoryItem[] = [
  { name: '火晶', quantity: 3, type: '材料', rarity: '普通', data: { price: 10 } },
  { name: '疾风羽', quantity: 3, type: '材料', rarity: '普通', data: { price: 10 } },
  { name: '地脉髓', quantity: 2, type: '材料', rarity: '优良', data: { price: 20 } },
];

/** 验收 demo 卡的 cardTier 是否在 CARD_TIERS 范围内（防御性运行时校验） */
function isKnownTier(tier: string): boolean {
  return (CARD_TIERS as readonly string[]).includes(tier);
}

/** 注入演示卡 + 素材的 StatePatch[]（不绑存档：调用方拿 playerName 自己拼 target） */
export function buildDemoCardsPatches(playerName: string): StatePatch[] {
  const patches: StatePatch[] = [];
  for (const card of DEMO_CARDS) {
    if (!isKnownTier(card.cardTier)) continue; // 防御：未来 CARD_TIERS 缩了也不要卡住 dev
    patches.push({
      op: 'add_item',
      target: `characters.${playerName}`,
      value: card,
    });
  }
  for (const m of DEMO_MATERIALS) {
    patches.push({
      op: 'add_item',
      target: `characters.${playerName}`,
      value: m,
    });
  }
  return patches;
}

/**
 * 把 4 张演示卡一并编入卡组（卡组条立刻可见）。
 * 演示种子语义：重置 cardAlbum 为「演示卡全集」（不与玩家原有卡合并——
 * 演示的目的是立刻看到玩卡链路，不该把主人的存档结构搞复杂）。
 */
export function buildDemoDeckPatches(playerName: string): StatePatch[] {
  const deckNames = DEMO_CARDS.map((c) => c.name);
  return [
    {
      op: 'update_character',
      target: `characters.${playerName}`,
      value: {
        cardAlbum: { owned: deckNames, deck: deckNames, capacity: 60 },
      },
    },
  ];
}
