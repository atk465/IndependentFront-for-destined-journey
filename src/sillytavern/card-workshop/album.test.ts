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
  removeFromDeck,
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
