/**
 * skirmish.ts — 交锋拍制战斗内核（卡牌工坊 战斗形态改版）
 *
 * 世界观：战斗 = 最多 3 个「交锋拍」。敌方每拍亮出**预提交**的意图（招式/威胁/反制
 * 标签），玩家打出一张卡或选基础应对（强攻/防御/闪避）反制，Code 秒算双方 HP 变动
 * 并追加审计行；终局按参考公式链结算经验，参战卡分得 50% 卡牌经验，满管转卡面
 * 战力 +1 清空重攒。设计：docs/planning/2026-09-13-card-workshop-playable-loop-design.md §8。
 *
 * 确定性契约（对齐 unsealing / deck-power 同款铁律）：
 * - 零 Math.random / 零时钟：d20 一律由调用方传入（战斗内从骰带通道 draw 取得，
 *   天然落进既有回放体系）。
 * - 纯函数：不 mutate 入参；只返回**数据**与审计行，HP 落地由调用方提交。
 * - AI 预提交数据不可信：coerceIntents 夹逼 + 白名单过滤（SupplyUnit 信任模型同构），
 *   坏定义静默降级，绝不让一次拼写失误炸掉整场战斗。
 * - 卡牌经验字段对旧存档可选（cardAlbum? 先例）：缺字段按 0 经验 / 0 战力加成兜底。
 */

import type { CardTier } from '../field-enums';

// ========== 数值表（单一真源，数值总表终审对象） ==========

/**
 * 敌方预提交招式序列的上限（主人裁定 2026-09-13：不设拍数上限——战斗打到一方
 * HP 清空或玩家主动结束为止）。序列打完按原序**轮换**，公平性不破：剧本开战锁死。
 */
export const MAX_INTENTS = 6;

/** 数值碾压速胜判据：我方战力 ≥ 敌方战力 × 2 → 跳过交锋直接碾压结算 */
export const CRUSH_RATIO = 2;

/** 战斗评价倍率（S = 全拍反制且几乎无伤；C = 撤退） */
export const GRADE_MULTIPLIER: Record<SkirmishGrade, number> = {
  S: 2.0,
  A: 1.5,
  B: 1.0,
  C: 0.5,
};

/** 基础经验系数：基础经验 = 10 × 敌方等级（TL），参考公式链锚点 */
export const EXP_PER_ENEMY_LEVEL = 10;

/** 等级差修正夹逼区间：max(0.2, min(2, 1 + (TL − PL) × 0.1)) */
export const LEVEL_MULT_MIN = 0.2;
export const LEVEL_MULT_MAX = 2;

/** 参战卡分得玩家战斗总经验的比例 */
export const CARD_EXP_SHARE = 0.5;

/** 卡牌经验上限（随品质翻倍）；满管 → 卡面战力 +1、清空重攒（主人裁定 A） */
export const CARD_EXP_CAP: Record<CardTier, number> = {
  白铁: 200,
  青铜: 400,
  白银: 800,
  鎏金: 1600,
  星辉: 3200,
};

// ========== 类型 ==========

/** 反制标签：敌方招式声明「能被什么反制」；基础应对天然携带同名标签，卡的标签来自词条编译表 */
export type CounterTag = '强攻' | '防御' | '闪避' | '打断';

export const COUNTER_TAGS: readonly CounterTag[] = ['强攻', '防御', '闪避', '打断'];

/** 基础应对三选项（主人裁定固定），出卡是增强通道不是门槛 */
export type BasicCounter = '强攻' | '防御' | '闪避';

export const BASIC_COUNTERS: readonly BasicCounter[] = ['强攻', '防御', '闪避'];

/** 玩家反制输入（UI/聊天解析 → 会话的统一形状；行动值/标签装配在集成层） */
export type SkirmishChoice =
  | {
      kind: '卡';
      name: string;
      /** 出卡宣言：这张牌用来做什么（纯叙事素材，进战报供终局记叙参考；数值照常结算） */ intent?: string;
      /** 行为合同（SSS 律师函警告）：本拍附加的禁条选择；需持有「合同」条目 */
      contractForbidden?: CounterTag;
    }
  | {
      kind: '应对';
      move: BasicCounter;
      /** 应对宣言（2026-09-25 主人裁定：与出卡宣言同权）——这一下用来做什么 */
      intent?: string;
    };

/** 敌方拍内意图（AI 战前预提交、Code 夹逼校验后的可信形状） */
export interface EnemyIntent {
  /** 招式名（叙事用，不参与计算） */
  move: string;
  /** 威胁值：反制掷骰的目标 DC；反制失败时也是对玩家的伤害基数 */
  threat: number;
  /** 玩家行动携带任一标签 → 吃克制加成 */
  counters: CounterTag[];
  /** 敌方本拍行动钩子（演绎用，可缺省） */
  hook?: string;
}

