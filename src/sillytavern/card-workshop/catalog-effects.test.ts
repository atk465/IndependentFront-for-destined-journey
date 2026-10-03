/**
 * catalog-effects.test.ts — 购卡效果贯通：catalog.effects → cardCatalogToItem 门禁透传
 */
import { describe, it, expect } from 'vitest';
import { cardCatalogToItem, parseCatalogData } from '../start-catalog-mechanics';

describe('parseCatalogData：effects 字段保留（注册链前提）', () => {
  it('cardPool 条目的 effects 原样透传（不剥离）', () => {
    const raw = {
      cardPool: [
        {
          id: 'e1',
          name: '带效果卡',
          cardTier: '星辉',
          formEntry: '技能',
          effects: [{ trigger: '每拍', target: '敌单体', action: '灼烧', value: 65, duration: 2 }],
        },
      ],
    };
    const data = parseCatalogData(raw);
    expect(data.cardPool[0].effects).toEqual([
      { trigger: '每拍', target: '敌单体', action: '灼烧', value: 65, duration: 2 },
    ]);
  });
});

describe('cardCatalogToItem —— 读入边界档位归一（CMP-03）', () => {
  it('D14 旧称「白铁」读入即映射黑铁（内存与库同口径，不再刷新漂移）', () => {
    const item = cardCatalogToItem({
      id: 'legacy-tier-1',
      name: '旧称测试卡',
      cardTier: '白铁' as never,
      formEntry: '装备',
      description: '',
      cost: 0,
    });
    expect(item.cardTier).toBe('黑铁');
    expect(item.recipe.tier).toBe('黑铁');
  });

  it('非法档位兜底黑铁；合法档位透传', () => {
    expect(
      cardCatalogToItem({
        id: 'x1',
        name: 'X',
        cardTier: '不存在的档' as never,
        formEntry: '技能',
        description: '',
        cost: 0,
      }).cardTier,
    ).toBe('黑铁');
    expect(
      cardCatalogToItem({
        id: 'x2',
        name: 'Y',
        cardTier: '星辉',
        formEntry: '技能',
        description: '',
        cost: 0,
      }).cardTier,
    ).toBe('星辉');
  });
});

describe('cardCatalogToItem：效果池登记贯通（效果批四）', () => {
  it('catalog.effects 门禁后随卡落库', () => {
    const item = cardCatalogToItem({
      id: 'x',
      name: '火雨术',
      cardTier: '青铜',
      formEntry: '技能',
      element: '火',
      description: '',
      cost: 10,
      effects: [{ trigger: '每拍', target: '敌单体', action: '灼烧', value: 65, duration: 2 }],
    });
    expect(item.cardEffects).toEqual([
      { trigger: '每拍', target: '敌单体', action: '灼烧', value: 65, duration: 2 },
    ]);
  });
  it('池外/改数条目整批丢弃（门禁）→ 无 cardEffects，出牌回落元素派生', () => {
    const item = cardCatalogToItem({
      id: 'y',
      name: '诈卡',
      cardTier: '白银',
      formEntry: '技能',
      description: '',
      cost: 10,
      effects: [{ trigger: '打出时', target: '敌单体', action: '飞天', value: 1 }],
    });
    expect(item.cardEffects).toBeUndefined();
  });
  it('无 effects 字段 → 不写 cardEffects（旧目录零迁移）', () => {
    const item = cardCatalogToItem({
      id: 'z',
      name: '老卡',
      cardTier: '黑铁',
      formEntry: '装备',
      element: '金',
      description: '',
      cost: 5,
    });
    expect('cardEffects' in item).toBe(false);
  });
});
