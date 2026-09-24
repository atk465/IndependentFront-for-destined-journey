import type { StatePatch } from '@engine/types';
/**
 * GamePipeline — 前端 ↔ AgentOrchestrator 桥接层
 *
 * Phase 10h: 连接 GamePage UI 和引擎 Agent 管线。
 * 封装: AgentConfig 组装 / AgentContext 构建 / 编排器创建 / 回调处理。
 *
 * Phase 7e: story agent 使用 chatStream() 逐块接收原文，
 * 通过 onStoryChunk 将累计的玩家可见投影实时推送到前端 UI。
 */
import { AgentOrchestrator } from '@engine/agent-orchestrator';
// Q-05：从模型输出抢救 JSON 的唯一入口（裸 / 围栏 / <json> / 前后夹带解说四种形态）
import { extractJsonPayload } from '@engine/model-json';
import type { OrchestratorOptions, OrchestratorEvents } from '@engine/agent-orchestrator';
import { DEFAULT_AGENT_PIPELINE } from '@engine/types';
import type {
  AgentContext,
  AgentConfig,
  ApiEndpoint,
  AgentResult,
  AgentPreset,
  CardItem,
  CombatTriggerMarker,
  CombatSummaryResult,
  RecentCombatInfo,
  WorldBook,
  CraftGenRequestMarker,
  CharGenRequestMarker,
  MemoryRecord,
  ChatMessage,
  SystemEvent,
  DebugAgentEntry,
  PlotEvent,
} from '@engine/types';
import {
  judgeCrush,
  type SkirmishAction,
  type SkirmishChoice,
} from '@engine/card-workshop/skirmish';
import {
  cardPlayPlan,
  planEffects,
  sealedCardPlay,
  type ActivateInput,
} from '@engine/card-workshop/entry-combat';
import { applyBond, bondForCard, type BondInfo } from '@engine/card-workshop/affection-bond';
import { cardKindOf } from '@engine/card-workshop/card-kind';
import { willModifierOf } from '@engine/card-workshop/unsealing';
import { getCommissionDefs } from '@engine/commission-runtime';
import { coerceCommissionsFlags } from '@engine/card-workshop/commission-flags';
/** 蜡痕计数键（白蜡城代价；worldFlags.counters 段） */
const WAX_MARKS_KEY = '蜡痕';
import { buildCraftBiasLines } from '@engine/card-workshop/talent-entry';
import { runTalentFusionNaming } from '@engine/card-workshop/talent-naming';
import {
  applyStatMultiplier,
  basicCounterAction,
  deriveBaseCombatStats,
  deriveCombatStats,
} from '@engine/card-workshop/derived-stats';
import {
  crushFinish,
  fleeSkirmish,
  playBeat,
  settleSkirmish,
  startSkirmish,
  type SkirmishSession,
} from '@engine/card-workshop/skirmish-session';
import { buildSkirmishSettlementPatches } from '@engine/card-workshop/skirmish-settlement';
import type { SkirmishContract } from '@engine/card-workshop/skirmish-session';
import {
  collectRuleHooks,
  DAILY_NUKE_WEAKNESS,
  dailyNukePercentOf,
  defeatExpMultiplierOf,
  expMultiplierOf,
  hasDefeatReward,
  hasOncePerBattleNuke,
  hasVictoryMaterial,
  hpMultiplierOf,
  nukePercentOf,
  statMultiplierOf,
} from '@engine/card-workshop/talent-hooks';
import {
  entryStrength,
  envBonusesOf,
  hasBetterRoll,
  hasTitanPhysique,
  totalIntimidation,
} from '@engine/card-workshop/talent-rule-modifiers';
import {
  initialSelfEffects,
  selfStatusesOf,
  totalSelfStatus,
} from '@engine/card-workshop/self-status';
import {
  bodyScaleCrushBonus,
  coerceBodyScale,
  coerceEnemyCount,
  isOnCooldown,
  playerBodyScale,
  resolveCrit,
  startCooldown,
  tickCooldowns,
} from '@engine/card-workshop/battle-dimensions';
import { totalCondBonus } from '@engine/card-workshop/conditional-bonus';
import {
  coerceTwinBonds,
  duelBlocksCard,
  isLazyCard,
  isLoneCard,
  isModularCard,
  resolveHotSwap,
  resolveLazyCard,
  resolveTwinCombo,
} from '@engine/card-workshop/battle-rules';
import {
  MISFORTUNE_KEY,
  MISFORTUNE_PER_FAILURE,
  isGreatFailure,
} from '@engine/card-workshop/craft-flow-hooks';
import {
  FACE_SLAP_KEY,
  coerceNemesis,
  coerceTaunt,
  isNemesisBattle,
  nemesisExpMultiplier,
  settleFaceSlap,
  shouldMarkNemesis,
} from '@engine/card-workshop/conditional-exp';
import {
  addBlueprint,
  coerceBlueprints,
  pickCopyTarget,
} from '@engine/card-workshop/opponent-blueprints';
import {
  coerceTrueNames,
  hasTrueName,
  rememberTrueName,
  trueNameShockPower,
} from '@engine/card-workshop/true-name';
import { coerceSpirits } from '@engine/card-workshop/behind-spirits';
import {
  buffActiveToday,
  canUseToday,
  coerceBuffs,
  coerceCounters,
  coerceLedger,
  counterOf,
  spendCounter,
  tryUseToday,
} from '@engine/card-workshop/daily-ledger';
import { getRequiredXpForLevel, xpToNextNumber } from '@engine/exp-table';
import {
  coerceSealedTalents,
  decrementSealedTalents,
  filterSealedTalents,
} from '@engine/card-workshop/sealed-talents';
import { CARD_CRAFT_NARRATE_AGENT, runCardCraftNarration } from '@engine/card-craft-narrate';
import {
  COMMISSION_NARRATE_AGENT,
  runCommissionNarration,
} from '@engine/card-workshop/commission-narrate';
import {
  COMBAT_CRIT_MULTIPLIER,
  DAILY_BUFF_COMBAT_CRIT,
  DAILY_BUFF_CRAFT_LUCK,
} from '@engine/card-workshop/fortune-dice';
import type { TalentEntry } from '@engine/card-workshop/talent-entry';
import type { CraftRating } from '@engine/types';
import { planDefeatCompensation } from '@engine/card-workshop/defeat-compensation';
import { planSelfEvolution } from '@engine/card-workshop/companion-growth';
import { runSkirmishAssessment, runSkirmishChronicle } from '@engine/card-workshop/skirmish-agent';
import { AgentClient } from '@engine/agent-client';
import type { StreamCallbacks } from '@engine/agent-client';
import { createStateManager } from '@engine/state-manager';
// 卡池唯一口径：内容仓 cardPool + 运行时自定义卡（2026-09-18）
import { getCardPool } from '@engine/card-workshop/card-pool';
import { deckGuardBonus, deckPower } from '@engine/card-workshop/deck-power';
import { matchFreeCardPlay } from '@engine/card-workshop/free-card-play';
import { battleReadyCards } from '@engine/card-workshop/deck-power';
import { cardCombatTags } from '@engine/card-workshop/entry-combat';
import { runSkirmishIntentResolve } from '@engine/card-workshop/skirmish-agent';
import { projectStoryOutput, projectStreamingStory } from '@engine/story-output';
import { filterOptionsForScheme, resolveOptionScheme } from '@engine/option-policy';
import { loadWorldBooksWithFallback } from '@engine/builtin-worldbooks';
import { filterBooksByEnabledEntries } from '@engine/worldbook-loader';
import { buildStatData } from '@engine/stat-projection';
import { buildPassSeed } from '@engine/ejs-rng';
// 🗺 地图 v1: `{{MAP_CONTEXT}}` 的可变半边（`worldFlags.map`）+ 天气标签（与出图同口径）
import { getMapFactsFlags, getMapFlags } from '@engine/save-profile';
// 🎲 随机事件 v1 (§5.1 读侧)：`{{RANDOM_EVENTS}}` 的候选快照 —— 供值必须在 buildContext
import { getRandomEventFlags } from '@engine/save-profile';
import { buildRandomEventOffer } from '@engine/random-event-context';
import type { RandomEventOfferEntry } from '@engine/random-event-context';
// 地点键与条件上下文的**唯一**实现（与入池侧共用；此前这里有一份逐字拷贝）
import { buildRandomEventRollContext } from '@engine/random-event-snapshot';
import { getRandomEventPack } from '@engine/random-event-runtime';
import { getEngineSettings } from '@engine/engine-settings';
// 🧵 主线细化层（2026-09-09 接线）：闸门/快照/投影响应都在 game-pipeline 供值（buildContext 铁律）
import { getPlotThreadFlags, commitPlotThreadTurn } from '@engine/save-profile';
import {
  evaluatePlotThreadGate,
  parseThreadDeclarations,
  buildCharGenProjectionA,
  buildCharGenProjectionB,
} from '@engine/plot-threads';
import type {
  PlotThreadGateResult,
  PlotThreadTurnContext,
  PlotThreadDeclaration,
  PlotThreadUpdate,
} from '@engine/plot-threads';
import { countAcceptableTriggers } from '@engine/plot-engine';
// 🆕 Delta 会话（T4）：存档切换/销毁时清理该存档的 prompt session（string 入参 = 清整个 saveId）
import { invalidatePromptSession } from '@engine/prompt-session-assembler';
import { resolveSceneWeather } from './scene-weather';
import { eventCommissionDefs } from '@engine/card-workshop/event-commission';
import { backfillMissingMemories, LAZY_BACKFILL_MAX_PER_RECALL } from '@engine/memory-store';
import { toEpochMinutes, MINUTES_PER_GAME_DAY } from '@engine/time-system';
// 🆕 重铸（2026-08-24）：单条目重铸的引擎侧类型（RewriteTarget = 要重写的技能/装备/物品三选一）
import type { RewriteTarget } from '@engine/item-gen-chain';
import { midTierRefHit } from '@engine/card-workshop/commission';
import type { CommissionDef } from '@engine/card-workshop/commission';

/** EJS `ui.log` 环形缓冲上限（能力面 §6.2） */
import { diffVars, measureDiffSize, EJS_DIFF_SIZE_LIMIT } from '@engine/ejs-vars-diff';
import type { EjsVarsDiff } from '@engine/ejs-vars-diff';
import type { useGameStore } from '../stores/game-store';
import type { useSettingsStore } from '../stores/settings-store';
import { useWorldBookStore } from '../stores/worldbook-store';
import { useUIStore } from '../stores/ui-store';
import { getAgentSettings, hasExplicitAgentModel } from '../stores/agent-settings';
import type { EmbeddingRequestTrace } from '@engine/memory-store';
// 🆕 F10（2026-09-04）：Agent API 池绑定的 fail-closed 解析（pool id → ApiEndpoint 唯一纯实现）
import { buildApiEndpoints, resolveAgentEndpoint } from './endpoint-resolver';

export interface GamePipelineDeps {
  gameStore: ReturnType<typeof useGameStore>;
  settingsStore: ReturnType<typeof useSettingsStore>;
  saveId: string;
}

/** 流式回调 — chunk 是累计的可见正文快照；isComplete=true 表示清理临时预览。 */
export type StoryChunkCallback = (chunk: string, isComplete: boolean) => void;

/**
 * 这个错误是不是「用户主动取消」（离开游戏页 / 按了停止生成）。
 *
 * 侧链自 2026-08-10 起也吃 `run()` 的 abort 信号，于是取消会以 `AbortError` 的形状
 * 冒到各条侧链的 catch 里。**取消不是失败** —— 按失败报会在 UI 上留一个红状态、
 * 在控制台留一条 `console.error`，而那正是用户自己要的结果。
 */
function isAbortError(err: unknown): boolean {
  return (err as { name?: string } | null | undefined)?.name === 'AbortError';
}

/**
 * 🔴 F10（2026-09-04）：Agent 显式绑定的 API 池解析失败时抛出 —— 主协调者的 fail-stop。
 *
 * 语义与 `resolveAgentEndpoint` 对齐：**只有「显式绑定但解析不到」才抛**。
 * 「从未设置 + 空池」（missing-pool）不抛 —— 那是首次配置还没走完，老路是
 * `apiEndpointId=''` 交给编排器按 `.not found` 淡失败，行为保持不变。
 *
 * 抛错目的是在 provider dispatch **之前**停掉整轮：story/dispatcher/vars_update 这些
 * 主 DAG agent 失效时绝不能用池里另一家 provider 顶替（改了模型行为、成本甚至隐私偏好）。
 */
export class EndpointBindingError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly requestedPoolId: string,
  ) {
    super(
      `Agent「${agentId}」绑定的 API 池已失效（原 id: ${requestedPoolId}）。` +
        '本轮已停止发送请求（fail-closed，不会换用别的 provider）——请到设置 → Agent 配置重新选择 API 池。',
    );
    this.name = 'EndpointBindingError';
  }
}

/**
 * 🔴 F10：侧链 Agent 名单。这些 agent 不在主 DAG 里（各自被 marker / 按钮唤起），
 * 端点失效不能拖垮整轮叙事 —— 装配置时跳过（不装配端点），真被调用时由
 * `getEndpointForAgent` 再判一次并按既有 optional 策略跳过。
 */
const SIDE_CHAIN_AGENT_IDS = new Set(['craft_gen', 'char_gen', 'item_gen', 'combat_v3']);

interface DebugEntryInput {
  invocationId: string;
  turnId: string;
  agentId: string;
  label: string;
  endpoint?: Partial<Pick<ApiEndpoint, 'id' | 'name' | 'baseUrl' | 'defaultModel'>>;
  endpointId?: string;
  endpointName?: string;
  baseUrl?: string;
  model?: string;
  messages?: Array<{ role: string; content: string | null }>;
  result?: Partial<AgentResult>;
  startedAt: number;
  completedAt?: number;
  duration?: number;
}

/** Agent/Embedding 共用的结果→持久化调试记录投影，避免字段在多条调用路径间漂移。 */
function buildDebugEntry(input: DebugEntryInput): DebugAgentEntry {
  const { result } = input;
  return {
    invocationId: input.invocationId,
    turnId: input.turnId,
    agentId: input.agentId,
    label: input.label,
    endpointId: input.endpointId ?? input.endpoint?.id ?? '',
    endpointName: input.endpointName ?? input.endpoint?.name ?? '',
    baseUrl: input.baseUrl ?? input.endpoint?.baseUrl ?? '',
    model: input.model ?? input.endpoint?.defaultModel ?? '',
    messages: (input.messages ?? result?.requestMessages ?? []).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    rawResponse: result?.rawResponse ?? '',
    reasoning: result?.reasoning,
    toolCalls: result?.toolCalls,
    providerRounds: result?.providerRounds,
    promptSessionRevision: result?.promptSessionRevision,
    promptRebased: result?.promptRebased,
    promptRebaseReason: result?.promptRebaseReason,
    error: result?.error,
    tokensUsed: result?.tokensUsed ?? 0,
    cacheHit: result?.cacheHit ?? false,
    cacheHitTokens: result?.cacheHitTokens,
    cacheMissTokens: result?.cacheMissTokens,
    completionTokens: result?.completionTokens,
    promptTokens: result?.promptTokens,
    duration: result?.duration ?? input.duration ?? 0,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  };
}

/** 兼容旧调用名；正文、控制区块与 `<option(s)>` 统一由 story-output 投影。 */
export function extractStoryOptions(raw: string): {
  content: string;
  options: string[];
  truncated: boolean;
} {
  return projectStoryOutput(raw);
}

/** 输出未闭合时给玩家的可见提示（2026-09-18 防护：把静默半截变成明确告知） */
export const TRUNCATION_NOTICE =
  '\n\n---\n⚠️ 本轮输出未正常结束（缺 `</maintext>` 闭合标记）——可能被模型截断或流式中断。' +
  '若反复出现，请检查该 Agent 的**模型与预设是否匹配**（例如把 DeepSeek 专用预设用在非 DeepSeek 模型上）。';

/** 各 Agent 的中文标签（供调试日志 / DebugPanel 显示） */
const AGENT_LABELS: Record<string, string> = {
  memory_recall: '记忆召回',
  story: '叙事生成',
  request_dispatcher: '请求调度',
  vars_update: '状态更新',
  memory_summary: '记忆摘要',
  plot_pre_check: '剧情预检',
  plot_post_check: '剧情复检',
  craft_gen: '制作生成',
  char_gen: '角色生成',
  item_gen: '物品生成',
  plot_outline: '剧情大纲',
};

const saveWork = new Map<
  string,
  { owner: GamePipeline; depth: number; idle: Promise<void>; resolve: () => void }
>();

/** A remounted page must read its save only after the previous pipeline drains. */
export async function waitForGameSaveIdle(saveId: string): Promise<void> {
  while (saveWork.has(saveId)) await saveWork.get(saveId)!.idle;
}

/** 玩家天赋条目摊平（规则层数值条目一律走条目种类判定，与 UI 同源） */
function flatEntriesOf(
  talents: readonly { entries?: readonly TalentEntry[] }[] | undefined,
): readonly TalentEntry[] {
  return (talents ?? []).flatMap((t) => t.entries ?? []);
}

export class GamePipeline {
  private acquireSaveWork(): (() => void) | null {
    let work = saveWork.get(this.saveId);
    if (work && work.owner !== this) return null;
    if (!work) {
      let resolve!: () => void;
      const idle = new Promise<void>((done) => {
        resolve = done;
      });
      work = { owner: this, depth: 0, idle, resolve };
      saveWork.set(this.saveId, work);
    }
    work.depth++;
    return () => {
      if (--work.depth === 0) {
        saveWork.delete(this.saveId);
        work.resolve();
      }
    };
  }
  private game: ReturnType<typeof useGameStore>;
  private settings: ReturnType<typeof useSettingsStore>;
  private saveId: string;
  private orch: AgentOrchestrator | null = null;
  private abortController: AbortController | null = null;
  /** 当前 run 的所有权标识；abort 后直到 finally 收尾前都保持，防止旧 run 清掉新 run。 */
  private activeRunId: string | null = null;
  /** Reject overlapping runs until cancellation, background writes and refresh have drained. */
  private runSeq = 0;
  private disposed = false;
  /** 当前回合内按 Agent 递增，生成不会因同名 Agent 而覆盖的调试调用 ID。 */
  private debugInvocationCounts = new Map<string, number>();
  private mainInvocationIds = new Map<string, string>();
  /** 真机修(2026-07-17): run() 加载的配置/世界书/预设，供侧链 buildAgentMessages 使用（此前恒 undefined → systemPrompt 退化 stub + 世界书恒空） */
  private chainData: {
    agentConfigs: AgentConfig[];
    worldBooks: WorldBook[];
    presets: AgentPreset[];
    // 🆕 F10: 默认层也挂在这里 —— 侧链 getEndpointForAgent 与主 DAG buildAgentConfigs
    //    走**同一个** boundPoolId 解析（覆写 ?? 默认），否则两侧对同一个 agent 会给出
    //    不同的解析结果（一侧吃默认层 model、另一侧裸读覆写）。
    agentDefaults: Record<string, Record<string, unknown>>;
  } | null = null;
  /** 步5: 本轮共享 context 引用 — pre_check 剧情导演区块注入 / post_check 年度大纲检测需要 */
  private currentContext: AgentContext | null = null;
  /** 步5: 剧情异步落库任务（preCheckPlot/postCheckPlot），run() 末尾统一 await 避免 refreshFromDb 读到中间态 */
  private pendingPlotTasks: Promise<void>[] = [];
  /**
   * 🎵 本轮待播的配乐标记。Stage 1 只暂存，等状态落库+回读之后才真正选曲 ——
   * 理由见 run() 末尾。一轮多个标记时后者覆盖前者（以 AI 最后的判断为准）。
   */
  /**
   * 上次据以选曲的地点。用来判断"地点变没变" —— 没变就不重选，
   * 同一地点里来回走动不该反复触发。空串表示还没选过。
   */
  /**
   * 🖼 本轮 story 刚产出的那条消息（id / turn / 正文）。
   *
   * 情景插画按 `(saveId, messageId, occurrence)` 反查挂回正文（D2），所以自动档开火
   * 时必须知道图挂在哪条消息上。**每轮 run() 开头清空** —— 上一轮的消息不该被这一轮
   * 的标记挂上去。
   */
  private lastStoryMessage: { id: string; turn: number; content: string } | null = null;
  /**
   * 工坊 P2 (D5) 体积护栏: 已经因超限被拒过的来源 Agent。
   *
   * **每存档每来源只 toast 一次** —— 一个失控的世界书状态机会轮轮超限，
   * 每轮弹一次只会把玩家逼到关掉通知。内存级即可（本实例随存档创建），
   * 不新增任何持久化字段；累计诊断在 `game.ejsVarsRejections`。
   */
  private ejsRejectToasted = new Set<string>();
  /** Q-01: v3 战斗真实骰源（drawDice）的 outputId 计数器，区分每次续杯 */
  private _diceDrawSeq = 0;
  /**
   * 最近一场**已结算**战斗（2026-08-13 真机 debug：dispatcher 战后轮重触发战斗）。
   *
   * 战斗终局落库时记录，`buildContext` 供给 `ctx.recentCombat` →
   * `{{RECENT_COMBAT}}` 渲染。内存级（与 `_lastCombatMarker` 同口径，不持久化）：
   * 战斗后的紧接着的下一轮是误触发高发窗口，覆盖它就够；跨会话场景里已有角色表
   * 自带 hp=0/死亡状态可判。放弃的战斗不记录（没发生过）。
   */
  private _recentCombat: RecentCombatInfo | null = null;
  /**
   * 🧵 主线细化层（2026-09-09）：本轮闸门结果（pre 开始前求值一次）与同轮临时工作集。
   * 工作集 = pre 接受的声明 + post 暂存结算/揭示；**成功回合收口**才由 commitPlotThreadTurn
   * 落库，失败/取消整体丢弃、不消费冷却（实施计划 §3.5）。
   */
  private plotThreadGate: PlotThreadGateResult | null = null;
  private plotThreadTurn: PlotThreadTurnContext | null = null;
  private plotThreadSettlement: { updates: PlotThreadUpdate[]; revealedNames: string[] } = {
    updates: [],
    revealedNames: [],
  };

  /**
   * 取 EJS `ui.log` 调试日志快照（能力面 §3.11）。
   *
   * 环形缓冲**住在 game-store**（`ejsUiLog`）而不是本实例：之前它是这里的私有字段，
   * `getEjsDebugLog()` 全仓零调用点 —— 收集了、没人读。挪去 store 之后 DebugPanel
   * 直接读，也随导出 JSON 一起被带走。
   *
   * 刻意**不落真 console**：真机语料 5 个条目在用 `console.log` 调试，
   * 每回合每 Agent 都刷一遍，会把真正的报错淹掉。
   */
  getEjsDebugLog(): string[] {
    return [...(this.game.ejsUiLog ?? [])];
  }

  constructor(deps: GamePipelineDeps) {
    this.game = deps.gameStore;
    this.settings = deps.settingsStore;
    this.saveId = deps.saveId;
    this.attachSkirmishController();
    // 融合起名缝（AI 零编数：只起名写描述；mock store 无此方法则跳过）
    this.game.setFuseNamingImpl?.(async (sourceA, sourceB, entryLines) => {
      const r = await this.runTalentFusionNaming(sourceA, sourceB, entryLines);
      if (!r.ok || !r.name) throw new Error(r.reason ?? 'AI 起名失败');
      return { name: r.name, description: r.description ?? '' };
    });
  }

  // 🪦 Q-06：`syncSnapshotSettings` 已删。它把 settings-store 的两个字段每轮抄进
  //    Dexie `settings` 表，因为 createSnapshot 读的是那张表。桥只搬两个字段、
  //    且 `catch { console.warn }` 静默失败 —— 断了用户完全无感。
  //    现在引擎经 `engine-settings` 注入缝直接读 settings-store（真源只剩一处），
  //    provider 在 main.ts 启动时注册。

  /** 发送开场 Prompt（首次加载存档时调用），作为首条用户消息注入管线 */
  async sendOpeningPrompt(onStoryChunk?: StoryChunkCallback): Promise<void> {
    if (!this.ownsActiveSave) return;
    const release = this.acquireSaveWork();
    if (!release) return;
    try {
      await this.executeOpeningPrompt(onStoryChunk);
    } finally {
      release();
    }
  }