/** 玩家的一拍反制行动（label 进审计行；power/tags 由调用方装配：出卡 = 攻+战力加成+词条标签，应对 = 派生值+同名标签） */
export interface SkirmishAction {
  /** 审计显示名，如「打出 燎原符卡（攻44+卡6）」或「防御」 */
  label: string;
  power: number;
  tags: readonly CounterTag[];
  /** 出卡反制时的卡名（逻辑键）；基础应对缺省。会话账本据此记参战卡（卡牌经验分成对象） */
  cardName?: string;
  /** 出卡宣言（主人裁定 2026-09-13：玩家写这张牌用来做什么，纯叙事素材）——会话账本在拍审计前记一行「意图」 */
  note?: string;
}

export type SkirmishGrade = 'S' | 'A' | 'B' | 'C';

export interface BeatInput {
  intent: EnemyIntent;
  action: SkirmishAction;
  playerHp: number;
  enemyHp: number;
  /** 派生防御：反制失败时的减伤（威胁 − ⌊防御/2⌋，下限 1） */
  guard: number;
  /** d20，调用方从骰带通道取得；越界夹逼 1..20 */
  dice: number;
}

export interface BeatResult {
  countered: boolean;
  dice: number;
  /** 克制加成（命中意图标签 → ⌈威胁/2⌉，否则 0） */
  counterBonus: number;
  /** 反制掷骰合计 = d20 + 行动值 + 克制加成 */
  roll: number;
  /** roll − 威胁：正 = 余量（碾压伤），负 = 差距 */
  margin: number;
  enemyDamage: number;
  playerDamage: number;
  /** 结算后 HP（clamp 到 0，致死判定由调用方做） */
  playerHp: number;
  enemyHp: number;
  /** 审计行（战报卡逐拍追加，格式被测试钉死） */
  audit: string[];
}

/** 战斗经验结算审计链（参考截图公式，数值逐项可复算） */
export interface ExpAudit {
  /** 敌方等级 TL */
  enemyLevel: number;
  playerLevel: number;
  grade: SkirmishGrade;
  /** 基础经验 = 10 × TL */
  base: number;
  /** 等级差修正 = max(0.2, min(2, 1 + (TL − PL) × 0.1)) */
  levelMult: number;
  gradeMult: number;
  /** 天赋经验倍率（鸿蒙道体 ×2 / 千秋证果 ×5；无天赋 = 1） */
  talentMult: number;
  /** 总战斗经验 = round(基础 × 等级差修正 × 评价倍率 × 天赋倍率) */
  total: number;
}

/** 卡牌经验入参（对旧存档可选字段宽容） */
export interface CardExpSpec {
  cardTier: CardTier;
  cardExp?: number;
  cardPowerBonus?: number;
}

export interface CardExpResult {
  /** 结算后卡牌经验（可能溢出进下一管） */
  cardExp: number;
  /** 结算后累计战力加成 */
  cardPowerBonus: number;
  /** 本次满管次数（每次 = 卡面战力 +1） */
  powerUps: number;
}

// ========== 敌方意图预提交校验 ==========

const clampInt = (n: number, lo: number, hi: number): number =>
  Math.min(Math.max(Math.round(n), lo), hi);

/**
 * AI 预提交招式序列夹逼：非数组 → 空序列；条数截到 maxIntents；威胁夹逼 1..99 取整；
 * 反制标签过滤白名单并去重，滤空后兜底 ['防御']（任何招式都必须可反制）；
 * 招式名/钩子非字符串丢弃。坏数据静默降级，不抛。
 */
