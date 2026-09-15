/**
 * session-backup.ts — 单存档导出/导入测试
 *
 * Uses fake-indexeddb (injected via src/test-setup.ts).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDatabase,
  initializeDatabase,
  clearAllData,
  createDefaultSaveProfile,
  deleteSaveSlot,
  exportAllData,
  saveSnapshot,
  DB_VERSION,
} from './database';
import type { ContentPackRecord } from './database';
import { createDefaultCharacterState } from './types';
import type {
  SaveSlot,
  SaveProfile,
  CharacterState,
  ChatMessage,
  Snapshot,
  MemoryRecord,
  PlotEvent,
  PlotOutline,
  WorldBook,
  ChatPreset,
} from './types';
import {
  isSessionBackup,
  isFullBackupFile,
  exportSessionSave,
  checkSessionSaveDependencies,
  importSessionSave,
} from './session-backup';
import type { SessionBackup } from './session-backup';
import { preCheckPlot } from './plot-engine';

// ========== Helpers ==========

const SAVE_ID = 'save_session_test';
const PLAYER_ID = 'char_player';
const NPC_ID = 'char_npc';
const MSG_A = 'msg_a';
const MSG_B = 'msg_b';
const SNAP_ID = 'snap_1';
const PLOT_ROOT = 'plot_root';
const PLOT_CHILD = 'plot_child';
const HOST_CONDITION_SENTINEL = '__session_import_plot_condition_host_sentinel__';
const MALICIOUS_LOOKING_CONDITION = `(globalThis[${JSON.stringify(HOST_CONDITION_SENTINEL)}] = 'executed', true)`;

function makeWorldBook(overrides: Partial<WorldBook> = {}): WorldBook {
  return {
    id: crypto.randomUUID(),
    name: '测试世界书',
    partition: 'system_core',
    entries: [],
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** 世界书条目夹具 */
function makeEntry(uid: number, name: string): WorldBook['entries'][number] {
  return {
    uid,
    name,
    content: '正文',
    enabled: true,
    key: [],
    keysecondary: [],
    selectiveLogic: 0,
    order: 0,
    position: 0,
  };
}


/**
 * 内容包夹具 —— 默认**拥有 `book_core`**，而存档启用了 `system_core:100`，
 * 于是它是「这份存档真的用到的包」（Finding 4 的判据①）。
 */
function makePackRecord(overrides: Partial<ContentPackRecord> = {}): ContentPackRecord {
  return {
    packId: 'test-pack',
    packVersion: '1.0.0',
    installedAt: Date.now(),
    payload: {
      formatVersion: 1,
      packId: 'test-pack',
      packVersion: '1.0.0',
      name: '测试内容包',
      worldBooks: [
        makeWorldBook({
          id: 'book_core',
          name: '核心设定',
          partition: 'system_core',
          entries: [makeEntry(100, '命定核心')],
        }),
      ],
    } as ContentPackRecord['payload'],
    ...overrides,
  };
}

/**
 * 播一个「能玩」的最小存档：saves + saveProfile + characters + messages +
 * snapshots（内嵌副本齐全）+ memories + plotEvents + plotOutlines +
 * 各表数据齐备。
 *
 * 内部引用刻意都埋上：activeSnapshotId /
 * plotEvent.parentId+childrenIds / memory.relatedCharacterIds。
 */
