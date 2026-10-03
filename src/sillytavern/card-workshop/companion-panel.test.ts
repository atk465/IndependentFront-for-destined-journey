import { describe, it, expect } from 'vitest';
import {
  buildCompanionPanel,
  companionBaseOf,
  applyCompanionExp,
  companionEquipSlotOf,
  companionEffectivePanel,
  companionWearingNames,
} from './companion-panel';
import type { CharacterState } from '../types';

describe('buildCompanionPanel（伙伴实体化 §2.3 面板公式）', () => {
  it('双元素加权：火/暗 → 力/智双轴 +3，余数按权重降序分完', () => {
    // 黑铁×成功 = 20；str4/int4/dex1/con1/spi1（和 11）：floor 7/1/1/7/1=17，
    // 余 3 依 [str,int,dex,con,spi] → str8/int8/dex2
    const p = buildCompanionPanel({
      cardTier: '黑铁',
      rating: '成功',
      词条: ['火', '暗'],
      materialTiers: [],
    });
    expect(p.attributes).toEqual({ str: 8, dex: 2, con: 1, int: 8, spi: 1 });
    expect(p.maxHp).toBe(38); // 30 + 1×8
    expect(p.maxMp).toBe(67); // 15 + 8×6 + 1×4
    expect(p.maxSp).toBe(24); // 20 + 1×4
    expect(p.auditLine).toBe(
      '面板：黑铁基数 × 评级「成功」1 + 素材0×2 → 力8/敏2/体1/智8/神1，HP38/MP67/SP24',
    );
  });

  it('无元素：权重全 1，五维均分', () => {
    // 黑铁×成功 = 20；全 1 → floor(20/5)=4×5=20 无余数
    const p = buildCompanionPanel({
      cardTier: '黑铁',
      rating: '成功',
      词条: ['召唤', '锐利'],
      materialTiers: [],
    });
    expect(p.attributes).toEqual({ str: 4, dex: 4, con: 4, int: 4, spi: 4 });
    expect(p.maxHp).toBe(62);
    expect(p.maxMp).toBe(55);
    expect(p.maxSp).toBe(36);
  });

  it('评级系数：精益求精 1.15 / 大失败 0.8', () => {
    // 精益求精：round(20×1.15)=23 → floor(23/5)=4×5=20，余 3 归 str/dex/con → 5/5/5/4/4
    const good = buildCompanionPanel({
      cardTier: '黑铁',
      rating: '精益求精',
      词条: [],
      materialTiers: [],
    });
    expect(good.attributes).toEqual({ str: 5, dex: 5, con: 5, int: 4, spi: 4 });
    expect(good.maxHp).toBe(70);
    // 大失败：round(20×0.8)=16 → floor 3×5=15，余 1 归 str → 4/3/3/3/3
    const bad = buildCompanionPanel({
      cardTier: '黑铁',
      rating: '大失败',
      词条: [],
      materialTiers: [],
    });
    expect(bad.attributes).toEqual({ str: 4, dex: 3, con: 3, int: 3, spi: 3 });
    expect(bad.maxHp).toBe(54);
    expect(bad.auditLine).toBe(
      '面板：黑铁基数 × 评级「大失败」0.8 + 素材0×2 → 力4/敏3/体3/智3/神3，HP54/MP45/SP32',
    );
  });

  it('余数分配：单元素轴权重最高优先补齐', () => {
    // 青铜×失败 = round(28×0.9)=25；雷→dex 权重 4（和 8）：dex floor(100/8)=12、余轴 3 →
    // 3/12/3/3/3=24，余 1 归 dex → 3/13/3/3/3
    const p = buildCompanionPanel({
      cardTier: '青铜',
      rating: '失败',
      词条: ['雷', '召唤'],
      materialTiers: [],
    });
    expect(p.attributes).toEqual({ str: 3, dex: 13, con: 3, int: 3, spi: 3 });
  });

  it('素材项计入：Σ(materialTiers)×2 并入总量；审计行带素材合计', () => {
    // 白银×成功 = 36 + (1+2+1)×2 = 44；全 1 权重 → floor(44/5)=8×5=40，余 4 归 str/dex/con/int → 9/9/9/9/8
    const p = buildCompanionPanel({
      cardTier: '白银',
      rating: '成功',
      词条: [],
      materialTiers: [1, 2, 1],
    });
    expect(p.attributes).toEqual({ str: 9, dex: 9, con: 9, int: 9, spi: 8 });
    expect(p.maxHp).toBe(102); // 30 + 9×8
    expect(p.maxMp).toBe(101); // 15 + 9×6 + 8×4
    expect(p.maxSp).toBe(56); // 20 + 9×4
    expect(p.auditLine).toBe(
      '面板：白银基数 × 评级「成功」1 + 素材4×2 → 力9/敏9/体9/智9/神8，HP102/MP101/SP56',
    );
  });
});

