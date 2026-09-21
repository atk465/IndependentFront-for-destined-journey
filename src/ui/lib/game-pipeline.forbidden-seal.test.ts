/**
 * game-pipeline.forbidden-seal.test.ts — 无名河封印天赋的接线合同（2026-09-21 消费端）
 *
 * 钉三件事：打出无名河把封印账写进 worldFlags.sealedTalents（随机天赋 =3）；
 * 已封印中的天赋不再重复入选（河水不卷同一个名字两次）；combatTalents() 读账过滤——
 * 交锋结算面所有 entryStrength/词条读取都经它，封印中的天赋不在场。
 * settleAndNarrate 的重流程（AI 记叙/结算）spy 掉——递减的纯函数语义在 sealed-talents.test.ts。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GamePipeline } from './game-pipeline';
import type { SkirmishSession } from '@engine/card-workshop/skirmish-session';

const { commitSpy } = vi.hoisted(() => ({
  commitSpy: vi.fn(async () => ({
    success: true,
    patchesApplied: 0,
    eventsGenerated: [],
    errors: [] as string[],
  })),
}));

vi.mock('@engine/state-manager', () => ({
  createStateManager: vi.fn(() => ({
    commitChatState: commitSpy,
    advanceTurn: vi.fn(async () => {}),
    createSnapshot: vi.fn(async () => ({})),
  })),
}));

vi.mock('@engine/database', () => ({
  getLatestPlotOutline: vi.fn(async () => undefined),
  getPlotEvents: vi.fn(async () => []),
  savePlotOutline: vi.fn(async () => {}),
  savePlotEvents: vi.fn(async () => {}),
  saveMemory: vi.fn(async () => {}),
  getPresets: vi.fn(async () => []),
}));

function makeSession(): SkirmishSession {
  return {
    enemyName: '岩爪兽',
    enemyLevel: 12,
    intents: [],
    beat: 1,
    playerHp: 155,
    playerMaxHp: 155,
    enemyHp: 320,
    enemyMaxHp: 320,
    guard: 10,
    log: [],
    playedCards: [],
    counteredBeats: 1,
    activeEffects: [],
    unsealedCards: [],
    finished: null,
  };
}

function makePipeline(storeOverrides: Record<string, unknown>) {
  const gameStore = {
    activeSaveId: 'save-test',
    skirmishSession: makeSession(),
    saveProfile: { worldFlags: {} },
    addMessage: vi.fn(),
    setSkirmishSession: vi.fn(),
    refreshFromDb: vi.fn(async () => {}),
    ...storeOverrides,
  };
  const pipeline = new GamePipeline({
    gameStore: gameStore as never,
    settingsStore: { settings: { apiPool: [], agents: {} } } as never,
    saveId: 'save-test',
  });
  vi.spyOn(
    pipeline as unknown as { settleAndNarrate: (s: unknown) => Promise<void> },
    'settleAndNarrate',
  ).mockResolvedValue(undefined);
  return {
    pipeline: pipeline as unknown as {
      castForbiddenCard: (name: string, tier?: string) => Promise<void>;
      combatTalents: () => Array<{ name: string }>;
    },
    gameStore,
  };
}

const PLAYER = {
  name: '理查德',
  level: 5,
  totalExp: 1000,
  maxHp: 100,
  hp: 80,
  talents: { list: [{ name: '体魄' }, { name: '免死' }] },
  inventory: [{ name: '禁忌卡·无名河', type: '卡牌' }],
};

describe('无名河封印天赋（接线）', () => {
  beforeEach(() => {
    commitSpy.mockClear();
  });

  it('打出无名河：随机天赋写 worldFlags.sealedTalents.<名>=3，并回读存档', async () => {
    const { pipeline, gameStore } = makePipeline({ player: PLAYER });
    await pipeline.castForbiddenCard('禁忌卡·无名河');

    expect(commitSpy).toHaveBeenCalledTimes(1);
    const calls = commitSpy.mock.calls as unknown as Array<
      [Array<{ target: string; value: number }>]
    >;
    const patches = calls[0][0];
    const sealPatch = patches.find((p) => p.target.startsWith('worldFlags.sealedTalents.'));
    expect(sealPatch).toBeDefined();
    expect(['体魄', '免死']).toContain(sealPatch!.target.split('.').pop());
    expect(sealPatch!.value).toBe(3);
    expect(gameStore.refreshFromDb).toHaveBeenCalled();
  });

  it('已封印中的天赋不重复入选（河水不卷同一个名字两次）', async () => {
    const { pipeline } = makePipeline({
      player: PLAYER,
      saveProfile: { worldFlags: { sealedTalents: { 免死: 2 } } },
    });
    await pipeline.castForbiddenCard('禁忌卡·无名河');

    const calls = commitSpy.mock.calls as unknown as Array<
      [Array<{ target: string; value: number }>]
    >;
    const patches = calls[0][0];
    const sealPatch = patches.find((p) => p.target.startsWith('worldFlags.sealedTalents.'));
    expect(sealPatch!.target).toBe('worldFlags.sealedTalents.体魄');
  });

  it('combatTalents() 读账过滤：封印中的天赋不在交锋结算面', () => {
    const { pipeline } = makePipeline({
      player: PLAYER,
      saveProfile: { worldFlags: { sealedTalents: { 免死: 3 } } },
    });
    const names = pipeline.combatTalents().map((t) => t.name);
    expect(names).toEqual(['体魄']);
  });
});
