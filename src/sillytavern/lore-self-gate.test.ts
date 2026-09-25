/**
 * lore-self-gate.test.ts — 世界书 EJS 自门控验证（委托×世界书 批 2，2026-09-19）
 *
 * 背景：引擎裁定 enabled 是注入唯一主宰（关键词不参与判定），内容侧改用 EJS 自门控
 * 实现按需注入。本测试钉死两种门控在真实求值路径（renderWorldBookEntries）上的语义：
 *   · 区域条目：$map.currentTile.midTierName 匹配才渲染正文，不匹配渲染为空
 *   · 词汇条目：chat.match(词) 命中历史文本才渲染正文，未命中渲染为空
 * 空渲染 = 零 token —— 这是「叙事血肉按需付费」共识的机械保证。
 */
import { describe, expect, it } from 'vitest';
import { renderWorldBookEntries, clearEjsCompileCache } from './worldbook-loader';
import type { WorldBookEntry } from './types';
import type { EjsEvalContext } from './ejs-runtime';

function gated(name: string, condition: string, body: string): WorldBookEntry {
  return {
    uid: 1,
    name,
    content: `<% if (${condition}) { %>\n<${name}>\n${body}\n</${name}>\n<% } %>`,
    enabled: true,
    key: [],
    keysecondary: [],
    selectiveLogic: 0,
    order: 100,
    position: 0,
  };
}

function ctx(overrides: Partial<EjsEvalContext> = {}): EjsEvalContext {
  return {
    vars: {},
    historyText: '',
    seed: 'test-seed',
    ...overrides,
  } as unknown as EjsEvalContext;
}

describe('世界书 EJS 自门控（批 2 验证）', () => {
  it('区域门控：中层名匹配 → 正文注入', () => {
    clearEjsCompileCache();
    const entry = gated(
      '灰笺乡',
      "$map.currentTile && $map.currentTile.midTierName === '灰笺乡'",
      '矿里不闹鬼。鬼也嫌累。',
    );
    const result = renderWorldBookEntries(
      [entry],
      ctx({
        capabilities: {
          mapSnapshot: {
            current: {
              name: '灰笺矿区',
              terrain: '山脉',
              midTierName: '灰笺乡',
              water: null,
              impassable: false,
            },
            neighbors: [],
            developmentLevels: [],
          },
        } as never,
      }),
    );
    const text = result.dynamicText;
    expect(text).toContain('矿里不闹鬼');
  });

  it('区域门控：中层名不匹配 → 空渲染（零 token）', () => {
    clearEjsCompileCache();
    const entry = gated(
      '灰笺乡',
      "$map.currentTile && $map.currentTile.midTierName === '灰笺乡'",
      '矿里不闹鬼。鬼也嫌累。',
    );
    const result = renderWorldBookEntries(
      [entry],
      ctx({
        capabilities: {
          mapSnapshot: {
            current: {
              name: '帝都·冕京',
              terrain: '平原',
              midTierName: '冕京京畿',
              water: null,
              impassable: false,
            },
            neighbors: [],
            developmentLevels: [],
          },
        } as never,
      }),
    );
    expect(result.dynamicText.trim()).toBe('');
  });

  it('词汇门控：chat.match 命中历史 → 正文注入；未命中 → 空渲染', () => {
    clearEjsCompileCache();
    const hit = gated('身后灵', "chat.match('身后灵')", '卡在，故人在。');
    const miss = gated('本名武器', "chat.match('本名武器')", '卡随名长。');
    const result = renderWorldBookEntries(
      [hit, miss],
      ctx({ historyText: '昨夜她动用了身后灵，替那张卡挡下了最后一击。' }),
    );
    const text = result.dynamicText;
    expect(text).toContain('卡在，故人在');
    expect(text).not.toContain('卡随名长');
  });
});
