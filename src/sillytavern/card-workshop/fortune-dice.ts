/**
 * fortune-dice.ts — 好运之骰（SS「好运之骰」· 每日十面骰）
 *
 * 天赋描述原文：「每天一次投十面骰：谢谢惠顾/福缘天降/再来一次/红鸾天喜/提升一级/
 * 刀刀暴击/制卡顺利/材料秘境/屠龙宝刀/杂鱼杂鱼」。
 *
 * 设计裁定（主人 2026-09-17）：**十面 = 十条数据，每面自带兑现口径**。分成三类：
 *  - **即时发放**（6 面）：金钱增减 / 素材 / 卡 / 等级 / 好感；「谢谢惠顾」什么都不发。
 *  - **账本操作**（1 面）：「再来一次」退还今日次数（不写账本）。
 *  - **当日增益**（2 面）：「刀刀暴击」当日战斗行动值加成、「制卡顺利」当日制卡评级上浮。
 *    走 `worldFlags.dailyBuffs.<key> = gameDay`，**跨天自动失效**（与 daily-ledger 同口径）。
 *
 * 为什么不是「全交给 AI 演绎」：抽奖是本作唯一的纯随机入口，玩家会反复投——
 * 结果必须可复算、可审计、不能靠叙事手感。所以十面全部 Code 兑现，
 * AI 只负责把结果写成一段读起来像命运的话。
 *
 * 纯度约束：纯函数、不 mutate、**不掷骰**（d10 由调用方传入，与 skirmish 同铁律）。
 */

import type { CardTier, Rarity } from '../field-enums';

/** 骰面吉凶（内容侧配色/文案分档用；形状只在模块内与 UI 的 data-tone 上用） */
type FortuneDiceTone = '凶' | '平' | '吉' | '大吉';

/**
 * 兑现口径。**判别的联合**——store 按 kind 分派落库动作，
 * 加一面 = 加一行数据 + （必要时）加一个分派分支。
 */
type FortuneDiceReward =
  | { kind: 'none' }
  | { kind: 'money'; amount: number } // 正负皆可；负值由 store 侧 clamp 到 0
  | { kind: 'material'; rarity: Rarity; copies: number }
  | { kind: 'card'; cardTier: CardTier } // 走既有卡池按档抽（fortune-draw.drawFortuneCard）
  | { kind: 'level'; steps: number }
  | { kind: 'affection'; amount: number } // 给好感最高的那位
  | { kind: 'reroll' } // 退还今日次数
  | { kind: 'dailyBuff'; key: string; label: string };

export interface FortuneDiceFace {
  /** 骰面点数（十面骰 1..10，每面独占一个数） */
  pip: number;
  /** 面名（= 天赋描述里那十个词，逐字一致） */
  id: string;
  tone: FortuneDiceTone;
  reward: FortuneDiceReward;
  /** 给玩家看的一行释义 */
  text: string;
}

/** 十面骰的面数（骰值区间 1..10） */
export const FORTUNE_DICE_PIPS = 10;

/** 账本 key（daily-ledger 的 dailyUses 用） */
export const FORTUNE_DICE_LEDGER_KEY = '好运之骰';

/** 当日增益 key */
export const DAILY_BUFF_COMBAT_CRIT = '刀刀暴击';
export const DAILY_BUFF_CRAFT_LUCK = '制卡顺利';

/** 「刀刀暴击」的战斗行动值倍率 */
export const COMBAT_CRIT_MULTIPLIER = 1.25;

/**
 * 十面表（按点数升序，**点数越大越好** —— 玩家一眼能读懂）。
 *
 * 数值口径是初稿（数值总表终审对象）：金钱量级对齐委托赏金 4~15G 的十倍档，
 * 素材给「稀有 ×3」，等级 +1，卡走星辉档（复用祭坛的抽卡内核）。
 */
export const FORTUNE_DICE_FACES: readonly FortuneDiceFace[] = [
  {
    pip: 1,
    id: '杂鱼杂鱼',
    tone: '凶',
    reward: { kind: 'money', amount: -50 },
    text: '底石嘲笑了你——损失 50 GC。',
  },
  {
    pip: 2,
    id: '谢谢惠顾',
    tone: '平',
    reward: { kind: 'none' },
    text: '什么也没发生。命运今天没空理你。',
  },
  {
    pip: 3,
    id: '再来一次',
    tone: '吉',
    reward: { kind: 'reroll' },
    text: '底石让你再掷一次——今日次数不消耗。',
  },
  {
    pip: 4,
    id: '福缘天降',
    tone: '吉',
    reward: { kind: 'money', amount: 150 },
    text: '意外的进项：+150 GC。',
  },
  {
    pip: 5,
    id: '制卡顺利',
    tone: '吉',
    reward: {
      kind: 'dailyBuff',
      key: DAILY_BUFF_CRAFT_LUCK,
      label: '当日制卡评级上浮一档',
    },
    text: '手感极佳——今日制卡的评级整体上浮一档。',
  },
  {
    pip: 6,
    id: '红鸾天喜',
    tone: '吉',
    reward: { kind: 'affection', amount: 5 },
    text: '与羁绊最深的那位心意更近一步：好感 +5。',
  },
  {
    pip: 7,
    id: '材料秘境',
    tone: '吉',
    reward: { kind: 'material', rarity: '稀有', copies: 3 },
    text: '循着骰点找到一处材料秘境：稀有素材 ×3。',
  },
  {
    pip: 8,
    id: '刀刀暴击',
    tone: '吉',
    reward: {
      kind: 'dailyBuff',
      key: DAILY_BUFF_COMBAT_CRIT,
      label: '当日战斗行动值 +25%',
    },
    text: '手气烫得发烫——今日战斗行动值 +25%。',
  },
  {
    pip: 9,
    id: '提升一级',
    tone: '大吉',
    reward: { kind: 'level', steps: 1 },
    text: '境界松动：等级 +1。',
  },
  {
    pip: 10,
    id: '屠龙宝刀',
    tone: '大吉',
    reward: { kind: 'card', cardTier: '星辉' },
    text: '底石把压箱底的东西给了你：星辉档卡牌一张。',
  },
];

/**
 * 骰值 → 面（纯函数）。
 *
 * 骰值先夹到 1..10（脏值安全），再按点数取面——表是完整十面，
 * 所以「找不到」在数学上不可能；真找不到时回落到第 1 面（防御性，不抛）。
 */
export function rollFortuneDie(d10: number): FortuneDiceFace {
  const pip = Number.isFinite(d10) ? Math.min(FORTUNE_DICE_PIPS, Math.max(1, Math.floor(d10))) : 1;
  return FORTUNE_DICE_FACES.find((f) => f.pip === pip) ?? FORTUNE_DICE_FACES[0];
}

/** 该面是否「该退次数」（再来一次）——store 侧据此决定是否写账本 */
export function isRerollFace(face: FortuneDiceFace): boolean {
  return face.reward.kind === 'reroll';
}