describe('companionBaseOf（伙伴实体化 D5 战斗基座，批② B2.1）', () => {
  const entity = (overrides: Record<string, unknown>): CharacterState =>
    ({
      id: 'e1',
      saveId: 's1',
      type: 'summon',
      name: '愤怨瓷心·艾拉',
      race: '铭灵',
      identity: [],
      occupation: [],
      tier: 1,
      tierName: '普通',
      level: 3,
      totalExp: 0,
      expToNext: 200,
      attributes: { str: 11, dex: 3, con: 2, int: 2, spi: 2 },
      freeAttrPoints: 0,
      hp: 40,
      maxHp: 46,
      mp: 20,
      maxMp: 35,
      sp: 28,
      maxSp: 28,
      skills: [],
      inventory: [],
      statusEffects: [],
      money: 0,
      location: '灰港',
      present: true,
      currentAction: '',
      customFields: {
        companion: {
          bornTier: '黑铁',
          equip: {},
          evolution: { unlocked: false, offerings: [] },
          injured: false,
        },
      },
      ...overrides,
    }) as unknown as CharacterState;

  it('召唤卡 + 实体在场未重伤 → 命中，返回实体面板快照', () => {
    const base = companionBaseOf({ name: '愤怨瓷心·艾拉', 词条: ['火', '召唤'] }, [entity({})]);
    expect(base).not.toBeNull();
    expect(base?.name).toBe('愤怨瓷心·艾拉');
    expect(base?.level).toBe(3);
    expect(base?.attributes.con).toBe(2);
    expect(base?.mp).toBe(20);
  });

  it('非召唤卡 / 无实体 / 实体非 summon → null', () => {
    expect(companionBaseOf({ name: '铁剑', 词条: ['装备'] }, [entity({})])).toBeNull();
    expect(companionBaseOf({ name: '无名之卡', 词条: ['召唤'] }, [entity({})])).toBeNull();
    expect(
      companionBaseOf({ name: '愤怨瓷心·艾拉', 词条: ['召唤'] }, [entity({ type: 'npc' })]),
    ).toBeNull();
  });

  it('沉眠（present:false）与重伤（injured:true）→ null', () => {
    expect(
      companionBaseOf({ name: '愤怨瓷心·艾拉', 词条: ['召唤'] }, [entity({ present: false })]),
    ).toBeNull();
    const injured = entity({});
    (injured.customFields as Record<string, unknown>).companion = {
      bornTier: '黑铁',
      equip: {},
      evolution: { unlocked: false, offerings: [] },
      injured: true,
    };
    expect(companionBaseOf({ name: '愤怨瓷心·艾拉', 词条: ['召唤'] }, [injured])).toBeNull();
  });
});

describe('applyCompanionExp（伙伴实体化 D8 升级内核，批③ B3.1）', () => {
  const lite = (overrides: Record<string, unknown> = {}) => ({
    level: 1,
    totalExp: 0,
    attributes: { str: 11, dex: 3, con: 2, int: 2, spi: 2 },
    maxHp: 46,
    maxMp: 35,
    maxSp: 28,
    hp: 40,
    mp: 20,
    sp: 28,
    词条: ['火', '召唤'],
    ...overrides,
  });

  it('多级连升：450 经验（黑铁管容 200）→ Lv3，余 50', () => {
    const r = applyCompanionExp(lite(), 450, '黑铁');
    expect(r.level).toBe(3);
    expect(r.totalExp).toBe(50);
    expect(r.expToNext).toBe(200);
    // 两级各 +3 点，火→str 权重最高：每级 str/dex/con 各 +1 → 累计 str+2/dex+2/con+2
    expect(r.attributes).toEqual({ str: 13, dex: 5, con: 4, int: 2, spi: 2 });
    expect(r.maxHp).toBe(62); // 30 + 4×8
    expect(r.maxMp).toBe(35);
    expect(r.maxSp).toBe(36); // 20 + 4×4
    expect(r.auditLines[0]).toContain('Lv1 → Lv3');
  });

  it('Δmax 等比抬当前值：hp 只抬升上限增量，不超新上限', () => {
    const r = applyCompanionExp(lite(), 450, '黑铁');
    expect(r.hp).toBe(56); // 40 + (62−46)
    expect(r.mp).toBe(20); // maxMp 未变 → 不抬
    expect(r.sp).toBe(36); // 28 + (36−28)
  });

  it('无元素：权重全 1，+3 点按五维固定序轮转', () => {
    const r = applyCompanionExp(lite({ 词条: [] }), 200, '黑铁');
    expect(r.level).toBe(2);
    expect(r.attributes).toEqual({ str: 12, dex: 4, con: 3, int: 2, spi: 2 });
  });

  it('cap 钳制：满级溢出经验丢弃，audit 提示进化蜕变', () => {
    const r = applyCompanionExp(lite({ level: 10 }), 500, '黑铁');
    expect(r.level).toBe(10);
    expect(r.totalExp).toBe(0);
    expect(r.attributes).toEqual({ str: 11, dex: 3, con: 2, int: 2, spi: 2 });
    expect(r.auditLines.join()).toContain('已达黑铁品阶上限（Lv10）');
  });

  it('零经验：原样返回，无审计行', () => {
    const r = applyCompanionExp(lite(), 0, '黑铁');
    expect(r.level).toBe(1);
    expect(r.totalExp).toBe(0);
    expect(r.auditLines).toEqual([]);
  });
});

