/**
 * card-craft-narrate.ts — 制卡的叙事与命名（2026-09-17 第三档改造）
 *
 * 制卡主路（`card-craft-plan`）把档位/词条/造价/评级/消耗/经验**全部算完**之后，
 * 只剩两件事需要 AI：**给这张卡起名**、**把过程写成一段话**。
 *
 * 这就是这个模块的全部职责。它**没有工具**——不是"不鼓励用"，是没有可用的工具，
 * 所以不存在「AI 漏调结算工具导致免费制卡」这个失败面。系统提示里也明确：
 * 数值已定案，你不得引入或更改任何数字。
 *
 * 与 `runSkirmishChronicle` 同款形态（内联 system prompt，不依赖 agent 配置；
 * 未配置的 agent id 会落到默认 API 池）。
 *
 * 纯度：组装消息是纯函数；调用部分是薄封装，失败由调用方兜底（用 Code 侧临时名）。
 */

import type { ApiEndpoint } from './types';
import type { CardCraftPlan } from './card-workshop/card-craft-plan';

/**
 * 只做叙事与命名所需的**内容**（全部来自 Code 侧已定案的计划）。
 * 与请求分开，是为了让「组装消息」这件事不依赖 endpoint/saveId——
 * 测试与预览都能直接用内容层。
 */
export interface CardCraftNarrateContent {
  /** 产物临时名（Code 侧兜底名，AI 可另起） */
  provisionalName: string;
  /** 产物档位 */
  tier: string;
  /** 产物词条 */
  entries: readonly string[];
  /** 造价（GC） */
  cost: number;
  /** 评级 */
  rating: string;
  /** 融合类型（叠加/相生/相克） */
  fusionKind: string;
  /** 用到的素材 */
  materials: readonly string[];
  /** 被消耗的素材（失败时主材保住，这里能看出来） */
  consumed: readonly string[];
  /** 玩家写下「想做成什么样」——**叙事意图的唯一来源** */
  intent: string;
  /** 制作者称呼（战报/叙事里的指代） */
  crafterName?: string;
  /** 天赋审计行（让玩家看到天赋生效，AI 要顺着写） */
  talentNotes?: readonly string[];
}

/** 一次真实调用所需的一切 = 内容 + 落点 */
export interface CardCraftNarrateRequest extends CardCraftNarrateContent {
  saveId: string;
  endpoint: ApiEndpoint;
}

export interface CardCraftNarration {
  /** AI 起的卡名（失败时 undefined，调用方用临时名） */
  name?: string;
  /** AI 写的卡面描述（2026-09-25；失败时 undefined，调用方保留玩家意图原文） */
  description?: string;
  /** 过程叙事 */
  narrative: string;
}

export const CARD_CRAFT_NARRATE_AGENT = 'card_craft_narrate';

/**
 * 组装叙事消息（纯函数）。
 *
 * 关键约束写在提示里：**产物已定案**（档位/词条/造价/评级），AI 不得改数——
 * 这条不是客套，是这一档改造的全部意义所在。
 */
