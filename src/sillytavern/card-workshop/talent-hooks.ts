/**
 * talent-hooks.ts — 规则层天赋专属钩子（天赋系统 T-S2 路线图实装）
 *
 * 规则层大天赋（SSS/SS）改变的是游戏规则而非加几个点，每条需要专属 Code 路径。
 * 本模块把**可确定性结算**的规则效果集中注册，由 pipeline 在对应时机调用；
 * 纯叙事规则（作者/第四面墙/GM权限等）不在此处——它们由 {{TALENT}} 注入
 * 交给 AI 演绎，数值面无影响。
 *
 * 确定性契约：纯函数、不 mutate、骰值调用方传入。
 */

/** 钩子效果种类 */
export type RuleHookKind =
  | 'expMultiplier' // 经验获取倍率（鸿蒙道体 ×2）
  | 'hpMultiplier' // HP 上限倍率（霸巨人体魄/霜巨人体魄 ×3）
  | 'companionLimitOverride' // 伙伴卡数量上限覆写（最终兵器=1，女王气场=1）
  | 'statMultiplier' // 全属性倍率（女王气场 +50%）
  | 'oncePerBattleNuke' // 每战一次大威力攻击（倒也可斩）
  | 'dailyNuke' // 每日一次极限一击（一拳超人系统）
  | 'defeatExpMultiplier' // 战败经验倍率（败北强化）
  | 'victoryMaterial' // 胜利时额外素材掉落（素材之王）
  | 'defeatRewardMultiplier'; // 战败奖励倍率（世界线的收束点）

/** 单条规则钩子的参数形状 */
export interface RuleHook {
  kind: RuleHookKind;
  /** 数值参数（含义随 kind 而定：倍率/百分比/固定值） */
  value: number;
}

/** 规则钩子查找表（key = 天赋名，与 TALENT_CATALOG 模板名一致） */
const RULE_HOOKS: Readonly<Record<string, RuleHook[]>> = {
  鸿蒙道体: [{ kind: 'expMultiplier', value: 2 }],
  霸巨人体魄: [{ kind: 'hpMultiplier', value: 3 }],
  霜巨人体魄: [{ kind: 'hpMultiplier', value: 3 }],
  女王领域: [{ kind: 'statMultiplier', value: 1.5 }],
  素材之王: [{ kind: 'victoryMaterial', value: 1 }],
  世界线的收束点: [{ kind: 'defeatRewardMultiplier', value: 1 }],
  倒也可斩: [{ kind: 'oncePerBattleNuke', value: 50 }],
  一拳超人系统: [{ kind: 'dailyNuke', value: 80 }],
  败北强化: [{ kind: 'defeatExpMultiplier', value: 2 }],
  千秋证果: [{ kind: 'statMultiplier', value: 1.5 }],
};

/** 该天赋名是否登记了规则钩子（`hasWorkingMechanic` 的名字钩子路径用） */
export function hasRuleHook(talentName: string | undefined): boolean {
  return !!talentName && Array.isArray(RULE_HOOKS[talentName]);
}

/** 收集玩家天赋列表中的全部规则钩子（去重同名天赋，但不同天赋同钩子可叠加） */
export function collectRuleHooks(talents: readonly { name: string }[] | undefined): RuleHook[] {
  const hooks: RuleHook[] = [];
  for (const t of talents ?? []) {
    const ruleHooks = RULE_HOOKS[t?.name ?? ''];
    if (ruleHooks) hooks.push(...ruleHooks);
  }
  return hooks;
}

/** 经验倍率（鸿蒙道体 = 2，否则 1） */
export function expMultiplierOf(hooks: readonly RuleHook[]): number {
  return hooks.find((h) => h.kind === 'expMultiplier')?.value ?? 1;
}

/** HP 上限倍率（霸巨/霜巨 = 3，否则 1） */
export function hpMultiplierOf(hooks: readonly RuleHook[]): number {
  return hooks.find((h) => h.kind === 'hpMultiplier')?.value ?? 1;
}

/** 全属性倍率（女王领域 = 1.5，否则 1） */
export function statMultiplierOf(hooks: readonly RuleHook[]): number {
  return hooks.find((h) => h.kind === 'statMultiplier')?.value ?? 1;
}

/** 是否有胜利素材钩子（素材之王） */
export function hasVictoryMaterial(hooks: readonly RuleHook[]): boolean {
  return hooks.some((h) => h.kind === 'victoryMaterial');
}

/** 是否有战败奖励钩子（世界线的收束点） */
export function hasDefeatReward(hooks: readonly RuleHook[]): boolean {
  return hooks.some((h) => h.kind === 'defeatRewardMultiplier');
}

/** 是否有每战一次的大招钩子（倒也可斩） */
export function hasOncePerBattleNuke(hooks: readonly RuleHook[]): boolean {
  return hooks.some((h) => h.kind === 'oncePerBattleNuke');
}

/**
 * 战败经验倍率（败北强化；只在 finished === '败北' 时由调用方取用）。
 * 「受到的凌辱越强加成越多」由叙事演绎——机械侧给一个固定倍率档。
 */
export function defeatExpMultiplierOf(hooks: readonly RuleHook[]): number {
  const v = hooks.find((h) => h.kind === 'defeatExpMultiplier')?.value;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;
}

/**
 * 每日一击的档位（一拳超人系统；0 = 无此钩子）。
 *
 * 与「倒也可斩」的区别在**限次口径**：倒也可斩每场一次（会话级 `nukeUsed`），
 * 一拳超人每天一次（跨战斗，走 daily-ledger 的 `worldFlags.dailyUses`）。
 */
export function dailyNukePercentOf(hooks: readonly RuleHook[]): number {
  const v = hooks.find((h) => h.kind === 'dailyNuke')?.value;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** 每日一击出手后的虚弱系数（24h 内行动值打折；主人裁定 2026-09-17） */
export const DAILY_NUKE_WEAKNESS = 0.5;

/**
 * 大招的抹除强度：按敌方当前 HP 的百分比（2026-09-17 参数化）。
 *
 * 钩子的 `value` 就是档位值——同一条「每战一次大招」机制，SSS 可以给 50%、
 * 更弱的档位给 30%，不必各写一个天赋名分支。
 */
export function nukePercentOf(hooks: readonly RuleHook[]): number {
  const v = hooks.find((h) => h.kind === 'oncePerBattleNuke')?.value;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 50;
}
