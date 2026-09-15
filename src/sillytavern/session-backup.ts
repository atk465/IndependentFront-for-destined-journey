/**
 * session-backup.ts — 单存档（一周目）导出 / 导入
 *
 * 与 `FullBackup`（database.ts）刻意分工：那份迁移应用级备份范围内的数据，但排除设备本地
 * 凭据与二进制素材库；这份是「**把一周目送给别人**」。差别不在体积，在三条语义：
 *
 * 1. **只收每存档的表** —— 表清单与 `deleteSaveSlot` 同源（它是「什么算这个存档的」
 *    唯一权威判据）。全局库（worldBooks / presets / imagePresets / contentPacks /
 *    audio* / asset*）一行都不进，导入侧也一行都不改。
 * 2. **带一份内容依赖清单** —— 存档本身不含世界书正文，但它**指着**世界书条目
 *    （`metadata.enabledWorldBookEntries` 里的 `${partition}:${uid}` 串）。收件人库里
 *    没有那些条目时，存档能导进去、跑起来却少了半个世界，而且**没有任何报错**。
 *    清单让「缺什么」在导入**之前**就说得出来（`checkSessionSaveDependencies`）。
 * 3. **导入必重发 id** —— 同一个文件导两次得到两个互不相干的存档，且永不撞上库里已有的行。
 *    不重发 id 的话，第二次导入是**静默覆盖**第一次（Dexie `put` 语义），
 *    用户看到的是「怎么只有一个存档」而不是任何一种错误。
 *
 * 设计参考：database.ts 的 `deleteSaveSlot`（表清单）/ `validateBackupOrThrow`（三态校验）。
 */

import {
  getDatabase,
  normalizeSnapshotBackupRows,
  assertBackupNotFromFuture,
  DB_VERSION,
} from './database';
import type { ContentPackRecord } from './database';
// 记忆编号分配器与 generateMemoryId() **共用同一个实现**（两处各写一份就是漂移的来路：
// 一边补齐到 6 位、另一边截断到 6 位，撞号了也不会有任何报错）。
import { allocateMemoryIds } from './memory-summarizer';
import type {
  SaveSlot,
  SaveProfile,
  CharacterState,
  ChatMessage,
  Snapshot,
  SnapshotMeta,
  SnapshotPayload,
  MemoryRecord,
  PlotEvent,
  PlotOutline,
  WorldBook,
} from './types';

// ═══════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════

/**
 * 一条「本存档启用了这个世界书条目」的引用。
 *
 * 🔴 **`token` 只在同一台机器上是稳定标识**：`${partition}:${uid}` 里的 uid 是安装时
 *    发的号，跨机没有可比性。体检按「收件人库里有没有同分区同 uid 的条目」比对，
 *    比不上的照实报缺失，让用户知情后自行决定。
 */
interface SessionEntryRef {
  /** `${partition}:${uid}` —— 导出机本地的串 */
  token: string;
  bookName?: string;
  entryTitle?: string;
}

/**
 * 内容依赖清单 —— 「这份存档要跑起来，收件人库里得有什么」。
 *
 * 清单是**导出时点的观察**，不是承诺：每一项都可能在收件人那边缺席或版本不同，
 * 这正是 `checkSessionSaveDependencies` 要回答的问题。
 */
interface SessionDependencies {
  /**
   * 这份存档**真的用到**的内容包。
   *
   * 🔴 刻意**不是**「本机装着的全部包」：那样收件人会为一堆这个存档从没碰过的包收到
   *    「未安装内容包」告警，而告警多到一定程度就等于没有告警 —— 真正缺的那一条被淹掉。
   *    判据见 `selectReferencedPacks`（拥有启用条目的书 / 地图包戳对得上）。
   */
  packs: Array<{ packId: string; packVersion: string; name?: string }>;
  /**
   * 本存档启用的世界书条目 token（`${partition}:${uid}`），带导出侧解析出的书名/条目名。
   *
   * 🔴 解析不出来的 token **照样进清单**（只是没有注释）—— 导出方自己都缺的条目，
   *    收件人更可能缺，把它藏起来只会让体检结果偏乐观。
   */
  worldBookEntries: SessionEntryRef[];
  /**
   * story 预设 —— **由调用方传入**，本模块不去猜。
   * 选中的预设 id 是全局 UI 状态（localStorage 的 `activePresetId`），不在引擎的可见范围内。
   */
  storyPreset?: { id: string; name: string };
}

