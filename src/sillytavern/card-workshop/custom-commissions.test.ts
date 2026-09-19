/**
 * custom-commissions.test.ts — 自定义委托/探索事件：注册表 / 合并覆盖 / 宽读门禁
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerCustomCommission,
  unregisterCustomCommission,
  getCustomCommissions,
  replaceCustomCommissions,
  coerceCustomCommissions,
  mergeCommissions,
  registerCustomEvent,
  unregisterCustomEvent,
  getCustomEvents,
  replaceCustomEvents,
  coerceCustomEvents,
  mergeEventDefs,
} from './custom-commissions';
import type { CommissionDef } from './commission';
import type { RandomEventDef } from '../types-random-events';

const DEF: CommissionDef = {
  name: '雪莲征集·手写',
  requireMaterial: { name: '雪莲', count: 3 },
  destMidTier: 'mt-north',
  grade: 'A',
  issuerMidTier: 'mt-capital',
  deadlineDays: 10,
  chainId: 'chain-xue',
  chainOrder: 1,
  rewards: { gc: 500, card: { name: '禁忌卡·雪葬' } },
};

const EVENT: RandomEventDef = {
  name: '雪葬·终焉',
  brief: '雪原深处的祭坛亮了。',
  trigger: { type: 'exploration', scope: { anyOf: ['mt-north'] }, chancePct: 100 },
  once: true,
  available: { quest: { name: '雪莲征集·手写', statusAnyOf: ['进行中'] } },
};

beforeEach(() => {
  replaceCustomCommissions([]);
  replaceCustomEvents([]);
});

describe('自定义委托注册表', () => {
  it('注册 / 注销 / 整表替换', () => {
    registerCustomCommission(DEF);
    expect(getCustomCommissions()).toEqual([DEF]);
    // 同名重注册不留双份（编辑器多次保存）
    registerCustomCommission({ ...DEF, grade: 'S' });
    expect(getCustomCommissions()).toHaveLength(1);
    expect(getCustomCommissions()[0].grade).toBe('S');
    unregisterCustomCommission('雪莲征集·手写');
    expect(getCustomCommissions()).toEqual([]);
    replaceCustomCommissions([DEF]);
    expect(getCustomCommissions()).toEqual([DEF]);
  });

  it('mergeCommissions：同名自定义覆盖内置', () => {
    const base: CommissionDef[] = [
      { name: '雪莲征集·手写', requireCard: {}, rewards: {} },
      { name: '内置委托', requireCard: {}, rewards: {} },
    ];
    const merged = mergeCommissions(base, [DEF]);
    expect(merged.map((d) => d.name)).toEqual(['内置委托', '雪莲征集·手写']);
    expect(merged.find((d) => d.name === '雪莲征集·手写')?.grade).toBe('A');
  });

  it('coerceCustomCommissions 走 coerceCommissions 门禁（坏条目丢，坏字段逐格丢）', () => {
    const out = coerceCustomCommissions([
      DEF,
      { name: '空壳', rewards: {} },
      { name: '坏品级', requireMaterial: { name: 'x', count: 1 }, grade: 'Z' },
      '垃圾',
    ]);
    expect(out.map((d) => d.name)).toEqual(['雪莲征集·手写', '坏品级']);
    expect(out[0].rewards.card).toEqual({ name: '禁忌卡·雪葬', grantAt: 'delivery' });
    expect(out[1].grade).toBeUndefined();
  });
});

describe('自定义探索事件注册表', () => {
  it('注册 / 注销 / 整表替换 / 同名去重', () => {
    registerCustomEvent(EVENT);
    expect(getCustomEvents()).toEqual([EVENT]);
    registerCustomEvent({ ...EVENT, priority: 5 });
    expect(getCustomEvents()).toHaveLength(1);
    expect(getCustomEvents()[0].priority).toBe(5);
    unregisterCustomEvent('雪葬·终焉');
    expect(getCustomEvents()).toEqual([]);
    replaceCustomEvents([EVENT]);
    expect(getCustomEvents()).toEqual([EVENT]);
  });

  it('coerceCustomEvents 复用随机事件包门禁；只认 exploration 触发器', () => {
    const out = coerceCustomEvents([
      EVENT,
      { name: '每日事件', brief: 'x', trigger: { type: 'mtth', mtthDays: 3 } },
      { name: '坏简报', trigger: { type: 'exploration' } },
      '垃圾',
    ]);
    expect(out.map((d) => d.name)).toEqual(['雪葬·终焉']);
  });

  it('mergeEventDefs：同名自定义覆盖内置', () => {
    const base: RandomEventDef[] = [
      { name: '雪葬·终焉', brief: '内置', trigger: { type: 'exploration' } },
      { name: '内置事件', brief: 'x', trigger: { type: 'exploration' } },
    ];
    const merged = mergeEventDefs(base, [EVENT]);
    expect(merged.map((d) => d.name)).toEqual(['内置事件', '雪葬·终焉']);
    expect(merged.find((d) => d.name === '雪葬·终焉')?.once).toBe(true);
  });
});
