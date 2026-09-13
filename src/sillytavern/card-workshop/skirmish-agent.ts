/**
 * skirmish-agent.ts — 交锋拍 AI 装配（敌情评估预提交 + 终局演绎）
 *
 * 设计共识 §8 问题 30：整场战斗只有两次 AI 调用，数值全部归 Code（ADR-11 同源）——
 * ① 敌情评估：开战时**一次性预提交**整场意图序列（拍数/招式/威胁/反制标签/钩子），
 *    Code 经 coerceIntents 夹逼后锁死，AI 不可临场改招（暗牌明规则，公平可审计）；
 * ② 终局演绎：战斗结束后对着战报审计链写一段收束叙事，**只演绎不算数**——
 *    所有数字已在战报卡里，模型输出不回写任何数值。
 *
 * 调用约定（照 char-gen-agent / memory-summarizer 先例）：
 * - deps.clientFactory 每次调用现造 client（pipeline.getClientFactory() 生产注入，
 *   测试给 fake）；本链只有一次朴素 `chat`，不走 function calling。
 * - 解析与调用分家：parse/build 纯函数独立导出（memory-summarizer 先例），
 *   JSON 抢救走 model-json 唯一入口（Q-05）。
 * - agentId（skirmish_eval / skirmish_epilogue）不需要 agent-config 注册表条目：
 *   factory 里查不到 chainCfg 就走缺省超时/重试，AGENT_LABELS 查不到就回显 id。
 */

import type { ApiEndpoint } from '../types';
import { parseModelJson } from '../model-json';
import { MAX_BEATS, type EnemyIntent } from './skirmish';
import { coerceIntents } from './skirmish';

// ========== 依赖缝 ==========

/** 朴素一次性对话客户端（生产 = pipeline 工厂包装的 AgentClient.chat 适配，测试 = fake） */
export interface SkirmishClient {
  chat: (request: {
    messages: Array<{ role: string; content: string }>;
  }) => Promise<{ output: string | null; rawResponse?: string; error?: string }>;
}

export interface SkirmishAgentDeps {
  /** AgentClient 工厂 — 每次调用创建新实例（缓存隔离），与 CharGenAgentDeps 同构 */
  clientFactory: (agentId: string, endpoint: ApiEndpoint, saveId: string) => SkirmishClient;
}

// ========== 敌情评估（预提交） ==========

/** 开战上下文：敌方线索 + 玩家校准锚（威胁值标定的参照系） */
export interface SkirmishAssessRequest {
  saveId: string;
  endpoint: ApiEndpoint;
  /** 敌方名字/线索（叙事里出现的敌人称呼、外貌、已知特性；可为空 = AI 自拟遭遇） */
  enemyHint?: string;
  /** 交战场景（影响招式风味） */
  sceneHint?: string;
  /** 玩家等级（敌方等级标定锚） */
  playerLevel: number;
  /** 玩家典型行动值（攻击/防御/敏捷派生值或卡面战力量级，威胁 DC 标定锚） */
  playerPower: number;
  /** 玩家综合战力（三维和 + 卡组战力；enemyPower 碾压判定的对照锚，可缺省） */
  playerTotalPower?: number;
  /** 拍数（缺省 3；Boss 战可放宽） */
  maxBeats?: number;
}

/** 敌情评估输出（intents 已过 coerceIntents，可信形状） */
export interface SkirmishAssessment {
  enemyName: string;
  enemyLevel: number;
  enemyHp: number;
  /** 敌方总战力（碾压速胜判定的敌方输入；AI 未给 = enemyLevel） */
  enemyPower: number;
  intents: EnemyIntent[];
}

