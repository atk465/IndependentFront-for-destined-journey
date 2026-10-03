/**
 * placeholder-names.ratchet.test.ts —— 引擎占位符名单棘轮（2026-10-02 B-2）
 *
 * preset 预处理的剥离白名单唯一真源是 placeholder-names.ts 的静态名单（与
 * placeholder-registry 不能互相 import，会成环）。本测试把两者钉在一起：
 * **PLACEHOLDER_REGISTRY 的每个键都必须登记在名单里**——新增 resolver 忘记登记
 * 名单，预设预处理就会把它当未知宏静默剥掉（B-2 的 <天赋> 空壳事故），这里立刻红。
 */
import { describe, it, expect } from 'vitest';
import { ENGINE_PLACEHOLDER_NAMES } from './placeholder-names';
import { PLACEHOLDER_REGISTRY } from './placeholder-registry';

describe('引擎占位符名单棘轮（B-2）', () => {
  it('PLACEHOLDER_REGISTRY 的每个键都登记在名单或被 AGENT.* 前缀规则覆盖', () => {
    const missing = Object.keys(PLACEHOLDER_REGISTRY).filter((k) => {
      if (k.startsWith('AGENT.')) return !/^AGENT\.[A-Z_]+$/.test(k);
      return !ENGINE_PLACEHOLDER_NAMES.includes(k);
    });
    expect(missing).toEqual([]);
  });

  it('名单无重复、无空串（防手滑）', () => {
    expect(new Set(ENGINE_PLACEHOLDER_NAMES).size).toBe(ENGINE_PLACEHOLDER_NAMES.length);
    expect(ENGINE_PLACEHOLDER_NAMES.every((n) => n.length > 0)).toBe(true);
  });
});