  private async executeOpeningPrompt(onStoryChunk?: StoryChunkCallback): Promise<void> {
    const prompt = this.game.openingPrompt;
    if (!prompt) return;
    // Claim before starting the long pipeline. A page remount can create a second
    // GamePipeline while the first one is still running.
    const claimed = await this.game.markOpeningPromptConsumed();
    if (!claimed) return;
    if (!this.ownsActiveSave) {
      await this.game.releaseOpeningPromptClaim(this.saveId);
      return;
    }

    // run() 会先落库用户消息，所以重试前得知道这条已经在了 —— 否则归还认领等于放行重复。
    const promptAlreadyRendered = this.game.messages.some(
      (msg) => msg.role === 'user' && msg.content === prompt,
    );
    // 开场 prompt 作为真正的用户消息渲染 + 注入历史，让下游 Agent 能读到装备/技能/背景/命定核心等
    const ok = await this.run(prompt, onStoryChunk, /* isUserMessage */ !promptAlreadyRendered);
    if (ok) return;

    // The store verifies persisted narrative against the original save before releasing.
    if (!this.ownsActiveSave || !this.game.messages.some((msg) => msg.role === 'assistant')) {
      await this.game.releaseOpeningPromptClaim(this.saveId);
    }
  }

  /** 核心: 将用户输入送入 Agent 管线。返回 true 表示管线成功完成。 */
  async run(
    userInput: string,
    onStoryChunk?: StoryChunkCallback,
    isUserMessage = true,
    sourceMessageId?: string,
  ): Promise<boolean> {
    const release = this.acquireSaveWork();
    if (!release) return false;
    try {
      return await this.executeRun(userInput, onStoryChunk, isUserMessage, sourceMessageId);
    } finally {
      release();
    }
  }

