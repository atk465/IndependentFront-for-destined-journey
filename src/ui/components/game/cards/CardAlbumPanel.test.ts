/**
 * CardAlbumPanel.test.ts — 卡册面板的界面级性质（卡牌工坊 MVP）
 *
 * 1. **卡包只列背包里的卡牌实物** —— 材料/装备一件都不出现。
 * 2. **编入经引擎纯函数**：同名 ≤2 的第三张编入不出库，原因可见 —— 规则在
 *    album.ts，UI 只转述；能绕过规则的 UI 是第二真源。
 * 3. **撤出只撤一张同名卡**，其余同名保持编入。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import type { CardAlbumState, CardItem, InventoryItem } from '@engine/types';

const mockGame: {
  player: { inventory: InventoryItem[]; cardAlbum?: CardAlbumState; name: string } | null;
  updateCardAlbum: ReturnType<typeof vi.fn>;
} = reactive({
  player: null,
  updateCardAlbum: vi.fn(async () => ({ ok: true })),
});

vi.mock('../../../stores/game-store', () => ({ useGameStore: () => mockGame }));
// F-1（2026-10-02）：卡面复制补了 ui.toast —— 测试桩同步提供 ui-store
vi.mock('../../../stores/ui-store', () => ({ useUIStore: () => ({ toast: vi.fn() }) }));

import CardAlbumPanel from './CardAlbumPanel.vue';

function card(name: string, over: Partial<CardItem> = {}): CardItem {
  return {
    name,
    quantity: 1,
    type: '卡牌',
    cardTier: '青铜',
    词条: ['火'],
    sealed: false,
    recipe: {
      mainMaterial: '火晶',
      subMaterials: [],
      tier: '青铜',
      fusionKind: '叠加',
      cost: 30,
      rating: '成功',
    },
    ...over,
  };
}

function material(name: string): InventoryItem {
  return { name, quantity: 1, type: '材料' };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGame.player = { name: '主角', inventory: [], cardAlbum: undefined };
});

describe('卡包只列卡牌实物', () => {
  it('材料不进卡包；摘要行显示卡组上限', () => {
    mockGame.player!.inventory = [card('燎原'), material('铁锭')];
    const w = mount(CardAlbumPanel);
    expect(w.text()).toContain('燎原');
    expect(w.text()).not.toContain('铁锭');
    expect(w.text()).toContain('卡组 0/12');
  });
  it('背包没有卡牌时空态可见', () => {
    mockGame.player!.inventory = [material('铁锭')];
    const w = mount(CardAlbumPanel);
    expect(w.text()).toContain('还没有炼制过卡牌');
  });
});

describe('编入 / 同名≤2', () => {
  it('编入一张：先收录种类，再进卡组（整份 cardAlbum 出库）', async () => {
    mockGame.player!.inventory = [card('燎原')];
    const w = mount(CardAlbumPanel);
    await w
      .findAll('button')
      .find((b) => b.text() === '编入')!
      .trigger('click');
    await nextTick();
    expect(mockGame.updateCardAlbum).toHaveBeenCalledTimes(1);
    const submitted = mockGame.updateCardAlbum.mock.calls[0][0] as CardAlbumState;
    expect(submitted.owned).toContain('燎原');
    expect(submitted.deck).toEqual(['燎原']);
  });
  it('同名第三张被纯函数拦下：不出库，原因可见', async () => {
    mockGame.player!.inventory = [card('燎原', { quantity: 3 })];
    mockGame.player!.cardAlbum = { owned: ['燎原'], deck: ['燎原', '燎原'], capacity: 60 };
    const w = mount(CardAlbumPanel);
    await w
      .findAll('button')
      .find((b) => b.text() === '编入')!
      .trigger('click');
    await nextTick();
    expect(mockGame.updateCardAlbum).not.toHaveBeenCalled();
    expect(w.find('[role="status"]').text()).toContain('同名');
  });
});

describe('撤出', () => {
  it('同名两张只撤一张', async () => {
    mockGame.player!.inventory = [card('燎原')];
    mockGame.player!.cardAlbum = { owned: ['燎原'], deck: ['燎原', '甲卡', '燎原'], capacity: 60 };
    const w = mount(CardAlbumPanel);
    // 战力 = 青铜(2) ×2 张（甲卡无实物按 0 跳过）= 4，摘要行可见（阶段 3a 接线）
    expect(w.text()).toContain('战力 4');
    const deckBtn = w.findAll('button').find((b) => b.text() === '撤出')!;
    await deckBtn.trigger('click');
    await nextTick();
    const submitted = mockGame.updateCardAlbum.mock.calls[0][0] as CardAlbumState;
    expect(submitted.deck).toEqual(['燎原', '甲卡']);
  });
  it('启封详情：sealed 卡显示封印 DC 与意志修正（阶段 2 接线）', async () => {
    mockGame.player!.inventory = [card('燎原', { sealed: true })];
    const w = mount(CardAlbumPanel);
    expect(w.text()).toContain('封印 DC');
    expect(w.text()).toContain('启封槽位');
  });
});

describe('详情战斗面（2026-10-02 批次A）', () => {
  it('效果行可见：无登记时按元素派生打底（火→灼烧）', () => {
    mockGame.player!.inventory = [card('燎原')];
    const w = mount(CardAlbumPanel);
    expect(w.text()).toContain('【灼烧】');
  });
  it('登记效果/战技/副轴照实渲染（读侧门禁口径）', () => {
    mockGame.player!.inventory = [
      card('燎原', {
        cardTier: '白银',
        cardEffects: [
          {
            trigger: '打出时',
            target: '敌单体',
            action: '连击',
            value: 50,
            duration: 0,
            cost: { sp: 3 },
          },
        ],
        战技: { status: '中毒', power: 5, beats: 2 },
        cardSecondaryAxes: [{ axis: 'spi', bonus: 40 }],
      }),
    ];
    const w = mount(CardAlbumPanel);
    expect(w.text()).toContain('【连击】');
    expect(w.text()).not.toContain('【灼烧】'); // 登记生效就不走元素打底
    expect(w.text()).toContain('战技「中毒」');
    expect(w.text()).toContain('精神 +40%');
  });
  it('黑铁无副轴槽：门禁外的副轴不显示，效果仍走打底', () => {
    mockGame.player!.inventory = [
      card('燎原', { cardTier: '黑铁', cardSecondaryAxes: [{ axis: 'spi', bonus: 40 }] }),
    ];
    const w = mount(CardAlbumPanel);
    expect(w.text()).not.toContain('精神 +40%');
    expect(w.text()).toContain('【灼烧】');
  });
  it('物资/素材卡不可出战：战斗面整节不显示（元素派生也不会结算）', () => {
    mockGame.player!.inventory = [card('燎原', { 词条: ['火', '物资'] })];
    const w = mount(CardAlbumPanel);
    expect(w.text()).not.toContain('【灼烧】');
    expect(w.text()).not.toContain('战技');
  });
});

describe('复制卡面（2026-10-02 批次F4）', () => {
  it('点「复制卡面」→ description 进剪贴板，提示可见', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    mockGame.player!.inventory = [
      card('燎原', { description: '漆黑书房废墟前的白发瓷偶少女，手握滴火的狼牙刃' }),
    ];
    const w = mount(CardAlbumPanel);
    const btn = w.findAll('button').find((b) => b.text().includes('复制卡面'))!;
    await btn.trigger('click');
    await nextTick();
    expect(writeText).toHaveBeenCalledWith('漆黑书房废墟前的白发瓷偶少女，手握滴火的狼牙刃');
    expect(w.text()).toContain('已复制');
  });
});
