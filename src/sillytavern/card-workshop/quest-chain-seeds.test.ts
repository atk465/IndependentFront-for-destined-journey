/**
 * quest-chain-seeds.test.ts — 禁忌卡七链种子：数据合同自检
 *
 * 门禁要点：
 * - 21 条委托全部过 coerceCommissions（四类要求/链字段/卡奖励解析无丢弃）
 * - 每链恰好 3 节、chainOrder 1-2-3 连续；仅末节挂 finale + issuerMidTier + 卡奖励
 * - 场景制卡的 target 是「钥匙卡」不是禁忌卡本尊（玩家不可制作红线）
 * - 4 条终点事件：exploration 触发、once、quest 门指向对应链末节委托名、scope 是引擎真中层
 */
import { describe, it, expect } from 'vitest';
import { coerceCommissions } from './commission';
import { QUEST_CHAIN_COMMISSION_SEEDS, QUEST_CHAIN_EVENT_SEEDS } from './quest-chain-seeds';
import { coerceRandomEventPack } from '../random-event-pack';

const parsed = coerceCommissions(QUEST_CHAIN_COMMISSION_SEEDS);

describe('禁忌卡七链种子（数据合同）', () => {
  it('21 条委托全部通过 coerceCommissions 门禁（无丢弃）', () => {
    expect(QUEST_CHAIN_COMMISSION_SEEDS).toHaveLength(21);
    expect(parsed).toHaveLength(21);
  });

  it('七条链、每链 3 节、chainOrder 1-2-3 连续', () => {
    const chains = new Map<string, number[]>();
    for (const def of parsed) {
      expect(def.chainId, def.name).toBeTruthy();
      expect(def.chainOrder, def.name).toBeGreaterThan(0);
      const list = chains.get(def.chainId!) ?? [];
      list.push(def.chainOrder!);
      chains.set(def.chainId!, list);
    }
    expect(chains.size).toBe(7);
    for (const [id, orders] of chains) {
      expect(
        [...orders].sort((a, b) => a - b),
        id,
      ).toEqual([1, 2, 3]);
    }
  });

  it('首节 visit / 中节 material / 末节 finale 的三段式', () => {
    const byChain = new Map<string, Map<number, (typeof parsed)[number]>>();
    for (const def of parsed) {
      const m = byChain.get(def.chainId!) ?? new Map();
      m.set(def.chainOrder!, def);
      byChain.set(def.chainId!, m);
    }
    for (const [, beats] of byChain) {
      const kinds = [1, 2, 3].map((o) => {
        const d = beats.get(o)!;
        if (d.requireVisit) return 'visit';
        if (d.requireMaterial) return 'material';
        if (d.finale) return 'finale';
        return 'none';
      });
      // 每节恰好一类要求，末节必为 finale，全链至少各含一次 visit 与 material
      expect(
        kinds.filter((k) => k === 'none'),
        beats.get(1)!.chainId,
      ).toEqual([]);
      expect(kinds[2]).toBe('finale');
      expect(kinds).toContain('visit');
      expect(kinds).toContain('material');
    }
  });

  it('仅末节挂 issuerMidTier（A/S 交付地）；grade 全落在 A/S', () => {
    for (const def of parsed) {
      expect(['A', 'S']).toContain(def.grade);
      if (def.chainOrder === 3) {
        expect(def.issuerMidTier, def.name).toBeTruthy();
      } else {
        expect(def.issuerMidTier, def.name).toBeUndefined();
      }
    }
  });

  it('场景制卡的 target 是钥匙卡，不是任何禁忌卡本尊（玩家不可制作红线）', () => {
    const forbiddenNames = [
      '禁忌卡·无名河',
      '禁忌卡·失年历',
      '禁忌卡·焚天引',
      '禁忌卡·万兽园',
      '禁忌卡·称心秤',
      '禁忌卡·白蜡城',
      '禁忌卡·第一行',
    ];
    for (const def of parsed) {
      if (def.finale?.type === '场景制卡') {
        expect(def.finale.target).toBeDefined();
        expect(forbiddenNames).not.toContain(def.finale.target);
        expect(def.finale.materials?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('末节卡奖励 grantAt=scene：六链发禁忌本尊，第一行链发残铭（六持一遇）', () => {
    for (const def of parsed) {
      if (def.chainOrder === 3) {
        expect(def.rewards.card?.grantAt).toBe('scene');
        if (def.chainId === 'chain_diyi') {
          expect(def.rewards.card?.name).toBe('第一行·残铭');
        } else {
          expect(def.rewards.card?.name).toMatch(/^禁忌卡·/);
        }
      }
    }
  });
});

describe('七链终点事件种子（数据合同）', () => {
  const pack = coerceRandomEventPack({
    config: {},
    defs: [...QUEST_CHAIN_EVENT_SEEDS],
  });
  const events = pack.defs;

  it('4 条事件全部通过 coerceRandomEventPack 门禁且为 exploration 触发', () => {
    expect(QUEST_CHAIN_EVENT_SEEDS).toHaveLength(4);
    expect(events).toHaveLength(4);
    for (const e of events) expect(e.trigger?.type).toBe('exploration');
  });

  it('once + quest 门指向对应链末节委托名（委托「进行中」才可能触发）', () => {
    const lastBeatNames = new Set(parsed.filter((d) => d.chainOrder === 3).map((d) => d.name));
    for (const e of events) {
      expect(e.once).toBe(true);
      const questName = (e.available?.quest as { name?: string } | undefined)?.name;
      expect(questName).toBeDefined();
      expect(lastBeatNames.has(questName!), `${e.name} → ${questName}`).toBe(true);
    }
  });

  it('谜题 finale 的 target 与事件名一一对应（触发即满足完成条件）', () => {
    const eventNames = new Set(events.map((e) => e.name));
    for (const def of parsed) {
      if (def.finale?.type === '谜题') {
        expect(eventNames.has(def.finale.target!), `${def.name} → ${def.finale.target}`).toBe(true);
      }
    }
  });
});

describe('卡与专属天赋种子（六持一遇）', () => {
  it('七张卡定义齐全：六正本可打出（技能/召唤/领域），残铭为装备且无战技语义', async () => {
    const { QUEST_CHAIN_CARD_SEEDS } = await import('./quest-chain-seeds');
    expect(QUEST_CHAIN_CARD_SEEDS).toHaveLength(7);
    const canming = QUEST_CHAIN_CARD_SEEDS.find((c) => c.name === '第一行·残铭');
    expect(canming?.formEntry).toBe('装备');
    const playables = QUEST_CHAIN_CARD_SEEDS.filter((c) => c.name !== '第一行·残铭');
    expect(playables.every((c) => ['技能', '召唤', '领域'].includes(c.formEntry))).toBe(true);
    // 打出合同写进卡面（AI 叙事面执行合同）
    for (const c of playables) expect(c.description).toContain('每场限一次');
    // 战斗外权能：纯叙事每日一次（六持一遇的全场景可用）
    for (const c of playables) {
      expect(c.description).toContain('战场之外亦可使用');
      expect(c.description).toContain('每日一次');
    }
    // 代价原则：每张可打出卡都写了代价
    for (const c of playables) expect(c.description).toContain('代价');
  });

  it('七个专属天赋过 validateTalentEntries，且描述写明持卡绑定', async () => {
    const { QUEST_CHAIN_TALENT_SEEDS } = await import('./quest-chain-seeds');
    const { validateTalentEntries } = await import('./talent-entry');
    expect(QUEST_CHAIN_TALENT_SEEDS).toHaveLength(7);
    for (const t of QUEST_CHAIN_TALENT_SEEDS) {
      expect(validateTalentEntries(t.entries).ok, t.name).toBe(true);
      expect(t.description).toContain('生效');
    }
    // 半行威压是真机械（威压）
    const weiya = QUEST_CHAIN_TALENT_SEEDS.find((t) => t.name === '半行威压');
    expect(weiya?.entries.some((e) => e.kind === '威压')).toBe(true);
    // 等价的眼是真机械（鉴定）
    const yan = QUEST_CHAIN_TALENT_SEEDS.find((t) => t.name === '等价的眼');
    expect(yan?.entries.some((e) => e.kind === '鉴定')).toBe(true);
  });

  it('奖励卡名与卡种子对齐：第一行链发残铭，不发禁忌本尊', async () => {
    const { QUEST_CHAIN_CARD_SEEDS } = await import('./quest-chain-seeds');
    const diyib = parsed.find((d) => d.chainId === 'chain_diyi' && d.chainOrder === 3);
    const name = diyib?.rewards.card?.name;
    expect(name).toBe('第一行·残铭');
    expect(QUEST_CHAIN_CARD_SEEDS.some((c) => c.name === name)).toBe(true);
    expect(name).not.toBe('禁忌卡·第一行');
  });
});
