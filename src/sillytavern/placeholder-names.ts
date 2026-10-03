/**
 * 引擎占位符名单 —— preset-loader 的 ST 宏剥离白名单唯一真源（2026-10-02 B-2）。
 *
 * 背景：preset 预处理管线（preprocessEntry 第 7 步）会剥离「非系统 {{...}}」，
 * 白名单原先是一份手写字面量——{{TALENT}}/{{CARD_DECK}}/{{MAP_CONTEXT}} 等后占位符
 * 时代新增的引擎占位符不在名单里，被当未知宏**静默剥掉**，引擎 resolver 永远收不到
 * （实测 story prompt 里 <天赋> 空壳、<卡组战备> 整块消失）。
 *
 * 本文件零依赖（preset-loader 与 placeholder-registry 互相引用会成环），
 * 由测试钉死「PLACEHOLDER_REGISTRY 的每个键都在名单里」——新增 resolver 忘记登记
 * 名单会立刻红，这类漂移不再可能静默复发。
 */

/** 引擎占位符名单（与 PLACEHOLDER_REGISTRY 键集一一对应；AGENT.* 由调用方另行正则放行） */
export const ENGINE_PLACEHOLDER_NAMES: readonly string[] = [
  'SYS_PROMPT',
  'LORE_BOOK',
  'LORE_BOOK_STATIC',
  'LORE_BOOK_DYNAMIC',
  'NARRATIVE',
  'USER_INPUT',
  'CHARACTER_STATE',
  'INVENTORY',
  'SKILL_STATE',
  'QUEST_STATE',
  'GAME_TIME',
  'MAP_CONTEXT',
  'RANDOM_EVENTS',
  'COMMISSIONS',
  'TALENT',
  'CARD_DECK',
  'OPTION_POLICY',
  'NARRATIVE_INTENTS',
  'RECENT_COMBAT',
  'ACTIVE_EFFECTS',
  'MEMORY_ENTRIES',
  'PLOT_EVENTS',
  'PLOT_THREAD_TURN',
  'PLOT_THREAD_SURFACE',
  'IMAGE_REQUEST',
  'CRAFT_REQUEST',
  'CHAR_DETECT',
  'ITEM_REQUEST',
  'COMBAT_BRIEF',
  'COMBAT_ROSTER',
  'CHAR_GEN_RESULT',
  'CRAFT_RESULT',
];

/** ST 宏剥离的「系统占位符」判定：名单内放行，AGENT.* 放行，其余剥离 */
export function isEnginePlaceholder(token: string): boolean {
  if (ENGINE_PLACEHOLDER_NAMES.includes(token)) return true;
  return /^AGENT\.\w+$/.test(token);
}
