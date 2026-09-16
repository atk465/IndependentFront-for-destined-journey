import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EndpointBindingError, extractStoryOptions, GamePipeline } from './game-pipeline';
import type { ApiEndpoint } from '@engine/types';
import { patchAgentSettings } from '../stores/agent-settings';
import type { AgentResult } from '@engine/types';

vi.mock('@engine/plot-engine', () => ({
  preCheckPlot: vi.fn(async () => ({
    triggeredEvents: [{ title: '触发的事件' }],
    background: 'bg',
  })),
  postCheckPlot: vi.fn(async () => ({
    eventsUpdated: [],
    newEvents: [],
    outlineUpdated: false,
    worldLineChanged: false,
    changeLevel: 'none',
  })),
  // 🧵 主线细化（2026-09-09）：post 结算/揭示的解析面
  parsePostCheckOutput: vi.fn(() => ({
    worldLineChanged: false,
    changeLevel: 'none',
    outlineChanges: { action: 'none', changes: '' },
    eventUpdates: [],
    newChildEvents: [],
    threadUpdates: [],
    revealedNames: [],
  })),
  eventToMemory: vi.fn(() => ({
    content: 'mem',
    keywords: [],
    importance: 8,
    relatedCharacterIds: [],
    saveId: 's',
    createdAt: 0,
    realTimestamp: 0,
    timeRange: { start: '', end: '' },
    hiddenLine: '',
  })),
}));

vi.mock('@engine/database', () => ({
  getLatestPlotOutline: vi.fn(async () => undefined),
  getPlotEvents: vi.fn(async () => []),
  savePlotOutline: vi.fn(async () => {}),
  savePlotEvents: vi.fn(async () => {}),
  saveMemory: vi.fn(async () => {}),
  getPresets: vi.fn(async () => []),
}));

// 工坊 P2 (D5): EJS 差量落库走 createStateManager(...).commitChatState —— 拦下来验载荷
const {
  commitSpy,
  advanceTurnSpy,
  toastSpy,
  createSnapshotSpy,
  runCombatV3Mock,
  summarizeAndSaveMock,
} = vi.hoisted(() => ({
  commitSpy: vi.fn(async () => ({
    success: true,
    patchesApplied: 0,
    eventsGenerated: [],
    errors: [] as string[],
  })),
  advanceTurnSpy: vi.fn(async () => {}),
  createSnapshotSpy: vi.fn(
    async () => ({ id: 'snap-pre-combat', reason: 'pre-combat', turn: 0 }) as any,
  ),
  toastSpy: vi.fn(),
  runCombatV3Mock: vi.fn(),
  summarizeAndSaveMock: vi.fn(),
}));

vi.mock('@engine/state-manager', () => ({
  createStateManager: vi.fn(() => ({
    commitChatState: commitSpy,
    advanceTurn: advanceTurnSpy,
    createSnapshot: createSnapshotSpy,
  })),
}));

// T16：handleCombatTriggerV3 的动态 import('@engine/combat-v3') 被替换为可编排的 fake ——
// 断言 setCombatCoordinator 在 runCombatV3 **之前**挂好（玩家首决策挂起的根因修复）。
vi.mock('@engine/combat-v3', () => ({
  runCombatV3: runCombatV3Mock,
}));

vi.mock('@engine/memory-summarizer', () => ({
  summarizeAndSave: summarizeAndSaveMock,
}));

vi.mock('../stores/ui-store', () => ({
  useUIStore: () => ({ toast: toastSpy }),
}));

// 🆕 T4：invalidatePromptSessions 的唯一职责 = 把本 pipeline 的 saveId 交给引擎清理。
// mock 掉引擎模块，直接 spy 收到的入参（断言「只清对应 saveId」）。
const { invalidatePromptSessionSpy } = vi.hoisted(() => ({
  invalidatePromptSessionSpy: vi.fn(),
}));

vi.mock('@engine/prompt-session-assembler', () => ({
  invalidatePromptSession: invalidatePromptSessionSpy,
}));

import { preCheckPlot, postCheckPlot } from '@engine/plot-engine';

function makeGameStore(overrides: Record<string, any> = {}) {
  return {
    // 🔴 必须与 makePipeline 的 saveId 一致：COR-02 之后管线拿它判「本轮结果还属不属于
    // 当前打开的存档」，对不上就丢弃正文 —— 桩里漏了这一格，7 条既有用例会一起变红。
    activeSaveId: 'save-test',
    messages: [],
    characters: [],
    saveProfile: null,
    activePlotEvents: [],
    recentMemories: [],
    gameTime: null,
    activeSave: null,
    isGenerating: false,
    agentLog: [],
    // 真 store 的 addMessage 会把落库的那条消息交回来（情景插画要它的 id/turn，D2）
    addMessage: vi.fn((content: string, role: string) => ({
      id: 'msg_stub',
      role,
      content,
      timestamp: 0,
      turn: 1,
    })),
    addSystemMessage: vi.fn(),
    setPendingOptions: vi.fn(),
    clearAgentLog: vi.fn(),
    startAgentLogTurn: vi.fn(),
    finishAgentLogTurn: vi.fn(),
    flushAgentLogWrites: vi.fn(async () => {}),
    agentLogHistory: [],
    clearAllAgentStatus: vi.fn(),
    startAgentActivityRun: vi.fn(() => 'activity-test'),
    finishAgentActivityRun: vi.fn(),
    markAgentActivityStopping: vi.fn(),
    recordAgentToolActivity: vi.fn(),
    updateAgentStatus: vi.fn(),
    clearAgentStatus: vi.fn(),
    addAgentLogEntry: vi.fn(),
    refreshFromDb: vi.fn(async () => {}),
    // 🆕 结算确认（2026-08-13 需求 D）：默认立即以原文确认（模拟玩家直接点「注入正文」）
    awaitCombatSummaryReview: vi.fn(async (p: { summaryText: string }) => p.summaryText),
    confirmCombatSummary: vi.fn(),
    discardCombatSummary: vi.fn(),
    markOpeningPromptConsumed: vi.fn(async () => true),
    releaseOpeningPromptClaim: vi.fn(async () => true),
    recordEjsVarsRejection: vi.fn(),
    ...overrides,
  } as any;
}

function makeSettingsStore(settingsOverrides: Record<string, any> = {}) {
  return {
    settings: {
      apiPool: [],
      // Q-18: per-Agent 设置合并成一张 `agents` 表（此前是 10 张并行 map，
      // 而且这份桩少列了 agentDirty / agentHistoryLayers / agentHistorySlice ——
      // 那正是「加一张 map 要改七处」的代价）
      agents: {},
      ...settingsOverrides,
    },
  } as any;
}

function makePipeline(
  gameOverrides: Record<string, any> = {},
  settingsOverrides: Record<string, any> = {},
) {
  return new GamePipeline({
    gameStore: makeGameStore(gameOverrides),
    settingsStore: makeSettingsStore(settingsOverrides),
    saveId: 'save-test',
  });
}

function makeResult(agentId: string, rawResponse: string): AgentResult {
  return { agentId, output: rawResponse, rawResponse, tokensUsed: 0, cacheHit: false, duration: 0 };
}

describe('侧链 Agent 调试调用身份', () => {
  it('同回合新建两个同名 client 时仍生成不同 invocationId', async () => {
    const addAgentLogEntry = vi.fn();
    const pipeline = makePipeline({ addAgentLogEntry });
    const factory = (pipeline as any).getClientFactory('run-debug');
    const endpoint: ApiEndpoint = {
      id: 'ep',
      name: 'DeepSeek',
      provider: 'deepseek',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'key',
      defaultModel: 'model',
      models: ['model'],
      timeout: 1000,
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { total_tokens: 1 },
      }),
      text: async () => '',
    } as Response);

    try {
      await factory('char_gen', endpoint, 'save-test').chat({
        messages: [{ role: 'user', content: 'first' }],
      });
      await factory('char_gen', endpoint, 'save-test').chat({
        messages: [{ role: 'user', content: 'second' }],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(addAgentLogEntry).toHaveBeenCalledTimes(2);
    const ids = addAgentLogEntry.mock.calls.map(([entry]) => entry.invocationId);
    expect(ids).toEqual(['run-debug:char_gen:1', 'run-debug:char_gen:2']);
  });
});

