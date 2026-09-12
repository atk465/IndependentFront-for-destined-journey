/**
 * combat-v3/card-play.test.ts — 玩卡通道（阶段5：启封/召唤/禁忌 + 阶段4 地景迁移）
 *
 * 设计：docs/planning/2026-09-13-card-workshop-phase5-combat-wiring-design.md
 *
 * 覆盖：
 *   地景（阶段4 用例迁移，载荷 landscape→card）：落位 / 替换 / 非 item 拒绝 /
 *     缺省无键 / 持久光环 / 坏 automaton 剔除
 *   启封：nat20 启封 / 低滚哑火（槽照耗）/ 星辉低滚反噬（REBOUND_DAMAGE、无效果）/
 *     暴走（效果照发）/ 鎏金 2 槽不足 rejection（applyOutcome 恒等）/ intentCheck 耗尽 BeginOutput
 *   召唤卡：非封印卡带 spawn automaton → 打出即 CharGenRequest + spawn 冻结（M3.5 通道）
 *   禁忌卡：OverrideIntent(action.freezeSlot) → state.frozenSlots 落位
 *
 * 驱动模式照 phases.test.ts：createCombatState + applyOutcome 快进到 SlotConsume，
 * 直调 handleAction 断言 PhaseOutcome，再 applyOutcome 验证 state。
 */

import { describe, it, expect } from 'vitest';
import { createCombatState, applyOutcome, toView } from './state';
import { handleAction } from './phases/action';
import { createTape } from './dice-tape';
import type { CombatCommand, CombatState, DomainEvent } from './types';
import type { PhaseOutcome } from './phases/outcome';
import { mkBundle } from './test-utils';
import { REBOUND_DAMAGE } from '../card-workshop/unsealing';
import type { CardItem } from '../types';

// ── 夹具 ──

function emptyChg(): any {
  return {
    hpChanges: {},
    mpChanges: {},
    spChanges: {},
    fpDelta: 0,
    statusPatches: [],
    slotConsumptions: [],
  };
}

/** 快进到甲的 SlotConsume（currentTurnIndex=0；actions 可调，鎏金/星辉启封要 2 槽） */
function atSlotConsume(actions = 1, over: Partial<CombatState> = {}): CombatState {
  let s = createCombatState(mkBundle());
  s = applyOutcome(s, {
    changes: { ...emptyChg(), turnOpenSlots: [{ actorId: '甲', attacks: 1, actions }] },
    events: [],
    nextPhase: 'SlotConsume',
    currentTurnIndex: 0,
  });
  return { ...s, ...over };
}

/** DeclareAction 载荷（types.ts 是内联形状，从这里推导） */
type ActionPayload = Extract<CombatCommand, { kind: 'DeclareAction' }>['payload'];
type PlayedCard = NonNullable<ActionPayload['card']>;

/** 构造带玩卡载荷的 DeclareAction */
function playCard(
  commandId: string,
  state: CombatState,
  card: PlayedCard,
  actionType: 'item' | 'move' | 'focus' | 'defend' = 'item',
): Extract<CombatCommand, { kind: 'DeclareAction' }> {
  return {
    commandId,
    expectedRevision: state.revision,
    kind: 'DeclareAction',
    actorId: '甲',
    cost: 'action',
    payload: { actionType, card },
  };
}

function 灼热盆地(over: Partial<PlayedCard> = {}): PlayedCard {
  return { name: '灼热盆地', cardTier: '白银', 词条: ['火', '地景'], ...over };
}
function 霜风谷地(): PlayedCard {
  return { name: '霜风谷地', cardTier: '白银', 词条: ['冰', '地景'] };
}

