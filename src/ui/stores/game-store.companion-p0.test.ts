/**
 * game-store.companion-p0.test.ts — 伙伴实体化两 P0 的 store 级集成回归（2026-10-03）
 *
 * CMP-01：投喂/并肩分成写 max* 曾被资源专线令整份硬拒（update_character 禁写资源）——
 *         现拆 set_max_* 专线，走真 commitChatState 验证投喂 ok 且实体成长落库。
 * CMP-02：伙伴袋是 Vue 响应式 Proxy，spread 进 patch 曾让 IDB put 抛 DataCloneError——
 *         companionBagOf 现返回去响应式深拷贝，验证佩戴落库成功。
 *
 * 照 set-location 测试的先例：不 mock StateManager，真引擎真落库（fake-indexeddb）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useGameStore } from './game-store';
import {
  initializeDatabase,
  clearAllData,
  saveSaveSlot,
  saveCharacter,
  saveSaveProfile,
  getCharacters,
} from '@engine/database';
import { createDefaultCharacterState } from '@engine/types';
import type { CardItem, CharacterState, SaveProfile, SaveSlot } from '@engine/types';

const SAVE_ID = 'save-companion-p0';

function makeSaveSlot(): SaveSlot {
  return {
    id: SAVE_ID,
    name: 'Companion P0 Test',
    slot: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    activeSnapshotId: null,
    metadata: {
      characterName: '理查德',
      userName: 'Tester',
      gameStartTime: '001-01-01',
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
    affections: {},
    worldFlags: {},
  } as unknown as SaveProfile;
}

/** 召唤卡（背包面）：词条含「召唤」，planFeedCompanion 的准入门槛 */
const summonCard: CardItem = {
  name: '噬星鲸背',
  quantity: 1,
  type: '卡牌',
  rarity: '普通',
  cardTier: '青铜',
  词条: ['水', '召唤'],
  description: '测试用召唤卡',
  sealed: false,
  recipe: {
    mainMaterial: '噬星鲸背',
    subMaterials: [],
    tier: '青铜',
    fusionKind: '叠加',
    cost: 10,
    rating: '成功',
  },
  cardExp: 0,
  cardPowerBonus: 0,
};

/** 伙伴实体（角色面）：带扩展袋（响应式与否由 store 的 characters.value 决定） */
function makeSummonEntity(): CharacterState {
  return createDefaultCharacterState({
    id: 'summon-1',
    saveId: SAVE_ID,
    type: 'summon',
    name: '噬星鲸背',
    level: 1,
    totalExp: 0,
    expToNext: 100,
    attributes: { str: 5, dex: 5, con: 5, int: 5, spi: 5 },
    hp: 80,
    maxHp: 80,
    mp: 40,
    maxMp: 40,
    sp: 60,
    maxSp: 60,
    present: true,
    customFields: {
      companion: {
        bornTier: '青铜',
        equip: {},
        evolution: { unlocked: false, offerings: [] },
        injured: false,
      },
    },
  }) as CharacterState;
}

async function seed(): Promise<void> {
  await saveSaveSlot(makeSaveSlot());
  await saveCharacter(
    createDefaultCharacterState({
      id: 'player-1',
      saveId: SAVE_ID,
      type: 'player',
      name: '理查德',
      location: '起始村庄',
      talents: {
        capacity: 3,
        list: [
          {
            name: '最终兵器：她',
            description: ' CMP-04 门槛（P1 未修）——本测只为过 gate 钉 CMP-02',
            source: 'creation',
            entries: [{ kind: '自我进化', channel: 'universal', params: {} }],
          },
        ],
      },
      inventory: [summonCard, { name: '月光苔', quantity: 5, type: '材料', rarity: '普通' }],
    }) as CharacterState,
  );
  await saveCharacter(makeSummonEntity());
  await saveSaveProfile(makeProfile());
}

describe('伙伴实体化 P0 集成回归（真 commitChatState）', () => {
  beforeEach(async () => {
    try {
      await clearAllData();
    } catch {
      /* db may not exist yet */
    }
    await initializeDatabase();
    await seed();
    setActivePinia(createPinia());
  });

  async function load(): Promise<ReturnType<typeof useGameStore>> {
    const store = useGameStore();
    await store.loadSave(SAVE_ID);
    return store;
  }

  it('CMP-01：投喂不再被资源专线令硬拒——实体 totalExp 成长落库', async () => {
    const game = await load();
    const result = await game.feedCompanion('噬星鲸背', '月光苔');
    if (!result.ok) console.log('[P0-test] reason:', result.reason);
    expect(result.ok).toBe(true);

    const entity = (await getCharacters(SAVE_ID)).find(
      (c) => c.name === '噬星鲸背' && c.type === 'summon',
    )!;
    expect(entity.totalExp).toBeGreaterThan(0); // 修复前：补丁整份被拒，恒 0
    // set_max_* 专线把成长公式重算的 max* 如实落库（可能低于夹具初值——公式值即权威）
    expect(entity.maxHp).toBeGreaterThan(0);
    expect(entity.maxMp).toBeGreaterThan(0);
    expect(entity.maxSp).toBeGreaterThan(0);
    expect(entity.hp).toBeLessThanOrEqual(entity.maxHp);
    // 素材被消耗
    const player = (await getCharacters(SAVE_ID)).find((c) => c.type === 'player')!;
    expect(player.inventory.some((i) => i.name === '月光苔' && (i.quantity ?? 1) >= 5)).toBe(false);
  });

  it('CMP-02：佩戴装备不再 DataCloneError——bag.equip 落库', async () => {
    const game = await load();
    // 给玩家配一件可佩戴装备（equippedSlot 空 + stats/slot 判定由 plan 决定——
    // 装备卡「行旅短刃」等；此处用类型『装备』的卡牌形态直接进背包）
    const player = game.player!;
    // 佩戴面以装备卡为主（规格现状）：卡牌 + 装备 kind → hand 槽
    player.inventory.push({
      name: '试炼短刃',
      quantity: 1,
      type: '卡牌',
      rarity: '普通',
      cardTier: '白铁',
      词条: ['金', '装备'],
      sealed: false,
      recipe: {
        mainMaterial: '试炼短刃',
        subMaterials: [],
        tier: '白铁',
        fusionKind: '叠加',
        cost: 10,
        rating: '成功',
      },
      cardExp: 0,
      cardPowerBonus: 0,
    } as never);
    const result = await game.equipCompanionItem('噬星鲸背', '试炼短刃');
    if (!result.ok) console.log('[P0-test] reason:', result.reason);
    expect(result.ok).toBe(true);

    const entity = (await getCharacters(SAVE_ID)).find(
      (c) => c.name === '噬星鲸背' && c.type === 'summon',
    )!;
    const bag = (
      entity.customFields as { companion: { equip: Record<string, string | undefined> } }
    ).companion;
    expect(Object.values(bag.equip)).toContain('试炼短刃'); // 修复前：DataCloneError 整份落库失败
  });

  it('CMP-02：定进化倾向不再 DataCloneError——archetype 落库', async () => {
    const game = await load();
    const result = await game.setEvolutionDirection('噬星鲸背', '镜影');
    if (!result.ok) console.log('[P0-test] reason:', result.reason);
    expect(result.ok).toBe(true);

    const entity = (await getCharacters(SAVE_ID)).find(
      (c) => c.name === '噬星鲸背' && c.type === 'summon',
    )!;
    const bag = (
      entity.customFields as {
        companion: { evolution: { archetype?: string; offerings?: string[]; unlocked?: boolean } };
      }
    ).companion;
    expect(bag.evolution.archetype).toBe('镜影');
  });
});