/** 单存档备份文件的顶层结构 */
export interface SessionBackup {
  kind: 'fated-poem-session-save';
  /**
   * = `DB_VERSION`。导入侧**只拿它做一个方向的判断**（与 FullBackup 同口径，2026-08-17 评审补）：
   * 戳 > 本机 `DB_VERSION` 直接拒（`assertBackupNotFromFuture`：备份比本机新，导进来
   * 会得到一批读不出来的残档）；戳更老或缺席照旧原样导入。其余场合它仍只是排查标记。
   */
  version: number;
  exportedAt: number;
  save: SaveSlot;
  profile: SaveProfile | null;
  characters: CharacterState[];
  messages: ChatMessage[];
  /**
   * v22 拆表后是**元数据行**；整档载荷在下面的 `snapshotPayloads`。
   * 旧的单存档备份（v21 及以前）这里整份内嵌，导入侧照样吃 —— 见 `normalizeSnapshotBackupRows`。
   */
  snapshots: SnapshotMeta[];
  /** v22 快照重载荷（旧备份缺此字段 → 由 snapshots 行就地拆出） */
  snapshotPayloads: SnapshotPayload[];
  memories: MemoryRecord[];
  plotEvents: PlotEvent[];
  plotOutlines: PlotOutline[];
  dependencies: SessionDependencies;
}

/** 导入前体检结果 —— 只读，永不因内容缺失而抛错 */
export interface SessionImportCheck {
  ok: boolean;
  /** 原样透传清单项，措辞层只用得到 token / bookName / entryTitle */
  missingEntries: SessionEntryRef[];
  packMismatches: Array<{
    packId: string;
    name?: string;
    expectedVersion: string;
    /** `null` = 这个包压根没装 */
    installedVersion: string | null;
  }>;
  missingStoryPreset?: { id: string; name: string };
}

const SESSION_BACKUP_KIND = 'fated-poem-session-save';

// ═══════════════════════════════════════════════════════════
// 结构判定
// ═══════════════════════════════════════════════════════════

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 结构判定 —— 只认 `kind`，够 UI 在「这是哪种备份文件」的岔路口分流 */
export function isSessionBackup(data: unknown): data is SessionBackup {
  const rec = asRecord(data);
  return rec !== null && rec.kind === SESSION_BACKUP_KIND;
}

/**
 * 整库备份（`FullBackup`）的**签名数组** —— 认出「这是不是一份整库备份」用的。
 *
 * 挑的都是 `exportAllData()` 必产出的顶层实体表；任何一条在，就说明这份 JSON 至少
 * 长着整库备份的形状。刻意不要求**全部**在场：老版本备份缺后加的那几张表是正常的。
 */
const FULL_BACKUP_SIGNATURE_FIELDS = [
  'saves',
  'characters',
  'lorebooks',
  'presets',
  'memories',
  'messages',
  'worldBooks',
] as const;

/**
 * 「这份 JSON 是整库备份吗」—— 整库导入前的**唯一**结构判据。
 *
 * 🔴 光看 `version` 是数字**远远不够**：角色卡 / 预设 / 各种社区 JSON 里 `version` 是
 *    极常见的字段，全都能通过。而整库导入的下一步是 `validateBackupOrThrow` ——
 *    它对**全部实体字段缺席**是容忍的（三态语义，为老备份留的），于是
 *    `doImportAllData` 会拿着一份空备份把用户整个库清空。判据松一格，代价是整库数据。
 *
 * 三条同时满足才算：普通对象 + `version` 是有限数 + **不是**单存档备份（`kind` 缺席）
 * + 至少有一条整库备份签名数组**真的在场**（`Array.isArray`，不是「字段存在」）。
 */
