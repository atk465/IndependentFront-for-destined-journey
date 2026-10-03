/**
 * talent-naming.test.ts —— 融合起名边界覆盖（fake client，零网络）
 */
import { describe, it, expect, vi } from 'vitest';
import type { ApiEndpoint } from '../types';
import {
  buildNamingMessages,
  parseTalentNaming,
  runTalentFusionNaming,
  type TalentNamingDeps,
} from './talent-naming';

const endpoint = { baseUrl: 'http://test' } as unknown as ApiEndpoint;

const 好输出 = JSON.stringify({
  name: '垃圾摩托',
  description: '你亲手用废弃材料攒出的双轮魔物，破烂的外壳下藏着不容小觑的心脏。',
});

describe('buildNamingMessages —— 提示词硬约束', () => {
  it('system 禁数值、名字字数上限；user 带两源与产物条目', () => {
    const msgs = buildNamingMessages({
      saveId: 's',
      endpoint,
      sourceA: '【节俭持家】：……品质保底：普通',
      sourceB: '【摩托小子】：……品质上限：普通',
      productEntryLines: ['品质越一级（域：摩托）'],
    });
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('不得出现任何数值');
    expect(msgs[0].content).toContain('2~6 个字');
    expect(msgs[1].content).toContain('节俭持家');
    expect(msgs[1].content).toContain('品质越一级（域：摩托）');
  });
});

describe('parseTalentNaming —— 解析兜底', () => {
  it('裸 JSON：名字+描述透传；名字超长截 12', () => {
    const got = parseTalentNaming(JSON.stringify({ name: '名'.repeat(20), description: '好天赋' }));
    expect(got?.name).toHaveLength(12);
    expect(got?.description).toBe('好天赋');
  });
  it('name 缺失/空白 → null', () => {
    expect(parseTalentNaming(JSON.stringify({ description: '只有描述' }))).toBeNull();
    expect(parseTalentNaming('不是 JSON')).toBeNull();
  });
});

describe('runTalentFusionNaming —— 调用与错误路径', () => {
  it('好输出 → 解析结果；工厂收到 talent-naming 与 saveId', async () => {
    const seen: string[] = [];
    const chat = vi.fn(async () => ({ output: 好输出 }));
    const deps: TalentNamingDeps = {
      clientFactory: (agentId, _e, saveId) => {
        seen.push(agentId, saveId);
        return { chat };
      },
    };
    const got = await runTalentFusionNaming(
      {
        saveId: 'save-1',
        endpoint,
        sourceA: '【节俭持家】',
        sourceB: '【摩托小子】',
        productEntryLines: ['品质越一级（域：摩托）'],
      },
      deps,
    );
    expect(got).toEqual({
      name: '垃圾摩托',
      description: '你亲手用废弃材料攒出的双轮魔物，破烂的外壳下藏着不容小觑的心脏。',
    });
    expect(seen).toEqual(['talent-naming', 'save-1']);
  });
  it('client 报 error → 抛「融合起名调用失败」', async () => {
    const deps: TalentNamingDeps = {
      clientFactory: () => ({ chat: async () => ({ output: null, error: '限流' }) }),
    };
    await expect(
      runTalentFusionNaming(
        { saveId: 's', endpoint, sourceA: 'a', sourceB: 'b', productEntryLines: [] },
        deps,
      ),
    ).rejects.toThrow('融合起名调用失败');
  });
  it('垃圾输出 → 抛「不可解析」（调用方走玩家自填兜底）', async () => {
    const deps: TalentNamingDeps = {
      clientFactory: () => ({ chat: async () => ({ output: '它叫超级无敌摩托！' }) }),
    };
    await expect(
      runTalentFusionNaming(
        { saveId: 's', endpoint, sourceA: 'a', sourceB: 'b', productEntryLines: [] },
        deps,
      ),
    ).rejects.toThrow('不可解析');
  });
});