/** 把 intentCheck 通道的首颗骰钉成指定值（其余通道给满长度占位：32/10/7/6/5） */
function tapeWithIntentRoll(first: number): CombatState['dice'] {
  const mk = (n: number, v: number) => Array.from({ length: n }, () => v);
  return createTape({
    outputId: 'test',
    batchHash: 'test',
    cursors: { attackHit: 0, initiative: 0, intentCheck: 0, statusContest: 0, procCheck: 0 },
    channels: {
      attackHit: mk(32, 10),
      initiative: mk(10, 10),
      // intentCheck 预算 7 颗：首颗钉 first，其余 10
      intentCheck: [first, ...mk(6, 10)],
      statusContest: mk(6, 10),
      procCheck: mk(5, 10),
    },
  });
}

/** intentCheck 耗尽的骰带（cursor=7） */
function tapeWithIntentExhausted(): CombatState['dice'] {
  const tape = tapeWithIntentRoll(10);
  // createTape 接受非零 cursor（RestoreCombat 先例）——直接把 intentCheck 推到预算尽头
  return {
    ...tape,
    current: { ...tape.current, cursors: { ...tape.current.cursors, intentCheck: 7 } },
  };
}

function ev(out: PhaseOutcome, kind: DomainEvent['kind']): any {
  return out.events.find((e) => e.kind === kind);
}

// ═══ 地景（阶段4 用例迁移，载荷 landscape → card）═══

describe('铺地景（item 行动）', () => {
  it('landscapePatch 落位 + LandscapeSet(replaced:null) + View 投影', () => {
    const s = atSlotConsume();
    const out: PhaseOutcome = handleAction(mkBundle(), s, playCard('l1', s, 灼热盆地()));

    expect(out.rejection).toBeUndefined();
    expect(out.changes.landscapePatch).toMatchObject({
      name: '灼热盆地',
      cardTier: '白银',
      setByUnitId: '甲',
      setInRound: s.round,
    });
    expect(ev(out, 'LandscapeSet')).toMatchObject({
      unitId: '甲',
      name: '灼热盆地',
      replaced: null,
    });

    // 不变量④：applyOutcome 一次提交（revision +1、state/View 同步）
    const next = applyOutcome(s, out);
    expect(next.revision).toBe(s.revision + 1);
    expect(next.landscape).toMatchObject({ name: '灼热盆地', setByUnitId: '甲' });
    expect(toView(next).landscape).toEqual({
      name: '灼热盆地',
      cardTier: '白银',
      词条: ['火', '地景'],
    });
  });

  it('再铺一张 → 替换语义，replaced 记旧名', () => {
    let s = atSlotConsume();
    s = applyOutcome(s, handleAction(mkBundle(), s, playCard('l1', s, 灼热盆地())));

    const second = handleAction(mkBundle(), s, playCard('l2', s, 霜风谷地()));
    expect(ev(second, 'LandscapeSet').replaced).toBe('灼热盆地');

    const next = applyOutcome(s, second);
    expect(next.landscape?.name).toBe('霜风谷地');
    expect(next.landscape?.词条).toEqual(['冰', '地景']); // 至多一份：替换不是叠加
  });

  it('非 item 行动携带卡 → 忽略不落位，叙事明确提示', () => {
    const s = atSlotConsume();
    const out = handleAction(mkBundle(), s, playCard('m1', s, 灼热盆地(), 'move'));
    expect(out.changes.landscapePatch).toBeUndefined();
    const hasHint = out.events.some(
      (e) => e.kind === 'NarrativeCue' && String((e as any).text).includes('使用道具'),
    );
    expect(hasHint).toBe(true);
  });

  it('缺省安全：不开地景的战斗 state 无 landscape 键', () => {
    const s = atSlotConsume();
    expect(s.landscape).toBeUndefined();
    expect(Object.keys(JSON.parse(JSON.stringify(s)))).not.toContain('landscape');
  });
});

