/**
 * album.ts — 卡册读写辅助（卡牌工坊 MVP）
 *
 * CardAlbumState 挂在 CharacterState.cardAlbum 上；本模块是它的**唯一**读写规则集：
 * - 卡册容量：按 owned 的去重种类数计（同名多张占背包 quantity，不重复占卡册格）
 * - 卡组：同名 ≤ MAX_COPIES_PER_CARD 张，上限 DEFAULT_DECK_SIZE 张
 * - 逻辑键 = 名字（铁律1）：全部按名字寻址，无 id
 *
 * 全部纯函数：返回新对象，绝不原地改入参；失败时 ok:false 且 album 原样返回。
 * 落库不在本模块 —— 写入口经 update_character 的 cardAlbum 键走 commitChatState。
 */

import type { CardAlbumState } from '../types';

/** 卡册默认容量（按卡牌种类数计） */
export const DEFAULT_ALBUM_CAPACITY = 60;

/** 卡组默认上限（张） */
export const DEFAULT_DECK_SIZE = 12;

/** 同名卡编入卡组的上限（张） */
export const MAX_COPIES_PER_CARD = 2;

/** 一次卡册操作的回执：失败时 album 原样返回 */
export interface AlbumOpResult {
  ok: boolean;
  /** 失败原因（中文，可直接进 UI 提示） */
  reason?: string;
  album: CardAlbumState;
}

/** 空卡册 */
export function createCardAlbum(capacity: number = DEFAULT_ALBUM_CAPACITY): CardAlbumState {
  return { owned: [], deck: [], capacity };
}

/** 角色身上的卡册；旧存档没有该字段时给一份缺省（不落库，落库由写入口决定） */
export function ensureCardAlbum(album: CardAlbumState | undefined): CardAlbumState {
  return album ?? createCardAlbum();
}

/** 某张卡在卡组里的张数 */
export function countInDeck(deck: string[], cardName: string): number {
  return deck.filter((n) => n === cardName).length;
}

function fail(album: CardAlbumState, reason: string): AlbumOpResult {
  return { ok: false, reason, album };
}

/** 卡册还能不能收录新卡（已收录的种类不受容量限制） */
export function canAddToAlbum(album: CardAlbumState, cardName: string): boolean {
  return album.owned.includes(cardName) || album.owned.length < album.capacity;
}

/** 收录一张卡进卡册（按名去重，重复收录幂等成功） */
export function addCardToAlbum(album: CardAlbumState, cardName: string): AlbumOpResult {
  const name = cardName.trim();
  if (!name) return fail(album, '卡牌名为空');
  if (album.owned.includes(name)) return { ok: true, album };
  if (album.owned.length >= album.capacity) return fail(album, `卡册已满（${album.capacity} 种）`);
  return { ok: true, album: { ...album, owned: [...album.owned, name] } };
}

/** 从卡册移除一张卡（连带撤出卡组；不存在时原样返回） */
export function removeCardFromAlbum(album: CardAlbumState, cardName: string): CardAlbumState {
  if (!album.owned.includes(cardName)) return album;
  return {
    ...album,
    owned: album.owned.filter((n) => n !== cardName),
    deck: album.deck.filter((n) => n !== cardName),
  };
}

/**
 * 能否把一张卡编入卡组：未收录 / 同名超限 / 卡组满 三判，
 * 逐条给出中文原因（UI 直接展示，不做二次拼接）。
 */
export function canAddToDeck(
  album: CardAlbumState,
  cardName: string,
): { ok: boolean; reason?: string } {
  if (!album.owned.includes(cardName)) return { ok: false, reason: '尚未收录这张卡' };
  if (countInDeck(album.deck, cardName) >= MAX_COPIES_PER_CARD) {
    return { ok: false, reason: `同名卡最多编入 ${MAX_COPIES_PER_CARD} 张` };
  }
  if (album.deck.length >= DEFAULT_DECK_SIZE) {
    return { ok: false, reason: `卡组已满（${DEFAULT_DECK_SIZE} 张）` };
  }
  return { ok: true };
}

/** 编入一张（失败时 ok:false 且卡册原样） */
export function addToDeck(album: CardAlbumState, cardName: string): AlbumOpResult {
  const check = canAddToDeck(album, cardName);
  if (!check.ok) return fail(album, check.reason ?? '无法编入');
  return { ok: true, album: { ...album, deck: [...album.deck, cardName] } };
}

/** 撤出一张同名卡（撤最后编入的那张；卡组里没有时原样返回） */
export function removeFromDeck(album: CardAlbumState, cardName: string): CardAlbumState {
  const idx = album.deck.lastIndexOf(cardName);
  if (idx === -1) return album;
  const deck = [...album.deck];
  deck.splice(idx, 1);
  return { ...album, deck };
}
