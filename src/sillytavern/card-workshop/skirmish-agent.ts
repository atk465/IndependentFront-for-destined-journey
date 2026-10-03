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
import { MAX_INTENTS, type EnemyIntent } from './skirmish';
import {
  buildIntentResolveMessages,
  parseIntentResponse,
  type ParsedIntent,
} from './free-card-play';
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
  /** 预提交招式条数（缺省 3~6 式由 AI 自定；战斗不限拍数，序列打完轮换） */
  intentsCount?: number;
}

/** 敌情评估输出（intents 已过 coerceIntents，可信形状） */
export interface SkirmishAssessment {
  enemyName: string;
  enemyLevel: number;
  enemyHp: number;
  /** 难度档（v2 共识：评估 AI 选定；缺省/非法由引擎兜底标准表） */
  difficulty?: string;
  /** 敌方总战力（碾压速胜判定的敌方输入；AI 未给 = enemyLevel） */
  enemyPower: number;
  intents: EnemyIntent[];
  /** 敌方数量（战斗维度：多敌；缺省 1。评估 Agent 可选声明） */
  enemyCount?: number;
  /** 敌方体型（战斗维度：体格差压制；缺省「常人」。评估 Agent 可选声明） */
  enemyScale?: string;
  /**
   * 多敌实体档案（2026-09-28 效果批六后续）：每敌独立 HP/角色/招式轮换/风格。
   * 声明 2+ 敌时引擎切多敌模式：逐敌血条与目标选择，首领倒下即胜，
   * 存活杂兵给首领护卫减伤（每只 −20%，封顶 −60%）。
   */
  enemies?: {
    name: string;
    role: '首领' | '杂兵';
    hp: number;
    intents: EnemyIntent[];
    style?: string;
  }[];
}

