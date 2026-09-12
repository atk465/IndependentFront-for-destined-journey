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
