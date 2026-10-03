/**
 * album.ts 单元测试 — 卡册读写辅助（同名≤2 / 容量 / 纯函数不变式）
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ALBUM_CAPACITY,
  DEFAULT_DECK_SIZE,
  MAX_COPIES_PER_CARD,
  createCardAlbum,
  ensureCardAlbum,
  countInDeck,
  canAddToAlbum,
  addCardToAlbum,
  removeCardFromAlbum,
  canAddToDeck,
  addToDeck,
  deadDeckSlots,
  removeFromDeck,
  toPlainCardAlbum,
} from './album';
import type { CardAlbumState } from '../types';

/** 造一张容量 3、卡组上限可触发的迷你卡册 */
function mini(over: Partial<CardAlbumState> = {}): CardAlbumState {
  return { owned: [], deck: [], capacity: 3, ...over };
}

describe('createCardAlbum / ensureCardAlbum', () => {
  it('缺省形状：空 owned / 空 deck / 默认容量', () => {
    expect(createCardAlbum()).toEqual({
      owned: [],
      deck: [],
      capacity: DEFAULT_ALBUM_CAPACITY,
    });
  });
  it('undefined → 缺省卡册；已有卡册原样返回（同一引用）', () => {
    const existing = mini({ owned: ['燎原'] });
    expect(ensureCardAlbum(undefined).capacity).toBe(DEFAULT_ALBUM_CAPACITY);
    expect(ensureCardAlbum(existing)).toBe(existing);
  });
});

describe('addCardToAlbum / canAddToAlbum（容量按去重种类数计）', () => {
  it('收录新卡进 owned；重复收录幂等成功且不重复占格', () => {
    let album = mini();
    album = addCardToAlbum(album, '燎原').album;
    expect(album.owned).toEqual(['燎原']);
    const again = addCardToAlbum(album, '燎原');
    expect(again.ok).toBe(true);
    expect(again.album.owned).toEqual(['燎原']);
  });
  it('容量满后拒绝收录新种类，已收录种类不受影响', () => {
    const album = mini({ owned: ['甲', '乙', '丙'] });
    expect(canAddToAlbum(album, '丁')).toBe(false);
    expect(canAddToAlbum(album, '甲')).toBe(true);
    const r = addCardToAlbum(album, '丁');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('卡册已满');
    expect(r.album).toBe(album); // 失败原样返回
  });
  it('纯函数：不原地改入参', () => {
    const album = mini();
    addCardToAlbum(album, '燎原');
    expect(album.owned).toEqual([]);
  });
});

describe('canAddToDeck（三判逐一可见）', () => {
  it('未收录 / 同名超限 / 卡组满，各有中文原因', () => {
    expect(canAddToDeck(mini(), '燎原')).toEqual({ ok: false, reason: '尚未收录这张卡' });
    expect(
      canAddToDeck(mini({ owned: ['燎原'], deck: ['燎原', '燎原'] }), '燎原').reason,
    ).toContain('同名');
    const owned = Array.from({ length: DEFAULT_DECK_SIZE }, (_, i) => `卡${i}`);
    const full = mini({ owned: [...owned, '尾卡'], deck: owned });
    expect(canAddToDeck(full, '尾卡').reason).toContain('卡组已满');
  });
  it('正常编入放行', () => {
    expect(canAddToDeck(mini({ owned: ['燎原'] }), '燎原')).toEqual({ ok: true });
  });
});

describe('addToDeck / canAddToDeck（同名≤2 + 卡组上限）', () => {
  it('未收录的卡不能编入', () => {
    const r = addToDeck(mini(), '燎原');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('尚未收录');
  });
  it(`同名最多编入 ${MAX_COPIES_PER_CARD} 张`, () => {
    let album = mini({ owned: ['燎原'], deck: [], capacity: DEFAULT_ALBUM_CAPACITY });
    album = addToDeck(album, '燎原').album;
    album = addToDeck(album, '燎原').album;
    expect(countInDeck(album.deck, '燎原')).toBe(2);
    const third = addToDeck(album, '燎原');
    expect(third.ok).toBe(false);
    expect(third.reason).toContain('同名');
  });
  it(`卡组上限 ${DEFAULT_DECK_SIZE} 张`, () => {
    const owned = Array.from({ length: DEFAULT_DECK_SIZE }, (_, i) => `卡${i}`);
    let album = mini({ owned: [...owned, '尾卡'], deck: [], capacity: 99 });
    for (const name of owned) album = addToDeck(album, name).album;
    expect(album.deck.length).toBe(DEFAULT_DECK_SIZE);
    const r = addToDeck(album, '尾卡');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('卡组已满');
  });
});

