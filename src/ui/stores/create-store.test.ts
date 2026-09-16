/**
 * create-store.ts — 捏人页 Store 纯逻辑测试
 *
 * 测试范围: Pinia store 所有 computed / action / watcher / 流水线
 * 不依赖 DOM, 在 Node 环境运行
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';
import type { CardItem } from '@engine/types';
import { setActivePinia, createPinia } from 'pinia';
import { useCreateStore } from './create-store';
import { useSettingsStore } from './settings-store';
import { patchAgentSettings } from './agent-settings';
import {
  DIFFICULTY_PRESETS,
  type CardCatalogItem,
  type CardFormEntry,
  type BackgroundTemplate,
  type CascaderOption,
} from '@engine/start-catalog';
import { getCreationCatalog } from '@engine/card-workshop/talent-entry';
import { setContentRegistry } from './content-store';
import { NEUTRAL_BRANDING } from '../branding-defaults';

// ═══════════════════════════════════════════════════════════
// 目录 fixture（D24）
//
// 🔴 捏人目录已抽出 TS，住在 `data/content/catalog.json`（内容侧，可被内容包整份替换）。
//    本文件因此**一条真实内容都不引用** —— 断言「某把真实武器叫什么」等于把内容
//    焊进测试，换个内容包就红一片，而那时红的不是 bug。
//    下面这份占位目录是通用奇幻，只为把机制跑通：
//    武器/防具各两件（覆盖「同类多选」）、一件贵到地狱档买不起的、四类背景各一条。
// ═══════════════════════════════════════════════════════════

const FIXTURE_ERA = '占位纪元';

function mkCard(id: string, formEntry: CardFormEntry, cost: number): CardCatalogItem {
  return {
    id,
    name: `占位${id}卡`,
    cardTier: '白铁',
    formEntry,
    element: '金',
    description: '',
    cost,
  };
}

const FIXTURE_CARD_POOL: CardCatalogItem[] = [
  mkCard('刃', '装备', 30),
  mkCard('甲', '装备', 20),
  mkCard('击', '技能', 40),
  mkCard('障', '领域', 25),
  mkCard('粮', '物资', 10),
  mkCard('神兵卡', '装备', 5000), // 地狱档（100 点）买不起 —— canSelectCard 闸门用
];

const FIXTURE_START_LOCATION = '占位大陆-占位王国-占位城';

const FIXTURE_BACKGROUNDS: BackgroundTemplate[] = [
  { id: 'bg_通用', name: '占位通用', description: '', fullText: '占位通用开局正文' },
  { id: 'bg_身份', name: '占位身份', description: '', fullText: '', requiredIdentity: '占位学徒' },
  { id: 'bg_种族', name: '占位种族', description: '', fullText: '', requiredRace: '占位羽族' },
  {
    id: 'bg_地区',
    name: '占位地区',
    description: '',
    fullText: '',
    requiredLocation: FIXTURE_START_LOCATION,
  },
];

const FIXTURE_START_LOCATIONS: CascaderOption[] = [
  {
    label: '占位大陆',
    value: 'placeholder-continent',
    children: [
      {
        label: '占位王国',
        value: 'placeholder-kingdom',
        children: [{ label: '占位城', value: FIXTURE_START_LOCATION }],
      },
    ],
  },
];

const FIXTURE_CATALOG = {
  version: 1,
  equipmentPool: [],
  itemPool: [],
  skillPool: [],
  cardPool: FIXTURE_CARD_POOL,
  backgrounds: FIXTURE_BACKGROUNDS,
  raceCosts: { 人类: 0, 占位羽族: 30, 自定义: 80 },
  identityCosts: { 非贵族平民: 0, 占位学徒: 10, 自定义: 80 },
  startLocations: FIXTURE_START_LOCATIONS,
};

/** 把 fixture 灌进内容注册表（store 构造时同步读它） */
function seedFixtureRegistry() {
  setContentRegistry({
    catalog: FIXTURE_CATALOG,
    locations: undefined,
    bloodlines: undefined,
    namePools: undefined,
    markers: undefined,
    branding: { era: FIXTURE_ERA },
    randomEvents: undefined,
    commissions: undefined,
    remoteAssets: undefined,
    mapPack: undefined,
  });
}

// AgentClient mock — 大纲生成链测试用（可控响应队列）
const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));
vi.mock('@engine/agent-client', () => ({
  AgentClient: class {
    chat(...args: any[]) {
      return chatMock(...args);
    }
    async chatStream(_req: any, callbacks: any, _signal?: any) {
      // 流式路径同样走 chatMock 队列；同步补一次 onChunk 模拟最小流式，再收尾
      const result = await chatMock(_req);
      if (result.error) {
        callbacks.onError(result.error);
        return;
      }
      // 允许测试自定义流式时序（如「先思维链、后正文」），未提供则走最小默认时序
      if (typeof result.__stream === 'function') {
        await result.__stream(callbacks);
        return;
      }
      const raw = result.rawResponse || '';
      if (raw) callbacks.onChunk?.(raw, false);
      callbacks.onComplete({
        fullText: raw,
        toolCalls: [],
        reasoning: result.reasoning || '',
        tokensUsed: result.tokensUsed || 0,
        cacheHit: false,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
        completionTokens: 0,
        duration: result.duration || 0,
      });
    }
  },
}));

// Mock localStorage for Node test environment (after vi.mock hoisting)
const store_ = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store_.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store_.set(k, v);
  },
  removeItem: (k: string) => {
    store_.delete(k);
  },
  clear: () => {
    store_.clear();
  },
  get length() {
    return store_.size;
  },
  key: (i: number) => [...store_.keys()][i] ?? null,
});

// Clear localStorage mock between ALL tests to prevent draft leakage
beforeEach(() => {
  store_.clear();
});

// ===== 辅助 =====

function makeStore() {
  setActivePinia(createPinia());
  // 🔴 必须在 `useCreateStore()` **之前**灌：store 构造时同步读一次注册表
  //    （常态下 boot 已灌好，这里模拟的就是那个状态）。
  seedFixtureRegistry();
  return useCreateStore();
}

/** 灌入指定（可坏）目录的 store 变体——空态/坏态测试用 */
function makeStoreWithCatalog(catalog: unknown) {
  setActivePinia(createPinia());
  setContentRegistry({
    catalog,
    locations: undefined,
    bloodlines: undefined,
    namePools: undefined,
    markers: undefined,
    branding: { era: FIXTURE_ERA },
    randomEvents: undefined,
    commissions: undefined,
    remoteAssets: undefined,
    mapPack: undefined,
  });
  return useCreateStore();
}

const TEST_ATTRIBUTES = ['力量', '敏捷', '体质', '智力', '精神'];

function allocateBasePoints(store: ReturnType<typeof useCreateStore>, count = 25) {
  for (let i = 0; i < count; i++) {
    store.addBasePoint(TEST_ATTRIBUTES[i % TEST_ATTRIBUTES.length]);
  }
}

// ===== 难度系统 =====

describe('难度系统', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it('初始不应选中任何难度', () => {
    expect(store.difficulty).toBeNull();
  });

  it('selectDifficulty 应正确设置 6 档难度点数', () => {
    for (const preset of DIFFICULTY_PRESETS) {
      store.selectDifficulty(preset.id);
      expect(store.difficulty?.id).toBe(preset.id);
      expect(store.reincarnationPoints).toBe(preset.points);
    }
  });

  it('创造模式应有 1000000 点', () => {
    store.selectDifficulty('creative');
    expect(store.reincarnationPoints).toBe(1000000);
  });

  it('地狱模式应有 100 点', () => {
    store.selectDifficulty('hell');
    expect(store.reincarnationPoints).toBe(100);
  });

  it('未匹配的 id 不应改变难度', () => {
    store.selectDifficulty('nonexistent');
    expect(store.difficulty).toBeNull();
    expect(store.reincarnationPoints).toBe(1000); // 默认值不变
  });
});

// ===== 内容加载门（D16/D24）=====