export function isFullBackupFile(data: unknown): boolean {
  const rec = asRecord(data);
  if (!rec) return false;
  if (typeof rec.version !== 'number' || !Number.isFinite(rec.version)) return false;
  // 单存档备份走另一条路（`importSessionSave`）；`kind` 在场就一定不是整库备份
  if (rec.kind !== undefined) return false;
  return FULL_BACKUP_SIGNATURE_FIELDS.some((f) => Array.isArray(rec[f]));
}

// ═══════════════════════════════════════════════════════════
// 导出
// ═══════════════════════════════════════════════════════════

/** 世界书条目 token → 注释（书名 / 条目名）。先到先得：uid 段按项目分配，实际不重叠 */
function buildEntryAnnotations(
  books: WorldBook[],
): Map<string, { bookName: string; entryTitle: string; entry: WorldBook['entries'][number] }> {
  const index = new Map<
    string,
    { bookName: string; entryTitle: string; entry: WorldBook['entries'][number] }
  >();
  for (const book of books) {
    for (const entry of book.entries ?? []) {
      const token = `${book.partition}:${entry.uid}`;
      if (index.has(token)) continue;
      index.set(token, { bookName: book.name, entryTitle: entry.name, entry });
    }
  }
  return index;
}

/**
 * 这份存档**真的用到**的内容包（Finding 4）。
 *
 * 两条判据，命中任一即算用到：
 * ① 包里某本世界书的条目，被本存档启用了至少一条（`enabledTokens` 命中）
 * ② 包带地图，且它的 `contentHash` 正是本存档档案里记着的 `worldFlags.map.packStamp`
 *    —— 存档确实是在这张地图上落过位的（自愈戳的语义见 types-map.ts）
 *
 * 判不出关系就**不进清单**：宁可少报一条「未安装内容包」，也不要让收件人对着一串
 * 与这份存档毫无关系的包名发愁。真缺内容时世界书条目那一段照样会报。
 */
function selectReferencedPacks(
  packs: ContentPackRecord[],
  books: WorldBook[],
  enabledTokens: Set<string>,
  mapPackStamp: string | undefined,
): SessionDependencies['packs'] {
  const booksById = new Map<string, WorldBook>();
  for (const b of books) booksById.set(b.id, b);

  const out: SessionDependencies['packs'] = [];
  for (const pack of packs) {
    let referenced = false;

    for (const packBook of pack.payload?.worldBooks ?? []) {
      // 本机安装的那本优先（用户可能改过条目）；没装则退回 payload 里的定义
      const book = booksById.get(packBook.id) ?? packBook;
      if ((book.entries ?? []).some((e) => enabledTokens.has(`${book.partition}:${e.uid}`))) {
        referenced = true;
        break;
      }
    }

    if (!referenced && mapPackStamp) {
      const hash = (pack.payload?.mapPack as { contentHash?: unknown } | undefined)?.contentHash;
      if (typeof hash === 'string' && hash !== '' && hash === mapPackStamp) referenced = true;
    }

    if (!referenced) continue;
    out.push({
      packId: pack.packId,
      packVersion: pack.packVersion,
      ...(pack.payload?.name ? { name: pack.payload.name } : {}),
    });
  }
  return out;
}

/**
 * 导出一个存档为可分享的 `SessionBackup`。
 *
 * @param saveId 要导出的存档
 * @param opts.storyPreset 当前选中的 story 预设（调用方从 UI 状态取；引擎读不到它）
 * @throws 存档不存在时抛中文错误
 */
