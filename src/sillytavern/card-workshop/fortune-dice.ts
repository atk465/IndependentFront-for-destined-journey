/**
 * fortune-dice.ts — 每日骰（SS「好运之骰」十面 / S「命运之骰」六面）
 *
 * 设计裁定（主人 2026-09-17）：**骰面是数据，兑现是 Code**。每面自带兑现口径，
 * 全部由引擎落库，AI 只负责把结果写成一段像命运的话。理由：抽奖是本作唯一的
 * 纯随机入口，玩家会反复投——结果必须可复算、可审计，不能靠叙事手感。
 *
 * 两张表共用一套机制，只是**面数与强度不同**（同 `日掷` 条目种类，靠 `faces` 分派）：
 *  - 十面（好运之骰，SS）：奖励跨度大，顶层给星辉卡
 *  - 六面（命运之骰，S）：纯吉凶梯度，顶层给金钱
 *
 * 兑现分三类：
 *  - **即时发放**：金钱 / 素材 / 卡 / 等级 / 好感
 *  - **账本操作**：「再来一次」退还今日次数（不写账本）
 *  - **当日增益**：写 `worldFlags.dailyBuffs.<key>`，跨天自动失效
 *
 * 纯度约束：纯函数、不 mutate、**不掷骰**（骰值由调用方传入，与 skirmish 同铁律）。
 */

import type { CardTier, Rarity } from '../field-enums';

/** 骰面吉凶（内容侧配色/文案分档用） */
type FortuneDiceTone = '凶' | '平' | '吉' | '大吉';

/** 兑现口径（判别联合）——store 按 kind 分派落库动作，加一面 = 加一行数据 */
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
  /** 骰面点数（表内 1..面数，每面独占一个数） */
  pip: number;
  /** 面名 */
  id: string;
  tone: FortuneDiceTone;
  reward: FortuneDiceReward;
  /** 给玩家看的一行释义 */
  text: string;
}

/** 一张骰表 */
export interface FortuneDiceTable {
  /** 账本 key（= 天赋名，记账在面板上一眼认得） */
  key: string;
  /** 骰子名（面板标题用） */
  label: string;
  /** 面数（= faces 档位值；条目 `日掷{faces}` 靠它分派到本表） */
  faces: number;
  faceList: readonly FortuneDiceFace[];
}

/** 当日增益 key */
export const DAILY_BUFF_COMBAT_CRIT = '刀刀暴击';
export const DAILY_BUFF_CRAFT_LUCK = '制卡顺利';

/** 「刀刀暴击」的战斗行动值倍率 */
export const COMBAT_CRIT_MULTIPLIER = 1.25;

/** 十面表（好运之骰，SS）——按点数升序，**点数越大越好**（玩家一眼能读懂） */
const TEN_FACES: readonly FortuneDiceFace[] = [
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
    reward: { kind: 'dailyBuff', key: DAILY_BUFF_CRAFT_LUCK, label: '当日制卡评级上浮一档' },
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
    reward: { kind: 'dailyBuff', key: DAILY_BUFF_COMBAT_CRIT, label: '当日战斗行动值 +25%' },
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
 * 六面表（命运之骰，S）——纯吉凶梯度，不掷出实物。
 *
 * 与十面的差别就是**强度**：六面不给卡、不给等级，「诸事顺利」复用制卡顺利那条
 * 当日增益，顶层给金钱。两条天赋的分工因此清楚：好运之骰是彩票，命运之骰是每日宜忌。
 */
const SIX_FACES: readonly FortuneDiceFace[] = [
  {
    pip: 1,
    id: '天灾',
    tone: '凶',
    reward: { kind: 'money', amount: -80 },
    text: '祸从天降——损失 80 GC。',
  },
  {
    pip: 2,
    id: '倒霉透顶',
    tone: '凶',
    reward: { kind: 'money', amount: -30 },
    text: '诸事不顺——损失 30 GC。',
  },
  {
    pip: 3,
    id: '略有不顺',
    tone: '平',
    reward: { kind: 'none' },
    text: '有点小磕绊，但没伤到根本。',
  },
  {
    pip: 4,
    id: '略有好运',
    tone: '吉',
    reward: { kind: 'money', amount: 30 },
    text: '小小的顺遂：+30 GC。',
  },
  {
    pip: 5,
    id: '诸事顺利',
    tone: '吉',
    reward: { kind: 'dailyBuff', key: DAILY_BUFF_CRAFT_LUCK, label: '当日制卡评级上浮一档' },
    text: '今天做什么都顺手——今日制卡评级上浮一档。',
  },
  {
    pip: 6,
    id: '福缘天降',
    tone: '大吉',
    reward: { kind: 'money', amount: 200 },
    text: '福星高照：+200 GC。',
  },
];

/** 骰表登记表（按 faces 档位分派；加一张表 = 加一行数据） */
export const FORTUNE_DICE_TABLES: readonly FortuneDiceTable[] = [
  { key: '好运之骰', label: '好运之骰', faces: 10, faceList: TEN_FACES },
  { key: '命运之骰', label: '命运之骰', faces: 6, faceList: SIX_FACES },
];

/** 按账本 key 取表 */
export function diceTableOf(key: string): FortuneDiceTable | undefined {
  return FORTUNE_DICE_TABLES.find((t) => t.key === key);
}

/** 按面数取表（条目 `日掷{faces}` → 表） */
export function diceTableByFaces(faces: number): FortuneDiceTable | undefined {
  const n = Number.isFinite(faces) ? Math.round(faces) : 10;
  return FORTUNE_DICE_TABLES.find((t) => t.faces === n);
}

/**
 * 骰值 → 面（纯函数）。
 *
 * 骰值先夹到 1..面数（脏值安全）；表是完整的，理论上必然命中，
 * 真找不到时回落到第 1 面（防御性，不抛）。
 */
export function rollOnTable(table: FortuneDiceTable, d: number): FortuneDiceFace {
  const pip = Number.isFinite(d) ? Math.min(table.faces, Math.max(1, Math.floor(d))) : 1;
  return table.faceList.find((f) => f.pip === pip) ?? table.faceList[0];
}

/** 该面是否「该退次数」（再来一次）——store 侧据此决定是否写账本 */
export function isRerollFace(face: FortuneDiceFace): boolean {
  return face.reward.kind === 'reroll';
}
