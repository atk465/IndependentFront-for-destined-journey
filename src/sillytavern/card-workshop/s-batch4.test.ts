/**
 * s-batch4.test.ts — 战斗规则改写 / 身后灵 / 献祭召唤 / 双生羁绊（2026-09-17）
 *
 * 四条新管道：
 * 1. **战斗规则改写**：懒惰天才（拍内摸鱼/暴击）、西部决斗礼仪（1v1 规则）
 * 2. **身后灵**（瓦尔哈拉的门票）：卡退场 → 永久守护
 * 3. **献祭召唤**（召唤媒介系统）：献祭 HP 换数拍助战
 * 4. **双生羁绊**：两张伙伴卡先后打出 → 组合技
 */
import { describe, it, expect } from 'vitest';
import {
  LAZY_ENTRY,
  TWIN_ENTRY,
  areTwins,
  coerceTwinBonds,
  duelBlocksCard,
  duelSuppressesEffect,
  isLazyCard,
  resolveLazyCard,
  resolveTwinCombo,
  twinOf,
} from './battle-rules';
import { addSpirit, coerceSpirits, describeSpirits } from './behind-spirits';
import { playBeat, startSkirmish } from './skirmish-session';
import { getTalentTemplate, hasWorkingMechanic, TALENT_CATALOG } from './talent-entry';
import type { CardItem } from '../types';

const 卡 = (name: string, 词条: string[], tier: CardItem['cardTier'] = '白银'): CardItem => ({
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
});

// ════════════════════════════════════════════════════════════════════
// 1a. 懒惰天才
// ════════════════════════════════════════════════════════════════════

describe('懒惰天才 —— 摸鱼与暴击', () => {
  const 懒卡 = 卡('懒兽', ['召唤', '土', LAZY_ENTRY]);
  const 常卡 = 卡('勤兽', ['召唤', '土']);

  it('只认带印记的卡（词条即单一真源）', () => {
    expect(isLazyCard(懒卡)).toBe(true);
    expect(isLazyCard(常卡)).toBe(false);
  });

  it('不带印记的卡原样返回「正常」', () => {
    const out = resolveLazyCard(常卡, 40, 1);
    expect(out.kind).toBe('正常');
    expect(out.power).toBe(40);
  });

  it('骰值落在摸鱼区间 → 行动值 0', () => {
    const out = resolveLazyCard(懒卡, 40, 1);
    expect(out.kind).toBe('摸鱼');
    expect(out.power).toBe(0);
    expect(out.note).toContain('懒惰');
  });

  it('骰值越过摸鱼线 → 暴击翻倍', () => {
    const out = resolveLazyCard(懒卡, 40, 100);
    expect(out.kind).toBe('暴击');
    expect(out.power).toBe(80);
  });

  it('档位可调（skipPct / critMult 走条目）', () => {
    // skipPct=0 → 永不摸鱼；critMult=3 → ×3
    expect(resolveLazyCard(懒卡, 10, 1, { skipPct: 0, critMult: 3 }).power).toBe(30);
    // skipPct=100 → 恒摸鱼
    expect(resolveLazyCard(懒卡, 10, 100, { skipPct: 100, critMult: 3 }).power).toBe(0);
  });

  it('边界：骰值等于摸鱼线算摸鱼（≤）', () => {
    expect(resolveLazyCard(懒卡, 10, 50, { skipPct: 50, critMult: 2 }).kind).toBe('摸鱼');
    expect(resolveLazyCard(懒卡, 10, 51, { skipPct: 50, critMult: 2 }).kind).toBe('暴击');
  });

  it('脏骰值按最坏算（不抛）', () => {
    expect(resolveLazyCard(懒卡, 10, NaN).kind).toBe('暴击'); // NaN → 100
    expect(resolveLazyCard(懒卡, 10, -5).kind).toBe('摸鱼'); // 夹到 1
  });
});

// ════════════════════════════════════════════════════════════════════
// 1b. 西部决斗礼仪
// ════════════════════════════════════════════════════════════════════

