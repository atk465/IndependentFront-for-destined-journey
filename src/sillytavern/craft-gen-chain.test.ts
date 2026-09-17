/**
 * craft-gen-chain.test.ts — 制作生成链测试 (M2 终审补测)
 *
 * 测试:
 * - buildCraftPatches: 纯函数（产物 add_item / item_gen 同名去重 / 装备 equip_item / 散件 add_item / 奖励）
 *
 * 注: 本模块整体在 M3 重写，此处只锁桥接形态的关键行为 —
 * 尤其是"产物与 item_gen equipment 同名时不得重复 add_item"（否则 M2 同名合并
 * 把 quantity 累到 ≥2，随后 equip_item 触发堆叠拒穿 throw）。
 */

import { describe, it, expect } from 'vitest';
import { buildCraftPatches } from './craft-gen-chain';
import type { CraftGenOutput } from './craft-gen-chain';
import type { ItemGenOutput } from './types';

// ========== Factory Helpers ==========

function makeCraftOutput(overrides: Partial<CraftGenOutput> = {}): CraftGenOutput {
  return {
    success: true,
    productName: '精钢长剑',
    quality: '稀有',
    rating: '成功',
    checkSummary: '锻造检定 d20=15 + 技艺 5 vs DC 18 → 成功',
    itemRequests: [],
    narrative: '炉火中，一柄泛着幽蓝光泽的长剑逐渐成形。',
    craftParams: {
      industry: '锻造',
      targetQuality: '稀有',
      stage: '成品',
      quantity: 1,
      materials: '精铁锭x3, 秘银粉x1',
      expGained: 50,
      fpGained: 2,
    },
    ...overrides,
  } as CraftGenOutput;
}

/** 从 patches 中筛出指定 op */
function ops(patches: ReturnType<typeof buildCraftPatches>, op: string) {
  return patches.filter((p) => p.op === op);
}

// ========== buildCraftPatches (纯函数) ==========

/** 门禁标注的取法：真的跑一次 buildCraftPatches，读它改过的 narrative */
function makeOutputNarrativeWithGate(): string {
  const out = makeCraftOutput();
  buildCraftPatches(out, null, '理查德');
  return out.narrative ?? '';
}

