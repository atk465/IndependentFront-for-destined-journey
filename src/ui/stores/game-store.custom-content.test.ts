/**
 * game-store 自定义内容（开发者模式）——真机 bug 回归。
 *
 * 原始症状：「导出只会导出天赋，购卡完全没有」。
 * 根因是卡只有存档级存储，而编辑器在设置页（多半没有活跃存档），
 * `addCustomCard` 开头就静默 return —— 卡没存住，界面却提示「已添加」。
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  clearAllData,
  getSaveProfile,
  initializeDatabase,
  saveCharacter,
  saveSaveProfile,
  saveSaveSlot,
} from '@engine/database';
import { createDefaultCharacterState, type SaveProfile, type SaveSlot } from '@engine/types';
import type { CardCatalogItem } from '@engine/start-catalog-mechanics';
import type { TalentTemplate } from '@engine/card-workshop/talent-entry';
import { getCustomTalents, clearCustomTalents } from '@engine/card-workshop/talent-entry';
import { getCustomCards, replaceCustomCards } from '@engine/card-workshop/custom-content';
import { useGameStore } from './game-store';

const SAVE_ID = 'save-custom-content';

const 自定义卡: CardCatalogItem = {
  id: 'custom-regress-1',
  name: '回归测试卡',
  cardTier: '青铜',
  formEntry: '物资',
  description: '真机 bug 回归用',
  cost: 20,
  yield: { name: '测试产出', quantity: 1, itemType: '消耗品' },
};

const 自定义天赋: TalentTemplate = {
  name: '回归测试天赋',
  source: 'universal',
  grade: 'A',
  description: '真机 bug 回归用',
  entries: [{ kind: '行动值加成', channel: 'universal', params: { amount: 2 } }],
};

/** 等 fire-and-forget 的 commitChatState 落地 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

function makeSave(): SaveSlot {
  return {
    id: SAVE_ID,
    name: 'Custom Content Test',
    slot: 0,
    createdAt: 1,
    updatedAt: 1,
    activeSnapshotId: null,
    metadata: {
      characterName: '阿黑',
      userName: 'Tester',
      gameStartTime: '0488-01-01',
      totalTurns: 0,
    },
  };
}

function makeProfile(): SaveProfile {
  return {
    saveId: SAVE_ID,
    experienceMode: 'normal',
    fp: 0,
    fpHistory: [],
    reputation: 0,
    contracts: [],
    achievements: [],
    news: [],
    quests: {},
    focusQuest: '',
    affections: {},
    gameTime: { era: '复兴纪元', year: 488, month: 1, day: 1, weekday: 7, hour: 8, minute: 0 },
    variables: {},
    // 新存档的 worldFlags 就是空对象（database.ts 建档只给 {}）—— 播种逻辑就针对这种情况
    worldFlags: {},
    updatedAt: 1,
  };
}

async function seedSave() {
  await saveSaveSlot(makeSave());
  await saveSaveProfile(makeProfile());
  await saveCharacter(
    createDefaultCharacterState({
      id: 'hero',
      saveId: SAVE_ID,
      name: '阿黑',
      type: 'player',
      personality: '天真',
      appearance: '身形纤细',
      background: '来自异世界',
      hp: 42,
      maxHp: 100,
    }),
  );
}

beforeEach(async () => {
  try {
    await clearAllData();
  } catch {
    /* 首次运行时数据库尚未建立 */
  }
  await initializeDatabase();
  setActivePinia(createPinia());
  replaceCustomCards([]);
  clearCustomTalents();
});

describe('无活跃存档时写自定义内容（真机 bug）', () => {
  it('加卡后仍读得到（此前被静默丢弃 → 导出里没有卡）', () => {
    const game = useGameStore();
    expect(game.activeSaveId).toBeFalsy();

    game.addCustomCard(自定义卡);

    expect(game.customCards()).toHaveLength(1);
    expect(game.customCards()[0].name).toBe('回归测试卡');
    expect(getCustomCards()).toHaveLength(1);
  });

  it('无存档时写天赋同样生效（注册表路径，不再被存档闸挡住）', () => {
    const game = useGameStore();
    game.saveCustomTalents([自定义天赋]);
    expect(getCustomTalents()).toHaveLength(1);
  });

  it('删除也生效', () => {
    const game = useGameStore();
    game.addCustomCard(自定义卡);
    game.removeCustomCard(自定义卡.id);
    expect(game.customCards()).toHaveLength(0);
  });
});

