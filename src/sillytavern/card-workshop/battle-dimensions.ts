/**
 * battle-dimensions.ts — 战斗维度扩展（2026-09-17 立项，一次收掉六个缺口）
 *
 * 盘点（见 roadmap-backlog）：SSS/S/A/B 四个品级里，十几条天赋卡在**同一批缺失
 * 维度**上。本模块把六个维度一次性补齐，每个维度都是「**引擎有这个量了**」，
 * 天赋只是它的消费者。
 *
 * 六个维度与它们的落点：
 *
 * 1. **暴击**（critChance/critMult）——拍内核在行动值结算时掷第二颗骰判定。
 *    解锁：荒野镖客(A)、战场直觉(B)。
 * 2. **卡的血量**（companionHurtPct）——伙伴卡在战报里有个「伤势百分比」：
 *    打出时从 100% 起算，每拍受伤按在场敌方 dot 累积。是**会话级近似**，
 *    不是每张卡一条血条——引擎不为此新开存储。解锁：虐待狂化(A)、处刑者(B)、
 *    女王的威严(B)（「满血」近似为「伤势低」）。
 * 3. **多敌**（enemyCount）——一场交锋的敌方数量（评估 Agent 声明，缺省 1）。
 *    解锁：小人国的女王(A)、碾压快感(B)。
 * 4. **技能冷却**（beatCooldown）——打出技能卡后进入冷却拍数，期间不能再次打出
 *    同一张。会话账本记「卡名 → 冷却剩余拍数」。解锁：左轮轮盘赌(A)、快速咏唱(B)。
 * 5. **体型**（bodyScale）——角色的体型分级（1..5），玩家与敌人各一个值。
 *    评估 Agent 声明敌方体型，玩家体型从等级派生。解锁：体格差压制(B)。
 * 6. **负面状态**（playerAffliction）——玩家身上有负面状态（叙事侧置标，
 *    与「嘲讽标记」同款：把叙事事实落成可判定的标记）。解锁：宿醉狂暴(B)。
 *
 * 纯度约束：纯函数、不 mutate、**骰值由调用方传入**（与 skirmish 同铁律）。
 */

// ════════════════════════════════════════════════════════════════════
// 1. 暴击
// ════════════════════════════════════════════════════════════════════

/** 暴击参数（百分比） */
export interface CritSpec {
  /** 暴击几率（0..100） */
  chance: number;
  /** 暴击倍率（行动值 ×mult；缺省 1.5） */
  mult: number;
}

/** 空参数 = 没有暴击（零改动） */
export const NO_CRIT: CritSpec = { chance: 0, mult: 1 };

export type CritOutcome =
  { crit: false; power: number } | { crit: true; power: number; note: string };

/**
 * 暴击判定（纯函数）。
 *
 * @param power 原始行动值
 * @param d100 百分位骰（1..100，调用方传入）
 */
export function resolveCrit(power: number, spec: CritSpec, d100: number): CritOutcome {
  const base = Math.max(0, Math.round(power) || 0);
  const chance = Math.max(0, Math.min(100, Math.round(spec.chance) || 0));
  const roll = Math.max(1, Math.min(100, Math.floor(d100) || 1));
  if (chance <= 0 || roll > chance) return { crit: false, power: base };
  const mult = spec.mult > 0 ? spec.mult : 1.5;
  return {
    crit: true,
    power: Math.round(base * mult),
    note: `暴击！（d100=${roll} ≤ ${chance}%）行动值 ×${mult}`,
  };
}

// ════════════════════════════════════════════════════════════════════
// 2. 卡的伤势（会话级近似）
// ════════════════════════════════════════════════════════════════════

/**
 * 伙伴卡伤势百分比（0..100，100 = 无伤）。
 *
 * 近似口径：打出伙伴卡时它从满状态进场；**每拍按场上敌方 dot 总量掉伤势**
 * （敌人打过来的火力由在场伙伴分担）。这是会话级账，不落库——战斗结束清零。
 * 「满血」≈ 伤势 ≥ 90，「重伤」≈ 伤势 ≤ 30。
 */
export type CompanionWear = Record<string, number>;

const COMPANION_FULL = 100;

