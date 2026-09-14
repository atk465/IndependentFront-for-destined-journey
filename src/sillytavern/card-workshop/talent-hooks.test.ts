/**
 * talent-hooks.test.ts —— 规则层钩子注册表边界覆盖
 */
import { describe, it, expect } from 'vitest';
import {
  collectRuleHooks,
  expMultiplierOf,
  hpMultiplierOf,
  statMultiplierOf,
  hasVictoryMaterial,
  hasDefeatReward,
  type RuleHook,
} from './talent-hooks';

const T = (name: string) => ({ name });

describe('collectRuleHooks —— 规则钩子注册表', () => {
  it('鸿蒙道体 → 经验×2；霸巨人体魄 → HP×3', () => {
    const hooks = collectRuleHooks([T('鸿蒙道体'), T('霸巨人体魄')]);
    expect(expMultiplierOf(hooks)).toBe(2);
    expect(hpMultiplierOf(hooks)).toBe(3);
  });
  it('无规则天赋 → 倍率全 1、无素材/战败钩子', () => {
    const hooks = collectRuleHooks([]);
    expect(expMultiplierOf(hooks)).toBe(1);
    expect(hpMultiplierOf(hooks)).toBe(1);
    expect(statMultiplierOf(hooks)).toBe(1);
    expect(hasVictoryMaterial(hooks)).toBe(false);
    expect(hasDefeatReward(hooks)).toBe(false);
  });
  it('素材之王 → victoryMaterial；世界线收束点 → defeatReward', () => {
    const hooks = collectRuleHooks([T('素材之王'), T('世界线的收束点')]);
    expect(hasVictoryMaterial(hooks)).toBe(true);
    expect(hasDefeatReward(hooks)).toBe(true);
  });
  it('多规则天赋叠加不互斥（数值可共存）', () => {
    const hooks = collectRuleHooks([T('鸿蒙道体'), T('素材之王'), T('霸巨人体魄')]);
    expect(expMultiplierOf(hooks)).toBe(2);
    expect(hpMultiplierOf(hooks)).toBe(3);
    expect(hasVictoryMaterial(hooks)).toBe(true);
  });
  it('statMultiplier：女王领域 = 1.5', () => {
    const hooks = collectRuleHooks([T('女王领域')]);
    expect(statMultiplierOf(hooks)).toBe(1.5);
  });
});

describe('RuleHook 类型契约', () => {
  it('RuleHook 形状钉死', () => {
    const hook: RuleHook = { kind: 'expMultiplier', value: 2 };
    expect(hook.kind).toBe('expMultiplier');
    expect(hook.value).toBe(2);
  });
});