describe('内容加载门 —— 目录来自注册表而不是编译期常量', () => {
  /** 灌一份指定的注册表并新建 store（绕开 makeStore 的固定 fixture） */
  function storeWith(catalog: unknown, branding: unknown = { era: FIXTURE_ERA }) {
    setActivePinia(createPinia());
    setContentRegistry({
      catalog,
      locations: undefined,
      bloodlines: undefined,
      namePools: undefined,
      markers: undefined,
      branding,
      mapPack: undefined,
      randomEvents: undefined,
      commissions: undefined,
      remoteAssets: undefined,
    });
    return useCreateStore();
  }

  it('注册表有内容 → 构造即 ready，六个消费点全都读到它', () => {
    const store = storeWith(FIXTURE_CATALOG);
    expect(store.contentStatus).toBe('ready');
    expect(store.filteredBackgrounds.length).toBeGreaterThan(0);
    expect(store.identityOptions).toContain('占位学徒');
    expect(store.flatLocationOptions.map((o) => o.value)).toContain(FIXTURE_START_LOCATION);
    expect(store.START_LOCATIONS).toEqual(FIXTURE_START_LOCATIONS);
    store.race = '占位羽族';
    expect(store.raceCost).toBe(30);
  });

  it('🔴 换一份目录 → 消费点跟着变（证明它读的是注册表，不是某个常量）', () => {
    const store = storeWith({
      ...FIXTURE_CATALOG,
      raceCosts: { 占位羽族: 999 },
    });
    store.race = '占位羽族';
    expect(store.raceCost).toBe(999);
  });

  it('注册表那一面缺席 / 坏掉 → 加载后 contentStatus=empty，各列表为空且不抛', async () => {
    for (const bad of [undefined, null, 'broken', 42]) {
      const store = storeWith(bad);
      // 构造时是 idle（还没人尝试加载），走完加载门才敢下「没有内容」的结论 ——
      // 一进页面就画空态会把「还在加载」误报成「这台机器上没内容」。
      expect(store.contentStatus).toBe('idle');
      await store.initContent();
      expect(store.contentStatus).toBe('empty');
      expect(store.filteredBackgrounds).toEqual([]);
      expect(store.flatLocationOptions).toEqual([]);
      // 查不到的种族/身份落兜底 80，而不是 NaN/undefined
      expect(store.raceCost).toBe(80);
      expect(() => store.buildOpeningPrompt()).not.toThrow();
    }
  });

  it('initContent 幂等且永不抛（fetch 在 Node 环境必失败，失败面保持原值）', async () => {
    const store = storeWith(FIXTURE_CATALOG);
    await expect(store.initContent()).resolves.toBeUndefined();
    await expect(store.initContent()).resolves.toBeUndefined();
    expect(store.contentStatus).toBe('ready');
  });

  it('难度档位不随内容走（机制留引擎，目录为空也照样能选）', () => {
    const store = storeWith(undefined);
    store.selectDifficulty('hell');
    expect(store.reincarnationPoints).toBe(100);
  });
});

// ===== 等级 → 层级 =====

describe('等级 → 层级联动', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it('Lv.1 → T1 普通', () => {
    store.level = 1;
    expect(store.tier).toBe(1);
    expect(store.tierName).toBe('普通');
  });

  it('Lv.5 → T2 中坚', () => {
    store.level = 5;
    expect(store.tier).toBe(2);
    expect(store.tierName).toBe('中坚');
  });

  it('Lv.10 → T3 精英', () => {
    store.level = 10;
    expect(store.tier).toBe(3);
    expect(store.tierName).toBe('精英');
  });

  it('Lv.25 → T7 神祗', () => {
    store.level = 25;
    expect(store.tier).toBe(7);
    expect(store.tierName).toBe('神祗');
  });

  it('tierBonus = tier - 1', () => {
    store.level = 1;
    expect(store.tierBonus).toBe(0);
    store.level = 5;
    expect(store.tierBonus).toBe(1);
    store.level = 25;
    expect(store.tierBonus).toBe(6);
  });
});

// ===== BP 分配 =====

describe('基础属性 BP 分配', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it('初始所有 BP 应为 0', () => {
    expect(store.usedBP).toBe(0);
    expect(store.remainingBP).toBe(25);
  });

  it('addBasePoint 应增加指定属性', () => {
    store.addBasePoint('力量');
    expect(store.basePoints['力量']).toBe(1);
    expect(store.usedBP).toBe(1);
  });

  it('单属性上限 6', () => {
    for (let i = 0; i < 10; i++) store.addBasePoint('力量');
    expect(store.basePoints['力量']).toBe(6);
  });

  it('总 BP 上限 25', () => {
    // 5属性各加到6 = 30, 但总上限25
    for (const attr of ['力量', '敏捷', '体质', '智力', '精神']) {
      for (let i = 0; i < 6; i++) store.addBasePoint(attr);
    }
    expect(store.usedBP).toBeLessThanOrEqual(25);
  });

  it('removeBasePoint 应减少指定属性', () => {
    store.addBasePoint('力量');
    store.addBasePoint('力量');
    store.removeBasePoint('力量');
    expect(store.basePoints['力量']).toBe(1);
  });

  it('removeBasePoint 下限为 0', () => {
    store.removeBasePoint('力量');
    expect(store.basePoints['力量']).toBe(0);
  });

  it('remainingBP=0 时不能继续加', () => {
    store.level = 25; // 大 levelCost 不影响 BP
    for (let i = 0; i < 30; i++) store.addBasePoint('力量');
    expect(store.usedBP).toBeLessThanOrEqual(25);
  });
});

// ===== AP 分配 =====

describe('额外属性 AP 分配', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it('Lv.1 时 maxAP=0', () => {
    store.level = 1;
    expect(store.maxAP).toBe(0);
  });

  it('Lv.5 时 maxAP=4', () => {
    store.level = 5;
    expect(store.maxAP).toBe(4);
  });

  it('addAttributePoint 应增加 AP', () => {
    store.level = 10; // maxAP=9
    store.addAttributePoint('智力');
    expect(store.attributePoints['智力']).toBe(1);
    expect(store.usedAP).toBe(1);
  });

  it('remainingAP=0 时不能继续加', () => {
    store.level = 2; // maxAP=1
    store.addAttributePoint('力量');
    store.addAttributePoint('力量');
    store.addAttributePoint('敏捷');
    expect(store.usedAP).toBe(1);
  });

  it('removeAttributePoint 下限为 0', () => {
    store.removeAttributePoint('力量');
    expect(store.attributePoints['力量']).toBe(0);
  });

  it('maxAP=0 时 addAttributePoint 无效', () => {
    store.level = 1;
    store.addAttributePoint('力量');
    expect(store.usedAP).toBe(0);
  });
});

// ===== level watcher → 重置 AP =====

describe('level 变化 → AP 重置', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it('等级升高时 attributePoints 应归零', async () => {
    store.level = 10; // maxAP=9
    store.addAttributePoint('力量');
    store.addAttributePoint('敏捷');
    expect(store.usedAP).toBeGreaterThan(0);

    store.level = 15;
    await nextTick();
    expect(store.usedAP).toBe(0);
  });

  it('等级降低时 attributePoints 也应归零', async () => {
    store.level = 10;
    store.addAttributePoint('力量');
    store.level = 5;
    await nextTick();
    expect(store.usedAP).toBe(0);
  });
});

// ===== 最终属性 =====

describe('最终属性计算 finalAttributes', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it('finalAttr = BP + tierBonus + AP', () => {
    store.level = 1; // tierBonus=0
    store.addBasePoint('力量');
    store.addBasePoint('力量');
    store.addBasePoint('力量');
    // BP=3, tierBonus=0, AP=0 → 3
    expect(store.finalAttributes['力量']).toBe(3);
  });

  it('T2 层级加成正确', () => {
    store.level = 5; // T2, tierBonus=1
    store.addBasePoint('体质');
    store.addBasePoint('体质');
    // BP=2, tierBonus=1, AP=0 → 3
    expect(store.finalAttributes['体质']).toBe(3);
  });

  it('BP + AP + tierBonus 完整', () => {
    store.level = 10; // T3, tierBonus=2, maxAP=9
    store.addBasePoint('力量');
    store.addBasePoint('力量');
    store.addBasePoint('力量');
    store.addAttributePoint('力量');
    store.addAttributePoint('力量');
    // BP=3, tierBonus=2, AP=2 → 7
    expect(store.finalAttributes['力量']).toBe(7);
  });
});

// ===== HP/MP/SP 预览 =====

