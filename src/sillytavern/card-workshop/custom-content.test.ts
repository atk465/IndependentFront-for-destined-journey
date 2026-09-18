import { describe, it, expect } from 'vitest';
import {
  coerceCustomTalents,
  coerceCustomCards,
  mergeTalents,
  mergeCards,
} from './custom-content';
import type { TalentTemplate } from './talent-entry';
import type { CardCatalogItem } from '../start-catalog-mechanics';

const 合法条目 = [
  { kind: '成功率加成', channel: 'universal', params: { bonus: 20 } },
];
const 自定义天赋 = {
  name: '测试天赋',
  source: 'universal',
  grade: 'A',
  description: '测试用',
  entries: 合法条目,
} as TalentTemplate;
const 内置天赋 = {
  name: '内置天赋',
  source: 'universal',
  grade: 'B',
  description: '内置',
  entries: [],
} as TalentTemplate;

describe('coerceCustomTalents', () => {
  it('正常数据通过', () => {
    expect(coerceCustomTalents([自定义天赋])).toHaveLength(1);
  });
  it('脏值丢弃', () => {
    expect(coerceCustomTalents([null, 1, {}, { name: '' }, { name: 'x', grade: 'A', entries: 'bad' }])).toHaveLength(0);
  });
  it('非法条目拒绝', () => {
    expect(coerceCustomTalents([{ ...自定义天赋, entries: [{ kind: '不存在', params: {} }] }])).toHaveLength(0);
  });
});

describe('mergeTalents', () => {
  it('自定义追加到内置尾部', () => {
    const merged = mergeTalents([内置天赋], [自定义天赋]);
    expect(merged).toHaveLength(2);
    expect(merged[merged.length - 1].name).toBe('测试天赋');
  });
  it('同名覆盖内置', () => {
    const 重名 = { ...内置天赋, name: '内置天赋', description: '覆盖版' } as TalentTemplate;
    const merged = mergeTalents([内置天赋], [重名]);
    expect(merged).toHaveLength(1);
    expect(merged[0].description).toBe('覆盖版');
  });
});

const 合法卡 = {
  id: 'custom-1',
  name: '测试卡',
  cardTier: '白银',
  formEntry: '装备',
  description: '测试',
  cost: 20,
} as CardCatalogItem;

describe('coerceCustomCards', () => {
  it('正常数据通过', () => {
    expect(coerceCustomCards([合法卡])).toHaveLength(1);
  });
  it('缺 id / 无效档位 → 丢弃', () => {
    expect(coerceCustomCards([{ ...合法卡, id: '' }])).toHaveLength(0);
    expect(coerceCustomCards([{ ...合法卡, cardTier: '不存在' }])).toHaveLength(0);
  });
});

describe('mergeCards', () => {
  it('自定义追加到内置尾部', () => {
    const 内置 = { ...合法卡, id: 'base-1', name: '内置卡' };
    const merged = mergeCards([内置], [合法卡]);
    expect(merged).toHaveLength(2);
  });
  it('同 id 覆盖', () => {
    const 同id = { ...合法卡, id: 'custom-1', name: '覆盖' };
    const merged = mergeCards([合法卡], [同id]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('覆盖');
  });
});
