/**
 * skirmish-settlement.test.ts — 终局持久化补丁构建覆盖
 *
 * 钉口径：主角绝对值经验（+312 由 state-manager 级联）、战后 HP、消耗卡 remove、
 * 永久卡 cardExp 入账（满管转战力）、查不到实物跳过、主角补丁永远排第一。
 */
import { describe, it, expect } from 'vitest';
import type { CardItem } from '../types';
import { buildSkirmishSettlementPatches } from './skirmish-settlement';
import { startSkirmish, playBeat, fleeSkirmish, settleSkirmish } from './skirmish-session';

const 开战 = () =>
  startSkirmish({
    enemyName: '岩爪兽',
    enemyLevel: 12,
    intents: [
      { move: '蓄力·崩山击', threat: 18, counters: ['打断', '防御'] },
      { move: '连环爪击', threat: 12, counters: ['闪避'] },
    ],
    playerHp: 155,
    playerMaxHp: 155,
    enemyHp: 60, // 压到两拍内可打空（拍数不设限后，胜利只来自 HP 清空）
    enemyMaxHp: 60,
    guard: 10,
  });

const 燎原行动 = {
  label: '打出 燎原符卡',
  power: 12,
  tags: ['打断' as const],
  cardName: '燎原符卡',
};

const 燎原符卡: CardItem = {
  name: '燎原符卡',
  type: '卡牌',
  quantity: 1,
  cardTier: '青铜',
  词条: ['火', '燎原', '技能'],
  recipe: {
    mainMaterial: '火',
    subMaterials: [],
    tier: '青铜',
    fusionKind: '叠加',
    cost: 10,
    rating: '良',
  },
  sealed: false,
} as unknown as CardItem;

const 苍穹之翼: CardItem = {
  ...燎原符卡,
  name: '苍穹之翼',
  cardTier: '白铁',
  词条: ['风', '装备'],
  cardExp: 190,
};

/** 打满两拍全反制的胜利局：S 级 312 EXP、参战卡 [燎原符卡] 分 156 */
const 胜利账本 = () => {
  const session = playBeat(
    playBeat(开战(), 燎原行动, 17),
    { ...燎原行动, tags: ['闪避' as const] },
    20,
  );
  const settlement = settleSkirmish(session, 9)!;
  return { session, settlement };
};

describe('buildSkirmishSettlementPatches —— 主角补丁', () => {
  it('totalExp 绝对值累加（100 + 312 = 412）；hp = 账本终局 HP', () => {
    const { session, settlement } = 胜利账本();
    const patches = buildSkirmishSettlementPatches({
      playerName: '妲丽安',
      playerTotalExp: 100,
      session,
      settlement,
      cardOf: () => undefined,
    });
    expect(patches[0]).toEqual({
      op: 'update_character',
      target: 'characters.妲丽安',
      value: { totalExp: 412, hp: 155 },
    });
  });
  it('受伤战局把账本终局 HP 落库（state-manager 侧自带 [0,max] 钳制）', () => {
    const session = playBeat(开战(), { label: '闪避', power: 1, tags: ['闪避'] }, 1);
    const settlement = fleeSkirmishAfter(session);
    const patches = buildSkirmishSettlementPatches({
      playerName: '妲丽安',
      playerTotalExp: 0,
      session,
      settlement: settlement!,
      cardOf: () => undefined,
    });
    const char = patches[0] as { value: { hp: number } };
    expect(char.value.hp).toBeLessThan(155);
    expect(char.value.hp).toBeGreaterThanOrEqual(0);
  });
});

describe('buildSkirmishSettlementPatches —— 参战卡补丁', () => {
  it('消耗卡（技能）→ remove_item；永久卡（装备）→ update_item 写 cardExp', () => {
    const { session } = 胜利账本();
    const cards = [燎原符卡, 苍穹之翼];
    // 双参战模拟：燎原符卡（技能=消耗）+ 苍穹之翼（装备=永久，白铁管容 200）
    const played = { ...session, playedCards: ['燎原符卡', '苍穹之翼'] };
    const settle2 = settleSkirmish(played, 9)!;
    const patches = buildSkirmishSettlementPatches({
      playerName: '妲丽安',
      playerTotalExp: 0,
      session: played,
      settlement: settle2,
      cardOf: (name) => cards.find((c) => c.name === name),
    });
    expect(patches).toHaveLength(3);
    expect(patches[1]).toEqual({
      op: 'remove_item',
      target: 'characters.妲丽安',
      value: { name: '燎原符卡', quantity: 1 },
    });
    expect(patches[2]).toEqual({
      op: 'update_item',
      target: 'characters.妲丽安',
      value: { name: '苍穹之翼', changes: { cardExp: 346 - 200, cardPowerBonus: 1 } },
    });
  });
  it('查不到实物的参战名静默跳过，只有主角补丁', () => {
    const { session, settlement } = 胜利账本();
    const patches = buildSkirmishSettlementPatches({
      playerName: '妲丽安',
      playerTotalExp: 0,
      session,
      settlement,
      cardOf: () => undefined,
    });
    expect(patches).toHaveLength(1);
    expect(patches[0].op).toBe('update_character');
  });
});

// —— 工具：打一拍低骰然后撤退（受伤不致死），settle 出非空结算 ——
function fleeSkirmishAfter(session: ReturnType<typeof startSkirmish>) {
  const fled = fleeSkirmish(session);
  return settleSkirmish(fled, 9);
}