describe('HP/MP/SP 资源预览', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it('T1 Lv.1 体质=0 时公式兜底为5 → 最低 HP=525（世界书公式）', () => {
    store.level = 1;
    // 体质=0 (falsy), finalAttributes 用 || 0 兜底为 0；但默认属性全 5
    // 五维和 = 5+5+5+5+5 = 25；HP = 5×100×1 + 25 = 525
    expect(store.hpPreview).toBe(525);
  });

  it('HP = 体 × 100 × hpMul + 五维和（世界书公式）', () => {
    store.level = 1; // T1, hpMultiplier=1
    store.addBasePoint('体质');
    store.addBasePoint('体质');
    store.addBasePoint('体质');
    // 体质=3, 其他默认 5；五维和 = 3+5+5+5+5 = 23
    // HP = 3×100×1 + 23 = 323
    expect(store.hpPreview).toBe(323);
  });

  it('T3 HP 计算正确（世界书公式）', () => {
    store.level = 10; // T3, hpMultiplier=4, tierBonus=2
    store.addBasePoint('体质');
    store.addBasePoint('体质');
    store.addBasePoint('体质');
    store.addBasePoint('体质');
    store.addBasePoint('体质');
    // 体质=5, tierBonus=2 → 体质final=7；其他属性 = 0+tierBonus2=2
    // 五维和 = 7+2+2+2+2 = 15
    // HP = 7×100×4 + 15 = 2815
    expect(store.finalAttributes['体质']).toBe(7);
    expect(store.hpPreview).toBe(2815);
  });
});

// ===== 消耗公式 =====

describe('totalCost 消耗公式', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
    store.selectDifficulty('normal'); // 1000 点
    store.level = 1;
  });

  it('默认状态下 totalCost = 种族费 + 身份费', () => {
    // 人类=0, 非贵族平民=?
    // identityCost 从 目录的 identityCosts 查
    expect(store.totalCost).toBe(store.raceCost + store.identityCost);
  });

  it('levelCost = (level-1)*5', () => {
    store.level = 1;
    expect(store.levelCost).toBe(0);
    store.level = 5;
    expect(store.levelCost).toBe(20);
    store.level = 25;
    expect(store.levelCost).toBe(120);
  });

  it('usedAP 应计入 totalCost', () => {
    store.level = 5; // maxAP=4
    store.addAttributePoint('敏捷');
    store.addAttributePoint('敏捷');
    expect(store.usedAP).toBe(2);
    expect(store.totalCost).toBe(store.raceCost + store.identityCost + store.levelCost + 2);
  });

  it('moneyCost = ceil(money/100)', () => {
    store.money = 250;
    expect(store.moneyCost).toBe(3); // ceil(250/100)=3
  });

  it('destinyCost = ceil(destinyPoints/2)', () => {
    store.destinyPoints = 5;
    expect(store.destinyCost).toBe(3); // ceil(5/2)=3
  });

  it('remainingPoints = reincarnationPoints - totalCost', () => {
    store.level = 5; // levelCost=20
    expect(store.remainingPoints).toBe(1000 - store.totalCost);
  });
});

// ===== 开局购卡（2026-09-16 卡牌化）=====

describe('开局购卡', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
    store.selectDifficulty('creative'); // 1000000 点, 够用
  });

  it('toggleCard 选中/取消，分栏过滤生效', () => {
    store.activeCardCategory = '装备';
    const card = FIXTURE_CARD_POOL.find((c) => c.formEntry === '装备')!;
    store.toggleCard(card);
    expect(store.selectedCards).toHaveLength(1);
    expect(store.isCardSelected(card)).toBe(true);
    store.toggleCard(card);
    expect(store.selectedCards).toHaveLength(0);
    // 分栏过滤：领域卡不在装备栏里
    store.activeCardCategory = '领域';
    expect(store.filteredCards.every((c) => c.formEntry === '领域')).toBe(true);
  });

  it('cardCost 累加计价并进 totalCost', () => {
    const card = FIXTURE_CARD_POOL[0];
    const before = store.totalCost;
    store.toggleCard(card);
    expect(store.cardCost).toBe(card.cost);
    expect(store.totalCost).toBe(before + card.cost);
  });

  it('canSelectCard 点数不足时返回 false', () => {
    store.selectDifficulty('hell'); // 100 点
    const pricey = FIXTURE_CARD_POOL.find((c) => c.cost > 100);
    if (pricey) {
      expect(store.canSelectCard(pricey)).toBe(false);
    }
  });
});

// ===== 背景分类 =====

describe('背景四分类过滤', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it('通用分类应只含无限定背景', () => {
    store.activeBackgroundCategory = 'universal';
    expect(
      store.filteredBackgrounds.every(
        (bg) => !bg.requiredRace && !bg.requiredIdentity && !bg.requiredLocation,
      ),
    ).toBe(true);
  });

  it('身份限定分类应有 requiredIdentity', () => {
    store.activeBackgroundCategory = 'identity';
    expect(store.filteredBackgrounds.length).toBeGreaterThanOrEqual(0);
    expect(store.filteredBackgrounds.every((bg) => !!bg.requiredIdentity)).toBe(true);
  });

  it('种族限定分类应有 requiredRace', () => {
    store.activeBackgroundCategory = 'race';
    expect(store.filteredBackgrounds.every((bg) => !!bg.requiredRace)).toBe(true);
  });

  it('地区限定分类应有 requiredLocation', () => {
    store.activeBackgroundCategory = 'location';
    expect(store.filteredBackgrounds.every((bg) => !!bg.requiredLocation)).toBe(true);
  });
});

// ===== 步骤验证 =====

describe('stepValid 步骤验证', () => {
  let store: ReturnType<typeof useCreateStore>;

  beforeEach(() => {
    store = makeStore();
  });

  it('Step 0: 未选难度时无效', () => {
    expect(store.stepValid[0]).toBe(false);
    store.selectDifficulty('normal');
    expect(store.stepValid[0]).toBe(true);
  });

  it('Step 1: 角色名为空时无效', () => {
    store.selectDifficulty('normal');
    store.race = '人类';
    allocateBasePoints(store);
    expect(store.stepValid[1]).toBe(false);
    store.name = '艾琳';
    expect(store.stepValid[1]).toBe(true);
  });

  it('Step 1: 基础属性 0/25 与 24/25 时无效，25/25 时有效', () => {
    store.name = '艾琳';
    store.race = '人类';

    expect(store.usedBP).toBe(0);
    expect(store.stepValid[1]).toBe(false);

    allocateBasePoints(store, 24);
    expect(store.remainingBP).toBe(1);
    expect(store.stepValid[1]).toBe(false);

    allocateBasePoints(store, 1);
    expect(store.remainingBP).toBe(0);
    expect(store.stepValid[1]).toBe(true);
  });

  it('Step 1: 高于 1 级时必须分配全部额外属性点', () => {
    store.name = '艾琳';
    store.race = '人类';
    allocateBasePoints(store);
    store.level = 3;

    expect(store.remainingAP).toBe(2);
    expect(store.stepValid[1]).toBe(false);

    store.addAttributePoint('力量');
    expect(store.remainingAP).toBe(1);
    expect(store.stepValid[1]).toBe(false);

    store.addAttributePoint('敏捷');
    expect(store.remainingAP).toBe(0);
    expect(store.stepValid[1]).toBe(true);
  });

  it('Step 1: nextStep 在属性未分完时阻止前进，分完后放行', () => {
    store.currentStep = 1;
    store.name = '艾琳';
    store.race = '人类';
    allocateBasePoints(store, 24);

    store.nextStep();
    expect(store.currentStep).toBe(1);

    allocateBasePoints(store, 1);
    store.nextStep();
    expect(store.currentStep).toBe(2);
  });

  it('Step 7: 晚加载未分配属性的旧预设应退回 Step 1，并由最终建档边界拒绝', async () => {
    store.name = '艾琳';
    store.race = '人类';
    allocateBasePoints(store);
    store.currentStep = 7;

    const current = store.getCurrentPresetData();
    store.applyPresetData({
      id: 'legacy-unallocated',
      name: '旧版未分配预设',
      createdAt: 1,
      updatedAt: 1,
      ...current,
      character: {
        ...current.character,
        level: 1,
        basePoints: {},
        attributePoints: {},
      },
    });

    expect(store.attributesFullyAllocated).toBe(false);
    expect(store.stepValid[1]).toBe(false);
    expect(store.currentStep).toBe(1);
    await expect(store.startJourney()).rejects.toThrow('请先分配全部基础属性点和额外属性点');
  });

  it('Step 2 出身天赋必选（提前到基础信息之后，供剧情规划参照）；Steps 3-5 均可跳', () => {
    expect(store.stepValid[2]).toBe(false); // 出身天赋未选
    store.selectedCreationTalent = '封印亲和';
    expect(store.stepValid[2]).toBe(true);
    expect(store.stepValid[3]).toBe(true);
    expect(store.stepValid[4]).toBe(true);
    expect(store.stepValid[5]).toBe(true);
  });
});