describe('companionEquipSlotOf / companionEffectivePanel / companionWearingNames（批④ B4.1/B4.3/B4.4）', () => {
  it('B4.1 槽位映射：装备按 equippedSlot；装备卡→hand；其余 null', () => {
    expect(companionEquipSlotOf({ type: '装备', equippedSlot: '武器' })).toBe('hand');
    expect(companionEquipSlotOf({ type: '装备', equippedSlot: '副手' })).toBe('hand');
    expect(companionEquipSlotOf({ type: '装备', equippedSlot: '头部' })).toBe('body');
    expect(companionEquipSlotOf({ type: '装备', equippedSlot: '腰带' })).toBe('body');
    expect(companionEquipSlotOf({ type: '装备', equippedSlot: '饰品' })).toBe('charm');
    expect(companionEquipSlotOf({ type: '装备', equippedSlot: null })).toBeNull(); // 躺背包无本性
    expect(companionEquipSlotOf({ type: '卡牌', equippedSlot: null, 词条: ['装备'] })).toBe('hand');
    expect(companionEquipSlotOf({ type: '卡牌', equippedSlot: null, 词条: ['技能'] })).toBeNull();
    expect(companionEquipSlotOf({ type: '材料', equippedSlot: null })).toBeNull();
    expect(companionEquipSlotOf(undefined)).toBeNull();
  });

  it('B4.3 effective 面板：佩戴装备实物 stats 五维键加算；装备卡仅语义位不加算', () => {
    const ent = {
      attributes: { str: 11, dex: 3, con: 2, int: 2, spi: 2 },
      customFields: {
        companion: {
          bornTier: '黑铁',
          equip: { hand: '狼牙锯刃', charm: '青铜铃' },
          evolution: { unlocked: false, offerings: [] },
        },
      },
    } as unknown as CharacterState;
    const inventory = [
      {
        name: '狼牙锯刃',
        quantity: 1,
        type: '装备',
        equippedSlot: null,
        stats: { str: 5, 攻击力: 20 },
      },
      { name: '青铜铃', quantity: 1, type: '装备', equippedSlot: null, stats: { spi: 3 } },
      { name: '铁剑卡', quantity: 1, type: '卡牌', 词条: ['装备'], stats: { str: 99 } },
    ] as never[];
    const p = companionEffectivePanel(ent, inventory);
    expect(p.attributes).toEqual({ str: 16, dex: 3, con: 2, int: 2, spi: 5 });
  });

  it('B4.4 wearingNames：任一伙伴佩戴表引用的物品名集合', () => {
    const roster = [
      {
        customFields: {
          companion: { bornTier: '黑铁', equip: { hand: '狼牙锯刃' }, evolution: {} },
        },
      },
      {
        customFields: {
          companion: { bornTier: '黑铁', equip: { charm: '青铜铃' }, evolution: {} },
        },
      },
      { customFields: {} },
    ] as unknown as CharacterState[];
    const worn = companionWearingNames(roster);
    expect(worn.has('狼牙锯刃')).toBe(true);
    expect(worn.has('青铜铃')).toBe(true);
    expect(worn.has('没戴的东西')).toBe(false);
    expect(companionWearingNames(undefined as unknown as CharacterState[]).size).toBe(0);
  });
});