  private async executeRun(
    userInput: string,
    onStoryChunk?: StoryChunkCallback,
    isUserMessage = true,
    sourceMessageId?: string,
  ): Promise<boolean> {
    if (this.abortController || !this.ownsActiveSave) return false;
    console.log(
      '[GamePipeline] run() called — userInput length:',
      userInput.length,
      'isUserMessage:',
      isUserMessage,
    );
    console.log('[GamePipeline] userInput preview:', userInput.slice(0, 300));
    const mySeq = ++this.runSeq;
    const controller = new AbortController();
    this.abortController = controller;
    this.game.isGenerating = true;
    let activityRunId: string | null = null;
    let activityOutcome: 'completed' | 'failed' | 'cancelled' = 'failed';
    let activityMessage: string | undefined;

    try {
      // 1. 先快照既有历史；当前输入只走 userInput，避免同时出现在 NARRATIVE 与 USER_INPUT。
      const existingSourceMessageId = isUserMessage
        ? undefined
        : (sourceMessageId ??
          [...this.game.messages].reverse().find((message) => message.role === 'user')?.id);
      const context = this.buildContext(userInput, existingSourceMessageId);

      // 添加用户消息（非用户消息仅注入 context 不渲染）
      const boundSourceMessageId = isUserMessage
        ? (this.emitMessage(userInput, 'user')?.id ?? undefined)
        : existingSourceMessageId;
      activityRunId = this.game.startAgentActivityRun(boundSourceMessageId);
      this.activeRunId = activityRunId;
      this.game.startAgentLogTurn({
        id: activityRunId,
        saveId: this.saveId,
        turn: (this.game.activeSave?.metadata?.totalTurns ?? 0) + 1,
        sourceMessageId: boundSourceMessageId,
      });
      this.game.setPendingOptions([]); // 新一轮开始，清掉上一轮的行动选项

      // 2. 构建 endpoints & context
      const endpoints = this.buildEndpoints();
      this.currentContext = context;
      this.pendingPlotTasks = [];
      this.lastStoryMessage = null;
      await this.loadPlotData(context);
      // 🧵 主线细化层：pre 开始前先求本轮闸门（on 时供值；失败静默 over）
      this.preparePlotThreadGate(context);

      // 2.5 加载预设和世界书（自 fetch agent-config.json，不依赖 store 异步初始化）
      const { presets, agentDefaults } = await this.loadPresets();
      const worldBooks = await this.loadActiveWorldBooks();

      // 2.6 构建 Agent 配置（用已加载的 agentDefaults 替代 projectAgentDefaults）
      const agentConfigs = this.buildAgentConfigs(agentDefaults, onStoryChunk);

      // 真机修(2026-07-17): 侧链 (char/item/craft) 调用 buildAgentMessages 时需要
      // configs/worldBooks/presets 才能拿到完整 systemPrompt + 世界书上下文，
      // 把这三个值挂实例传给事件回调（回调通过闭包捕获 run() 局部变量）。
      this.chainData = { agentConfigs, worldBooks, presets, agentDefaults };

      // Q-07：战斗外效果系统接线 —— 对当前存档已装备物品执行 init + 注册
      // （幂等；存档切换时由 unwireEffectSystem 拆除后重建）
      try {
        const { wireEffectSystem } = await import('@engine/effect-wiring');
        if (this.ownsActiveSave) wireEffectSystem(this.saveId, this.game.characters);
      } catch (err) {
        console.warn('[GamePipeline] 效果系统接线失败（不阻塞本轮）:', err);
      }

      // 3. 创建编排器
      const options: OrchestratorOptions = {
        pipeline: DEFAULT_AGENT_PIPELINE,
        context,
        agentConfigs,
        endpoints,
        saveId: this.saveId,
        presets,
        worldBooks,
      };
      const events = this.buildEventHandlers(activityRunId);
      this.orch = new AgentOrchestrator(options, events);

      // 4. 运行管线
      const orchResult = await this.orch.run();

      // 🔒 P0-03: 仅在管线成功完成时推进回合 + 打快照。
      // 此前无论 agent 是否失败/中止都 advanceTurn，会消耗玩家输入却不产生有效回复，
      // 还把半成品状态存进快照。status='failed'（管线校验失败、必需阶段失败、或 abort
      // 让 story fetch 抛 AbortError）时跳过 —— 玩家输入已入消息流但回合不推进，可安全重发。
      // refreshFromDb 仍会把已部分落库的 patch 回读，不丢已生成的正文。
      if (orchResult.status !== 'completed') {
        console.warn(
          '[GamePipeline] 管线未完成 (status=' + orchResult.status + ')，跳过回合推进/快照',
        );
        if (controller.signal.aborted) {
          activityOutcome = 'cancelled';
          activityMessage = '本回合已停下，可以再次尝试。';
        } else {
          activityOutcome = 'failed';
          activityMessage = '世界的回应在此中断，可以再次尝试。';
        }
        return false;
      }

      // 4.5 步5: 等待剧情落库任务（preCheckPlot/postCheckPlot/年度大纲）完成
      if (this.pendingPlotTasks.length > 0) {
        await Promise.all(this.pendingPlotTasks);
        this.pendingPlotTasks = [];
      }

      // 4.6 🧵 主线细化层收口：成功回合在 advanceTurn **之前**提交（幂等；
      //     失败只警示不阻塞本轮 —— 退出通道是既有诊断日志，不追加自动 LLM 重试）。
      try {
        await this.commitPlotThreadTurnIfAny();
      } catch (err) {
        console.warn('[GamePipeline] 主线细化收口失败（本回合细化未保存）:', err);
      }

      // 5. 回合推进（M5 每轮一拍）: totalTurns +1 + 打 reason='turn' 快照。
      //    放在 finally 的 refreshFromDb 之前，Pinia 能立即读到新 totalTurns/activeSnapshotId。
      try {
        await createStateManager(this.saveId).advanceTurn();
      } catch (err) {
        console.warn('[GamePipeline] advanceTurn 失败（不阻塞本轮）:', err);
      }

      activityOutcome = 'completed';
      return true;
    } catch (err) {
      // Abort 错误不视为真正的失败
      if ((err as Error)?.name === 'AbortError') {
        console.log('[GamePipeline] 管线已中止');
        activityOutcome = 'cancelled';
        activityMessage = '本回合已停下，可以再次尝试。';
        return false;
      }
      // 🔴 F10：显式端点绑定失效 = fail-stop。此时**任何 provider 都尚未收到请求**，
      // 本轮直接放弃（用户输入已入消息流、回合不推进，可修设置后重发）。
      if (err instanceof EndpointBindingError) {
        console.error('[GamePipeline] 端点绑定失效，本轮停发（fail-closed）:', err.message);
        activityOutcome = 'failed';
        activityMessage = err.message;
        try {
          useUIStore().toast(err.message, 'error', 6000);
        } catch {
          /* toast 失败不影响本轮失败判定 */
        }
        return false;
      }
      console.error('[GamePipeline] 管线运行失败:', err);
      activityOutcome = 'failed';
      activityMessage = '世界的回应在此中断，可以检查设置后再次尝试。';
      return false;
    } finally {
      // 🔴 并行化改造（2026-08-16）：后台任务（memory_summary embedding 落库 /
      // 剧情落库）不响应 abort，会在管线早退后悬空继续跑。回读之前统一收尾
      // （allSettled：postCheckPlot 等任务自带 try/catch，不拒绝也要兜底），
      // 否则 refreshFromDb 会读到任务写到一半的中间态。
      // completed 路径的 await 在 4.5 处已跑过（advanceTurn 之前），这里幂等。
      if (this.pendingPlotTasks.length > 0) {
        await Promise.allSettled(this.pendingPlotTasks);
        this.pendingPlotTasks = [];
      }
      // 🆕 管线中 StateManager / 侧链 (char_gen/item_gen/craft_gen) 直接写 Dexie，
      // 这里统一回读，让 Pinia 内存态（characters/metadata/saveProfile）与 DB 对齐，
      // DebugPanel 导出和右侧状态栏才能拿到最新数据。abort/报错时部分 patch 可能已提交，同样需要回读。
      // 🔴 COR-02：存档已切走时**不回读** —— refreshFromDb 读的是 store 里那个（新的）
      // activeSaveId，孤儿回合替新存档跑一次回读没有意义，还会跟新存档自己的加载打架。
      if (this.ownsActiveSave) await this.game.refreshFromDb(this.saveId);
      // 🎵 配乐放在**回读之后**才触发。
      //
      // story 在 Stage 1 就写下了标记，但那时 player.location / character.present
      // 还是上一轮的值 —— 它们要等 Stage 2 的 request_dispatcher / vars_update 落库、
      // 再经这里的 refreshFromDb 才更新。而**转场恰恰是唯一真正该换歌的时刻**：
      // 在 Stage 1 播，正文已经进了熔火裂谷，BGM 还在放上一座城的曲子。
      if (activityRunId) {
        this.game.finishAgentActivityRun(activityRunId, activityOutcome, activityMessage);
        this.game.finishAgentLogTurn(activityRunId, activityOutcome);
        const debugPrefix = `${activityRunId}\u0000`;
        for (const key of this.debugInvocationCounts.keys()) {
          if (key.startsWith(debugPrefix)) this.debugInvocationCounts.delete(key);
        }
        for (const key of this.mainInvocationIds.keys()) {
          if (key.startsWith(debugPrefix)) this.mainInvocationIds.delete(key);
        }
      }
      if (this.activeRunId === activityRunId) {
        this.activeRunId = null;
      }
      // 🔴 只有「我还是当前那一轮」才收拾这两样 —— 否则会解锁新一轮的输入框，
      // 并且把新一轮的控制器抹成 null（「停止生成」从此静默失效）。见 runSeq 的注释。
      if (this.runSeq === mySeq) {
        if (this.ownsActiveSave) this.game.isGenerating = false;
        this.abortController = null;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.abort();
    this.invalidatePromptSessions();
  }

  /** 中止当前管线运行 */
  abort(): void {
    if (this.activeRunId) this.game.markAgentActivityStopping(this.activeRunId);
    this.abortController?.abort();
  }

  /**
   * 🆕 T4（设计 §8.1 / §9）：存档切换/销毁时清掉本 pipeline 所属存档的全部 prompt
   * session。`invalidatePromptSession` 传 string（saveId）入参 = 清该存档全部
   * agent 的 session，其他存档 session 不受影响。本 pipeline 是 per-save 实例
   * （构造时带 saveId），所以这里只需要清自己的 saveId。
   *
   * 接线点：GamePage 的 onUnmounted（离开游戏页 = 存档切换/销毁的既有清理点，
   * 与 abort / sceneImages.abortAll 并列）。切档/删档都发生在离开游戏页之后，
   * 而 session 是模块级内存态 —— 不清的话旧存档的 transcript/签名会在内存里
   * 一直驻留。
   */
  invalidatePromptSessions(): void {
    invalidatePromptSession(this.saveId);
  }

  private updateAgentActivityStatus(agentId: string, runActivityId?: string): void {
    if (runActivityId === undefined) {
      this.game.updateAgentStatus(agentId);
      return;
    }
    this.game.updateAgentStatus(agentId, runActivityId);
  }

  private clearAgentActivityStatus(agentId: string, error?: string, runActivityId?: string): void {
    if (runActivityId !== undefined) {
      this.game.clearAgentStatus(agentId, error, runActivityId);
    } else if (error !== undefined) {
      this.game.clearAgentStatus(agentId, error);
    } else {
      this.game.clearAgentStatus(agentId);
    }
  }

  /**
   * 本管线是否仍属于当前打开的存档（COR-02）。
   *
   * abort 不是瞬时的 —— 在飞的 fetch 要等 AbortError 冒出来，已经开始的 await 链
   * 还会往下走几步。这道检查是漏网写入的第二道闸：`game-store` 的
   * `addMessage` / `persistMessage` 从 **store** 取 `activeSaveId`，所以一旦玩家在
   * 生成中途切到别的存档，孤儿回合的正文会以那个存档的 saveId 落库。
   */
  private get ownsActiveSave(): boolean {
    return !this.disposed && this.game.activeSaveId === this.saveId;
  }

  /**
   * 正文写入的唯一出口 —— 存档已切走就丢弃（COR-02）。
   * 返回 null 表示「这条没写进去」，调用方需要 message.id 时必须处理。
   */
  private emitMessage(content: string, role: 'user' | 'assistant'): ChatMessage | null {
    if (!this.ownsActiveSave) {
      console.warn('[GamePipeline] 存档已切换，丢弃孤儿消息', {
        pipelineSaveId: this.saveId,
        activeSaveId: this.game.activeSaveId,
        role,
      });
      return null;
    }
    return this.game.addMessage(content, role);
  }

  /**
   * 系统消息（char_gen 卡片等）的唯一出口 —— 同一道存档归属闸（COR-02）。
   *
   * 🔴 单开一个方法而不是只在调用点写 `if`：`game-store.addSystemMessage` 与
   * `addMessage` 落到**同一个** `persistMessage`（`saveId: activeSaveId.value`），
   * 所以它是与正文完全等价的一条落库路径。初版只收编了 `addMessage`，
   * 这一条就是绕过闸门的那个洞（2026-08-10 审查逮到）。
   */
  private emitSystemMessage(event: SystemEvent): void {
    if (!this.ownsActiveSave) {
      console.warn('[GamePipeline] 存档已切换，丢弃孤儿系统消息', {
        pipelineSaveId: this.saveId,
        activeSaveId: this.game.activeSaveId,
        type: event.type,
      });
      return;
    }
    this.game.addSystemMessage(event);
  }

  // ===== 私有方法 =====

  private buildAgentConfigs(
    agentDefaults: Record<string, Record<string, unknown>>,
    onStoryChunk?: StoryChunkCallback,
  ): AgentConfig[] {
    const s = this.settings.settings;

    // 需要参与管线的所有 Agent（不包括 plot_pre_check/plot_post_check — 剧情模式 off 时会自动禁用）
    const agentIds = [
      'memory_recall',
      'story',
      'request_dispatcher',
      'vars_update',
      'memory_summary',
      'plot_pre_check',
      'plot_post_check', // Phase 10g: quest 委托管线需要
      'craft_gen', // 侧链: 制作生成，需完整 systemPrompt (真机 fix 2026-07-18)
      'char_gen', // 侧链: 角色生成，需完整 systemPrompt
      'item_gen', // 侧链: 物品生成，需完整 systemPrompt + {{ITEM_REQUEST}} 占位符
      // 侧链: 战斗决策（combat-v3 Coordinator 在战斗会话中按 RequiredInput.PlayerCommand
      // 唤起，不走主 DAG）。systemPrompt/模型/温度/世界书照旧从这里装配 —— coordinator
      // 按 agentId === 'combat_v3' 从 ctx.configs 读（见 combat-v3/coordinator.ts 的
      // combatSystemPrompt），设置页 Agent 子导航可编辑。
      'combat_v3',
    ];

    // 复用 buildEndpoints() 的映射结果（ApiEntry.model → ApiEndpoint.defaultModel）
    const apiPool = this.buildEndpoints();

    // 🔴 F10（2026-09-04）：pool id → 端点的解析统一切到 `resolveAgentEndpoint`。
    //   Agent 设置层的 `model` 键（存 API 池 id，历史命名不改）经
    //   `getAgentSettings(覆写 ?? 默认层)` 得到「有效绑定」。语义拆分为：
    //     · 未设置（空串）          → 走默认端点（池首项）—— 首次配置体验不回归；
    //     · 显式绑定 + 池里有       → 精确命中；
    //     · 显式绑定 + 池里没有     → **fail-closed**：
    //         主 DAG agent（story/dispatcher/vars_update 等）= 抛 EndpointBindingError，
    //         run() 在 dispatch 之前停轮（绝不拿 apiPool[0] 顶替用户显式选过的 provider）；
    //         侧链 agent（craft/char/item/image_prompt/combat_v3）= warn + 不装配端点，
    //         真被调用时由 getEndpointForAgent 再判并按 optional 策略跳过。
    //   · 空池 + 未设置             → 与旧行为一致：endpoint undefined →
    //       apiEndpointId='' → 编排器按 `Endpoint "" not found` 淡失败（不抛新错）。
    //   D44 修正 1 保留：传默认层（agentDefaults）——model 也是 12 键之一，删 boot 播种后
    //   用户没覆写时唯一来源就是默认层。agentDefaults 在本方法参数里、闭包可直接用。
    const getEndpoint = (agentId: string): ApiEndpoint | undefined => {
      const poolId = getAgentSettings(s, agentId, agentDefaults).model;
      const resolution = resolveAgentEndpoint({ boundPoolId: poolId, apiPool });
      if (resolution.status === 'resolved') return resolution.endpoint;
      if (SIDE_CHAIN_AGENT_IDS.has(agentId)) {
        console.warn(
          resolution.status === 'stale-binding'
            ? `[GamePipeline] 侧链 Agent "${agentId}" 显式绑定的 API 池已不存在（原 id: ${resolution.requestedId}），本轮不装配端点（fail-closed，不会换 provider）`
            : `[GamePipeline] 侧链 Agent "${agentId}" 解析不到端点（API 池为空），本轮不装配端点`,
        );
        return undefined;
      }
      // 主 DAG：显式绑定失效 = 停轮（run() 捕获 EndpointBindingError → 放弃本轮，不发请求）
      if (resolution.status === 'stale-binding') {
        throw new EndpointBindingError(agentId, resolution.requestedId);
      }
      // missing-pool（空池 + 未设置）：老路淡失败，交给编排器报 not found
      return undefined;
    };

    return agentIds.map((agentId) => {
      const isStory = agentId === 'story';
      const signal = this.abortController?.signal;
      const endpoint = getEndpoint(agentId);
      const model = endpoint?.defaultModel || '';
      if (!model) {
        console.error(
          `[GamePipeline] agent "${agentId}" — 未配置模型！请在设置页为该 Agent 选择 API 池并确保池中有默认模型`,
        );
      }
      console.log('[GamePipeline] agent:', agentId, 'endpoint:', endpoint?.id, 'model:', model);

      // 🆕 为 story agent 构建流式回调（如果提供了 onStoryChunk）
      let streamCallbacks: StreamCallbacks | undefined;
      if (isStory && onStoryChunk) {
        let streamedRaw = '';
        streamCallbacks = {
          onChunk: (text: string, isComplete: boolean) => {
            if (isComplete) {
              // 🔴 2026-08-16（Agent 重试）：`text === ''` 是 AgentClient 重试循环
              // 的清预览信号 —— 失败重试前会调 onChunk('', true)。必须重置
              // streamedRaw，否则重试生成的新正文与第一段失败前的半截拼接显示。
              if (text === '') streamedRaw = '';
              onStoryChunk('', true);
              return;
            }
            streamedRaw += text;
            onStoryChunk(projectStreamingStory(streamedRaw), false);
          },
          onComplete: () => {
            // 流式完成 — 最终结果由 handleAgentResult 处理
          },
          onError: (error: string) => {
            console.warn('[GamePipeline] story 流式错误:', error);
            onStoryChunk('', true);
          },
        };
      }

      // defaults 层 = loadPresets 自 fetch agent-config.json 解析出的完整默认层
      // （D44 修正 1：覆盖 AgentSettingsEntry 12 键 + presetId/ejsVarsCommit）。
      const defaults = agentDefaults[agentId] ?? {};
      // 🔴 D44 修正 1/3：经 getAgentSettings 统一 resolve（覆写 ?? 默认），不再分别
      //    `defaults.X || agentCfg.X`（那是默认优先、覆写被无视）与 `agentCfg.X`（裸取覆写）。
      //    agentCfg 现在已合默认层，下面 systemPrompt/template/worldBookIds/数值全部读它。
      const agentCfg = getAgentSettings(s, agentId, agentDefaults);
      // 真机修(2026-07-17): story 预设尊重设置页选中项（s.activePresetId）——
      // 此前硬绑 agent-config.json 出厂 presetId，用户导入/另存的预设（新 id）在设置页编辑得再对，
      // 运行时也永远用旧的那份（"我保存了第二人称但 agent 没拿到"根因）。
      const presetId: string | undefined =
        agentId === 'story' && s.activePresetId
          ? s.activePresetId
          : (defaults.presetId as string | undefined) || undefined;
      const worldBookEnabled = agentCfg.worldBookEnabled;
      const worldBookIds = worldBookEnabled ? agentCfg.worldBookIds : [];
      // 命定核心轴已下线（2026-09-16 精简）：不再有 system_core 存档级单选，
      // agent 世界书一律走配置的 worldBookIds；老档残余 system_core 条目仍由
      // worldbook-loader 的存档级过滤自然兼容。

      // systemPrompt/template 统一读 agentCfg（已合覆写 ?? 默认）。空串 → undefined
      // （AgentConfig 里 undefined = 不发该字段，与原 `defaults.X || undefined` 行为一致）。
      const resolvedSystemPrompt: string | undefined = agentCfg.systemPrompt || undefined;
      const resolvedTemplate: string | undefined = agentCfg.template || undefined;
      // 🆕 T4（设计 §9 / 2026-08-22）：单一 tailPrompt 从 agentCfg 读（getAgentSettings
      //    已把空白归一化为 undefined = 不注入）。AgentConfig 缺省时 assembler 侧不产
      //    tail 标签，也不改变 baseline signature 的其余项。
      const resolvedTailPrompt: string | undefined = agentCfg.tailPrompt || undefined;

      return {
        agentId,
        enabled: true,
        apiEndpointId: endpoint?.id ?? '',
        model,
        // D44 修正 3：数值从 agentCfg 读（已合覆写 ?? 默认 ?? AGENT_SETTINGS_DEFAULTS）。
        temperature: agentCfg.temperature,
        maxTokens: agentCfg.maxTokens,
        topP: agentCfg.topP,
        frequencyPenalty: agentCfg.freqPen,
        presencePenalty: agentCfg.presPen,
        retryOnFail: true,
        // 🆕 2026-08-16: 失败自动重试次数（AgentClient 循环上限；外部取消永不重试）。
        // 解析值经 覆写 ?? 默认层 ?? AGENT_SETTINGS_DEFAULTS(3)。
        maxRetries: agentCfg.maxRetries,
        timeout: 120000,
        userId: `fp|${this.saveId}|${agentId}`,
        promptTemplate: {
          fixedSystem: agentCfg.systemPrompt,
          fixedExamples: '',
        },
        presetId,
        worldBookIds,
        // 🔴 D44 修正 3：precedence 统一为 覆写 ?? 默认（经 getAgentSettings）。
        //    此前这里是 `defaults.systemPrompt || agentCfg.systemPrompt`（默认优先、
        //    覆写被无视）—— 用户在设置页改的提示词进不了运行时。现在 agentCfg 已合
        //    两层，直接读它即可。
        systemPrompt: resolvedSystemPrompt,
        template: resolvedTemplate,
        // 🆕 T4（设计 §9 / 2026-08-22）：单一末尾指令。空白已在 agentCfg 归一化。
        tailPrompt: resolvedTailPrompt,
        // 工坊 P2 (ADR-30 D5): 只有持权 Agent 的装配 pass 产出 EJS vars 提交候选。
        // 代码级兜底：agent-config.json 没加载上（fetch 失败/离线）或该 agent 未声明本字段时，
        // story 默认持权 —— 与设计「默认仅 story 持权」一致。否则一次网络抖动就让整条
        // EJS→vars 提交链静默哑火（EJS 照跑、写照丢，无任何征兆）。显式 false 仍然生效。
        ejsVarsCommit: (defaults.ejsVarsCommit as boolean | undefined) ?? isStory,
        toolsEnabled: ['craft_gen', 'char_gen', 'item_gen'].includes(agentId),
        maxToolCallRounds: 10,
        // 🆕 流式 + abort 信号
        streamCallbacks,
        abortSignal: signal,
      } as AgentConfig;
    });
  }

  private buildEndpoints(): ApiEndpoint[] {
    return buildApiEndpoints(this.settings.settings.apiPool ?? []);
  }

  /**
   * `{{RANDOM_EVENTS}}` 的数据面（随机事件 §5.1 步 2）——**只过滤不写库**。
   *
   * 池空 / 没有存档档案 → `undefined`（区块整段不出，零 token）。
   * 抛错 → 同样 `undefined` + 一条 warn：候选算不出来只是这一回合不注入，
   * 绝不能让提示装配整个失败（承铁则 4「算不出来保持原值」）。
   */
  private buildRandomEventOffer(): RandomEventOfferEntry[] | undefined {
    const profile = this.game.saveProfile;
    if (!profile) return undefined;
    try {
      const flags = getRandomEventFlags(profile);
      // 便宜的早退：池空是绝大多数回合的常态，不必为它建一份上下文快照
      if (!flags.pending || flags.pending.length === 0) return undefined;
      const pack = getRandomEventPack();
      const currentDay = Math.floor(toEpochMinutes(profile.gameTime) / MINUTES_PER_GAME_DAY);
      // 上下文快照与入池侧**共用同一份实现**（`random-event-snapshot`）：两侧不同口径的
      // 表现是「入池了但注入面当场把它滤掉」，而两边都不报错
      const player = this.game.characters.find((c) => c.type === 'player');
      return buildRandomEventOffer(
        pack.defs,
        pack.config,
        flags,
        buildRandomEventRollContext(profile, player),
        currentDay,
      );
    } catch (err) {
      console.warn('[GamePipeline] 随机事件候选快照构建失败（本回合不注入）:', err);
      return undefined;
    }
  }

  private buildContext(userInput: string, excludeMessageId?: string): AgentContext {
    // 构建历史消息（只取 user/assistant，不含 system）
    const history = this.game.messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.id !== excludeMessageId)
      .map((m) => ({ ...m }));

    // 步5: 读存档级剧情配置（捏人页 startJourney 落 metadata.plotSettings）；老存档无字段 → off 兜底
    const meta = this.game.activeSave?.metadata as Record<string, any> | undefined;
    const plotSettings = meta?.plotSettings ?? { mode: 'off', tabooContent: '' };

    // 🆕 向量召回惰性回填（随机事件旁路，fire-and-forget）：旧记忆的 `embedding` 为
    // undefined 会让它们永远归 fallback 排序（重要度 + 时间），永远进不了 compatible 段。
    // 每轮上下文构建时扫一眼缺失条、重嵌一小批 → 下一轮起它们是真正的余弦匹配。
    // 失败是常态（网络/端点临时不可用）→ 单条失败仅记日志、不影响本轮编排与并发方。
    this.maybeBackfillMissingMemories();

    return {
      userInput,
      history,
      worldBooks: [],
      characters: this.game.characters,
      variables: this.game.saveProfile?.variables ?? {}, // M5 §12: 变量唯一真源 SaveProfile.variables（M6 收官接线）
      plotEvents: this.game.activePlotEvents,
      memories: this.game.recentMemories,
      quests: this.game.saveProfile?.quests,
      agentOutputs: new Map(),
      plotSettings,
      gameTime: this.game.gameTime ?? undefined,
      // 🗺 地图 v1 §8.1: `{{MAP_CONTEXT}}` 的两格可变输入。**必须在这里供值** ——
      //    占位符自己去读 Pinia 就把引擎的依赖方向反过来了（map-runtime 那条缝同理）。
      //    漏供的症状不是报错，是那个块静默消失（blurByDefault 的教训），
      //    故 placeholder-registry.map-context.test.ts 有一条源码断言盯着这两行。
      mapFlags: this.game.saveProfile ? getMapFlags(this.game.saveProfile) : undefined,
      // 🗺 地图 v1.2 §5: 地块事实态（状态/发展度/建筑/编年史）。与上一行是**两袋**，
      //    自愈语义相反（事实永不随 packStamp 清空）—— 同一条铁律：供值必须在这里，
      //    漏供的症状是 `{{MAP_CONTEXT}}` 的动态四行与 `$map.statuses` 静默永远为空。
      mapFacts: this.game.saveProfile ? getMapFactsFlags(this.game.saveProfile) : undefined,
      weather: resolveSceneWeather(this.game.saveProfile),
      // 🔴 2026-08-13 真机 debug：最近已结算战斗（{{RECENT_COMBAT}} 的数据源）。
      //    与上面两行同一条铁律：供值必须在 buildContext —— 漏供的症状同样是
      //    区块静默消失（dispatcher 又开始战后重触发，谁也看不见为什么）。
      recentCombat: this._recentCombat ?? undefined,
      // 🎲 随机事件 v1 §5.1: `{{RANDOM_EVENTS}}` 的三格输入，**同一条铁律 —— 供值必须在这里**。
      //    ① 候选快照（纯函数产出，只过滤不写库）
      //    ② 总开关（裁定 §13-4；关掉 = 注入空串）
      //    ③ 战斗会话活跃位（裁定 §13-2；战斗期间全面静默，战后下一回合恢复）——
      //      取 `isInCombat`（就绪/结算确认/v2/v3 四判据同源），**不是** `recentCombat`：
      //      后者是战后回执，拿它当活跃位会让静默恰好落在该恢复注入的那几轮。
      //    漏供任一格的症状都不是报错，是那个块静默消失或永远静默（blurByDefault 的教训），
      //    故 placeholder-registry.random-events.test.ts 有一条源码断言盯着这三行。
      randomEventOffer: this.buildRandomEventOffer(),
      // 委托板（卡牌工坊）：静态（内容包第 15 面）+ 动态（事件委托：随机事件触发生成，
      // 按 gameTime 折算 gameDay 过滤过期）。漏供的症状同样不是报错，是委托块静默消失。
      commissionDefs: this.commissionDefsForAI(),
      // 天赋（卡牌工坊）：玩家 CharacterState.talents 快照（{{TALENT}} 数据源；
      // 玩家无天赋时为 undefined → 块静默，出身必选保证建档即有）。
      talents: this.game.player?.talents,
      // 行动选项方案（2026-09-23 共识稿）：存档级选择（worldFlags）+ 全局自定义库
      // （settings）。{{OPTION_POLICY}} 数据源；id 缺席/未知由 resolveOptionScheme 回落标准。
      optionSchemeId: (this.game.saveProfile?.worldFlags as Record<string, unknown> | undefined)?.[
        'optionSchemeId'
      ] as string | undefined,
      customOptionSchemes: getEngineSettings().optionSchemes,
      // 叙事意图（纯记不向路线）：每天赋一条当前意图，持续注入（再声明即替换）。
      narrativeIntents: this.game.saveProfile?.narrativeIntents ?? [],
      randomEventsEnabled: getEngineSettings().randomEventsEnabled,
      combatActive: this.game.isInCombat,
      // 🔴 2026-08-02 修: 初始技能走 item_gen 链路 —— request_dispatcher 的 {{SKILL_STATE}}
      //    需要读到捏人页选的初始技能声明（存在 openingPrompt 里），否则主角 skills 落库为空的
      //    开局永远发不出 `<item_gen_request itemType="skill">`，技能没有 modifiers/automata。
      openingPrompt: this.game.openingPrompt ?? undefined,
      // 工坊 P2 (ADR-30 D4/D9): stats 只读投影每回合构建一次，同回合多 Agent 装配复用
      //（各 pass 在 buildAgentMessages 内再克隆一份，杜绝跨 pass 写泄漏）
      statData: buildStatData({
        characters: this.game.characters,
        gameTime: this.game.saveProfile?.gameTime,
        fp: this.game.saveProfile?.fp,
        reputation: this.game.saveProfile?.reputation ?? 0,
        turn: history.length,
        // 🔴 漂移修复（地图 v1 §5 接线表）：`stat-projection` 一直会写 `stats.世界.天气`，
        //    只是**从来没人供值** —— 于是世界书里每一处 `stats.世界.天气` 都读不到那个键，
        //    而条目自己的 `|| '未知'` 兜底把这件事掩盖得干干净净。与上面 `weather:` 同一次读法
        //    （同一条链、同一个函数），状态面板 / stats / world.天气 / $map.weatherNow 因此不会互相漂
        weather: resolveSceneWeather(this.game.saveProfile),
      }),
      // 能力面 T2 (§7): EJS 随机种子 = (存档, 回合号)。快照回退重放同一回合 → 同一份世界书正文。
      // 回合号取历史长度：它随回合单调增长，且快照回退时会连同历史一起回到旧值 —— 正是我们要的。
      ejsSeed: buildPassSeed(this.game.activeSaveId ?? undefined, history.length),
      // 能力面 T5 (§3.4/§3.6/§3.11): char.affection / quest.focus / ui.* 的数据与出口
      affections: this.game.saveProfile?.affections,
      focusQuest: this.game.saveProfile?.focusQuest,
      ejsNotify: (message, level) => {
        // 🔴 **强制来源前缀**：项目名可能伪装成「系统提示」（§12 待拷问 6）。
        //    玩家必须一眼看出这句话是世界书内容说的，不是引擎说的。
        try {
          useUIStore().toast(
            `内容说：${message}`,
            level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info',
            5000,
          );
        } catch (err) {
          console.warn('[GamePipeline] EJS ui.notify 失败:', err);
        }
      },
      ejsLog: (args) => {
        // 进 store 的环形缓冲，**不落真 console**（世界书刷屏会淹掉真正的报错）
        try {
          this.game.recordEjsUiLog?.(
            args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
          );
        } catch {
          // 诊断出口不能反过来打断提示装配
        }
      },
      // 条目 EJS 失败已回退原文注入 —— 静默失效，必须能在 DebugPanel 与导出 JSON 里看到
      ejsFallback: ({ agentId, entries }) => {
        try {
          this.game.recordEjsFallback?.(agentId, entries);
        } catch (err) {
          console.warn('[GamePipeline] 记录 EJS 回退诊断失败:', err);
        }
      },
      // 工坊 P2 (ADR-30 D5): 持权 Agent 的 vars 草稿运输容器；提交由回合结算消费（T6）
      ejsVarsDrafts: new Map(),
    };
  }

  /** 步5: mode≠off 时从 DB 加载大纲 + 全量剧情事件（Pinia 的 activePlotEvents 可能滞后）挂到 context */
  private async loadPlotData(context: AgentContext): Promise<void> {
    if (context.plotSettings?.mode === 'off') return;
    try {
      const { getLatestPlotOutline, getPlotEvents } = await import('@engine/database');
      const [outline, events] = await Promise.all([
        getLatestPlotOutline(this.saveId),
        getPlotEvents(this.saveId),
      ]);
      if (outline) context.plotOutline = outline;
      if (events?.length) context.plotEvents = events;
    } catch (err) {
      console.warn('[GamePipeline] 剧情数据加载失败（不阻塞本轮）:', err);
    }
  }

  /** 加载 story 预设：DB 优先（用户可修改）→ agent-config.json 内嵌 preset fallback 补齐缺失。
   *  同时返回各 agent 的**完整默认层**（D44 修正 1：12 键 + presetId/ejsVarsCommit/preset），
   *  自给自足 fetch agent-config.json，不依赖 store 的 projectAgentDefaults 异步加载时序。
   *
   *  🔴 D44 修正 1：返回的 agentDefaults 同时充当 `getAgentSettings` 的 defaultsLayer 参数
   *     ——删 boot 播种后，世界书/model/数值的唯一默认来源就是这里。*/
  private async loadPresets(): Promise<{
    presets: AgentPreset[];
    agentDefaults: Record<string, Record<string, unknown>>;
  }> {
    let presets: AgentPreset[] = [];
    const agentDefaults: Record<string, Record<string, unknown>> = {};

    // 1. DB 优先：用户可能通过设置页修改过预设
    try {
      const { getPresets } = await import('@engine/database');
      const dbPresets = await getPresets();
      if (dbPresets && dbPresets.length > 0) {
        presets = dbPresets as unknown as AgentPreset[];
      }
    } catch {
      // IndexedDB 不可用时静默跳过
    }

    // 2. 经 ContentProvider 收口加载 agent-config.json（波 1 T2 / D16）。
    //    provider 内部 await contentReadyPromise（T7 pack 叠加层的灌注点）+ 上报 contentStatus。
    //    provider 失败时返回空骨架（agents={}）并 console.warn（保留原「必须留痕」语义）。
    try {
      const { useContentStore } = await import('../stores/content-store');
      const config = (await useContentStore().loadProjectDefaults()) as {
        agents?: Record<string, any>;
      };
      const agents = config.agents || {};
      if (Object.keys(agents).length === 0) {
        // provider 返回空骨架 = 占位 fetch 失败或文件缺失。原行为是 console.warn。
        console.warn(
          '[GamePipeline] agent-config.json 加载为空，Agent 默认配置回落（EJS vars 提交权走代码兜底）',
        );
      }
      for (const [agentId, entry] of Object.entries(agents)) {
        const e = entry as any;
        // 提取内嵌预设（story 等依赖 ST 预设的 Agent）
        if (e.preset && !presets.some((p) => p.id === (e.preset as any).id)) {
          presets.push(e.preset as unknown as AgentPreset);
        } else if (e.preset) {
          // 真机诊断(2026-07-17): DB 版预设（设置页编辑过的）优先于 agent-config.json 内嵌版 — 设计行为。
          // 直接改 agent-config.json 不会生效于已存在的 DB 记录；要么在设置页编辑，要么删除 DB 预设回落出厂版。
          console.warn(
            `[GamePipeline] 预设 "${(e.preset as any).name ?? (e.preset as any).id}" 使用 DB 版本（设置页编辑优先），agent-config.json 内嵌版被忽略`,
          );
        }
        // 提取各 agent 完整默认层（D44 修正 1）—— 收齐 AgentSettingsEntry 12 键 +
        // presetId/ejsVarsCommit（preset 已在上面单独提进 presets[]）。
        // getAgentSettings 经此合「覆写 ?? 默认」，删 boot 播种后世界书/model/数值
        // 的唯一默认来源就是这里。原样保留 agent-config.json 给的字段（包括 undefined
        // 语义相关的 historyLayers/historySlice —— 不塌成默认）。
        agentDefaults[agentId] = {
          model: e.model,
          worldBookEnabled:
            typeof e.worldBookEnabled === 'boolean' ? e.worldBookEnabled : undefined,
          worldBookIds: Array.isArray(e.worldBookIds)
            ? [...(e.worldBookIds as string[])]
            : undefined,
          systemPrompt: typeof e.systemPrompt === 'string' ? e.systemPrompt : undefined,
          template: typeof e.template === 'string' ? e.template : undefined,
          temperature: typeof e.temperature === 'number' ? e.temperature : undefined,
          topP: typeof e.topP === 'number' ? e.topP : undefined,
          freqPen: typeof e.freqPen === 'number' ? e.freqPen : undefined,
          presPen: typeof e.presPen === 'number' ? e.presPen : undefined,
          maxTokens: typeof e.maxTokens === 'number' ? e.maxTokens : undefined,
          maxRetries: typeof e.maxRetries === 'number' ? e.maxRetries : undefined,
          historyLayers: typeof e.historyLayers === 'number' ? e.historyLayers : undefined,
          historySlice: typeof e.historySlice === 'number' ? e.historySlice : undefined,
          presetId: e.presetId || undefined,
          // 工坊 P2 (ADR-30 D5): EJS vars 提交权（出厂仅 story 置 true）。
          // 字段缺席时保留 undefined（不塌成 false）——由 buildAgentConfigs 走代码级兜底。
          ejsVarsCommit: typeof e.ejsVarsCommit === 'boolean' ? e.ejsVarsCommit : undefined,
        };
      }
    } catch (err) {
      // 不再静默：这份配置是 systemPrompt / template / ejsVarsCommit 的唯一来源，
      // 加载失败会让各 Agent 回落到 localStorage 版本、并让 EJS vars 提交权走代码级兜底
      // （见 buildAgentConfigs 的 `defaults.ejsVarsCommit ?? isStory`）。必须留痕。
      console.warn(
        '[GamePipeline] agent-config.json 加载失败，Agent 默认配置回落（EJS vars 提交权走代码兜底）:',
        err,
      );
    }

    return { presets, agentDefaults };
  }

  /** 加载启用世界书：统一数据源（store 优先 + 文件兜底），与 plot_outline 共用 */
  private async loadActiveWorldBooks(): Promise<WorldBook[]> {
    try {
      // 统一数据源：worldbook-store 优先（Dexie，含用户在 WorldBookEditor 的 enabled 修改
      // + 自建书 + 工坊书）+ 文件兜底。init() 幂等，保证「消费必在迁移之后」。
      // catch 兼顾单测里没有 activePinia 的场景 —— 与迁移前的空数组行为一致。
      const wb = useWorldBookStore();
      await wb.init();
      const all = await loadWorldBooksWithFallback(wb.books as WorldBook[]);
      const enabledEntries = this.game.activeSave?.metadata?.enabledWorldBookEntries ?? [];
      return filterBooksByEnabledEntries(all, enabledEntries);
    } catch {
      return [];
    }
  }

  /**
   * 按 agentId 解析侧链 endpoint —— 尊重设置页为各 Agent 选的 API 池。
   * 🔴 F10（2026-09-04）：解析语义已与主 DAG 统一到 `resolveAgentEndpoint`。
   *    · 未设置              → 默认端点（池首项）；
   *    · 显式绑定 + 池里有   → 精确命中；
   *    · 显式绑定失效        → console.error（带 agent 名 + 失效 id，肉眼可见）
   *        + 返回 undefined → 调用方的 `if (!endpoint)` 守卫按既有 optional 策略跳过，
   *        **绝不换用池里别的 provider**；
   *    · 空池 + 未设置       → undefined（老路淡失败）。
   *   与 buildAgentConfigs 同一 boundPoolId 口径：也过默认层（chainData.agentDefaults），
   *   否则两侧对同一个 agent 可能解析出不同的池。（createAgentClients 已在 2026-07-30
   *   退役；此前它拿 getDefaultEndpoint() 池首项无视用户选择的历史错误不再可能复现。）
   */
  private getEndpointForAgent(agentId: string): ApiEndpoint | undefined {
    const s = this.settings.settings;
    const apiPool = this.buildEndpoints();
    const poolId = getAgentSettings(s, agentId, this.chainData?.agentDefaults ?? {}).model;
    const resolution = resolveAgentEndpoint({ boundPoolId: poolId, apiPool });
    if (resolution.status === 'resolved') return resolution.endpoint;
    if (resolution.status === 'stale-binding') {
      // 🔴 悬空 id 按来源分（2026-09 真机）：用户覆写层 = 用户显式选择 → fail-closed；
      //    默认层（内容包 `agentDefaults`）= 内容包塞的设备本地 pool id → 不是用户的选择，
      //    更不该因为一个坏字段把整条链静默掐掉（真机：item_gen 默认层绑了个坏 id，
      //    dispatcher 发的 8 条 `<item_gen_request>` 一条都没落库）。回落默认端点 + 可见 warn。
      if (!hasExplicitAgentModel(s, agentId)) {
        console.warn(
          `[GamePipeline] 侧链 Agent "${agentId}" 的内容包默认 API 池已不存在（id: ${resolution.requestedId}）` +
            ' —— 不是用户显式选择，回落默认端点（内容包应把 agentDefaults.model 留空）',
        );
        const fallback = resolveAgentEndpoint({ boundPoolId: undefined, apiPool });
        return fallback.status === 'resolved' ? fallback.endpoint : undefined;
      }
      // 用户显式选择的池没了 → 跳过即可，但跳过必须是**可见**的，不是静默换 provider
      console.error(
        `[GamePipeline] 侧链 Agent "${agentId}" 显式绑定的 API 池已不存在（原 id: ${resolution.requestedId}）。` +
          '按 fail-closed 策略跳过该侧链（绝不换用别的 provider），请到设置 → Agent 配置重新选择 API 池',
      );
      return undefined;
    }
    console.warn(`[GamePipeline] 侧链 Agent "${agentId}" 解析不到端点（API 池为空），跳过`);
    return undefined;
  }

  private nextDebugInvocation(agentId: string, runId = this.activeRunId ?? 'detached') {
    const key = `${runId}\u0000${agentId}`;
    const ordinal = (this.debugInvocationCounts.get(key) ?? 0) + 1;
    this.debugInvocationCounts.set(key, ordinal);
    return { invocationId: `${runId}:${agentId}:${ordinal}`, ordinal };
  }

  /** 创建 AgentClient 工厂 —— 供 craft_gen / char_gen / item_gen 链使用。
   *  🆕 包裹一层 LogClient：拦截 chat / chatWithTools，自动写 agentLog，
   *  让侧链 Agent 在 DebugPanel 可见（否则绕过 orchestrator 时无日志）。 */
  private getClientFactory(runActivityId = this.activeRunId ?? undefined) {
    const saveId = this.saveId;
    const game = this.game;
    const debugTurnId = runActivityId ?? this.activeRunId ?? 'detached';
    // 🔴 侧链的取消信号（2026-08-10）。此前侧链**完全不响应 abort**：下面的包装层把
    // `signal` 当入参转发，而 char_gen / item_gen / craft_gen / 战斗的调用方一个都没传，
    // 于是 `abort()` 只掐得动 story（`callAgent` 显式传了 signal）。后果有两层：
    //   ① 离开游戏页之后侧链照跑（item_gen 单次可达 300s），钱照花、结果照落库；
    //   ② 「停止生成」把 isGenerating 清成 false → 输入框解锁 → 玩家可以开下一回合，
    //      而上一回合的侧链仍在飞，两轮对**同一个存档**交错写入。
    // ② 才是真正的理由：这不是偏好问题，是并发写入危害。
    //
    // 在**工厂创建时**取信号而不是每次调用时取：工厂是每次侧链调用现造的
    // （5 个调用点，全在 run() 之内），所以这一份天然绑定「创建它的那一轮」。
    // 每次调用现取的话，上一轮的侧链发起新请求时会读到**新一轮**的控制器，
    // 于是老 abort 掐不动它 —— 正好丢掉这条修复想要的那个效果。
    const turnSignal = this.abortController?.signal;
    return (agentId: string, endpoint: ApiEndpoint, _saveId: string) => {
      // 🔴 2026-08-02: item_gen 批量生成后单次调用耗时暴涨（9 个请求一次生成 ≈ 240s+），
      // API 池默认 timeout 60s 会掐断。item_gen 独立链（不走 orchestrator 的 config.timeout）
      // 在 client 构造时单独放大超时，避免"思考完没来得及输出"就超时。
      // 🆕 2026-08-16: 重试次数从 chainData 的 AgentConfig 解析（设置页旋钮），
      // 缺省 1 次。⚠️ item_gen 超时 300s × 3 次重试最坏约 15 分钟 —— 超时罕见，
      // 且 per-agent 旋钮可调（侧链默认随 agent-config 的 3）。
      const chainCfg = this.chainData?.agentConfigs.find((c) => c.agentId === agentId);
      const real = new AgentClient({
        endpoint,
        agentId,
        saveId,
        timeout: agentId === 'item_gen' ? 300000 : undefined, // 300s；其余 agent 沿用 endpoint.timeout
        maxRetries: chainCfg?.maxRetries ?? 1,
      });
      const label = AGENT_LABELS[agentId] ?? agentId;
      const record = (
        invocation: { invocationId: string; ordinal: number },
        startedAt: number,
        messages: Array<{ role: string; content: string | null }>,
        result: Partial<AgentResult> | undefined,
        duration: number,
      ) => {
        game.addAgentLogEntry(
          buildDebugEntry({
            invocationId: invocation.invocationId,
            turnId: debugTurnId,
            agentId,
            label: invocation.ordinal > 1 ? `${label} #${invocation.ordinal}` : label,
            endpoint,
            messages,
            result,
            duration,
            startedAt,
            completedAt: Date.now(),
          }),
        );
      };

      const startTs = () => Date.now();

      // 从 chat 方法入参提取 messages：chat(messages, signal) 入参是数组本身，
      // chatWithTools(request, ...) 入参是 { messages, ... } 对象 —— 两者形状不同，需兼容。
      const extractMessages = (arg: any): Array<{ role: string; content: string | null }> =>
        Array.isArray(arg) ? arg : (arg?.messages ?? []);

      // 包裹对象：与 AgentClient 同形状，拦截关键方法
      return {
        get agentId() {
          return agentId;
        },
        get endpoint() {
          return endpoint;
        },
        chat: async (request: any, signal?: any) => {
          const t0 = startTs();
          const invocation = this.nextDebugInvocation(agentId, runActivityId);
          let result: any;
          try {
            // 调用方给了就用它的，没给才回落本轮信号（见 turnSignal 那段注释）
            result = await real.chat(request, signal ?? turnSignal);
          } catch (err: any) {
            record(
              invocation,
              t0,
              extractMessages(request),
              { error: String(err?.message ?? err) },
              Date.now() - t0,
            );
            throw err;
          }
          record(invocation, t0, extractMessages(request), result, Date.now() - t0);
          return result;
        },
        chatWithTools: async (request: any, toolExecutor: any, options?: any) => {
          const t0 = startTs();
          const invocation = this.nextDebugInvocation(agentId, runActivityId);
          let result: any;
          try {
            result = await real.chatWithTools(
              request,
              async (name: string, args: Record<string, any>) => {
                try {
                  const toolResult = await toolExecutor(name, args);
                  game.recordAgentToolActivity(agentId, name, args, toolResult, runActivityId);
                  return toolResult;
                } catch (error) {
                  game.recordAgentToolActivity(
                    agentId,
                    name,
                    args,
                    { error: error instanceof Error ? error.message : String(error) },
                    runActivityId,
                  );
                  throw error;
                }
              },
              {
                ...options,
                signal: options?.signal ?? turnSignal,
              },
            );
          } catch (err: any) {
            record(
              invocation,
              t0,
              extractMessages(request),
              { error: String(err?.message ?? err) },
              Date.now() - t0,
            );
            throw err;
          }
          record(invocation, t0, extractMessages(request), result, Date.now() - t0);
          return result;
        },
        // chatStream 不常用（侧链不走流式），直接透传（信号回落同上）
        chatStream: (request: any, callbacks: any, signal?: any) =>
          real.chatStream(request, callbacks, signal ?? turnSignal),
      } as any;
    };
  }

  // ===== 工坊 P2 (ADR-30 D5): EJS `vars` 差量提交 =====

  /**
   * 把一个 stage 内持权 Agent 的 EJS `vars` 草稿差量落库。
   *
   * **由 Orchestrator 在「本 stage 的 Agent 全跑完、标记处理之前」await 调用**——
   * vars_update / request_dispatcher 的 AI 变量补丁正是在标记处理里提交的，
   * 所以这个位置就是契约里那句「EJS 差量先落、AI 补丁后落」的物理落点：
   * 同路径冲突时 AI 覆盖 EJS（设计 §0 / D5）。
   *
   * 顺序口径: **管线阶段序**（本方法每 stage 调一次，天然按阶段推进）
   * + **同阶段 agentId 字典序**（下面的 `.sort()`）。与 D5 白纸黑字一致。
   *
   * 整条路径不抛错 —— EJS 是簿记旁路，出问题不该吞掉本轮正文。
   */
  private async flushEjsVarsDiffs(agentIds: string[]): Promise<void> {
    const drafts = this.currentContext?.ejsVarsDrafts;
    if (!drafts || drafts.size === 0) return;

    // 同阶段字典序 —— 多个持权 Agent 时后者同路径覆盖前者，顺序必须确定
    const ordered = [...agentIds].filter((id) => drafts.has(id)).sort();
    if (ordered.length === 0) return;

    const diffs: EjsVarsDiff[] = [];
    for (const agentId of ordered) {
      const entry = drafts.get(agentId);
      // 消费即摘表: 同一份草稿不会在后续 stage 被重复提交
      drafts.delete(agentId);
      if (!entry) continue;

      let diff: EjsVarsDiff;
      try {
        diff = diffVars(entry.base ?? {}, entry.draft ?? {});
      } catch (err) {
        console.warn(`[GamePipeline] EJS 变量差量计算失败（来源 ${agentId}），跳过:`, err);
        continue;
      }
      // 空 diff 不传 —— 绝大多数回合世界书只读不写，不该白跑一次写事务
      if (diff.replace.length === 0 && diff.remove.length === 0) continue;

      const size = measureDiffSize(diff);
      if (size > EJS_DIFF_SIZE_LIMIT) {
        // 整份拒绝: 不截断、不部分提交（截断状态机的半棵写入比冻结它更糟）
        this.rejectEjsVarsDiff(agentId, size);
        continue;
      }
      diffs.push(diff);
    }

    if (diffs.length === 0) return;

    try {
      const result = await createStateManager(this.saveId).commitChatState([], {
        ejsVarsDiffs: diffs,
      });
      if (result.errors.length > 0) {
        console.warn('[GamePipeline] EJS 变量差量落库报错:', result.errors);
      }
    } catch (err) {
      console.warn('[GamePipeline] EJS 变量差量落库失败（不阻塞本轮）:', err);
    }
  }

  /** 体积护栏拒绝: console.warn + 累计诊断行 + 每存档每来源一次 toast */
  private rejectEjsVarsDiff(agentId: string, size: number): void {
    const label = AGENT_LABELS[agentId] ?? agentId;
    console.warn(
      `[GamePipeline] EJS 变量差量超限，整份拒绝 —— 来源 ${agentId} · ${size} 字节 > 上限 ${EJS_DIFF_SIZE_LIMIT}`,
    );

    // 诊断行（DebugPanel 可查、随导出 JSON 带走）—— 拒绝不能只活在一次 toast 里
    try {
      this.game.recordEjsVarsRejection?.(agentId, label, size);
    } catch (err) {
      console.warn('[GamePipeline] 记录 EJS 拒绝诊断失败:', err);
    }

    if (this.ejsRejectToasted.has(agentId)) return;
    this.ejsRejectToasted.add(agentId);
    try {
      useUIStore().toast(
        `「${label}」的世界书变量写入超出 ${Math.round(EJS_DIFF_SIZE_LIMIT / 1024)} KB 上限，本轮整份丢弃（详情见调试面板）`,
        'warning',
        6000,
      );
    } catch (err) {
      console.warn('[GamePipeline] EJS 拒绝提示失败:', err);
    }
  }

  /** 获取（或懒创建）StateManager 实例 */
  private getStateManager() {
    const sm = createStateManager(this.saveId);
    return sm
      ? {
          commitDomainCommand: (patches: StatePatch[]) => sm.commitDomainCommand(patches),
          commitChatState: async (patches: any[]) => {
            const result = await sm.commitAiPatches(patches);
            if (result.errors.length > 0) {
              console.error(
                `[GamePipeline] 状态提交失败 ${result.errors.length}/${patches.length} 条:`,
                result.errors,
              );
              this.emitMessage(
                `[系统] 部分状态未能写入 (${result.errors.length} 条): ${result.errors.join('；')}`,
                'assistant',
              );
            } else if (result.patchesApplied < patches.length) {
              console.warn(
                `[GamePipeline] 部分 patch 验证失败未生效: ${result.patchesApplied}/${patches.length}`,
              );
            }
          },
        }
      : undefined;
  }

  private buildEventHandlers(runActivityId?: string): OrchestratorEvents {
    const debugTurnId = runActivityId ?? this.activeRunId ?? 'detached';
    return {
      // 🎲 随机事件回执（§5.2）：结算五步全在 StateManager 里（**唯一写入口**，ADR-21），
      //    这里只把名字送过去。系统关闭 / 名字不在候选池两条 warn-noop 也在结算侧，
      //    在这里再判一遍就是第二处口径。
      //
      // 🔴 **把 promise 交回去**（2026-08-16 审查修复）：结算是一次整条 SaveProfile 记录的
      //    读-改-写，编排器要 await 它才能与 Stage 2 的提交、回合末的保洁串起来 ——
      //    此前的 `void ... .catch()` 让三处从各自的副本整条写回去，最后写的赢。
      //    失败仍然只 warn（结算侧自己也全程 try/catch），叙事这一轮照常完成。
      onEventTrigger: (name) =>
        createStateManager(this.saveId)
          .confirmRandomEventTrigger(name)
          .catch((err) => {
            console.warn('[GamePipeline] 随机事件触发结算失败（不阻塞本轮）:', err);
          }),

      // 工坊 P2 (D5): stage 跑完 → EJS 差量落库 → 才轮到本 stage 的 AI 补丁
      onEjsVarsFlush: (agentIds) => this.flushEjsVarsDiffs(agentIds),

      // === Stage 回调 ===
      onAgentStart: (agentId, config) => {
        console.log(`[GamePipeline] Agent 开始: ${agentId}`);
        this.game.updateAgentStatus(agentId, runActivityId);
        const invocation = this.nextDebugInvocation(agentId, runActivityId);
        this.mainInvocationIds.set(`${debugTurnId}\u0000${agentId}`, invocation.invocationId);
        const endpoint = this.buildEndpoints().find((item) => item.id === config.apiEndpointId);
        // 初始化日志空条目 (等 complete 时补全 messages + result)
        this.game.addAgentLogEntry(
          buildDebugEntry({
            invocationId: invocation.invocationId,
            turnId: debugTurnId,
            agentId,
            label:
              invocation.ordinal > 1
                ? `${AGENT_LABELS[agentId] ?? agentId} #${invocation.ordinal}`
                : (AGENT_LABELS[agentId] ?? agentId),
            endpoint,
            endpointId: config.apiEndpointId,
            model: config.model || endpoint?.defaultModel || '',
            startedAt: Date.now(),
          }),
        );
      },
      onAgentComplete: async (result) => {
        this.game.clearAgentStatus(result.agentId, result.error, runActivityId);
        // 补全本轮已启动日志的剩余字段（保留 onAgentStart 写入的占位条目）
        const invocationId = this.mainInvocationIds.get(`${debugTurnId}\u0000${result.agentId}`);
        const prev = this.game.agentLog.find(
          (e: DebugAgentEntry) => e.invocationId === invocationId,
        );
        this.game.addAgentLogEntry(
          buildDebugEntry({
            invocationId: invocationId ?? `${runActivityId}:${result.agentId}:unknown`,
            turnId: debugTurnId,
            agentId: result.agentId,
            label: prev?.label ?? AGENT_LABELS[result.agentId] ?? result.agentId,
            endpointId: prev?.endpointId,
            endpointName: prev?.endpointName,
            baseUrl: prev?.baseUrl,
            model: prev?.model ?? '',
            messages: result.requestMessages ?? prev?.messages,
            result,
            startedAt: prev?.startedAt ?? Date.now() - result.duration,
            completedAt: Date.now(),
          }),
        );
        await this.handleAgentResult(result, debugTurnId);
      },
      onAgentError: (agentId, error, result) => {
        console.error(`[GamePipeline] Agent 错误: ${agentId}`, error);
        this.game.clearAgentStatus(agentId, error, runActivityId);
        // 补充错误日志
        const invocationId = this.mainInvocationIds.get(`${debugTurnId}\u0000${agentId}`);
        const prev = this.game.agentLog.find(
          (e: DebugAgentEntry) => e.invocationId === invocationId,
        );
        this.game.addAgentLogEntry(
          buildDebugEntry({
            invocationId: invocationId ?? `${runActivityId}:${agentId}:unknown`,
            turnId: debugTurnId,
            agentId,
            label: prev?.label ?? AGENT_LABELS[agentId] ?? agentId,
            endpointId: prev?.endpointId,
            endpointName: prev?.endpointName,
            baseUrl: prev?.baseUrl,
            model: prev?.model ?? '',
            messages: result?.requestMessages ?? prev?.messages,
            result: result ? { ...result, error } : { error },
            startedAt: prev?.startedAt ?? Date.now(),
            completedAt: Date.now(),
          }),
        );
      },

      onToolCall: (agentId, toolName, args, result) => {
        this.game.recordAgentToolActivity(agentId, toolName, args, result, runActivityId);
      },

      onStateCommitError: (source, errors) => {
        console.error(`[GamePipeline] ${source} 状态提交失败:`, errors);
      },

      // === Marker 回调 ===
      onCombatTrigger: async (marker, storyOutput) => {
        return await this.handleCombatTrigger(marker, storyOutput);
      },
      onCraftGenRequest: async (markers, _varsOutput, ctx) => {
        await this.handleCraftGen(markers, ctx, runActivityId);
      },
      onCharGenRequest: async (markers, _varsOutput, ctx) => {
        await this.handleCharGen(markers, ctx, runActivityId);
      },
      onItemGenRequest: async (markers, _varsOutput, ctx) => {
        await this.handleItemGen(markers, ctx, runActivityId);
      },
    };
  }

  /** 处理单个 Agent 完成 */
  private async handleAgentResult(result: AgentResult, debugTurnId?: string) {
    switch (result.agentId) {
      case 'story': {
        // rawResponse 直接就是 AI 返回的字符串正文（流式模式下也是完整文本）
        const { content, options, truncated } = extractStoryOptions(result.rawResponse || '');
        if (!content) throw new Error('story produced no player-visible narrative');
        // 🔴 2026-09-18 真机防护：输出未闭合（缺 </maintext>）时给可见提示 —— 此前
        //    解析器会静默把「开标签到末尾」当完整正文展示，玩家只看到一句断掉的话，
        //    排查时无从判断是模型问题还是显示问题。
        if (truncated) {
          console.warn(
            '[GamePipeline] story 输出未闭合（缺 </maintext>）——可能被截断。原始响应长度:',
            (result.rawResponse || '').length,
          );
        }
        // 🖼 记下这条消息 —— 情景插画按 (saveId, messageId, occurrence) 反查挂回正文（D2）。
        // 从 messages 末尾去捞是个会被别的写入者破坏的假设，所以让 addMessage 交回来。
        const message = this.emitMessage(
          truncated ? content + TRUNCATION_NOTICE : content,
          'assistant',
        );
        // null = 存档已切走，这条正文没写进去（COR-02）。此时**不能**记
        // lastStoryMessage —— 它是情景插画反查锚点，指向一条不存在的消息只会
        // 让后续开火挂到空处。
        // 🔴 `setPendingOptions` 也必须留在闸门**之后**：孤儿回合的行动选项照样会铺进
        //    新存档的输入区（2026-08-10 审查逮到，初版把它写在了闸门之前）。
        if (!message) break;
        // 行动选项方案（2026-09-23）：off 档解析兜底——模型按惯性输出 <option> 时整批丢弃
        const optionScheme = resolveOptionScheme(
          (this.game.saveProfile?.worldFlags as Record<string, unknown> | undefined)?.[
            'optionSchemeId'
          ] as string | undefined,
          getEngineSettings().optionSchemes,
        );
        this.game.setPendingOptions([...filterOptionsForScheme(options, optionScheme)]);
        this.lastStoryMessage = {
          id: message.id,
          turn: message.turn ?? 0,
          content: message.content,
        };
        break;
      }
      case 'memory_summary': {
        // 🔴 并行化改造（方案③，2026-08-16）：embedding 落库挪进 pendingPlotTasks
        // 后台队列（run() 末尾统一 await）—— plot_post_check 消费的是
        // `context.agentOutputs` 里的**文本输出**，不依赖 embedding 结果；
        // `recentMemories` 更新延迟到 run() 末尾，下一轮 buildContext 在 run()
        // 之后执行，读得到。onAgentComplete 因此不再被一次慢 embedding 调用阻塞
        // stage 完成 —— 新 Stage 2 里与 request_dispatcher 同组，不让它拖累调度。
        // persistMemorySummary 内部自带 try/catch 不会拒绝，这里再包一层防悬空。
        const task = (async () => {
          try {
            await this.persistMemorySummary(result, debugTurnId);
          } catch (err) {
            console.error('[GamePipeline] memory_summary 后台落库失败:', err);
          }
        })();
        this.pendingPlotTasks.push(task);
        break;
      }
      case 'plot_pre_check': {
        this.handlePlotPreCheck(result);
        break;
      }
      case 'plot_post_check': {
        const task = this.persistPlotPostCheck(result);
        this.pendingPlotTasks.push(task);
        await task;
        break;
      }
    }
  }

  /**
   * 步5: 从 rawResponse 抠 JSON。
   *
   * Q-05：改走 `extractJsonPayload` —— 除了原来认的 `<json>` 标签，还认裸 JSON、
   * markdown 围栏、以及前后夹带解说文字的贪婪切片。抠不到时退回原文（旧行为）。
   */
  private static extractJsonBlock(raw: string): string {
    return extractJsonPayload(raw) ?? raw;
  }

  /**
   * 🧵 主线细化层 —— pre 开始前（loadPlotData 之后）求本轮闸门。
   *
   * 判据全部来自生产纯函数（plot-threads.evaluatePlotThreadGate），调试面板直接消费
   * `context.plotThreadGate` 的同一次求值结果（照 random-event-debug 的「不装第二份判据」口径）。
   * 供值必须在这里 —— resolver 自己去读 Dexie 会把引擎依赖方向反过来（同 mapFlags 铁律）。
   */
  private preparePlotThreadGate(context: AgentContext): void {
    this.plotThreadGate = null;
    this.plotThreadTurn = null;
    this.plotThreadSettlement = { updates: [], revealedNames: [] };
    try {
      const profile = this.game.saveProfile;
      if (!profile) return;
      const events: PlotEvent[] = context.plotEvents ?? [];
      const outline = context.plotOutline ?? null;
      const flags = getPlotThreadFlags(profile);
      const gate = evaluatePlotThreadGate({
        saveId: this.saveId,
        turnNo: (this.game.activeSave?.metadata?.totalTurns ?? 0) + 1,
        currentTime: profile.gameTime,
        combatActive: this.game.isInCombat,
        mode: context.plotSettings?.mode ?? 'off',
        outlineTitle: outline?.title,
        chapterTitles: (outline?.chapters ?? []).map((c) => c.title),
        chapterEventTitles: events
          .map((e) => e.chapterTitle)
          .filter((t): t is string => typeof t === 'string' && t.trim() !== ''),
        pendingEvents: events,
        activeEventCount: events.filter((e) => e.status === 'active').length,
        flags,
      });
      this.plotThreadGate = gate;
      context.plotThreadGate = gate;
      context.plotThreadFlags = flags;
    } catch (err) {
      console.warn('[GamePipeline] 主线细化闸门求值失败（本轮不推进细化）:', err);
    }
  }

  /**
   * 🧵 接受 pre 声明 → 导演段（可演绎行动 + 场景融合要求）。
   *
   * 规则（实施计划 §3.1/§3.3）：
   * - 闸门未放行 → 不入工作集、不产块（AI 越权声明不保存）。
   * - 同轮大纲触发优先：`triggeredEvents` 里有**实际可接受**（pending + 精确标题）时，
   *   丢弃本轮细化推进声明（不能按无效标题误关闸）。
   * - 声明归一化只此一处（parseThreadDeclarations）；坏条目在解析层已独立丢弃。
   * - 导演块放 gist/动机（本轮呈现内容）与行为化要求；**不放**节点账务、未揭示终局、
   *   连线意向、全量事件线 JSON 标题。
   * - 同轮声明是临时工作集（post 可见），不是持久真源。
   */
  private acceptPlotThreadDeclarations(parsed: Record<string, unknown>): string | undefined {
    const gate = this.plotThreadGate;
    const context = this.currentContext;
    if (!gate?.allowed || !context) return undefined;

    const declarations = parseThreadDeclarations(parsed['threadDeclarations']);
    if (declarations.length === 0) return undefined;

    const triggerTitles = (
      Array.isArray(parsed['triggeredEvents']) ? parsed['triggeredEvents'] : []
    )
      .map((e) =>
        e && typeof e === 'object' ? (e as Record<string, unknown>)['title'] : undefined,
      )
      .filter((t): t is string => typeof t === 'string' && t.trim() !== '');

    if (countAcceptableTriggers(context.plotEvents ?? [], triggerTitles) > 0) {
      console.log('[GamePipeline] 同轮大纲触发优先，丢弃本轮主线细化声明（闸门不算被消耗）');
      return undefined;
    }

    this.plotThreadTurn = {
      turnNo: (this.game.activeSave?.metadata?.totalTurns ?? 0) + 1,
      acceptedDeclarations: declarations,
      acceptedUpdates: [],
      revealedNames: [],
      gate,
    };
    context.plotThreadTurnContext = this.plotThreadTurn;
    return GamePipeline.formatPlotThreadDirectorBlock(declarations);
  }

  /**
   * 成功回合收口：本轮有声明/结算/揭示任一 → `commitPlotThreadTurn`（锁内窄写，幂等）。
   * 失败只走既有诊断日志；不追加自动 LLM 重试（实施计划 §3.5）。
   */
  private async commitPlotThreadTurnIfAny(): Promise<void> {
    const turn = this.plotThreadTurn;
    const settlement = this.plotThreadSettlement;
    const hasDeclarations = !!turn && turn.acceptedDeclarations.length > 0;
    const hasSettlement = settlement.updates.length > 0 || settlement.revealedNames.length > 0;
    if (!hasDeclarations && !hasSettlement) return;
    const profile = this.game.saveProfile;
    if (!profile) return;
    const turnNo = (this.game.activeSave?.metadata?.totalTurns ?? 0) + 1;
    const result = await commitPlotThreadTurn(this.saveId, {
      turnNo,
      declarations: turn?.acceptedDeclarations ?? [],
      updates: settlement.updates,
      revealedNames: settlement.revealedNames,
      seededAtEpochMinutes: toEpochMinutes(profile.gameTime),
    });
    if (result.committed) {
      console.log(
        `[GamePipeline] 主线细化收口成功: 节点=${result.nodeCount} 结算=${result.settledCount} 揭示=${result.revealedCount}`,
      );
    }
  }

  /** 导演段：通过闸门的可演绎行动 + 场景融合要求（§3.3：不含账务/连线/终局/窗口标题） */
  private static formatPlotThreadDirectorBlock(declarations: PlotThreadDeclaration[]): string {
    const lines = declarations.map((d) => {
      const actors = d.involvedNpcs.length > 0 ? `（人物：${d.involvedNpcs.join('、')}）` : '';
      return `- ${d.name} —— ${d.gist}${actors}\n  动机与行为：${d.motive}`;
    });
    return (
      `**主线明线（世界在主线方向上自然运转的一角）:**\n${lines.join('\n')}\n\n` +
      `**要求:** 以上内容只作背景片段融入正文，不点破其与主线的关联、不预告后续、` +
      `不用它质问/引导玩家；玩家可遇见也可不遇见，不改变玩家手头正在做的事。`
    );
  }

  /**
   * 🧵 侧链角色实体化投影（实施计划 §3.4 时点分流；Code 背书，不依赖 AI 自觉）。
   *
   * marker 的 characterName 命中某节点 `involvedNpcs` 时：
   * - **场景 A**（角色尚未在角色库/正文出现）：节点全量（含 motive 行为化改写）——
   *   玩家未见该角色另一面，无剧透风险；
   * - **场景 B**（角色已存在）：正文证据 + 表层投影（name/gist/involvedNpcs/thread），
   *   motive 与连线意向必须藏；拿不准走 B。
   * - 未命中：不加戏（返回 undefined）。
   * 注入的是**请求描述**（进 char_gen prompt 的 CHAR_DETECT 槽），motive 本体一律
   * **不进角色档案**。
   */
  private buildCharGenPlotInjection(marker: CharGenRequestMarker): string | undefined {
    const name = marker.attributes?.characterName;
    if (!name) return undefined;
    const flags = this.currentContext?.plotThreadFlags;
    if (!flags) return undefined;

    // 时点分流：角色已在角色库 → 场景 B（表层投影）；否则场景 A（全量行为化）。
    // 拿不准走 B —— B 只赔信息量，A 可能剧透。投影内容全部来自 plot-threads 的纯函数
    // （§11.4 裁定 1-4：motive 不进档案、连线意向不外泄）。
    const existing = this.game.characters.some((c) => c.name === name);
    if (existing) {
      const surface = buildCharGenProjectionB(flags, name);
      if (!surface) return undefined;
      return [
        `该角色与主线明线相关（仅作背景，其本人可对此一无所知，不应主动知情）：`,
        `涉及事件：${surface.gist}（隶属「${surface.thread}」）。`,
      ].join('\n');
    }
    const full = buildCharGenProjectionA(flags, name);
    if (!full) return undefined;
    return [
      `该角色承担主线角色（内部信息；行为可体现、身份不得披露）：`,
      `事件轮廓：${full.gist}（隶属「${full.thread}」）。`,
      `行为约束：请将下列动机转译成其言谈举止的隐性倾向，不点破因果——${full.motive}`,
    ].join('\n');
  }

  /**
   * 步5: pre_check 完成 →
   * 1. 同步解析 directive/relevantBackground 并注入剧情导演区块到 context.agentOutputs
   *    （story 在 Stage 1 经 {{AGENT.PLOT_PRE_CHECK}} 占位符读取，必须在 story 启动前同步写入）
   * 2. 🧵 主线细化层：闸门通过且同轮无实际可接受大纲触发时，接受声明进临时工作集，
   *    并追加「主线明线」导演段（可演绎行动 + 场景融合要求；不放节点账务/连线/窗口标题）。
   * 3. 异步 preCheckPlot() 落库事件激活（pending→active + visibility→revealed）
   */
  private handlePlotPreCheck(result: AgentResult) {
    const raw = result.rawResponse || '';
    if (!raw) return;
    const jsonStr = GamePipeline.extractJsonBlock(raw);

    try {
      const parsed = JSON.parse(jsonStr);
      const background: string = parsed.relevantBackground || '';
      const directive: string = parsed.directive || parsed.outlineRelevance || '';
      const blocks: string[] = [];
      if (background) blocks.push(`**剧情背景（须自然编织进正文）:**\n${background}`);
      if (directive) blocks.push(`**本轮推进建议:**\n${directive}`);

      // 🧵 主线细化：只接受「通过闸门 + 无实际可接受大纲触发」的声明
      const directorBlock = this.acceptPlotThreadDeclarations(parsed as Record<string, unknown>);
      if (directorBlock) blocks.push(directorBlock);

      if (blocks.length > 0) {
        this.currentContext?.agentOutputs.set(
          'plot_pre_check',
          `<剧情导演>\n${blocks.join('\n\n')}\n</剧情导演>`,
        );
      }
    } catch (err) {
      console.warn('[GamePipeline] plot_pre_check 解析失败（不阻塞本轮）:', err);
    }

    const task = (async () => {
      try {
        const { preCheckPlot } = await import('@engine/plot-engine');
        const { triggeredEvents } = await preCheckPlot(
          this.saveId,
          jsonStr,
          this.currentContext?.variables ?? {},
        );
        if (triggeredEvents.length > 0) {
          console.log(
            `[GamePipeline] plot_pre_check 激活事件: ${triggeredEvents.map((e) => e.title).join('、')}`,
          );
        }
      } catch (err) {
        console.warn('[GamePipeline] preCheckPlot 落库失败（不阻塞本轮）:', err);
      }
    })();
    this.pendingPlotTasks.push(task);
  }

  /** 步5: post_check 完成 → postCheckPlot() 落库（事件状态/新子事件/大纲版本）→ 完成/失败事件转记忆 → 年度大纲检测 */
  private async persistPlotPostCheck(result: AgentResult): Promise<void> {
    const raw = result.rawResponse || '';
    if (!raw) return;
    try {
      const { postCheckPlot, parsePostCheckOutput, eventToMemory } =
        await import('@engine/plot-engine');
      const jsonStr = GamePipeline.extractJsonBlock(raw);
      const outcome = await postCheckPlot(this.saveId, jsonStr);

      // 🧵 主线细化：post 暂存结算/揭示（闸门只约束新建/推进；有正文证据的结算任何轮都可发生）。
      // 成功回合收口见 commitPlotThreadTurnIfAny —— 不读后台旧 pre 落库寻找节点。
      const parsedPost = parsePostCheckOutput(jsonStr);
      if (parsedPost) {
        if (parsedPost.threadUpdates.length > 0 || parsedPost.revealedNames.length > 0) {
          this.plotThreadSettlement.updates.push(...parsedPost.threadUpdates);
          this.plotThreadSettlement.revealedNames.push(...parsedPost.revealedNames);
        }
      }

      // 完成/失败事件 → 高重要度记忆
      const terminal = outcome.eventsUpdated.filter(
        (e) => e.status === 'completed' || e.status === 'failed',
      );
      if (terminal.length > 0) {
        const { saveMemory } = await import('@engine/database');
        const { generateMemoryId } = await import('@engine/memory-summarizer');
        // 🔴 并行化改造：「分配 id + 落库」必须与 memory_summary 的落库互斥（同全局
        // 锁段）—— 两条链现在可能并行（方案③把 memory_summary 旁路成后台），
        // 各自扫全库分配会撞号，后写覆盖先写（state-write-queue 全局锁）。
        const { withGlobalWriteLock } = await import('@engine/state-write-queue');
        const gt = this.currentContext?.gameTime;
        const timeStr = gt ? `${gt.era}${gt.year}年${gt.month}月${gt.day}日` : '未知';
        for (const event of terminal) {
          await withGlobalWriteLock(async () => {
            const mem = eventToMemory(event, this.saveId, { start: timeStr, end: timeStr });
            // Q-03：与 memory_summary 共用同一 id 发号器（MEM6位流水号），不再用 base36 时间戳
            await saveMemory({
              ...mem,
              id: await generateMemoryId(),
            } as MemoryRecord);
          });
        }
        console.log(
          `[GamePipeline] plot_post_check 事件转记忆: ${terminal.map((e) => e.title).join('、')}`,
        );
      }
      if (outcome.worldLineChanged) {
        console.log(
          `[GamePipeline] 世界线变动: level=${outcome.changeLevel} outlineUpdated=${outcome.outlineUpdated}`,
        );
      }
    } catch (err) {
      console.warn('[GamePipeline] plot_post_check 落库失败（不阻塞本轮）:', err);
    }
  }

  /** 解析 memory_summary 输出并持久化到 IndexedDB
   *  Q-03：收回引擎 —— 解析/校验/id 生成/embedding 全走 memory-summarizer.summarizeAndSave，
   *  本方法只负责喂入 Agent 输出与 embedding 端点。门槛统一 MEMORY_MIN_CHARS（100 字）。 */
  private async persistMemorySummary(result: AgentResult, debugTurnId?: string) {
    try {
      const { summarizeAndSave } = await import('@engine/memory-summarizer');
      const raw = result.rawResponse || '';

      // 从设置构建 embedding 端点（embeddingEndpointId 指向 API 池，model 覆盖默认）
      const embeddingEndpoint = this.buildEmbeddingEndpoint();

      const memory = await summarizeAndSave({
        saveId: this.saveId,
        agentRawOutput: raw,
        gameTimeRange: this.currentContext?.gameTime ? { start: '未知', end: '未知' } : undefined,
        embeddingEndpoint,
        onEmbeddingRequest: embeddingEndpoint
          ? (trace: EmbeddingRequestTrace) =>
              this.recordEmbeddingRequest(trace, embeddingEndpoint, debugTurnId)
          : undefined,
      });

      // 更新本地 recentMemories 供下一轮召回
      if (memory && this.ownsActiveSave) {
        this.game.recentMemories = [...(this.game.recentMemories || []), memory];
        console.log(
          `[GamePipeline] memory_summary 落库成功: ${memory.id} importance=${memory.importance} keywords=${memory.keywords.join(',')}`,
        );
      }
    } catch (e) {
      console.error('[GamePipeline] memory_summary 解析/存储失败:', e);
    }
  }

  private recordEmbeddingRequest(
    trace: EmbeddingRequestTrace,
    endpoint: Pick<ApiEndpoint, 'id' | 'name' | 'baseUrl' | 'defaultModel'>,
    debugTurnId?: string,
  ): void {
    const turnId = debugTurnId ?? this.activeRunId;
    if (!turnId) return;
    const invocation = this.nextDebugInvocation('memory_embedding', turnId);
    const duration = trace.completedAt - trace.startedAt;
    this.game.addAgentLogEntry(
      buildDebugEntry({
        invocationId: invocation.invocationId,
        turnId,
        agentId: 'memory_embedding',
        label: invocation.ordinal > 1 ? `记忆向量化 #${invocation.ordinal}` : '记忆向量化',
        endpoint,
        model: trace.model,
        messages: [{ role: 'user', content: trace.input }],
        result: {
          rawResponse: trace.responseSummary ?? '',
          error: trace.error,
          tokensUsed: trace.totalTokens ?? 0,
          cacheHit: false,
          cacheMissTokens: trace.promptTokens,
          promptTokens: trace.promptTokens,
          completionTokens: 0,
          duration,
          providerRounds: [
            {
              round: 1,
              tokensUsed: trace.totalTokens ?? 0,
              cacheHit: false,
              cacheMissTokens: trace.promptTokens,
              promptTokens: trace.promptTokens,
              completionTokens: 0,
              duration,
              error: trace.error,
            },
          ],
        },
        startedAt: trace.startedAt,
        completedAt: trace.completedAt,
      }),
    );
  }

  /** 从设置构建 embedding 端点（Q-03 embedding 接线）。
   *  embeddingEndpointId → API 池对应 endpoint；embeddingModel 覆盖 defaultModel。
   *  未配置 embedding endpoint → 返回 undefined（summarizeAndSave 不计算向量，退化为重要度排序）。 */
  private buildEmbeddingEndpoint():
    Pick<ApiEndpoint, 'id' | 'name' | 'baseUrl' | 'apiKey' | 'defaultModel'> | undefined {
    const s = this.settings.settings;
    const endpointId = s.embeddingEndpointId as string | null;
    if (!endpointId) return undefined;
    const ep = this.buildEndpoints().find((e) => e.id === endpointId);
    if (!ep) return undefined;
    return {
      id: ep.id,
      name: ep.name,
      baseUrl: ep.baseUrl,
      apiKey: ep.apiKey,
      defaultModel: s.embeddingModel || ep.defaultModel,
    };
  }

  /**
   * {{COMMISSIONS}} 的数据源：静态内容包委托 + 动态事件委托（随机事件 × 委托板融合）。
   * 动态部分按存档 gameTime 折算 gameDay 过滤过期（与委托板 UI / 交付同一公式）。
   */
  private commissionDefsForAI(): CommissionDef[] {
    const staticDefs = getCommissionDefs();
    const flags = (this.game.saveProfile?.worldFlags as Record<string, any> | undefined)?.[
      'randomEvents'
    ];
    const list = Array.isArray(flags?.eventCommissions) ? flags.eventCommissions : [];
    const gt = this.game.saveProfile?.gameTime;
    const day = gt ? Math.floor(toEpochMinutes(gt) / MINUTES_PER_GAME_DAY) : 0;
    const dynamicDefs = eventCommissionDefs(list, day);
    const dynamicNames = new Set(dynamicDefs.map((d) => d.name));
    return [...dynamicDefs, ...staticDefs.filter((d) => !dynamicNames.has(d.name))];
  }

  /**
   * 惰性回填：扫存档里 embedding 缺失的记忆，按上限批次重嵌。
   * fire-and-forget：不阻塞 buildContext 与后续编排；回填完成自然写入 db，下次召回它们
   * 进 compatible 段；失败静默（一两条坏数据不该让 agent 链挂掉）。
   */
  private maybeBackfillMissingMemories(): void {
    const endpoint = this.buildEmbeddingEndpoint();
    if (!endpoint) return; // 未配置 embedding 端点 —— 静默退避
    void backfillMissingMemories(this.saveId, LAZY_BACKFILL_MAX_PER_RECALL, endpoint, (trace) =>
      this.recordEmbeddingRequest(trace, endpoint, this.activeRunId ?? undefined),
    ).catch((err) => {
      // 顶部 catch 已涵盖单条失败；此 catch 兜整批非预期错误
      console.warn('[GamePipeline] 向量召回惰性回填异常（不影响主链）:', err);
    });
  }

  /** 处理战斗触发 — 统一走交锋拍（v3 战斗页已随 combat-v3 下线删除） */
  private async handleCombatTrigger(
    marker: CombatTriggerMarker,
    _storyOutput: string,
  ): Promise<CombatSummaryResult | null> {
    // 交锋拍内联结算 + 终局演绎，不经 CombatSummary 确认框
    await this.handleCombatTriggerSkirmish(marker);
    return null;
  }

  /**
   * 交锋拍分支：marker 里的敌情线索 → 敌情评估预提交 → 正文流交锋。
   * 结算与演绎都在 runSkirmishEncounter/settleAndNarrate 内联完成（含落库），
   * 这里只负责把 dispatcher 的战斗意图翻译成敌方线索。
   */
  private async handleCombatTriggerSkirmish(marker: CombatTriggerMarker): Promise<void> {
    const enemies = (marker.enemies ?? '')
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const enemyHint =
      [enemies.join('、'), marker.environment].filter(Boolean).join('｜') || undefined;
    const result = await this.runSkirmishEncounter(enemyHint, marker.environment || undefined);
    if (!result.ok) {
      console.warn('[GamePipeline] 交锋拍开局失败:', result.reason);
    }
  }

  // ══════ 交锋拍制战斗（设计共识 §8，问题 28~31）══════
  // 编排在本层（store 接触不到 pipeline）：AI 评估/演绎 + Code 拍结算 + 同窗原子落库。
  // UI 经 game-store 三入口（startSkirmish/submitSkirmishCounter/fleeSkirmish）进来，
  // busy 守卫在 store 入口，本层不再自行判忙。

  /**
   * 制卡流程挂钩的落账（赌徒谬论 / 时间回溯）：
   *  - 大失败 → 厄运 +1（累计计数，不随天失效）
   *  - 本次用掉了几层厄运 → 清零
   *  - 真的回溯过 → 扣精神力 + 清掉预付开关
   */
  private async settleCraftFlowHooks(
    result: { misfortuneConsumed?: number; rewindUsed?: boolean; craftOutput: { rating: string } },
    talentList: readonly { entries?: readonly TalentEntry[] }[] | undefined,
    playerName: string | undefined,
  ): Promise<void> {
    if (!this.ownsActiveSave) return;
    const flags = this.game.saveProfile?.worldFlags;
    const counters = coerceCounters(flags?.counters);
    const patches: StatePatch[] = [];

    // 赌徒谬论：大失败叠厄运（持条目才有），上限走 `赌运{maxHold}`
    const holdsGamble = flatEntriesOf(talentList).some((e) => e.kind === '赌运');
    if (holdsGamble && isGreatFailure(result.craftOutput.rating as CraftRating)) {
      const cap = entryStrength(talentList, '赌运', 'maxHold');
      const before = counterOf(counters, MISFORTUNE_KEY);
      const next = Math.min(cap > 0 ? cap : 5, before + MISFORTUNE_PER_FAILURE);
      if (next > before) {
        patches.push({
          op: 'set_variable',
          target: `worldFlags.counters.${MISFORTUNE_KEY}`,
          value: next,
        } as StatePatch);
        this.emitMessage(
          `▸ 【赌徒谬论】大失败——厄运 +1（${before} → ${next} 层）。下一次对冲融合会替你押上。`,
          'assistant',
        );
      }
    }
    // 厄运用掉即清空（描述是「提高**下一次**」）
    if ((result.misfortuneConsumed ?? 0) > 0) {
      patches.push({
        op: 'set_variable',
        target: `worldFlags.counters.${MISFORTUNE_KEY}`,
        value: 0,
      } as StatePatch);
    }
    // 时间回溯：真的回溯了才扣精神力，并清掉预付开关
    if (result.rewindUsed) {
      const playerC = this.game.player;
      const cost = Math.max(0, entryStrength(talentList, '回溯', 'mpCost'));
      if (playerC && cost > 0) {
        patches.push({
          op: 'update_character',
          target: `characters.${playerName}`,
          value: { mp: Math.max(0, playerC.mp - cost) },
        } as StatePatch);
        this.emitMessage(`▸ 【时间回溯】精神力 −${cost}`, 'assistant');
      }
      patches.push({
        op: 'set_variable',
        target: 'worldFlags.pendingRewind',
        value: false,
      } as StatePatch);
    }
    if (patches.length === 0) return;
    const sm = createStateManager(this.saveId);
    const committed = await sm.commitChatState(patches);
    if (!committed.success) {
      console.warn('[GamePipeline] 制卡流程挂钩落账失败:', committed.errors);
    }
  }

  /**
   * 本次制卡的评级上浮档数，并在必要时**真正扣掉一枚败犬烙印**。
   *
   * 两个来源叠加：当日「制卡顺利」+1 档；玩家预付了烙印则再 +2 档（扣一枚、
   * 清掉预付开关）。烙印不足时只退化成 +1，绝不吞掉玩家的预付意图而不做事。
   */
  private async consumeCraftLift(): Promise<number> {
    const flags = this.game.saveProfile?.worldFlags;
    const lucky = buffActiveToday(
      coerceBuffs(flags?.dailyBuffs),
      DAILY_BUFF_CRAFT_LUCK,
      this.currentGameDay(),
    )
      ? 1
      : 0;
    if (flags?.pendingScar !== true || !this.ownsActiveSave) return lucky;

    const spend = spendCounter(coerceCounters(flags?.counters), '败犬烙印', 1, '败犬烙印');
    if (!spend.ok) return lucky;

    const sm = createStateManager(this.saveId);
    const result = await sm.commitChatState([
      {
        op: 'set_variable',
        target: 'worldFlags.counters.败犬烙印',
        value: spend.left,
      } as StatePatch,
      { op: 'set_variable', target: 'worldFlags.pendingScar', value: false } as StatePatch,
    ]);
    if (!result.success) {
      console.warn('[GamePipeline] 烙印扣除失败:', result.errors);
      return lucky;
    }
    this.emitMessage(
      `▸ 【败犬烙印】烧掉一枚烙印（余 ${spend.left}）——这一次制卡受它庇佑。`,
      'assistant',
    );
    return lucky + 2;
  }

  /**
   * 制卡叙事（供 store 的注入缝调用）：**只命名 + 写过程，无工具**。
   * endpoint 解析与侧链同源（本 agent 未配置时落默认池）。
   */
  async narrateCardCraft(req: {
    saveId: string;
    provisionalName: string;
    tier: string;
    entries: string[];
    cost: number;
    rating: string;
    fusionKind: string;
    materials: string[];
    consumed: string[];
    intent: string;
    crafterName?: string;
    talentNotes?: string[];
  }): Promise<{ name?: string; narrative: string }> {
    const endpoint = this.getEndpointForAgent(CARD_CRAFT_NARRATE_AGENT);
    if (!endpoint) throw new Error('制卡叙事未解析到 API 池');
    return runCardCraftNarration(
      { ...req, endpoint },
      { clientFactory: (agentId, ep, saveId) => this.getClientFactory()(agentId, ep, saveId) },
    );
  }

  /** 委托终点叙事（获得瞬间；共识稿 #13 修订）。失败由 store 侧兜底模板文案。 */
  async narrateCommissionFinale(req: {
    saveId: string;
    commissionName: string;
    description: string;
    finaleType: '谜题' | '强敌' | '场景制卡';
    target: string;
    cardName: string;
    midTierName: string;
  }): Promise<{ narrative: string }> {
    const endpoint = this.getEndpointForAgent(COMMISSION_NARRATE_AGENT);
    if (!endpoint) throw new Error('终点叙事未解析到 API 池');
    return runCommissionNarration(
      { ...req, endpoint },
      { clientFactory: (agentId, ep, saveId) => this.getClientFactory()(agentId, ep, saveId) },
    );
  }

  /** 每日账本：今天这个能力还能不能用（跨天自动恢复，见 daily-ledger.ts） */
  private canUseDaily(key: string, perDay = 1): boolean {
    const ledger = coerceLedger(this.game.saveProfile?.worldFlags?.dailyUses);
    return canUseToday(ledger, key, this.currentGameDay(), perDay);
  }

  /** 记一次每日使用（落 worldFlags.dailyUses.<key>；失败只告警不打断战斗） */
  private async markDailyUsed(key: string, perDay = 1): Promise<void> {
    if (!this.ownsActiveSave) return;
    const today = this.currentGameDay();
    const gate = tryUseToday(
      coerceLedger(this.game.saveProfile?.worldFlags?.dailyUses),
      key,
      today,
      perDay,
      key,
    );
    if (!gate.ok) return;
    const sm = createStateManager(this.saveId);
    const result = await sm.commitChatState([
      {
        op: 'set_variable',
        target: `worldFlags.dailyUses.${key}`,
        value: gate.next[key],
      } as StatePatch,
    ]);
    if (!result.success) {
      console.warn('[GamePipeline] 每日账本记账失败:', result.errors);
    }
  }

  /** 当前 gameDay（与 store 的 currentGameDay 同一公式） */
  private currentGameDay(): number {
    const gt = this.game.saveProfile?.gameTime;
    if (!gt) return 0;
    return Math.floor(toEpochMinutes(gt) / MINUTES_PER_GAME_DAY);
  }

  /** d100 —— 懒惰摸鱼判定等百分位骰（同一条「骰值调用方供给」铁律） */
  private rollD100(): number {
    return 1 + Math.floor(Math.random() * 100);
  }

  /** d20 —— 骰值调用方供给（内核零随机）。MVP 用真随机；接 v3 骰带回放体系为后续工作 */
  private rollD20(): number {
    return 1 + Math.floor(Math.random() * 20);
  }

  /**
   * 交锋用 d20：持「判定取优」条目者掷两次取高（天赋描述原文「判定取优」）。
   * 非交锋的骰（如启封）不在此列——那条通道有自己的骰带口径。
   */
  private rollSkirmishD20(): number {
    const first = this.rollD20();
    if (!hasBetterRoll(flatEntriesOf(this.combatTalents()))) return first;
    const second = this.rollD20();
    const best = Math.max(first, second);
    this.emitMessage(`▸ 判定取优：d20 ${first}/${second} → 取 ${best}`, 'assistant');
    return best;
  }

  /** 构造时挂交锋编排句柄（UI 的三个入口经 store 委托到这里）。
   *  可选调用：单测的精简 mock store 没有此方法，静默跳过；真实 store 必有。 */
  attachSkirmishController(): void {
    this.game.setSkirmishController?.({
      start: (enemyHint, sceneHint) => this.runSkirmishEncounter(enemyHint, sceneHint),
      counter: (choice) => this.submitSkirmishCounter(choice),
      nuke: () => this.skirmishNuke(),
      flee: (endReason) => this.fleeSkirmishEncounter(endReason),
      duel: () => this.declareDuel(),
      sacrifice: () => this.sacrificeSummon(),
      trueName: () => this.speakTrueName(),
      hotSwap: () => this.hotSwapModule(),
      castForbidden: (cardName, wishTier) => this.castForbiddenCard(cardName, wishTier),
    });
  }

  /**
   * 热插拔（S「模块化天才」）：把一张已上场的模块化载具卡的在场效果**换一种形态**
   * 再发动一次（buff ↔ dot）。每场次数由条目 `模块化{swaps}` 限。
   */
  private async hotSwapModule(): Promise<void> {
    const session = this.game.skirmishSession;
    const playerC = this.game.player;
    const combatTalents = this.combatTalents();
    if (!session || session.finished !== null || !playerC) return;
    if (!(combatTalents ?? []).some((t) => (t.entries ?? []).some((e) => e.kind === '模块化'))) {
      this.emitMessage('【模块化天才】需要持有对应天赋。', 'assistant');
      return;
    }
    // 找一张本场已激活、且带模块化印记的卡
    const hit = session.activeEffects.find((e) => {
      const inv = playerC.inventory.find((i) => i.name === e.name);
      return inv?.type === '卡牌' && isModularCard(inv as CardItem);
    });
    const card = hit ? (playerC.inventory.find((i) => i.name === hit.name) as CardItem) : undefined;
    const swap = resolveHotSwap({
      card: card ?? { name: hit?.name ?? '空', 词条: [] },
      current: hit,
      used: session.hotSwapsUsed ?? 0,
      maxSwaps: entryStrength(combatTalents, '模块化', 'swaps'),
    });
    if (!swap.ok || !swap.switched) {
      this.emitMessage(`【模块化天才】${swap.reason ?? '换不了'}`, 'assistant');
      return;
    }
    const swapsUsed = (session.hotSwapsUsed ?? 0) + 1;
    this.game.setSkirmishSession({
      ...session,
      activeEffects: session.activeEffects.map((e) => (e.name === hit!.name ? swap.switched! : e)),
      hotSwapsUsed: swapsUsed,
      log: [...session.log, `▸ ${swap.note}`],
    });
    this.emitMessage(`▸ ${swap.note}`, 'assistant');
  }

  /**
   * 念出真名（S「真名看破系统」）：每场一次的精神冲击。
   *
   * 威力 = 基础 + 每级 × 玩家等级（**不走敌方 HP 百分比**——那是「倒也可斩」的口径，
   * 两条大招因此有各自的适用面：这条打小怪过剩、打大怪不足）。
   * 念过的名字会被记住，下次对上同一个名字加成——「洞悉真名」一旦发生就不会忘。
   */
  private async speakTrueName(): Promise<void> {
    const session = this.game.skirmishSession;
    const playerC = this.game.player;
    const combatTalents = this.combatTalents();
    if (!session || session.finished !== null || !playerC) return;
    if (session.trueNameUsed === true) {
      this.emitMessage('【真名看破】这一场已经念过了——一个名字一场只压得住一次。', 'assistant');
      return;
    }
    const has = (combatTalents ?? []).some((t) => (t.entries ?? []).some((e) => e.kind === '真名'));
    if (!has) {
      this.emitMessage('【真名看破】需要持有对应天赋。', 'assistant');
      return;
    }
    const known = coerceTrueNames(this.game.saveProfile?.worldFlags?.trueNames);
    const alreadyKnown = hasTrueName(known, session.enemyName);
    const shock = trueNameShockPower({
      base: entryStrength(combatTalents, '真名', 'shockBase'),
      perLevel: entryStrength(combatTalents, '真名', 'shockPerLevel'),
      playerLevel: playerC.level,
      alreadyKnown,
    });
    const next = playBeat(
      session,
      { label: `念出真名·${session.enemyName}`, power: shock.power, tags: [] },
      this.rollSkirmishD20(),
      { prepend: [`▸ 【真名看破】${shock.note}`], trueNameUsed: true },
    );
    this.game.setSkirmishSession(next);
    this.emitMessage(next.log.slice(session.log.length).join(String.fromCharCode(10)), 'assistant');
    if (this.ownsActiveSave) {
      const names = rememberTrueName(known, session.enemyName);
      const sm = createStateManager(this.saveId);
      await sm.commitChatState([
        { op: 'set_variable', target: 'worldFlags.trueNames', value: names } as StatePatch,
      ]);
    }
    if (next.finished) await this.settleAndNarrate(next);
  }

  /**
   * 宣战决斗（S「西部决斗礼仪」）：本场禁用伙伴卡，并隔离外部的持续伤害与治疗。
   * 一次性动作——宣战后不可撤回（描述里就是「强制」）。
   */
  private async declareDuel(): Promise<void> {
    const session = this.game.skirmishSession;
    const playerC = this.game.player;
    const combatTalents = this.combatTalents();
    if (!session || session.finished !== null || !playerC) return;
    if (session.duel) {
      this.emitMessage('【决斗】已经在决斗中了。', 'assistant');
      return;
    }
    const has = (combatTalents ?? []).some((t) => (t.entries ?? []).some((e) => e.kind === '决斗'));
    if (!has) {
      this.emitMessage('【决斗】需要持有对应天赋。', 'assistant');
      return;
    }
    const noCompanion = entryStrength(combatTalents, '决斗', 'noCompanion') > 0;
    this.game.setSkirmishSession({
      ...session,
      duel: { noCompanion },
      log: [
        ...session.log,
        '▸ 【西部决斗礼仪】你摘下帽子，把战场划成一个圈——1v1，不容第三人插手' +
          '（伙伴卡不上场；一切外部伤害与治疗被隔离）',
      ],
    });
    this.emitMessage('▸ 【决斗】已宣战：伙伴卡不上场，外部的持续伤害与治疗被隔离。', 'assistant');
  }

  /**
   * 献祭召唤（S「召唤媒介系统」）：献祭当前 HP 的一部分，召唤异世界存在助战数拍。
   * 代价即时付出（HP），收益是数拍的行动值加成——「不受完全控制」由叙事承担。
   */
  private async sacrificeSummon(): Promise<void> {
    const session = this.game.skirmishSession;
    const playerC = this.game.player;
    const combatTalents = this.combatTalents();
    if (!session || session.finished !== null || !playerC) return;
    const has = (combatTalents ?? []).some((t) => (t.entries ?? []).some((e) => e.kind === '献祭'));
    if (!has) {
      this.emitMessage('【献祭召唤】需要持有对应天赋。', 'assistant');
      return;
    }
    const hpPct = entryStrength(combatTalents, '献祭', 'hpPct');
    const beats = entryStrength(combatTalents, '献祭', 'beats');
    const mult = entryStrength(combatTalents, '献祭', 'critMult');
    const cost = Math.max(1, Math.round((session.playerHp * hpPct) / 100));
    if (session.playerHp - cost <= 0) {
      this.emitMessage('【献祭召唤】血不够——再献就死了。', 'assistant');
      return;
    }
    const amount = Math.max(1, Math.round(cost * mult));
    const next = playBeat(session, { label: '献祭召唤', power: 0, tags: [] }, 1, {
      prepend: [
        `▸ 【献祭召唤】割开掌心，献出 ${cost} HP——圈外传来回应（此后 ${beats} 拍行动值 +${amount}）`,
      ],
      recoil: cost,
      activate: {
        name: '异界召唤物',
        type: 'buff',
        amount,
        beatsLeft: beats,
      },
    });
    this.game.setSkirmishSession(next);
    this.emitMessage(next.log.slice(session.log.length).join('\n'), 'assistant');
    if (next.finished) await this.settleAndNarrate(next);
  }

  /**
   * 交锋结算面读的天赋表：去掉被无名河封印中的天赋（代价面，2026-09-21 消费端）。
   * 战斗动作/开战评估/拍结算/免死/大招/战后结算一律读这份；制卡流与叙事读原表不受封印影响。
   */
  private combatTalents() {
    const ledger = coerceSealedTalents(this.game.saveProfile?.worldFlags?.sealedTalents);
    return filterSealedTalents(this.game.player?.talents?.list, ledger);
  }

  /**
   * 禁忌卡六正本打出（委托×地图 2026-09-19 七链）：每张每场限一次，代价在打出瞬间落账。
   * 权能是规则改写（除名/岁除/天罚/兽潮/许愿/蜡封之夜），数值面在 playBeat 的
   * forbidden 分支；代价的存档面（封印天赋/经验清空/maxHp 永久扣/蜡痕）在本方法落。
   */
  async castForbiddenCard(cardName: string, wishTier?: 'small' | 'mid' | 'grand'): Promise<void> {
    const session = this.game.skirmishSession;
    const playerC = this.game.player;
    if (!session || session.finished !== null || !playerC) return;
    if ((session.forbiddenUsed ?? []).includes(cardName)) {
      this.emitMessage(
        `【${cardName}】本场已听过它的声音——同一张禁忌卡，一场只应一次。`,
        'assistant',
      );
      return;
    }
    // 持卡校验：背包里有这张禁忌正本（forbidden 标记的真源是卡定义，背包看名字）
    if (!playerC.inventory.some((i) => i.name === cardName && i.type === '卡牌')) {
      this.emitMessage(`【${cardName}】不在你手里——力量要放在身边才作数。`, 'assistant');
      return;
    }

    const play = async (opts: {
      forbiddenCard: string;
      barrenName?: boolean;
      ageEnd?: boolean;
      heavenScourge?: boolean;
      beastTideAmount?: number;
      wish?: 'small' | 'mid' | 'grand';
      waxNight?: boolean;
    }): Promise<void> => {
      const next = playBeat(
        session,
        { label: cardName, power: 0, tags: [] },
        1 + Math.floor(Math.random() * 20),
        opts,
      );
      this.game.setSkirmishSession(next);
      this.emitMessage(next.log.slice(session.log.length).join('; '), 'assistant');
      if (next.finished) await this.settleAndNarrate(next);
    };

    const costPatches: StatePatch[] = [];

    if (cardName === '禁忌卡·无名河') {
      await play({ forbiddenCard: cardName, barrenName: true });
      // 代价：随机封印一个天赋三场（worldFlags.sealedTalents；交锋结算面禁用，
      // 每场终局在 settleAndNarrate 递减一场、归零归还）。已封印中的不再重复入选。
      const pool = filterSealedTalents(
        playerC.talents?.list,
        coerceSealedTalents(this.game.saveProfile?.worldFlags?.sealedTalents),
      )
        .map((t) => t.name)
        .filter(Boolean);
      if (pool.length > 0) {
        const sealed = pool[Math.floor(Math.random() * pool.length)];
        costPatches.push({
          op: 'set_variable',
          target: `worldFlags.sealedTalents.${sealed}`,
          value: 3,
        } as StatePatch);
        this.emitMessage(
          `▸ 【无名河】代价兑现——天赋【${sealed}】被河水卷走（三场之后归还）`,
          'assistant',
        );
      }
    } else if (cardName === '禁忌卡·失年历') {
      await play({ forbiddenCard: cardName, ageEnd: true });
      // 代价：本级经验清空回起点
      const floor = playerC.level > 1 ? getRequiredXpForLevel(playerC.level - 1) : 0;
      if (typeof floor === 'number' && playerC.totalExp > floor) {
        costPatches.push({
          op: 'update_character',
          target: `characters.${playerC.name}`,
          value: {
            totalExp: floor,
            expToNext: xpToNextNumber(playerC.level),
          },
        } as StatePatch);
        this.emitMessage(
          `▸ 【失年历】代价兑现——你交出了一段修炼的时日（经验回到本级起点）`,
          'assistant',
        );
      }
    } else if (cardName === '禁忌卡·焚天引') {
      await play({ forbiddenCard: cardName, heavenScourge: true });
      this.emitMessage(`▸ 【焚天引】代价兑现——HP 锁至 1，天上多了一道小疤`, 'assistant');
    } else if (cardName === '禁忌卡·万兽园') {
      const tide = 10 + playerC.level * 2;
      await play({ forbiddenCard: cardName, beastTideAmount: tide });
      this.emitMessage(`▸ 【万兽园】代价兑现——兽族与野兽记住了你（遭遇时首轮被先手）`, 'assistant');
    } else if (cardName === '禁忌卡·称心秤') {
      const tier = wishTier ?? 'small';
      const pct = tier === 'grand' ? 50 : tier === 'mid' ? 30 : 10;
      const newMax = Math.max(1, Math.round(playerC.maxHp * (1 - pct / 100)));
      await play({ forbiddenCard: cardName, wish: tier });
      costPatches.push({
        op: 'update_character',
        target: `characters.${playerC.name}`,
        value: { maxHp: newMax, hp: Math.min(playerC.hp, newMax) },
      } as StatePatch);
      this.emitMessage(
        `▸ 【称心秤】代价兑现——愿望的分量称走了你 ${playerC.maxHp - newMax} 点气血上限（永久）`,
        'assistant',
      );
    } else if (cardName === '禁忌卡·白蜡城') {
      await play({ forbiddenCard: cardName, waxNight: true });
      const marks = counterOf(
        coerceCounters(this.game.saveProfile?.worldFlags?.counters),
        WAX_MARKS_KEY,
      );
      const nextMarks = marks + 1;
      costPatches.push({
        op: 'set_variable',
        target: `worldFlags.counters.${WAX_MARKS_KEY}`,
        value: nextMarks,
      } as StatePatch);
      this.emitMessage(
        nextMarks >= 3
          ? `▸ 【白蜡城】第三道蜡痕落定——你感到某座城在夜里翻了身（叙事钩已挂）`
          : `▸ 【白蜡城】代价兑现——蜡痕 ${nextMarks}/3`,
        'assistant',
      );
    } else {
      this.emitMessage(`【${cardName}】不是七链的禁忌正本——打不出它的力量。`, 'assistant');
      return;
    }

    if (costPatches.length > 0) {
      const sm = createStateManager(this.game.activeSaveId!);
      const result = await sm.commitChatState(costPatches);
      if (!result.success) {
        console.warn('[GamePipeline] 禁忌卡代价落账失败:', result.errors);
      }
      // 落库后立即回读：封印/扣上限等代价必须当场被交锋结算读到（否则读的是内存旧账）
      await this.game.refreshFromDb(this.saveId);
    }
  }

  /** 开战：敌情评估预提交整场意图 → 会话入账 → 战报开场注入正文流。
   *  返回结果供调用方明示反馈（dev 按钮/触发方）——评估失败不开战，绝不静默。 */
  private async runSkirmishEncounter(
    enemyHint?: string,
    sceneHint?: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    const playerC = this.game.player;
    const combatTalents = this.combatTalents();
    if (!playerC) return { ok: false, reason: '没有玩家角色（存档未就绪）' };
    const endpoint = this.getEndpointForAgent('skirmish_eval');
    if (!endpoint) {
      this.emitMessage(
        '【交锋】敌情评估不可用：请到设置 → Agent 配置为「skirmish_eval」选择 API 池。',
        'assistant',
      );
      return { ok: false, reason: 'skirmish_eval 未解析到 API 池（设置 → Agent 配置）' };
    }
    // 规则钩子（名字表）：全属性倍率（女王领域 +50%）——此前 getter 写好了没人调
    const startHooks = collectRuleHooks(combatTalents);
    // 条件数值（A 级批次③：荒野镖客 / 战争之王 / 集群母狗）：条件成立才乘。
    // 与「女王领域」的全属性倍率并进同一条乘法链——都是 statMultiplier 的语义。
    const condBonus = totalCondBonus(combatTalents, playerC.cardAlbum?.deck, playerC.inventory);
    const stats = applyStatMultiplier(
      deriveBaseCombatStats({ attributes: playerC.attributes, level: playerC.level }),
      statMultiplierOf(startHooks) * (1 + condBonus.percent / 100),
    );
    for (const note of condBonus.notes) {
      this.emitMessage(`▸ ${note}`, 'assistant');
    }
    // deck 战斗化（2026-09-17）：卡组战力 → 开战防护加成 + 敌情评估参考
    const deckNames = playerC.cardAlbum?.deck ?? [];
    const deck = deckPower(deckNames, (n) => {
      const found = playerC.inventory.find((i) => i.name === n);
      return found?.type === '卡牌' ? (found as CardItem) : undefined;
    });
    // 身后灵（S「瓦尔哈拉的门票」）：每一枚永久守护按条目档位加防御
    const spirits = coerceSpirits(this.game.saveProfile?.worldFlags?.behindSpirits);
    const spiritGuard =
      spirits.length > 0
        ? spirits.length * entryStrength(combatTalents, '成灵', 'guardPerSpirit')
        : 0;
    if (spiritGuard > 0) {
      this.emitMessage(
        `▸ 【身后灵】${spirits.length} 位旧友在你身后——防御 +${spiritGuard}`,
        'assistant',
      );
    }
    const deckGuard = stats.guard + deckGuardBonus(deck) + spiritGuard;
    if (deck > 0) {
      this.emitMessage(`【卡组整备】战力 ${deck}，防护 +${deckGuardBonus(deck)}`, 'assistant');
    }
    try {
      const assessment = await runSkirmishAssessment(
        {
          saveId: this.saveId,
          endpoint,
          enemyHint,
          sceneHint,
          playerLevel: playerC.level,
          playerPower: stats.atk,
          playerTotalPower: stats.atk + stats.guard + stats.agi + deck,
        },
        { clientFactory: this.getClientFactory() },
      );
      // 规则层数值条目（此前只查了名字钩子，这几条一直是死接线）：
      //  体魄 → HP 上限 ×(1+percent/100)；威压 → 敌方威胁 ×(1−percent/100)
      const talentList = combatTalents;
      const physiquePct = hasTitanPhysique(flatEntriesOf(talentList))
        ? entryStrength(talentList, '体魄', 'percent')
        : 0;
      const hpMult = hpMultiplierOf(startHooks);
      const maxHp = Math.round(playerC.maxHp * (1 + physiquePct / 100) * hpMult);
      if (hpMult !== 1) {
        this.emitMessage(`▸ 巨人体魄：HP 上限 ×${hpMult}（→ ${maxHp}）`, 'assistant');
      }
      if (physiquePct > 0) {
        this.emitMessage(
          `▸ 体魄：HP 上限 +${physiquePct}%（${playerC.maxHp} → ${maxHp}）`,
          'assistant',
        );
      }
      const fearPct = totalIntimidation(flatEntriesOf(talentList));
      // 自身状态（S「蛇符咒」隐身 / S「贝蒙斯坦」吸魔）：隐身 = 打不中你，
      // 与威压同一条「缩放敌方威胁」的口径，所以并进同一个百分比一起算。
      const selfStatuses = selfStatusesOf(talentList);
      const stealthPct = totalSelfStatus(selfStatuses, 'threatDown');
      const threatCut = Math.min(90, fearPct + stealthPct);
      const intents =
        threatCut > 0
          ? assessment.intents.map((it) => ({
              ...it,
              threat: Math.max(0, Math.round(it.threat * (1 - threatCut / 100))),
            }))
          : assessment.intents;
      if (fearPct > 0) this.emitMessage(`▸ 威压：敌方威胁 −${fearPct}%（全体）`, 'assistant');
      if (stealthPct > 0) {
        this.emitMessage(`▸ 【自身状态·隐身】敌方威胁 −${stealthPct}%（打不中你）`, 'assistant');
      }
      const initialEffects = initialSelfEffects(selfStatuses);
      if (initialEffects.length > 0) {
        this.emitMessage(
          `▸ 【自身状态】${initialEffects.map((e) => e.name).join('、')} 开战即生效`,
          'assistant',
        );
      }
      const base = startSkirmish({
        enemyName: assessment.enemyName,
        enemyLevel: assessment.enemyLevel,
        intents,
        playerHp: Math.min(playerC.hp, maxHp),
        playerMaxHp: maxHp,
        enemyHp: assessment.enemyHp,
        guard: deckGuard,
        initialEffects,
        enemyCount: coerceEnemyCount(assessment.enemyCount),
        enemyScale: assessment.enemyScale,
      });
      const session = judgeCrush(stats.atk + stats.guard + stats.agi + deck, assessment.enemyPower)
        ? crushFinish(base)
        : base;
      this.game.setSkirmishSession(session);
      this.emitMessage(session.log.join('\n'), 'assistant');
      if (session.finished) await this.settleAndNarrate(session);
      return { ok: true };
    } catch (err) {
      console.warn('[GamePipeline] 敌情评估失败:', err);
      this.emitMessage('【交锋】敌情评估失败，战斗未能开始（可再试一次）。', 'assistant');
      return {
        ok: false,
        reason: `敌情评估失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /** 一拍反制：出卡走八类语义矩阵（直击/在场/禁打），基础应对 = 派生值 + 同名标签 */
  /**
   * 自由文本提名出卡（2026-09-17 路线图 1.1）：交锋活跃时处理玩家输入。
   * L1 卡名精确匹配（零延迟）→ L2 AI 意图解析（轻量单轮，skirmish_eval 端点，
   * 严格 JSON 白名单校验）→ 都不命中返回 false，调用方降级走叙事管线。
   */
  async trySkirmishFreeText(text: string): Promise<boolean> {
    const session = this.game.skirmishSession;
    if (!session || session.finished !== null) return false;
    const playerC = this.game.player;
    if (!playerC) return false;

    const deck = playerC.cardAlbum?.deck ?? [];
    const ready = battleReadyCards(
      playerC.inventory.filter((i): i is CardItem => i.type === '卡牌'),
      deck,
    ).filter((c) => !session.playedCards.includes(c.name));

    // L1：卡名精确匹配
    const match = matchFreeCardPlay(text, ready, session.playedCards);
    if (match.kind === '卡') {
      this.emitMessage(`【自由提名】打出「${match.choice.name}」`, 'assistant');
      await this.submitSkirmishCounter(match.choice);
      return true;
    }
    if (match.kind === '应对') {
      await this.submitSkirmishCounter(match.choice);
      return true;
    }

    // L2：AI 意图解析（skirmish_eval 端点；未配置则静默回退叙事）
    const endpoint = this.getEndpointForAgent('skirmish_eval');
    if (!endpoint) return false;
    try {
      const intent = await runSkirmishIntentResolve(
        {
          saveId: this.saveId,
          endpoint,
          playerText: text,
          cards: ready.map((c) => ({
            name: c.name,
            tags: cardCombatTags(c.词条),
          })),
          intentCounters:
            session.intents[session.beat % Math.max(1, session.intents.length)]?.counters ?? [],
        },
        { clientFactory: this.getClientFactory() },
      );
      if (intent.kind === 'none') return false;
      if (intent.kind === 'counter') {
        this.emitMessage(`【意图解析】基础应对：${intent.move}`, 'assistant');
        await this.submitSkirmishCounter({ kind: '应对', move: intent.move });
        return true;
      }
      this.emitMessage(
        `【意图解析】按你的意思打出「${intent.card}」${intent.declaration ? `——「${intent.declaration}」` : ''}`,
        'assistant',
      );
      await this.submitSkirmishCounter({
        kind: '卡',
        name: intent.card,
        ...(intent.declaration ? { intent: intent.declaration } : {}),
      });
      return true;
    } catch (err) {
      console.warn('[GamePipeline] L2 意图解析失败，降级叙事:', err);
      return false;
    }
  }

  private async submitSkirmishCounter(choice: SkirmishChoice): Promise<void> {
    const session = this.game.skirmishSession;
    const playerC = this.game.player;
    const combatTalents = this.combatTalents();
    if (!session || session.finished !== null || !playerC) return;

    // 连战递增（天赋）：每多打一拍行动值 +条目量（第一拍无加成）
    let escalate = 0;
    for (const t of combatTalents ?? []) {
      for (const e of t.entries) {
        if (e.kind === '连战递增') escalate += Math.max(0, Math.round(e.params.amount ?? 0));
      }
    }

    let action: SkirmishAction;
    let activate: ActivateInput | undefined;
    let prepend: string[] | undefined;
    let recoil: number | undefined;
    let sealBroke: string | undefined;
    let contract: SkirmishContract | undefined;
    /** 本拍触发组合技后要落账的卡名（双生羁绊每对每场一次） */
    let comboFired: string[] | undefined;
    /** 终章（SSS「第六终章」）：持天赋则第 N 拍起自动抹除敌方。
     *  N = 条目 `终章{beats}` 的强度档（缺省基准 6 拍）——档位让更弱的天赋也能共用这条机制。 */
    const finalChapter = (combatTalents ?? []).some((t) =>
      (t.entries ?? []).some((e) => e.kind === '终章'),
    );
    const chapterOpts = finalChapter
      ? {
          finalChapter: true,
          finalChapterBeats: entryStrength(combatTalents, '终章', 'beats'),
        }
      : {};
    // 行为合同（SSS 律师函警告）：本拍出卡时登记的禁条；反噬伤害取 `合同{backlash}` 档
    if (choice.kind === '卡' && choice.contractForbidden) {
      const hasContractGate = (combatTalents ?? []).some((t) =>
        (t.entries ?? []).some((e) => e.kind === '合同'),
      );
      if (hasContractGate) {
        contract = {
          name: `行为合同·禁${choice.contractForbidden}`,
          forbidden: choice.contractForbidden,
          backlash: entryStrength(combatTalents, '合同', 'backlash'),
        };
      }
    }
    if (choice.kind === '卡') {
      // 技能冷却（战斗维度）：冷却中的卡不能打
      if (isOnCooldown(session.cooldowns, choice.name)) {
        const left = session.cooldowns?.[choice.name] ?? 0;
        this.emitMessage(`【交锋】【${choice.name}】冷却中——还剩 ${left} 拍。`, 'assistant');
        return;
      }
      // 会话临时账（真机裁定 2026-09-13）：同一张卡一场只能打出一次
      if (session.playedCards.includes(choice.name)) {
        this.emitMessage(
          `【交锋】【${choice.name}】本局已经用过了——同一张牌一场只能打出一次。`,
          'assistant',
        );
        return;
      }
      // InventoryItem.type 是宽松 string，这里做一次卡牌收窄（脏存档的 type 异常按查无卡处理）
      const found = playerC.inventory.find((i) => i.name === choice.name);
      const card = found?.type === '卡牌' ? (found as CardItem) : undefined;
      if (!card) {
        this.emitMessage(`【交锋】卡里没有【${choice.name}】。`, 'assistant');
        return;
      }
      // 决斗：伙伴卡（召唤/军团）不上场——判定要用真卡的词条
      const duelBlocked = duelBlocksCard(card, session.duel);
      if (duelBlocked.blocked) {
        this.emitMessage(duelBlocked.reason ?? '决斗中这张卡不能上场。', 'assistant');
        return;
      }
      // 封印卡：这一拍的行动就是启封判定（阶段 2 内核分级：启封/哑火/暴走/反噬）
      if (card.sealed) {
        const res = sealedCardPlay(
          card,
          deriveCombatStats({ attributes: playerC.attributes, level: playerC.level }),
          this.rollSkirmishD20(),
          willModifierOf(playerC.attributes),
        );
        const beatDice = this.rollSkirmishD20();
        const escalateBeat = escalate > 0 && session.beat > 0 ? escalate * session.beat : 0;
        action =
          escalateBeat > 0 && res.action.power > 0
            ? { ...res.action, power: res.action.power + escalateBeat }
            : res.action;
        activate = res.activate;
        // 好感共鸣：伙伴卡（召唤/军团）破封后效果发动 → 乘共鸣倍率（审计行置拍审计之前）
        const isBondKind = cardKindOf(card.词条) === '召唤' || cardKindOf(card.词条) === '军团';
        const sealedBond =
          res.effectFired && isBondKind
            ? bondForCard(card.name, this.game.saveProfile?.affections)
            : null;
        if (sealedBond && sealedBond.multiplier !== 1 && action.power > 0) {
          action = { ...action, power: applyBond(action.power, sealedBond.multiplier) };
        }
        prepend = [
          ...res.prepend,
          ...(escalateBeat > 0
            ? [`▸ 连战递增：行动值 +${escalateBeat}（第 ${session.beat + 1} 拍）`]
            : []),
          ...(sealedBond && sealedBond.multiplier !== 1
            ? [
                `▸ 好感共鸣：与【${card.name}】的羁绊（${sealedBond.label} ${sealedBond.affection}）→ 效果 ×${sealedBond.multiplier}`,
              ]
            : []),
        ];
        recoil = res.recoil;
        sealBroke = res.sealBroke;
        const next = playBeat(session, action, beatDice, {
          activate,
          prepend,
          recoil,
          sealBroke,
          ...(contract ? { contract } : {}),
          ...chapterOpts,
        });
        this.game.setSkirmishSession(next);
        this.emitMessage(next.log.slice(session.log.length).join('\n'), 'assistant');
        if (next.finished) await this.settleAndNarrate(next);
        return;
      }
      const plan = cardPlayPlan(
        card,
        deriveCombatStats({ attributes: playerC.attributes, level: playerC.level }),
      );
      if (plan.mode === '禁打') {
        this.emitMessage(`【交锋】${plan.reason}。`, 'assistant');
        return;
      }
      action = plan.action;
      // 在场效果 + 战技附加（2026-09-17）：一张卡可以同时带基础效果与战技，
      // 故这里统一用 planEffects 归一成数组（零条 = 无激活）。
      {
        // 条件加成（A 级批次③）：这里要重算一次——它在另一条方法里，作用域不通用。
        // 只用到「伙伴卡数」这一条件（战争之王），代价是一次卡组扫描。
        const deckCond = totalCondBonus(combatTalents, playerC.cardAlbum?.deck, playerC.inventory);
        const fx = planEffects(plan);
        // 战争之王（A 级批次③）：伙伴卡越多，在场助战越强。
        // 只放大**召唤/军团卡带来的 buff**——那正是「伙伴卡的攻击力」在拍制里的形态。
        const kindForBonus = cardKindOf(card.词条);
        const isCompanion = kindForBonus === '召唤' || kindForBonus === '军团';
        // 独行（A「孤狼」）：带「独行」印记的生物卡，场上没有其它友方效果时翻倍。
        // 「友方效果」= 现存 activeEffects 里除本卡以外的 buff（dot/weaken 是对敌方的，不算友伴）。
        const alone = isCompanion
          ? isLoneCard(card) &&
            !session.activeEffects.some((e) => e.type === 'buff' && e.name !== card.name)
          : false;
        let boostedFx = isCompanion
          ? fx.map((e) =>
              e.type === 'buff'
                ? { ...e, amount: Math.round(e.amount * (1 + deckCond.percent / 100)) }
                : e,
            )
          : fx;
        if (alone) {
          boostedFx = boostedFx.map((e) => ({ ...e, amount: e.amount * 2 }));
          prepend = [...(prepend ?? []), `▸ 【独行】场上没有其它友方——${card.name} 的效果翻倍`];
        }
        if (isCompanion && deckCond.percent > 0) {
          prepend = [
            ...(prepend ?? []),
            `▸ 【条件加成】伙伴 ${deckCond.evals.find((x) => x.met)?.count ?? 0} 张 → 助战 ×${(
              1 +
              deckCond.percent / 100
            ).toFixed(2)}`,
          ];
        }
        activate =
          boostedFx.length === 0 ? undefined : boostedFx.length === 1 ? boostedFx[0] : boostedFx;
      }
      // 好感共鸣（主人裁定：伙伴卡接入好感度）——打出召唤/军团卡时，同名角色的好感
      // 等级决定威力与在场效果乘区（好感高伙伴卖力；反感以下消极怠工 ×0.8）。
      // 名字即羁绊：卡名 = 角色名，查 SaveProfile.affections，零配置。
      let bond: BondInfo | null = null;
      const kind = cardKindOf(card.词条);
      if (kind === '召唤' || kind === '军团') {
        bond = bondForCard(card.name, this.game.saveProfile?.affections);
      }
      if (bond && bond.multiplier !== 1) {
        if (action.power > 0)
          action = { ...action, power: applyBond(action.power, bond.multiplier) };
        if (activate)
          activate = (Array.isArray(activate) ? activate : [activate]).map((fx) => ({
            ...fx,
            amount: applyBond(fx.amount, bond.multiplier),
          }));
        prepend = [
          ...(prepend ?? []),
          `▸ 好感共鸣：与【${card.name}】的羁绊（${bond.label} ${bond.affection}）→ 效果 ×${bond.multiplier}`,
        ];
      }
      // 出卡宣言（主人裁定：纯叙事素材，数值照常结算；置于拍审计之前的「意图」行）
      if (choice.intent && choice.intent.trim()) {
        action = { ...action, note: choice.intent.trim().slice(0, 200) };
      }
    } else {
      action = basicCounterAction(
        choice.move,
        deriveCombatStats({ attributes: playerC.attributes, level: playerC.level }),
      );
    }

    if (escalate > 0 && session.beat > 0) {
      action = { ...action, power: action.power + escalate * session.beat };
      prepend = [`▸ 连战递增：行动值 +${escalate * session.beat}（第 ${session.beat + 1} 拍）`];
    }
    // 暴击（A/B 战斗维度）：持 `暴击` 条目者，拍内掷 d100 判定暴击。
    {
      const critEntry = (combatTalents ?? [])
        .flatMap((t) => t.entries ?? [])
        .find((e) => e.kind === '暴击');
      if (critEntry) {
        const crit = resolveCrit(
          action.power,
          {
            chance: Math.max(0, Math.round(Number(critEntry.params.chance) || 0)),
            mult: Math.max(1, Number(critEntry.params.critPower) || 1.5),
          },
          this.rollD100(),
        );
        if (crit.crit) {
          action = { ...action, power: crit.power };
          prepend = [...(prepend ?? []), `▸ ${crit.note}`];
        }
      }
      // 体格差压制（B「体格差压制」）：敌方体型远小于玩家 → 行动值加成
      const holdsCrush = (combatTalents ?? []).some((t) =>
        (t.entries ?? []).some((e) => e.kind === '体型压制'),
      );
      if (holdsCrush && session.enemyScale) {
        const crush = bodyScaleCrushBonus(
          playerBodyScale(playerC.level),
          coerceBodyScale(session.enemyScale),
          entryStrength(combatTalents, '体型压制', 'crushPct'),
        );
        if (crush.percent > 0) {
          action = { ...action, power: Math.round(action.power * (1 + crush.percent / 100)) };
          prepend = [...(prepend ?? []), `▸ ${crush.note}`];
        }
      }
    }
    // 一拳超人系统的代价（SS）：今天已经挥过那一拳 → 当日虚弱（行动值 ×0.5）。
    // 「24 小时」在这套时间里就是「今天」，跨天由 daily-ledger 的 gameDay 比对自动解除。
    if (
      dailyNukePercentOf(collectRuleHooks(combatTalents)) > 0 &&
      !this.canUseDaily('一拳超人系统')
    ) {
      action = { ...action, power: Math.round(action.power * DAILY_NUKE_WEAKNESS) };
      prepend = [...(prepend ?? []), `▸ 出拳后的虚弱：行动值 ×${DAILY_NUKE_WEAKNESS}`];
    }
    // 刀刀暴击（好运之骰的 8 点面）：当日战斗行动值 +25%。走 dailyBuffs，跨天自动失效。
    if (
      buffActiveToday(
        coerceBuffs(this.game.saveProfile?.worldFlags?.dailyBuffs),
        DAILY_BUFF_COMBAT_CRIT,
        this.currentGameDay(),
      )
    ) {
      action = { ...action, power: Math.round(action.power * COMBAT_CRIT_MULTIPLIER) };
      prepend = [...(prepend ?? []), `▸ 刀刀暴击（今日）：行动值 ×${COMBAT_CRIT_MULTIPLIER}`];
    }
    // 环境加成（天赋，如 SS「黑潮之子」）：域/场景卡建立了对应环境时，
    // 防御/闪避应对（= 敏捷与防御那一路）获得档位加成。环境随领域/场景卡存续。
    const envBonuses = envBonusesOf(combatTalents);
    if (envBonuses.length > 0) {
      const activeEnv = new Set(
        session.activeEffects.map((e) => e.env).filter((v): v is string => !!v),
      );
      const hit = envBonuses.find((b) => activeEnv.has(b.env));
      const isDefensive =
        choice.kind === '应对' && (choice.move === '防御' || choice.move === '闪避');
      if (hit && isDefensive) {
        action = { ...action, power: Math.round(action.power * (1 + hit.percent / 100)) };
        prepend = [
          ...(prepend ?? []),
          `▸ 环境加成（${hit.env}）：防御/闪避应对行动值 +${hit.percent}%`,
        ];
      }
    }
    // 下克上（天赋）：敌方原生等级高于你时，行动值按档位加成（「无视部分防御」的等价兑现）
    const vsHigh = entryStrength(combatTalents, '克上', 'vsHigherLevel');
    if (vsHigh > 0 && session.enemyLevel > playerC.level) {
      const boosted = Math.round(action.power * (1 + vsHigh / 100));
      action = { ...action, power: boosted };
      prepend = [
        ...(prepend ?? []),
        `▸ 下克上：敌方 Lv${session.enemyLevel} 高于你 Lv${playerC.level} → 行动值 +${vsHigh}%`,
      ];
    }
    // 懒惰天才（S）：带回「懒惰」印记的生物卡按概率摸鱼跳过行动，行动则暴击翻倍。
    if (choice.kind === '卡') {
      const playedCard = playerC.inventory.find((i) => i.name === choice.name);
      const asCard = playedCard?.type === '卡牌' ? (playedCard as CardItem) : undefined;
      if (asCard && isLazyCard(asCard)) {
        const outcome = resolveLazyCard(asCard, action.power, this.rollD100(), {
          skipPct: entryStrength(combatTalents, '惰性', 'skipPct'),
          critMult: entryStrength(combatTalents, '惰性', 'critMult'),
        });
        if (outcome.kind !== '正常') {
          action = { ...action, power: outcome.power };
          prepend = [...(prepend ?? []), `▸ ${outcome.note}`];
        }
      }
      // 双生羁绊（S）：双生本场已打出过 → 组合技（每对每场一次）
      if (asCard) {
        const bonds = coerceTwinBonds(this.game.saveProfile?.worldFlags?.twinBonds);
        const combo = resolveTwinCombo({
          card: asCard,
          bonds,
          playedCards: session.playedCards,
          alreadyFired: (session.comboFired ?? []).includes(asCard.name),
          comboMult: entryStrength(combatTalents, '羁绊', 'comboMult'),
        });
        if (combo.fired) {
          action = { ...action, power: Math.round(action.power * combo.power) };
          prepend = [...(prepend ?? []), `▸ ${combo.note}`];
          comboFired = [...(comboFired ?? []), asCard.name];
        }
      }
    }
    // 免死（绞刑架幸存者）：持天赋且本场没用过 → 允许本拍锁血续战
    const lastStand = this.lastStandOption(session);
    const next = playBeat(
      session,
      action,
      this.rollSkirmishD20(),
      prepend || activate || finalChapter || lastStand || comboFired
        ? {
            activate,
            prepend,
            ...chapterOpts,
            ...(lastStand ? { lastStand } : {}),
            ...(comboFired ? { comboFired } : {}),
          }
        : undefined,
    );
    // 技能冷却（战斗维度）：每拍 tick + 打出技能卡时启动冷却
    let cd = tickCooldowns(session.cooldowns);
    if (
      choice.kind === '卡' &&
      cardKindOf(
        (playerC.inventory.find((i) => i.name === choice.name) as CardItem | undefined)?.词条 ?? [],
      ) === '技能'
    ) {
      const hasQuick = (combatTalents ?? []).some((t) =>
        (t.entries ?? []).some((e) => e.kind === '快咏'),
      );
      cd = startCooldown(cd, choice.name, hasQuick ? 1 : 2);
    }
    next.cooldowns = cd;
    this.game.setSkirmishSession(next);
    this.emitMessage(next.log.slice(session.log.length).join('\n'), 'assistant');
    // 免死刚发动 → 补上「瞬间获得满额 MP」（会话只记 HP；MP 是角色字段，得在这里落库）
    if (next.lastStandUsed === true && session.lastStandUsed !== true && this.ownsActiveSave) {
      if (entryStrength(combatTalents, '免死', 'mpRefill') > 0) {
        const sm = createStateManager(this.saveId);
        await sm.commitChatState([
          {
            op: 'update_character',
            target: `characters.${playerC.name}`,
            value: { mp: playerC.maxMp },
          } as StatePatch,
        ]);
        this.emitMessage('▸ 【绞刑架幸存者】满额 MP 瞬间涌回。', 'assistant');
      }
    }
    if (next.finished) await this.settleAndNarrate(next);
  }

  /** 免死开关：持「免死」条目且本场未用过时给出 hpFloor（封印中的天赋不算数） */
  private lastStandOption(session: SkirmishSession): { hpFloor: number } | undefined {
    if (session.lastStandUsed === true) return undefined;
    const combatTalents = this.combatTalents();
    const has = combatTalents.some((t) => (t.entries ?? []).some((e) => e.kind === '免死'));
    if (!has) return undefined;
    if (entryStrength(combatTalents, '免死', 'perBattle') <= 0) return undefined;
    return { hpFloor: entryStrength(combatTalents, '免死', 'hpFloor') };
  }

  /**
   * 一次性大招。两条天赋共用这一条通道，**限次口径不同**：
   *  - 倒也可斩（SSS）：每场一次（会话级 `nukeUsed`），缺省 50% 敌方当前 HP
   *  - 一拳超人系统（SS）：每天一次（daily-ledger 的 `worldFlags.dailyUses`），缺省 80%
   * 两者都有时每日口径优先（更严的那条说了算），出手后同样消耗 90% 玩家 HP。
   */
  private async skirmishNuke(): Promise<void> {
    const session = this.game.skirmishSession;
    const playerC = this.game.player;
    const combatTalents = this.combatTalents();
    if (!session || session.finished !== null || !playerC) return;
    const hooks = collectRuleHooks(combatTalents);
    const dailyPct = dailyNukePercentOf(hooks);
    const perBattle = hasOncePerBattleNuke(hooks);
    if (dailyPct <= 0 && !perBattle) {
      this.emitMessage('【倒也可斩】需要持有对应天赋。', 'assistant');
      return;
    }
    const daily = dailyPct > 0;
    if (daily) {
      if (!this.canUseDaily('一拳超人系统')) {
        this.emitMessage(
          '【一拳超人系统】今天的那一拳已经挥过了——明天再来（今日行动值处于虚弱）。',
          'assistant',
        );
        return;
      }
    } else if (session.nukeUsed === true) {
      this.emitMessage('【倒也可斩】本场已经用过了——这一招一场只出一次。', 'assistant');
      return;
    }
    const pct = daily ? dailyPct : nukePercentOf(hooks);
    const cost = Math.max(1, Math.round(session.playerHp * 0.9));
    const next = playBeat(
      session,
      { label: daily ? '一拳超人' : '倒也可斩', power: 0, tags: [] },
      this.rollSkirmishD20(),
      {
        nuke: true,
        nukePercent: pct,
        recoil: cost,
      },
    );
    this.game.setSkirmishSession(next);
    if (daily) await this.markDailyUsed('一拳超人系统');
    this.emitMessage(next.log.slice(session.log.length).join('\n'), 'assistant');
    if (next.finished) await this.settleAndNarrate(next);
  }

  /** 撤退：终局 C 档，脱离接触 */
  private async fleeSkirmishEncounter(endReason?: string): Promise<void> {
    const session = this.game.skirmishSession;
    if (!session || session.finished !== null) return;
    const next = fleeSkirmish(session, endReason);
    this.game.setSkirmishSession(next);
    this.emitMessage(next.log.slice(session.log.length).join('\n'), 'assistant');
    await this.settleAndNarrate(next);
  }

  /**
   * 终局收尾（主人裁定 2026-09-13：终局要 AI 写战斗过程，抒发情绪）：
   * ① 战斗记叙——AI 对着逐拍审计链写过程叙事（先故事）；② 结算审计链（后账本）；
   * ③ 同窗原子落库（玩家 EXP/HP + 参战卡经验/消耗，一次 commitChatState）→ 落库后
   * 回读（否则 HUD 是开战前血量假象）。整场战斗 AI 调用恒为 2 次（评估 + 记叙），
   * 拍内零 AI——拖沓的病根不回归。记叙失败静默降级（账本照发）。
   */
  private async settleAndNarrate(session: SkirmishSession): Promise<void> {
    if (!session.finished) return;
    const playerC = this.game.player;
    const combatTalents = this.combatTalents();
    if (!playerC) return;
    // 规则钩子（名字表）：经验倍率（鸿蒙道体 ×2 / 千秋证果 ×5）——此前 getter 写好了没人调
    const hooks = collectRuleHooks(combatTalents);
    // 条件经验（S「宿敌认证系统」）：与宿敌战斗经验翻倍
    const holdsNemesis = flatEntriesOf(combatTalents).some((e) => e.kind === '宿敌');
    const nemesis = coerceNemesis(this.game.saveProfile?.worldFlags?.nemesis);
    const nemesisMult = nemesisExpMultiplier({
      holdsTalent: holdsNemesis,
      nemesis,
      enemyName: session.enemyName,
      expMult: entryStrength(combatTalents, '宿敌', 'expMult'),
    });
    if (nemesisMult.note) this.emitMessage(`▸ ${nemesisMult.note}`, 'assistant');
    const settlement = settleSkirmish(
      session,
      playerC.level,
      expMultiplierOf(hooks) *
        nemesisMult.mult *
        // 通用经验倍率（C「快速成长」等）：条目 `经验倍率{expMult}` 驱动
        (entryStrength(combatTalents, '经验倍率', 'expMult') || 1) *
        // 败北强化（A「败北强化」）：败北时的经验加成（名字钩子）
        (session.finished === '败北' ? defeatExpMultiplierOf(hooks) : 1),
    );
    if (!settlement) return;

    // ① 战斗记叙（一次 AI 调用，只演绎不算数）
    const endpoint = this.getEndpointForAgent('skirmish_epilogue');
    if (endpoint) {
      try {
        const text = await runSkirmishChronicle(
          {
            saveId: this.saveId,
            endpoint,
            enemyName: session.enemyName,
            log: session.log,
            finish: session.finished,
            endReason: session.endReason,
          },
          { clientFactory: this.getClientFactory() },
        );
        this.emitMessage(`【战斗记叙】\n${text}`, 'assistant');
      } catch (err) {
        console.warn('[GamePipeline] 战斗记叙失败:', err);
      }
    }

    // ② 结算审计链（先故事后账本）
    this.emitMessage(settlement.expLines.join('\n'), 'assistant');

    // ③ 同窗原子落库 + 回读 + 防重触发记录
    if (this.ownsActiveSave) {
      const sm = createStateManager(this.saveId);
      // 首召入库（2026-09-17 巨兽召唤池）：种子查内容仓 cardPool，已有角色名查存档
      const fortunePool = getCardPool();
      const settlementPatches = buildSkirmishSettlementPatches({
        playerName: playerC.name,
        playerTotalExp: playerC.totalExp,
        session,
        settlement,
        cardOf: (name) => {
          const found = playerC.inventory.find((i) => i.name === name);
          return found?.type === '卡牌' ? (found as CardItem) : undefined;
        },
        summonSeedOf: (name) => fortunePool.find((c) => c.name === name)?.companion,
        existingCharacterNames: this.game.characters.map((c) => c.name),
        playerLocation: playerC.location,
        saveId: this.saveId,
      });
      // 禁忌仿卡使用惩罚（canon：黑市赝品，声望账本记得每一笔）
      const imitationUsed: string[] = [];
      for (const name of session.playedCards) {
        const played = playerC.inventory.find((i) => i.name === name);
        const playedData =
          played?.type === '卡牌'
            ? ((played as CardItem).data as Record<string, unknown> | undefined)
            : undefined;
        if (playedData && typeof playedData.imitationOf === 'string') {
          imitationUsed.push(name);
        }
      }
      for (const name of imitationUsed) {
        settlementPatches.push({
          op: 'delta_variable',
          target: 'profile.reputation',
          amount: -3,
          metadata: { source: 'forbidden_imitation', card: name },
        } as StatePatch);
      }
      if (imitationUsed.length > 0) {
        this.emitMessage(
          `【铭法院名录】检测到禁忌仿卡流通：${imitationUsed.join('、')}——声望各 -3，通缉名录已记上一笔。`,
          'assistant',
        );
      }
      // 胜利素材（SSS「素材之王」）：胜利/碾压时额外掉一份素材（钩子 getter 此前没人调）
      if (
        (session.finished === '胜利' || session.finished === '碾压') &&
        hasVictoryMaterial(hooks)
      ) {
        const drop = `素材·Lv${session.enemyLevel}`;
        settlementPatches.push({
          op: 'add_item',
          target: `characters.${playerC.name}`,
          value: { name: drop, quantity: 1, type: '材料', rarity: '优良' } as unknown as Record<
            string,
            unknown
          >,
          metadata: { source: 'talent-victory-material' },
        } as StatePatch);
        this.emitMessage(`▸ 【素材之王】缴获素材「${drop}」×1`, 'assistant');
      }
      // 自我进化（SSS「最终兵器：她」）：结算时让被立为最终兵器的伙伴卡按战况进化
      {
        const hasEvolveGate = (combatTalents ?? []).some((t) =>
          (t.entries ?? []).some((e) => e.kind === '自我进化'),
        );
        if (hasEvolveGate) {
          const weapon = playerC.inventory.find(
            (i) =>
              i.type === '卡牌' &&
              (i as CardItem).data &&
              ((i as CardItem).data as Record<string, unknown>).finalWeapon === true,
          ) as CardItem | undefined;
          const evolved = weapon
            ? planSelfEvolution(weapon, session.enemyName, session.enemyLevel)
            : undefined;
          if (evolved?.ok && evolved.plan) {
            this.emitMessage(`【最终兵器】${evolved.plan.summary}`, 'assistant');
            settlementPatches.push({
              op: 'update_item',
              target: `characters.${playerC.name}`,
              value: {
                name: weapon!.name,
                changes: { 词条: evolved.plan.new词条 },
              },
            } as StatePatch);
          }
        }
      }
      // 支配者倒影（S）：战败时抄下敌方**威胁最高的一式**作制卡蓝本。
      //    自动记下并给可见提示——复制本身没代价，用不用在制卡时决定。
      if (session.finished === '败北') {
        const holdsMirror = flatEntriesOf(combatTalents).some((e) => e.kind === '倒影');
        if (holdsMirror) {
          const target = pickCopyTarget(session.intents);
          if (target) {
            const before = coerceBlueprints(this.game.saveProfile?.worldFlags?.skillBlueprints);
            const cap = Math.max(1, entryStrength(combatTalents, '倒影', 'maxHold'));
            const after = addBlueprint(
              before.length >= cap ? before.slice(before.length - cap + 1) : before,
              {
                name: target.move,
                from: session.enemyName,
                day: this.currentGameDay(),
                threat: target.threat,
              },
            );
            settlementPatches.push({
              op: 'set_variable',
              target: 'worldFlags.skillBlueprints',
              value: after,
            } as StatePatch);
            this.emitMessage(
              `▸ 【支配者倒影】你记住了【${session.enemyName}】的「${target.move}」（威胁 ${target.threat}）——制卡时可以拿它当蓝本。`,
              'assistant',
            );
          }
        }
      }
      // 宿敌认证（S）：败给更强的敌人 → 他被记为宿敌；战胜宿敌 → 夺取气运并清空。
      if (holdsNemesis) {
        const today = this.currentGameDay();
        if (
          shouldMarkNemesis({
            finished: session.finished,
            enemyLevel: session.enemyLevel,
            playerLevel: playerC.level,
          })
        ) {
          if (!isNemesisBattle(nemesis, session.enemyName)) {
            settlementPatches.push({
              op: 'set_variable',
              target: 'worldFlags.nemesis',
              value: { name: session.enemyName, level: session.enemyLevel, since: today },
            } as StatePatch);
            this.emitMessage(
              `▸ 【宿敌认证】你输给了【${session.enemyName}】——从此他视你为宿敌。与他交锋时，训练效率翻倍。`,
              'assistant',
            );
          }
        } else if (
          isNemesisBattle(nemesis, session.enemyName) &&
          (session.finished === '胜利' || session.finished === '碾压')
        ) {
          // 夺取气运：一次性把恩怨结清（金钱按宿敌等级折算）
          const seized = Math.max(10, session.enemyLevel * 10);
          settlementPatches.push({
            op: 'update_character',
            target: `characters.${playerC.name}`,
            value: { money: playerC.money + seized },
          } as StatePatch);
          settlementPatches.push({
            op: 'set_variable',
            target: 'worldFlags.nemesis',
            value: null,
          } as StatePatch);
          this.emitMessage(
            `▸ 【宿敌认证】你赢了【${nemesis!.name}】——夺取其气运：+${seized} GC。这段恩怨结了。`,
            'assistant',
          );
        }
      }
      // 打脸升级（S）：被嘲讽标记当天打赢 → 海量经验 + 打脸点数
      {
        const holdsSlap = flatEntriesOf(combatTalents).some((e) => e.kind === '打脸');
        const slap = settleFaceSlap({
          holdsTalent: holdsSlap,
          mark: coerceTaunt(this.game.saveProfile?.worldFlags?.taunted),
          today: this.currentGameDay(),
          finished: session.finished,
          expBonus: entryStrength(combatTalents, '打脸', 'expBonus'),
          pointsPerWin: entryStrength(combatTalents, '打脸', 'pointsPerWin'),
        });
        if (slap.expBonus > 0 || slap.points > 0) {
          const beforePoints = counterOf(
            coerceCounters(this.game.saveProfile?.worldFlags?.counters),
            FACE_SLAP_KEY,
          );
          settlementPatches.push({
            op: 'update_character',
            target: `characters.${playerC.name}`,
            value: { totalExp: Math.max(0, session.playerHp) * 0 + slap.expBonus },
            metadata: { delta: true, source: 'face-slap' },
          } as StatePatch);
          settlementPatches.push({
            op: 'set_variable',
            target: `worldFlags.counters.${FACE_SLAP_KEY}`,
            value: beforePoints + slap.points,
          } as StatePatch);
          // 嘲讽标记用掉即清（打了脸，这事就过去了）
          settlementPatches.push({
            op: 'set_variable',
            target: 'worldFlags.taunted',
            value: null,
          } as StatePatch);
          if (slap.note) this.emitMessage(`▸ ${slap.note}`, 'assistant');
        }
      }
      // 终点「强敌型」（委托×地图闭环 决议 #13 修订）：在目的地击败目标之敌 → 写证据，
      // 委托板下一次扫账（scanFinaleCommissions）发卡结案。Code 只记证据不发卡——
      // 发卡与「已完成」记档在扫账里一次原子提交，避免战斗结算半途插一条交付流。
      if (session.finished === '胜利' || session.finished === '碾压') {
        const cFlags = coerceCommissionsFlags(this.game.saveProfile?.worldFlags?.commissions);
        const cDefs = this.game.allCommissionDefs();
        for (const activeEntry of cFlags.active ?? []) {
          const cDef = cDefs.find((d) => d.name === activeEntry.defName);
          if (cDef?.finale?.type !== '强敌') continue;
          const finaleTarget = cDef.finale.target;
          if (!finaleTarget) continue;
          const enemyName = session.enemyName ?? '';
          if (!enemyName.includes(finaleTarget) && !finaleTarget.includes(enemyName)) continue;
          if (!midTierRefHit(cDef.destMidTier, cFlags.currentMidTier)) continue;
          settlementPatches.push({
            op: 'set_variable',
            target: `worldFlags.commissions.finaleEvidence.${cDef.name}`,
            value: 'battle',
          } as StatePatch);
          this.emitMessage(
            `▸ 【终点】${finaleTarget} 已倒下——委托「${cDef.name}」可以结案了。`,
            'assistant',
          );
        }
      }
      // 复生（S「再生」）：败北结算时 HP 不落 0——不死之身，只是这一场输了。
      // 与「免死」分工：那条管**战中**续战（会话级），这条管**战后**不真死（结算级）。
      if (session.finished === '败北') {
        const reviveGate = (combatTalents ?? []).some((t) =>
          (t.entries ?? []).some((e) => e.kind === '复生'),
        );
        if (reviveGate) {
          const floor = Math.max(1, entryStrength(combatTalents, '复生', 'hpFloor'));
          settlementPatches.push({
            op: 'update_character',
            target: `characters.${playerC.name}`,
            value: { hp: Math.max(floor, session.playerHp) },
          } as StatePatch);
          this.emitMessage(
            `▸ 【再生】肉身重新聚拢——战败，但没有真正死去（HP 保底 ${floor}）。`,
            'assistant',
          );
        }
      }
      // 同契（SS「爱」）：与首张伙伴卡同步成长——战斗经验按 syncPct 同步。
      // 「首张伙伴卡」= 卡组第一张召唤/军团卡（确定序；卡组顺序即玩家心意）。
      if (settlement.exp.total > 0) {
        const holdsBond = flatEntriesOf(combatTalents).some((e) => e.kind === '同契');
        if (holdsBond) {
          const syncPct = entryStrength(combatTalents, '同契', 'syncPct');
          const firstCompanion = (playerC.cardAlbum?.deck ?? [])
            .map((n) => playerC.inventory.find((i) => i.name === n && i.type === '卡牌'))
            .find((c) => {
              const words = (c as CardItem | undefined)?.词条 ?? [];
              return words.includes('召唤') || words.includes('军团');
            }) as CardItem | undefined;
          if (firstCompanion && syncPct > 0) {
            const syncExp = Math.round(settlement.exp.total * (syncPct / 100));
            if (syncExp > 0) {
              settlementPatches.push({
                op: 'update_item',
                target: `characters.${playerC.name}`,
                value: {
                  name: firstCompanion.name,
                  changes: { cardExp: (firstCompanion.cardExp ?? 0) + syncExp },
                },
              } as StatePatch);
              this.emitMessage(
                `▸ 【同契】你与【${firstCompanion.name}】同频共振——她分得 ${syncExp} 卡牌经验`,
                'assistant',
              );
            }
          }
        }
      }
      // 败犬烙印（SS）：每次战败在灵魂上留一枚。累计计数走 worldFlags.counters，
      // **不随天失效**——攒着，直到制卡时烧掉一枚扭转命运。
      if (session.finished === '败北') {
        const scarGate = (combatTalents ?? []).some((t) =>
          (t.entries ?? []).some((e) => e.kind === '烙印'),
        );
        if (scarGate) {
          const before = counterOf(
            coerceCounters(this.game.saveProfile?.worldFlags?.counters),
            '败犬烙印',
          );
          const cap = entryStrength(combatTalents, '烙印', 'maxHold');
          const next = Math.min(cap > 0 ? cap : 9, before + 1);
          if (next > before) {
            settlementPatches.push({
              op: 'set_variable',
              target: 'worldFlags.counters.败犬烙印',
              value: next,
            } as StatePatch);
            this.emitMessage(
              `▸ 【败犬烙印】这一败在你灵魂上留下一枚烙印（${before} → ${next}）——制卡时可烧掉一枚扭转词条冲突。`,
              'assistant',
            );
          } else {
            this.emitMessage(
              `▸ 【败犬烙印】烙印已满（${before}/${cap}）——先烧掉几枚再用。`,
              'assistant',
            );
          }
        }
      }
      // 战败补偿（SSS「世界线的收束点」）：败北 + 持钩子 → 抽三条「如果你赢了」的 if 线，
      // 其中一条成真（经验/金钱/素材三选一），并入同窗 patch
      if (session.finished === '败北' && hasDefeatReward(collectRuleHooks(combatTalents))) {
        const plan = planDefeatCompensation(playerC.level);
        this.emitMessage(plan.summary, 'assistant');
        const g = plan.granted;
        if (g.rewardKind === 'exp' && g.exp) {
          settlementPatches.push({
            op: 'update_character',
            target: `characters.${playerC.name}`,
            value: { totalExp: playerC.totalExp + g.exp },
            metadata: { delta: true, source: 'defeat_compensation' },
          } as StatePatch);
        } else if (g.rewardKind === 'gold' && g.gold) {
          settlementPatches.push({
            op: 'update_character',
            target: `characters.${playerC.name}`,
            value: { money: g.gold },
            metadata: { delta: true, source: 'defeat_compensation' },
          } as StatePatch);
        } else if (g.material) {
          settlementPatches.push({
            op: 'add_item',
            target: `characters.${playerC.name}`,
            value: {
              name: g.material.name,
              quantity: g.material.quantity,
              type: '材料',
            },
          } as StatePatch);
        }
      }
      // 击杀掠取（天赋）：胜利/碾压时按条目缴获赏金（delta 入账）
      let killGc = 0;
      if (session.finished === '胜利' || session.finished === '碾压') {
        for (const t of combatTalents ?? []) {
          for (const e of t.entries) {
            if (e.kind === '击杀掠取') killGc += Math.max(0, Math.round(e.params.gold ?? 0));
          }
        }
      }
      if (killGc > 0) {
        settlementPatches.push({
          op: 'update_character',
          target: `characters.${playerC.name}`,
          value: { money: killGc },
          metadata: { delta: true, source: 'skirmish-kill' },
        });
        this.emitMessage(`▸ 击杀掠取：缴获 ${killGc} G`, 'assistant');
      }
      // 无名河封印账：本场终局递减一场，归零归还（与结算同一次原子落库）
      const sealedLedger = coerceSealedTalents(this.game.saveProfile?.worldFlags?.sealedTalents);
      if (Object.keys(sealedLedger).length > 0) {
        const tick = decrementSealedTalents(sealedLedger);
        settlementPatches.push({
          op: 'set_variable',
          target: 'worldFlags.sealedTalents',
          value: tick.ledger,
        } as StatePatch);
        for (const name of tick.returned) {
          this.emitMessage(`▸ 【无名河】河水退去——天赋【${name}】回到了你身上`, 'assistant');
        }
      }
      const result = await sm.commitChatState(settlementPatches);
      if (result.errors.length > 0) {
        console.warn('[GamePipeline] 交锋结算部分失败:', result.errors);
      }
      await this.game.refreshFromDb(this.saveId);
      // 记录「最近已结算战斗」防 dispatcher 对已结算战斗再发 combat_trigger（v3 同款语义）
      this._recentCombat = {
        allies: [playerC.name],
        enemies: [session.enemyName],
        outcome:
          session.finished === '撤退'
            ? 'fled'
            : session.finished === '败北'
              ? 'enemy_win'
              : 'ally_win',
        endedAtTurn: this.game.activeSave?.metadata?.totalTurns ?? 0,
      };
    }
  }

  /**
   * 融合起名（T8-② 裁定 B）：把两源天赋与产物骨架条目交给 AI 起名写描述。
   * 只演绎不算数——条目数值由 Code 化学反应定案；失败走玩家自填兜底。
   */
  private async runTalentFusionNaming(
    sourceA: string,
    sourceB: string,
    entryLines: string[],
  ): Promise<{ ok: boolean; name?: string; description?: string; reason?: string }> {
    const endpoint = this.getEndpointForAgent('talent-naming');
    if (!endpoint) return { ok: false, reason: 'talent-naming 未解析到 API 池' };
    try {
      const r = await runTalentFusionNaming(
        { saveId: this.saveId, endpoint, sourceA, sourceB, productEntryLines: entryLines },
        { clientFactory: this.getClientFactory() },
      );
      return { ok: true, name: r.name, description: r.description };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /** 处理制作生成链 */
  private async handleCraftGen(
    markers: CraftGenRequestMarker[],
    ctx: AgentContext,
    runActivityId?: string,
  ) {
    const endpoint = this.getEndpointForAgent('craft_gen');
    if (!endpoint) {
      console.warn('[GamePipeline] craft_gen 跳过: 未配置 API endpoint');
      return;
    }

    const { runCraftGenChain } = await import('@engine/craft-gen-chain');
    const clientFactory = this.getClientFactory(runActivityId);
    const stateManager = this.getStateManager();

    // 真机修(2026-07-17): try/catch 进循环 — 单制作链失败不阻断后续
    for (const marker of markers) {
      try {
        this.updateAgentActivityStatus('craft_gen', runActivityId);
        const playerTalentList = this.game.player?.talents?.list ?? [];
        const talentBias = buildCraftBiasLines(playerTalentList).join('\n');
        const request = {
          saveId: this.saveId,
          marker,
          storyOutput: ctx.agentOutputs?.get('story') ?? '',
          context: ctx,
          endpoint,
          configs: this.chainData?.agentConfigs,
          worldBooks: this.chainData?.worldBooks,
          presets: this.chainData?.presets,
          talentBias,
          // 制卡评级上浮：当日「制卡顺利」+1 档；预付了败犬烙印则再 +2 档。
          // 烙印在这里**真正扣掉**（预付开关随之清零），扣不动就退化成 +1。
          ratingLift: await this.consumeCraftLift(),
          // 赌徒谬论：厄运层数与单次上限（只在**对冲融合/相克**上兑现，用掉即清空）
          misfortuneLayers: counterOf(
            coerceCounters(this.game.saveProfile?.worldFlags?.counters),
            MISFORTUNE_KEY,
          ),
          misfortuneMaxLift: entryStrength(playerTalentList, '赌运', 'maxLift'),
          // 时间回溯：预付开关（失败才触发，成功不浪费）
          rewindArmed: this.game.saveProfile?.worldFlags?.pendingRewind === true,
          rewindLift: 1,
        } as any;
        // 禁忌仿卡配方（2026-09-17）：内容仓 cardPool 带 imitation 字段的条目
        const imitationRecipes = getCardPool().filter((c) => c.imitation);
        const result = await runCraftGenChain(request, {
          clientFactory,
          stateManager,
          imitationRecipes,
        });
        this.clearAgentActivityStatus('craft_gen', undefined, runActivityId);
        if (result.narrative) {
          this.emitMessage(result.narrative, 'assistant');
        }
        await this.settleCraftFlowHooks(result, playerTalentList, this.game.player?.name);
      } catch (err) {
        if (isAbortError(err)) {
          this.clearAgentActivityStatus('craft_gen', undefined, runActivityId);
          console.log('[GamePipeline] craft_gen 链已取消（离开游戏页 / 停止生成）');
          break;
        }
        this.clearAgentActivityStatus('craft_gen', String(err), runActivityId);
        console.error('[GamePipeline] craft_gen 链失败，继续处理剩余请求:', err);
      }
    }
  }

  /** 处理角色生成链 */
  private async handleCharGen(
    markers: CharGenRequestMarker[],
    ctx: AgentContext,
    runActivityId?: string,
  ) {
    const endpoint = this.getEndpointForAgent('char_gen');
    if (!endpoint) {
      console.warn('[GamePipeline] char_gen 跳过: 未配置 API endpoint');
      return;
    }

    const { runCharGenChain } = await import('@engine/char-gen-agent');
    const clientFactory = this.getClientFactory(runActivityId);
    const stateManager = this.getStateManager();

    // 真机修(2026-07-17): try/catch 进循环 — 单 NPC 链失败(如输出截断)不再连锁抛弃后续请求
    for (const marker of markers) {
      try {
        this.updateAgentActivityStatus('char_gen', runActivityId);
        const charGenRequest = {
          saveId: this.saveId,
          marker,
          context: ctx,
          endpoint,
          // 真机修: 完整 systemPrompt/世界书/预设注入（此前 undefined → stub 裸奔）
          configs: this.chainData?.agentConfigs,
          worldBooks: this.chainData?.worldBooks,
          presets: this.chainData?.presets,
          // 🧵 时点分流投影（命中 involvedNpcs 才注入；未命中不加戏）
          plotThreadInjection: this.buildCharGenPlotInjection(marker),
        } as any;
        const result = await runCharGenChain(charGenRequest, {
          clientFactory,
          stateManager,
        });
        this.clearAgentActivityStatus('char_gen', undefined, runActivityId);
        if (result.character && !this.ownsActiveSave) {
          // 🔴 COR-02：存档已切走 —— 这个 NPC 属于上一个存档，既不进内存角色表也不进聊天流。
          // 侧链**不响应 abort**（`getClientFactory` 包出来的客户端只转发入参 signal，
          // 而 `run()` 的 abortController 只交给了 story），所以离开游戏页之后它照样会跑完
          // 并走到这里 —— 闸门是这条路上唯一拦得住的东西。
          console.warn('[GamePipeline] 存档已切换，丢弃孤儿 char_gen 结果', {
            pipelineSaveId: this.saveId,
            activeSaveId: this.game.activeSaveId,
            characterName: result.character.name,
          });
        } else if (result.character) {
          // 添加新角色到 store
          this.game.characters.push(result.character);
          // 添加系统通知（非 assistant 叙事气泡）
          this.emitSystemMessage({
            type: 'char_gen',
            characterName: result.character.name,
            race: result.character.race,
            tier: result.character.tier,
            narrative: result.narrativeSummary,
            details: result.character as any,
          });
        }
      } catch (err) {
        if (isAbortError(err)) {
          // 取消不是失败：清干净状态并**跳出整个循环** —— 剩下的标记只会各自再被
          // 掐一次，徒增日志噪声（信号已经拉了，重试没有意义）
          this.clearAgentActivityStatus('char_gen', undefined, runActivityId);
          console.log('[GamePipeline] char_gen 链已取消（离开游戏页 / 停止生成）');
          break;
        }
        this.clearAgentActivityStatus('char_gen', String(err), runActivityId);
        console.error(
          `[GamePipeline] char_gen 链失败 (${marker.attributes?.characterName ?? '未知角色'})，继续处理剩余请求:`,
          err,
        );
      }
    }
  }

  /**
   * 🔴 2026-08-02 批量 item_gen 的单批上限。
   *
   * 一次打包过多请求会让 item_gen 单次调用耗时暴涨（9 个请求 ≈ 240s+，见
   * narrative-debug-2743e219），且 AI 思考过重（7817 字 reasoning）容易撞超时。
   * 超上限时按此值分批，每批仍是一次调用（相对逐条 N 次已大幅缩减）。
   * 5 个/批 ≈ 2 批，总耗时 ≈ 2 × 单批时间，比 9 个挤一批更稳。
   */
  private static readonly ITEM_GEN_BATCH_SIZE = 5;

  /** 处理独立物品生成链 (request_dispatcher 的 <item_gen_request>) */
  private async handleItemGen(
    markers: import('@engine/types').ItemGenRequestMarker[],
    ctx: AgentContext,
    runActivityId?: string,
  ) {
    if (markers.length === 0) return;
    const endpoint = this.getEndpointForAgent('item_gen');
    if (!endpoint) {
      console.warn('[GamePipeline] item_gen 跳过: 未配置 API endpoint');
      return;
    }

    const { runItemGenChain } = await import('@engine/item-gen-chain');
    const clientFactory = this.getClientFactory(runActivityId);
    const stateManager = this.getStateManager();
    const storyOutput = ctx.agentOutputs?.get('story') ?? '';

    // 🔴 2026-08-02 批量生成: 此前对每个 marker 串行调 item_gen（N 请求 = N 次调用，
    // 每个 40-60s，开局 5 技能 4 装备 1 消耗品 = 6-10 分钟）。现在把 markers 打包成
    // 一次调用（模板契约「N 个 <request> = N 个输出条目」），调用次数 N → ceil(N/5)。
    //
    // 容错策略: 每批失败不阻断主流程（try/catch 包住）；失败批不落库，下一回合
    // request_dispatcher 会重新识别未落库的请求。
    const size = GamePipeline.ITEM_GEN_BATCH_SIZE;
    for (let start = 0; start < markers.length; start += size) {
      const batch = markers.slice(start, start + size);
      this.updateAgentActivityStatus('item_gen', runActivityId);
      try {
        const request = {
          saveId: this.saveId,
          markers: batch,
          storyOutput,
          context: ctx,
          endpoint,
          // 真机修: 完整 systemPrompt/世界书注入
          configs: this.chainData?.agentConfigs,
          worldBooks: this.chainData?.worldBooks,
          presets: this.chainData?.presets,
        };
        await runItemGenChain(request, {
          clientFactory,
          stateManager,
        });
        this.clearAgentActivityStatus('item_gen', undefined, runActivityId);
        // 物品数据已由 stateManager 落库；run() finally 的 refreshFromDb() 会把
        // 最新 characters（含新物品/装备）回读进 Pinia，前端面板随之刷新。
      } catch (err) {
        if (isAbortError(err)) {
          this.clearAgentActivityStatus('item_gen', undefined, runActivityId);
          console.log('[GamePipeline] item_gen 链已取消（离开游戏页 / 停止生成）');
          break;
        }
        this.clearAgentActivityStatus('item_gen', String(err), runActivityId);
        console.error('[GamePipeline] item_gen 批量链失败（本批不落库，下回合重试）:', err);
      }
    }
  }

  /**
   * 侧链要用的 configs/worldBooks/presets —— run() 里那三行的**惰性版本**。
   *
   * 存在的理由只有一个：手动触发的侧链不经过 run()，而 `chainData` 是 run()
   * 才填的。缺它时 systemPrompt 会退化成一行 stub（char_gen 2026-07-17 的真机教训）。
   */
  private async ensureChainData(): Promise<{
    agentConfigs: AgentConfig[];
    worldBooks: WorldBook[];
    presets: AgentPreset[];
    agentDefaults: Record<string, Record<string, unknown>>;
  }> {
    if (this.chainData) return this.chainData;
    const { presets, agentDefaults } = await this.loadPresets();
    const worldBooks = await this.loadActiveWorldBooks();
    const agentConfigs = this.buildAgentConfigs(agentDefaults);
    this.chainData = { agentConfigs, worldBooks, presets, agentDefaults };
    return this.chainData;
  }

  /**
   * 单条目重铸（2026-08-24）：玩家主动把某角色的一条技能/装备/物品交给 item_gen 重写。
   *
   * 🔴 手动触发不经过 run()，照 image_prompt 手动档先例（runImagePromptAgent）：
   *    ensureChainData() 惰性装配 configs/worldBooks/presets + 独立活动账本。
   *    存档安全：引擎侧 remove 旧 + add 新同一次 commitChatState（原子），零 id 变更；
   *    玩家随时可用既有快照回退（每回合自动打快照）。
   */
  async rewriteLoadoutItem(
    characterId: string,
    target: RewriteTarget,
    userDescription = '',
  ): Promise<{ ok: boolean; reason?: string }> {
    const endpoint = this.getEndpointForAgent('item_gen');
    if (!endpoint) return { ok: false, reason: '未配置 item_gen 的 API endpoint' };

    const activityRunId = this.activeRunId ?? this.game.startAgentActivityRun(undefined, true);
    this.game.updateAgentStatus('item_gen', activityRunId);
    let activityError: string | undefined;

    try {
      const chain = await this.ensureChainData();
      const { rewriteLoadoutItem: runRewrite } = await import('@engine/item-gen-chain');
      const result = await runRewrite(
        {
          saveId: this.saveId,
          characterId,
          target,
          userDescription,
          context: this.currentContext ?? this.buildContext(''),
          endpoint,
          configs: chain.agentConfigs,
          worldBooks: chain.worldBooks,
          presets: chain.presets,
        },
        {
          clientFactory: this.getClientFactory(activityRunId),
          stateManager: this.getStateManager(),
        },
      );
      if (!result.ok) activityError = result.reason;
      return { ok: result.ok, reason: result.reason };
    } catch (err) {
      activityError = err instanceof Error ? err.message : String(err);
      console.error('[GamePipeline] item_gen 重铸失败:', err);
      return { ok: false, reason: activityError };
    } finally {
      this.game.clearAgentStatus('item_gen', activityError, activityRunId);
    }
  }
}