describe('buildCraftPatches', () => {
  it('① 无 item_gen 输出 → 产物 1 条 add_item；**未经结算则不发经验/FP**（第三档门禁）', () => {
    const patches = buildCraftPatches(makeCraftOutput(), null, '理查德');

    const addItems = ops(patches, 'add_item');
    expect(addItems).toHaveLength(1);
    expect(addItems[0].target).toBe('characters.理查德');
    expect((addItems[0].value as any).name).toBe('精钢长剑');
    expect((addItems[0].value as any).quantity).toBe(1);
    expect((addItems[0].value as any).rarity).toBe('稀有');

    // 无装备细化 → 不发 equip_item
    expect(ops(patches, 'equip_item')).toHaveLength(0);

    // 🔒 2026-09-17 第三档门禁：没有 settlementPatches = 没走 craft_settle。
    //    旧契约（`!settlementPatches && expGained > 0` 就发）是 fail-open——
    //    AI 漏调结算工具时素材一分不扣、奖励却照发（还可能是 AI 编的数）。现在不发，
    //    并在叙事里留下「未经结算」的标注，让玩家看得见这次没结算。
    expect(ops(patches, 'delta_variable')).toHaveLength(0);
    expect(ops(patches, 'update_character')).toHaveLength(0);
    expect(makeOutputNarrativeWithGate()).toContain('未经结算');
  });

  it('①b 走了结算 → 本函数**不再发奖励**（奖励在结算补丁里，防双发）', () => {
    const out = makeCraftOutput();
    (out as any).settlementPatches = [
      {
        op: 'remove_item',
        target: 'characters.理查德',
        value: { name: '精钢锭', quantity: 1 },
      },
    ];
    const patches = buildCraftPatches(out, null, '理查德');

    // 奖励由 craft_settle 自己的补丁携带；这里若再发一次就是双发（曾经真这么错过）
    expect(ops(patches, 'delta_variable')).toHaveLength(0);
    expect(ops(patches, 'update_character')).toHaveLength(0);
    // 结算过的，不该被打上「未经结算」的标注
    expect(out.narrative).not.toContain('未经结算');
  });

  it('② item_gen equipment 与产物同名 → 不重复 add_item（同名恰好 1 条），单 add_item 带 equippedSlot（M3）', () => {
    const itemOutput: ItemGenOutput = {
      skills: [],
      equipment: [
        {
          slot: '武器',
          name: '精钢长剑', // 与产物同名 — item_gen 细化了产物本身
          description: '剑身流转着秘银纹路',
          stats: { 攻击: 45 },
          durability: 120,
          quality: '稀有',
        },
      ],
      inventory: [],
    };

    const patches = buildCraftPatches(makeCraftOutput(), itemOutput, '理查德');

    // 同名产物只入库 1 次（equipment 条目字段更全，以它为准）
    const addItems = ops(patches, 'add_item');
    const sameNameAdds = addItems.filter((p) => (p.value as any).name === '精钢长剑');
    expect(sameNameAdds).toHaveLength(1);
    expect((sameNameAdds[0].value as any).description).toBe('剑身流转着秘银纹路');

    // M3: 装备单 add_item 带 equippedSlot，不再两步（无单独 equip_item）
    expect(ops(patches, 'equip_item')).toHaveLength(0);
    expect(sameNameAdds[0].value).toHaveProperty('equippedSlot', '武器');
  });

  it('③ item_gen 产出异名装备/散件 → 产物 + 装备 + 散件各自 add_item', () => {
    const itemOutput: ItemGenOutput = {
      skills: [],
      equipment: [
        {
          slot: '饰品',
          name: '锻造师的护符', // 与产物异名 — 附带产出
          description: '锻造中意外凝成的小护符',
          stats: { 体质: 1 },
          quality: '优良',
        },
      ],
      inventory: [
        { name: '秘银碎屑', description: '锻造残料', quantity: 3, type: '材料', rarity: '稀有' },
      ],
    };

    const patches = buildCraftPatches(makeCraftOutput(), itemOutput, '理查德');

    const addItems = ops(patches, 'add_item');
    const names = addItems.map((p) => (p.value as any).name);
    expect(names).toContain('精钢长剑'); // 产物自身
    expect(names).toContain('锻造师的护符'); // 异名装备
    expect(names).toContain('秘银碎屑'); // 散件
    expect(addItems).toHaveLength(3);

    const scrap = addItems.find((p) => (p.value as any).name === '秘银碎屑');
    expect((scrap!.value as any).quantity).toBe(3);
  });

  it('④ item_gen 装备带 automata（S3 DSL 自由效果）→ add_item 透传 automata', () => {
    const itemOutput: ItemGenOutput = {
      skills: [],
      equipment: [
        {
          slot: '武器',
          name: '嗜血之刃',
          description: '剑身残留嗜血意志',
          stats: { 攻击力: 60 },
          quality: '传说',
          automata: [
            {
              id: '嗜血之刃.噬血',
              name: '噬血',
              source: '嗜血之刃',
              owner: '<unitId>',
              subscribe: 'damage.after',
              trigger: 'ctx.damage.final > 0',
              priority: 0,
              divinity: 0,
              intents: [{ kind: 'Heal', targetId: '<owner>', amount: 'ctx.damage.final * 0.1' }],
            },
          ],
        },
      ],
      inventory: [],
    };

    const patches = buildCraftPatches(makeCraftOutput(), itemOutput, '理查德');
    const addItem = ops(patches, 'add_item').find((p) => (p.value as any).name === '嗜血之刃');
    expect(addItem).toBeTruthy();
    expect((addItem!.value as any).automata).toHaveLength(1);
    expect((addItem!.value as any).automata[0]).toMatchObject({ subscribe: 'damage.after' });
  });

  it('制作失败 (success=false) 且无 item_gen 输出 → 空 patches，不产出任何物品（S4d 语义：失败无失败品时为空）', () => {
    const patches = buildCraftPatches(
      makeCraftOutput({ success: false, rating: '失败' }),
      null,
      '理查德',
    );
    expect(patches).toHaveLength(0);
  });

  it('🆕 S4d 制作失败 (success=false) 但 item_gen 产出失败品 → 只落失败品 add_item，不结算 EXP/FP 也不 auto-equip', () => {
    const itemOutput: ItemGenOutput = {
      skills: [],
      equipment: [
        {
          name: '烧焦的剑坯',
          description: '锻打失败留下的残料，剑身布满裂纹。',
          slot: '武器',
          stats: { atk: 1 },
          quality: '普通',
          modifiers: [],
        },
      ],
      inventory: [],
    };
    const patches = buildCraftPatches(
      makeCraftOutput({ success: false, rating: '失败' }),
      itemOutput,
      '理查德',
    );
    const addItem = ops(patches, 'add_item');
    expect(addItem).toHaveLength(1);
    const v = addItem[0].value as any;
    expect(v.name).toBe('烧焦的剑坯');
    expect(v.rarity).toBe('普通');
    // 失败品不 auto-equip（不穿上）
    expect(v.equippedSlot).toBeUndefined();
    // 不结算 EXP/FP
    expect(ops(patches, 'update_character')).toHaveLength(0);
    expect(ops(patches, 'delta_variable')).toHaveLength(0);
  });

  it('🆕 S4d 制作失败 (success=false) 但 item_gen 产出库存型失败品 → 只落 add_item（材料类）', () => {
    const itemOutput: ItemGenOutput = {
      skills: [],
      equipment: [],
      inventory: [
        {
          name: '炭化的精铁碎片',
          description: '淬火失败炸裂的铁片，还能回收一点。',
          quantity: 2,
          type: '材料',
          rarity: '普通',
        },
      ],
    };
    const patches = buildCraftPatches(
      makeCraftOutput({ success: false, rating: '失败' }),
      itemOutput,
      '理查德',
    );
    const addItem = ops(patches, 'add_item');
    expect(addItem).toHaveLength(1);
    expect((addItem[0].value as any).name).toBe('炭化的精铁碎片');
    expect((addItem[0].value as any).quantity).toBe(2);
    expect(ops(patches, 'update_character')).toHaveLength(0);
    expect(ops(patches, 'delta_variable')).toHaveLength(0);
  });

  it('成功 (success=true) + item_gen 失败品同名 → 产物正常 auto-equip（回归）', () => {
    const itemOutput: ItemGenOutput = {
      skills: [],
      equipment: [
        {
          name: '精钢长剑',
          description: '一柄锋利的精钢长剑。',
          slot: '武器',
          stats: { atk: 30 },
          quality: '稀有',
        },
      ],
      inventory: [],
    };
    const patches = buildCraftPatches(makeCraftOutput(), itemOutput, '理查德');
    const addItem = ops(patches, 'add_item');
    expect(addItem).toHaveLength(1);
    expect((addItem[0].value as any).name).toBe('精钢长剑');
    expect((addItem[0].value as any).equippedSlot).toBe('武器');
    // 成功仍结算 EXP/FP
    // 第三档门禁：exp/fp 与「真的结算过」绑定，这条没带 settlementPatches → 不发奖励
    expect(ops(patches, 'update_character')).toHaveLength(0);
    expect(ops(patches, 'delta_variable')).toHaveLength(0);
  });

  it('expGained/fpGained 为 0 时不发奖励 patch', () => {
    const output = makeCraftOutput();
    output.craftParams.expGained = 0;
    output.craftParams.fpGained = 0;
    const patches = buildCraftPatches(output, null, '理查德');
    expect(ops(patches, 'delta_variable')).toHaveLength(0);
  });
});