export function coerceIntents(raw: unknown, maxIntents = MAX_INTENTS): EnemyIntent[] {
  if (!Array.isArray(raw)) return [];
  const intents: EnemyIntent[] = [];
  for (const item of raw.slice(0, Math.max(1, maxIntents))) {
    if (item === null || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const threat =
      typeof obj.threat === 'number' && Number.isFinite(obj.threat)
        ? clampInt(obj.threat, 1, 99)
        : 1;
    const counters = Array.isArray(obj.counters)
      ? [
          ...new Set(
            obj.counters.filter((t): t is CounterTag => COUNTER_TAGS.includes(t as CounterTag)),
          ),
        ]
      : [];
    intents.push({
      move: typeof obj.move === 'string' ? obj.move : '未知招式',
      threat,
      counters: counters.length > 0 ? counters : ['防御'],
      ...(typeof obj.hook === 'string' ? { hook: obj.hook } : {}),
    });
  }
  return intents;
}

// ========== 拍结算 ==========

/** 克制加成：行动标签命中意图任一反制标签 → ⌈威胁/2⌉（读招打对的奖励） */
export function counterBonusOf(intent: EnemyIntent, tags: readonly CounterTag[]): number {
  const hit = intent.counters.some((t) => tags.includes(t));
  return hit ? Math.ceil(intent.threat / 2) : 0;
}

/**
 * 一拍结算（纯函数）：
 * - 反制掷骰 = d20 + 行动值 + 克制加成；≥ 威胁 = 反制成功（margin = roll − 威胁）
 * - 敌方伤害 = 行动值 +（反制成功再追加 margin 作碾压伤）
 * - 玩家伤害 = 反制成功 ? 0 : max(1, 威胁 − ⌊防御/2⌋)
 * - HP clamp 到 0；审计行逐项可复算
 */
export function resolveBeat(input: BeatInput): BeatResult {
  const threat = Number.isFinite(input.intent.threat) ? clampInt(input.intent.threat, 1, 99) : 1;
  const power = Number.isFinite(input.action.power)
    ? Math.max(0, Math.round(input.action.power))
    : 0;
  const dice = Number.isFinite(input.dice) ? clampInt(input.dice, 1, 20) : 1;
  const guard = Number.isFinite(input.guard) ? Math.max(0, Math.round(input.guard)) : 0;

  const bonus = counterBonusOf(input.intent, input.action.tags);
  const roll = dice + power + bonus;
  const margin = roll - threat;
  const countered = margin >= 0;

  const enemyDamage = power + (countered ? margin : 0);
  const playerDamage = countered ? 0 : Math.max(1, threat - Math.floor(guard / 2));
  const playerHp = Number.isFinite(input.playerHp) ? Math.max(0, Math.round(input.playerHp)) : 0;
  const enemyHp = Number.isFinite(input.enemyHp) ? Math.max(0, Math.round(input.enemyHp)) : 0;
  const afterPlayer = Math.max(0, playerHp - playerDamage);
  const afterEnemy = Math.max(0, enemyHp - enemyDamage);

  const audit = [
    `▸ ${input.action.label}：d20=${dice} + 行动值${power} + 克制+${bonus} = ${roll} vs 威胁${threat}` +
      (countered ? ` → 反制成功（余量${margin}）` : ` → 反制失败（差${-margin}）`),
    countered
      ? `▸ 敌方 HP ${enemyHp} → ${afterEnemy}（−${enemyDamage} = 行动值${power} + 碾压余量${margin}）`
      : `▸ 玩家 HP ${playerHp} → ${afterPlayer}（−${playerDamage} = 威胁${threat} − 防御减免${Math.floor(guard / 2)}）`,
    countered
      ? `▸ 玩家 HP ${playerHp} → ${afterPlayer}（无伤）`
      : `▸ 敌方 HP ${enemyHp} → ${afterEnemy}（−${enemyDamage} = 行动值${power}）`,
  ];

  return {
    countered,
    dice,
    counterBonus: bonus,
    roll,
    margin,
    enemyDamage,
    playerDamage,
    playerHp: afterPlayer,
    enemyHp: afterEnemy,
    audit,
  };
}

/** 数值碾压速胜：我方战力 ≥ 敌方战力 × CRUSH_RATIO → 跳过交锋拍直接碾压结算 */
export function judgeCrush(playerPower: number, enemyPower: number): boolean {
  const foe = Number.isFinite(enemyPower) ? Math.max(0, enemyPower) : 0;
  const mine = Number.isFinite(playerPower) ? Math.max(0, playerPower) : 0;
  return foe > 0 && mine >= foe * CRUSH_RATIO;
}

// ========== 终局评价与经验 ==========

/**
 * 战斗评价：C = 撤退/败北；碾压速胜 = S（评价封顶 S，跳拍不打折）；S = 全拍反制且
 * HP 损失 ≤25%；A = 胜利且 HP 损失 ≤50%；其余 B。
 * hpLossRatio 由调用方算好传入（受伤 / 最大HP，0..1，越界夹逼）。
 */
export function gradeBattle(input: {
  fled: boolean;
  crush?: boolean;
  defeated?: boolean;
  totalBeats: number;
  counteredBeats: number;
  hpLossRatio: number;
}): SkirmishGrade {
  if (input.fled || input.defeated) return 'C';
  if (input.crush) return 'S';
  const ratio = Number.isFinite(input.hpLossRatio)
    ? Math.min(Math.max(input.hpLossRatio, 0), 1)
    : 1;
  if (input.counteredBeats >= input.totalBeats && input.totalBeats > 0 && ratio <= 0.25) return 'S';
  if (ratio <= 0.5) return 'A';
  return 'B';
}

const fmtMult = (n: number): string => {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

/** 战斗经验公式链（参考截图锚点：TL12 vs PL9、S 级 → 312 EXP） */
export function battleExpChain(
  enemyLevel: number,
  playerLevel: number,
  grade: SkirmishGrade,
  talentMult = 1,
): ExpAudit {
  const tl = Number.isFinite(enemyLevel) ? Math.max(1, Math.round(enemyLevel)) : 1;
  const pl = Number.isFinite(playerLevel) ? Math.max(1, Math.round(playerLevel)) : 1;
  const base = EXP_PER_ENEMY_LEVEL * tl;
  const levelMult = Math.max(LEVEL_MULT_MIN, Math.min(LEVEL_MULT_MAX, 1 + (tl - pl) * 0.1));
  const gradeMult = GRADE_MULTIPLIER[grade] ?? GRADE_MULTIPLIER.B;
  const mult =
    typeof talentMult === 'number' && Number.isFinite(talentMult) && talentMult > 0
      ? talentMult
      : 1;
  const total = Math.round(base * levelMult * gradeMult * mult);
  return {
    enemyLevel: tl,
    playerLevel: pl,
    grade,
    base,
    levelMult,
    gradeMult,
    talentMult: mult,
    total,
  };
}

/** 经验审计行（战报卡终局区，格式被测试钉死；天赋倍率 ≠1 时多一行） */
export function formatExpAudit(a: ExpAudit): string[] {
  const lines = [
    `▸ 基础经验 = ${EXP_PER_ENEMY_LEVEL} × 敌方等级${a.enemyLevel} = ${a.base}`,
    `▸ 等级差修正 = max(${LEVEL_MULT_MIN}, min(${LEVEL_MULT_MAX}, 1+(${a.enemyLevel}−${a.playerLevel})×0.1)) = ×${fmtMult(a.levelMult)}`,
    `▸ 战斗评价 ${a.grade} 级 → ×${fmtMult(a.gradeMult)}`,
  ];
  if (a.talentMult !== 1) lines.push(`▸ 天赋经验倍率 → ×${fmtMult(a.talentMult)}`);
  lines.push(`▸ 战斗经验 = ${a.total} EXP`);
  return lines;
}

// ========== 卡牌经验（参战卡 50% 分成，满管 → 战力 +1 清空重攒） ==========

/** 参战卡分得的卡牌经验 = round(玩家战斗总经验 × 50%) */
export function cardExpGain(playerBattleExp: number): number {
  const exp = Number.isFinite(playerBattleExp) ? Math.max(0, Math.round(playerBattleExp)) : 0;
  return Math.round(exp * CARD_EXP_SHARE);
}

/**
 * 卡牌经验入账：溢出循环结算——每攒满一管 → 卡面战力 +1、余量进下一管
 * （一次巨量经验可以连升多次，永不丢经验）。未知品质按白铁管容兜底。
 */
export function applyCardExp(spec: CardExpSpec, gain: number): CardExpResult {
  return growCardByRawExp(spec, cardExpGain(gain));
}

/**
 * 卡牌经验入账（**无战斗分成**，原样入账）——吞噬/其他非战斗成长通道用。
 *
 * 与 `applyCardExp` 的差别只在于**不乘 `CARD_EXP_SHARE`**：交锋分成是「参战卡分得
 * 玩家战斗经验的 50%」这条交战规则，而吞噬是直接吃进燃料的全部经验，不该再打 5 折。
 * 满管溢出循环（卡牌经验 → 战力）是两者的共同内核，只有这一份实现。
 */
export function growCardByRawExp(spec: CardExpSpec, rawExp: number): CardExpResult {
  const cap = CARD_EXP_CAP[spec.cardTier] ?? CARD_EXP_CAP['白铁'];
  let exp = Number.isFinite(spec.cardExp) ? Math.max(0, Math.round(spec.cardExp as number)) : 0;
  let bonus = Number.isFinite(spec.cardPowerBonus)
    ? Math.max(0, Math.round(spec.cardPowerBonus as number))
    : 0;
  exp += Number.isFinite(rawExp) ? Math.max(0, Math.round(rawExp)) : 0;
  let powerUps = 0;
  while (exp >= cap) {
    exp -= cap;
    bonus += 1;
    powerUps += 1;
  }
  return { cardExp: exp, cardPowerBonus: bonus, powerUps };
}
