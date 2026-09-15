/**
 * talent-naming.ts — 融合产物起名（天赋系统 T-S3 增强，访谈 T8-② 裁定 B）
 *
 * 融合的数值骨架由 Code 化学反应算出；产物的**名字与表现描述**交给 AI——
 * 调用方把两条源天赋（名字/描述/条目摘要）与产物条目摘要交给模型，模型只做
 * 命名与文案，不产生任何数值（照战斗记叙同款「只演绎不算数」纪律）。
 *
 * 调用约定照 skirmish-agent：deps.clientFactory 缝 + 纯函数 build/parse 独立导出；
 * JSON 输出走 model-json 唯一入口。agentId='talent-naming'（无需注册表条目）。
 */

import type { ApiEndpoint } from '../types';
import { parseModelJson } from '../model-json';

export interface TalentNamingRequest {
  saveId: string;
  endpoint: ApiEndpoint;
  /** 两条源天赋的名字/描述/条目摘要 */
  sourceA: string;
  sourceB: string;
  /** 融合化学反应算出的产物条目摘要（逐条，数值已定案） */
  productEntryLines: readonly string[];
}

export interface TalentNamingResult {
  name: string;
  description: string;
}

/** 起名 system 提示词（纯函数，测试钉关键约束） */
export function buildNamingMessages(req: TalentNamingRequest): Array<{
  role: string;
  content: string;
}> {
  const system = [
    '你是卡兰大陆的天赋命名者。两份天赋正在融合，产物的骨架条目已经由法则确定。',
    '为这个新天赋起一个名字，并写一句表现描述。',
    '硬性规则：',
    '1. 只输出一个 JSON 对象：{"name":"天赋名","description":"表现描述"}',
    '2. 名字 2~6 个字，中文，要有融合两边意象的味道（如【节俭持家】+【摩托小子】→【垃圾摩托】）。',
    '3. 描述 30~80 字，用第二人称「你」，把两条源天赋的意象都织进去。',
    '4. 不得出现任何数值（百分比/档位/等级）——数值由法则掌管，不由你。',
    '5. 描述里的措辞可以比源天赋更张扬，但不得脱离骨架条目划定的能力范围。',
  ].join('\n');
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        `源天赋一：${req.sourceA}`,
        `源天赋二：${req.sourceB}`,
        `产物骨架条目：`,
        ...req.productEntryLines.map((l) => `- ${l}`),
      ].join('\n'),
    },
  ];
}

/** 解析起名输出（Q-05：剥壳归 model-json）；name 缺失 → null */
export function parseTalentNaming(raw: string): TalentNamingResult | null {
  return parseModelJson<TalentNamingResult>(raw, (p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim().slice(0, 12) : '';
    if (!name) return null;
    const description = typeof o.description === 'string' ? o.description.trim().slice(0, 120) : '';
    return { name, description };
  });
}

/** 起名客户端缝（生产 = pipeline 工厂适配，测试 = fake） */
export interface TalentNamingDeps {
  clientFactory: (
    agentId: string,
    endpoint: ApiEndpoint,
    saveId: string,
  ) => {
    chat: (request: {
      messages: Array<{ role: string; content: string }>;
    }) => Promise<{ output: string | null; rawResponse?: string; error?: string }>;
  };
}

/** 融合起名调用（一次 chat）。错误/垃圾输出抛错，调用方走玩家自填兜底 */
export async function runTalentFusionNaming(
  req: TalentNamingRequest,
  deps: TalentNamingDeps,
): Promise<TalentNamingResult> {
  const client = deps.clientFactory('talent-naming', req.endpoint, req.saveId);
  const result = await client.chat({ messages: buildNamingMessages(req) });
  if (result.error) {
    throw new Error(`融合起名调用失败: ${result.error}`);
  }
  const raw = result.output ?? result.rawResponse ?? '';
  const parsed = parseTalentNaming(raw);
  if (!parsed) {
    throw new Error('融合起名输出不可解析');
  }
  return parsed;
}