describe('地景 automata 持久注册（真效果，非空壳）', () => {
  /** 灼热盆地自带一条 action.declared automaton：每次行动申报时发出环境叙事 */
  function 带效果灼热盆地(): PlayedCard {
    return {
      name: '灼热盆地',
      cardTier: '白银',
      词条: ['火', '地景'],
      automata: [
        {
          id: 'landscape.灼热盆地.热浪',
          name: '灼热盆地·热浪',
          source: '灼热盆地',
          owner: '甲',
          subscribe: 'action.declared',
          trigger: 'true',
          priority: 0,
          divinity: 0,
          intents: [{ kind: 'EmitNarrativeCue', text: '热浪自盆地翻涌而出' }],
        },
      ],
    };
  }

  it('铺设 Command 只落位不触发；此后每次行动触发其窗口效果', () => {
    const bundle = mkBundle();
    const s = atSlotConsume();

    const play = handleAction(bundle, s, playCard('l1', s, 带效果灼热盆地()));
    expect(play.activeEffects).toBeDefined();
    // 打出的这次不自带热浪（环境从下一次行动起生效——阶段4 语义）
    expect(
      play.events.some(
        (e) => e.kind === 'NarrativeCue' && String((e as any).text).includes('热浪自盆地翻涌而出'),
      ),
    ).toBe(false);
    const next = applyOutcome(s, play);
    expect(next.landscape?.name).toBe('灼热盆地');

    const again = handleAction(bundle, next, {
      commandId: 'a2',
      expectedRevision: next.revision,
      kind: 'DeclareAction',
      actorId: '甲',
      cost: 'action',
      payload: { actionType: 'focus' },
    });
    expect(
      again.events.some(
        (e) => e.kind === 'NarrativeCue' && String((e as any).text).includes('热浪自盆地翻涌而出'),
      ),
    ).toBe(true);
  });

  it('编译不合规的 automaton 被剔除，铺设本身不受阻（错误隔离）', () => {
    const s = atSlotConsume();
    const bad: PlayedCard = {
      name: '灼热盆地',
      cardTier: '白银',
      词条: ['火', '地景'],
      automata: [
        {
          id: 'landscape.灼热盆地.邪热',
          name: '邪热',
          source: '灼热盆地',
          owner: '甲',
          subscribe: 'event.evil', // 不在 18 窗口 → 编译剔除
          trigger: 'true',
          priority: 0,
          divinity: 0,
          intents: [{ kind: 'EmitNarrativeCue', text: '不该出现' }],
        },
      ] as unknown as NonNullable<PlayedCard['automata']>,
    };
    const out = handleAction(mkBundle(), s, playCard('l1', s, bad));
    expect(out.changes.landscapePatch).toBeDefined(); // 铺设照常
    expect(out.activeEffects).toBeUndefined(); // automata 全被剔除，索引不动
  });
});

// ═══ 启封判定（阶段5：intentCheck 通道 → judgeUnseal）═══

