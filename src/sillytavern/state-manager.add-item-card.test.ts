/**
 * state-manager.add-item-card.test.ts — add_item 的卡牌字段直通回归
 *
 * 背景（委托×地图闭环 2026-09-19 发现）：新物品分支的白名单只有 InventoryItem 字段，
 * CardItem 的 cardTier/词条/recipe/sealed 落库即丢——制卡主路、购卡、委托发卡三条
 * 加卡路径全走 add_item。修复后：给值才写，非卡物品零影响。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  initializeDatabase,
  clearAllData,
  saveCharacter,
  getCharacters,
} from './database';
import { createStateManager } from './state-manager';
import { createDefaultCharacterState } from './types';
import type { CardItem } from './types';

beforeEach(async () => {
  await initializeDatabase();
  await clearAllData();
  await saveCharacter(
    createDefaultCharacterState({
      id: 'p',
      saveId: 'atomic',
      name: 'Player',
      type: 'player',
    }),
  );
});

const FORBIDDEN_CARD: Partial<CardItem> = {
  name: '禁忌卡·雪葬',
  quantity: 1,
  type: '卡牌',
  cardTier: '星辉',
  词条: ['禁忌', '冰'],
  recipe: {
    mainMaterial: '雪莲',
    subMaterials: [],
    tier: '星辉',
    fusionKind: '叠加',
    cost: 100,
    rating: '成功',
  },
  sealed: false,
  cardExp: 0,
  cardPowerBonus: 0,
};

describe('add_item 卡牌字段直通', () => {
  it('新卡落库保留 cardTier/词条/recipe/sealed（发卡/制卡共用此路径）', async () => {
    const sm = createStateManager('atomic');
    const result = await sm.commitChatState([
      { op: 'add_item', target: 'characters.Player', value: FORBIDDEN_CARD },
    ]);
    expect(result.success).toBe(true);

    const inv = (await getCharacters('atomic'))[0].inventory;
    const card = inv.find((i) => i.name === '禁忌卡·雪葬') as CardItem | undefined;
    expect(card).toBeDefined();
    expect(card!.type).toBe('卡牌');
    expect(card!.cardTier).toBe('星辉');
    expect(card!.词条).toEqual(['禁忌', '冰']);
    expect(card!.recipe.mainMaterial).toBe('雪莲');
    expect(card!.sealed).toBe(false);
  });

  it('同名合并只累加数量，不动既有字段', async () => {
    const sm = createStateManager('atomic');
    await sm.commitChatState([
      { op: 'add_item', target: 'characters.Player', value: FORBIDDEN_CARD },
      {
        op: 'add_item',
        target: 'characters.Player',
        value: { name: '禁忌卡·雪葬', quantity: 2, cardTier: '白铁' },
      },
    ]);
    const inv = (await getCharacters('atomic'))[0].inventory;
    const card = inv.find((i) => i.name === '禁忌卡·雪葬') as CardItem;
    expect(card.quantity).toBe(3);
    expect(card.cardTier).toBe('星辉');
  });

  it('非卡物品不受影响（不带卡字段）', async () => {
    const sm = createStateManager('atomic');
    await sm.commitChatState([
      {
        op: 'add_item',
        target: 'characters.Player',
        value: { name: '铁矿', quantity: 2, type: '材料' },
      },
    ]);
    const inv = (await getCharacters('atomic'))[0].inventory;
    const item = inv.find((i) => i.name === '铁矿');
    expect(item).toMatchObject({ name: '铁矿', quantity: 2, type: '材料' });
    expect((item as Partial<CardItem>).cardTier).toBeUndefined();
    expect((item as Partial<CardItem>).词条).toBeUndefined();
  });
});
