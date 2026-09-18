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
  buildCraftBiasLines,
  getTalentTemplate,
  GRADE_PRICE_MULTIPLIER,
  type TalentGrade,
  getDrawableCatalog,
  hasWorkingMechanic,
  IMPLEMENTED_ENTRY_KINDS,
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
    '威压',
    '配方解锁',
    '体魄',
    '吞噬',
    '熔炼',
    '拆解',
    '融合',
    '合同',
    '终章',
    '叙事意图',
    '情绪素材',
    '深渊契约',
    '改造',
    '捕获',
    '孕育',
    '转化',
    '越阶',
    '剥离',
    '欲望主导',
    '自我进化',
    '结缘',
    '位份',
    '克上',
    '环境加成',
    '点金',
    '日掷',
    '烙印',
    '置换',
    '抽奖',
    '免死',
    '复生',
    '自身状态',
    '惰性',
    '羁绊',
    '成灵',
    '献祭',
    '决斗',
    '赌运',
    '调教',
    '回溯',
    '宿敌',
    '打脸',
    '炼金',
    '真名',
    '模块化',
    '倒影',
    '条件加成',
    '独行',
    '暴击',
    '嗜血',
    '处决',
    '群威',
    '快咏',
    '体型压制',
    '狂化',
    '本名武器',
    '同契',
    '经验倍率',
    '交易折扣',
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
  it('池内档位条目命中（channel 保留授予方标记，结构校验不改写）', () => {
    const forged: TalentEntry = { ...成功率加成50, channel: 'story' };
    const got = validateTalentEntries([forged]);
    expect(got.ok).toBe(true);
    expect(got.normalized[0].channel).toBe('story');
  });
  it('编数值 → 整组拒绝（bonus 不在档位）', () => {
    const hacked: TalentEntry = { kind: '成功率加成', channel: 'universal', params: { bonus: 99 } };
    const got = validateTalentEntries([成功率加成50, hacked]);
    expect(got.ok).toBe(false);
    expect(got.reason).toContain('不在档位白名单');
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

describe('TALENT_CATALOG —— 目录条目过种类规则校验（门禁不被自家目录打脸）', () => {
  it('目录每条模板的骨架条目都通过结构校验', () => {
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

describe('v4 扩容 —— 威压/配方解锁/体魄 条目', () => {
  it('威压参数命中池（30% 档）', () => {
    const v = validateTalentEntries([
      { kind: '威压', channel: 'universal', params: { percent: 30 } },
    ]);
    expect(v.ok).toBe(true);
  });
  it('配方解锁：配方名是内容（任意非空名都放行），缺名才拒绝', () => {
    const 命中 = validateTalentEntries([
      { kind: '配方解锁', channel: 'universal', params: { recipe: '任意配方名' } },
    ]);
    expect(命中.ok).toBe(true);
    const 缺名 = validateTalentEntries([{ kind: '配方解锁', channel: 'universal', params: {} }]);
    expect(缺名.ok).toBe(false);
  });
  it('体魄参数命中池（200% 档）', () => {
    const v = validateTalentEntries([
      { kind: '体魄', channel: 'universal', params: { percent: 200 } },
    ]);
    expect(v.ok).toBe(true);
  });
  it('威压参数越档（percent 77）→ 拒绝', () => {
    const v = validateTalentEntries([
      { kind: '威压', channel: 'universal', params: { percent: 77 } },
    ]);
    expect(v.ok).toBe(false);
  });
});

describe('buildCraftBiasLines —— 炼制倾向汇总（切片 T-S2 实装）', () => {
  it('词条加权 → 词条倾向行（权重3=必附）', async () => {
    const { buildCraftBiasLines } = await import('./talent-entry');
    const lines = buildCraftBiasLines([
      {
        name: '犬类伙伴',
        entries: [
          {
            kind: '词条加权',
            params: { keywords: ['忠诚', '追踪'], weight: 2 },
          } as never,
        ],
      } as never,
    ]);
    expect(lines).toEqual(['词条倾向（倾向）：忠诚、追踪']);
  });

  it('形态转化与配方解锁各占一行', async () => {
    const { buildCraftBiasLines } = await import('./talent-entry');
    const lines = buildCraftBiasLines([
      {
        name: '猫之九命',
        entries: [{ kind: '形态转化', params: { series: '猫娘' } } as never],
      },
      {
        name: '军火巨头',
        entries: [{ kind: '配方解锁', params: { recipe: '弹药卡' } } as never],
      },
    ]);
    expect(lines).toContain('形态定向：猫娘系列');
    expect(lines).toContain('已解锁配方：弹药卡');
  });

  it('无天赋 / 空列表 → 空数组（零 token）', async () => {
    expect(buildCraftBiasLines(undefined)).toEqual([]);
    expect(buildCraftBiasLines([])).toEqual([]);
  });
});

// ===== 已实装机制判定（2026-09-17：真机抽到「天生剑骨」零机制）=====

describe('hasWorkingMechanic / getDrawableCatalog', () => {
  it('空 entries 且无名字钩子 → 未实装（伪造模板，不绑具体天赋名）', () => {
    // 历史注记：这条的反例原本用「天生剑骨（东方）」，SS 收官时它已补上条目，
    // 改用伪造名——判定路径本身与具体天赋名无关。
    expect(hasWorkingMechanic({ name: '不存在的纯描述天赋', entries: [] } as never)).toBe(false);
  });

  it('仅含未落地条目（鉴定）→ 未实装', () => {
    // 战技附加 2026-09-17 已落地（entry-status.ts 是它的消费方），只剩「鉴定」是纯风味条目
    expect(IMPLEMENTED_ENTRY_KINDS.has('鉴定' as never)).toBe(false);
    expect(
      hasWorkingMechanic({
        name: 'x',
        entries: [{ kind: '鉴定', channel: 'universal', params: {} }],
      } as never),
    ).toBe(false);
  });

  it('含任一已实装条目 → 实装（混合情形也算）', () => {
    expect(
      hasWorkingMechanic({
        name: 'y',
        entries: [
          { kind: '鉴定', channel: 'universal', params: {} },
          { kind: '词条加权', channel: 'universal', params: { weight: 1 } },
        ],
      } as never),
    ).toBe(true);
  });

  it('抽卡池只含机制可用模板，且显著小于捏人全池', () => {
    const drawable = getDrawableCatalog();
    expect(drawable.length).toBeGreaterThan(0);
    expect(drawable.every((t) => hasWorkingMechanic(t))).toBe(true);
    // 「天生剑骨」SS 收官时已补条目，如今**应该在**抽卡池里（universal 源）
    expect(drawable.some((t) => t.name === '天生剑骨（东方）')).toBe(true);
  });

  it('名字钩子路径：条目为空但规则层挂了名字 → 也算已实装', () => {
    // 这三条的效果由 Code 直接算（talent-hooks 的登记表），与条目无关；
    // 只看条目会把它们误标「仅叙事」并踢出抽卡池。
    for (const name of ['世界线的收束点', '倒也可斩', '一拳超人系统']) {
      const tpl = getTalentTemplate(name);
      expect(tpl, name).toBeDefined();
      expect(tpl!.entries, `${name} 确实没有条目`).toEqual([]);
      expect(hasWorkingMechanic(tpl!), `${name} 应算已实装`).toBe(true);
    }
  });

  it('两条路径都对才不误判：伪造「没条目也没钩子」的模板仍是「仅叙事」', () => {
    // 历史注记：反例原用「天生剑骨（东方）」，SS 收官时它已补条目（46/46）。
    // 判定逻辑与具体名无关，用伪造模板保持这条反例的效力。
    const tpl = { name: '伪造的纯描述天赋', entries: [] } as never;
    expect(hasWorkingMechanic(tpl)).toBe(false);
  });

  it('SS 批次②：这 9 条已补机制，条目种类都是已实装通道', () => {
    // 判据不是「能抽到」而是「抽到有用」——所以断言具体通道，防止日后被改回纯描述。
    const 期望: Record<string, TalentEntryKind[]> = {
      因果炼金术: ['配方解锁'],
      最终解释权: ['叙事意图'],
      混沌理论: ['词条加权'],
      盗火者: ['越阶'],
      神级选项系统: ['叙事意图'],
      世界线变动系统: ['叙事意图'],
      剧本编写系统: ['叙事意图'],
      词条窃贼: ['吞噬'],
      '道法自然（东方）': ['词条加权', '叙事意图'],
    };
    for (const [name, kinds] of Object.entries(期望)) {
      const tpl = getTalentTemplate(name);
      expect(tpl, `${name} 应在目录内`).toBeDefined();
      expect(tpl!.grade).toBe('SS');
      expect(
        tpl!.entries.map((e) => e.kind),
        `${name} 的条目种类`,
      ).toEqual(kinds);
      expect(hasWorkingMechanic(tpl!), `${name} 应判定为已实装`).toBe(true);
      // 逐条过白名单门禁（AI 零编数同款）
      expect(validateTalentEntries(tpl!.entries).ok, `${name} 条目应过校验`).toBe(true);
    }
  });

  it('批次②的生成倾向上得了炼制提示词（词条加权/配方解锁有消费方）', () => {
    const lines = buildCraftBiasLines([
      { name: '混沌理论', entries: getTalentTemplate('混沌理论')!.entries },
      { name: '因果炼金术', entries: getTalentTemplate('因果炼金术')!.entries },
      { name: '道法自然（东方）', entries: getTalentTemplate('道法自然（东方）')!.entries },
    ]);
    expect(lines).toContain('词条倾向（倾向）：突变、紊乱');
    expect(lines).toContain('已解锁配方：幸运硬币/厄运护符');
    expect(lines).toContain('词条倾向（必附）：概念、道韵');
  });
});
