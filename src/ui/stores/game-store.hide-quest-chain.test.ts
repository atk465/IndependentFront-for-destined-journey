/**
 * game-store.hideQuestChainSeed — 玩家「删除」七链 seed 的生效时序回归
 *
 * 钉住的是一条时序性质：藏匿（chainHidden 落库）必须**当场**重装运行时槽——
 * 委托板/编辑器读的是 commission-runtime 槽，若只落库不重装，「删除」的 seed
 * 会一直显示、一直可接，直到下次读档才凭空消失（2026-09-21 修的存量 bug）。
 *
 * 照 set-location 测试的先例：不 mock StateManager，真引擎真落库，读档路径
 * 本身就是重装路径——所以每个用例清库重载后槽自然还原，互不污染。
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
  getSaveProfile,
} from '@engine/database';
import { createDefaultCharacterState } from '@engine/types';
import type { SaveSlot, SaveProfile, CharacterState } from '@engine/types';
import { QUEST_CHAIN_COMMISSION_SEEDS } from '@engine/card-workshop/quest-chain-seeds';
import { getCommissionDefs } from '@engine/commission-runtime';

const SAVE_ID = 'save-hide-quest-chain';

const seedCommission = QUEST_CHAIN_COMMISSION_SEEDS[0];
const SEED_NAME = seedCommission ? seedCommission.name : '';

function makeSaveSlot(): SaveSlot {
  return {
    id: SAVE_ID,
    name: 'Hide Quest Chain Test',
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
    worldFlags: {},
  } as unknown as SaveProfile;
}

function makeChar(): CharacterState {
  return {
    ...createDefaultCharacterState(),
    saveId: SAVE_ID,
    id: 'player-1',
    name: '理查德',
    type: 'player',
  } as CharacterState;
}

async function seed(): Promise<void> {
  await saveSaveSlot(makeSaveSlot());
  await saveCharacter(makeChar());
  await saveSaveProfile(makeProfile());
}

describe('hideQuestChainSeed（藏匿 seed 立即生效）', () => {
  beforeEach(async () => {
    try {
      await clearAllData();
    } catch {
      /* db may not exist yet */
    }
    await initializeDatabase();
  });

  it('藏匿后运行时槽当场不含该 seed（不等读档），且 chainHidden 落库', async () => {
    await seed();
    setActivePinia(createPinia());
    const store = useGameStore();
    await store.loadSave(SAVE_ID);

    expect(SEED_NAME).toBeTruthy();
    // 前置：seed 委托确实在运行时槽里（委托板的数据源）
    expect(getCommissionDefs().some((d) => d.name === SEED_NAME)).toBe(true);

    const result = await store.hideQuestChainSeed(SEED_NAME);
    expect(result.ok).toBe(true);

    // 🔴 回归点：运行时槽立即重装过滤——委托板/编辑器当场看不见、接不了
    expect(getCommissionDefs().some((d) => d.name === SEED_NAME)).toBe(false);

    // 真源落库：worldFlags.commissions.chainHidden 记名
    const profile = await getSaveProfile(SAVE_ID);
    const bag = (profile?.worldFlags as Record<string, Record<string, unknown>> | undefined)
      ?.commissions;
    expect(bag?.chainHidden).toEqual([SEED_NAME]);
  });

  it('重复藏匿同名不产生重复记名；读档后过滤持续生效', async () => {
    await seed();
    setActivePinia(createPinia());
    const store = useGameStore();
    await store.loadSave(SAVE_ID);

    await store.hideQuestChainSeed(SEED_NAME);
    await store.hideQuestChainSeed(SEED_NAME);
    expect(getCommissionDefs().some((d) => d.name === SEED_NAME)).toBe(false);

    const profile = await getSaveProfile(SAVE_ID);
    const bag = (profile?.worldFlags as Record<string, Record<string, unknown>> | undefined)
      ?.commissions;
    expect(bag?.chainHidden).toEqual([SEED_NAME]);

    // 下次读档：合并层照名单过滤，seed 不复活（questChainSeeded 复活路线已由架构废弃）
    const reloaded = useGameStore();
    await reloaded.loadSave(SAVE_ID);
    expect(getCommissionDefs().some((d) => d.name === SEED_NAME)).toBe(false);
  });
});