// ===== substituteUser =====

describe('substituteUser 模板替换', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it('有角色名时 <user> 应替换为角色名', () => {
    store.name = '艾琳';
    expect(store.substituteUser('<user>走在路上')).toBe('艾琳走在路上');
  });

  it('角色名为空时 <user> 应替换为中性第三人称占位名', () => {
    store.name = '';
    expect(store.substituteUser('<user>醒了')).toBe('未命名者醒了');
  });

  it('多个 <user> 应全部替换', () => {
    store.name = '艾琳';
    expect(store.substituteUser('<user>看了看<user>的手')).toBe('艾琳看了看艾琳的手');
  });

  it('无 <user> 的文本应原样返回', () => {
    expect(store.substituteUser('天空很蓝')).toBe('天空很蓝');
  });
});

// ===== buildCharacterState =====

describe('buildCharacterState', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
    store.name = '测试';
    store.race = '人类';
    store.identity = '冒险者';
    store.level = 5;
  });

  it('应生成合法的 CharacterState', () => {
    const state = store.buildCharacterState('test-save-id');
    expect(state.name).toBe('测试');
    expect(state.race).toBe('人类');
    expect(state.level).toBe(5);
    expect(state.type).toBe('player');
    expect(state.id).toBeTruthy();
  });

  it('自定义种族应写入 customRace', () => {
    store.race = '自定义';
    store.customRace = '精灵混血';
    const state = store.buildCharacterState('test-save-id');
    expect(state.race).toBe('精灵混血');
  });

  it('开局卡组直落：保底卡+选购卡构造 CardItem 进 inventory，cardAlbum 同步收录', () => {
    store.selectDifficulty('creative');
    store.toggleCard(FIXTURE_CARD_POOL[0]);
    const state = store.buildCharacterState('test-save-id');
    const cards = state.inventory.filter((i): i is CardItem => i.type === '卡牌');
    // 保底 2 张（行旅短刃/凝神一击）+ 购入 1 张
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => c.cardTier && Array.isArray((c as any).词条))).toBe(true);
    expect(state.cardAlbum?.owned).toHaveLength(3);
    expect(state.cardAlbum?.deck).toEqual(state.cardAlbum?.owned);
  });

  it('卡牌化(2026-09-16): 卡实物确定性落库 + 卡面叙事进开场白（不再发 item_gen 清单）', () => {
    store.selectDifficulty('creative');
    const card = FIXTURE_CARD_POOL.find((c) => c.formEntry === '技能')!;
    store.toggleCard(card);

    const state = store.buildCharacterState('test-save-id');
    const played = state.inventory.filter((i) => i.type === '卡牌');
    expect(played.some((c) => c.name === card.name)).toBe(true);

    const prompt = store.buildOpeningPrompt();
    expect(prompt).toContain('卡匣里贴身放着这些铭卡');
    expect(prompt).toContain(`「${card.name}」`);
    expect(prompt).toContain('本命卡组');
  });

  it('HP/MP/SP 应正确写入', () => {
    const state = store.buildCharacterState('test-save-id');
    expect(state.hp).toBe(store.hpPreview);
    expect(state.maxHp).toBe(store.hpPreview);
  });
});

// ===== buildOpeningPrompt =====

describe('buildOpeningPrompt', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
    store.name = '测试';
    store.selectDifficulty('creative');
  });

  it('空选择时返回自然叙述式开场，不含数据表分节', () => {
    const prompt = store.buildOpeningPrompt();
    expect(prompt).toContain('测试的故事由此开始。');
    expect(prompt).not.toContain('创角完成');
    expect(prompt).not.toContain('初始数据');
    expect(prompt).not.toContain('---');
    // 没有购卡 → 只断言不出卡段引导句（保底卡不算「购入」叙述，见下）
    expect(prompt).not.toContain('带着这些装备');
    expect(prompt).not.toContain('已经掌握这些本领');
    expect(prompt).not.toContain('行囊里还有这些东西');
    // 初始金钱段总是存在（0 G 时写「身无分文」，>0 时写具体数）——开局经济是既成事实
    expect(prompt).toContain('身无分文');
    // 开局时间总是存在（纪元基准 488 年）；纪元名由内容侧 branding 面供给（D9）
    expect(prompt).toContain(`${FIXTURE_ERA}0488年`);
    expect(prompt).toContain('首轮叙事请以「开局剧情」');
    expect(prompt).not.toContain('不要解释规则');
  });

  it('用户示例路径以故事语言交接剧情与人物特征', () => {
    store.name = '阿黑';
    store.backstory =
      '帝国女皇命令圣女施展古魔法阵召唤异世勇者。四位勇者现身后，唯独阿黑身边没有任何异象。';
    store.personality = '天真';
    store.physics = '瘦高';

    const prompt = store.buildOpeningPrompt();

    expect(prompt).toContain(`${FIXTURE_ERA}0488年01月01日，周日08:00，阿黑的故事由此开始。`);
    expect(prompt).toContain('帝国女皇命令圣女施展古魔法阵召唤异世勇者');
    expect(prompt).toContain('阿黑身无分文，衣袋里连一枚帝冕币也没有。');
    expect(prompt).toContain('阿黑生性天真。');
    expect(prompt).toContain('阿黑的身形与外貌给人的印象是：瘦高。');
    expect(prompt).toContain('再自然续写后续发展');
    expect(prompt).not.toContain('---');
    expect(prompt).not.toContain('初始数据');
    expect(prompt).not.toMatch(/(^|\n)你(?:身|生|随|带|有|的)/);
  });

  it('纪元名整条取自内容侧：内容缺席时落中性默认名，绝不出现 IP 纪元名', () => {
    setContentRegistry({
      catalog: FIXTURE_CATALOG,
      locations: undefined,
      bloodlines: undefined,
      namePools: undefined,
      markers: undefined,
      branding: undefined,
      mapPack: undefined,
      randomEvents: undefined,
      commissions: undefined,
      remoteAssets: undefined,
    });
    setActivePinia(createPinia());
    const bare = useCreateStore();
    bare.name = '测试';
    const prompt = bare.buildOpeningPrompt();
    // 解析与兜底都归 branding-defaults（品牌面唯一解析处），这里只断言「跟着它走」
    expect(prompt).toContain(`${NEUTRAL_BRANDING.era}0488年`);
    expect(prompt).not.toContain(FIXTURE_ERA);
  });

  it('购卡后卡面叙事进开场白', () => {
    const card = FIXTURE_CARD_POOL[0];
    store.toggleCard(card);
    const prompt = store.buildOpeningPrompt();
    expect(prompt).toContain('卡匣里贴身放着这些铭卡');
    expect(prompt).toContain(card.name);
  });

  it('🆕 初始金钱段：money>0 时写明具体数额（开局经济既成事实）', () => {
    store.money = 10012;
    const prompt = store.buildOpeningPrompt();
    expect(prompt).toContain('10012 枚帝冕币');
    expect(prompt).not.toContain('身无分文');
  });
});

// ===== 预设系统 =====