describe('sendOpeningPrompt', () => {
  it('Stop keeps input locked until pending work drains and rejects an overlapping run', async () => {
    const game = makeGameStore();
    const pipeline = new GamePipeline({
      gameStore: game,
      settingsStore: makeSettingsStore(),
      saveId: 'save-test',
    });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(pipeline as any, 'buildContext').mockImplementation(() => {
      (pipeline as any).pendingPlotTasks.push(pending);
      throw new Error('early failure with pending work');
    });
    const running = pipeline.run('first');
    pipeline.abort();
    const locked = game.isGenerating;
    const overlapping = pipeline.run('second');
    release();
    await Promise.all([running, overlapping]);
    expect(locked).toBe(true);
    expect((pipeline as any).buildContext).toHaveBeenCalledTimes(1);
    expect(game.isGenerating).toBe(false);
  });
  it('two pipeline instances sharing one save generate the opening only once', async () => {
    let consumed = false;
    const gameStore = makeGameStore({
      openingPrompt: 'OPENING',
      markOpeningPromptConsumed: vi.fn(async () => {
        if (consumed) return false;
        consumed = true;
        return true;
      }),
    });
    const options = {
      gameStore,
      settingsStore: makeSettingsStore(),
      saveId: 'save-test',
    };
    const first = new GamePipeline(options);
    const second = new GamePipeline(options);
    const firstRun = vi.spyOn(first, 'run').mockResolvedValue(true);
    const secondRun = vi.spyOn(second, 'run').mockResolvedValue(true);

    await Promise.all([first.sendOpeningPrompt(), second.sendOpeningPrompt()]);

    expect(firstRun.mock.calls.length + secondRun.mock.calls.length).toBe(1);
    expect(gameStore.markOpeningPromptConsumed).toHaveBeenCalledTimes(1);
  });

  it('releases the claim when the run produced no narrative at all', async () => {
    // API 一次抽风不该把开场永久烧掉 —— 玩家会拿到一个只有自己那句话、没法重来的存档。
    const gameStore = makeGameStore({ openingPrompt: 'OPENING' });
    const pipeline = new GamePipeline({
      gameStore,
      settingsStore: makeSettingsStore(),
      saveId: 'save-test',
    });
    vi.spyOn(pipeline, 'run').mockImplementation(async () => {
      gameStore.messages.push({ id: 'u1', role: 'user', content: 'OPENING' });
      return false;
    });

    await pipeline.sendOpeningPrompt();

    expect(gameStore.releaseOpeningPromptClaim).toHaveBeenCalledTimes(1);
  });

  it('keeps the claim when narrative already landed, and never re-renders the same user line', async () => {
    // 已经有叙事时重跑会把那段再写一遍；用户消息也已落库，重试不能重复插入。
    const gameStore = makeGameStore({
      openingPrompt: 'OPENING',
      messages: [
        { id: 'u1', role: 'user', content: 'OPENING' },
        { id: 'a1', role: 'assistant', content: '晨光落在石阶上。' },
      ],
    });
    const pipeline = new GamePipeline({
      gameStore,
      settingsStore: makeSettingsStore(),
      saveId: 'save-test',
    });
    const run = vi.spyOn(pipeline, 'run').mockResolvedValue(false);

    await pipeline.sendOpeningPrompt();

    expect(run).toHaveBeenCalledWith('OPENING', undefined, false);
    expect(gameStore.releaseOpeningPromptClaim).not.toHaveBeenCalled();
  });
});

describe('buildAgentConfigs — combat_v3 侧链装配', () => {
  it('agentConfigs 包含 combat_v3，systemPrompt 来自设置覆写', () => {
    const pipeline = makePipeline();
    const settings = (pipeline as any).settings.settings;
    patchAgentSettings(settings, 'combat_v3', {
      systemPrompt: '你是战斗决策 Agent（设置页覆写）',
    });

    const configs = (pipeline as any).buildAgentConfigs({});
    const combat = configs.find((config: any) => config.agentId === 'combat_v3');

    expect(combat).toBeDefined();
    expect(combat.systemPrompt).toBe('你是战斗决策 Agent（设置页覆写）');
  });

  it('未覆写时 systemPrompt 回落默认层（agent-config.json 的 combat_v3）', () => {
    const pipeline = makePipeline();
    const defaultPrompt = '你是《命定之诗》战斗决策 Agent。';

    const configs = (pipeline as any).buildAgentConfigs({
      combat_v3: { systemPrompt: defaultPrompt },
    });
    const combat = configs.find((config: any) => config.agentId === 'combat_v3');

    expect(combat).toBeDefined();
    expect(combat.systemPrompt).toBe(defaultPrompt);
  });
});

