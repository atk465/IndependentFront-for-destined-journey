/**
 * talent-entry.test.ts —— 骨架条目池 + 融合化学反应边界覆盖（天赋系统 T-S1）
 *
 * 钉合同：AI 零编数（条目必须逐字命中池内预设）、对消爆发确定性可复算、互斥组过滤。
 */
import { describe, it, expect } from 'vitest';
import {
  TALENT_ENTRY_POOL,
  validateTalentEntries,
  fuseEntrySets,
  tierUp,
  sameEntry,
  type TalentChannel,
  type TalentEntryKind,
  type TalentEntry,
  TALENT_CATALOG,
  getCreationCatalog,
  getExchangeCatalog,
  talentExchangePrice,
  getTalentTemplate,
  GRADE_PRICE_MULTIPLIER,
  type TalentGrade,
} from './talent-entry';

const 废弃材料限定: TalentEntry = {
  kind: '材料限定',
  channel: 'universal',
  params: { materialClass: '废弃' },
};
const 成功率加成50: TalentEntry = {
  kind: '成功率加成',
  channel: 'universal',
  params: { bonus: 50 },
};
const 保底普通: TalentEntry = {
  kind: '品质锁定',
  channel: 'universal',
  params: { direction: '保底', tier: '普通' },
};
const 上限普通: TalentEntry = {
  kind: '品质锁定',
  channel: 'universal',
  params: { direction: '上限', tier: '普通' },
};
const 品质突破摩托: TalentEntry = {
  kind: '品质突破',
  channel: 'fusion',
  params: { materialClass: '废弃', productClass: '摩托' },
};

describe('TALENT_ENTRY_POOL（单一真源）', () => {
  /** 可扩展枚举（主人裁定：加渠道/加条目 = 加数据，不改代码） */
  const ALL_KINDS: readonly TalentEntryKind[] = [
    '材料限定',
    '成品限定',
    '成功率加成',
    '品质锁定',
    '品质突破',
    '启封加值',
    '行动值加成',
    '防御加值',
    '产出数量',
    '风险系数',
    '金钱加投',
    '判定取优',
    '词条加权',
    '形态转化',
    '战技附加',
    '击杀掠取',
    '连战递增',
    '鉴定',
  ];
  const ALL_CHANNELS: readonly TalentChannel[] = [
    'creation',
    'story',
    'exchange',
    'fusion',
    'universal',
  ];

  it('v1 池规模：八条目品种、渠道标记齐备（五渠道可扩）', () => {
    const kinds = new Set(TALENT_ENTRY_POOL.map((e) => e.kind));
    expect([...kinds].sort()).toEqual([...ALL_KINDS].sort());
    const channels = new Set(TALENT_ENTRY_POOL.map((e) => e.channel));
    for (const ch of ALL_CHANNELS) expect(channels.has(ch)).toBe(true);
  });
});

describe('validateTalentEntries —— AI 零编数门禁', () => {
  it('池内条目命中并回填池内规范对象（channel 以池为准）', () => {
    const forged: TalentEntry = { ...成功率加成50, channel: 'story' }; // AI 想改渠道标记
    const got = validateTalentEntries([forged]);
    expect(got.ok).toBe(true);
    expect(got.normalized[0].channel).toBe('universal');
  });
  it('编数值 → 整组拒绝（bonus 不在档位）', () => {
    const hacked: TalentEntry = { kind: '成功率加成', channel: 'universal', params: { bonus: 99 } };
    const got = validateTalentEntries([成功率加成50, hacked]);
    expect(got.ok).toBe(false);
    expect(got.reason).toContain('不在骨架条目池内');
    expect(got.normalized).toEqual([]);
  });
  it('未知 kind → 拒绝', () => {
    const got = validateTalentEntries([
      { kind: '无限金钱' as never, channel: 'universal', params: {} },
    ]);
    expect(got.ok).toBe(false);
  });
});