describe('预设系统', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
    store.name = '预设测试';
    store.selectDifficulty('normal');
    store.level = 5;
  });

  it('getCurrentPresetData → applyPresetData 往返一致', () => {
    const data = store.getCurrentPresetData();
    expect(data.character.name).toBe('预设测试');

    // 创建新 store 并应用
    const store2 = makeStore();
    store2.applyPresetData({
      id: 'test',
      name: 'test-preset',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...data,
    });
    expect(store2.name).toBe('预设测试');
    expect(store2.level).toBe(5);
    expect(store2.difficulty?.id).toBe('normal');
  });

  it('保存/加载预设往返剧情大纲本体（plotOutline + plotOutlineChapters）', () => {
    store.plotOutline = {
      id: 'o1',
      saveId: '',
      mode: 'main',
      title: '血色纹章',
      summary: '一句话摘要',
      content: '大纲正文',
      chapters: [{ title: '第一章', summary: '开端', status: 'pending' }],
      confirmed: false,
      version: 1,
      timeRange: { start: '488-01', end: '488-03' },
      createdAt: 1,
      updatedAt: 1,
    } as any;
    store.plotOutlineChapters = [
      { title: '第一章', summary: '开端', keyEvents: [{ title: '事件一', description: '描述一' }] },
    ] as any;

    const data = store.getCurrentPresetData();
    expect(data.plotOutline?.title).toBe('血色纹章');
    expect(data.plotOutlineChapters).toHaveLength(1);

    const store2 = makeStore();
    store2.applyPresetData({
      id: 'test',
      name: 'test-preset',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...data,
    });
    expect(store2.plotOutline?.title).toBe('血色纹章');
    expect(store2.plotOutlineChapters[0].keyEvents).toHaveLength(1);
  });

  it('旧预设（无大纲字段）不清空当前大纲（A 口径）', () => {
    const data = store.getCurrentPresetData();
    // 模拟旧预设：两个新增字段都不存在
    delete (data as any).plotOutline;
    delete (data as any).plotOutlineChapters;

    const store2 = makeStore();
    const existing = { title: '已有大纲' } as any;
    store2.plotOutline = existing;
    store2.plotOutlineChapters = [{ title: '已有章', summary: '', keyEvents: [] }] as any;

    store2.applyPresetData({
      id: 'test',
      name: 'old-preset',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...data,
    });
    expect(store2.plotOutline?.title).toBe('已有大纲');
    expect(store2.plotOutlineChapters).toHaveLength(1);
  });
});

// ===== 开局购卡边界（卡牌化后自定义卡表单退役：局内制卡才是正道） =====

describe('开局购卡边界', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it('toggleCard 未选中且点数不足 → 不入选（幂等，不抛）', () => {
    store.selectDifficulty('hell'); // 100 点
    const pricey = FIXTURE_CARD_POOL.find((c) => c.cost > 100)!;
    const before = store.selectedCards.length;
    store.toggleCard(pricey);
    expect(store.selectedCards.length).toBe(before);
    store.toggleCard(pricey); // 再点一次也不变
    expect(store.selectedCards.length).toBe(before);
  });

  it('cardPool 空目录（内容缺席）→ filteredCards 为空且不抛', () => {
    const bad = makeStoreWithCatalog(undefined);
    expect(bad.filteredCards).toEqual([]);
    expect(() => bad.buildOpeningPrompt()).not.toThrow();
  });
});

// ===== resetAll =====

describe('resetAll', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it('resetAll 应恢复所有状态到默认', () => {
    store.name = '测试';
    store.level = 10;
    store.selectDifficulty('easy');
    store.addBasePoint('力量');
    store.addBasePoint('力量');
    store.addBasePoint('力量');
    store.destinyPoints = 100;
    store.money = 5000;

    store.resetAll();

    expect(store.name).toBe('');
    expect(store.level).toBe(1);
    expect(store.difficulty).toBeNull();
    expect(store.usedBP).toBe(0);
    expect(store.destinyPoints).toBe(0);
    expect(store.money).toBe(0);
    expect(store.currentStep).toBe(0);
    expect(store.selectedCards).toHaveLength(0);
  });

  it('resetAll 应重置剧情设置为默认（重读设置页新档默认值）', () => {
    store.plotMode = 'main';
    store.plotGenrePreference = ['combat', 'romance'] as any;
    store.resetAll();
    expect(store.plotMode).toBe('off');
    // 设置页新档默认值 plotGenrePreference = ['combat', 'social']
    expect(store.plotGenrePreference).toEqual(['combat', 'social']);
  });
});

// ===== 出身天赋抽卡池 + 分级定价（2026-09-16）=====

describe('出身天赋抽卡池', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it('rollTalentOffers 恒抽 8 份且全部来自捏人池；重抽清掉不在新一批的已选', () => {
    const poolNames = getCreationCatalog().map((t) => t.name);
    expect(poolNames.length).toBeGreaterThanOrEqual(8);
    store.rollTalentOffers();
    expect(store.talentOffers).toHaveLength(8);
    expect(new Set(store.talentOffers.map((t) => t.name)).size).toBe(8);
    expect(store.talentOffers.every((t) => poolNames.includes(t.name))).toBe(true);
    // 选中后重抽到不含它的批次 → 选择被清空
    store.selectedCreationTalent = store.talentOffers[0].name;
    for (let i = 0; i < 40 && store.selectedCreationTalent; i++) store.rollTalentOffers();
    expect(store.selectedCreationTalent).toBeNull();
  });

  it('talentCost 按品级公式计价（天才卡师 C 级单条：(10×1.2)→5 取整 = 10 点），未选为 0', () => {
    expect(store.talentCost).toBe(0);
    store.selectedCreationTalent = '天才卡师';
    expect(store.talentCost).toBe(10);
  });
});

// ===== 步骤导航 =====

describe('步骤导航', () => {
  let store: ReturnType<typeof useCreateStore>;
  beforeEach(() => {
    store = makeStore();
    store.selectDifficulty('normal');
    store.name = '测试';
    store.race = '人类';
  });

  it('nextStep 应前进', () => {
    expect(store.currentStep).toBe(0);
    store.nextStep();
    expect(store.currentStep).toBe(1);
  });

  it('prevStep 应后退', () => {
    store.currentStep = 3;
    store.prevStep();
    expect(store.currentStep).toBe(2);
  });

  it('currentStep=0 时 prevStep 不应后退', () => {
    store.prevStep();
    expect(store.currentStep).toBe(0);
  });

  it('步骤验证不通过时 nextStep 不应前进', () => {
    store.currentStep = 0;
    store.difficulty = null; // 难度未选
    expect(store.stepValid[0]).toBe(false);
    const before = store.currentStep;
    store.nextStep();
    expect(store.currentStep).toBe(before);
  });
});

// ===== 剧情默认值从设置页读入 =====

describe('剧情默认值从设置页读入', () => {
  it('initPlotDefaultsFromSettings 应读入 settings-store 新档默认值', () => {
    setActivePinia(createPinia());
    const settings = useSettingsStore();
    settings.settings.plotMode = 'main';
    settings.settings.plotDurationYears = 12;
    settings.settings.plotDifficultyTier = 3;
    settings.settings.plotAllowNonWorldbookNpc = false;
    settings.settings.plotGenrePreference = ['mystery', 'politics'];
    settings.settings.plotCustomPreference = '多一些权谋';
    settings.settings.plotFocusRegion = '奥古斯提姆帝国';
    settings.settings.plotTabooContent = '不要虐待动物';
    settings.settings.plotChapterCount = 3;
    settings.settings.plotEventsPerChapter = 5;

    const store = useCreateStore();
    expect(store.plotMode).toBe('main');
    expect(store.plotDurationYears).toBe(12);
    expect(store.plotDifficultyTier).toBe(3);
    expect(store.plotAllowNonWorldbookNpc).toBe(false);
    expect(store.plotGenrePreference).toEqual(['mystery', 'politics']);
    expect(store.plotCustomPreference).toBe('多一些权谋');
    expect(store.plotFocusRegion).toBe('奥古斯提姆帝国');
    expect(store.plotTabooContent).toBe('不要虐待动物');
    expect(store.plotChapterCount).toBe(3);
    expect(store.plotEventsPerChapter).toBe(5);
  });

  it('adaptive 难度默认值应保持 adaptive', () => {
    setActivePinia(createPinia());
    const settings = useSettingsStore();
    settings.settings.plotDifficultyTier = 'adaptive';
    const store = useCreateStore();
    expect(store.plotDifficultyTier).toBe('adaptive');
  });
});

// ===== 大纲生成链（AgentClient mock） =====

function outlineJson(score = 8, title = '血色纹章') {
  return JSON.stringify({
    title,
    summary: '一句话摘要',
    content: '# 完整叙事大纲',
    chapters: [
      {
        title: '第一章 序幕',
        summary: '章节摘要',
        keyEvents: [
          { title: '初入王都', description: '主角抵达艾瑟嘉德', triggerHint: '进入王都' },
          { title: '命运初显', description: '命定核心苏醒', triggerHint: '首次战斗' },
        ],
      },
    ],
    selfCritique: { score, strengths: [], weaknesses: ['节奏偏慢'], suggestions: ['加快开篇'] },
  });
}