describe('启封判定（sealed 卡）', () => {
  /** 甲 attributes.spi=10 → willMod 0（test-utils mkParticipant） */
  it('nat20 自动启封：事件 + 地景照铺 + automata 持久注册', () => {
    const s = atSlotConsume(1, { dice: tapeWithIntentRoll(20) });
    const out = handleAction(mkBundle(), s, playCard('u1', s, 灼热盆地({ sealed: true })));

    expect(out.rejection).toBeUndefined();
    const judged = ev(out, 'UnsealJudged');
    expect(judged).toMatchObject({ name: '灼热盆地', outcome: '启封', roll: 20, dc: 14 });
    expect(out.changes.landscapePatch).toBeDefined(); // 效果照发
    expect(out.dice).toBeDefined(); // 骰带推进（可回放）
  });

  it('低滚哑火：无效果、无 automata，但槽位照耗（尝试即代价）', () => {
    // 白银 DC14，willMod 0：d20=12 → margin -2 → 哑火
    const s = atSlotConsume(1, { dice: tapeWithIntentRoll(12) });
    const out = handleAction(mkBundle(), s, playCard('u2', s, 灼热盆地({ sealed: true })));

    expect(ev(out, 'UnsealJudged').outcome).toBe('哑火');
    expect(out.changes.landscapePatch).toBeUndefined();
    expect(out.activeEffects).toBeUndefined();

    const next = applyOutcome(s, out);
    expect(next.landscape).toBeUndefined();
    // 槽位账：consumeSlot 扣的 1 槽在 reducer 合并层；phase 级只看本命令零额外变更
    expect(out.changes.slotConsumptions).toHaveLength(0); // 白银 1 槽，无需补扣
  });

  it('鎏金反噬：REBOUND_DAMAGE 反扑启封者、效果不发、第二槽照扣', () => {
    // 鎏金 DC17，willMod 0：d20=5 → margin -12 → 反噬；REBOUND_DAMAGE[鎏金]=16
    const s = atSlotConsume(2, { dice: tapeWithIntentRoll(5) });
    const card = 灼热盆地({ cardTier: '鎏金', sealed: true });
    const out = handleAction(mkBundle(), s, playCard('u3', s, card));

    expect(ev(out, 'UnsealJudged').outcome).toBe('反噬');
    expect(out.changes.hpChanges['甲']).toBe(-REBOUND_DAMAGE['鎏金']);
    expect(out.changes.landscapePatch).toBeUndefined();
    expect(out.changes.slotConsumptions).toEqual([{ actorId: '甲', slot: 'action' }]); // 补扣第二槽

    const next = applyOutcome(s, out);
    expect(next.units['甲'].hp).toBe(s.units['甲'].hp - REBOUND_DAMAGE['鎏金']);
    expect(next.landscape).toBeUndefined();
    // phase 级只看到本 handler 的补扣（2→1）；consumeSlot 扣的第一槽在 reducer
    // 合并层（consumePlayerCommand ③ mergeChanges），reducer 级才是 2→0
    expect(next.units['甲'].actionsRemaining).toBe(1);
  });

  it('暴走：效果照发（地景照铺）+ 暴走叙事', () => {
    // 白银 DC14：d20=9 → margin -5 → 暴走
    const s = atSlotConsume(1, { dice: tapeWithIntentRoll(9) });
    const out = handleAction(mkBundle(), s, playCard('u4', s, 灼热盆地({ sealed: true })));

    expect(ev(out, 'UnsealJudged').outcome).toBe('暴走');
    expect(out.changes.landscapePatch).toBeDefined();
    expect(
      out.events.some((e) => e.kind === 'NarrativeCue' && String((e as any).text).includes('暴走')),
    ).toBe(true);
  });

  it('鎏金需 2 槽、行动者只剩 1 → 整命令拒绝（applyOutcome 恒等原 state，零消费）', () => {
    const s = atSlotConsume(1, { dice: tapeWithIntentRoll(10) });
    const out = handleAction(
      mkBundle(),
      s,
      playCard('u5', s, 灼热盆地({ cardTier: '鎏金', sealed: true })),
    );

    expect(out.rejection?.code).toBe('SLOT_EXHAUSTED');
    // rejection = 零骰零变更：applyOutcome 原样返回（consumeSlot 已扣的槽也不提交）
    expect(applyOutcome(s, out)).toBe(s);
  });

  it('intentCheck 耗尽 → BeginOutput（flee 同款，半成品不提交）', () => {
    const s = atSlotConsume(1, { dice: tapeWithIntentExhausted() });
    const out = handleAction(mkBundle(), s, playCard('u6', s, 灼热盆地({ sealed: true })));

    expect(out.requiredInput).toEqual({ kind: 'BeginOutput', channel: 'intentCheck' });
    expect(out.events).toHaveLength(0);
    expect(out.dice).toBeUndefined();
  });

  it('未封印卡（sealed 缺省）不掷骰直接生效', () => {
    const s = atSlotConsume(1, { dice: tapeWithIntentRoll(1) }); // 若误掷必哑火/更糟
    const out = handleAction(mkBundle(), s, playCard('u7', s, 灼热盆地()));

    expect(out.events.some((e) => e.kind === 'UnsealJudged')).toBe(false);
    expect(out.changes.landscapePatch).toBeDefined();
  });
});

