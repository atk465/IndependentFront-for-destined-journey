/**
 * d-batch1.test.ts — D 级全量落地（2026-09-18，52+19 = 71/71）
 *
 * ① 纯风味/叙事 + ② 复用既有通道 + ②续（配方解锁批量 + 剩余叙事）
 *
 * D 级「二手专家」教训：`鉴定` 是风味条目（无消费方），单挂它的天赋
 * 仍会被判「仅叙事」——已补叙事意图。测试钉住这个例外。
 */
import { describe, it, expect } from 'vitest';
import { TALENT_CATALOG, getTalentTemplate, hasWorkingMechanic } from './talent-entry';

describe('D 级 —— 全量 71/71', () => {
  it('SS 收官时已实装的 4 条 + 本批 67 条 = 全覆盖', () => {
    const d = TALENT_CATALOG.filter((t) => t.grade === 'D');
    expect(d.filter(hasWorkingMechanic).length).toBe(d.length);
    expect(d.length).toBe(71);
  });

  it('配方解锁批量：五条「获得 XX 制作方法」都走配方解锁', () => {
    const 期望: Record<string, string> = {
      捆绑初学者: '束缚绳',
      滑溜溜: '体液地雷',
      羞耻回响: '嘲讽胖次',
      失语之咒: '淫语诅咒',
      恋物癖之心: '原味收集',
    };
    for (const [name, recipe] of Object.entries(期望)) {
      const tpl = getTalentTemplate(name);
      expect(tpl, name).toBeDefined();
      expect(
        tpl!.entries.some((e) => e.kind === '配方解锁'),
        name,
      ).toBe(true);
      expect(
        tpl!.entries.some((e) => e.kind === '配方解锁' && e.params.recipe === recipe),
        `${name} 的配方名`,
      ).toBe(true);
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
    // 捆绑初学者另有成功率 100（描述明说「百分百成功」）
    const 捆绑 = getTalentTemplate('捆绑初学者')!;
    expect(捆绑.entries.some((e) => e.kind === '成功率加成' && e.params.bonus === 100)).toBe(true);
  });

  it('复用通道的档位锚点（抽查低配档）', () => {
    expect(getTalentTemplate('完美主义')!.entries[0].params).toEqual({ bonus: 20 });
    expect(getTalentTemplate('不稳定化合物')!.entries[0].params).toEqual({ risk: 20 });
    expect(getTalentTemplate('腐败之触')!.entries[0].params).toEqual({
      status: '中毒',
      power: 2,
      beats: 2,
    });
    expect(getTalentTemplate('高人一等')!.entries[0].params).toEqual({ crushPct: 20 }); // C 级② 低配档
  });

  it('鉴定 + 第二通道：赌徒直觉 / 二手专家 / 鲨鱼嗅觉 / 龙涎香鉴定师 全部已实装', () => {
    // 鉴定本身是风味条目（无消费方），但这四条都有第二通道（叙事意图等）
    for (const name of ['赌徒直觉', '二手专家', '鲨鱼嗅觉', '龙涎香鉴定师']) {
      const tpl = getTalentTemplate(name)!;
      expect(
        tpl.entries.some((e) => e.kind === '鉴定'),
        name,
      ).toBe(true);
      expect(tpl.entries.length, name + ' 应有第二通道').toBeGreaterThan(1);
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });

  it('性格/外观必附档（权重 3）用在「产出必是某性格/外观」的口味系上', () => {
    const 口味系 = [
      '辣妹养成',
      '触手共鸣',
      '酒鬼的诞生',
      '无口之声',
      '元气注入',
      '丝袜即是正义',
      '姐姐的呼唤',
      '扁平化设计',
    ];
    for (const name of 口味系) {
      const tpl = getTalentTemplate(name)!;
      const 加权 = tpl.entries.find((e) => e.kind === '词条加权')!;
      expect(加权.params.weight, name).toBe(3);
    }
  });

  it('环境/生存叙事条全部有「叙事意图」', () => {
    for (const name of [
      '荒漠行者',
      '黄沙迷彩',
      '森林向导',
      '沼泽适应',
      '耐寒',
      '耐热',
      '凛冬冬眠',
    ]) {
      const tpl = getTalentTemplate(name)!;
      expect(
        tpl.entries.some((e) => e.kind === '叙事意图'),
        name,
      ).toBe(true);
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });
});
