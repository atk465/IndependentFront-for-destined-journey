/**
 * c-batch1.test.ts — C 级批次①②③（2026-09-18）
 *
 * ① 纯风味/纯叙事 24 条挂 `叙事意图`
 * ② 复用既有通道 14 条
 * ③ 已有维度的新消费者 3 条（雪天环境 ×2、骑乘近似 ×1）
 */
import { describe, it, expect } from 'vitest';
import { ENV_ELEMENTS } from './entry-combat';
import { getTalentTemplate, hasWorkingMechanic, TALENT_CATALOG } from './talent-entry';

const 纯叙事 = [
  '扑克脸',
  '酒馆艳遇体质',
  '仙人掌绿洲',
  '极寒凝视',
  '冰渊垂钓者',
  '冰原雪橇犬',
  '天然呆',
  '艺术家',
  '足模的骄傲',
  '深度睡眠系统',
  '地图全开系统',
  '奇迹暖暖系统',
  '活体工具',
  '武者的荣耀',
  '赌徒的狂热',
  '足下臣服',
  '夜视能力',
  '自我发电',
  '无限精液',
  '食雪者',
  '海怪之胃',
  '硝烟催情药',
  '劣酒豪客',
  '蜜酒豪饮者',
];

const 复用: Record<string, string[]> = {
  讨价还价: ['叙事意图'],
  精准投掷: ['成功率加成'],
  心灵手巧: ['成功率加成'],
  健美体魄: ['体魄'],
  坚韧之躯: ['叙事意图'],
  垃圾佬系统: ['拆解', '叙事意图'],
  开源精神: ['模块化'],
  怪力少女: ['词条加权'],
  重武器亲和: ['词条加权'],
  高人一等: ['体型压制'],
  龙涎香鉴定师: ['鉴定', '击杀掠取'],
  鲨鱼嗅觉: ['鉴定', '叙事意图'],
  M体质: ['狂化'],
  薛定谔的成功: ['叙事意图'],
};

describe('C 批① —— 纯风味/纯叙事通道（24 条）', () => {
  it('全部挂「叙事意图」，且都算已实装', () => {
    for (const name of 纯叙事) {
      const tpl = getTalentTemplate(name);
      expect(tpl, `${name} 应在目录内`).toBeDefined();
      expect(
        tpl!.entries.map((e) => e.kind),
        name,
      ).toEqual(['叙事意图']);
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });

  it('艺术家是「明说无加成」的风味——挂叙事意图符合其本意', () => {
    expect(getTalentTemplate('艺术家')!.description).toContain('没有任何实际加成');
  });
});

describe('C 批② —— 复用既有通道（14 条）', () => {
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

  it('M 体质用狂化低配档（×1.5）——档位白名单已扩', () => {
    const tpl = getTalentTemplate('M体质')!;
    expect(tpl.entries[0].params).toEqual({ rageMult: 1.5 });
  });

  it('必附档（权重 3）用在「纤细却力大无穷」和「重装无惩罚」上', () => {
    for (const name of ['怪力少女', '重武器亲和']) {
      const tpl = getTalentTemplate(name)!;
      const 加权 = tpl.entries.find((e) => e.kind === '词条加权')!;
      expect(加权.params.weight, name).toBe(3);
    }
  });

  it('高人一等走体型压制低配档（20%）', () => {
    const tpl = getTalentTemplate('高人一等')!;
    expect(tpl.entries[0].params).toEqual({ crushPct: 20 });
  });
});

describe('C 批③ —— 已有维度的新消费者', () => {
  it('环境表有「雪天」了（冰词条建立）', () => {
    expect(ENV_ELEMENTS['雪天']).toEqual(['冰']);
    // 水下不受影响（黑潮之子/深渊之瞳还在）
    expect(ENV_ELEMENTS['水下']).toEqual(['水', '冰']);
  });

  it('冰霜之子 / 海象皮脂肪：雪天环境 +20% + 叙事', () => {
    for (const name of ['冰霜之子', '海象皮脂肪']) {
      const tpl = getTalentTemplate(name)!;
      expect(
        tpl.entries.map((e) => e.kind),
        name,
      ).toEqual(['环境加成', '叙事意图']);
      expect(tpl.entries[0].params, name).toEqual({ env: '雪天', percent: 20 });
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });

  it('人马一体：骑乘近似（卡组有伙伴 +10%）+ 叙事', () => {
    const tpl = getTalentTemplate('人马一体')!;
    expect(tpl.entries.map((e) => e.kind)).toEqual(['条件加成', '叙事意图']);
    expect(tpl.entries[0].params).toEqual({
      cond: '伙伴卡数',
      threshold: 1,
      percent: 10,
      perExtra: 0,
    });
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });
});

describe('本批之后的体质', () => {
  it('41 条全部离开「仅叙事」', () => {
    for (const name of [...纯叙事, ...Object.keys(复用), '冰霜之子', '海象皮脂肪', '人马一体']) {
      const tpl = TALENT_CATALOG.find((t) => t.name === name);
      expect(tpl, name).toBeDefined();
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });

  it('C 级已实装数不低于 106（本批推进的硬底线）', () => {
    const c = TALENT_CATALOG.filter((t) => t.grade === 'C');
    expect(c.filter(hasWorkingMechanic).length).toBeGreaterThanOrEqual(106);
  });
});
