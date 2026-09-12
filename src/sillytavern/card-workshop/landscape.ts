/**
 * landscape.ts — 地景卡识别（卡牌工坊 阶段 4）
 *
 * 世界观「山川河流可被封入卡牌」：词条含「地景」的卡即是地景卡。
 * 战斗内核的 landscape 通道见 combat-v3（DeclareAction(item).payload.landscape）；
 * 本模块是会话层装配 payload 时的识别判据（phase4 设计文档 §4），
 * 「地景」词条由叙事/委托自然产出，融合内核不特判。
 */

import type { CardItem } from '../types';

/** 地景形态词条（单一真源） */
export const LANDSCAPE_ENTRY = '地景' as const;

/** 这张卡是不是地景卡（按词条判定；逻辑键=名字，卡本体在背包） */
export function isLandscapeCard(card: Pick<CardItem, '词条'>): boolean {
  return card.词条.includes(LANDSCAPE_ENTRY);
}
