/**
 * option-policy.ts — 行动选项生成方案的**纯函数叶**（2026-09-23 共识稿实施）
 *
 * 装什么：内置方案表（不生成/标准三选/情绪流/成人向）、方案解析（id → 方案，
 * 未知回落标准）、{{OPTION_POLICY}} 占位符的正文渲染（格式底线恒拼接 +
 * {{user}} 替换玩家名）、off 档的解析兜底过滤。
 * 不装什么：任何 I/O、任何 Vue、任何 store。方案库的持久化（settings）与
 * 当前选择的持久化（worldFlags）在 settings-store / game-store。
 *
 * 设计要点（共识稿）：
 * - 方案 = **纯指令文本**，AI 直读；结构化参数会框死「性场景细则」这类领域表达。
 * - 格式底线（<option> 单块、每行一项、可解析）由引擎**恒拼接**——方案文本只管
 *   内容风格，作者漏写格式解析也不会崩。
 * - off 档不是「不注入」而是「明确禁止」：模型按旧习惯输出时，解析层兜底丢弃
 *   （filterOptionsForScheme，消费点在 game-pipeline.handleAgentResult）。
 */

/** 一个行动选项生成方案（内置与自定义同形状） */
export interface OptionScheme {
  id: string;
  name: string;
  /** 注入给 story AI 的指令正文（支持 {{user}} 占位，渲染时替换为玩家名） */
  instruction: string;
  builtin: boolean;
}

/** 当前不生成行动选项（玩家自主关闭） */
export const OPTION_SCHEME_OFF_ID = 'off';
/** 缺省方案 = 升级前现状（旧存档无选择记录时回落到它，行为不变） */
export const OPTION_SCHEME_STANDARD_ID = 'standard';

const OFF_INSTRUCTION = '';

const STANDARD_INSTRUCTION = [
  '给 3 项（至少 2 项），纯文本、不编号、不加解释、不写后果预告。',
  '三项要真的不同：一项推进当前目标，一项换个角度试探，一项承担风险；',
  '不要给出主角此刻做不到的选项。',
].join('');

const EMOTIVE_INSTRUCTION = [
  '在剧情结束后给出 3 个符合以下要求的行动选项：',
  '- 紧密衔接前文剧情，选项需自然合理，推动后续剧情。',
  '- 选项应简洁、细节精炼，引导不同走向。',
  '- 风格多样化，贴合当前剧情的创意风格。',
  '- 避免重复动作/语言/事件。',
  '- 可加入 {{user}} 的语言。',
  '- 选项前加 emoji（如 😏😈🥺😂🥵 等）表达 {{user}} 意图/情绪。',
  '- 最多包含一个负面/强制性选项。',
  '- 每个选项用合适的颜色包裹于 <font color=""> 标签中。',
].join('\n');

const ADULT_INSTRUCTION = [
  '在剧情结束后给出 3 个符合以下要求的行动选项：',
  '- 紧密衔接前文剧情，选项需自然合理，推动后续剧情。',
  '- 选项应简洁、细节精炼，引导不同走向。',
  '- 风格多样化，贴合当前剧情的创意风格。比如在性场景中可包含：温柔、主动、被动、',
  '  玩闹、利用环境、轻度支配、情趣玩法、高潮冲刺等。',
  '- 避免重复动作/语言/事件。',
  '- 可加入 {{user}} 的语言。',
  '- 选项前加 emoji（如 😏😈🥺😂🥵 等）表达 {{user}} 意图/情绪。',
  '- 最多包含一个负面/强制性选项。',
  '- 每个选项用合适的颜色包裹于 <font color=""> 标签中。',
].join('\n');

/** 内置方案（顺序即 UI 展示顺序；自定义方案追加在内置之后） */
export const BUILTIN_OPTION_SCHEMES: readonly OptionScheme[] = [
  { id: OPTION_SCHEME_OFF_ID, name: '不生成选项', instruction: OFF_INSTRUCTION, builtin: true },
  { id: OPTION_SCHEME_STANDARD_ID, name: '标准三选', instruction: STANDARD_INSTRUCTION, builtin: true },
  { id: 'emotive', name: '情绪流', instruction: EMOTIVE_INSTRUCTION, builtin: true },
  { id: 'adult', name: '成人向', instruction: ADULT_INSTRUCTION, builtin: true },
];

/**
 * 方案解析：id 命中内置或自定义库即返回；未记录（旧存档）/未知 id → 标准三选。
 * 🔴 回落目标是「标准」而非「off」——升级兼容：老存档行为与改造前完全一致。
 */
export function resolveOptionScheme(
  schemeId: string | undefined,
  customSchemes: readonly OptionScheme[] | undefined,
): OptionScheme {
  if (schemeId) {
    const custom = (customSchemes ?? []).find((s) => s.id === schemeId);
    if (custom) return custom;
    const builtin = BUILTIN_OPTION_SCHEMES.find((s) => s.id === schemeId);
    if (builtin) return builtin;
  }
  return BUILTIN_OPTION_SCHEMES[1];
}

/**
 * {{OPTION_POLICY}} 正文渲染。
 *
 * off 档渲染**明确禁止**指令（而不是静默不注入）——静态预设的格式示例里仍保留着
 * <option> 骨架，禁令必须显式压过它；解析层兜底（filterOptionsForScheme）双保险。
 */
export function renderOptionPolicy(scheme: OptionScheme, playerName: string): string {
  if (scheme.id === OPTION_SCHEME_OFF_ID) {
    return [
      '本轮【不要】输出 <option> 块：不替玩家列举行动方案，也不输出任何选项行；',
      '正文照常以一个尚未解决的瞬间收尾。下面的格式示例中 <option> 一段本轮不适用。',
    ].join('\n');
  }
  const instruction = scheme.instruction.replace(/\{\{user\}\}/gi, playerName || '你');
  return [
    '【行动选项】本轮按以下要求在 <option> 块内给出行动选项。',
    '格式底线（必须遵守，否则无法解析）：<option> 只写一个块，写在 maintext 之后、sum 之前；',
    '块内每行一个选项，不写编号前缀之外的多余记号。',
    '内容要求：',
    instruction,
  ].join('\n');
}

/**
 * off 档解析兜底：模型惯性输出了 <option> 时整批丢弃（消费点 handleAgentResult）。
 * 非 off 档原样返回（同一引用，零开销）。
 */
export function filterOptionsForScheme(
  options: readonly string[],
  scheme: OptionScheme,
): readonly string[] {
  if (scheme.id === OPTION_SCHEME_OFF_ID) return [];
  return options;
}