describe('removeFromDeck / removeCardFromAlbum', () => {
  it('撤出同名卡撤最后编入的那张；没有时原样返回', () => {
    const album = mini({
      owned: ['燎原'],
      deck: ['燎原', '甲', '燎原'],
      capacity: 9,
    });
    const next = removeFromDeck(album, '燎原');
    expect(next.deck).toEqual(['燎原', '甲']);
    expect(removeFromDeck(next, '不存在')).toBe(next);
  });
  it('移出卡册连带清出卡组', () => {
    const album = mini({ owned: ['燎原'], deck: ['燎原'], capacity: 9 });
    const next = removeCardFromAlbum(album, '燎原');
    expect(next.owned).toEqual([]);
    expect(next.deck).toEqual([]);
  });
});

describe('toPlainCardAlbum —— 响应式 Proxy 净化（真机 DataCloneError 修复）', () => {
  it('Proxy 数组 → 普通数组（拷贝引用，元素与顺序保持；引擎禁 import vue，手搓同款形状）', () => {
    const proxyAlbum = {
      owned: new Proxy(['灼热盆地', '苍穹之翼'], {}) as string[],
      deck: new Proxy(['灼热盆地'], {}) as string[],
      capacity: 60,
    };
    const plain = toPlainCardAlbum(proxyAlbum);
    // owned/deck 不再是同一个 Proxy（浅拷成普通数组），元素与顺序保持
    expect(plain.owned).not.toBe(proxyAlbum.owned);
    expect(plain.deck).not.toBe(proxyAlbum.deck);
    expect([...plain.owned]).toEqual(['灼热盆地', '苍穹之翼']);
    expect([...plain.deck]).toEqual(['灼热盆地']);
    expect(plain.capacity).toBe(60);
    // 深路径也不再携带 Proxy：owned 的每个元素是普通字符串
    expect(plain.owned.map((n) => typeof n)).toEqual(['string', 'string']);
  });
  it('脏形状兜底：非数组/缺 capacity 归一为安全缺省', () => {
    const plain = toPlainCardAlbum({ owned: '坏数据', capacity: undefined } as never);
    expect(plain.owned).toEqual([]);
    expect(plain.deck).toEqual([]);
    expect(plain.capacity).toBe(60);
  });
});

// ===== 编组资格的形态拦截（2026-09-18 裁决）=====

describe('编组资格：按「能否打出」统一判', () => {
  const albumWith = (deck: string[] = []): CardAlbumState => ({
    owned: ['可战卡', '物资卡', '素材卡'],
    deck,
    capacity: 60,
  });
  /** 注入的形态判据：物资/素材不可出战（对应 card-kind.isPlayable） */
  const playable = (name: string) => name === '可战卡';

  it('可出战的卡：正常编入', () => {
    const r = addToDeck(albumWith(), '可战卡', playable);
    expect(r.ok).toBe(true);
    expect(r.album.deck).toEqual(['可战卡']);
  });

  it('物资卡被拦：原因可见，卡册原样', () => {
    const before = albumWith();
    const r = addToDeck(before, '物资卡', playable);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('不能在战斗中打出');
    expect(r.album).toBe(before); // 失败不改入参
  });

  it('素材卡被拦（同类 bug 一并修：此前禁打却可编组且给战力加成）', () => {
    const r = addToDeck(albumWith(), '素材卡', playable);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('不能在战斗中打出');
  });

  it('canAddToDeck 与 addToDeck 同判据（形态先于收录判定）', () => {
    expect(canAddToDeck(albumWith(), '物资卡', playable).ok).toBe(false);
    expect(canAddToDeck(albumWith(), '可战卡', playable).ok).toBe(true);
    // 不传判据 = 跳过形态校验（旧行为，生产调用方必须传）
    expect(canAddToDeck(albumWith(), '物资卡').ok).toBe(true);
  });

  it('deadDeckSlots：挑出卡组里的无效位（老存档不自动清理，只标灰）', () => {
    const dead = deadDeckSlots(['可战卡', '物资卡', '可战卡', '素材卡'], playable);
    expect(dead).toEqual(['物资卡', '素材卡']);
    expect(deadDeckSlots(['可战卡'], playable)).toEqual([]);
  });
});