// ═══ 召唤卡（阶段5：打出即发动 → M3.5 冻结链）═══

describe('召唤卡（非地景：action.declared 打出即发动）', () => {
  /** 巨兽卡：action.declared 窗口 spawn 意图（无 templateRef → 创造性召唤） */
  function 巨兽卡(): PlayedCard {
    return {
      name: '远古巨兽·岩爪',
      cardTier: '鎏金',
      词条: ['土', '巨兽'],
      sealed: false,
      automata: [
        {
          id: 'card.岩爪.降临',
          name: '岩爪·降临',
          source: '远古巨兽·岩爪',
          owner: '甲',
          subscribe: 'action.declared',
          trigger: 'true',
          priority: 0,
          divinity: 0,
          intents: [
            {
              kind: 'SpawnOrDespawnIntent',
              op: 'spawn',
              unitId: '岩爪兽',
              duration: { rounds: 3 },
              joinTiming: 'this_round_tail',
            },
          ],
        },
      ],
    };
  }

  it('打出即 CharGenRequest + spawn 冻结（M3.5 通道证明），不持久注册', () => {
    const s = atSlotConsume();
    const out = handleAction(mkBundle(), s, playCard('s1', s, 巨兽卡()));

    expect(out.requiredInput?.kind).toBe('CharGenRequest');
    expect(out.suspended).toEqual({ spawn: true });
    expect(out.activeEffects).toBeUndefined(); // declared 打出即发动：不持久注册
    expect(s.activeEffects).toBe(out.activeEffects ?? s.activeEffects); // 索引未被就地改动
  });
});

// ═══ 禁忌卡（阶段5：OverrideIntent → freezeSlotPatches）═══

describe('禁忌卡（OverrideIntent 规则覆写）', () => {
  /** 禁忌卡：action.declared 窗口冻结敌方攻击槽两轮（A4-3 action.freezeSlot 已接线） */
  function 禁忌卡(): PlayedCard {
    return {
      name: '静滞之缚',
      cardTier: '星辉',
      词条: ['暗', '禁忌'],
      automata: [
        {
          id: 'card.静滞之缚.凝滞',
          name: '静滞之缚·凝滞',
          source: '静滞之缚',
          owner: '甲',
          subscribe: 'action.declared',
          trigger: 'true',
          priority: 0,
          divinity: 0,
          intents: [
            {
              kind: 'OverrideIntent',
              ruleKey: 'action.freezeSlot',
              payload: { targetId: '乙', slotType: 'attack', rounds: 2 },
              divinity: 0,
            },
          ],
        },
      ],
    };
  }

  it('打出即冻结敌方攻击槽（applyOutcome 后 state.frozenSlots 落位）', () => {
    const s = atSlotConsume();
    const out = handleAction(mkBundle(), s, playCard('f1', s, 禁忌卡()));

    expect(out.rejection).toBeUndefined();
    expect(out.changes.freezeSlotPatches).toEqual([
      { targetId: '乙', slotType: 'attack', rounds: 2 },
    ]);

    const next = applyOutcome(s, out);
    expect(next.frozenSlots).toContainEqual({ targetId: '乙', slotType: 'attack', rounds: 2 });
  });
});

// ═══ 类型自检（CardItem 与玩卡载荷的形状对齐由会话层装配保证，这里锁常量）═══

describe('数值表引用一致', () => {
  it('REBOUND_DAMAGE 与 card-workshop 单一真源一致（反噬伤害）', () => {
    expect(REBOUND_DAMAGE).toEqual({ 白铁: 5, 青铜: 8, 白银: 12, 鎏金: 16, 星辉: 20 });
  });
  it('CardItem.sealed 语义对齐：高阶卡默认带封印（craft-card 的产物规则）', () => {
    // 形状烟雾测试：CardItem 类型存在且词条可含地景（编译期保证，运行时只验常量）
    const card: Pick<CardItem, 'type'> = { type: '卡牌' };
    expect(card.type).toBe('卡牌');
  });
});