// ========== 阶段3b 制卡桥：cardProduct 主产物（card-workshop/craft-card 组装） ==========

describe('buildCraftPatches × cardProduct（industry=制卡）', () => {
  /** 与 makeCraftOutput 同形，industry=制卡 */
  function makeCardOutput(overrides: Partial<CraftGenOutput> = {}): CraftGenOutput {
    return makeCraftOutput({
      productName: '燎原符卡',
      craftParams: {
        industry: '制卡',
        targetQuality: '稀有',
        stage: '成品',
        quantity: 1,
        materials: '火晶、疾风羽',
        expGained: 30,
        fpGained: 1,
      },
      ...overrides,
    });
  }

  const card = {
    name: '燎原符卡',
    description: '一团被驯服的野火',
    quantity: 1,
    type: '卡牌',
    rarity: '稀有',
    cardTier: '青铜',
    词条: ['火', '风', '燎原'],
    recipe: {
      mainMaterial: '火晶',
      subMaterials: ['疾风羽'],
      tier: '青铜',
      fusionKind: '相生',
      cost: 48,
      rating: '精益求精',
    },
    sealed: false,
  } as any;

  it('主产物 add_item 用的是 CardItem（type=卡牌，确定性字段随卡）', () => {
    const patches = buildCraftPatches(makeCardOutput(), null, '艾拉', card);
    const addItems = ops(patches, 'add_item');
    expect(addItems).toHaveLength(1);
    expect(addItems[0].value).toBe(card); // 原样落库，不重组
  });

  it('失败时不落卡牌主产物（失败品仍走 item_gen 残料链）', () => {
    const patches = buildCraftPatches(makeCardOutput({ success: false }), null, '艾拉', card);
    expect(ops(patches, 'add_item')).toHaveLength(0);
  });

  it('item_gen 与卡同名的 equipment/inventory 条目被跳过，防双份', () => {
    const itemOutput: ItemGenOutput = {
      skills: [],
      equipment: [
        {
          slot: '武器',
          name: '燎原符卡', // 与卡同名 — item_gen 想把它细化成装备，必须让位
          description: '误入装备槽的卡',
          stats: { 攻击: 5 },
          quality: '稀有',
        },
      ],
      inventory: [{ name: '燎原符卡', quantity: 1, description: '重复的卡', type: '材料' } as any],
    };
    const patches = buildCraftPatches(makeCardOutput(), itemOutput, '艾拉', card);
    const addItems = ops(patches, 'add_item');
    expect(addItems).toHaveLength(1); // 只剩卡牌本体
    expect((addItems[0].value as any).type).toBe('卡牌');
  });
});
