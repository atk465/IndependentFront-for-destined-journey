/**
 * CraftBench.test.ts — 制台实时预览的界面级性质（卡牌工坊 MVP）
 *
 * 1. **确定性**：同样的素材选择必出同样的预览（相生 → 复合词条 + 升档 + 造价公式）。
 * 2. **相克警示可见**：不稳定组合必须把「造价七折 + 启封更易抗命」亮出来，不能静默。
 * 3. **元素标签可手动纠偏**：推导只是缺省，玩家关掉标签后预览跟着变（叠加）。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { mount } from '@vue/test-utils';
import type { InventoryItem } from '@engine/types';

const mockGame: {
  player: { inventory: InventoryItem[]; name: string } | null;
  hasMechanicGate: (kind: string) => boolean;
  skillBlueprints: () => { name: string; from: string }[];
} = reactive({
  player: null,
  // 天赋门槛（2026-09-17）：默认未持有——吞噬/熔炼区在测试里不渲染
  hasMechanicGate: (_kind: string) => false,
  // 技能蓝本（S「支配者倒影」）：默认空——制卡区不渲染蓝本选择器
  skillBlueprints: () => [],
});

vi.mock('../../../stores/game-store', () => ({ useGameStore: () => mockGame }));

import CraftBench from './CraftBench.vue';

function material(name: string, over: Partial<InventoryItem> = {}): InventoryItem {
  return { name, quantity: 1, type: '材料', ...over };
}

/** 火晶 = 火（名字命中）；data.price 20 → 估价走 data.price */
const 火晶 = material('火晶', { data: { price: 20 } });
/** 风羽 = 风（名字命中）；无 rarity → tier 1 → 估价 10 */
const 风羽 = material('风羽');
/** 寒水珠 = 水（名字命中） */
const 寒水珠 = material('寒水珠');

beforeEach(() => {
  vi.clearAllMocks();
  mockGame.player = { name: '主角', inventory: [火晶, 风羽, 寒水珠] };
});

async function selectSub(wrapper: ReturnType<typeof mount>, label: string, name: string) {
  const select = wrapper.findAll('select').find((s) => s.attributes('aria-label') === label)!;
  await select.setValue(name);
}

describe('确定性预览', () => {
  it('主素材缺省选中首件；无副素材 = 叠加', () => {
    const w = mount(CraftBench);
    expect(w.text()).toContain('同类叠加');
    // 火晶 data.price=20，tier1（无 rarity）→ 白铁系数 1.0 → 造价 20
    expect(w.text()).toContain('20 GC');
  });
  it('火 + 风 → 相生复合：燎原词条 + 升档青铜 + 造价按系数', async () => {
    const w = mount(CraftBench);
    await selectSub(w, '选择副素材一', '风羽');
    expect(w.text()).toContain('相生复合');
    expect(w.text()).toContain('燎原');
    expect(w.text()).toContain('青铜'); // 白铁 +1
    // (20 + 10) × 青铜 1.6 = 48
    expect(w.text()).toContain('48 GC');
  });
  it('相克组合亮警示行', async () => {
    const w = mount(CraftBench);
    await selectSub(w, '选择副素材一', '寒水珠');
    expect(w.text()).toContain('相克不稳');
    expect(w.find('[role="alert"]').text()).toContain('相克');
  });
  it('关掉副素材的元素标签 → 退回叠加（手动纠偏生效）', async () => {
    const w = mount(CraftBench);
    await selectSub(w, '选择副素材一', '寒水珠');
    // 副素材一的标签行里点掉「水」
    const chips = w.findAll('.slot-card').slice(1);
    const waterChip = chips[0].findAll('button.chip').find((b) => b.text() === '水')!;
    await waterChip.trigger('click');
    expect(w.text()).toContain('同类叠加');
  });
});
