/**
 * s-batch1.test.ts — S 级第一批：7 条直接复用 + 素材点金 + 一拳超人（2026-09-17）
 *
 * 两件事：
 * 1. ① 那 7 条 S（吞噬之口/堕落圣女/魅魔体质/痛苦引擎/奇迹卷轴/剧透者系统/flag?）
 *    全部补上**已实装**通道的条目——零引擎改动。
 * 2. 「每日账本」地基的两个真实消费者：素材点金（S）与一拳超人系统（SS）。
 */
import { describe, it, expect } from 'vitest';
import { TALENT_CATALOG, getTalentTemplate, hasWorkingMechanic } from './talent-entry';
import { planRarityUpgrade } from './material';
import { RARITY_LEVELS, type Rarity } from '../field-enums';
import {
  DAILY_NUKE_WEAKNESS,
  collectRuleHooks,
  dailyNukePercentOf,
  hasOncePerBattleNuke,
} from './talent-hooks';

// ════════════════════════════════════════════════════════════════════
// ① 7 条直接复用
// ════════════════════════════════════════════════════════════════════

describe('S 批次① —— 复用现有通道的 7 条', () => {
  /** 天赋名 → 期望的条目种类序列（钉住复用哪个通道，防止日后被改回纯描述） */
  const 期望: Record<string, string[]> = {
    吞噬之口: ['吞噬'],
    堕落圣女: ['捕获'],
    魅魔体质: ['欲望主导'],
    痛苦引擎: ['品质突破'],
    奇迹卷轴: ['成品限定', '品质突破'],
    剧透者系统: ['叙事意图'],
    'flag?': ['叙事意图'],
  };

  it('7 条都补了条目、都算已实装、都过白名单校验', () => {
    for (const [name, kinds] of Object.entries(期望)) {
      const tpl = getTalentTemplate(name);
      expect(tpl, `${name} 应在目录内`).toBeDefined();
      expect(tpl!.grade).toBe('S');
      expect(
        tpl!.entries.map((e) => e.kind),
        `${name} 的通道`,
      ).toEqual(kinds);
      expect(hasWorkingMechanic(tpl!), `${name} 应算已实装`).toBe(true);
    }
  });

  it('复用通道的具体形态可复算', () => {
    const 奇迹卷轴 = getTalentTemplate('奇迹卷轴')!;
    expect(奇迹卷轴.entries[0].params.productClass).toBe('卷轴');
    expect(奇迹卷轴.entries[1].params.productClass).toBe('卷轴');
    const 痛苦引擎 = getTalentTemplate('痛苦引擎')!;
    expect(痛苦引擎.entries[0].params.productClass).toBe('痛苦淬炼');
  });

  it('复用不引入「重复授权」：两条天赋共用同一通道是设计意图', () => {
    // 吞噬之口（S）与吞噬一切（SSS）共用 `吞噬`；掠夺的是同一台台面
    const 吞噬之口 = getTalentTemplate('吞噬之口')!;
    const 吞噬一切 = TALENT_CATALOG.find((t) => t.name === '吞噬一切');
    expect(吞噬一切).toBeDefined();
    expect(吞噬之口.entries[0].kind).toBe(吞噬一切!.entries[0].kind);
  });
});

// ════════════════════════════════════════════════════════════════════
// 素材点金（S）：每日账本的首个消费者
// ════════════════════════════════════════════════════════════════════

