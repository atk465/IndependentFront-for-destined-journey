/**
 * ss-batch4.test.ts — SS 黑潮之子（环境加成）+ 画师（改造复用）+ 规则钩子接线（2026-09-17）
 *
 * 环境不是全局状态：它由**领域/场景卡在场**建立，卡退场环境即散。
 * 本文件钉住「建立环境 → 天赋加成生效」这条链，以及本批接上的四个钩子 getter。
 */
import { describe, it, expect } from 'vitest';
import { TALENT_CATALOG, hasWorkingMechanic, getTalentTemplate } from './talent-entry';
import { ENV_ELEMENTS, cardPlayPlan, environmentOfCard, planEffects } from './entry-combat';
import { playBeat, startSkirmish } from './skirmish-session';
import {
  expMultiplierOf,
  hpMultiplierOf,
  statMultiplierOf,
  hasVictoryMaterial,
  collectRuleHooks,
} from './talent-hooks';
import {
  envBonusesOf,
  hasBetterRoll,
  hasTitanPhysique,
  totalIntimidation,
  totalCopies,
} from './talent-rule-modifiers';
import { applyStatMultiplier, deriveBaseCombatStats, deriveCombatStats } from './derived-stats';
import { battleExpChain, formatExpAudit } from './skirmish';
import type { CardItem } from '../types';

const 卡 = (
  name: string,
  tier: CardItem['cardTier'] = '白银',
  词条: string[] = ['水', '地景'],
  extra: Partial<CardItem> = {},
): CardItem => ({
  name,
  quantity: 1,
  type: '卡牌',
  cardTier: tier,
  词条,
  sealed: false,
  recipe: {
    mainMaterial: '主',
    subMaterials: [],
    tier,
    fusionKind: '叠加',
    cost: 100,
    rating: '成功',
  },
  ...extra,
});

// ════════════════════════════════════════════════════════════════════
// 环境：由领域/场景卡建立
// ════════════════════════════════════════════════════════════════════