/** 敌情评估 system 提示词（纯函数，测试钉关键约束） */
export function buildAssessmentMessages(req: SkirmishAssessRequest): Array<{
  role: string;
  content: string;
}> {
  const intentsCount = Math.min(MAX_INTENTS, Math.max(1, Math.round(req.intentsCount ?? 3)));
  const power = Math.max(1, Math.round(req.playerPower));
  const plLevel = Math.max(1, Math.round(req.playerLevel));
  const system = [
    '你是铭刻纪元的战斗导演。请为一场即将开始的交锋预提交敌方战斗档案与招式序列。',
    '',
    '硬性规则：',
    '1. 只输出一个 JSON 对象，不要任何其他文字：{"enemyName":"敌人名","enemyLevel":整数,"enemyHp":整数,"enemyPower":整数,"enemyCount":整数,"enemyScale":"体型","difficulty":"难度档","intents":[{"move":"招式名","threat":整数,"counters":["反制标签"],"hook":"敌方本拍行动钩子"}]}。difficulty 从「爽战/标准/长战」三选一：玩家高 3+ 级或战力明显碾压→爽战；|Δ等级|≤2 势均力敌→标准；敌高 3+ 级或头目级→长战（多敌按整场体感选）。enemyCount = 敌方数量（1~6，缺省 1）；enemyScale = 敌方体型（小巧/娇小/常人/巨躯/巨像，缺省常人）——只在遭遇明确为多敌或特殊体型时填写。',
    `2. intents 输出 ${intentsCount} 条，代表这名敌人的**招式轮换**——战斗不限拍数，序列打完会按原序循环使用，开战后不可修改。`,
    '3. counters 只能从白名单里选：强攻 / 防御 / 闪避 / 打断（可多选）。含义：玩家的行动若带有其中任一标签，反制会获得加成——这是玩家的读招空间，务必让每式都有可反制面。',
    `4. 威胁标定：玩家的典型行动值约为 ${power}（反制掷骰 = d20 + 行动值 + 克制加成，对上 threat 即反制成功）。请把 threat 设在这个量级：势均力敌 ≈ ${power + 10}，明显弱于玩家 ≈ ${Math.max(1, power - 5)}，头目级 ≈ ${power + 15}。enemyLevel 参考玩家等级 ${plLevel} 上下浮动。enemyHp 决定战斗节奏（导演时长锚）：整场时长应落在爽战 3~5 拍 / 标准 4~8 拍 / 长战 6~10 拍——多敌时杂兵约 1~2 拍清一只、首领吃剩余时长并按护卫减伤折算（单敌约单拍伤害 × 对应锚）。`,
    `5. enemyPower = 敌方总战力，玩家综合战力约为 ${Math.max(1, Math.round(req.playerTotalPower ?? power))}；远弱于玩家（≤ 一半）的遭遇会被跳拍碾压结算，请如实标定。`,
    '6. move/hook 用中文短句，hook 写敌方该式的动作画面，不写结果（结果由结算产生）。',
    '7. 多敌遭遇（2~3 敌）：逐敌输出 enemies 数组——每敌独立 hp/两式轮换/风格（拖时间=血厚威胁低、爆发=威胁高血脆、均衡居中）；敌 0 固定标 role「首领」，其余标「杂兵」。总威胁预算不变（各敌威胁相加 ≈ 单敌标定量），首领略高于杂兵。',
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
      difficulty: typeof o.difficulty === 'string' ? o.difficulty : undefined,
      // AI 未给/给了脏值 → 按 enemyLevel 估（碾压判定宁可保守，不误跳拍）
      enemyPower:
        typeof o.enemyPower === 'number' && Number.isFinite(o.enemyPower) && o.enemyPower > 0
          ? Math.round(o.enemyPower)
          : level,
      intents: coerceIntents(o.intents),
      // 多敌实体档案（效果批六后续）：逐敌透传，脏条目丢弃（无名/无 HP）
      ...(Array.isArray(o.enemies) && o.enemies.length > 0
        ? {
            enemies: o.enemies
              .filter(
                (e) =>
                  e &&
                  typeof e.name === 'string' &&
                  e.name.trim() &&
                  typeof e.hp === 'number' &&
                  Number.isFinite(e.hp) &&
                  e.hp > 0 &&
                  Array.isArray(e.intents) &&
                  e.intents.length > 0,
              )
              .map((e) => ({
                name: String(e.name).trim(),
                role: e.role === '首领' ? ('首领' as const) : ('杂兵' as const),
                hp: Math.round(e.hp),
                intents: coerceIntents(e.intents),
                ...(typeof e.style === 'string' && e.style.trim() ? { style: e.style.trim() } : {}),
              })),
          }
        : {}),
    };
  });
}

/** 敌情评估调用（一次 chat）。错误/垃圾输出抛错——由集成层决定重试或中止开战 */
export interface SkirmishIntentRequest {
  saveId: string;
  endpoint: ApiEndpoint;
  playerText: string;
  cards: ReadonlyArray<{ name: string; tags: readonly string[] }>;
  intentCounters: readonly string[];
}

/** L2 意图解析：轻量单轮调用 + 严格 JSON 校验。解析失败/动作非法一律 { kind:'none' }，
 *  由调用方降级为叙事，绝不 throw。镜像 runSkirmishAssessment 的调用形态。 */
export async function runSkirmishIntentResolve(
  req: SkirmishIntentRequest,
  deps: SkirmishAgentDeps,
): Promise<ParsedIntent> {
  const client = deps.clientFactory('skirmish_eval', req.endpoint, req.saveId);
  const result = await client.chat({
    messages: buildIntentResolveMessages({
      playerText: req.playerText,
      cards: req.cards,
      intentCounters: req.intentCounters,
    }),
  });
  if (result.error) return { kind: 'none' };
  const raw = result.output ?? result.rawResponse ?? '';
  return parseIntentResponse(raw, req.cards, []);
}

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

