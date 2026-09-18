/**
 * a-batch1.test.ts — A 级批次①②（2026-09-17）
 *
 * ① 纯叙事（`叙事意图`）：改变的是「世界怎么回应你」，不是任何数值。
 * ② 复用既有通道：本来就该由已有机制承接，只是条目一直空着。
 *
 * 共 33 条。测试逐条钉住**用了哪个通道**——防的不是「今天不生效」，
 * 而是「日后被谁改回纯描述」或「被挂到错误的通道上」。
 */
import { describe, it, expect } from 'vitest';
import { TALENT_CATALOG, getTalentTemplate, hasWorkingMechanic } from './talent-entry';

/** ① 纯叙事：挂 `叙事意图` 的 17 条 */
const 纯叙事 = [
  '群星的回想',
  '这他妈就离谱！',
  '反派洗白系统',
  '催眠大师系统',
  '催眠之瞳',
  '人偶师之线',
  '神之右手系统',
  '替身之力',
  '反间计',
  '哲学家',
  '万物图鉴系统',
  '任务发布系统',
  '献祭系统',
  '卡牌附身',
  '财务榨取',
  '深渊之瞳',
];

/** ② 复用既有通道：16 条（含补漏的天妒英才） */
const 复用: Record<string, string[]> = {
  每日签到系统: ['抽奖'],
  等价交换系统: ['置换'],
  卡牌美食家: ['拆解'],
  贪婪系统: ['击杀掠取'],
  BOSS首杀系统: ['击杀掠取'],
  神匠之手: ['成品限定', '品质突破'],
  共鸣之躯: ['词条加权'],
  灵魂低语者: ['成功率加成'],
  '魔种寄生（东方）': ['欲望主导'],
  邀月对饮: ['剥离'],
  童话编织者: ['配方解锁'],
  模仿者: ['吞噬'],
  军团之主: ['成品限定', '词条加权'],
  寒蝉的鸣泣: ['成品限定', '词条加权'],
  傲慢无礼: ['成品限定', '叙事意图'],
  天妒英才: ['成品限定', '词条加权'],
};

describe('A 批① —— 纯叙事通道', () => {
  it('17 条都挂了「叙事意图」，且都算已实装', () => {
    for (const name of 纯叙事) {
      const tpl = getTalentTemplate(name);
      expect(tpl, `${name} 应在目录内`).toBeDefined();
      expect(tpl!.grade, name).toBe('A');
      expect(
        tpl!.entries.some((e) => e.kind === '叙事意图'),
        `${name} 应有叙事意图条目`,
      ).toBe(true);
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });

  it('纯叙事不是「没实装」——但也确实没给数值（这是刻意的）', () => {
    for (const name of 纯叙事) {
      const tpl = getTalentTemplate(name)!;
      // 逐条只允许「叙事意图」（深渊之瞳另带环境加成，见下）
      const kinds = tpl.entries.map((e) => e.kind);
      if (name === '深渊之瞳') continue;
      expect(kinds, name).toEqual(['叙事意图']);
    }
  });
});

describe('A 批② —— 复用既有通道', () => {
  it('16 条挂的通道逐条对得上', () => {
    for (const [name, kinds] of Object.entries(复用)) {
      const tpl = getTalentTemplate(name);
      expect(tpl, `${name} 应在目录内`).toBeDefined();
      expect(
        tpl!.entries.map((e) => e.kind),
        `${name} 的通道`,
      ).toEqual(kinds);
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });

  it('每日签到用单抽档（times:1）——与素材十连共用抽奖内核', () => {
    const tpl = getTalentTemplate('每日签到系统')!;
    expect(tpl.entries[0].params).toEqual({ times: 1, perDay: 1 });
  });

  it('深渊之瞳复用「环境加成」（水下），环境由领域/场景卡建立', () => {
    const tpl = getTalentTemplate('深渊之瞳')!;
    expect(tpl.entries.map((e) => e.kind)).toEqual(['环境加成', '叙事意图']);
    expect(tpl.entries[0].params).toEqual({ env: '水下', percent: 20 });
  });

  it('神匠之手 / 傲慢无礼的成品限定都指向「装备」', () => {
    for (const name of ['神匠之手', '傲慢无礼']) {
      const tpl = getTalentTemplate(name)!;
      const 限定 = tpl.entries.find((e) => e.kind === '成品限定')!;
      expect(限定.params.productClass, name).toBe('装备');
    }
  });

  it('必附档（权重 3）用在「每张卡都必须带」的那两条上', () => {
    for (const name of ['共鸣之躯', '天妒英才']) {
      const tpl = getTalentTemplate(name)!;
      const 加权 = tpl.entries.find((e) => e.kind === '词条加权')!;
      expect(加权.params.weight, name).toBe(3);
      expect((加权.params.keywords ?? []).length, name).toBeGreaterThan(0);
    }
  });
});

describe('本批之后的体质', () => {
  it('33 条全部离开「仅叙事」', () => {
    for (const name of [...纯叙事, ...Object.keys(复用)]) {
      const tpl = TALENT_CATALOG.find((t) => t.name === name);
      expect(tpl, name).toBeDefined();
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });

  it('A 级已实装数不低于 108（本批推进的硬底线）', () => {
    const a = TALENT_CATALOG.filter((t) => t.grade === 'A');
    const ok = a.filter(hasWorkingMechanic).length;
    expect(ok).toBeGreaterThanOrEqual(108);
  });
});
