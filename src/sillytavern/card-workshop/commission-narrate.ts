/**
 * commission-narrate.ts — 委托终点/获得瞬间的叙事拍（纯函数叶 + 依赖注入）
 *
 * 共识稿 #13 修订：仪式感来自「夺取/促成」的最后一拍——守护者倒下时卡从祭坛浮起、
 * 最后一枚符文亮起，卡面自己浮现——**不是颁授场景**（禁忌卡是违禁品，没有官方
 * 递锦盒这回事）。发放由 Code 保底，这里的叙事只是把那个瞬间写出来。
 *
 * 纯度约束：buildXxxMessages 纯函数；runXxx 走注入的 clientFactory（无工具调用）。
 * 失败由调用方兜底——发放永不被叙事阻塞。
 */

import type { ApiEndpoint } from '../types';

/** 终点叙事所需的内容（全部来自 Code 侧已定案的事实） */
export interface CommissionNarrateContent {
  /** 委托名 */
  commissionName: string;
  /** 委托描述（供叙事取材） */
  description: string;
  /** 终点型（谜题/强敌/场景制卡） */
  finaleType: '谜题' | '强敌' | '场景制卡';
  /** 终点目标（事件名/敌人名/目标卡名） */
  target: string;
  /** 获得的卡名（无卡奖励时为空串） */
  cardName: string;
  /** 所在中层名（场景的舞台） */
  midTierName: string;
}

export interface CommissionNarrateRequest extends CommissionNarrateContent {
  saveId: string;
  endpoint: ApiEndpoint;
}

export interface CommissionNarration {
  narrative: string;
}

export const COMMISSION_NARRATE_AGENT = 'card_craft_narrate';

/**
 * 组装叙事消息（纯函数）。硬约束与制卡叙事同源：**事实已定案**——委托已完成、
 * 卡已在手，AI 写的是那个瞬间，不是结果判定。
 */
export function buildCommissionNarrateMessages(
  req: CommissionNarrateContent,
): Array<{ role: string; content: string }> {
  const system = [
    '你是铭刻纪元的冒险记事官。一位冒险者刚刚在危险之地完成了一桩委托的最后一搏——',
    '**委托已完成、酬劳已到手**（在下面的「定案」里），你要写的是那个「到手」的瞬间：',
    '谜题解开的最后一步、强敌倒下时的余烬、或在临时祭坛上成卡的那一刻。',
    '',
    '硬性规则：',
    '1. **不得引入或更改任何事实**（委托名/卡名/地点），不得让委托未完成，不得新增人物。',
    '2. 这是「获得场景」不是「颁授场景」——没有人把奖励递给他，是那座危险的地方',
    '   自己把东西吐了出来。写手、写眼、写呼吸，不写旁白总结。',
    '3. 如果定案里有卡名，那一拍要落在卡上（浮起、成形、显影……任凭你的笔）；',
    '   没有卡名就落在终点本身上。',
    '4. 输出严格如下格式开头，不要多余的标题或 JSON：',
    '   <narrative>获得瞬间的叙事，180~300 字，第三人称</narrative>',
    '5. 用中文。',
  ].join('\n');

  const 定案 = [
    `委托：${req.commissionName}`,
    req.description ? `委托背景：${req.description}` : '',
    `终点方式：${req.finaleType}${req.target ? `（${req.target}）` : ''}`,
    `获得的卡：${req.cardName || '（无卡奖励——落在终点本身）'}`,
    `所在之地：${req.midTierName || '未名的危险之地'}`,
  ]
    .filter(Boolean)
    .join('\n');

  const user = `【定案】（不可更改）\n${定案}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** 从 AI 输出里解析叙事（纯函数；没按格式来就整段当叙事） */
export function parseCommissionNarration(raw: string): CommissionNarration {
  const text = String(raw ?? '').trim();
  if (!text) return { narrative: '' };
  const narrMatch = /<narrative>([\s\S]*?)<\/narrative>/i.exec(text);
  if (narrMatch) return { narrative: narrMatch[1].trim() };
  return { narrative: text };
}

/** 依赖注入（与 card-craft-narrate 同款形态） */
export interface CommissionNarrateDeps {
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

/** 调用一次终点叙事（无工具）。失败由调用方兜底——发放永不被叙事阻塞。 */
export async function runCommissionNarration(
  req: CommissionNarrateRequest,
  deps: CommissionNarrateDeps,
): Promise<CommissionNarration> {
  const client = deps.clientFactory(COMMISSION_NARRATE_AGENT, req.endpoint, req.saveId);
  const result = await client.chat({ messages: buildCommissionNarrateMessages(req) });
  if (result.error) {
    throw new Error(`终点叙事调用失败: ${result.error}`);
  }
  return parseCommissionNarration(result.output ?? result.rawResponse ?? '');
}
