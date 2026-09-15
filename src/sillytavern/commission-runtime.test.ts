/**
 * commission-runtime.test.ts — 委托注入缝边界覆盖
 *
 * 钉合同：装什么读什么（原序透传）、没装 = 空数组兜底、空数组显式重装也是合法态。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  installCommissionPack,
  getCommissionDefs,
  isEmptyCommissionPack,
} from './commission-runtime';
import type { CommissionDef } from './card-workshop/commission';

const 委托 = (name: string): CommissionDef => ({
  name,
  requireCard: { minTier: '白铁' },
  rewards: { gc: 50, reputation: 5 },
});

describe('commission-runtime —— 注入缝合同', () => {
  beforeEach(() => {
    installCommissionPack([]);
  });

  it('没装过 = 空数组（兜底合同不是异常）', () => {
    expect(getCommissionDefs()).toEqual([]);
    expect(isEmptyCommissionPack()).toBe(true);
  });

  it('装入后原序透传', () => {
    installCommissionPack([委托('清剿矿坑魔物'), 委托('寻回失窃的传家卡')]);
    expect(getCommissionDefs().map((d) => d.name)).toEqual(['清剿矿坑魔物', '寻回失窃的传家卡']);
    expect(isEmptyCommissionPack()).toBe(false);
  });

  it('重装即替换（换包后不残留旧清单）；显式空数组 = 合法清空', () => {
    installCommissionPack([委托('旧委托')]);
    installCommissionPack([委托('新委托')]);
    expect(getCommissionDefs().map((d) => d.name)).toEqual(['新委托']);
    installCommissionPack([]);
    expect(getCommissionDefs()).toEqual([]);
    expect(isEmptyCommissionPack()).toBe(true);
  });

  it('非数组入参兜底为空（防脏数据污染模块级事实）', () => {
    installCommissionPack(undefined as never);
    expect(getCommissionDefs()).toEqual([]);
  });
});