function okResult(raw: string, reasoning = '') {
  return {
    agentId: 'plot_outline',
    output: raw,
    rawResponse: raw,
    reasoning,
    tokensUsed: 100,
    cacheHit: false,
    duration: 10,
  };
}

function setupPlotStore() {
  setActivePinia(createPinia());
  const settings = useSettingsStore();
  settings.settings.apiPool = [
    {
      id: 'ep1',
      name: 'test',
      baseUrl: 'http://localhost',
      apiKey: 'k',
      maskedKey: '***',
      model: 'test-model',
      models: ['test-model'],
      apiType: 'chat',
    },
  ];
  patchAgentSettings(settings.settings, 'plot_outline', {
    model: 'ep1',
    systemPrompt: '你是剧情大纲生成 Agent',
  });
  const store = useCreateStore();
  store.plotMode = 'main';
  store.name = '艾琳';
  allocateBasePoints(store);
  return store;
}

describe('generatePlotOutline 大纲生成', () => {
  beforeEach(async () => {
    const { getDatabase } = await import('@engine/database');
    await getDatabase().apiEndpoints.clear();
    chatMock.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })) as any);
  });

  it('score >= 6 时一次调用即产出大纲', async () => {
    chatMock.mockResolvedValueOnce(okResult(outlineJson(8)));
    const store = setupPlotStore();
    const ok = await store.generatePlotOutline();
    expect(ok).toBe(true);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(store.plotOutline?.title).toBe('血色纹章');
    expect(store.plotOutline?.summary).toBe('一句话摘要');
    expect(store.plotOutline?.chapters).toHaveLength(1);
    expect(store.plotOutlineChapters[0].keyEvents).toHaveLength(2);
    expect(store.isPlotGenerating).toBe(false);
    expect(store.plotGenerationError).toBeNull();
  });

  it('score < 6 时应带 weaknesses/suggestions 自动重试一次（总共 2 次调用）', async () => {
    chatMock
      .mockResolvedValueOnce(okResult(outlineJson(4, '初版大纲')))
      .mockResolvedValueOnce(okResult(outlineJson(8, '改良大纲')));
    const store = setupPlotStore();
    const ok = await store.generatePlotOutline();
    expect(ok).toBe(true);
    expect(chatMock).toHaveBeenCalledTimes(2);
    // 第二次调用的 user 消息应包含上一版与改进点
    const secondCall = chatMock.mock.calls[1][0];
    const userMsg = secondCall.messages[secondCall.messages.length - 1].content as string;
    expect(userMsg).toContain('节奏偏慢');
    expect(userMsg).toContain('加快开篇');
    expect(store.plotOutline?.title).toBe('改良大纲');
  });

  it('两次均低分时用最后一版（不再第三次调用）', async () => {
    chatMock
      .mockResolvedValueOnce(okResult(outlineJson(3, '初版')))
      .mockResolvedValueOnce(okResult(outlineJson(5, '第二版')));
    const store = setupPlotStore();
    const ok = await store.generatePlotOutline();
    expect(ok).toBe(true);
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(store.plotOutline?.title).toBe('第二版');
  });

  it('AI 报错时应设置错误状态且不 crash', async () => {
    chatMock.mockResolvedValueOnce({
      agentId: 'plot_outline',
      output: null,
      rawResponse: '',
      tokensUsed: 0,
      cacheHit: false,
      duration: 0,
      error: 'HTTP 500',
    });
    const store = setupPlotStore();
    const ok = await store.generatePlotOutline();
    expect(ok).toBe(false);
    expect(store.plotOutline).toBeNull();
    expect(store.plotGenerationError).toContain('HTTP 500');
    expect(store.isPlotGenerating).toBe(false);
  });

  it('用户取消（Request aborted）→ 提示已取消而非报错', async () => {
    chatMock.mockResolvedValueOnce({ error: 'Request aborted', rawResponse: '' });
    const store = setupPlotStore();
    const ok = await store.generatePlotOutline();
    expect(ok).toBe(false);
    expect(store.plotGenerationError).toContain('已取消');
    expect(store.plotGenerationError).not.toContain('Request aborted');
    expect(store.isPlotGenerating).toBe(false);
    expect(store.plotStreamStats).toBeNull();
  });

  it('成功后流式统计清空（plotStreamStats 回 null）', async () => {
    chatMock.mockResolvedValueOnce(okResult(outlineJson(8)));
    const store = setupPlotStore();
    const ok = await store.generatePlotOutline();
    expect(ok).toBe(true);
    expect(store.plotStreamStats).toBeNull();
  });

  it('推理模型：仅思维链先到达也应进入 thinking 态并累计字数，正文到达后转 streaming', async () => {
    const store = setupPlotStore();
    const snapshots: Array<{ phase: string; chars: number; reasoningChars: number }> = [];
    const reasoning = '思'.repeat(600);
    const raw = outlineJson(8);
    chatMock.mockResolvedValueOnce({
      __stream: async (cb: any) => {
        cb.onReasoning?.(reasoning);
        const st = store.plotStreamStats!;
        snapshots.push({ phase: st.phase, chars: st.chars, reasoningChars: st.reasoningChars });
        cb.onChunk?.(raw, false);
        const st2 = store.plotStreamStats!;
        snapshots.push({ phase: st2.phase, chars: st2.chars, reasoningChars: st2.reasoningChars });
        cb.onComplete({
          fullText: raw,
          toolCalls: [],
          reasoning,
          tokensUsed: 0,
          cacheHit: false,
          cacheHitTokens: 0,
          cacheMissTokens: 0,
          completionTokens: 0,
          duration: 0,
        });
      },
    });
    const ok = await store.generatePlotOutline();
    expect(ok).toBe(true);
    expect(snapshots[0]).toEqual({ phase: 'thinking', chars: 0, reasoningChars: 600 });
    expect(snapshots[1].phase).toBe('streaming');
    expect(snapshots[1].chars).toBe(raw.length);
    expect(snapshots[1].reasoningChars).toBe(600);
  });

  it('预计总字数含上一轮思维链（与实时统计同口径，不再只算正文）', async () => {
    const store = setupPlotStore();
    const raw = outlineJson(8);
    const reasoning = '思'.repeat(700);
    chatMock.mockResolvedValueOnce(okResult(raw, reasoning));
    expect(await store.generatePlotOutline()).toBe(true);

    let estimatedTotalAtStart = 0;
    chatMock.mockResolvedValueOnce({
      __stream: async (cb: any) => {
        estimatedTotalAtStart = store.plotStreamStats!.estimatedTotal;
        cb.onComplete({
          fullText: raw,
          toolCalls: [],
          reasoning: '',
          tokensUsed: 0,
          cacheHit: false,
          cacheHitTokens: 0,
          cacheMissTokens: 0,
          completionTokens: 0,
          duration: 0,
        });
      },
    });
    expect(await store.generatePlotOutline()).toBe(true);
    expect(estimatedTotalAtStart).toBe(raw.length + reasoning.length);
  });

  it('输出解析失败时应设置错误状态', async () => {
    chatMock.mockResolvedValueOnce(okResult('这不是 JSON'));
    const store = setupPlotStore();
    const ok = await store.generatePlotOutline();
    expect(ok).toBe(false);
    expect(store.plotGenerationError).toContain('解析失败');
  });

  it('🆕 finish_reason=length 截断 → 报截断错误而非笼统解析失败', async () => {
    // 半截 XML（无 </outline> 闭合）+ 模型报截断
    chatMock.mockResolvedValueOnce({
      agentId: 'plot_outline',
      output: null,
      rawResponse: '<outline><title>半截大纲<title>...',
      tokensUsed: 300,
      completionTokens: 16384,
      cacheHit: false,
      duration: 0,
      finishReason: 'length',
    });
    const store = setupPlotStore();
    const ok = await store.generatePlotOutline();
    expect(ok).toBe(false);
    expect(store.plotGenerationError).toContain('截断');
    // 失败轮也要留档（导出 AI 调试数据按钮可用）
    expect(store.lastPlotGenerationMeta?.rawResponse).toContain('半截大纲');
  });

  it('🆕 无闭合标签但 finish_reason 非 length → 也判截断（输出未完整）', async () => {
    chatMock.mockResolvedValueOnce({
      agentId: 'plot_outline',
      output: null,
      rawResponse: '<outline><title>只有开头',
      tokensUsed: 100,
      cacheHit: false,
      duration: 0,
      finishReason: 'stop',
    });
    const store = setupPlotStore();
    const ok = await store.generatePlotOutline();
    expect(ok).toBe(false);
    expect(store.plotGenerationError).toContain('截断');
  });

  it('未配置 API 端点时应报错不调用', async () => {
    setActivePinia(createPinia());
    const store = useCreateStore();
    store.plotMode = 'main';
    const ok = await store.generatePlotOutline();
    expect(ok).toBe(false);
    expect(chatMock).not.toHaveBeenCalled();
    expect(store.plotGenerationError).toContain('未配置');
  });

  it('雷点应注入 system prompt（通过模板 PLOT_EVENTS 占位符）', async () => {
    chatMock.mockResolvedValueOnce(okResult(outlineJson(8)));
    const store = setupPlotStore();
    store.plotTabooContent = '禁止出现背叛剧情';
    await store.generatePlotOutline();
    const call = chatMock.mock.calls[0][0];
    // 模板系统将系统提示词 + 解析后的占位符放入 messages[0]（system role）
    const sysMsg = call.messages[0].content as string;
    expect(sysMsg).toContain('禁止出现背叛剧情');
    expect(sysMsg).toContain('雷点');
  });
});

