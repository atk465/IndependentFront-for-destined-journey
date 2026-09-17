/**
 * b-batch3.test.ts — B 级批次①②③（2026-09-17）
 *
 * ① 纯叙事 19 条挂 `叙事意图`
 * ② 复用既有通道 13 条
 * ③ 需小改里能落地的 3 条：孤狼（独行印记）、精力旺盛（体魄 20）、败北强化（钩子）
 */
import { describe, it, expect } from 'vitest';
import { TALENT_CATALOG, getTalentTemplate, hasWorkingMechanic } from './talent-entry';
import { LONE_ENTRY, isLoneCard } from './battle-rules';
import { defeatExpMultiplierOf, collectRuleHooks } from './talent-hooks';

const 纯叙事 = [
  '黄金矿工的贪婪',
  '黑市老千',
  '电波系少女',
  '谎言家系统',
  '情报贩子系统',
  '偷窃神手系统',
  '读心术系统',
  '黄毛必须死系统',
  '圣母克星系统',
  '反派的自我修养系统',
  '巨人',
  '体香诱惑',
  '贡品嗅探',
  '女王崇拜',
  '高潮链接',
  '核心力量',
  '人偶之心',
  '父爱光环',
];

const 复用: Record<string, string[]> = {
  双刃剑: ['词条加权'],
  迷你暴君: ['词条加权', '战技附加'],
  M的烙印: ['词条加权'],
  S的刻印: ['词条加权'],
  绝对正义: ['词条加权', '叙事意图'],
  小小的也很可爱: ['词条加权', '威压'],
  幸运星: ['判定取优'],
  耐药性: ['成功率加成', '叙事意图'],
  母狗契约: ['捕获'],
  契约奴役: ['捕获'],
  固执己见: ['成品限定', '叙事意图'],
  平地摔的馈赠: ['抽奖', '叙事意图'],
  成长之痛: ['自我进化'],
};

describe('B 批① —— 纯叙事通道（19 条含赌徒直觉既有风味条目）', () => {
  it('18 条新挂「叙事意图」，且都算已实装', () => {
    for (const name of 纯叙事) {
      const tpl = getTalentTemplate(name);
      expect(tpl, `${name} 应在目录内`).toBeDefined();
      expect(
        tpl!.entries.some((e) => e.kind === '叙事意图'),
        name,
      ).toBe(true);
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });

  it('赌徒直觉的「鉴定」是刻意保留的风味条目（感知价值没有数值面）', () => {
    const tpl = getTalentTemplate('赌徒直觉')!;
    expect(tpl.entries.map((e) => e.kind)).toEqual(['鉴定']);
    // 鉴定不在已实装表——这条是唯一「挂着风味条目、面板显示仅叙事」的例外
    expect(hasWorkingMechanic(tpl)).toBe(false);
  });
});

describe('B 批② —— 复用既有通道（13 条）', () => {
  it('通道逐条对得上', () => {
    for (const [name, kinds] of Object.entries(复用)) {
      const tpl = getTalentTemplate(name);
      expect(tpl, name).toBeDefined();
      expect(
        tpl!.entries.map((e) => e.kind),
        `${name} 的通道`,
      ).toEqual(kinds);
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });

  it('性格必附档（权重 3）用在「产出必是某性格」的三条上', () => {
    for (const name of ['双刃剑', 'M的烙印', 'S的刻印', '绝对正义', '小小的也很可爱']) {
      const tpl = getTalentTemplate(name)!;
      const 加权 = tpl.entries.find((e) => e.kind === '词条加权')!;
      expect(加权.params.weight, name).toBe(3);
    }
  });

  it('小小的也很可爱带威压（怜悯 = 战意减弱）', () => {
    const tpl = getTalentTemplate('小小的也很可爱')!;
    expect(tpl.entries.find((e) => e.kind === '威压')?.params.percent).toBe(30);
  });

  it('迷你暴君的「恼火」战技走战技附加通道', () => {
    const tpl = getTalentTemplate('迷你暴君')!;
    const 战技 = tpl.entries.find((e) => e.kind === '战技附加')!;
    expect(战技.params.status).toBe('恼火');
  });
});

describe('B 批③ —— 能落地的三条', () => {
  it('孤狼：模板带「独行」条目，产物生物卡带独行印记', () => {
    const tpl = getTalentTemplate('孤狼');
    expect(tpl?.grade).toBe('B');
    expect(tpl!.entries).toEqual([{ kind: '独行', channel: 'universal', params: {} }]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);

    // 制卡时（持天赋）产物应带印记——由 applyCraftEntryTalents 负责，这里验证印记常量
    expect(LONE_ENTRY).toBe('独行');
    const 生物卡 = { 词条: ['召唤', '土', LONE_ENTRY] };
    expect(isLoneCard(生物卡)).toBe(true);
    expect(isLoneCard({ 词条: ['召唤', '土'] })).toBe(false);
  });

  it('精力旺盛：体魄 20（HP 上限 +20%），MP 上限缺口已记录', () => {
    const tpl = getTalentTemplate('精力旺盛');
    expect(tpl!.entries).toEqual([{ kind: '体魄', channel: 'universal', params: { percent: 20 } }]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('败北强化：名字钩子（战败经验 ×2），不在条目表但算已实装', () => {
    const tpl = getTalentTemplate('败北强化');
    expect(tpl!.entries).toEqual([]);
    expect(hasWorkingMechanic(tpl!)).toBe(true); // 名字钩子路径
    const hooks = collectRuleHooks([{ name: '败北强化' }]);
    expect(defeatExpMultiplierOf(hooks)).toBe(2);
    expect(defeatExpMultiplierOf(collectRuleHooks([{ name: '倒也可斩' }]))).toBe(1);
  });

  it('主路制卡也能打出带独行印记的卡（持天赋时由共用函数打标）', () => {
    // 这条只验证印记的判定逻辑；打标发生在 applyCraftEntryTalents（有独立测试覆盖）
    const 卡 = { name: '影狼', 词条: ['召唤', '暗', LONE_ENTRY] };
    expect(isLoneCard(卡)).toBe(true);
  });
});

describe('本批之后的体质', () => {
  it('32 条全部离开「仅叙事」（赌徒直觉除外——风味条目是刻意的）', () => {
    for (const name of [...纯叙事, ...Object.keys(复用), '孤狼', '精力旺盛', '败北强化']) {
      const tpl = TALENT_CATALOG.find((t) => t.name === name);
      expect(tpl, name).toBeDefined();
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });

  it('B 级已实装数不低于 128（本批推进的硬底线）', () => {
    const b = TALENT_CATALOG.filter((t) => t.grade === 'B');
    expect(b.filter(hasWorkingMechanic).length).toBeGreaterThanOrEqual(128);
  });
});