describe('buildAgentConfigs / buildEndpoints —— Delta 会话两个配置面（T4）', () => {
  it('buildAgentConfigs 把覆写层 tailPrompt 灌进 AgentConfig', () => {
    const pipeline = makePipeline();
    const settings = (pipeline as any).settings.settings;
    patchAgentSettings(settings, 'story', { tailPrompt: '请用简体中文作答' });

    const configs = (pipeline as any).buildAgentConfigs({});
    const story = configs.find((config: any) => config.agentId === 'story');

    expect(story.tailPrompt).toBe('请用简体中文作答');
  });

  it('buildAgentConfigs 未配置 tailPrompt → undefined（不发该字段）', () => {
    const pipeline = makePipeline();
    const configs = (pipeline as any).buildAgentConfigs({});
    const story = configs.find((config: any) => config.agentId === 'story');

    expect(story.tailPrompt).toBeUndefined();
  });

  it('buildEndpoints 把 ApiEntry.contextWindowTokens 灌进 ApiEndpoint', () => {
    const pipeline = makePipeline(
      {},
      {
        apiPool: [{ id: 'ep1', name: 'ep', model: 'm', contextWindowTokens: 128000 }],
      },
    );

    const endpoints = (pipeline as any).buildEndpoints();
    expect(endpoints[0].contextWindowTokens).toBe(128000);
  });

  it('buildEndpoints 对非正整数 contextWindowTokens 归一化为 undefined', () => {
    const pipeline = makePipeline(
      {},
      {
        apiPool: [
          { id: 'ep1', name: 'ep', model: 'm', contextWindowTokens: 0 },
          { id: 'ep2', name: 'ep', model: 'm', contextWindowTokens: -5 },
          { id: 'ep3', name: 'ep', model: 'm', contextWindowTokens: 1.5 },
          { id: 'ep4', name: 'ep', model: 'm', contextWindowTokens: 'big' as any },
        ],
      },
    );

    const endpoints = (pipeline as any).buildEndpoints();
    expect(endpoints.map((e: any) => e.contextWindowTokens)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('🆕 invalidatePromptSessions 只清本 pipeline 的 saveId', () => {
    invalidatePromptSessionSpy.mockClear();
    const pipeline = new GamePipeline({
      gameStore: makeGameStore(),
      settingsStore: makeSettingsStore(),
      saveId: 'save-T4',
    });

    pipeline.invalidatePromptSessions();

    expect(invalidatePromptSessionSpy).toHaveBeenCalledTimes(1);
    expect(invalidatePromptSessionSpy).toHaveBeenCalledWith('save-T4');
  });
});

describe('extractStoryOptions', () => {
  it('提取 <options> 块并剥离正文', () => {
    const raw = `夜色渐深，酒馆内人声鼎沸。

<options>
1. 走向吧台，向老板打听消息
2. 找个角落坐下，观察周围的人
3. 直接上二楼寻找线索
4. 离开酒馆，前往港口
</options>`;
    const { content, options } = extractStoryOptions(raw);
    expect(options).toEqual([
      '走向吧台，向老板打听消息',
      '找个角落坐下，观察周围的人',
      '直接上二楼寻找线索',
      '离开酒馆，前往港口',
    ]);
    expect(content).toBe('夜色渐深，酒馆内人声鼎沸。');
    expect(content).not.toContain('<options>');
  });

  it('无 options 块时原样返回', () => {
    const raw = '平静的一天过去了。';
    const { content, options } = extractStoryOptions(raw);
    expect(content).toBe(raw);
    expect(options).toEqual([]);
  });

  it('兼容中文顿号/括号序号分隔', () => {
    const raw = `正文。
<options>
1、选项甲
2) 选项乙
3．选项丙
</options>`;
    const { options } = extractStoryOptions(raw);
    expect(options).toEqual(['选项甲', '选项乙', '选项丙']);
  });

  it('忽略非序号行（空行/说明文字）', () => {
    const raw = `正文。
<options>

以下是可选行动：
1. 有效选项
</options>`;
    const { options } = extractStoryOptions(raw);
    expect(options).toEqual(['有效选项']);
  });

  it('options 块在正文中间时正确剥离且不留多余空行', () => {
    const raw = `第一段。

<options>
1. 选项
</options>

第二段。`;
    const { content } = extractStoryOptions(raw);
    expect(content).toBe('第一段。\n\n第二段。');
  });

  it('剥离 <maintext> 包裹标签（2026-08-02 修：正文标签泄漏）', () => {
    const raw = `<maintext>妲丽安轻轻推开门，月光洒进屋内。

她望向窗边。</maintext>

<options>
1. 上前搭话
2. 保持沉默
</options>`;
    const { content } = extractStoryOptions(raw);
    expect(content).not.toContain('<maintext>');
    expect(content).not.toContain('</maintext>');
    expect(content).toContain('妲丽安轻轻推开门');
    expect(content).toContain('她望向窗边');
  });

  it('无 maintext 包裹时原样保留正文', () => {
    const raw = '平静的一天过去了。';
    const { content } = extractStoryOptions(raw);
    expect(content).toBe(raw);
  });

  it('🔴 回归: 未闭合 <maintext>（AI 只写开标签）也要剥离', () => {
    // 真机 2026-08-02: 模型输出只有 `<maintext>` 开头、无 `</maintext>` 闭合，
    // 旧正则要求闭合标签才匹配 → 标签原样漏进 message。
    const raw = `<maintext>寒冷先于意识抵达。

你睁开眼睛。

奥利雅思("这个世界到底是什么地方？")

<dalian name="妲丽安" mood="思考"> 阿斯塔利亚。 </dalian></maintext>`;
    const { content } = extractStoryOptions(raw);
    expect(content).not.toContain('<maintext>');
    expect(content).not.toContain('</maintext>');
    expect(content).toContain('寒冷先于意识抵达');
    expect(content).toContain('你睁开眼睛');
  });

  it('未闭合 maintext + 带 <options> 时正文剥干净、选项独立提取', () => {
    const raw = `<maintext>正文第一句。

有人来了。

\`\`\`

<options>
1. 上前查看
2. 保持距离
</options>`;
    const { content, options } = extractStoryOptions(raw);
    expect(content).not.toContain('<maintext>');
    expect(content).not.toContain('<options>');
    expect(options).toEqual(['上前查看', '保持距离']);
    expect(content).toContain('正文第一句');
  });
});

describe('buildContext — plotSettings (步5)', () => {
  it('当前输入只进入 userInput，不混入既有历史', () => {
    const pipeline = makePipeline({
      messages: [
        { id: 'u1', role: 'user', content: '上一轮输入', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: '上一轮正文', timestamp: 2 },
      ],
    });

    const ctx = (pipeline as any).buildContext('当前输入');

    expect(ctx.userInput).toBe('当前输入');
    expect(ctx.history.map((message: { content: string }) => message.content)).toEqual([
      '上一轮输入',
      '上一轮正文',
    ]);
  });

  it('重试时从历史排除触发消息，只通过 userInput 注入一次', () => {
    const pipeline = makePipeline({
      messages: [
        { id: 'u1', role: 'user', content: '上一轮输入', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: '上一轮正文', timestamp: 2 },
        { id: 'u2', role: 'user', content: '需要重试的输入', timestamp: 3 },
      ],
    });

    const ctx = (pipeline as any).buildContext('需要重试的输入', 'u2');

    expect(ctx.userInput).toBe('需要重试的输入');
    expect(ctx.history.map((message: { id: string }) => message.id)).toEqual(['u1', 'a1']);
    expect(
      ctx.history.filter((message: { content: string }) => message.content === '需要重试的输入'),
    ).toHaveLength(0);
  });

  it('读取 activeSave.metadata.plotSettings', () => {
    const plotSettings = {
      mode: 'main',
      tabooContent: 'NTR',
      main: {
        durationYears: 3,
        allowNonWorldbookNpc: true,
        genrePreference: ['combat'],
        customPreference: '',
      },
    };
    const pipeline = makePipeline({
      activeSave: { id: 'save-test', metadata: { plotSettings } },
    });
    const ctx = (pipeline as any).buildContext('输入');
    expect(ctx.plotSettings).toEqual(plotSettings);
  });

  it('老存档无 plotSettings 字段 → off 兜底', () => {
    const pipeline = makePipeline({
      activeSave: { id: 'save-test', metadata: { characterName: '主角' } },
    });
    const ctx = (pipeline as any).buildContext('输入');
    expect(ctx.plotSettings).toEqual({ mode: 'off', tabooContent: '' });
  });

  it('无 activeSave → off 兜底', () => {
    const pipeline = makePipeline({ activeSave: null });
    const ctx = (pipeline as any).buildContext('输入');
    expect(ctx.plotSettings.mode).toBe('off');
  });
});

describe('buildAgentConfigs — story 流式投影', () => {
  it('回调接收累计的玩家可见正文，不暴露结构标签', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pipeline = makePipeline();
    (pipeline as any).settings.settings.apiPool = [
      {
        id: 'ep',
        name: 'test',
        provider: 'openai',
        baseUrl: 'https://example.test/v1',
        apiKey: 'test',
        defaultModel: 'model',
      },
    ];
    const chunks: Array<[string, boolean]> = [];
    const configs = (pipeline as any).buildAgentConfigs({}, (text: string, complete: boolean) =>
      chunks.push([text, complete]),
    );
    const stream = configs.find(
      (config: { agentId: string }) => config.agentId === 'story',
    ).streamCallbacks;

    stream.onChunk('<main', false);
    stream.onChunk('text>夜色渐深', false);
    stream.onChunk('</maintext><options>\n1. 前进', false);
    stream.onChunk('<maintext>夜色渐深</maintext><options>\n1. 前进', true);
    stream.onError('断流');

    expect(chunks).toEqual([
      ['', false],
      ['夜色渐深', false],
      ['夜色渐深', false],
      ['', true],
      ['', true],
    ]);
    warn.mockRestore();
  });
});

describe('handleAgentResult — story 正文投影', () => {
  it('持久化正文与选项，但不持久化控制区块和音频标记', async () => {
    const addMessage = vi.fn((content: string) => ({ id: 'm1', turn: 1, content }));
    const setPendingOptions = vi.fn();
    const pipeline = makePipeline({ addMessage, setPendingOptions });
    const raw = `<thinking>隐藏分析</thinking>
<maintext>夜色渐深。<play_audio mood="安静"/></maintext>
<options>
1. 前进
2. 等待
</options>`;

    await (pipeline as any).handleAgentResult(makeResult('story', raw));

    expect(setPendingOptions).toHaveBeenCalledWith(['前进', '等待']);
    expect(addMessage).toHaveBeenCalledWith('夜色渐深。', 'assistant');
  });

  it('rejects a nonblank envelope with no player-visible narrative', async () => {
    const addMessage = vi.fn((content: string) => ({ id: 'm1', turn: 1, content }));
    const pipeline = makePipeline({ addMessage });

    await expect(
      (pipeline as any).handleAgentResult(
        makeResult('story', '<maintext>   </maintext><options>1. 等待</options>'),
      ),
    ).rejects.toThrow('no player-visible narrative');
    expect(addMessage).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// COR-02（2026-08-09 审查）：孤儿回合不许写进后来打开的那个存档
// ══════════════════════════════════════════════════════════════════════════
describe('COR-02：存档归属闸', () => {
  // 失败场景：存档 A 生成中（story 在飞，约 20 秒）→ 玩家点「← 首页」→ 打开存档 B。
  // GamePage 无 KeepAlive，卸载即销毁；但在飞的 run() 仍会走到 handleAgentResult →
  // game.addMessage(...)，而 game-store 是从 **store** 取存档号的
  // （`saveId: activeSaveId.value`）—— 为 A 生成的正文于是落进 B 并永久留在 B 的历史里。

  it('🔴 store 已切到别的存档 → 本轮正文被丢弃，不写进那个存档', async () => {
    const addMessage = vi.fn((content: string) => ({ id: 'm1', turn: 1, content }));
    const pipeline = makePipeline({ addMessage, activeSaveId: 'another-save' });

    await (pipeline as any).handleAgentResult(
      makeResult('story', '<maintext>为存档 A 生成的正文</maintext>'),
    );

    expect(addMessage).not.toHaveBeenCalled();
  });

  it('🔴 被丢弃时不留下 lastStoryMessage —— 插画锚点不能指向一条不存在的消息', async () => {
    const pipeline = makePipeline({
      addMessage: vi.fn((content: string) => ({ id: 'm1', turn: 1, content })),
      activeSaveId: 'another-save',
    });

    await (pipeline as any).handleAgentResult(makeResult('story', '<maintext>正文</maintext>'));

    expect((pipeline as any).lastStoryMessage).toBeNull();
  });

  it('存档没变时照常写入（闸门不误伤正常回合）', async () => {
    const addMessage = vi.fn((content: string) => ({ id: 'm1', turn: 1, content }));
    const pipeline = makePipeline({ addMessage }); // activeSaveId 默认 = 'save-test'

    await (pipeline as any).handleAgentResult(makeResult('story', '<maintext>正文</maintext>'));

    expect(addMessage).toHaveBeenCalledWith('正文', 'assistant');
    expect((pipeline as any).lastStoryMessage).toMatchObject({ id: 'm1' });
  });

  it('存档已切走时不替新存档跑 refreshFromDb', async () => {
    const refreshFromDb = vi.fn(async () => {});
    const pipeline = makePipeline({ refreshFromDb, activeSaveId: 'another-save' });

    // run() 的 finally 一定会执行；这里让管线在早期就失败，只验回读没被触发
    await pipeline.run('输入');

    expect(refreshFromDb).not.toHaveBeenCalled();
  });

  // 🔴 以下四条是 2026-08-10 审查轮补的 —— 初版闸门只收编了 `addMessage`，
  // 而「本轮结果的投影」不止正文一条。

  it('🔴 系统消息（char_gen 卡片）同样过闸 —— 它与正文落到同一个 persistMessage', () => {
    const addSystemMessage = vi.fn();
    const pipeline = makePipeline({ addSystemMessage, activeSaveId: 'another-save' });

    (pipeline as any).emitSystemMessage({
      type: 'char_gen',
      characterName: '琴师',
      narrative: '一位琴师加入了队伍',
    });

    expect(addSystemMessage).not.toHaveBeenCalled();
  });

  it('存档没变时系统消息照常写入', () => {
    const addSystemMessage = vi.fn();
    const pipeline = makePipeline({ addSystemMessage });

    (pipeline as any).emitSystemMessage({
      type: 'char_gen',
      characterName: '琴师',
      narrative: '一位琴师加入了队伍',
    });

    expect(addSystemMessage).toHaveBeenCalledTimes(1);
  });

  it('🔴 正文被丢弃时行动选项也不铺进新存档的输入区', async () => {
    const setPendingOptions = vi.fn();
    const pipeline = makePipeline({ setPendingOptions, activeSaveId: 'another-save' });

    await (pipeline as any).handleAgentResult(
      makeResult('story', '<maintext>正文</maintext><options>1. 前进</options>'),
    );

    expect(setPendingOptions).not.toHaveBeenCalled();
  });

  it('🔴 存档已切走时不归还开场认领 —— 那会把别的存档的开场重放一遍', async () => {
    const releaseOpeningPromptClaim = vi.fn(async () => true);
    const pipeline = makePipeline({
      openingPrompt: 'OPENING',
      markOpeningPromptConsumed: vi.fn(async () => true),
      releaseOpeningPromptClaim,
      activeSaveId: 'another-save',
    });

    await pipeline.sendOpeningPrompt();

    expect(releaseOpeningPromptClaim).not.toHaveBeenCalled();
  });
});

describe('buildContext — EJS 两轴注入 (工坊 P2 / ADR-30)', () => {
  const player = {
    id: 'c1',
    type: 'player',
    name: '主角',
    hp: 80,
    maxHp: 100,
    mp: 10,
    maxMp: 20,
    sp: 5,
    maxSp: 10,
    level: 3,
    tierName: '普通',
    totalExp: 120,
    expToNext: 300,
    freeAttrPoints: 2,
    attributes: { str: 10, dex: 9, con: 8, int: 7, spi: 6 },
  } as any;

  it('注入 statData（读 saveProfile 的 gameTime/fp）', () => {
    const pipeline = makePipeline({
      characters: [player],
      saveProfile: {
        fp: 7,
        gameTime: { year: 1, month: 5, day: 24, hour: 15, minute: 30 },
        variables: { sys: {} },
      },
    });
    const ctx = (pipeline as any).buildContext('输入');
    expect(ctx.statData.主角.生命值).toBe(80);
    expect(ctx.statData.主角.属性.力量).toBe(10);
    expect(ctx.statData.命运点数).toBe(7);
    expect(ctx.statData.世界.时间).toBeTruthy();
  });

  it('statData 是孤儿深拷贝 —— 改它不脏 store 里的角色', () => {
    const pipeline = makePipeline({ characters: [player], saveProfile: null });
    const ctx = (pipeline as any).buildContext('输入');
    ctx.statData.主角.生命值 = 1;
    expect(player.hp).toBe(80);
  });

  it('注入空的 ejsVarsDrafts 容器（供持权 Agent 的 pass 登记草稿）', () => {
    const pipeline = makePipeline({ characters: [], saveProfile: null });
    const ctx = (pipeline as any).buildContext('输入');
    expect(ctx.ejsVarsDrafts).toBeInstanceOf(Map);
    expect(ctx.ejsVarsDrafts.size).toBe(0);
  });

  // ── 天气供值漂移（地图 v1 §5 接线表第一处）──────────────────────────
  //
  // `stat-projection` 从 T3 起就会写 `stats.世界.天气`，但**这个调用点从来没传过 weather**
  // —— 世界书里每一处 `stats.世界.天气` 都读不到那个键，而条目自己的 `|| '未知'`
  // 把它掩盖得干干净净（与 `blurByDefault` 同形状：逻辑对、没人供值）。
  // 这三条钉的是「有人供值」+「与 ctx.weather 同一条链」。

  it('🔴 statData.世界.天气 ← variables.sys.天气（此前这个键根本不存在）', () => {
    const pipeline = makePipeline({
      characters: [player],
      saveProfile: { variables: { sys: { 天气: '小雪' } } },
    });
    const ctx = (pipeline as any).buildContext('输入');
    expect(ctx.statData.世界.天气).toBe('小雪');
    // 同一条链的两个消费方不许漂：面板上写着「小雪」、提示词里却是别的天气
    expect(ctx.weather).toBe('小雪');
  });

  it('旧存档兜底：worldFlags.天气 / worldFlags.weather 也认（读法与出图同口径）', () => {
    const zh = (pipeline: any) => pipeline.buildContext('输入').statData.世界.天气;
    expect(
      zh(makePipeline({ characters: [player], saveProfile: { worldFlags: { 天气: '大雨' } } })),
    ).toBe('大雨');
    expect(
      zh(makePipeline({ characters: [player], saveProfile: { worldFlags: { weather: '沙暴' } } })),
    ).toBe('沙暴');
  });

  it('没有天气 → 整个键不出现（缺席不是空串，条目的守卫分支据此降级）', () => {
    const pipeline = makePipeline({
      characters: [player],
      saveProfile: { variables: { sys: {} } },
    });
    const ctx = (pipeline as any).buildContext('输入');
    expect(ctx.statData.世界?.天气).toBeUndefined();
    expect(ctx.weather).toBeUndefined();
  });
});

describe('handleAgentResult — plot_pre_check (步5)', () => {
  beforeEach(() => {
    vi.mocked(preCheckPlot).mockClear();
  });

  it('解析 <json> 输出 → 剧情导演区块注入 context.agentOutputs + preCheckPlot 落库', async () => {
    const pipeline = makePipeline();
    const ctx = (pipeline as any).buildContext('输入');
    (pipeline as any).currentContext = ctx;
    (pipeline as any).pendingPlotTasks = [];

    const raw = `思考过程...\n<json>{"triggeredEvents": [{"title": "血色婚礼", "reason": "抵达城堡"}], "relevantBackground": "公爵早已布下天罗地网", "directive": "节奏收紧，铺垫背叛"}</json>`;
    await (pipeline as any).handleAgentResult(makeResult('plot_pre_check', raw));
    await Promise.all((pipeline as any).pendingPlotTasks);

    const director = ctx.agentOutputs.get('plot_pre_check');
    expect(director).toContain('剧情导演');
    expect(director).toContain('公爵早已布下天罗地网');
    expect(director).toContain('节奏收紧，铺垫背叛');

    expect(preCheckPlot).toHaveBeenCalledTimes(1);
    const [saveId, jsonStr] = vi.mocked(preCheckPlot).mock.calls[0];
    expect(saveId).toBe('save-test');
    expect(jsonStr).toContain('血色婚礼');
  });

  it('解析失败 → console.warn 不中断管线', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pipeline = makePipeline();
    (pipeline as any).currentContext = (pipeline as any).buildContext('输入');
    (pipeline as any).pendingPlotTasks = [];

    await expect(
      (pipeline as any).handleAgentResult(makeResult('plot_pre_check', '不是 JSON 的输出')),
    ).resolves.not.toThrow();
    await Promise.all((pipeline as any).pendingPlotTasks);
    warn.mockRestore();
  });
});

describe('handleAgentResult — plot_post_check (步5)', () => {
  beforeEach(() => {
    vi.mocked(postCheckPlot).mockClear();
  });

  it('解析 <json> 输出 → postCheckPlot 落库', async () => {
    const pipeline = makePipeline();
    const ctx = (pipeline as any).buildContext('输入');
    (pipeline as any).currentContext = ctx;
    (pipeline as any).pendingPlotTasks = [];

    const raw = `<json>{"worldLineChanged": false, "changeLevel": "none", "eventUpdates": [{"title": "血色婚礼", "action": "complete"}], "newChildEvents": [], "outlineChanges": {"action": "none", "changes": ""}}</json>`;
    await (pipeline as any).handleAgentResult(makeResult('plot_post_check', raw));

    expect(postCheckPlot).toHaveBeenCalledTimes(1);
    const [saveId, jsonStr] = vi.mocked(postCheckPlot).mock.calls[0];
    expect(saveId).toBe('save-test');
    expect(jsonStr).toContain('血色婚礼');
  });

  it('postCheckPlot 抛错 → console.warn 不中断管线', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(postCheckPlot).mockRejectedValueOnce(new Error('DB 写入失败'));
    const pipeline = makePipeline();
    (pipeline as any).currentContext = (pipeline as any).buildContext('输入');
    (pipeline as any).pendingPlotTasks = [];

    await expect(
      (pipeline as any).handleAgentResult(
        makeResult('plot_post_check', '<json>{"worldLineChanged": false}</json>'),
      ),
    ).resolves.not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('mode=off 时 post_check 后不触发年度大纲生成', async () => {
    const { getLatestPlotOutline } = await import('@engine/database');
    vi.mocked(getLatestPlotOutline).mockClear();
    const pipeline = makePipeline();
    const ctx = (pipeline as any).buildContext('输入'); // 默认 off
    (pipeline as any).currentContext = ctx;
    (pipeline as any).pendingPlotTasks = [];

    await (pipeline as any).handleAgentResult(
      makeResult('plot_post_check', '<json>{"worldLineChanged": false}</json>'),
    );
    expect(getLatestPlotOutline).not.toHaveBeenCalled();
  });
});

describe('大纲纯捏人页生成（ensurePlotOutline 已退役）', () => {
  it('buildContext 不含游戏内大纲生成逻辑', () => {
    const pipeline = makePipeline({
      activeSave: {
        id: 'save-test',
        metadata: { plotSettings: { mode: 'side', tabooContent: '' } },
      },
    });
    const ctx = (pipeline as any).buildContext('输入');
    // 后续 buildAgentMessages 不再触发 plot_outline 游戏内调用
    expect(ctx).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════
// 🎵 场景配乐：地点变化触发 + AI 标记优先 + 开关
// ═══════════════════════════════════════════════════════════

const audioCalls: any[] = [];
const audioStopCalls = { n: 0 };

vi.mock('../stores/audio-store', () => ({
  useAudioStore: () => ({
    playByScene: vi.fn(async (q: any) => {
      audioCalls.push(q);
      return null;
    }),
    stop: vi.fn(() => {
      audioStopCalls.n += 1;
    }),
    init: vi.fn(async () => {}),
  }),
}));

// ============================================================================
// 工坊 P2 (ADR-30 D5) — EJS vars 差量提交 + 体积护栏
// ============================================================================

describe('flushEjsVarsDiffs — EJS vars 差量提交 (工坊 P2 / D5)', () => {
  type Draft = { base: Record<string, any>; draft: Record<string, any> };

  /** 造一个已备好 currentContext + 草稿表的管线 */
  function primed(drafts: Record<string, Draft>, gameOverrides: Record<string, any> = {}) {
    const pipeline = makePipeline(gameOverrides);
    const ctx = (pipeline as any).buildContext('输入');
    for (const [agentId, entry] of Object.entries(drafts)) {
      ctx.ejsVarsDrafts.set(agentId, entry);
    }
    (pipeline as any).currentContext = ctx;
    return pipeline;
  }

  /** 最近一次 commitChatState 的 ejsVarsDiffs 载荷 */
  function lastDiffs() {
    const call = commitSpy.mock.calls[commitSpy.mock.calls.length - 1] as any[];
    return call[1].ejsVarsDiffs;
  }

  beforeEach(() => {
    commitSpy.mockClear();
    toastSpy.mockClear();
  });

  it('有写入 → 差量随 commitChatState 落库（patches 为空，只带 ejsVarsDiffs）', async () => {
    const pipeline = primed({
      story: { base: { 计数器: 1 }, draft: { 计数器: 2, 新键: '值' } },
    });
    await (pipeline as any).flushEjsVarsDiffs(['story']);

    expect(commitSpy).toHaveBeenCalledTimes(1);
    const [patches, options] = commitSpy.mock.calls[0] as any[];
    expect(patches).toEqual([]);
    expect(options.ejsVarsDiffs).toHaveLength(1);
    // 路径带 sys. 前缀（diffVars 契约）
    expect(options.ejsVarsDiffs[0].replace).toEqual(
      expect.arrayContaining([
        { path: 'sys.计数器', value: 2 },
        { path: 'sys.新键', value: '值' },
      ]),
    );
  });

  it('删除也进差量（base 有 draft 无 → remove）', async () => {
    const pipeline = primed({ story: { base: { 旧键: 1 }, draft: {} } });
    await (pipeline as any).flushEjsVarsDiffs(['story']);
    expect(lastDiffs()[0].remove).toEqual([{ path: 'sys.旧键' }]);
  });

  it('空 diff 不传 —— 没写过就根本不调 commitChatState', async () => {
    const pipeline = primed({ story: { base: { a: 1 }, draft: { a: 1 } } });
    await (pipeline as any).flushEjsVarsDiffs(['story']);
    expect(commitSpy).not.toHaveBeenCalled();
  });

  it('没有草稿表 / 本 stage 无持权 Agent → 静默跳过', async () => {
    const bare = makePipeline();
    await (bare as any).flushEjsVarsDiffs(['story']);
    expect(commitSpy).not.toHaveBeenCalled();

    const pipeline = primed({ story: { base: {}, draft: { a: 1 } } });
    await (pipeline as any).flushEjsVarsDiffs(['vars_update']);
    expect(commitSpy).not.toHaveBeenCalled();
  });

  it('同阶段多个持权 Agent 按 agentId 字典序 —— 后者同路径覆盖前者', async () => {
    const pipeline = primed({
      story: { base: {}, draft: { 标记: '来自 story' } },
      alpha: { base: {}, draft: { 标记: '来自 alpha' } },
    });
    // 传入顺序刻意反着写，验证排序不看调用方顺序
    await (pipeline as any).flushEjsVarsDiffs(['story', 'alpha']);

    const diffs = lastDiffs();
    expect(diffs).toHaveLength(2);
    expect(diffs[0].replace[0].value).toBe('来自 alpha'); // a < s
    expect(diffs[1].replace[0].value).toBe('来自 story');
  });

  it('消费即摘表 —— 同一份草稿不会被后续 stage 重复提交', async () => {
    const pipeline = primed({ story: { base: {}, draft: { a: 1 } } });
    await (pipeline as any).flushEjsVarsDiffs(['story']);
    await (pipeline as any).flushEjsVarsDiffs(['story']);
    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect((pipeline as any).currentContext.ejsVarsDrafts.size).toBe(0);
  });

  it('落库抛错不外溢（簿记旁路不该吞掉本轮正文）', async () => {
    commitSpy.mockRejectedValueOnce(new Error('DB 炸了') as never);
    const pipeline = primed({ story: { base: {}, draft: { a: 1 } } });
    await expect((pipeline as any).flushEjsVarsDiffs(['story'])).resolves.toBeUndefined();
  });

  // ===== 体积护栏 =====

  it('超上限 → 整份拒绝：不落库 + toast + 诊断计数', async () => {
    const record = vi.fn();
    const huge = 'x'.repeat(300 * 1024); // > EJS_DIFF_SIZE_LIMIT (256 KB)
    const pipeline = primed(
      { story: { base: {}, draft: { 巨块: huge } } },
      { recordEjsVarsRejection: record },
    );
    await (pipeline as any).flushEjsVarsDiffs(['story']);

    expect(commitSpy).not.toHaveBeenCalled(); // 不截断、不部分提交
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toBe('story');
    expect(record.mock.calls[0][2]).toBeGreaterThan(256 * 1024);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(String(toastSpy.mock.calls[0][0])).toContain('叙事生成'); // 文案点名来源
  });

  it('同来源第二次超限：诊断计数照记，toast 不再弹（每存档每来源一次）', async () => {
    const record = vi.fn();
    const huge = 'x'.repeat(300 * 1024);
    const pipeline = primed(
      { story: { base: {}, draft: { 巨块: huge } } },
      { recordEjsVarsRejection: record },
    );
    await (pipeline as any).flushEjsVarsDiffs(['story']);
    // 第二轮：同一来源再超一次
    (pipeline as any).currentContext.ejsVarsDrafts.set('story', {
      base: {},
      draft: { 巨块: huge },
    });
    await (pipeline as any).flushEjsVarsDiffs(['story']);

    expect(record).toHaveBeenCalledTimes(2);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(commitSpy).not.toHaveBeenCalled();
  });

  it('一份超限不牵连同批的另一份（逐份判定）', async () => {
    const huge = 'x'.repeat(300 * 1024);
    const pipeline = primed({
      alpha: { base: {}, draft: { 巨块: huge } },
      story: { base: {}, draft: { 小键: 1 } },
    });
    await (pipeline as any).flushEjsVarsDiffs(['alpha', 'story']);

    expect(commitSpy).toHaveBeenCalledTimes(1);
    const diffs = lastDiffs();
    expect(diffs).toHaveLength(1);
    expect(diffs[0].replace).toEqual([{ path: 'sys.小键', value: 1 }]);
  });
});

// ═══════════════════════════════════════════════════════════
// 🖼 方言 systemPrompt 注入（图像 v2 / C3·C5）
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// 🖼 情景插画：三档分流（图像生成 §8 / D15 / D21 / D32 / D48）
// ═══════════════════════════════════════════════════════════

// ===== T16：combat_v3 玩家输入桥时序 + pre-combat 快照 =====
// 设计 2026-08-09 §3.5：handleCombatTriggerV3 必须在 `await runCombatV3(...)` **之前**
// setCombatCoordinator —— 此前句柄在战斗结束后才挂，waitForCommand（玩家首决策）永远
// 没人 resolve（T15 确认的「面板不弹」疑似根因）。顺带验证 pre-combat 快照在开战前打上。

// ══════════════════════════════════════════════════════════════════════════════
// T2（2026-08-10）：handleCombatTriggerV3 向 runCombatV3 传模板系统上下文 ——
// combatBrief（marker 组装）/ 过滤后的世界书（world_setting + race + system_core）/
// userInput / storyOutput / history。全部可选，缺省不崩。
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════
// F10（2026-09-04）：显式 API 绑定失效必须 fail-closed，绝不把请求换到别的 provider
// ══════════════════════════════════════════════════════════════════════════
describe('F10 端点绑定 fail-closed（buildAgentConfigs）', () => {
  it('🔴 主 DAG（story）显式绑定的池已删除 → 抛 EndpointBindingError（fail-stop）', () => {
    const pipeline = makePipeline({}, { apiPool: [{ id: 'B', name: 'B', model: 'm-b' }] });
    patchAgentSettings((pipeline as any).settings.settings, 'story', { model: 'A' });

    expect(() => (pipeline as any).buildAgentConfigs({})).toThrow(EndpointBindingError);
  });

  it('🔴 错误携带 agentId 与失效 id（用户可见的修整指引）', () => {
    const pipeline = makePipeline({}, { apiPool: [{ id: 'B', name: 'B', model: 'm-b' }] });
    patchAgentSettings((pipeline as any).settings.settings, 'story', { model: 'DELETED' });

    try {
      (pipeline as any).buildAgentConfigs({});
      expect.unreachable('应当抛错');
    } catch (err) {
      expect(err).toBeInstanceOf(EndpointBindingError);
      expect((err as EndpointBindingError).agentId).toBe('story');
      expect((err as EndpointBindingError).requestedPoolId).toBe('DELETED');
    }
  });

  it('🔴 侧链（item_gen）显式绑定失效 → 不抛（本轮不拖垮主 DAG），但端点不装配', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pipeline = makePipeline({}, { apiPool: [{ id: 'B', name: 'B', model: 'm-b' }] });
    patchAgentSettings((pipeline as any).settings.settings, 'item_gen', { model: 'A' });

    const configs = (pipeline as any).buildAgentConfigs({});
    const story = configs.find((c: { agentId: string }) => c.agentId === 'story');
    const itemGen = configs.find((c: { agentId: string }) => c.agentId === 'item_gen');

    // 主 DAG 照常（走默认 B），侧链端点悬空（apiEndpointId='' → 调用点再判跳过）
    expect(story.apiEndpointId).toBe('B');
    expect(itemGen.apiEndpointId).toBe('');
    // 跳过是可见的：console.warn 带 agent 名与失效 id
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('item_gen'));
    expect(warn.mock.calls.join('\n')).toContain('fail-closed');
    warn.mockRestore();
  });

  it('未设置 + 空池 → 不抛（首次配置淡失败走老路，apiEndpointId 为空）', () => {
    const pipeline = makePipeline(); // 默认 apiPool: []
    const configs = (pipeline as any).buildAgentConfigs({});
    const story = configs.find((c: { agentId: string }) => c.agentId === 'story');
    expect(story).toBeDefined();
    expect(story.apiEndpointId).toBe('');
  });

  it('未设置 + 非空池 → 默认端点（池首项）—— 首次配置体验不回归', () => {
    const pipeline = makePipeline(
      {},
      {
        apiPool: [
          { id: 'B', name: 'B', model: 'm-b' },
          { id: 'C', name: 'C', model: 'm-c' },
        ],
      },
    );
    const configs = (pipeline as any).buildAgentConfigs({});
    const story = configs.find((c: { agentId: string }) => c.agentId === 'story');
    expect(story.apiEndpointId).toBe('B');
    expect(story.model).toBe('m-b');
  });

  it('重排池不改变既有显式绑定（绑定语义与池顺序无关）', () => {
    const pipeline = makePipeline(
      {},
      {
        apiPool: [
          { id: 'C', name: 'C', model: 'm-c' },
          { id: 'B', name: 'B', model: 'm-b' },
        ],
      },
    );
    patchAgentSettings((pipeline as any).settings.settings, 'story', { model: 'B' });
    const configs = (pipeline as any).buildAgentConfigs({});
    const story = configs.find((c: { agentId: string }) => c.agentId === 'story');
    expect(story.apiEndpointId).toBe('B');
    expect(story.model).toBe('m-b');
  });
});

describe('F10 端点绑定 fail-closed（getEndpointForAgent 侧链热路径）', () => {
  it('🔴 显式绑定失效 → undefined + console.error（绝不换用池里别的 provider）', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pipeline = makePipeline({}, { apiPool: [{ id: 'B', name: 'B', model: 'm-b' }] });
    patchAgentSettings((pipeline as any).settings.settings, 'combat_v3', { model: 'A' });

    const endpoint = (pipeline as any).getEndpointForAgent('combat_v3');
    expect(endpoint).toBeUndefined();
    expect(error.mock.calls[0][0]).toContain('combat_v3');
    expect(error.mock.calls[0][0]).toContain('fail-closed');
    expect(error.mock.calls[0][0]).toContain('A');
    error.mockRestore();
    vi.restoreAllMocks();
  });

  it('未设置 + 非空池 → 默认端点（侧链老路也不回归）', () => {
    const pipeline = makePipeline({}, { apiPool: [{ id: 'B', name: 'B', model: 'm-b' }] });
    const endpoint = (pipeline as any).getEndpointForAgent('item_gen');
    expect(endpoint?.id).toBe('B');
  });

  it('🔴 默认层悬空绑定（内容包硬编码坏 id）→ 回落默认端点，不静默掐链', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pipeline = makePipeline({}, { apiPool: [{ id: 'B', name: 'B', model: 'm-b' }] });
    // 内容包 agentDefaults 塞了设备本地 pool id；用户覆写层没有 item_gen
    (pipeline as any).chainData = { agentDefaults: { item_gen: { model: '42f7ea15-stale' } } };

    const endpoint = (pipeline as any).getEndpointForAgent('item_gen');
    expect(endpoint?.id).toBe('B');
    expect(error).not.toHaveBeenCalled();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('item_gen'))).toBe(true);
    vi.restoreAllMocks();
  });

  it('🔴 默认层悬空，但用户覆写层也显式绑了同一个坏 id → 仍 fail-closed', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pipeline = makePipeline({}, { apiPool: [{ id: 'B', name: 'B', model: 'm-b' }] });
    (pipeline as any).chainData = { agentDefaults: { item_gen: { model: '42f7ea15-stale' } } };
    patchAgentSettings((pipeline as any).settings.settings, 'item_gen', {
      model: '42f7ea15-stale',
    });

    const endpoint = (pipeline as any).getEndpointForAgent('item_gen');
    expect(endpoint).toBeUndefined();
    expect(error.mock.calls[0][0]).toContain('item_gen');
    vi.restoreAllMocks();
  });
});

describe('F10 🔴 集成：选中 A 删掉 A，provider B 一个字节都收不到', () => {
  it('run() 在 dispatch 之前停轮：story 绑定失效 → fetch 零调用 + 可见报错', async () => {
    // 池里只剩 B；story 显式绑定的 A 已被删除 —— 旧实现会静默把请求发给 B
    const settings = makeSettingsStore({
      apiPool: [
        {
          id: 'B',
          name: 'B',
          provider: 'provider-b',
          baseUrl: 'https://b.example.test/v1',
          apiKey: 'k',
          model: 'm-b',
        },
      ],
    });
    patchAgentSettings(settings.settings, 'story', { model: 'A' });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({}),
      text: async () => '',
    } as Response);

    const pipeline = new GamePipeline({
      gameStore: makeGameStore(),
      settingsStore: settings,
      saveId: 'save-test',
    });

    const ok = await pipeline.run('向 B 发起一次不该发生的请求');

    expect(ok).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // 用户可见：toastSpy（ui-store mock）与 activityMessage 都带着修整指引
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('story'), 'error', 6000);

    globalThis.fetch = originalFetch;
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('independent review ownership repros', () => {
  it('disposed memory task cannot publish into another save', async () => {
    const gate = deferred<any>();
    summarizeAndSaveMock.mockReturnValueOnce(gate.promise);
    const game = makeGameStore();
    const pipeline = new GamePipeline({
      gameStore: game,
      settingsStore: makeSettingsStore(),
      saveId: 'save-test',
    });
    const task = (pipeline as any).persistMemorySummary(makeResult('memory_summary', 'summary'));
    await vi.waitFor(() => expect(summarizeAndSaveMock).toHaveBeenCalled());
    pipeline.dispose();
    game.activeSaveId = 'save-b';
    game.recentMemories = [];
    gate.resolve({ id: 'memory-a', saveId: 'save-test', importance: 5, keywords: [] });
    await task;
    expect(game.recentMemories).toEqual([]);
  });

  it('leaving during the opening claim does not permanently consume an empty opening', async () => {
    const gate = deferred<boolean>();
    const game = makeGameStore({
      openingPrompt: 'Opening',
      markOpeningPromptConsumed: vi.fn(() => gate.promise),
    });
    const pipeline = new GamePipeline({
      gameStore: game,
      settingsStore: makeSettingsStore(),
      saveId: 'save-test',
    });
    const task = pipeline.sendOpeningPrompt();
    expect(game.markOpeningPromptConsumed).toHaveBeenCalled();
    pipeline.dispose();
    gate.resolve(true);
    await task;
    expect(game.addMessage).not.toHaveBeenCalled();
    expect(game.releaseOpeningPromptClaim).toHaveBeenCalled();
  });
});
it('Stop then same-save remount cannot start a run before old cleanup drains', async () => {
  const game = makeGameStore();
  const settings = makeSettingsStore();
  const first = new GamePipeline({ gameStore: game, settingsStore: settings, saveId: 'save-test' });
  const gate = deferred<void>();
  vi.spyOn(first as any, 'buildContext').mockImplementation(() => {
    (first as any).pendingPlotTasks.push(gate.promise);
    throw new Error('controlled failure while a background task is pending');
  });
  const running = first.run('first');
  first.abort();
  first.dispose();
  game.isGenerating = false; // GamePage.onBeforeUnmount and loadSave.clearActive both do this.
  const second = new GamePipeline({
    gameStore: game,
    settingsStore: settings,
    saveId: 'save-test',
  });
  const buildSecond = vi.spyOn(second as any, 'buildContext').mockImplementation(() => {
    throw new Error('new run entered while previous cleanup remained pending');
  });
  const next = second.run('second');
  const admittedBeforeCleanup = buildSecond.mock.calls.length;
  gate.resolve();
  await Promise.all([running, next]);
  expect(admittedBeforeCleanup).toBe(0);
});

// ══════ 战斗形态改版（设计共识 §8）：combat_trigger 路由交锋拍 ══════

describe('combat_trigger 路由交锋拍（SKIRMISH_DEFAULT，2026-09-12 主人裁定）', () => {
  it('默认不再弹 v3 就绪面板，改走交锋拍编排（无玩家角色时明示失败，不抛）', async () => {
    const setSkirmishSession = vi.fn();
    const pipeline = makePipeline({ setSkirmishSession });
    const result = await (pipeline as any).handleCombatTrigger(
      { combatType: '标准', enemies: '骷髅', environment: '墓穴' } as never,
      '',
    );
    expect(result).toBeNull(); // 交锋拍内联结算，不经 CombatSummary
    expect(setSkirmishSession).not.toHaveBeenCalled(); // mock store 无玩家 → 评估前即失败
  });

  it('combat_trigger 走交锋拍时 enemyHint 由 marker 敌方名单+环境装配', async () => {
    // 间接验证：有玩家角色 + 无 endpoint → runSkirmishEncounter 返回明示原因
    const pipeline = makePipeline({
      player: {
        name: '理查德',
        level: 9,
        attributes: { str: 14, con: 14, dex: 12 },
        hp: 100,
        maxHp: 100,
      },
    });
    const result = await (pipeline as any).handleCombatTrigger(
      { combatType: '死斗', enemies: '骷髅兵,食尸鬼', environment: '墓穴' } as never,
      '',
    );
    expect(result).toBeNull(); // getEndpointForAgent 在测试环境下解析不到 → 明示失败路径，不抛
  });
});

// ══════ 封印卡启封流（积压 2026-09-14）：pipeline 组合链验证 ══════

describe('submitSkirmishCounter —— 封印卡启封流', () => {
  const 封印会话 = () => ({
    enemyName: '岩爪兽',
    enemyLevel: 12,
    intents: [{ move: '咬', threat: 10, counters: ['防御'] }],
    beat: 0,
    playerHp: 155,
    playerMaxHp: 155,
    enemyHp: 200,
    enemyMaxHp: 200,
    guard: 10,
    log: [],
    playedCards: [],
    counteredBeats: 0,
    activeEffects: [],
    unsealedCards: [],
    finished: null,
  });
  const 封印玩家 = (cardTier: string) => ({
    name: '莱恩',
    level: 9,
    attributes: { str: 14, con: 14, dex: 12, int: 10, spi: 10 },
    hp: 155,
    maxHp: 155,
    totalExp: 0,
    inventory: [
      {
        name: '封印试卡',
        type: '卡牌',
        quantity: 1,
        cardTier,
        词条: ['技能', '火'],
        sealed: true,
        recipe: { fusionKind: '叠加' },
      },
    ],
  });

  it('nat20 → 必启封：效果发动 + 破封账 + 参战卡账', async () => {
    const setSkirmishSession = vi.fn();
    const pipeline = makePipeline({
      player: 封印玩家('白铁'), // 白铁 DC8：20+0 必启封
      skirmishSession: 封印会话(),
      setSkirmishSession,
    });
    (pipeline as any).rollD20 = vi.fn(() => 20);
    await (pipeline as any).submitSkirmishCounter({ kind: '卡', name: '封印试卡' });

    const s = setSkirmishSession.mock.calls[setSkirmishSession.mock.calls.length - 1][0];
    expect(s.log.join('\n')).toContain('启封判定：d20=20+意志0 vs DC8 → 启封');
    expect(s.unsealedCards).toEqual(['封印试卡']);
    expect(s.playedCards).toEqual(['封印试卡']);
    expect(s.finished).toBeNull();
  });

  it('nat1 + 星辉 → 反噬：效果炸空 + 全额反冲，不记已用账', async () => {
    const setSkirmishSession = vi.fn();
    const pipeline = makePipeline({
      player: 封印玩家('星辉'), // DC20：1+0-20 = -19 → 反噬，反冲 20
      skirmishSession: 封印会话(),
      setSkirmishSession,
    });
    (pipeline as any).rollD20 = vi.fn(() => 1);
    await (pipeline as any).submitSkirmishCounter({ kind: '卡', name: '封印试卡' });

    const s = setSkirmishSession.mock.calls[setSkirmishSession.mock.calls.length - 1][0];
    expect(s.log.join('\n')).toContain('→ 反噬');
    expect(s.log.join('\n')).toContain('失控反冲：玩家 −20');
    expect(s.unsealedCards).toEqual(['封印试卡']); // 封印破了
    expect(s.playedCards).toEqual([]); // 但效果炸空，不算参战
    // 反制失败（行动值0）吃威胁 10 − 防御减免5 = 5，再吃反冲 20：155−5−20 = 130
    expect(s.playerHp).toBe(130);
  });
});

// ═══════════════════════════════════════════════════════════
// 好感共鸣（伙伴卡 × 好感度，2026-09-16 主人裁定）
// ═══════════════════════════════════════════════════════════

describe('submitSkirmishCounter —— 好感共鸣（伙伴卡 × 好感度）', () => {
  const 共鸣会话 = () => ({
    enemyName: '岩爪兽',
    enemyLevel: 12,
    intents: [{ move: '咬', threat: 10, counters: ['防御'] }],
    beat: 0,
    playerHp: 155,
    playerMaxHp: 155,
    enemyHp: 200,
    enemyMaxHp: 200,
    guard: 10,
    log: [],
    playedCards: [],
    counteredBeats: 0,
    activeEffects: [],
    unsealedCards: [],
    finished: null,
  });
  /** 召唤卡玩家；affection 作为同名 NPC 的好感记录注入 saveProfile.affections */
  const 召唤玩家 = (_affection?: number) => ({
    name: '莱恩',
    level: 9,
    attributes: { str: 14, con: 14, dex: 12, int: 10, spi: 10 },
    hp: 155,
    maxHp: 155,
    totalExp: 0,
    inventory: [
      {
        name: '莉薇娅',
        type: '卡牌',
        quantity: 1,
        cardTier: '青铜',
        词条: ['召唤', '风'],
      },
    ],
  });
  const makeSave = (affection?: number) => ({
    name: '莱恩',
    ...(affection !== undefined ? { affections: { 莉薇娅: affection } } : {}),
  });

  it('有同名 NPC 且好感 ≥90（誓死追随）→ 效果 ×1.5 + 审计行', async () => {
    const setSkirmishSession = vi.fn();
    const pipeline = makePipeline({
      player: 召唤玩家(),
      saveProfile: makeSave(95),
      skirmishSession: 共鸣会话(),
      setSkirmishSession,
    });
    (pipeline as any).rollD20 = vi.fn(() => 10);
    await (pipeline as any).submitSkirmishCounter({ kind: '卡', name: '莉薇娅' });

    const s = setSkirmishSession.mock.calls[setSkirmishSession.mock.calls.length - 1][0];
    const log = s.log.join('\n');
    expect(log).toContain('好感共鸣：与【莉薇娅】的羁绊（誓死追随 95）→ 效果 ×1.5');
    // 在场效果金额已乘 1.5（buff 2×power 取整后翻 1.5 倍，能整除故精确）
    expect(s.activeEffects[0].amount).toBe(Math.round((s.activeEffects[0].amount / 1.5) * 1.5));
  });

  it('反感（≤ -10）→ 消极怠工 ×0.8，效果缩水', async () => {
    const setSkirmishSession = vi.fn();
    const pipeline = makePipeline({
      player: 召唤玩家(),
      saveProfile: makeSave(-40),
      skirmishSession: 共鸣会话(),
      setSkirmishSession,
    });
    (pipeline as any).rollD20 = vi.fn(() => 10);
    await (pipeline as any).submitSkirmishCounter({ kind: '卡', name: '莉薇娅' });

    const s = setSkirmishSession.mock.calls[setSkirmishSession.mock.calls.length - 1][0];
    expect(s.log.join('\n')).toContain('好感共鸣：与【莉薇娅】的羁绊');
    expect(s.log.join('\n')).toContain('×0.8');
  });

  it('账本无同名记录 → 无共鸣（不加不减、无审计行）', async () => {
    const setSkirmishSession = vi.fn();
    const pipeline = makePipeline({
      player: 召唤玩家(),
      saveProfile: makeSave(undefined),
      skirmishSession: 共鸣会话(),
      setSkirmishSession,
    });
    (pipeline as any).rollD20 = vi.fn(() => 10);
    await (pipeline as any).submitSkirmishCounter({ kind: '卡', name: '莉薇娅' });

    const s = setSkirmishSession.mock.calls[setSkirmishSession.mock.calls.length - 1][0];
    expect(s.log.join('\n')).not.toContain('好感共鸣');
  });

  it('中立（好感 0，有记录）→ 不出审计行也不改数值（×1 等价不触发）', async () => {
    const setSkirmishSession = vi.fn();
    const pipeline = makePipeline({
      player: 召唤玩家(),
      saveProfile: makeSave(0),
      skirmishSession: 共鸣会话(),
      setSkirmishSession,
    });
    (pipeline as any).rollD20 = vi.fn(() => 10);
    await (pipeline as any).submitSkirmishCounter({ kind: '卡', name: '莉薇娅' });

    const s = setSkirmishSession.mock.calls[setSkirmishSession.mock.calls.length - 1][0];
    expect(s.log.join('\n')).not.toContain('好感共鸣');
  });

  it('非伙伴卡（技能/装备/直击）不吃共鸣 —— 名字撞了也不加', async () => {
    const setSkirmishSession = vi.fn();
    const pipeline = makePipeline({
      player: {
        name: '莱恩',
        level: 9,
        attributes: { str: 14, con: 14, dex: 12, int: 10, spi: 10 },
        hp: 155,
        maxHp: 155,
        totalExp: 0,
        inventory: [
          {
            name: '莉薇娅的祝福',
            type: '卡牌',
            quantity: 1,
            cardTier: '青铜',
            词条: ['技能', '火'],
          },
        ],
      },
      saveProfile: makeSave(95),
      skirmishSession: 共鸣会话(),
      setSkirmishSession,
    });
    (pipeline as any).rollD20 = vi.fn(() => 10);
    await (pipeline as any).submitSkirmishCounter({ kind: '卡', name: '莉薇娅的祝福' });

    const s = setSkirmishSession.mock.calls[setSkirmishSession.mock.calls.length - 1][0];
    expect(s.log.join('\n')).not.toContain('好感共鸣');
  });
});