describe('有活跃存档时写自定义内容', () => {
  it('落进 worldFlags.customCards 并能读回', async () => {
    await seedSave();
    const game = useGameStore();
    await game.loadSave(SAVE_ID);

    game.addCustomCard(自定义卡);
    await flush();

    const profile = await getSaveProfile(SAVE_ID);
    const saved = profile?.worldFlags?.customCards as CardCatalogItem[] | undefined;
    expect(saved?.map((c) => c.id)).toContain('custom-regress-1');
  });

  it('重新读档后仍在（持久化 → 运行时灌回）', async () => {
    await seedSave();
    const game = useGameStore();
    await game.loadSave(SAVE_ID);
    game.addCustomCard(自定义卡);
    await flush();

    // 模拟刷新页面：注册表清空后从存档重建
    replaceCustomCards([]);
    await game.loadSave(SAVE_ID);

    expect(game.customCards().map((c) => c.id)).toContain('custom-regress-1');
    expect(game.customCards()[0].yield).toMatchObject({ name: '测试产出' });
  });
});

describe('刷新页面后仍在（真落库，不靠会话层）', () => {
  it('换一个全新的 store（空会话层）读档，自定义卡还在', async () => {
    await seedSave();
    const game = useGameStore();
    await game.loadSave(SAVE_ID);
    game.addCustomCard(自定义卡);
    await flush();

    // 全新 pinia = 全新 store = 空会话层，等价于按了 F5
    replaceCustomCards([]);
    setActivePinia(createPinia());
    const fresh = useGameStore();
    await fresh.loadSave(SAVE_ID);

    expect(fresh.customCards().map((c) => c.id)).toContain('custom-regress-1');
    expect(fresh.customCards()[0].yield).toMatchObject({ name: '测试产出' });
  });

  it('自定义天赋同样跨刷新存活', async () => {
    await seedSave();
    const game = useGameStore();
    await game.loadSave(SAVE_ID);
    game.saveCustomTalents([自定义天赋]);
    await flush();

    clearCustomTalents();
    setActivePinia(createPinia());
    const fresh = useGameStore();
    await fresh.loadSave(SAVE_ID);

    expect(getCustomTalents().map((t) => t.name)).toContain('回归测试天赋');
  });
});

describe('会话稿播种（先写内容、再开新档）', () => {
  it('新存档 worldFlags 为空时，把会话里写的卡播种进去（否则刷新就没了）', async () => {
    const game = useGameStore();
    game.addCustomCard(自定义卡); // 设置页里先写好，此时还没有存档

    await seedSave();
    await game.loadSave(SAVE_ID);
    await flush();

    // 这一局读得到
    expect(game.customCards().map((c) => c.id)).toContain('custom-regress-1');
    // 且已经写进新存档（刷新页面不会丢）
    const profile = await getSaveProfile(SAVE_ID);
    const saved = profile?.worldFlags?.customCards as CardCatalogItem[] | undefined;
    expect(saved?.map((c) => c.id)).toContain('custom-regress-1');
  });

  it('已有内容的存档不被会话稿覆盖（存档为准）', async () => {
    await seedSave();
    const game = useGameStore();
    // 先让存档里有一张别的卡
    await game.loadSave(SAVE_ID);
    game.addCustomCard({ ...自定义卡, id: 'save-own-1', name: '存档自己的卡' });
    await flush();

    // 之后会话里又写了新卡，再读档 —— 存档的那张不能被顶掉
    await game.loadSave(SAVE_ID);
    const ids = game.customCards().map((c) => c.id);
    expect(ids).toContain('save-own-1');
  });
});