export async function exportSessionSave(
  saveId: string,
  opts?: { storyPreset?: { id: string; name: string } },
): Promise<SessionBackup> {
  const db = getDatabase();

  const save = await db.saves.get(saveId);
  if (!save) {
    throw new Error(`导出失败：存档不存在（saveId=${saveId}）`);
  }

  // 表清单与 deleteSaveSlot 同源
  const [
    profile,
    characters,
    messages,
    snapshots,
    snapshotPayloads,
    memories,
    plotEvents,
    plotOutlines,
    books,
    packs,
  ] = await Promise.all([
    db.saveProfiles.get(saveId),
    db.characters.where('saveId').equals(saveId).toArray(),
    db.messages.where('saveId').equals(saveId).toArray(),
    db.snapshots.where('saveId').equals(saveId).toArray(),
    // v22 拆表：载荷自带 saveId 索引，与元数据行各取各的（清单仍与 deleteSaveSlot 同源）
    db.snapshotPayloads.where('saveId').equals(saveId).toArray(),
    db.memories.where('saveId').equals(saveId).toArray(),
    db.plotEvents.where('saveId').equals(saveId).toArray(),
    db.plotOutlines.where('saveId').equals(saveId).toArray(),
    db.worldBooks.toArray(),
    db.contentPacks.toArray(),
  ]);

  // ── 依赖清单 ──
  const tokens: string[] = [];
  const tokenSeen = new Set<string>();
  for (const t of save.metadata?.enabledWorldBookEntries ?? []) {
    if (typeof t !== 'string' || tokenSeen.has(t)) continue;
    tokenSeen.add(t);
    tokens.push(t);
  }

  const entryIndex = buildEntryAnnotations(books);
  const mapPackStamp =
    (profile?.worldFlags?.map as { packStamp?: unknown } | undefined)?.packStamp ?? undefined;
  const dependencies: SessionDependencies = {
    packs: selectReferencedPacks(
      packs,
      books,
      tokenSeen,
      typeof mapPackStamp === 'string' ? mapPackStamp : undefined,
    ),
    worldBookEntries: tokens.map((token) => {
      const hit = entryIndex.get(token);
      if (!hit) return { token };
      return {
        token,
        bookName: hit.bookName,
        entryTitle: hit.entryTitle,
      };
    }),
    ...(opts?.storyPreset ? { storyPreset: { ...opts.storyPreset } } : {}),
  };

  return {
    kind: SESSION_BACKUP_KIND,
    version: DB_VERSION,
    exportedAt: Date.now(),
    save: structuredClone(save),
    profile: profile ? structuredClone(profile) : null,
    characters: structuredClone(characters),
    messages: structuredClone(messages),
    snapshots: structuredClone(snapshots),
    snapshotPayloads: structuredClone(snapshotPayloads),
    memories: structuredClone(memories),
    plotEvents: structuredClone(plotEvents),
    plotOutlines: structuredClone(plotOutlines),
    dependencies,
  };
}

// ═══════════════════════════════════════════════════════════
// 导入前体检
// ═══════════════════════════════════════════════════════════

/**
 * 导入前只读体检 —— **一个字节都不写**，也**永不因内容缺失抛错**。
 *
 * 缺内容不是错误，是一个需要用户知情后决定的状况（照样导入 / 先去装内容包）。
 * 把它做成抛错，UI 就只能在「拦下来」和「假装没事」之间二选一。
 */
export async function checkSessionSaveDependencies(
  backup: SessionBackup,
): Promise<SessionImportCheck> {
  const db = getDatabase();
  const deps: SessionDependencies = backup?.dependencies ?? {
    packs: [],
    worldBookEntries: [],
  };

  const [books, packs] = await Promise.all([db.worldBooks.toArray(), db.contentPacks.toArray()]);

  // 收件人库里现有的 token 全集
  const available = new Set<string>();
  for (const book of books) {
    for (const entry of book.entries ?? []) available.add(`${book.partition}:${entry.uid}`);
  }

  const missingEntries = (deps.worldBookEntries ?? []).filter((e) => !available.has(e.token));

  const installedPacks = new Map(packs.map((p) => [p.packId, p]));
  const packMismatches: SessionImportCheck['packMismatches'] = [];
  for (const want of deps.packs ?? []) {
    const installed = installedPacks.get(want.packId);
    if (!installed) {
      packMismatches.push({
        packId: want.packId,
        ...(want.name ? { name: want.name } : {}),
        expectedVersion: want.packVersion,
        installedVersion: null,
      });
    } else if (installed.packVersion !== want.packVersion) {
      packMismatches.push({
        packId: want.packId,
        ...(want.name ? { name: want.name } : {}),
        expectedVersion: want.packVersion,
        installedVersion: installed.packVersion,
      });
    }
  }

  let missingStoryPreset: SessionImportCheck['missingStoryPreset'];
  if (deps.storyPreset) {
    const hit = await db.presets.get(deps.storyPreset.id);
    if (!hit) missingStoryPreset = { ...deps.storyPreset };
  }

  return {
    ok: missingEntries.length === 0 && packMismatches.length === 0 && !missingStoryPreset,
    missingEntries,
    packMismatches,
    ...(missingStoryPreset ? { missingStoryPreset } : {}),
  };
}