/** 伙伴卡进场（返回新表） */
export function companionEnters(table: CompanionWear | undefined, name: string): CompanionWear {
  return { ...(table ?? {}), [name]: COMPANION_FULL };
}

/** 每拍磨损（敌方 dot 总量 → 所有在场伙伴掉同量伤势；下限 0） */
export function companionsWear(
  table: CompanionWear | undefined,
  dotTotal: number,
  companionNames: readonly string[],
): CompanionWear {
  const next = { ...(table ?? {}) };
  const dmg = Math.max(0, Math.round(dotTotal));
  if (dmg <= 0) return next;
  for (const name of companionNames) {
    next[name] = Math.max(0, (next[name] ?? COMPANION_FULL) - dmg);
  }
  return next;
}

/** 伤势判定：满血（≥90） */
export function isFullHealth(table: CompanionWear | undefined, name: string): boolean {
  return (table?.[name] ?? COMPANION_FULL) >= 90;
}

/** 伤势判定：重伤（≤30） */
export function isCriticalHealth(table: CompanionWear | undefined, name: string): boolean {
  return (table?.[name] ?? COMPANION_FULL) <= 30;
}

/** 伙伴卡在场名单（从在场效果里挑 buff 型 = 伙伴助战） */
export function activeCompanions(effects: readonly { name: string; type: string }[]): string[] {
  return effects.filter((e) => e.type === 'buff').map((e) => e.name);
}

// ════════════════════════════════════════════════════════════════════
// 3. 多敌
// ════════════════════════════════════════════════════════════════════

/** 敌人数量（评估声明，缺省 1；夹逼 1..6——拍制按单敌结算，多敌是条件语境） */
export function coerceEnemyCount(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 1;
  return Math.max(1, Math.min(6, n));
}

/** 小人国的女王：面对**复数**个等级低于自己的敌人 → 全属性提升（数量越多越强） */
export function queenVersusMany(input: { enemyCount: number; allLowerLevel: boolean }): {
  percent: number;
  note?: string;
} {
  if (input.enemyCount < 2 || !input.allLowerLevel) return { percent: 0 };
  const percent = 10 + (Math.min(input.enemyCount, 6) - 2) * 5;
  return {
    percent,
    note: `【小人国的女王】面对 ${input.enemyCount} 个弱小的敌人——全属性 +${percent}%`,
  };
}

/** 碾压快感：范围技同时击杀多个敌人 → 叠愉悦 buff（攻击速度在拍制里落成行动值） */
export function massacreBuff(input: {
  enemyCount: number;
  killedThisBeat: boolean;
  ranged: boolean;
}): { amount: number; note?: string } {
  if (!input.killedThisBeat || input.enemyCount < 2 || !input.ranged) return { amount: 0 };
  // 叠层 = 敌人数；每层行动值 +3（初稿）
  const amount = Math.min(input.enemyCount, 6) * 3;
  return {
    amount,
    note: `【碾压快感】一扫而空——愉悦叠了 ${Math.min(input.enemyCount, 6)} 层（行动值 +${amount}）`,
  };
}

// ════════════════════════════════════════════════════════════════════
// 4. 技能冷却
// ════════════════════════════════════════════════════════════════════

/** 冷却账：卡名 → 剩余冷却拍数 */
export type Cooldowns = Record<string, number>;

/** 打出技能卡后进入冷却（返回新账；beatCooldown 缺省 0 = 无冷却） */
export function startCooldown(
  table: Cooldowns | undefined,
  cardName: string,
  beatCooldown: number,
): Cooldowns {
  const cd = Math.max(0, Math.round(beatCooldown) || 0);
  if (cd <= 0) return { ...(table ?? {}) };
  return { ...(table ?? {}), [cardName]: cd };
}

/** 每拍递减所有冷却（返回新账） */
export function tickCooldowns(table: Cooldowns | undefined): Cooldowns {
  const next: Cooldowns = {};
  for (const [name, left] of Object.entries(table ?? {})) {
    const v = Math.max(0, Math.round(left) - 1);
    if (v > 0) next[name] = v;
  }
  return next;
}

/** 这张卡是否还在冷却中 */
export function isOnCooldown(table: Cooldowns | undefined, cardName: string): boolean {
  return (table?.[cardName] ?? 0) > 0;
}