describe('reviseOutline 重 roll 与 outlineHistory', () => {
  beforeEach(() => {
    chatMock.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })) as any);
  });

  it('无大纲时 reviseOutline 应拒绝', async () => {
    const store = setupPlotStore();
    const ok = await store.reviseOutline('改一下');
    expect(ok).toBe(false);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('reviseOutline 应带上一版 JSON + 修改要求，成功后旧版入栈', async () => {
    chatMock
      .mockResolvedValueOnce(okResult(outlineJson(8, '初版')))
      .mockResolvedValueOnce(okResult(outlineJson(8, '修改版')));
    const store = setupPlotStore();
    await store.generatePlotOutline();
    const ok = await store.reviseOutline('结局不要大团圆');
    expect(ok).toBe(true);
    const call = chatMock.mock.calls[1][0];
    const userMsg = call.messages[call.messages.length - 1].content as string;
    expect(userMsg).toContain('初版');
    expect(userMsg).toContain('结局不要大团圆');
    expect(userMsg).toContain('上一版大纲');
    expect(store.plotOutline?.title).toBe('修改版');
    expect(store.outlineHistory).toHaveLength(1);
    expect(store.outlineHistory[0].title).toBe('初版');
  });

  it('rollbackOutline 应恢复最近一版', async () => {
    chatMock
      .mockResolvedValueOnce(okResult(outlineJson(8, '初版')))
      .mockResolvedValueOnce(okResult(outlineJson(8, '修改版')));
    const store = setupPlotStore();
    await store.generatePlotOutline();
    await store.reviseOutline('改');
    const ok = store.rollbackOutline();
    expect(ok).toBe(true);
    expect(store.plotOutline?.title).toBe('初版');
    expect(store.outlineHistory).toHaveLength(0);
  });

  it('空历史时 rollbackOutline 返回 false', () => {
    const store = setupPlotStore();
    expect(store.rollbackOutline()).toBe(false);
  });

  it('普通重新生成也应把旧版推入历史', async () => {
    chatMock
      .mockResolvedValueOnce(okResult(outlineJson(8, 'v1')))
      .mockResolvedValueOnce(okResult(outlineJson(8, 'v2')));
    const store = setupPlotStore();
    await store.generatePlotOutline();
    await store.generatePlotOutline();
    expect(store.plotOutline?.title).toBe('v2');
    expect(store.outlineHistory).toHaveLength(1);
    expect(store.outlineHistory[0].title).toBe('v1');
  });

  it('历史最多保留 5 版（超出丢最旧）', async () => {
    for (let i = 1; i <= 7; i++) {
      chatMock.mockResolvedValueOnce(okResult(outlineJson(8, `v${i}`)));
    }
    const store = setupPlotStore();
    for (let i = 1; i <= 7; i++) {
      await store.generatePlotOutline();
    }
    expect(store.plotOutline?.title).toBe('v7');
    expect(store.outlineHistory).toHaveLength(5);
    expect(store.outlineHistory[0].title).toBe('v2');
    expect(store.outlineHistory[4].title).toBe('v6');
  });
});

// ===== startJourney 落库（plotSettings metadata + 大纲 + 事件树） =====

describe('startJourney 剧情落库', () => {
  it('concurrent submissions create one complete journey', async () => {
    const store = setupPlotStore();
    const [first, second] = await Promise.all([store.startJourney(), store.startJourney()]);
    const { getSaves, getCharacters } = await import('@engine/database');
    expect(first).toBe(second);
    expect(await getSaves()).toHaveLength(1);
    expect(await getCharacters(first)).toHaveLength(1);
  });

  it('a profile write failure rolls back the whole journey and permits retry', async () => {
    const store = setupPlotStore();
    const { getDatabase, getSaves } = await import('@engine/database');
    const db = getDatabase();
    const failure = vi
      .spyOn(db.saveProfiles, 'put')
      .mockRejectedValueOnce(new Error('disk failure'));
    try {
      await expect(store.startJourney()).rejects.toThrow('disk failure');
      expect(await getSaves()).toHaveLength(0);
      expect(await db.characters.count()).toBe(0);
      await expect(store.startJourney()).resolves.toEqual(expect.any(String));
      expect(await getSaves()).toHaveLength(1);
    } finally {
      failure.mockRestore();
    }
  });

  beforeEach(async () => {
    chatMock.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })) as any);
    const { clearAllData, initializeDatabase } = await import('@engine/database');
    try {
      await clearAllData();
    } catch {
      /* db may not exist */
    }
    await initializeDatabase();
  });

  it('plotSettings（含雷点）应写入 SaveSlot.metadata', async () => {
    const store = setupPlotStore();
    store.plotTabooContent = '禁止团灭';
    const saveId = await store.startJourney();
    const { getSave } = await import('@engine/database');
    const save = await getSave(saveId);
    const ps = (save?.metadata as any)?.plotSettings;
    expect(ps).toBeDefined();
    expect(ps.mode).toBe('main');
    expect(ps.tabooContent).toBe('禁止团灭');
    expect(ps.main?.durationYears).toBe(store.plotDurationYears);
  });

  it('main 模式且有大纲: 落库 confirmed 大纲 + hidden 事件树', async () => {
    chatMock.mockResolvedValueOnce(okResult(outlineJson(8)));
    const store = setupPlotStore();
    await store.generatePlotOutline();
    const saveId = await store.startJourney();

    const { getLatestPlotOutline, getPlotEvents } = await import('@engine/database');
    const outline = await getLatestPlotOutline(saveId);
    expect(outline).toBeDefined();
    expect(outline!.confirmed).toBe(true);
    expect(outline!.saveId).toBe(saveId);
    expect(outline!.title).toBe('血色纹章');

    const events = await getPlotEvents(saveId);
    // 1 章节(depth 0) + 2 keyEvents(depth 1)
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.visibility === 'hidden')).toBe(true);
    const chapter = events.find((e) => e.depth === 0)!;
    expect(chapter.title).toBe('第一章 序幕');
    expect(chapter.childrenIds).toHaveLength(2);
    const keyEvents = events.filter((e) => e.depth === 1);
    expect(keyEvents.every((e) => e.parentId === chapter.id)).toBe(true);
  });

  it('历史版本不落库（只存最终确认版）', async () => {
    chatMock
      .mockResolvedValueOnce(okResult(outlineJson(8, 'v1')))
      .mockResolvedValueOnce(okResult(outlineJson(8, 'v2')));
    const store = setupPlotStore();
    await store.generatePlotOutline();
    await store.generatePlotOutline();
    const saveId = await store.startJourney();
    const { getPlotOutlines } = await import('@engine/database');
    const all = await getPlotOutlines(saveId);
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('v2');
  });

  it('off 模式无大纲: 不落库大纲与事件', async () => {
    setActivePinia(createPinia());
    const store = useCreateStore();
    store.name = '测试';
    allocateBasePoints(store);
    const saveId = await store.startJourney();
    const { getLatestPlotOutline, getPlotEvents } = await import('@engine/database');
    expect(await getLatestPlotOutline(saveId)).toBeUndefined();
    expect(await getPlotEvents(saveId)).toHaveLength(0);
  });

  it('开局兑换的命运点应写入存档级 SaveProfile.fp（修 FP 丢失 bug）', async () => {
    setActivePinia(createPinia());
    const store = useCreateStore();
    store.name = '测试';
    store.experienceMode = 'easy';
    store.destinyPoints = 100;
    allocateBasePoints(store);
    const saveId = await store.startJourney();
    const { getSaveProfile } = await import('@engine/database');
    const profile = await getSaveProfile(saveId);
    expect(profile).toBeDefined();
    expect(profile!.experienceMode).toBe('easy');
    expect(profile!.fp).toBe(100);
    expect(profile!.fpHistory).toHaveLength(1);
    expect(profile!.fpHistory[0].amount).toBe(100);
    expect(profile!.fpHistory[0].reason).toContain('开局');
  });

  it('未兑换命运点时仍应创建 SaveProfile 并保存所选经验档位', async () => {
    setActivePinia(createPinia());
    const store = useCreateStore();
    store.name = '测试';
    store.experienceMode = 'easy';
    // destinyPoints 默认 0
    allocateBasePoints(store);
    const saveId = await store.startJourney();
    const { getSaveProfile } = await import('@engine/database');
    const profile = await getSaveProfile(saveId);
    expect(profile).toBeDefined();
    expect(profile!.experienceMode).toBe('easy');
    expect(profile!.fp).toBe(0);
    expect(profile!.fpHistory).toHaveLength(0);
  });
});