// ═══════════════════════════════════════════════════════════
// 导入
// ═══════════════════════════════════════════════════════════

/**
 * 旧 id → 新 id 的**惰性**映射。
 *
 * 惰性是关键：快照里嵌着的角色/消息/剧情副本可能引用**顶层数组里已经没有**的行
 * （角色后来被删了、消息被回退掉了）。严格查表会把这些旧 id 原样留下 ——
 * 于是第二次导入同一个文件时，两个存档的快照里出现同一个 id，`bulkPut` 静默互相覆盖。
 */
class IdMap {
  private readonly map = new Map<string, string>();

  get(oldId: string): string {
    let next = this.map.get(oldId);
    if (next === undefined) {
      next = crypto.randomUUID();
      this.map.set(oldId, next);
    }
    return next;
  }

  /** 严格查表 —— 只在旧 id 确实是本备份里的行时才改写 */
  peek(oldId: string): string | undefined {
    return this.map.get(oldId);
  }
}

/**
 * 「软引用」改写：只有查得到才改。
 *
 * `relatedCharacterIds` / `targetId` 这类字段在本仓里**并不保证装的是角色 id** ——
 * 铁律 1 之后不少地方装的是名字。惰性分配会把一个名字改写成 UUID，
 * 那是真正的破坏；查不到就原样留着才是安全的默认。
 */
function remapSoftRefs(ids: string[] | undefined, map: IdMap): string[] | undefined {
  if (!Array.isArray(ids)) return ids;
  return ids.map((id) => map.peek(id) ?? id);
}