/** 快速咏唱：冷却与 MP 消耗减半后的值（纯函数） */
export function quickCastReduce(beatCooldown: number, mpCost: number): { cd: number; mp: number } {
  return {
    cd: Math.floor(Math.max(0, beatCooldown) / 2),
    mp: Math.ceil(Math.max(0, mpCost) / 2),
  };
}

// ════════════════════════════════════════════════════════════════════
// 5. 体型
// ════════════════════════════════════════════════════════════════════

/** 体型分级（1..5）：1 = 小巧 / 2 = 娇小 / 3 = 常人 / 4 = 巨躯 / 5 = 巨像 */
export const BODY_SCALES = ['小巧', '娇小', '常人', '巨躯', '巨像'] as const;
export type BodyScale = (typeof BODY_SCALES)[number];

/** 玩家体型（从等级派生：Lv1-8 常人 / 9-16 巨躯 / 17+ 巨像——初稿口径） */
export function playerBodyScale(level: number): BodyScale {
  const lv = Number.isFinite(level) ? Math.max(1, Math.round(level)) : 1;
  if (lv <= 8) return '常人';
  if (lv <= 16) return '巨躯';
  return '巨像';
}

/** 敌方体型（评估声明；未知按常人） */
export function coerceBodyScale(raw: unknown): BodyScale {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return (BODY_SCALES as readonly string[]).includes(s) ? (s as BodyScale) : '常人';
}

const SCALE_RANK: Record<BodyScale, number> = { 小巧: 1, 娇小: 2, 常人: 3, 巨躯: 4, 巨像: 5 };

/** 体格差压制：攻击体型**远小于**自己（差距 ≥ 2）的敌人 → 额外威压伤害 */
export function bodyScaleCrushBonus(
  attacker: BodyScale,
  defender: BodyScale,
  bonusPct: number,
): { percent: number; note?: string } {
  const gap = SCALE_RANK[attacker] - SCALE_RANK[defender];
  if (gap < 2) return { percent: 0 };
  const pct = Math.max(0, Math.round(bonusPct) || 0);
  if (pct <= 0) return { percent: 0 };
  return {
    percent: pct,
    note: `【体格差压制】${attacker} 对 ${defender}——行动值 +${pct}%`,
  };
}

// ════════════════════════════════════════════════════════════════════
// 6. 负面状态（玩家侧）
// ════════════════════════════════════════════════════════════════════

/** 玩家负面状态标记（worldFlags.playerAfflicted）——叙事侧置入，隔夜作废 */
export interface AfflictionMark {
  /** 状态名（中毒/醉酒…） */
  name: string;
  /** 哪一天（gameDay） */
  day: number;
}

/** 宽读 */
export function coerceAffliction(raw: unknown): AfflictionMark | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { name, day } = raw as Partial<AfflictionMark>;
  if (typeof day !== 'number' || !Number.isFinite(day)) return undefined;
  return {
    name: typeof name === 'string' && name.trim() ? name.trim() : '负面状态',
    day: Math.floor(day),
  };
}

/** 标记当天生效（隔夜作废） */
export function afflictionActiveToday(mark: AfflictionMark | undefined, today: number): boolean {
  if (!mark) return false;
  return mark.day === Math.floor(today);
}

/** 宿醉狂暴：负面状态生效期间 → 攻击大幅提升（×1.5），命中率轻微下降（行动值 −10%） */
export const HANGOVER_RAGE_MULT = 1.5;
export const HANGOVER_ACCURACY_PENALTY = 0.9;

/** 宿醉狂暴的净效果（纯函数；未处于负面状态 → 无效果） */
export function hangoverRage(
  mark: AfflictionMark | undefined,
  today: number,
  power: number,
): { power: number; note?: string } {
  if (!afflictionActiveToday(mark, today)) return { power };
  const boosted = Math.round(Math.max(0, power) * HANGOVER_RAGE_MULT * HANGOVER_ACCURACY_PENALTY);
  return {
    power: boosted,
    note: `【宿醉狂暴】痛觉被屏蔽——攻击 ×${HANGOVER_RAGE_MULT}，命中率 ×${HANGOVER_ACCURACY_PENALTY}`,
  };
}