describe('西部决斗礼仪 —— 1v1 规则', () => {
  const 规则 = { noCompanion: true };

  it('伙伴卡（召唤/军团）被挡在场外', () => {
    expect(duelBlocksCard(卡('伙伴', ['召唤', '土']), 规则).blocked).toBe(true);
    expect(duelBlocksCard(卡('军团', ['军团', '土']), 规则).blocked).toBe(true);
  });

  it('技能/装备/领域不受影响', () => {
    for (const 词 of [['技能'], ['装备'], ['地景', '水']]) {
      expect(duelBlocksCard(卡('x', 词), 规则).blocked).toBe(false);
    }
  });

  it('没有决斗规则 → 谁都能打（零改写）', () => {
    expect(duelBlocksCard(卡('伙伴', ['召唤', '土']), undefined).blocked).toBe(false);
  });

  it('抑制外部的持续伤害与治疗，但不抑制助战/削威胁', () => {
    expect(duelSuppressesEffect('dot', 规则)).toBe(true);
    expect(duelSuppressesEffect('regen', 规则)).toBe(true);
    expect(duelSuppressesEffect('buff', 规则)).toBe(false);
    expect(duelSuppressesEffect('weaken', 规则)).toBe(false);
    expect(duelSuppressesEffect('dot', undefined)).toBe(false);
  });
});

