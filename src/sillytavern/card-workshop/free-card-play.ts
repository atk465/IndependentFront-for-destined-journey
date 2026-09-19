import type { BasicCounter, SkirmishChoice } from './skirmish';
import { parseModelJson } from '../model-json';
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

// ════════════════════════════════════════════════════════════════════
// L2 · AI 意图解析（2026-09-17）：处理 L1 卡名匹配搞不定的转义/含糊表达。
// 轻量结构化调用（skirmish_eval 端点）：玩家原话 + 可出卡清单 + 当前敌方意图
// → 严格 JSON 动作。本模块只负责提示词构建与响应校验（纯函数）；
// 网络调用在 skirmish-agent.ts 的 runSkirmishIntentResolve。
// ════════════════════════════════════════════════════════════════════

export interface IntentResolveRequest {
  playerText: string;
  /** 可出卡清单（已过 battleReady 过滤，未打出过） */
  cards: ReadonlyArray<{ name: string; tags: readonly string[] }>;
  /** 当前敌方意图的反制标签 */
  intentCounters: readonly string[];
}

export type ParsedIntent =
  | { kind: 'play_card'; card: string; declaration?: string }
  | { kind: 'counter'; move: BasicCounter }
  | { kind: 'none' };

/** 构建 L2 意图解析的消息组（严格 JSON 契约） */
export function buildIntentResolveMessages(req: IntentResolveRequest): Array<{
  role: 'system' | 'user';
  content: string;
}> {
  const cardLines = req.cards.length
    ? req.cards
        .map((c) => `- ${c.name}｜反制：${c.tags.length ? c.tags.join('/') : '无'}`)
        .join('\n')
    : '（无）';
  const counters = req.intentCounters.length ? req.intentCounters.join('/') : '无';
  return [
    {
      role: 'system',
      content:
        '你是交锋意图解析器。把玩家的一句自由文本解析为一个战斗动作，只输出 JSON，不输出任何其他内容。\n' +
        '可选动作：\n' +
        '1. {"action":"play_card","card":"<卡名>","declaration":"<出卡宣言>"} —— 玩家想打出某张卡。' +
        'card 必须逐字来自下方卡名单；declaration 用玩家原话或其提炼。\n' +
        '2. {"action":"counter","move":"<强攻|防御|闪避>"} —— 玩家想做基础应对（未提卡）。\n' +
        '3. {"action":"none"} —— 玩家没有出牌/应对的意思（纯对话、提问、无关内容）。\n' +
        '判定优先级：明确提到卡名/卡的元素或形态 → play_card；明确表达防御/闪避/强攻姿态 → counter；其余 → none。拿不准就 none。',
    },
    {
      role: 'user',
      content: `当前敌方意图的反制标签（命中它有加成）：${counters}\n可出卡名单：\n${cardLines}\n\n玩家说：「${req.playerText}」`,
    },
  ];
}

/** 校验 AI 返回的动作（严格白名单；非法 → none） */
export function parseIntentResponse(
  raw: string,
  battleReady: readonly { name: string }[],
  playedCards: readonly string[],
): ParsedIntent {
  const parsed = parseModelJson<Record<string, unknown>>(raw, (o) =>
    o && typeof o === 'object' ? (o as Record<string, unknown>) : null,
  );
  if (!parsed) return { kind: 'none' };
  const action = parsed.action;
  const played = new Set(playedCards);
  if (action === 'play_card' && typeof parsed.card === 'string') {
    const name = parsed.card.trim();
    const card = battleReady.find((c) => c.name === name && !played.has(c.name));
    if (!card) return { kind: 'none' };
    const declaration =
      typeof parsed.declaration === 'string' && parsed.declaration.trim()
        ? parsed.declaration.trim()
        : undefined;
    return { kind: 'play_card', card: name, ...(declaration ? { declaration } : {}) };
  }
  if (action === 'counter' && typeof parsed.move === 'string') {
    const move = parsed.move as BasicCounter;
    if (BASIC_COUNTERS.includes(move)) return { kind: 'counter', move };
  }
  return { kind: 'none' };
}