async function seedSave(): Promise<void> {
  const db = getDatabase();

  const player: CharacterState = createDefaultCharacterState({
    id: PLAYER_ID,
    saveId: SAVE_ID,
    type: 'player',
    name: '莱恩',
  });
  const npc: CharacterState = createDefaultCharacterState({
    id: NPC_ID,
    saveId: SAVE_ID,
    type: 'npc',
    name: '莉薇娅',
  });

  const messages: ChatMessage[] = [
    {
      id: MSG_A,
      role: 'user',
      content: '我走上石桥',
      timestamp: Date.now(),
      saveId: SAVE_ID,
      turn: 1,
    },
    {
      id: MSG_B,
      role: 'assistant',
      content: '雨水打湿了你的斗篷。',
      timestamp: Date.now(),
      saveId: SAVE_ID,
      turn: 2,
    },
  ];

  const profile: SaveProfile = {
    ...createDefaultSaveProfile(SAVE_ID),
    affections: { 莉薇娅: 45 },
    contracts: [
      {
        id: 'contract_1',
        targetId: NPC_ID,
        targetName: '莉薇娅',
        tier: 1,
        fpSpent: 50,
        affectionLevel: '友好',
        createdAt: Date.now(),
      },
    ],
  };

  const plotRoot: PlotEvent = {
    id: PLOT_ROOT,
    saveId: SAVE_ID,
    title: '商队失踪',
    description: '一支商队消失在森林里',
    status: 'active',
    childrenIds: [PLOT_CHILD],
    order: 0,
    relatedCharacterIds: [PLAYER_ID, '莉薇娅'],
    worldLineChanged: false,
    visibility: 'revealed',
    depth: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const plotChild: PlotEvent = {
    ...plotRoot,
    id: PLOT_CHILD,
    title: '搜索森林',
    childrenIds: [],
    parentId: PLOT_ROOT,
    relatedCharacterIds: [NPC_ID],
    depth: 1,
  };

  const snapshot: Snapshot = {
    id: SNAP_ID,
    saveId: SAVE_ID,
    createdAt: Date.now(),
    reason: 'turn',
    turn: 2,
    characters: [structuredClone(player), structuredClone(npc)],
    saveProfile: structuredClone(profile),
    plotEvents: [structuredClone(plotRoot), structuredClone(plotChild)],
    messages: structuredClone(messages),
  };

  const save: SaveSlot = {
    id: SAVE_ID,
    name: '测试冒险',
    slot: 3,
    createdAt: Date.now() - 1000,
    updatedAt: Date.now() - 1000,
    activeSnapshotId: SNAP_ID,
    metadata: {
      characterName: '莱恩',
      userName: '玩家',
      gameStartTime: '001-01-01',
      totalTurns: 2,
      enabledWorldBookEntries: ['system_core:100', 'dlc:777'],
    },
  };

  const memory: MemoryRecord = {
    id: 'MEM000001',
    saveId: SAVE_ID,
    createdAt: Date.now(),
    realTimestamp: Date.now(),
    timeRange: { start: '001-01-01', end: '001-01-02' },
    content: '莱恩在酒馆听说了商队失踪的消息。'.repeat(8),
    hiddenLine: '蒙面人是盗贼团的眼线',
    keywords: ['商队'],
    relatedCharacterIds: [PLAYER_ID, '莉薇娅'],
    importance: 7,
  };

  const outline: PlotOutline = {
    id: 'outline_1',
    saveId: SAVE_ID,
    mode: 'main',
    title: '血色纹章',
    summary: '边境的阴谋逐渐浮出水面',
    content: '大纲正文',
    chapters: [{ title: '商队失踪', summary: '起点', status: 'active' }],
    confirmed: true,
    version: 1,
    timeRange: { start: '001-01-01', end: '001-02-01' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await db.saves.put(save);
  await db.saveProfiles.put(profile);
  await db.characters.bulkPut([player, npc]);
  await db.messages.bulkPut(messages);
  // v22 拆表：经 saveSnapshot 落库（它负责拆成元数据 + 载荷两行）
  await saveSnapshot(snapshot);
  await db.memories.put(memory);
  await db.plotEvents.bulkPut([plotRoot, plotChild]);
  await db.plotOutlines.put(outline);
}

/** 播内容侧：世界书条目 / 工坊项目 / 内容包 / story 预设 */
async function seedContent(): Promise<void> {
  const db = getDatabase();
  await db.worldBooks.bulkPut([
    makeWorldBook({
      id: 'book_core',
      name: '核心设定',
      partition: 'system_core',
      entries: [makeEntry(100, '命定核心')],
    }),
    makeWorldBook({
      id: 'book_dlc',
      name: '扩展内容',
      partition: 'dlc',
      entries: [makeEntry(777, '隐藏副本')],
    }),
  ]);
  await db.contentPacks.put(makePackRecord());
  await db.presets.put({
    id: 'preset_story',
    name: '叙事预设',
    settings: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as ChatPreset);
}

const STORY_PRESET = { id: 'preset_story', name: '叙事预设' };

// ========== Setup & Teardown ==========

beforeEach(async () => {
  try {
    await clearAllData();
  } catch {
    /* db may not exist yet */
  }
  await initializeDatabase();
});

// ========== isSessionBackup ==========

describe('isSessionBackup', () => {
  it('按 kind 分流：只认单存档备份', () => {
    expect(isSessionBackup({ kind: 'fated-poem-session-save' })).toBe(true);
    expect(isSessionBackup({ version: 21, saves: [] })).toBe(false);
    expect(isSessionBackup(null)).toBe(false);
    expect(isSessionBackup('fated-poem-session-save')).toBe(false);
    expect(isSessionBackup([{ kind: 'fated-poem-session-save' }])).toBe(false);
  });
});

// ========== 导出 ==========

describe('exportSessionSave', () => {
  it('存档不存在时抛中文错误', async () => {
    await expect(exportSessionSave('no_such_save')).rejects.toThrow(/存档不存在/);
  });

  it('收齐每存档的行，字节不随行', async () => {
    await seedSave();
    await seedContent();

    const backup = await exportSessionSave(SAVE_ID, { storyPreset: STORY_PRESET });

    expect(backup.kind).toBe('fated-poem-session-save');
    expect(Number.isFinite(backup.version)).toBe(true);
    expect(backup.save.id).toBe(SAVE_ID);
    expect(backup.profile?.saveId).toBe(SAVE_ID);
    expect(backup.characters).toHaveLength(2);
    expect(backup.messages).toHaveLength(2);
    expect(backup.snapshots).toHaveLength(1);
    // v22 拆表：元数据与载荷各一行，元数据行不再驮着整档历史
    expect(backup.snapshotPayloads).toHaveLength(1);
    expect(backup.snapshotPayloads[0].id).toBe(backup.snapshots[0].id);
    expect(backup.snapshotPayloads[0].messages).toHaveLength(2);
    expect((backup.snapshots[0] as unknown as Record<string, unknown>).messages).toBeUndefined();
    expect(backup.memories).toHaveLength(1);
    expect(backup.plotEvents).toHaveLength(2);
    expect(backup.plotOutlines).toHaveLength(1);
  });

  it('依赖清单：世界书条目带书名/条目名注释，解析不出的 token 照样进清单', async () => {
    await seedSave();
    await seedContent();
    // 把 dlc:777 那本删掉 —— 导出方自己都缺的条目不该被藏起来
    await getDatabase().worldBooks.delete('book_dlc');

    const backup = await exportSessionSave(SAVE_ID);
    const entries = backup.dependencies.worldBookEntries;

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      token: 'system_core:100',
      bookName: '核心设定',
      entryTitle: '命定核心',
    });
    expect(entries[1]).toEqual({ token: 'dlc:777' });
  });

  it('依赖清单：内容包与 story 预设原样收录', async () => {
    await seedSave();
    await seedContent();

    const backup = await exportSessionSave(SAVE_ID, { storyPreset: STORY_PRESET });
    expect(backup.dependencies.packs).toEqual([
      { packId: 'test-pack', packVersion: '1.0.0', name: '测试内容包' },
    ]);
    expect(backup.dependencies.storyPreset).toEqual(STORY_PRESET);
  });

  it('依赖清单：这份存档没用到的包不进清单（否则收件人被无关告警淹掉）', async () => {
    await seedSave();
    await seedContent();
    // 装着、但它的书一条都没被本存档启用，也没带地图
    await getDatabase().contentPacks.put(
      makePackRecord({
        packId: 'other-pack',
        payload: {
          formatVersion: 1,
          packId: 'other-pack',
          packVersion: '1.0.0',
          name: '无关内容包',
          worldBooks: [
            makeWorldBook({
              id: 'book_other',
              partition: 'dlc',
              entries: [makeEntry(555, '没启用的条目')],
            }),
          ],
        } as ContentPackRecord['payload'],
      }),
    );

    const backup = await exportSessionSave(SAVE_ID);
    expect(backup.dependencies.packs.map((p) => p.packId)).toEqual(['test-pack']);
  });

  it('依赖清单：地图包按 packStamp 认（存档确实在这张地图上落过位）', async () => {
    await seedSave();
    const db = getDatabase();
    // 只装一个「没有任何启用条目」的地图包 —— 唯一的联系是存档档案里的戳
    await db.contentPacks.put(
      makePackRecord({
        packId: 'map-pack',
        payload: {
          formatVersion: 1,
          packId: 'map-pack',
          packVersion: '1.0.0',
          name: '地图包',
          mapPack: { contentHash: 'hash-map-v1' },
        } as ContentPackRecord['payload'],
      }),
    );

    const profile = (await db.saveProfiles.get(SAVE_ID))!;
    profile.worldFlags = { map: { packStamp: 'hash-map-v1' } };
    await db.saveProfiles.put(profile);

    const backup = await exportSessionSave(SAVE_ID);
    expect(backup.dependencies.packs.map((p) => p.packId)).toEqual(['map-pack']);

    // 戳对不上就不算用到
    profile.worldFlags = { map: { packStamp: 'hash-map-v2' } };
    await db.saveProfiles.put(profile);
    expect((await exportSessionSave(SAVE_ID)).dependencies.packs).toEqual([]);
  });

  it('不传 storyPreset 时清单里就没有这一项（引擎不去猜全局 UI 状态）', async () => {
    await seedSave();
    const backup = await exportSessionSave(SAVE_ID);
    expect(backup.dependencies.storyPreset).toBeUndefined();
  });
});

// ========== 导入往返 ==========

describe('importSessionSave — 往返', () => {
  it('全部行落到新 saveId 下，数量一致', async () => {
    await seedSave();
    await seedContent();
    const backup = await exportSessionSave(SAVE_ID, { storyPreset: STORY_PRESET });

    const { saveId: newId } = await importSessionSave(backup);
    expect(newId).not.toBe(SAVE_ID);

    const db = getDatabase();
    expect(await db.saves.count()).toBe(2);
    expect((await db.characters.where('saveId').equals(newId).toArray()).length).toBe(2);
    expect((await db.messages.where('saveId').equals(newId).toArray()).length).toBe(2);
    expect((await db.snapshots.where('saveId').equals(newId).toArray()).length).toBe(1);
    expect((await db.memories.where('saveId').equals(newId).toArray()).length).toBe(1);
    expect((await db.plotEvents.where('saveId').equals(newId).toArray()).length).toBe(2);
    expect((await db.plotOutlines.where('saveId').equals(newId).toArray()).length).toBe(1);
    expect((await db.saveProfiles.get(newId))?.saveId).toBe(newId);
  });

  it('🧵 事件线节点/引用/揭示/游戏时间戳/冷却游标随单档往返保留，且不串档', async () => {
    await seedSave();
    const db = getDatabase();
    const profile = (await db.saveProfiles.get(SAVE_ID))!;
    profile.worldFlags = {
      ...(profile.worldFlags ?? {}),
      plotThreads: {
        nodes: {
          雾蕈收购: {
            name: '雾蕈收购',
            gist: '商贩们被神秘买家暗中抬价收购雾蕈',
            thread: '血色纹章',
            motive: '幕后势力在囤积关键物资',
            involvedNpcs: ['商贩'],
            status: 'active',
            foreshadows: ['外乡人'],
            payoffs: [],
            visibility: 'revealed',
            seededAt: 70840, // 游戏 epoch minutes
          },
          外乡人: {
            name: '外乡人',
            gist: '一名身份不明的旅人在邻近村落出没',
            thread: '血色纹章',
            motive: '秘密监视收购动向',
            involvedNpcs: [],
            status: 'dormant',
            foreshadows: [],
            payoffs: ['雾蕈收购'],
            visibility: 'hidden',
            seededAt: 70960,
          },
        },
        lastAdvancedTurn: 7,
        lastCommittedTurn: 7,
      },
    };
    await db.saveProfiles.put(profile);

    const backup = await exportSessionSave(SAVE_ID);
    const { saveId: newId } = await importSessionSave(backup);

    const restored = (await db.saveProfiles.get(newId))!;
    expect(restored.worldFlags.plotThreads).toEqual(profile.worldFlags.plotThreads);
    // 原档的袋仍在（不串档：新档引用名字而非 id，且不含旧存档标识）
    expect((await db.saveProfiles.get(SAVE_ID))!.worldFlags.plotThreads).toBeDefined();
    expect(JSON.stringify(restored.worldFlags.plotThreads)).not.toContain(SAVE_ID);
  });

  it('内部引用指向重发后的行', async () => {
    await seedSave();
    const backup = await exportSessionSave(SAVE_ID);
    const { saveId: newId } = await importSessionSave(backup);
    const db = getDatabase();

    const save = await db.saves.get(newId);
    const snaps = await db.snapshots.where('saveId').equals(newId).toArray();
    expect(snaps).toHaveLength(1);
    expect(save?.activeSnapshotId).toBe(snaps[0].id);
    expect(save?.activeSnapshotId).not.toBe(SNAP_ID);

    // 剧情父子链跟着一起搬
    const events = await db.plotEvents.where('saveId').equals(newId).toArray();
    const root = events.find((e) => e.title === '商队失踪')!;
    const child = events.find((e) => e.title === '搜索森林')!;
    expect(child.parentId).toBe(root.id);
    expect(root.childrenIds).toEqual([child.id]);
    expect(root.id).not.toBe(PLOT_ROOT);
  });

  it('快照内嵌副本用同一套映射改写（回退时才不会把旧 id 复活回库）', async () => {
    await seedSave();
    const backup = await exportSessionSave(SAVE_ID);
    const { saveId: newId } = await importSessionSave(backup);
    const db = getDatabase();

    // v22 拆表：内嵌副本住在载荷表里
    const snap = (await db.snapshotPayloads.where('saveId').equals(newId).toArray())[0];
    const chars = await db.characters.where('saveId').equals(newId).toArray();
    const msgs = await db.messages.where('saveId').equals(newId).toArray();
    const events = await db.plotEvents.where('saveId').equals(newId).toArray();

    expect(new Set(snap.characters.map((c) => c.id))).toEqual(new Set(chars.map((c) => c.id)));
    expect(new Set(snap.messages?.map((m) => m.id))).toEqual(new Set(msgs.map((m) => m.id)));
    expect(new Set(snap.plotEvents?.map((e) => e.id))).toEqual(new Set(events.map((e) => e.id)));
    // 内嵌副本的 saveId 也得改，否则回退写回库之后行归属错乱
    expect(snap.saveProfile.saveId).toBe(newId);
    expect(snap.characters.every((c) => c.saveId === newId)).toBe(true);
    expect(snap.plotEvents?.every((e) => e.saveId === newId)).toBe(true);
    expect(snap.messages?.every((m) => m.saveId === newId)).toBe(true);
  });

  it('导入的恶意外观 triggerCondition 保持为数据，后续 pre_check 也不在宿主域执行', async () => {
    await seedSave();
    const backup = await exportSessionSave(SAVE_ID);
    const exportedEvent = backup.plotEvents.find((event) => event.id === PLOT_CHILD);
    const snapshotEvent = backup.snapshotPayloads[0].plotEvents?.find(
      (event) => event.id === PLOT_CHILD,
    );
    expect(exportedEvent).toBeDefined();
    expect(snapshotEvent).toBeDefined();
    exportedEvent!.status = 'pending';
    exportedEvent!.triggerCondition = MALICIOUS_LOOKING_CONDITION;
    snapshotEvent!.status = 'pending';
    snapshotEvent!.triggerCondition = MALICIOUS_LOOKING_CONDITION;

    const host = globalThis as Record<string, unknown>;
    delete host[HOST_CONDITION_SENTINEL];

    try {
      const { saveId: newId } = await importSessionSave(backup);
      expect(host[HOST_CONDITION_SENTINEL]).toBeUndefined();

      const db = getDatabase();
      const importedEvent = (await db.plotEvents.where('saveId').equals(newId).toArray()).find(
        (event) => event.title === '搜索森林',
      );
      const importedSnapshot = (
        await db.snapshotPayloads.where('saveId').equals(newId).toArray()
      )[0];
      const importedSnapshotEvent = importedSnapshot.plotEvents?.find(
        (event) => event.title === '搜索森林',
      );
      expect(importedEvent?.status).toBe('pending');
      expect(importedEvent?.triggerCondition).toBe(MALICIOUS_LOOKING_CONDITION);
      expect(importedSnapshotEvent?.triggerCondition).toBe(MALICIOUS_LOOKING_CONDITION);

      const result = await preCheckPlot(
        newId,
        JSON.stringify({
          triggeredEvents: [{ title: '搜索森林', reason: 'Agent 判定语义条件已满足' }],
          relevantBackground: '',
          outlineRelevance: '',
        }),
        {},
      );
      expect(result.triggeredEvents.map((event) => event.title)).toEqual(['搜索森林']);
      expect(host[HOST_CONDITION_SENTINEL]).toBeUndefined();
      expect((await db.plotEvents.get(importedEvent!.id))?.status).toBe('active');
    } finally {
      delete host[HOST_CONDITION_SENTINEL];
    }
  });

  it('v22: 载荷行的 id 跟着元数据行的新 id 走（拆散了就恢复不了）', async () => {
    await seedSave();
    const backup = await exportSessionSave(SAVE_ID);
    const { saveId: newId } = await importSessionSave(backup);
    const db = getDatabase();

    const meta = (await db.snapshots.where('saveId').equals(newId).toArray())[0];
    const payload = await db.snapshotPayloads.get(meta.id);
    expect(payload).toBeDefined();
    expect(payload!.saveId).toBe(newId);
    expect(meta.id).not.toBe(SNAP_ID);
    // 元数据行不再驮着整档载荷
    expect((meta as unknown as Record<string, unknown>).messages).toBeUndefined();
    expect((meta as unknown as Record<string, unknown>).characters).toBeUndefined();
  });

  it('v22 向后兼容：旧格式单存档备份（快照整份内嵌、无 snapshotPayloads）照样导得进', async () => {
    await seedSave();
    const backup = await exportSessionSave(SAVE_ID);

    // 造一份 v21 形状的备份：元数据 + 载荷合体塞回 snapshots，删掉新字段
    const meta = backup.snapshots[0];
    const payload = backup.snapshotPayloads[0];
    const legacy = {
      ...backup,
      snapshots: [
        {
          id: meta.id,
          saveId: meta.saveId,
          createdAt: meta.createdAt,
          reason: meta.reason,
          turn: meta.turn,
          characters: payload.characters,
          saveProfile: payload.saveProfile,
          plotEvents: payload.plotEvents,
          messages: payload.messages,
        },
      ],
    } as unknown as SessionBackup;
    delete (legacy as unknown as Record<string, unknown>).snapshotPayloads;

    const { saveId: newId } = await importSessionSave(legacy);
    const db = getDatabase();

    const metas = await db.snapshots.where('saveId').equals(newId).toArray();
    expect(metas).toHaveLength(1);
    // 元数据行被剥干净
    expect((metas[0] as unknown as Record<string, unknown>).messages).toBeUndefined();
    // 载荷被就地拆出来，且 id 与元数据行一致
    const split = await db.snapshotPayloads.get(metas[0].id);
    expect(split).toBeDefined();
    expect(split!.saveId).toBe(newId);
    expect(split!.characters).toHaveLength(2);
    expect(split!.messages).toHaveLength(2);
    // 内嵌副本同样走了 id 重发
    const chars = await db.characters.where('saveId').equals(newId).toArray();
    expect(new Set(split!.characters.map((c) => c.id))).toEqual(new Set(chars.map((c) => c.id)));
    // 缩略从载荷回填（旧备份没有 preview 字段）
    expect(metas[0].preview?.playerName).toBe('莱恩');
  });

  it('软引用：角色 id 跟着改，名字/契约目标各按其义', async () => {
    await seedSave();
    const backup = await exportSessionSave(SAVE_ID);
    const { saveId: newId } = await importSessionSave(backup);
    const db = getDatabase();

    const chars = await db.characters.where('saveId').equals(newId).toArray();
    const player = chars.find((c) => c.type === 'player')!;
    const npc = chars.find((c) => c.type === 'npc')!;

    const memory = (await db.memories.where('saveId').equals(newId).toArray())[0];
    expect(memory.relatedCharacterIds).toContain(player.id);
    // 名字不是 id —— 查不到就原样留着，绝不能被改写成 UUID
    expect(memory.relatedCharacterIds).toContain('莉薇娅');

    const profile = await db.saveProfiles.get(newId);
    expect(profile?.contracts[0].targetId).toBe(npc.id);
    // affections 的键是名字（铁律 1），刻意不动
    expect(profile?.affections['莉薇娅']).toBe(45);
  });

  it('槽位取现有最大 +1；createdAt/metadata 保留，updatedAt 盖新戳', async () => {
    await seedSave();
    const backup = await exportSessionSave(SAVE_ID);
    const before = Date.now();
    const { saveId: newId } = await importSessionSave(backup);

    const save = await getDatabase().saves.get(newId);
    expect(save?.slot).toBe(4); // 原档 slot=3
    expect(save?.createdAt).toBe(backup.save.createdAt);
    expect(save?.name).toBe('测试冒险');
    expect(save?.metadata.enabledWorldBookEntries).toEqual(
      backup.save.metadata.enabledWorldBookEntries,
    );
    expect(save?.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('记忆编号保留 MEM 格式且不与全库现有编号相撞', async () => {
    await seedSave();
    const backup = await exportSessionSave(SAVE_ID);
    const { saveId: newId } = await importSessionSave(backup);

    const memory = (await getDatabase().memories.where('saveId').equals(newId).toArray())[0];
    expect(memory.id).toMatch(/^MEM\d{6}$/);
    expect(memory.id).not.toBe('MEM000001');
    expect(await getDatabase().memories.count()).toBe(2);
  });

  it('备份可以导进一个空库（原档已删也照样还原）', async () => {
    await seedSave();
    const backup = await exportSessionSave(SAVE_ID);
    await deleteSaveSlot(SAVE_ID);
    expect(await getDatabase().saves.count()).toBe(0);

    const { saveId: newId } = await importSessionSave(backup);
    const db = getDatabase();
    expect(await db.saves.count()).toBe(1);
    expect((await db.characters.where('saveId').equals(newId).toArray()).length).toBe(2);
    expect((await db.saves.get(newId))?.slot).toBe(0);
  });
});

// ========== 双份导入 ==========

describe('importSessionSave — 同一份文件导两次', () => {
  it('得到两个互不相干的存档，行 id 无交集', async () => {
    await seedSave();
    const backup = await exportSessionSave(SAVE_ID);

    const first = await importSessionSave(backup);
    const second = await importSessionSave(backup);
    expect(first.saveId).not.toBe(second.saveId);

    const db = getDatabase();
    expect(await db.saves.count()).toBe(3); // 原档 + 两份导入

    const idsOf = async (saveId: string) => ({
      chars: (await db.characters.where('saveId').equals(saveId).toArray()).map((r) => r.id),
      msgs: (await db.messages.where('saveId').equals(saveId).toArray()).map((r) => r.id),
      snaps: (await db.snapshots.where('saveId').equals(saveId).toArray()).map((r) => r.id),
      mems: (await db.memories.where('saveId').equals(saveId).toArray()).map((r) => r.id),
      plots: (await db.plotEvents.where('saveId').equals(saveId).toArray()).map((r) => r.id),
    });

    const a = await idsOf(first.saveId);
    const b = await idsOf(second.saveId);
    for (const key of Object.keys(a) as Array<keyof typeof a>) {
      expect(a[key].length).toBeGreaterThan(0);
      expect(a[key].length).toBe(b[key].length);
      const overlap = a[key].filter((id) => b[key].includes(id));
      expect(overlap).toEqual([]);
    }

    // 原档的行一条没被覆盖
    expect((await db.characters.where('saveId').equals(SAVE_ID).toArray()).length).toBe(2);
  });

  it('删掉其中一份，另一份完好', async () => {
    await seedSave();
    const backup = await exportSessionSave(SAVE_ID);
    const first = await importSessionSave(backup);
    const second = await importSessionSave(backup);

    await deleteSaveSlot(first.saveId);

    const db = getDatabase();
    expect(await db.saves.get(first.saveId)).toBeUndefined();
    expect(await db.saves.get(second.saveId)).toBeDefined();
    expect((await db.characters.where('saveId').equals(second.saveId).toArray()).length).toBe(2);
    expect((await db.messages.where('saveId').equals(second.saveId).toArray()).length).toBe(2);
    expect((await db.snapshots.where('saveId').equals(second.saveId).toArray()).length).toBe(1);
    // v22 拆表：删存档要连载荷行一起级联，另一份的载荷不受牵连
    expect(await db.snapshotPayloads.where('saveId').equals(first.saveId).count()).toBe(0);
    expect(await db.snapshotPayloads.where('saveId').equals(second.saveId).count()).toBe(1);
  });
});

// ========== 依赖体检 ==========

describe('checkSessionSaveDependencies', () => {
  it('内容齐全 → ok:true', async () => {
    await seedSave();
    await seedContent();
    const backup = await exportSessionSave(SAVE_ID, { storyPreset: STORY_PRESET });

    const check = await checkSessionSaveDependencies(backup);
    expect(check).toEqual({
      ok: true,
      missingEntries: [],
      packMismatches: [],
    });
  });

  it('世界书条目缺失 → missingEntries 带上导出侧的注释', async () => {
    await seedSave();
    await seedContent();
    const backup = await exportSessionSave(SAVE_ID);

    await getDatabase().worldBooks.delete('book_dlc');

    const check = await checkSessionSaveDependencies(backup);
    expect(check.ok).toBe(false);
    expect(check.missingEntries).toEqual([
      { token: 'dlc:777', bookName: '扩展内容', entryTitle: '隐藏副本' },
    ]);
  });

  it('内容包版本不一致 / 压根没装 → packMismatches', async () => {
    await seedSave();
    await seedContent();
    const backup = await exportSessionSave(SAVE_ID);
    const db = getDatabase();

    await db.contentPacks.put(makePackRecord({ packVersion: '2.0.0' }));
    let check = await checkSessionSaveDependencies(backup);
    expect(check.ok).toBe(false);
    expect(check.packMismatches).toEqual([
      {
        packId: 'test-pack',
        name: '测试内容包',
        expectedVersion: '1.0.0',
        installedVersion: '2.0.0',
      },
    ]);

    await db.contentPacks.delete('test-pack');
    check = await checkSessionSaveDependencies(backup);
    expect(check.packMismatches).toEqual([
      {
        packId: 'test-pack',
        name: '测试内容包',
        expectedVersion: '1.0.0',
        installedVersion: null,
      },
    ]);
  });

  it('story 预设缺失 → missingStoryPreset', async () => {
    await seedSave();
    await seedContent();
    const backup = await exportSessionSave(SAVE_ID, { storyPreset: STORY_PRESET });

    await getDatabase().presets.delete('preset_story');

    const check = await checkSessionSaveDependencies(backup);
    expect(check.ok).toBe(false);
    expect(check.missingStoryPreset).toEqual(STORY_PRESET);
  });

  it('只读：体检不写任何一张表', async () => {
    await seedSave();
    await seedContent();
    const backup = await exportSessionSave(SAVE_ID, { storyPreset: STORY_PRESET });
    const db = getDatabase();
    await db.worldBooks.delete('book_dlc');

    const before = await db.saves.count();
    await checkSessionSaveDependencies(backup);
    expect(await db.saves.count()).toBe(before);
    expect(await db.worldBooks.count()).toBe(1);
    expect(await db.presets.get('preset_story')).toBeDefined();
  });

  it('清单缺失（手编文件）时不炸，按「无依赖」处理', async () => {
    const bare = { kind: 'fated-poem-session-save' } as unknown as SessionBackup;
    const check = await checkSessionSaveDependencies(bare);
    expect(check.ok).toBe(true);
    expect(check.missingEntries).toEqual([]);
  });
});

// ========== 整库备份文件识别（Finding 3）==========

describe('isFullBackupFile', () => {
  it('只有一个数字 version 的 JSON 不算整库备份（角色卡/预设全长这样）', () => {
    expect(isFullBackupFile({ version: 2, name: '某角色', description: 'x' })).toBe(false);
    expect(isFullBackupFile({ spec: 'chara_card_v2', spec_version: '2.0', data: {} })).toBe(false);
    expect(isFullBackupFile(null)).toBe(false);
    expect(isFullBackupFile([])).toBe(false);
    expect(isFullBackupFile({ version: 'v21', saves: [] })).toBe(false);
  });

  it('真的整库备份 → true', async () => {
    const backup = await exportAllData();
    expect(isFullBackupFile(backup)).toBe(true);
    // 只要有一条签名数组在场就认（老备份缺后加的表是正常的）
    expect(isFullBackupFile({ version: 21, saves: [] })).toBe(true);
  });

  it('单存档备份不算整库备份（两条导入路径必须分得开）', async () => {
    await seedSave();
    const session = await exportSessionSave(SAVE_ID);
    expect(isFullBackupFile(session)).toBe(false);
    expect(isSessionBackup(session)).toBe(true);
  });
});

// ========== 导入校验 ==========

describe('importSessionSave — 校验', () => {
  const bad = (payload: unknown) => importSessionSave(payload as SessionBackup);

  it('null / 非对象 → 中文错误', async () => {
    await expect(bad(null)).rejects.toThrow(/备份格式无效/);
    await expect(bad('x')).rejects.toThrow(/备份格式无效/);
  });

  it('kind 不匹配 → 中文错误（别把整库备份当单存档导）', async () => {
    await expect(bad({ version: 21, save: {} })).rejects.toThrow(/备份格式无效/);
  });

  it('version 非有限数 → 中文错误', async () => {
    await expect(
      bad({ kind: 'fated-poem-session-save', version: 'v21', save: {} }),
    ).rejects.toThrow(/version/);
  });

  it('缺 save 主记录 → 中文错误', async () => {
    await expect(bad({ kind: 'fated-poem-session-save', version: 21 })).rejects.toThrow(/save/);
  });

  it('数组字段「在但不是数组」→ 中文错误', async () => {
    await expect(
      bad({
        kind: 'fated-poem-session-save',
        version: 21,
        save: { id: 'x', metadata: {} },
        characters: { nope: true },
      }),
    ).rejects.toThrow(/characters 必须是数组/);
  });

  it('数组字段缺席 → 当空数组容忍（三态语义，同 FullBackup）', async () => {
    const { saveId } = await bad({
      kind: 'fated-poem-session-save',
      version: 21,
      save: {
        id: 'legacy',
        name: '残缺档',
        slot: 0,
        createdAt: 1,
        updatedAt: 1,
        activeSnapshotId: null,
        metadata: { characterName: 'A', userName: 'B', gameStartTime: 'c', totalTurns: 0 },
      },
      profile: null,
    });

    const db = getDatabase();
    expect((await db.saves.get(saveId))?.name).toBe('残缺档');
    expect(await db.characters.count()).toBe(0);
    expect(await db.saveProfiles.count()).toBe(0);
  });

  /**
   * 前向版本闸门（2026-08-17 评审补，与 FullBackup 同一个判据函数）。
   * 只堵「备份比本机新」这一个方向：戳更老照旧导入，老文件必须永远导得进来。
   */
  it('version > DB_VERSION → 拒绝，措辞说清要先更新应用', async () => {
    await seedSave();
    const backup = await exportSessionSave(SAVE_ID);
    backup.version = DB_VERSION + 1;

    await expect(importSessionSave(backup)).rejects.toThrow('备份版本过新');
    await expect(importSessionSave(backup)).rejects.toThrow('请先更新应用');
    // 拒得够早：一行都没往库里写
    expect(await getDatabase().saves.count()).toBe(1); // 只有 seedSave 那条
  });

  it('version = DB_VERSION → 照常导入', async () => {
    await seedSave();
    const backup = await exportSessionSave(SAVE_ID);
    expect(backup.version).toBe(DB_VERSION);

    const { saveId } = await importSessionSave(backup);
    expect(await getDatabase().saves.get(saveId)).toBeDefined();
  });

  it('version 远早于 DB_VERSION → 照常导入（老备份一格没堵）', async () => {
    await seedSave();
    const backup = await exportSessionSave(SAVE_ID);
    backup.version = 8;

    const { saveId } = await importSessionSave(backup);
    expect(await getDatabase().saves.get(saveId)).toBeDefined();
  });

  it('activeSnapshotId 指向备份里没有的快照 → 置 null', async () => {
    await seedSave();
    const backup = await exportSessionSave(SAVE_ID);
    backup.snapshots = [];

    const { saveId } = await importSessionSave(backup);
    expect((await getDatabase().saves.get(saveId))?.activeSnapshotId).toBeNull();
  });
});

// ========== 全局表不受影响 ==========

describe('importSessionSave — 不碰全局表', () => {
  it('worldBooks / presets / contentPacks 行数与内容不变', async () => {
    await seedSave();
    await seedContent();
    const db = getDatabase();

    const backup = await exportSessionSave(SAVE_ID, { storyPreset: STORY_PRESET });
    const before = {
      worldBooks: await db.worldBooks.count(),
      presets: await db.presets.count(),
      contentPacks: await db.contentPacks.count(),
    };

    await importSessionSave(backup);

    expect({
      worldBooks: await db.worldBooks.count(),
      presets: await db.presets.count(),
      contentPacks: await db.contentPacks.count(),
    }).toEqual(before);
  });
});