describe('决斗 —— 拍内核真的抑制', () => {
  const 开战 = (duel: boolean) =>
    startSkirmish({
      enemyName: '枪手',
      enemyLevel: 12,
      intents: [{ move: '快枪', threat: 20, counters: ['防御'] }],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 400,
      enemyMaxHp: 400,
      guard: 0,
      initialEffects: [
        { name: '毒雾', type: 'dot', amount: 30 },
        { name: '自身状态·吸魔', type: 'regen', amount: 30 },
      ],
      ...(duel ? { duel: { noCompanion: true } } : {}),
    });
  const 轻击 = { label: '轻推', power: 1, tags: [] as const };

  it('普通战斗：DoT 照打、吸魔照回', () => {
    const s = playBeat(开战(false), 轻击, 1);
    expect(s.log.join('\n')).toContain('在场持续');
    expect(s.log.join('\n')).toContain('吸魔');
  });

  it('决斗中：DoT 与治疗都不结算（免疫一切外部伤害与治疗）', () => {
    const s = playBeat(开战(true), 轻击, 1);
    expect(s.log.join('\n')).toContain('决斗');
    expect(s.log.join('\n')).not.toContain('在场持续');
    expect(s.log.join('\n')).not.toContain('回复');
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. 身后灵
// ════════════════════════════════════════════════════════════════════

describe('behind-spirits —— 身后灵', () => {
  it('宽读：脏值丢弃、名字必须非空', () => {
    expect(coerceSpirits({})).toEqual([]);
    expect(coerceSpirits([{ name: '她', power: 7 }, { name: '' }, 'x', { power: 3 }])).toEqual([
      { name: '她', power: 7 },
    ]);
  });

  it('追加不重复记同名（同一枚不会算两次守护）', () => {
    const one = addSpirit(undefined, { name: '她', power: 5 });
    expect(one).toHaveLength(1);
    expect(addSpirit(one, { name: '她', power: 5 })).toHaveLength(1);
    expect(addSpirit(one, { name: '另一位', power: 3 })).toHaveLength(2);
  });

  it('不 mutate 入参', () => {
    const src = [{ name: '她', power: 5 }];
    addSpirit(src, { name: '新', power: 1 });
    expect(src).toHaveLength(1);
  });

  it('汇总文案两种状态都给得出', () => {
    expect(describeSpirits([])).toContain('还没有');
    expect(
      describeSpirits([
        { name: '甲', power: 1 },
        { name: '乙', power: 2 },
      ]),
    ).toContain('甲');
  });

  it('模板带「成灵」条目，且算已实装', () => {
    const tpl = getTalentTemplate('瓦尔哈拉的门票');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries[0].kind).toBe('成灵');
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. 双生羁绊
// ════════════════════════════════════════════════════════════════════

describe('双生羁绊 —— 组合技', () => {
  const bonds = [{ a: '甲', b: '乙' }];

  it('宽读：脏值丢弃、自结对无效', () => {
    expect(coerceTwinBonds('x')).toEqual([]);
    expect(coerceTwinBonds([{ a: '甲', b: '乙' }, { a: '丙', b: '丙' }, { a: '' }, 1])).toEqual([
      { a: '甲', b: '乙' },
    ]);
  });

  it('无序判定：谁是 a 谁是 b 都算一对', () => {
    expect(areTwins(bonds, '甲', '乙')).toBe(true);
    expect(areTwins(bonds, '乙', '甲')).toBe(true);
    expect(areTwins(bonds, '甲', '丙')).toBe(false);
    expect(twinOf(bonds, '乙')).toBe('甲');
    expect(twinOf(bonds, '丙')).toBeUndefined();
  });

  it('双生本场已打出过 → 触发组合技（倍率按条目档位）', () => {
    const r = resolveTwinCombo({
      card: 卡('乙', ['召唤', '土']),
      bonds,
      playedCards: ['甲'],
      alreadyFired: false,
      comboMult: 2,
    });
    expect(r.fired).toBe(true);
    expect(r.power).toBe(2);
    expect(r.note).toContain('双生羁绊');
  });

  it('双生还没上场 → 不触发', () => {
    expect(
      resolveTwinCombo({
        card: 卡('乙', ['召唤', '土']),
        bonds,
        playedCards: [],
        alreadyFired: false,
      }).fired,
    ).toBe(false);
  });

  it('每对每场只触发一次（alreadyFired 去重）', () => {
    expect(
      resolveTwinCombo({
        card: 卡('乙', ['召唤', '土']),
        bonds,
        playedCards: ['甲'],
        alreadyFired: true,
      }).fired,
    ).toBe(false);
  });

  it('非伙伴卡不触发组合技（羁绊只结在伙伴之间）', () => {
    expect(
      resolveTwinCombo({
        card: 卡('乙', ['技能']),
        bonds,
        playedCards: ['甲'],
        alreadyFired: false,
      }).fired,
    ).toBe(false);
  });

  it('缔结后卡上带「双生」印记（词条名是契约）', () => {
    expect(TWIN_ENTRY).toBe('双生');
    expect(LAZY_ENTRY).toBe('懒惰');
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. 献祭召唤
// ════════════════════════════════════════════════════════════════════

describe('献祭召唤 —— 代价换助战', () => {
  it('模板档位：献祭 HP 比例 / 持续拍数 / 行动值倍率', () => {
    const tpl = getTalentTemplate('召唤媒介系统');
    expect(tpl?.grade).toBe('S');
    expect(tpl!.entries[0]).toEqual({
      kind: '献祭',
      channel: 'universal',
      params: { hpPct: 30, beats: 3, critMult: 2 },
    });
    expect(hasWorkingMechanic(tpl!)).toBe(true);
  });

  it('召唤物以「带持续拍数的 buff」形式落成在场效果（拍内核原生支持）', () => {
    const s = startSkirmish({
      enemyName: '木桩',
      enemyLevel: 1,
      intents: [{ move: '轻拍', threat: 1, counters: ['防御'] }],
      playerHp: 100,
      playerMaxHp: 100,
      enemyHp: 999,
      enemyMaxHp: 999,
      guard: 0,
    });
    const withSummon = playBeat(s, { label: '献祭召唤', power: 0, tags: [] }, 1, {
      recoil: 30,
      activate: { name: '异界召唤物', type: 'buff', amount: 60, beatsLeft: 3 },
    });
    expect(withSummon.playerHp).toBe(70); // 代价即时付出
    expect(withSummon.activeEffects.some((e) => e.name === '异界召唤物')).toBe(true);
    // 助战从下一拍起生效，且写审计行
    const s2 = playBeat(withSummon, { label: '强攻', power: 5, tags: [] }, 1);
    expect(s2.log.join('\n')).toContain('异界召唤物');
  });

  it('三拍后散去（beatsLeft 递减归零）', () => {
    const s = startSkirmish({
      enemyName: '木桩',
      enemyLevel: 1,
      intents: [{ move: '轻拍', threat: 1, counters: ['防御'] }],
      playerHp: 500,
      playerMaxHp: 500,
      enemyHp: 9999,
      enemyMaxHp: 9999,
      guard: 999,
      initialEffects: [{ name: '异界召唤物', type: 'buff', amount: 60, beatsLeft: 2 }],
    });
    let cur = playBeat(s, { label: '防御', power: 999, tags: ['防御'] }, 20);
    expect(cur.activeEffects.some((e) => e.name === '异界召唤物')).toBe(true);
    cur = playBeat(cur, { label: '防御', power: 999, tags: ['防御'] }, 20);
    expect(cur.activeEffects.some((e) => e.name === '异界召唤物')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// 体质检查
// ════════════════════════════════════════════════════════════════════

describe('本批之后 —— 五条 S 都离开了「仅叙事」', () => {
  it('懒惰天才 / 西部决斗礼仪 / 瓦尔哈拉的门票 / 召唤媒介系统 / 双生羁绊', () => {
    for (const name of ['懒惰天才', '西部决斗礼仪', '瓦尔哈拉的门票', '召唤媒介系统', '双生羁绊']) {
      const tpl = TALENT_CATALOG.find((t) => t.name === name);
      expect(tpl, name).toBeDefined();
      expect(hasWorkingMechanic(tpl!), name).toBe(true);
    }
  });
});
