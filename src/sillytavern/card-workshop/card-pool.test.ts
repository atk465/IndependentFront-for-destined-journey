/**
 * card-pool.test.ts — 卡池唯一口径 + 自定义内容模板（2026-09-18）
 *
 * 钉住两件真机 bug：
 *  1. 开发者模式加的自定义卡必须进卡池（抽卡/购卡/按名查定义都走 getCardPool）
 *  2. 模板必须自洽 —— 照着模板填的内容能通过导入宽读，而不是填完被静默丢弃
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getCardPool, getPurchasableCardPool, findCardDefinition } from './card-pool';
import {
  registerCustomCard,
  unregisterCustomCard,
  replaceCustomCards,
  coerceCustomCards,
  coerceCustomTalents,
} from './custom-content';
import {
  TALENT_TEMPLATE,
  CARD_TEMPLATE,
  buildTemplateBundle,
  checkTemplates,
} from './content-templates';
import type { CardCatalogItem } from '../start-catalog-mechanics';

const TEMPLATE_CARD_ID = 'custom-example-001';

const 自定义卡: CardCatalogItem = {
  id: 'custom-pool-1',
  name: '池子测试卡',
  cardTier: '鎏金',
  formEntry: '装备',
  description: '测试',
  cost: 80,
};

afterEach(() => {
  replaceCustomCards([]);
});

describe('getCardPool', () => {
  it('注册的自定义卡进池', () => {
    registerCustomCard(自定义卡);
    expect(getCardPool().some((c) => c.id === 'custom-pool-1')).toBe(true);
  });

  it('注销后出池', () => {
    registerCustomCard(自定义卡);
    unregisterCustomCard('custom-pool-1');
    expect(getCardPool().some((c) => c.id === 'custom-pool-1')).toBe(false);
  });

  it('空注册表时等同于内容仓卡池（不抛）', () => {
    expect(Array.isArray(getCardPool())).toBe(true);
  });

  it('禁忌仿卡不进可购买池', () => {
    registerCustomCard(自定义卡);
    expect(getPurchasableCardPool().every((c) => !c.imitation)).toBe(true);
  });
});

describe('findCardDefinition', () => {
  it('按名查到自定义卡', () => {
    registerCustomCard(自定义卡);
    expect(findCardDefinition('池子测试卡')?.id).toBe('custom-pool-1');
  });

  it('同名不同 id 时只留最新那张（编辑器每次保存都新生成 id）', () => {
    registerCustomCard(自定义卡);
    registerCustomCard({ ...自定义卡, id: 'custom-pool-2', cost: 999 });
    const pool = getCardPool().filter((c) => c.name === '池子测试卡');
    expect(pool).toHaveLength(1);
    expect(findCardDefinition('池子测试卡')?.id).toBe('custom-pool-2');
  });

  it('查不到返回 undefined', () => {
    expect(findCardDefinition('根本不存在的卡')).toBeUndefined();
  });
});

describe('content-templates', () => {
  it('模板自检通过', () => {
    expect(checkTemplates()).toEqual({ ok: true });
  });

  it('卡牌模板能通过导入宽读（形状与导入契约一致）', () => {
    const coerced = coerceCustomCards([CARD_TEMPLATE]);
    expect(coerced).toHaveLength(1);
    expect(coerced[0].id).toBe(TEMPLATE_CARD_ID);
  });

  it('卡牌模板的产出定义不被宽读吃掉（物资卡靠它才能用）', () => {
    const [card] = coerceCustomCards([CARD_TEMPLATE]);
    expect(card.yield).toMatchObject({ quantity: 1, itemType: '消耗品' });
  });

  it('天赋模板能通过导入宽读', () => {
    expect(coerceCustomTalents([TALENT_TEMPLATE])).toHaveLength(1);
  });

  it('整包模板与导出文件同构（version + talents + cards）', () => {
    const bundle = buildTemplateBundle();
    expect(bundle.version).toBe(1);
    expect(coerceCustomTalents(bundle.talents)).toHaveLength(1);
    expect(coerceCustomCards(bundle.cards)).toHaveLength(1);
  });
});

/**
 * 🔴 docs/templates/*.json 是给作者照着改的**文件**，UI 的「模板」按钮下的是同一份内容。
 * 两份各写一遍必然漂移 —— 这里钉住：文件与 TS 常量必须逐字段相等。
 *
 * 读文件走 `import.meta.glob(?raw)` 而不是 node:fs —— 仓库 tsconfig 是 `types: []`、
 * 没装 @types/node，`src/**` 里 import 'fs' 测试能跑但 typecheck 会 TS2307
 * （先例：`map-literals-gate.test.ts`）。
 */
const TEMPLATE_FILES: Record<string, string> = import.meta.glob('../../../docs/templates/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/** 按文件名取模板文件（找不到直接抛 —— 文件被挪走/改名时不能静默退化成空集） */
function readTemplate(filename: string): unknown {
  const hit = Object.entries(TEMPLATE_FILES).find(([path]) => path.endsWith(`/${filename}`));
  if (!hit) throw new Error(`模板文件缺失：docs/templates/${filename}`);
  return JSON.parse(hit[1]);
}

describe('docs/templates 与 TS 常量一致', () => {
  it('三个模板文件都在', () => {
    expect(Object.keys(TEMPLATE_FILES)).toHaveLength(3);
  });

  it('talent-template.json', () => {
    expect(readTemplate('talent-template.json')).toEqual({
      version: 1,
      talents: [TALENT_TEMPLATE],
      cards: [],
    });
  });

  it('card-template.json', () => {
    expect(readTemplate('card-template.json')).toEqual({
      version: 1,
      talents: [],
      cards: [CARD_TEMPLATE],
    });
  });

  it('custom-content-template.json', () => {
    expect(readTemplate('custom-content-template.json')).toEqual(buildTemplateBundle());
  });

  it('仓库里的模板文件本身能通过导入宽读', () => {
    const bundle = readTemplate('custom-content-template.json') as {
      talents: unknown[];
      cards: unknown[];
    };
    expect(coerceCustomTalents(bundle.talents)).toHaveLength(1);
    expect(coerceCustomCards(bundle.cards)).toHaveLength(1);
  });
});