function readArray<T>(source: Record<string, unknown>, field: string): T[] {
  const v = source[field];
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * 三态校验（沿用 FullBackup 的 `validateBackupOrThrow` 口径）：
 * 字段**缺席**当空数组容忍，字段**在但不是数组**直接拒。
 * 外加一道**前向版本闸门**：备份比本机新直接拒（`assertBackupNotFromFuture`）。
 */
function validateSessionBackupOrThrow(backup: unknown): Record<string, unknown> {
  const rec = asRecord(backup);
  if (!rec) {
    throw new Error('备份格式无效：非对象');
  }
  if (rec.kind !== SESSION_BACKUP_KIND) {
    throw new Error('备份格式无效：不是单存档备份文件（kind 不匹配）');
  }
  if (typeof rec.version !== 'number' || !Number.isFinite(rec.version)) {
    throw new Error('备份格式无效：缺少有效的 version 字段');
  }
  assertBackupNotFromFuture(rec.version);
  if (!asRecord(rec.save)) {
    throw new Error('备份格式无效：缺少 save 存档主记录');
  }
  const arrayFields = [
    'characters',
    'messages',
    'snapshots',
    // v22 新增；旧备份缺这个字段照常通过（载荷从内嵌的 snapshots 行拆出）
    'snapshotPayloads',
    'memories',
    'plotEvents',
    'plotOutlines',
  ];
  for (const f of arrayFields) {
    const v = rec[f];
    if (v !== undefined && !Array.isArray(v)) {
      throw new Error(`备份格式无效：字段 ${f} 必须是数组`);
    }
  }
  return rec;
}

/**
 * 导入一个 `SessionBackup`，返回新存档 id。
 *
 * **一律重发 id**（存档 / 角色 / 消息 / 快照 / 剧情 / 大纲 / 记忆 / 插画），于是：
 * - 同一个文件导两次 = 两个完全独立的存档，删掉其中一个不影响另一个
 * - 永远撞不上收件人库里已有的行（不重发 id 时，导入是**静默覆盖**）
 *
 * 🔴 **不碰任何全局表**：worldBooks / presets / settings / imagePresets / contentPacks /
 *    audio* / asset* 一行都不动。缺内容由 `checkSessionSaveDependencies` 在导入前告知，
 *    导入本身不去替用户装内容。
 */
export async function importSessionSave(backup: SessionBackup): Promise<{ saveId: string }> {
  const rec = validateSessionBackupOrThrow(backup);
  const db = getDatabase();

  const rawSave = asRecord(rec.save) as unknown as SaveSlot;
  const rawProfile = asRecord(rec.profile) as unknown as SaveProfile | null;

  const characters = readArray<CharacterState>(rec, 'characters');
  const messages = readArray<ChatMessage>(rec, 'messages');
  // v22 拆表 —— 两种格式都吃：新备份两个数组各就各位，旧备份只有内嵌的 snapshots
  const { metas: snapshots, payloads: snapshotPayloads } = normalizeSnapshotBackupRows(
    readArray<Snapshot | SnapshotMeta>(rec, 'snapshots'),
    readArray<SnapshotPayload>(rec, 'snapshotPayloads'),
  );
  const memories = readArray<MemoryRecord>(rec, 'memories');
  const plotEvents = readArray<PlotEvent>(rec, 'plotEvents');
  const plotOutlines = readArray<PlotOutline>(rec, 'plotOutlines');

  const newSaveId = crypto.randomUUID();
  const charIds = new IdMap();
  const msgIds = new IdMap();
  const snapIds = new IdMap();
  const plotIds = new IdMap();
  const outlineIds = new IdMap();

  // 顺序有讲究：先把顶层真行注册进映射，之后嵌套副本里查不到的才是真悬空引用
  for (const c of characters) charIds.get(c.id);
  for (const m of messages) msgIds.get(m.id);
  for (const s of snapshots) snapIds.get(s.id);
  for (const e of plotEvents) plotIds.get(e.id);
  for (const o of plotOutlines) outlineIds.get(o.id);

  const remapCharacter = (c: CharacterState): CharacterState => ({
    ...c,
    id: charIds.get(c.id),
    saveId: newSaveId,
  });
  const remapMessage = (m: ChatMessage): ChatMessage => ({
    ...m,
    id: msgIds.get(m.id),
    ...(m.saveId !== undefined ? { saveId: newSaveId } : {}),
  });
  const remapPlotEvent = (e: PlotEvent): PlotEvent => {
    const next: PlotEvent = {
      ...e,
      id: plotIds.get(e.id),
      saveId: newSaveId,
      childrenIds: Array.isArray(e.childrenIds) ? e.childrenIds.map((id) => plotIds.get(id)) : [],
    };
    if (e.parentId !== undefined) next.parentId = plotIds.get(e.parentId);
    const related = remapSoftRefs(e.relatedCharacterIds, charIds);
    if (related !== undefined) next.relatedCharacterIds = related;
    return next;
  };
  const remapProfile = (p: SaveProfile): SaveProfile => ({
    ...p,
    saveId: newSaveId,
    // 命运契约指着角色行；affections 的键是**名字**（铁律 1），刻意不动
    contracts: Array.isArray(p.contracts)
      ? p.contracts.map((c) => ({ ...c, targetId: charIds.peek(c.targetId) ?? c.targetId }))
      : p.contracts,
  });

  const nextMetadata: SaveSlot['metadata'] = asRecord(rawSave.metadata)
    ? { ...rawSave.metadata }
    : { characterName: '', userName: '', gameStartTime: '', totalTurns: 0 };

  const nextSave: SaveSlot = {
    ...rawSave,
    id: newSaveId,
    updatedAt: Date.now(),
    // 严格查表：快照不在本备份里 → 置 null（惰性分配会造出一个指向虚空的 id）
    activeSnapshotId: rawSave.activeSnapshotId
      ? (snapIds.peek(rawSave.activeSnapshotId) ?? null)
      : null,
    metadata: nextMetadata,
  };

  const nextCharacters = characters.map(remapCharacter);
  const nextMessages = messages.map(remapMessage);
  const nextPlotEvents = plotEvents.map(remapPlotEvent);
  const nextPlotOutlines = plotOutlines.map((o) => ({
    ...o,
    id: outlineIds.get(o.id),
    saveId: newSaveId,
  }));
  const nextProfile = rawProfile ? remapProfile(rawProfile) : null;

  const nextSnapshots: SnapshotMeta[] = snapshots.map((s) => ({
    ...s,
    id: snapIds.get(s.id),
    saveId: newSaveId,
  }));

  // 快照载荷里嵌着 characters / saveProfile / plotEvents / messages 的深拷贝，
  // 而 restoreSnapshot 会把它们**原样写回库**（覆写语义）—— 所以必须用同一套映射改写，
  // 否则一次回退就把旧 id 复活到库里，两个导入出来的存档从此互相污染。
  //
  // 🔴 载荷行的 id **跟着它那条元数据行的新 id 走**（`snapIds` 是同一张映射表）：
  //    各发各的号就等于把一对拆散，恢复时会报「载荷行不存在」。
  const nextSnapshotPayloads: SnapshotPayload[] = snapshotPayloads.map((p) => ({
    ...p,
    id: snapIds.get(p.id),
    saveId: newSaveId,
    characters: Array.isArray(p.characters) ? p.characters.map(remapCharacter) : [],
    saveProfile: asRecord(p.saveProfile) ? remapProfile(p.saveProfile) : p.saveProfile,
    ...(p.plotEvents !== undefined
      ? { plotEvents: Array.isArray(p.plotEvents) ? p.plotEvents.map(remapPlotEvent) : [] }
      : {}),
    ...(p.messages !== undefined
      ? { messages: Array.isArray(p.messages) ? p.messages.map(remapMessage) : [] }
      : {}),
  }));

  await db.transaction(
    'rw',
    [
      db.saves,
      db.saveProfiles,
      db.characters,
      db.messages,
      db.snapshots,
      db.snapshotPayloads,
      db.memories,
      db.plotEvents,
      db.plotOutlines,
    ],
    async () => {
      // 槽位：取现有最大 +1（slot 不是唯一索引，这里只求「不和别人挤同一格」）
      const existingSlots = await db.saves.toArray();
      let maxSlot = -1;
      for (const s of existingSlots) {
        if (typeof s.slot === 'number' && Number.isFinite(s.slot) && s.slot > maxSlot) {
          maxSlot = s.slot;
        }
      }
      nextSave.slot = maxSlot + 1;

      // 记忆编号从全库最大号往后续（格式必须留住 —— 换成 UUID 的话新记忆会从
      // MEM000001 重新编号；见 memory-summarizer.allocateMemoryIds）
      // 🔴 只要 id 就别 `toArray()` —— 那会把每条记忆的正文和 embedding 向量
      //    （4096 维浮点）整份读进内存，纯粹为了算一个最大编号。
      const existingMemoryIds = (await db.memories.toCollection().primaryKeys()) as string[];
      const memoryIds = allocateMemoryIds(existingMemoryIds, memories.length);
      const nextMemories: MemoryRecord[] = memories.map((m, i) => {
        const next: MemoryRecord = { ...m, id: memoryIds[i], saveId: newSaveId };
        const related = remapSoftRefs(m.relatedCharacterIds, charIds);
        if (related !== undefined) next.relatedCharacterIds = related;
        return next;
      });

      await db.saves.put(nextSave);
      if (nextProfile) await db.saveProfiles.put(nextProfile);
      if (nextCharacters.length > 0) await db.characters.bulkPut(nextCharacters);
      if (nextMessages.length > 0) await db.messages.bulkPut(nextMessages);
      if (nextSnapshots.length > 0) await db.snapshots.bulkPut(nextSnapshots);
      if (nextSnapshotPayloads.length > 0) await db.snapshotPayloads.bulkPut(nextSnapshotPayloads);
      if (nextMemories.length > 0) await db.memories.bulkPut(nextMemories);
      if (nextPlotEvents.length > 0) await db.plotEvents.bulkPut(nextPlotEvents);
      if (nextPlotOutlines.length > 0) await db.plotOutlines.bulkPut(nextPlotOutlines);
    },
  );

  return { saveId: newSaveId };
}