// ========== 战斗记叙（终局演绎：AI 对着逐拍审计链写过程，抒发情绪） ==========

export interface SkirmishChronicleRequest {
  saveId: string;
  endpoint: ApiEndpoint;
  enemyName: string;
  /** 玩家称呼（缺省「冒险者」） */
  playerTitle?: string;
  /** 战报审计链（开场行 + 逐拍行，记叙的唯一样本） */
  log: readonly string[];
  finish: '胜利' | '碾压' | '撤退' | '败北';
  /** 玩家主动结束战斗时写的结束理由（主人裁定：作为 AI 写过程与收束的参考） */
  endReason?: string;
  /**
   * 本场动用的禁忌卡名单（2026-09-25 主人裁定：禁忌卡胜利后 AI 一样描述战斗过程，
   * 且改写规则的那一幕必须成为记叙高潮）。缺省空 = 本场没动禁忌卡。
   */
  forbiddenCards?: readonly string[];
}

/** 战斗记叙 system 提示词（只演绎不算数；主人裁定 2026-09-13：终局要写战斗过程，抒发情绪） */
export function buildChronicleMessages(req: SkirmishChronicleRequest): Array<{
  role: string;
  content: string;
}> {
  const system = [
    '你是铭刻纪元的战斗记事官。一场交锋刚刚结束，逐拍的战报审计链附后——所有数值都已定案。',
    '请写一段**战斗过程的记叙**，让亲历者读来有情绪。',
    '硬性规则：',
    '1. 200~350 字，直接输出正文；不要 JSON、不要标题、不要逐条复述审计行。',
    '2. 按战报的先后顺序把整场仗写成**连续的动作画面**（招式、身法、创口落在何处），',
    '   起伏严格照战报来——招架成功的痛快、失手挨打的代价，都要写到；结尾收束整场。',
    '3. 叙事里禁止机制词：「拍」「第 N 拍」「行动值」「威胁」「审计」「反制」这类系统词',
    '   一个都不许出现在正文里——把「反制成功」写成招架住了、把「行动值高」写成一气呵成，',
    '   时间推进用「转瞬/几个照面/一炷香」这样的叙述语言。',
    '4. 不得引入任何新数值（伤害/经验/等级/HP），不得更改战报里已有的数字。',
    `5. 结局是「${req.finish}」——基调必须相符（碾压=摧枯拉朽、胜利=险中取胜或干净利落、撤退=保留余地的脱身、败北=力竭落败但不写死亡）。`,
    ...(req.endReason
      ? [`6. 玩家亲口给出了这场战斗的结束缘由：「${req.endReason}」——收束必须贴合这个缘由来写。`]
      : []),
    ...(req.forbiddenCards && req.forbiddenCards.length > 0
      ? [
          `8. 本场玩家动用了禁忌卡：${req.forbiddenCards.join('、')}——它改写规则的那一幕`,
          '   必须是整段记叙的高潮：先写禁忌之力撕开常规的样子（世界为之错了一拍），',
          '   再写它落到敌人身上的结局。代价行（天赋被卷走/气血代价）也要有分量地写。',
        ]
      : []),
    '9. 用中文，贴合敌方与场景的风味，收在一句有余韵的话上。',
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

/** 战斗记叙调用（一次 chat，纯文本）。错误抛错；空输出回退确定性一句话 */
export async function runSkirmishChronicle(
  req: SkirmishChronicleRequest,
  deps: SkirmishAgentDeps,
): Promise<string> {
  const client = deps.clientFactory('skirmish_epilogue', req.endpoint, req.saveId);
  const result = await client.chat({ messages: buildChronicleMessages(req) });
  if (result.error) {
    throw new Error(`战斗记叙调用失败: ${result.error}`);
  }
  const text = (result.output ?? result.rawResponse ?? '').trim();
  return text || `与【${req.enemyName}】的交锋落幕（${req.finish}）。`;
}
