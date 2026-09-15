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
  倒也可斩: [{ kind: 'oncePerBattleNuke', value: 0 }],
};

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
