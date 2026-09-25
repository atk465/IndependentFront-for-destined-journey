/**
 * skirmish-agent.test.ts — AI 装配层边界覆盖（fake client，零网络）
 *
 * 钉三件事：提示词里给 AI 的硬约束（拍数/白名单/威胁标定锚）；
 * 解析兜底口径（model-json 剥壳 + coerceIntents 夹逼 + name 缺失整条作废）；
 * 调用错误路径（error 抛 / 垃圾输出抛 / 空演绎回退一句话）。
 */
import { describe, it, expect, vi } from 'vitest';
import type { ApiEndpoint } from '../types';
import {
  buildAssessmentMessages,
  parseSkirmishAssessment,
  runSkirmishAssessment,
  buildChronicleMessages,
  runSkirmishChronicle,
  type SkirmishClient,
  type SkirmishAgentDeps,
} from './skirmish-agent';

const endpoint = {
  baseUrl: 'http://test',
  apiKey: 'k',
  defaultModel: 'm',
} as unknown as ApiEndpoint;

const 好档案 = {
  enemyName: '岩爪兽',
  enemyLevel: 12,
  enemyHp: 320,
  enemyPower: 95,
  intents: [
    { move: '蓄力·崩山击', threat: 30, counters: ['打断', '防御'], hook: '后肢刨地蓄力' },
    { move: '连环爪击', threat: 22, counters: ['闪避'] },
    { move: '咆哮', threat: 12, counters: ['打断了', '火球'] },
  ],
};

const fakeDeps = (
  client: SkirmishClient,
  onFactory?: (agentId: string, saveId: string) => void,
): SkirmishAgentDeps => ({
  clientFactory: (agentId, _endpoint, saveId) => {
    onFactory?.(agentId, saveId);
    return client;
  },
});

describe('buildAssessmentMessages —— 提示词硬约束', () => {
  it('system 含 JSON 形状、白名单四标签、招式轮换与威胁标定锚', () => {
    const [sys] = buildAssessmentMessages({
      saveId: 's',
      endpoint,
      playerLevel: 9,
      playerPower: 30,
    });
    expect(sys.role).toBe('system');
    expect(sys.content).toContain('"intents"');
    expect(sys.content).toContain('强攻 / 防御 / 闪避 / 打断');
    expect(sys.content).toContain('intents 输出 3 条');
    expect(sys.content).toContain('招式轮换');
    expect(sys.content).toContain('势均力敌 ≈ 40'); // 威胁锚 = 行动值 30 + 10
    expect(sys.content).toContain('玩家等级 9');
  });
  it('intentsCount 覆盖招式条数（夹 MAX_INTENTS）；线索与场景进 user 消息', () => {
    const msgs = buildAssessmentMessages({
      saveId: 's',
      endpoint,
      playerLevel: 9,
      playerPower: 30,
      intentsCount: 5,
      enemyHint: '熔岩裂缝里的巨兽',
      sceneHint: '灼热盆地',
    });
    expect(msgs[0].content).toContain('intents 输出 5 条');
    expect(msgs[1].content).toContain('熔岩裂缝里的巨兽');
    expect(msgs[1].content).toContain('灼热盆地');
  });
  it('无线索时让 AI 自拟遭遇', () => {
    const [, user] = buildAssessmentMessages({
      saveId: 's',
      endpoint,
      playerLevel: 1,
      playerPower: 10,
    });
    expect(user.content).toContain('自拟');
  });
});

describe('parseSkirmishAssessment —— 解析兜底', () => {
  it('裸 JSON：合法档案透传，intents 经 coerceIntents 过滤白名单外的标签', () => {
    const got = parseSkirmishAssessment(JSON.stringify(好档案));
    expect(got?.enemyName).toBe('岩爪兽');
    expect(got?.enemyLevel).toBe(12);
    expect(got?.enemyHp).toBe(320);
    expect(got?.enemyPower).toBe(95);
    expect(got?.intents[2].counters).toEqual(['防御']); // 打断了/火球 被滤空 → 兜底防御
  });
  it('enemyPower 缺失/脏 → 按 enemyLevel 估（碾压判定保守，不误跳拍）', () => {
    expect(
      parseSkirmishAssessment(JSON.stringify({ enemyName: '史莱姆', enemyLevel: 3 }))?.enemyPower,
    ).toBe(3);
    expect(
      parseSkirmishAssessment(
        JSON.stringify({ enemyName: '史莱姆', enemyLevel: 3, enemyPower: -1 }),
      )?.enemyPower,
    ).toBe(3);
  });
  it('围栏 JSON 也能剥（model-json 能力）', () => {
    const got = parseSkirmishAssessment('```json\n' + JSON.stringify(好档案) + '\n```');
    expect(got?.enemyName).toBe('岩爪兽');
  });
  it('enemyName 缺失/空白 → 整条作废（null）', () => {
    expect(parseSkirmishAssessment(JSON.stringify({ enemyLevel: 3 }))).toBeNull();
    expect(parseSkirmishAssessment(JSON.stringify({ enemyName: '   ' }))).toBeNull();
    expect(parseSkirmishAssessment('不是 JSON')).toBeNull();
  });
  it('等级/HP 脏数据兜底 1/30；名字超长截 40', () => {
    const got = parseSkirmishAssessment(
      JSON.stringify({ enemyName: '兽'.repeat(50), enemyLevel: '高', enemyHp: -5, intents: '坏' }),
    );
    expect(got?.enemyName).toHaveLength(40);
    expect(got?.enemyLevel).toBe(1);
    expect(got?.enemyHp).toBe(30);
    expect(got?.intents).toEqual([]);
  });
});