export function buildCraftNarrateMessages(req: CardCraftNarrateContent): Array<{
  role: string;
  content: string;
}> {
  const system = [
    '你是铭刻纪元的制卡记事官。一次制卡刚刚完成——**它的档位、词条、造价、评级',
    '全部已由工坊定案**（在下面的「定案」里），你要做的是把它写成一段有手感的过程叙事，',
    '并给这张卡起一个名字。',
    '',
    '硬性规则：',
    '1. **不得引入或更改任何数字**（档位/词条/造价/评级/经验），不得新增词条、不得改档位。',
    '   定案里写什么就是什么——你写的是过程，不是结果。',
    '2. 评级若是「失败」或「大失败」，叙事必须是**没做成**的样子（走岔了、火候过了、',
    '   材料废了），但不要写成灾难；失败品也在玩家手里。',
    '3. 必须顺着「制卡师想要的样子」来写——那是玩家亲口说的，是这次制卡的心气所在。',
    '4. 输出格式严格如下三行开头，不要多余的标题或 JSON：',
    '   <name>卡名（2~6 字，有铭刻纪元的风味，不要带引号）</name>',
    '   <desc>卡面描述（40~80 字，第三人称，写这张卡的样子、手感与来路；不写数值）</desc>',
    '   <narrative>过程叙事，200~350 字，第三人称，聚焦制作者的手与心</narrative>',
    '5. 用中文。',
  ].join('\n');

  const 定案 = [
    `产物临时名：${req.provisionalName}`,
    `档位：${req.tier}`,
    `词条：${req.entries.join('、') || '（无）'}`,
    `融合类型：${req.fusionKind}`,
    `造价：${req.cost} GC`,
    `评级：${req.rating}`,
    `素材：${req.materials.join('、')}`,
    `本次消耗：${req.consumed.join('、') || '（无）'}`,
  ];
  if (req.talentNotes && req.talentNotes.length > 0) {
    定案.push(`天赋介入：${req.talentNotes.join('；')}`);
  }

  const user = [
    `制作者：${req.crafterName ?? '冒险者'}`,
    `【定案】（不可更改）`,
    定案.join('\n'),
    `【制卡师想要的样子】`,
    req.intent.trim() || '（他没有说，只凭手感）',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** 从 AI 输出里解析卡名/卡面描述/叙事（纯函数；解析不出名字就只取叙事） */
export function parseCraftNarration(raw: string): CardCraftNarration {
  const text = String(raw ?? '').trim();
  if (!text) return { narrative: '' };
  const nameMatch = /<name>([\s\S]*?)<\/name>/i.exec(text);
  const descMatch = /<desc>([\s\S]*?)<\/desc>/i.exec(text);
  const narrMatch = /<narrative>([\s\S]*?)<\/narrative>/i.exec(text);
  const name = nameMatch?.[1]
    ?.trim()
    .replace(/^["'「『]|["'」』]$/g, '')
    .trim();
  const description = descMatch?.[1]?.trim() || undefined;
  if (narrMatch) {
    return {
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
      narrative: narrMatch[1].trim(),
    };
  }
  // 没按格式来：整段当叙事，名字与描述留空（调用方用临时名与意图原文兜底）
  return { narrative: text };
}

/** 依赖注入（与 skirmish-agent / craft-gen-chain 同款形态） */
export interface CardCraftNarrateDeps {
  clientFactory: (
    agentId: string,
    endpoint: ApiEndpoint,
    saveId: string,
  ) => {
    chat: (payload: { messages: Array<{ role: string; content: string }> }) => Promise<{
      output?: string;
      rawResponse?: string;
      error?: string;
    }>;
  };
}

/**
 * 调用一次叙事（**无工具**）。失败由调用方兜底——制卡本身已经完成，
 * 叙事只是锦上添花，不该因为一次 AI 调用失败而回滚玩家的产物。
 */
export async function runCardCraftNarration(
  req: CardCraftNarrateRequest,
  deps: CardCraftNarrateDeps,
): Promise<CardCraftNarration> {
  const client = deps.clientFactory(CARD_CRAFT_NARRATE_AGENT, req.endpoint, req.saveId);
  const result = await client.chat({ messages: buildCraftNarrateMessages(req) });
  if (result.error) {
    throw new Error(`制卡叙事调用失败: ${result.error}`);
  }
  return parseCraftNarration(result.output ?? result.rawResponse ?? '');
}

/** Code 侧兜底叙事（AI 不可用时用；不含任何数字，只说发生了什么） */
export function fallbackCraftNarration(plan: CardCraftPlan, materials: readonly string[]): string {
  const 成了 = plan.rating === '大失败' || plan.rating === '失败';
  return [
    `${materials.join('、')}在手里翻了几轮，${成了 ? '最后还是差了那一步' : '火候终于到了'}。`,
    `他没有多说什么，把做出来的东西收进了卡册。`,
  ].join('');
}

/**
 * 从「制卡师想要的样子」派生兜底卡名（2026-09-23 真机反馈）。
 *
 * 🔴 为什么要有：AI 命名不可用时，兜底名此前恒为「主素材·卡」——玩家写明
 * 「一根钓竿」，产出的却是「世界树嫩芽·卡」，与「AI 负责按意图起名」的制卡
 * 理念冲突。本函数做**保守**派生：只认清洗后 1~6 字的短意图（与 AI 命名提示
 * 「2~6 字」同带），长句、含糊话一律返回 undefined（调用方回落主素材名）。
 * 纯函数；真正的命名主路仍是 AI（本函数只是兜底变聪明，不是替代）。
 */
export function deriveFallbackProductName(intent: string | undefined): string | undefined {
  const raw = String(intent ?? '').trim();
  if (!raw) return undefined;
  // 引导词 / 量词壳：剥掉后剩下的才可能是「东西的名字」
  const LEAD_RE =
    /^(?:我想|我要|我想要|我打算|我想做|我要做|想要|想做|打算|准备|试试|尝试|给我|帮我|帮忙|来|做|造|弄|搞|制)+/;
  const QUANT_RE = /^(?:一根|一把|一张|一条|一个|一只|一件|一枚|一颗|一粒|副|些|个)+/;
  for (const clause of raw.split(/[，。！？；、,.!?;:\n\r]+/)) {
    const s = clause
      .trim()
      .replace(LEAD_RE, '')
      .replace(QUANT_RE, '')
      .replace(/(?:这张)?卡[片]?$/, '')
      .trim();
    if (!s) continue;
    // 含糊话不配当名字（哪怕够短）
    if (/随便|什么|啥|看看|玩玩/.test(s)) return undefined;
    // 只看第一个非空子句：清洗后超 6 字的长句不硬猜，交回调用方用主素材名
    if (s.length <= 6) return s;
    return undefined;
  }
  return undefined;
}