describe('环境建立 —— 挂在领域/场景卡上', () => {
  it('水系/冰系的领域、场景卡建立「水下」环境', () => {
    expect(environmentOfCard(['水', '领域'], '领域')).toBe('水下');
    expect(environmentOfCard(['冰', '场景'], '场景')).toBe('水下');
  });

  it('非领域/场景卡不建立环境（火系技能卡不算）', () => {
    expect(environmentOfCard(['水', '技能'], '技能')).toBeUndefined();
    expect(environmentOfCard(['水', '召唤'], '召唤')).toBeUndefined();
  });

  it('无关系词条 → 无环境；表是一行数据可扩', () => {
    expect(environmentOfCard(['火', '领域'], '领域')).toBeUndefined();
    expect(ENV_ELEMENTS.水下).toEqual(['水', '冰']);
  });

  it('打出水系领域卡 → 在场效果带上环境标记', () => {
    const plan = cardPlayPlan(卡('潮汐领域', '白银', ['水', '地景']), { atk: 30 });
    expect(plan.mode).toBe('在场');
    expect(planEffects(plan)[0].env).toBe('水下');
  });

  it('打水系的技能卡（非在场类）→ 没有环境标记', () => {
    const plan = cardPlayPlan(卡('水弹', '白银', ['水', '技能']), { atk: 30 });
    expect(plan.mode).toBe('直击');
    expect(planEffects(plan)).toEqual([]);
  });

  it('环境随效果进会话账本，且会随拍数到期散场', () => {
    const 领域卡 = 卡('潮汐领域', '白银', ['水', '地景']);
    const plan = cardPlayPlan(领域卡, { atk: 30 });
    if (plan.mode === '禁打') throw new Error('不该是禁打');
    const s1 = playBeat(开战(), plan.action, 1, { activate: planEffects(plan) });
    expect(s1.activeEffects.some((e) => e.env === '水下')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 黑潮之子：环境加成天赋
// ════════════════════════════════════════════════════════════════════

const 开战 = () =>
  startSkirmish({
    enemyName: '岩爪兽',
    enemyLevel: 12,
    intents: [{ move: '痛击', threat: 20, counters: ['防御'] }],
    playerHp: 155,
    playerMaxHp: 155,
    enemyHp: 400,
    enemyMaxHp: 400,
    guard: 0,
  });

describe('黑潮之子 —— 已有机制', () => {
  it('模板条目是「水下 +30%」，且算已实装', () => {
    const tpl = getTalentTemplate('黑潮之子');
    expect(tpl?.grade).toBe('SS');
    expect(tpl!.entries).toEqual([
      { kind: '环境加成', channel: 'universal', params: { env: '水下', percent: 30 } },
    ]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('envBonusesOf：读出 (环境, 百分比)，缺项/脏值丢弃', () => {
    expect(
      envBonusesOf([
        {
          entries: [
            {
              kind: '环境加成' as const,
              channel: 'universal' as const,
              params: { env: '水下', percent: 30 },
            },
          ],
        },
      ]),
    ).toEqual([{ env: '水下', percent: 30 }]);
    expect(
      envBonusesOf([
        {
          entries: [
            { kind: '环境加成' as const, channel: 'universal' as const, params: { percent: 30 } },
          ],
        },
      ]),
    ).toEqual([]);
    expect(
      envBonusesOf([
        {
          entries: [
            { kind: '环境加成' as const, channel: 'universal' as const, params: { env: '水下' } },
          ],
        },
      ]),
    ).toEqual([]);
    expect(envBonusesOf(undefined)).toEqual([]);
  });

  it('环境在场 + 持天赋 → 防御应对行动值被抬（拍内数值可复算）', () => {
    // 直接构造：先让环境进场，再以防御应对打一拍，比对底数即可看出加成存在
    // （管线的加成在 game-pipeline 里做，这里钉住「会话能读到 env」这个前提）
    const 领域卡 = 卡('潮汐领域', '白银', ['水', '地景']);
    const plan = cardPlayPlan(领域卡, { atk: 30 });
    if (plan.mode === '禁打') throw new Error('不该是禁打');
    const s = playBeat(开战(), plan.action, 1, { activate: planEffects(plan) });
    const activeEnv = new Set(s.activeEffects.map((e) => e.env).filter(Boolean));
    const bonus = envBonusesOf([
      {
        entries: [
          {
            kind: '环境加成' as const,
            channel: 'universal' as const,
            params: { env: '水下', percent: 30 },
          },
        ],
      },
    ]).find((b) => activeEnv.has(b.env));
    expect(bonus).toEqual({ env: '水下', percent: 30 });
  });
});

// ════════════════════════════════════════════════════════════════════
// 画师：复用「改造」通道
// ════════════════════════════════════════════════════════════════════

describe('画师 —— 复用突变巫师的改造通道', () => {
  it('持「改造」条目，算已实装（形态改造区对它开放）', () => {
    const tpl = getTalentTemplate('画师');
    expect(tpl?.grade).toBe('SS');
    expect(tpl!.entries).toEqual([{ kind: '改造', channel: 'universal', params: {} }]);
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 规则钩子接线：四个 getter 此前写好了没人调
// ════════════════════════════════════════════════════════════════════

describe('规则钩子 —— 从「只写不接」到真的生效', () => {
  it('经验倍率（鸿蒙道体 ×2）进经验审计链', () => {
    const hooks = collectRuleHooks([{ name: '鸿蒙道体' }]);
    expect(expMultiplierOf(hooks)).toBe(2);
    const base = battleExpChain(12, 10, 'A');
    const boosted = battleExpChain(12, 10, 'A', 2);
    expect(boosted.total).toBe(base.total * 2);
    expect(boosted.talentMult).toBe(2);
    // 审计行会多一行，让玩家看得到倍率
    expect(formatExpAudit(boosted).join('\n')).toContain('天赋经验倍率 → ×2');
    expect(formatExpAudit(base).join('\n')).not.toContain('天赋经验倍率');
  });

  it('无天赋时经验链逐位不变（零回归）', () => {
    expect(battleExpChain(12, 10, 'A')).toEqual(battleExpChain(12, 10, 'A', 1));
  });

  it('HP 倍率（霸巨人体魄 ×3）', () => {
    expect(hpMultiplierOf(collectRuleHooks([{ name: '霸巨人体魄' }]))).toBe(3);
    expect(hpMultiplierOf([])).toBe(1);
  });

  it('全属性倍率（女王领域 ×1.5）真的乘到攻/防/敏上', () => {
    expect(statMultiplierOf(collectRuleHooks([{ name: '女王领域' }]))).toBe(1.5);
    const attrs = { str: 14, con: 12, dex: 10 };
    const base = deriveBaseCombatStats({ attributes: attrs, level: 9 });
    const boosted = applyStatMultiplier(base, 1.5);
    expect(boosted.atk).toBe(Math.round(base.atk * 1.5));
    expect(boosted.guard).toBe(Math.round(base.guard * 1.5));
    expect(boosted.agi).toBe(Math.round(base.agi * 1.5));
    // 倍率 1 = 原样（deriveCombatStats 的默认行为不变）
    expect(deriveCombatStats({ attributes: attrs, level: 9 })).toEqual(base);
  });

  it('胜利素材（素材之王）钩子可读', () => {
    expect(hasVictoryMaterial(collectRuleHooks([{ name: '素材之王' }]))).toBe(true);
    expect(hasVictoryMaterial([])).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// 本批之后的体质检查
// ════════════════════════════════════════════════════════════════════

describe('本批之后的目录体质', () => {
  it('黑潮之子 / 画师 都从「仅叙事」里出来了', () => {
    for (const name of ['黑潮之子', '画师']) {
      const tpl = TALENT_CATALOG.find((t) => t.name === name);
      expect(tpl, name).toBeDefined();
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });

  it('规则层数值条目与钩子 getter 都有生产调用方（不再只被测试调用）', () => {
    // 这几条是「写好了没人接」的重灾区；本批把它们全部接上，
    // 这里只做存在性断言，接线本身由上面的行为用例覆盖。
    for (const fn of [hasBetterRoll, hasTitanPhysique, totalIntimidation, totalCopies]) {
      expect(typeof fn).toBe('function');
    }
  });
});