describe('素材点金 —— planRarityUpgrade', () => {
  const 素材 = (rarity: Rarity) => ({ name: '火晶', type: '材料' as const, rarity });

  it('品质升一大档', () => {
    const r = planRarityUpgrade(素材('普通'), 1);
    expect(r.ok).toBe(true);
    expect(r.plan!.from).toBe('普通');
    expect(r.plan!.to).toBe('优良');
    expect(r.plan!.steps).toBe(1);
    expect(r.plan!.summary).toContain('普通 → 优良');
  });

  it('档数可调（tierGain）', () => {
    expect(planRarityUpgrade(素材('普通'), 2).plan!.to).toBe('稀有');
  });

  it('封顶不越界：到顶拒绝（不静默吞掉一次每日机会）', () => {
    const top = RARITY_LEVELS[RARITY_LEVELS.length - 1];
    const r = planRarityUpgrade(素材(top), 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('最高品质');
  });

  it('近顶时只升到顶，steps 反映实际档数', () => {
    const second = RARITY_LEVELS[RARITY_LEVELS.length - 2];
    const r = planRarityUpgrade(素材(second), 2);
    expect(r.ok).toBe(true);
    expect(r.plan!.steps).toBe(1);
    expect(r.plan!.to).toBe(RARITY_LEVELS[RARITY_LEVELS.length - 1]);
  });

  it('只吃素材：卡牌/装备不给点（各自的成长走各自通道）', () => {
    expect(planRarityUpgrade({ name: '某卡', type: '卡牌', rarity: '普通' as Rarity }, 1).ok).toBe(
      false,
    );
    expect(planRarityUpgrade({ name: '某剑', type: '装备', rarity: '普通' as Rarity }, 1).ok).toBe(
      false,
    );
  });

  it('脏 rarity → 按「普通」起算（不抛）', () => {
    expect(
      planRarityUpgrade({ name: 'x', type: '材料', rarity: '不存在' as Rarity }, 1).plan!.to,
    ).toBe('优良');
  });
});

describe('素材点金 —— 模板与档位', () => {
  it('模板条目带 tierGain/perDay，且算已实装', () => {
    const tpl = getTalentTemplate('素材点金');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries).toEqual([
      { kind: '点金', channel: 'universal', params: { tierGain: 1, perDay: 1 } },
    ]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 一拳超人系统（SS）：每日账本的第二个消费者
// ════════════════════════════════════════════════════════════════════

describe('一拳超人系统 —— 每日一击', () => {
  it('每日一击钩子可读（缺省档位 80%）', () => {
    const hooks = collectRuleHooks([{ name: '一拳超人系统' }]);
    expect(dailyNukePercentOf(hooks)).toBe(80);
    // 与「倒也可斩」不同的钩子种类——限次口径不同（每日 vs 每场）
    expect(hasOncePerBattleNuke(hooks)).toBe(false);
  });

  it('无该天赋 → 0（不生效）', () => {
    expect(dailyNukePercentOf([])).toBe(0);
    expect(dailyNukePercentOf(collectRuleHooks([{ name: '倒也可斩' }]))).toBe(0);
  });

  it('出手后的虚弱系数是明确的常量', () => {
    expect(DAILY_NUKE_WEAKNESS).toBe(0.5);
  });

  it('两条大招天赋各走各的口径：只有一拳超人有每日钩子', () => {
    const 一拳 = collectRuleHooks([{ name: '一拳超人系统' }]);
    const 倒也可斩 = collectRuleHooks([{ name: '倒也可斩' }]);
    expect(dailyNukePercentOf(一拳)).toBeGreaterThan(0);
    expect(hasOncePerBattleNuke(一拳)).toBe(false);
    expect(dailyNukePercentOf(倒也可斩)).toBe(0);
    expect(hasOncePerBattleNuke(倒也可斩)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 体质检查
// ════════════════════════════════════════════════════════════════════

describe('S 级本批之后的体质', () => {
  it('7 条 + 素材点金全部离开「仅叙事」', () => {
    for (const name of [
      '吞噬之口',
      '堕落圣女',
      '魅魔体质',
      '痛苦引擎',
      '奇迹卷轴',
      '剧透者系统',
      'flag?',
      '素材点金',
    ]) {
      const tpl = TALENT_CATALOG.find((t) => t.name === name);
      expect(tpl, name).toBeDefined();
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });
});