/** 敌情评估 system 提示词（纯函数，测试钉关键约束） */
export function buildAssessmentMessages(req: SkirmishAssessRequest): Array<{
  role: string;
  content: string;
}> {
  const beats = Math.max(1, Math.round(req.maxBeats ?? MAX_BEATS));
  const power = Math.max(1, Math.round(req.playerPower));
  const plLevel = Math.max(1, Math.round(req.playerLevel));
  const system = [
    '你是卡兰大陆的战斗导演。请为一场即将开始的交锋预提交敌方战斗档案与整场意图序列。',
    '',
    '硬性规则：',
    '1. 只输出一个 JSON 对象，不要任何其他文字：{"enemyName":"敌人名","enemyLevel":整数,"enemyHp":整数,"enemyPower":整数,"intents":[{"move":"招式名","threat":整数,"counters":["反制标签"],"hook":"敌方本拍行动钩子"}]}',
    `2. intents 必须恰好 ${beats} 条（整场拍数锁死，开战后不可追加或修改）。`,
    '3. counters 只能从白名单里选：强攻 / 防御 / 闪避 / 打断（可多选）。含义：玩家的行动若带有其中任一标签，反制会获得加成——这是玩家的读招空间，务必让每拍都有可反制面。',
    `4. 威胁标定：玩家的典型行动值约为 ${power}（反制掷骰 = d20 + 行动值 + 克制加成，对上 threat 即反制成功）。请把 threat 设在这个量级：势均力敌 ≈ ${power + 10}，明显弱于玩家 ≈ ${Math.max(1, power - 5)}，头目级 ≈ ${power + 15}。enemyLevel 参考玩家等级 ${plLevel} 上下浮动，enemyHp 决定战斗拍数内能否被打倒（量级 ≈ 单拍伤害 × ${beats} 的 60%~120%）。`,
    `5. enemyPower = 敌方总战力，玩家综合战力约为 ${Math.max(1, Math.round(req.playerTotalPower ?? power))}；远弱于玩家（≤ 一半）的遭遇会被跳拍碾压结算，请如实标定。`,
    '6. move/hook 用中文短句，hook 写敌方本拍的动作画面，不写结果（结果由结算产生）。',
  ].join('\n');
  const user = [
    req.enemyHint ? `敌方线索：${req.enemyHint}` : '敌方线索：（无，请依场景自拟一只有趣的遭遇）',
    req.sceneHint ? `交战场景：${req.sceneHint}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * 解析敌情评估输出（Q-05：剥壳归 model-json，兜底只此一处）。
 * enemyName 缺失/为空 → null（连敌人叫什么都拿不到，整条作废由调用方重试或中止）；
 * enemyLevel/enemyHp 脏数据 → 兜底 1 / 30；intents 交 coerceIntents 夹逼（威胁 1..99、
 * 标签白名单、空兜底防御、条数截断）。
 */
export function parseSkirmishAssessment(raw: string): SkirmishAssessment | null {
  return parseModelJson<SkirmishAssessment>(raw, (p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const name = typeof o.enemyName === 'string' ? o.enemyName.trim().slice(0, 40) : '';
    if (!name) return null;
    const level =
      typeof o.enemyLevel === 'number' && Number.isFinite(o.enemyLevel) && o.enemyLevel > 0
        ? Math.round(o.enemyLevel)
        : 1;
    const hp =
      typeof o.enemyHp === 'number' && Number.isFinite(o.enemyHp) && o.enemyHp > 0
        ? Math.round(o.enemyHp)
        : 30;
    return {
      enemyName: name,
      enemyLevel: level,
      enemyHp: hp,
      // AI 未给/给了脏值 → 按 enemyLevel 估（碾压判定宁可保守，不误跳拍）
      enemyPower:
        typeof o.enemyPower === 'number' && Number.isFinite(o.enemyPower) && o.enemyPower > 0
          ? Math.round(o.enemyPower)
          : level,
      intents: coerceIntents(o.intents),
    };
  });
}

/** 敌情评估调用（一次 chat）。错误/垃圾输出抛错——由集成层决定重试或中止开战 */
export async function runSkirmishAssessment(
  req: SkirmishAssessRequest,
  deps: SkirmishAgentDeps,
): Promise<SkirmishAssessment> {
  const client = deps.clientFactory('skirmish_eval', req.endpoint, req.saveId);
  const result = await client.chat({ messages: buildAssessmentMessages(req) });
  if (result.error) {
    throw new Error(`敌情评估调用失败: ${result.error}`);
  }
  const raw = result.output ?? result.rawResponse ?? '';
  const parsed = parseSkirmishAssessment(raw);
  if (!parsed) {
    throw new Error(`敌情评估输出不可解析（需要 JSON 对象，含非空 enemyName）`);
  }
  return parsed;
}

// ========== 终局演绎 ==========

export interface SkirmishEpilogueRequest {
  saveId: string;
  endpoint: ApiEndpoint;
  enemyName: string;
  /** 玩家称呼（缺省「冒险者」） */
  playerTitle?: string;
  /** 战报审计链（开场行 + 逐拍行 + 结算行，演绎的唯一样本） */
  log: readonly string[];
  finish: '胜利' | '碾压' | '撤退' | '败北';
}

/** 终局演绎 system 提示词（只演绎不算数） */
export function buildEpilogueMessages(req: SkirmishEpilogueRequest): Array<{
  role: string;
  content: string;
}> {
  const system = [
    '你是卡兰大陆的战斗记事官。交锋已经结束，战报审计链如下所附——所有数值都已定案，你只负责给这场战斗写一段收束叙事。',
    '硬性规则：',
    '1. 直接输出叙事正文（80~160 字），不要 JSON、不要标题、不要逐条复述审计行。',
    '2. 不得引入任何新数值（伤害/经验/等级/HP），不得更改编造战报里已有的数字。',
    `3. 结局是「${req.finish}」——叙事基调必须与之相符（碾压=摧枯拉朽、胜利=险中取胜或干净利落、撤退=保留余地的脱身、败北=力竭落败但不写死亡）。`,
    '4. 用中文，贴合敌方与场景的风味，收在一句有余韵的话上。',
  ].join('\n');
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [`玩家：${req.playerTitle ?? '冒险者'}`, `【战报审计链】`, req.log.join('\n')].join(
        '\n',
      ),
    },
  ];
}

/** 终局演绎调用（一次 chat，纯文本）。错误抛错；空输出回退确定性一句话 */
export async function runSkirmishEpilogue(
  req: SkirmishEpilogueRequest,
  deps: SkirmishAgentDeps,
): Promise<string> {
  const client = deps.clientFactory('skirmish_epilogue', req.endpoint, req.saveId);
  const result = await client.chat({ messages: buildEpilogueMessages(req) });
  if (result.error) {
    throw new Error(`终局演绎调用失败: ${result.error}`);
  }
  const text = (result.output ?? result.rawResponse ?? '').trim();
  return text || `与【${req.enemyName}】的交锋落幕（${req.finish}）。`;
}
