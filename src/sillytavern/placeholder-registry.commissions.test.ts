/**
 * `{{COMMISSIONS}}` 渲染器测试（卡牌工坊 委托板 / ADR-32 同款分工）
 *
 * 数据（委托清单）来自内容注册表第 15 面经 `commission-runtime` 缝、game-pipeline
 * `buildContext` 供值；本文件测**措辞与两条空串出口**（清单空 / 战斗活跃），以及
 * 供值链路的源码断言（blurByDefault 教训）。
 */

import { describe, expect, it } from 'vitest';

import { PLACEHOLDER_REGISTRY } from './placeholder-registry';
import type { AgentConfig, AgentContext } from './types';

function mockConfig(): AgentConfig {
  return {
    agentId: 'story',
    apiEndpointId: 'ep1',
    model: 'test-model',
    enabled: true,
    worldBookIds: [],
    temperature: 0.7,
    maxTokens: 4096,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    retryOnFail: true,
    timeout: 30000,
    userId: 'test-user',
    promptTemplate: { fixedSystem: '', fixedExamples: '' },
  };
}

function mockCtx(overrides: Record<string, unknown> = {}): AgentContext {
  return {
    variables: {},
    characters: [],
    messages: [],
    ...(overrides as Record<string, never>),
  } as unknown as AgentContext;
}

const 清单 = [
  {
    name: '清剿矿坑魔物',
    description: '矿坑深处近来有魔物袭扰',
    requireCard: { minTier: '白银', formEntry: '召唤' },
    rewards: { gc: 120, reputation: 8, materials: [{ name: '魔物结晶', quantity: 2 }] },
  },
];

describe('{{COMMISSIONS}} 渲染器', () => {
  it('清单空 → 空串（零 token，常态出口）', () => {
    const r = PLACEHOLDER_REGISTRY['COMMISSIONS'](mockCtx({ commissionDefs: [] }), mockConfig());
    expect(r).toBe('');
    expect(PLACEHOLDER_REGISTRY['COMMISSIONS'](mockCtx({}), mockConfig())).toBe('');
  });

  it('战斗会话活跃 → 空串（照随机事件 §13-2 同款静默）', () => {
    const r = PLACEHOLDER_REGISTRY['COMMISSIONS'](
      mockCtx({ commissionDefs: 清单, combatActive: true }),
      mockConfig(),
    );
    expect(r).toBe('');
  });

  it('正常出块：外壳 + 接取/交付纪律 + 一条一行（名称/描述/收卡/报酬）', () => {
    const r = PLACEHOLDER_REGISTRY['COMMISSIONS'](mockCtx({ commissionDefs: 清单 }), mockConfig());
    expect(r.startsWith('<commissions>')).toBe(true);
    expect(r.endsWith('</commissions>')).toBe(true);
    expect(r).toContain('同名');
    expect(r).toContain('不得自行宣布委托完成');
    expect(r).toContain('「清剿矿坑魔物」：矿坑深处近来有魔物袭扰');
    expect(r).toContain('品质不低于白银');
    expect(r).toContain('召唤类');
    expect(r).toContain('赏金 120G');
    expect(r).toContain('声望 +8');
    expect(r).toContain('魔物结晶×2');
  });

  it('极简委托（只给名字和最低奖励）也不缺关键段', () => {
    const r = PLACEHOLDER_REGISTRY['COMMISSIONS'](
      mockCtx({ commissionDefs: [{ name: '神秘委托', requireCard: {}, rewards: {} }] }),
      mockConfig(),
    );
    expect(r).toContain('「神秘委托」');
    expect(r).toContain('不限');
    expect(r).toContain('面议');
  });
});

// ══════════════════════════════════════════════════════════════
// 供值链路（blurByDefault 教训：单模块测试证明不了有人供值）
// ══════════════════════════════════════════════════════════════

const UI_SOURCES: Record<string, string> = import.meta.glob('@ui/lib/game-pipeline.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

describe('AgentContext 供值', () => {
  it('🔴 game-pipeline 的 buildContext 真的供了 commissionDefs（漏供 = 委托块静默消失）', () => {
    const source = Object.values(UI_SOURCES)[0] ?? '';
    expect(source).toContain('commissionDefs: getCommissionDefs()');
  });

  it('🔴 占位符白名单放行 COMMISSIONS（未注册会被当 unknown 原样留在正文）', () => {
    const r = PLACEHOLDER_REGISTRY['COMMISSIONS'](mockCtx({ commissionDefs: 清单 }), mockConfig());
    // 能解析出块本身就说明注册成功；这里再钉一次字面量防手滑改名
    expect(PLACEHOLDER_REGISTRY['COMMISSIONS']).toBeDefined();
    expect(r).toContain('<commissions>');
  });
});