describe('runSkirmishAssessment —— 调用与错误路径', () => {
  it('好输出 → 解析结果；工厂收到 skirmish_eval 与 saveId', async () => {
    const seen: { agentId: string; saveId: string }[] = [];
    const chat = vi.fn(async () => ({ output: JSON.stringify(好档案) }));
    const got = await runSkirmishAssessment(
      { saveId: 'save-1', endpoint, playerLevel: 9, playerPower: 30 },
      fakeDeps({ chat }, (agentId, saveId) => seen.push({ agentId, saveId })),
    );
    expect(chat).toHaveBeenCalledTimes(1);
    expect(got.enemyName).toBe('岩爪兽');
    expect(seen).toEqual([{ agentId: 'skirmish_eval', saveId: 'save-1' }]);
  });
  it('client 报 error → 抛「敌情评估调用失败」', async () => {
    const deps = fakeDeps({ chat: async () => ({ output: null, error: '超时' }) });
    await expect(
      runSkirmishAssessment({ saveId: 's', endpoint, playerLevel: 9, playerPower: 30 }, deps),
    ).rejects.toThrow('敌情评估调用失败');
  });
  it('垃圾输出 → 抛「不可解析」，不静默开战', async () => {
    const deps = fakeDeps({ chat: async () => ({ output: '我觉得这只兽很强。' }) });
    await expect(
      runSkirmishAssessment({ saveId: 's', endpoint, playerLevel: 9, playerPower: 30 }, deps),
    ).rejects.toThrow('不可解析');
  });
});

describe('buildChronicleMessages —— 战斗记叙提示词', () => {
  it('system 含结局基调与「不引入新数值」约束；user 带玩家称呼与审计链', () => {
    const msgs = buildChronicleMessages({
      saveId: 's',
      endpoint,
      enemyName: '岩爪兽',
      playerTitle: '星辉冒险者',
      log: ['◆ 战斗模式 · 交锋拍制 ◆', '▸ 打出 燎原符卡：d20=17'],
      finish: '碾压',
    });
    expect(msgs[0].content).toContain('「碾压」');
    expect(msgs[0].content).toContain('不得引入任何新数值');
    expect(msgs[0].content).toContain('200~350 字');
    expect(msgs[0].content).toContain('连续的动作画面');
    // 2026-09-25 主人裁定：叙事禁机制词（拍/行动值/威胁/审计/反制）
    expect(msgs[0].content).toContain('禁止机制词');
    expect(msgs[0].content).not.toContain('每一拍的反制');
    expect(msgs[0].content).not.toContain('结束缘由');
    expect(msgs[1].content).toContain('星辉冒险者');
    expect(msgs[1].content).toContain('▸ 打出 燎原符卡：d20=17');
  });
  it('玩家主动结束：结束缘由进提示词，收束必须贴合（主人裁定）', () => {
    const msgs = buildChronicleMessages({
      saveId: 's',
      endpoint,
      enemyName: '岩爪兽',
      log: ['▸ 冒险者收手：「它已无战意，放它归山」'],
      finish: '撤退',
      endReason: '它已无战意，放它归山',
    });
    expect(msgs[0].content).toContain('「它已无战意，放它归山」');
    expect(msgs[0].content).toContain('收束必须贴合');
  });
});

describe('runSkirmishChronicle —— 调用与回退', () => {
  it('返回 trim 后的叙事文本', async () => {
    const deps = fakeDeps({ chat: async () => ({ output: '  岩爪兽轰然倒地。\n\n' }) });
    const got = await runSkirmishChronicle(
      { saveId: 's', endpoint, enemyName: '岩爪兽', log: ['x'], finish: '胜利' },
      deps,
    );
    expect(got).toBe('岩爪兽轰然倒地。');
  });
  it('空输出 → 回退确定性一句话（不空转）', async () => {
    const deps = fakeDeps({ chat: async () => ({ output: '' }) });
    const got = await runSkirmishChronicle(
      { saveId: 's', endpoint, enemyName: '岩爪兽', log: [], finish: '撤退' },
      deps,
    );
    expect(got).toBe('与【岩爪兽】的交锋落幕（撤退）。');
  });
  it('client 报 error → 抛「战斗记叙调用失败」', async () => {
    const deps = fakeDeps({ chat: async () => ({ output: null, error: '限流' }) });
    await expect(
      runSkirmishChronicle(
        { saveId: 's', endpoint, enemyName: 'x', log: [], finish: '胜利' },
        deps,
      ),
    ).rejects.toThrow('战斗记叙调用失败');
  });
});
