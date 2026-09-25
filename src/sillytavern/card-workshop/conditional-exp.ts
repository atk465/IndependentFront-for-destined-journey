/**
 * conditional-exp.ts — 条件经验与气运（2026-09-17）
 *
 * 两条天赋让经验**变成有条件的东西**，所以集中在这里：
 *  - **宿敌**（S「宿敌认证系统」）：被一名强敌视为宿敌时激活。与宿敌战斗经验翻倍；
 *    战胜宿敌可夺取其气运（一次性），之后宿敌清空——这是一段有始有终的恩怨。
 *  - **打脸**（S「打脸升级系统」）：被嘲讽后打赢，拿海量经验与打脸点数；
 *    点数可在制卡台折成装备。
 *
 * 为什么「被嘲讽」是一个**标记**而不是自动判定：嘲讽发生在叙事里（AI 说有人
 * 瞧不起你），引擎无从判断。所以由叙事侧置标记，引擎只负责「标记生效期间打赢
 * 就兑现」。这和「环境由领域卡建立」是同一个思路：**把叙事事实落成一个可判定的标记**。
 *
 * 纯度约束：纯函数、不 mutate。
 */

/** 宿敌记录（worldFlags.nemesis） */
export interface NemesisState {
  /** 宿敌之名（= 战斗里的敌方名，逻辑键） */
  name: string;
  /** 结仇时的等级（展示与日后分档用） */
  level: number;
  /** 何时结的仇（gameDay，留个纪念） */
  since?: number;
}

/** 宽读：脏值一律当没有宿敌（绝不抛） */
export function coerceNemesis(raw: unknown): NemesisState | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { name, level, since } = raw as Partial<NemesisState>;
  if (typeof name !== 'string' || !name.trim()) return undefined;
  return {
    name: name.trim(),
    level: typeof level === 'number' && Number.isFinite(level) ? Math.max(1, Math.round(level)) : 1,
    ...(typeof since === 'number' && Number.isFinite(since) ? { since: Math.floor(since) } : {}),
  };
}

/** 这一战打的是不是宿敌 */
export function isNemesisBattle(nemesis: NemesisState | undefined, enemyName: string): boolean {
  if (!nemesis) return false;
  return nemesis.name === String(enemyName ?? '').trim();
}

/**
 * 该不该把这一场的敌人记为宿敌（纯函数）。
 *
 * 触发口径：**败给比自己强的敌人**——「被一名强大的敌人视为宿敌」在引擎里的
 * 可判定形态。打平或赢不算（赢家不会被当成宿敌）。
 */
export function shouldMarkNemesis(input: {
  finished: string | null;
  enemyLevel: number;
  playerLevel: number;
}): boolean {
  if (input.finished !== '败北') return false;
  const el = Number.isFinite(input.enemyLevel) ? Math.round(input.enemyLevel) : 1;
  const pl = Number.isFinite(input.playerLevel) ? Math.round(input.playerLevel) : 1;
  return el > pl;
}

/**
 * 战斗经验倍率（宿敌翻倍）。
 *
 * 只在与宿敌的战斗里生效；不持天赋 / 不是宿敌 → 1（零改动）。
 */
export function nemesisExpMultiplier(input: {
  holdsTalent: boolean;
  nemesis: NemesisState | undefined;
  enemyName: string;
  expMult: number;
}): { mult: number; note?: string } {
  if (!input.holdsTalent) return { mult: 1 };
  if (!isNemesisBattle(input.nemesis, input.enemyName)) return { mult: 1 };
  const mult = input.expMult > 0 ? input.expMult : 2;
  return {
    mult,
    note: `【宿敌认证】与【${input.nemesis!.name}】的又一次交锋——训练效率 ×${mult}`,
  };
}

// ════════════════════════════════════════════════════════════════════
// 打脸
// ════════════════════════════════════════════════════════════════════

/** 打脸点数的计数 key（worldFlags.counters） */
export const FACE_SLAP_KEY = '打脸点数';

/** 被嘲讽标记（worldFlags.taunted）；由叙事侧置入 */
export interface TauntMark {
  /** 谁嘲讽了你（展示用） */
  by: string;
  /** 哪一天（gameDay）——标记只在那一天有效，隔夜就淡了 */
  day: number;
}

/** 宽读嘲讽标记 */
export function coerceTaunt(raw: unknown): TauntMark | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { by, day } = raw as Partial<TauntMark>;
  if (typeof day !== 'number' || !Number.isFinite(day)) return undefined;
  return {
    by: typeof by === 'string' && by.trim() ? by.trim() : '有人',
    day: Math.floor(day),
  };
}

/** 嘲讽标记今天还生效吗（隔夜作废——「打了脸」这件事有时效） */
export function tauntActiveToday(mark: TauntMark | undefined, today: number): boolean {
  if (!mark) return false;
  return mark.day === Math.floor(today);
}

/**
 * 打赢后的打脸结算（纯函数）。
 *
 * 只有「被嘲讽标记当天 + 胜利/碾压」才兑现：额外经验 + 打脸点数。
 */
export function settleFaceSlap(input: {
  holdsTalent: boolean;
  mark: TauntMark | undefined;
  today: number;
  finished: string | null;
  expBonus: number;
  pointsPerWin: number;
}): { expBonus: number; points: number; note?: string } {
  if (!input.holdsTalent) return { expBonus: 0, points: 0 };
  if (!tauntActiveToday(input.mark, input.today)) return { expBonus: 0, points: 0 };
  if (input.finished !== '胜利' && input.finished !== '碾压') return { expBonus: 0, points: 0 };
  const points = Math.max(1, Math.round(input.pointsPerWin) || 1);
  const expBonus = Math.max(0, Math.round(input.expBonus) || 0);
  return {
    expBonus,
    points,
    note: `【打脸】${input.mark!.by} 今天看不起你——现在他们闭嘴了（经验 +${expBonus}，打脸点数 +${points}）`,
  };
}

/** 点数够不够兑换一件装备 */
export function canRedeemFaceSlap(points: number, cost: number): boolean {
  const need = Math.max(1, Math.round(cost) || 1);
  return Math.max(0, Math.floor(points) || 0) >= need;
}
