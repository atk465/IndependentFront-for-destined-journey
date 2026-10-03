/**
 * talent-rule-hooks.ts — 规则层天赋专属钩子（天赋系统 T-S2 路线图实装）
 *
 * 规则层大天赋改变的是游戏规则而非加几个点。本模块把**可在交锋拍确定性结算**的
 * 规则效果集中定义，由 pipeline 的 submitSkirmishCounter 在构建行动时调用。
 * 纯叙事规则（作者/第四面墙/GM权限等）不在此处——由 {{TALENT}} 注入交给 AI 演绎。
 *
 * 确定性契约：纯函数、不 mutate、不依赖 session 内部状态（由调用方传拍数/等级等）。
 */

/** 玩家规则层天赋名列表的宽松形状 */
export interface TalentNameLike {
  name?: string;
}

// ═══════════════════════════════════════════════════════════
// 倒也可斩
// ═══════════════════════════════════════════════════════════

/** 倒也可斩的裁定结果 */
export interface DaYeJaZhanResult {
  /** 命中 → 敌方受重创 + 玩家 90% HP/MP 代价 + 本拍敌方跳过 */
  ok: boolean;
  /** 敌方受到的固定重伤（当前敌方 HP 的 50%） */
  enemyDamagePercent: number;
  /** 玩家代价：当前 HP 与 MP 的 90% */
  hpCostPercent: number;
  mpCostPercent: number;
  /** 审计行 */
  lines: string[];
}

/**
 * 倒也可斩：每场限一次。说出"倒也可斩"后，传说大剑豪一刀斩敌方当前 HP 50% 重伤，
 * 敌方本拍跳过行动；玩家消耗当前 HP/MP 的 90%。
 * 纯函数——数值由调用方从 session 读取后传入。
 */
export function daYeJaZhan(enemyHp: number, playerHp: number, playerMp: number): DaYeJaZhanResult {
  const enemyDamage = Math.max(1, Math.round(enemyHp * 0.5));
  const hpCost = Math.max(1, Math.round(playerHp * 0.9));
  const mpCost = Math.max(0, Math.round(playerMp * 0.9));
  return {
    ok: true,
    enemyDamagePercent: 50,
    hpCostPercent: 90,
    mpCostPercent: 90,
    lines: [
      '▸ 【倒也可斩】——传说大剑豪一刀斩落！',
      `▸ 敌方 HP −${enemyDamage}（${enemyHp} → ${Math.max(0, enemyHp - enemyDamage)}），本拍跳过行动`,
      `▸ 代价：HP ${playerHp} → ${Math.max(0, playerHp - hpCost)}，MP −${mpCost}`,
    ],
  };
}

// ═══════════════════════════════════════════════════════════
// 以人为本 / 血伶人 / 卡牌之手 / 活体熔炉 —— 素材扩展
// ═══════════════════════════════════════════════════════════

/** 素材扩展类钩子：追加材料限定条目的允许类别 */
export interface MaterialExpansionHook {
  talentName: string;
  addClasses: readonly string[];
}

/** 规则层追加的素材类别（单一真源） */
export const RULE_MATERIAL_EXPANSIONS: readonly MaterialExpansionHook[] = [
  { talentName: '以人为本', addClasses: ['失能生命'] },
  { talentName: '血伶人', addClasses: ['活体'] },
  { talentName: '卡牌之手', addClasses: ['任何触碰物'] },
  { talentName: '活体熔炉', addClasses: ['野兽', '机械'] },
];

/**
 * 收集玩家规则天赋带来的额外材料类别。
 * 炼制链可用它扩充材料限定判据（让「失能生命」「活体」等非法常规来源变为合法）。
 */
export function collectMaterialExpansions(
  talents: readonly TalentNameLike[] | undefined,
): string[] {
  const classes: string[] = [];
  for (const t of talents ?? []) {
    for (const hook of RULE_MATERIAL_EXPANSIONS) {
      if (hook.talentName === t?.name) classes.push(...hook.addClasses);
    }
  }
  return [...new Set(classes)];
}