// ===== localStorage 草稿 =====

describe('localStorage 草稿 save/restore/clear', () => {
  const DRAFT_KEY = 'plotOutlineDraft_v1';

  function makePlotStore() {
    setActivePinia(createPinia());
    const settings = useSettingsStore();
    settings.settings.apiPool = [
      {
        id: 'ep1',
        name: 'test',
        baseUrl: 'http://localhost',
        apiKey: 'k',
        maskedKey: '***',
        model: 'test-model',
        models: ['test-model'],
        apiType: 'chat',
      },
    ];
    patchAgentSettings(settings.settings, 'plot_outline', {
      model: 'ep1',
      systemPrompt: '你是剧情大纲生成 Agent',
    });
    return useCreateStore();
  }

  beforeEach(() => {
    // Ensure localStorage is clean
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // 测试环境未必有 localStorage；清不掉就算了，下面的用例自己会覆写
    }
  });

  afterEach(() => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // 同上：收尾清理是尽力而为
    }
  });

  it('autoSaveDraft 写入 localStorage 并可被 tryRestoreDraft 恢复', () => {
    const store = makePlotStore();
    store.plotMode = 'main';
    store.name = '艾琳';

    // Set outline and chapters via store's own reactive API (not raw ref assignment)
    // We can't directly assign to plotOutline (it's a computed from generatePlotOutline),
    // so we simulate by directly calling the draft functions after setting via a known path.
    // Instead, directly test by writing to localStorage and reading back.
    const outline = {
      id: 'test-id',
      saveId: '',
      mode: 'main' as const,
      title: '血色纹章',
      summary: '一句话摘要',
      content: '完整叙事大纲',
      chapters: [{ title: '第一章 序幕', summary: '章节摘要', status: 'pending' as const }],
      selfCritique: '评分: 8',
      confirmed: false,
      version: 1,
      timeRange: { start: '复兴纪元001年01月01日', end: '复兴纪元005年12月30日' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const chapters = [
      {
        title: '第一章 序幕',
        summary: '章节摘要',
        keyEvents: [
          { title: '初入王都', description: '主角抵达艾瑟嘉德', triggerHint: '进入王都' },
        ],
      },
    ];

    // Use tryRestoreDraft with valid data to set the store state, then autoSaveDraft should work
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        outline,
        chapters,
        outlineHistory: [],
        chaptersHistory: [],
        savedAt: Date.now(),
      }),
    );
    const restored = store.tryRestoreDraft();
    expect(restored).toBe(true);
    expect(store.plotOutline?.title).toBe('血色纹章');

    // Now autoSaveDraft should save the current state
    store.autoSaveDraft();
    const raw = localStorage.getItem(DRAFT_KEY);
    expect(raw).not.toBeNull();
    const draft = JSON.parse(raw!);
    expect(draft.outline.title).toBe('血色纹章');
    expect(draft.chapters).toHaveLength(1);
    expect(draft.savedAt).toBeGreaterThan(0);

    // Create a fresh store and restore
    const store2 = makePlotStore();
    const restored2 = store2.tryRestoreDraft();
    expect(restored2).toBe(true);
    expect(store2.plotOutline?.title).toBe('血色纹章');
    expect(store2.plotOutlineChapters).toHaveLength(1);
  });

  it('tryRestoreDraft 空 localStorage 时返回 false', () => {
    const store = makePlotStore();
    expect(store.tryRestoreDraft()).toBe(false);
  });

  it('tryRestoreDraft 损坏 JSON 时返回 false 并清除 localStorage', () => {
    localStorage.setItem(DRAFT_KEY, 'not valid json{{{');
    const store = makePlotStore();
    expect(store.tryRestoreDraft()).toBe(false);
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('tryRestoreDraft 缺少 title 时返回 false 并清除', () => {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        outline: { title: '', summary: '' },
        chapters: [],
        savedAt: Date.now(),
      }),
    );
    const store = makePlotStore();
    expect(store.tryRestoreDraft()).toBe(false);
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('tryRestoreDraft 缺少 chapters 时返回 false 并清除', () => {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        outline: { title: '有标题' },
        chapters: [],
        savedAt: Date.now(),
      }),
    );
    const store = makePlotStore();
    expect(store.tryRestoreDraft()).toBe(false);
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('clearDraft 应清除 localStorage key', () => {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        outline: { title: '测试大纲' },
        chapters: [{ title: '第一章', summary: '摘要', keyEvents: [] }],
        savedAt: Date.now(),
      }),
    );
    const store = makePlotStore();
    store.clearDraft();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('autoSaveDraft 应保留 outlineHistory 最多 5 版', () => {
    // Pre-populate localStorage with a draft containing 6 history entries
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        outline: { title: '大纲1', chapters: [] },
        chapters: [{ title: '第一章', summary: '摘要', keyEvents: [] }],
        outlineHistory: [
          { title: '旧版1' },
          { title: '旧版2' },
          { title: '旧版3' },
          { title: '旧版4' },
          { title: '旧版5' },
          { title: '旧版6' },
        ],
        chaptersHistory: [],
        savedAt: Date.now(),
      }),
    );
    // Restore to load it into store
    const store = makePlotStore();
    const restored = store.tryRestoreDraft();
    expect(restored).toBe(true);
    // tryRestoreDraft restores all entries; autoSaveDraft slices to 5
    expect(store.outlineHistory).toHaveLength(6); // restore doesn't slice
    expect(store.outlineHistory[0].title).toBe('旧版1');
    expect(store.outlineHistory[5].title).toBe('旧版6');

    // Now autoSaveDraft should slice to 5
    store.autoSaveDraft();
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY)!);
    expect(draft.outlineHistory).toHaveLength(5);
    expect(draft.outlineHistory[0].title).toBe('旧版2'); // oldest dropped
    expect(draft.outlineHistory[4].title).toBe('旧版6');
  });

  it('startJourney 应包含 clearDraft 调用（手动验证 clearDraft）', () => {
    // Test clearDraft independent of DB operations (startJourney requires DB setup)
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        outline: { title: '草稿大纲', chapters: [] },
        chapters: [{ title: '第一章', summary: '摘要', keyEvents: [] }],
        savedAt: Date.now(),
      }),
    );
    const store = makePlotStore();
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    store.clearDraft();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

// ===== 世界书启用轴（角色多选；命定核心轴已随精简下线） =====

describe('buildEnabledWorldBookEntries 启用轴', () => {
  let store: ReturnType<typeof useCreateStore>;

  beforeEach(() => {
    store = makeStore();
  });

  it('勾选角色 → character:uid', () => {
    store.toggleCharacterEntry(313);
    const ids = store.buildEnabledWorldBookEntries();
    expect(ids).toContain('character:313');
  });

  it('都没选 → 空列表', () => {
    expect(store.buildEnabledWorldBookEntries()).toEqual([]);
  });
});
