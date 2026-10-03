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
import { reactive, nextTick } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { CardItem, InventoryItem } from '@engine/types';

const mockGame: {
  player: { inventory: InventoryItem[]; name: string } | null;
  hasMechanicGate: (kind: string) => boolean;
  skillBlueprints: () => { name: string; from: string }[];
  craftCard: ReturnType<typeof vi.fn>;
  feedCompanion: ReturnType<typeof vi.fn>;
  setEvolutionDirection: ReturnType<typeof vi.fn>;
} = reactive({
  player: null,
  // 天赋门槛（2026-09-17）：默认未持有——吞噬/熔炼区在测试里不渲染
  hasMechanicGate: (_kind: string) => false,
  // 技能蓝本（S「支配者倒影」）：默认空——制卡区不渲染蓝本选择器
  skillBlueprints: () => [],
  craftCard: vi.fn(async () => ({ ok: false, reason: '测试未配置' })),
  feedCompanion: vi.fn(async () => ({ ok: false, reason: '测试未配置' })),
  setEvolutionDirection: vi.fn(async () => ({ ok: false, reason: '测试未配置' })),
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

/**
 * 点素材区的一件材料（2026-09-18 UI 改造：三个下拉 → 点选填槽）。
 * 语义与旧 selectSub 对齐：第一次点击填主槽，第二次填副一，第三次填副二。
 */
async function clickMaterial(wrapper: ReturnType<typeof mount>, name: string) {
  const btn = wrapper.findAll('.pool-item').find((b) => b.text().includes(name))!;
  await btn.trigger('click');
}

describe('确定性预览', () => {
  it('主素材缺省选中首件；无副素材 = 叠加', () => {
    const w = mount(CraftBench);
    expect(w.text()).toContain('同类叠加');
    // 火晶 data.price=20，tier1（无 rarity）→ 黑铁系数 1.0 → 造价 20
    expect(w.text()).toContain('20 GC');
  });
  it('火 + 风 → 相生复合：燎原词条 + 升档青铜 + 造价按系数', async () => {
    const w = mount(CraftBench);
    await clickMaterial(w, '风羽');
    expect(w.text()).toContain('相生复合');
    expect(w.text()).toContain('燎原');
    expect(w.text()).toContain('青铜'); // 黑铁 +1
    // (20 + 10) × 青铜 1.6 = 48
    expect(w.text()).toContain('48 GC');
  });
  it('相克组合亮警示行', async () => {
    const w = mount(CraftBench);
    await clickMaterial(w, '寒水珠');
    expect(w.text()).toContain('相克不稳');
    expect(w.find('[role="alert"]').text()).toContain('相克');
  });
  it('关掉副素材的元素标签 → 退回叠加（手动纠偏生效）', async () => {
    const w = mount(CraftBench);
    await clickMaterial(w, '寒水珠');
    // 副素材一的标签行里点掉「水」
    const chips = w.findAll('.slot-card').slice(1);
    const waterChip = chips[0].findAll('button.chip').find((b) => b.text() === '水')!;
    await waterChip.trigger('click');
    expect(w.text()).toContain('同类叠加');
  });
});

describe('制卡回执战斗面（2026-10-02 批次A）', () => {
  it('制卡成功：回执附带产物效果与战技（与卡册详情同源措辞）', async () => {
    mockGame.craftCard = vi.fn(async () => ({
      ok: true,
      productName: '燎原之卡',
      tier: '青铜',
      rating: '成功',
      cost: 48,
      exp: 10,
      namedBy: 'ai' as const,
    }));
    const product = {
      name: '燎原之卡',
      quantity: 1,
      type: '卡牌',
      cardTier: '青铜',
      词条: ['火'],
      sealed: false,
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
    } as unknown as CardItem;
    mockGame.player!.inventory = [火晶, 风羽, 寒水珠, product];
    const w = mount(CraftBench);
    // 直接制卡区走三个下拉（点选区只喂融合预览，不作数）；火+风=相生与既有预览同路径
    await w.find('select[aria-label="选择主素材"]').setValue('火晶');
    await w.find('select[aria-label="选择副素材甲"]').setValue('风羽');
    const btn = w.findAll('button').find((b) => b.text().includes('开始制卡'))!;
    await btn.trigger('click');
    await flushPromises();
    await nextTick();
    expect(w.text()).toContain('产物战斗面');
    expect(w.text()).toContain('【连击】');
    expect(w.text()).toContain('战技「中毒」');
  });
});

describe('投喂与倾向（2026-10-02 批次C）', () => {
  it('选中伙伴与素材出定值预览；投喂走 store 并显示回执', async () => {
    mockGame.feedCompanion = vi.fn(async () => ({
      ok: true,
      summary: '【她的卡】吃下【火晶】（火·同源共鸣 ×2）——卡面经验 +50',
    }));
    mockGame.player!.inventory = [
      火晶,
      风羽,
      寒水珠,
      {
        name: '她的卡',
        quantity: 1,
        type: '卡牌',
        cardTier: '黑铁',
        词条: ['火', '召唤'],
        sealed: false,
      } as unknown as CardItem,
    ];
    const w = mount(CraftBench);
    await w.find('select[aria-label="选择要投喂的伙伴卡"]').setValue('她的卡');
    await w.find('select[aria-label="选择投喂素材"]').setValue('火晶');
    expect(w.text()).toContain('同源共鸣'); // 火晶=火 → 同源 ×2 预览
    const btn = w.findAll('button').find((b) => b.text().includes('投喂一份'))!;
    await btn.trigger('click');
    await flushPromises();
    await nextTick();
    expect(mockGame.feedCompanion).toHaveBeenCalledWith('她的卡', '火晶');
    expect(w.text()).toContain('卡面经验 +50');
  });
  it('倾向三选一：持【最终兵器】门槛时渲染，点击转向走 store', async () => {
    mockGame.hasMechanicGate = vi.fn((kind: string) => kind === '自我进化');
    mockGame.setEvolutionDirection = vi.fn(async () => ({
      ok: true,
      summary: '【她的卡】定下进化倾向「炽野」',
    }));
    mockGame.player!.inventory = [
      {
        name: '她的卡',
        quantity: 1,
        type: '卡牌',
        cardTier: '黑铁',
        词条: ['火', '召唤'],
        sealed: false,
      } as unknown as CardItem,
    ];
    const w = mount(CraftBench);
    await w.find('select[aria-label="选择要投喂的伙伴卡"]').setValue('她的卡');
    expect(w.text()).toContain('进化倾向');
    const chip = w.findAll('button.chip.toggle').find((b) => b.text() === '炽野')!;
    await chip.trigger('click');
    await flushPromises();
    await nextTick();
    expect(mockGame.setEvolutionDirection).toHaveBeenCalledWith('她的卡', '炽野');
    expect(w.text()).toContain('定下进化倾向「炽野」');
  });
});

describe('素材词条（2026-10-02 批次D）', () => {
  it('素材词条名上背包清单；主/副位差在预览可见（浑成在副位不生效）', async () => {
    mockGame.player!.inventory = [material('月光苔'), material('千年树心'), material('火晶')];
    const w = mount(CraftBench);
    expect(w.text()).toContain('灵光'); // 内建基线词条名直接可见（池子角标）
    expect(w.text()).toContain('浑成'); // D-1 修复后：千年树心的词条角标在清单上可见（与结算同源）
    await clickMaterial(w, '千年树心'); // 主槽已被缺省的月光苔占住 → 千年树心进副一
    expect(w.text()).toContain('素材词条');
    // 位差判定收口到**预览审计行**：池子角标照实显示全部词条，位差过滤在结算预览
    const notes = w.find('.bench-note').text();
    expect(notes).toContain('灵光'); // 月光苔主位，通用词条生效
    expect(notes).not.toContain('浑成'); // 千年树心的主位词条在副位不生效——位差可见
  });
});
