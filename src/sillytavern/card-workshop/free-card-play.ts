import type { SkirmishChoice } from './skirmish';
import { BASIC_COUNTERS } from './skirmish';
import { cardCombatTags } from './entry-combat';
import type { CardItem } from '../types';

/**
 * matchFreeCardPlay —— 自由文本提名出卡（2026-09-17，路线图 1.1 L1 确定性快路径）
 *
 * 交锋活跃时，把玩家的一句话解析成反制选择：
 * - 命中唯一一张可出卡 → { kind: '卡', name, intent = 原句（宣言素材） }
 * - 命中基础应对关键词（强攻/防御/闪避）→ { kind: '应对', move }
 * - 什么都不命中 → { kind: 'none' }（调用方走叙事管线照旧）
 *
 * 纯函数；候选必须已过 battleReadyCards（可出资格）与 playedCards（一场一次）。
 * 多张命中取名字最长者（更具体的提名优先）。
 */

export type FreeCardMatch =
  | { kind: '卡'; choice: SkirmishChoice & { kind: '卡' } }
  | { kind: '应对'; choice: SkirmishChoice & { kind: '应对' } }
  | { kind: 'none'; cardCandidates: string[] };

export function matchFreeCardPlay(
  text: string,
  battleReady: readonly Pick<CardItem, 'name' | 'cardTier' | '词条'>[],
  playedCards: readonly string[],
): FreeCardMatch {
  const text_ = text.trim();
  if (!text_) return { kind: 'none', cardCandidates: [] };

  // ① 基础应对关键词（词首出现即认；「防御」「闪避」「强攻」本身也是通用词，
  //    仅当句子里没有卡名命中时才兜底采用）
  const basicHit = BASIC_COUNTERS.find((move) => text_.includes(move));

  // ② 卡名匹配（可出、未打出过、名字完整出现）
  const played = new Set(playedCards);
  const candidates = battleReady.filter((c) => !played.has(c.name) && text_.includes(c.name));
  if (candidates.length > 0) {
    const best = candidates.reduce((a, b) => (b.name.length > a.name.length ? b : a));
    return {
      kind: '卡',
      choice: { kind: '卡', name: best.name, ...(text_ ? { intent: text_ } : {}) },
    };
  }

  // ③ 基础应对兜底
  if (basicHit) {
    return { kind: '应对', choice: { kind: '应对', move: basicHit } };
  }
  return { kind: 'none', cardCandidates: candidates.map((c) => c.name) };
}

/**
 * 出卡推荐（2026-09-17，路线图 1.1 L3）：对当前敌方意图，按反制标签命中数排序
 * 可出卡——读招打对有 ⌈威胁/2⌉ 加成（counterBonusOf），推荐徽章就是把这个奖励
 * 变成看得见的决策辅助。纯查表，零 AI。
 *
 * @returns 带命中数与推荐标记的卡列表（推荐=命中≥1；按命中数降序、原序稳定）
 */
export function recommendCards<
  T extends { name: string; cardTier: string; 词条: readonly string[] | undefined },
>(
  cards: readonly T[],
  intentCounters: readonly string[] | undefined,
  playedCards: Iterable<string>,
): Array<T & { counterHits: number; recommended: boolean }> {
  const played = new Set(playedCards);
  const counters = intentCounters ?? [];
  const rows = cards.map((c) => {
    const hits = cardCombatTags(c.词条).filter((t) => counters.includes(t)).length;
    return { ...c, counterHits: hits, recommended: hits > 0 && !played.has(c.name) };
  });
  return rows.sort((a, b) => b.counterHits - a.counterHits);
}