describe('fuseEntrySets —— 条目化学反应', () => {
  it('对消爆发：保底 + 上限 → 品质突破（域取两源并集）', () => {
    const 载具成品限定: TalentEntry = {
      kind: '成品限定',
      channel: 'universal',
      params: { productClass: '摩托' },
    };
    const got = fuseEntrySets([废弃材料限定, 保底普通], [上限普通, 载具成品限定]);
    expect(got.some((t) => sameEntry(t, 品质突破摩托))).toBe(true);
    expect(got.some((t) => t.kind === '品质锁定')).toBe(false);
  });
  it('无对消时照抄合并 + 完全同条目去重', () => {
    const got = fuseEntrySets([成功率加成50], [成功率加成50, 废弃材料限定]);
    expect(got.filter((t) => sameEntry(t, 成功率加成50))).toHaveLength(1);
    expect(got.some((t) => sameEntry(t, 废弃材料限定))).toBe(true);
  });
  it('互斥组过滤：同组非空 excl 只保先出现的一条', () => {
    const 攻防A: TalentEntry = {
      kind: '行动值加成',
      channel: 'universal',
      params: { amount: 3, excl: '攻防' },
    };
    const 攻防B: TalentEntry = {
      kind: '防御加值',
      channel: 'universal',
      params: { amount: 4, excl: '攻防' },
    };
    const got = fuseEntrySets([攻防A], [攻防B]);
    expect(got).toEqual([攻防A]);
  });
});

describe('tierUp —— 品质越一级', () => {
  it('按 RARITY_LEVELS 索引 +1，制作封顶传说', () => {
    expect(tierUp('普通')).toBe('优良');
    expect(tierUp('优良')).toBe('稀有');
    expect(tierUp('史诗')).toBe('传说');
    expect(tierUp('传说')).toBe('传说'); // 唯一不可生产
  });
});

describe('TALENT_CATALOG —— 目录与条目池一致性（门禁不被自家目录打脸）', () => {
  it('目录每条模板的骨架条目都逐字命中条目池', () => {
    for (const tpl of TALENT_CATALOG) {
      const v = validateTalentEntries(tpl.entries);
      expect(`${tpl.name}: ${v.reason ?? 'ok'}`).toBe(`${tpl.name}: ok`);
    }
  });
  it('融合独占不进 捏人/兑换 清单；捏人含出身独占、兑换含兑换独占', () => {
    const creation = getCreationCatalog().map((t) => t.name);
    const exchange = getExchangeCatalog().map((t) => t.name);
    expect(creation).toContain('天才卡师');
    expect(creation).not.toContain('垃圾摩托');
    expect(exchange).toContain('卡牌宗师');
    expect(exchange).not.toContain('天才卡师');
    expect(exchange).not.toContain('封印斗士');
  });
  it('兑换定价 = 基础×品级乘数，取整到 5 的倍数；getTalentTemplate 按名查册', () => {
    expect(talentExchangePrice(getExchangeCatalog()[0])).toBeGreaterThanOrEqual(10);
    const 宗师 = getTalentTemplate('卡牌宗师');
    expect(宗师?.entries).toHaveLength(2);
    expect(talentExchangePrice(宗师!)).toBe(45); // 基础 15 × SS 3
  });
});

describe('v2 扩容 —— 品级 / 生成倾向 / 战技赋予（截图灵感波）', () => {
  /** 品级八档（可扩展枚举） */
  const GRADES: readonly TalentGrade[] = ['SSS', 'SS', 'S', 'A', 'B', 'C', 'D', 'E'];

  it('品级枚举八档齐全（GRADE_PRICE_MULTIPLIER 全覆盖）', () => {
    for (const g of GRADES) {
      expect(GRADE_PRICE_MULTIPLIER[g]).toBeGreaterThan(0);
    }
  });

  it('品级定价乘数：双条目 C 级 20、单条目 SS 级 30（5 的倍数取整）', () => {
    const 犬类 = getTalentTemplate('犬类伙伴');
    expect(犬类?.grade).toBe('C');
    expect(talentExchangePrice(犬类!)).toBe(20); // 基础 15 × C 1.2 = 18 → 取整 20
    const 欧皇 = getTalentTemplate('欧皇系统');
    expect(欧皇?.grade).toBe('SS');
    expect(talentExchangePrice(欧皇!)).toBe(30); // 基础 10 × SS 3 = 30
  });

  it('生成倾向条目：词条加权带关键词与档位', () => {
    const 犬类 = getTalentTemplate('犬类伙伴');
    const 加权 = 犬类?.entries.find((e) => e.kind === '词条加权');
    expect(加权?.params.keywords).toEqual(['忠诚', '追踪']);
    expect(加权?.params.weight).toBe(2);
  });

  it('战技赋予条目：状态/量/持续拍数齐备', () => {
    const 足尖 = getTalentTemplate('足尖的剧毒');
    const 战技 = 足尖?.entries.find((e) => e.kind === '战技附加');
    expect(战技?.params).toMatchObject({ status: '中毒', power: 3, beats: 3 });
  });

  it('形态转化条目：系列名定向', () => {
    const 猫 = getTalentTemplate('猫之九命');
    const 转化 = 猫?.entries.find((e) => e.kind === '形态转化');
    expect(转化?.params.series).toBe('猫娘');
  });
});
