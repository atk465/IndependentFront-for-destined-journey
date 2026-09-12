/**
 * combat-v3/landscape.test.ts — 地景卡内核通道（阶段4）
 *
 * 设计：docs/planning/2026-09-13-card-workshop-phase4-landscape-design.md
 * 覆盖：
 *   1. item 行动铺地景 → state.landscape 落位 + LandscapeSet(replaced:null) + View 投影
 *   2. 再铺一张 → 替换语义 + replaced 记旧名
 *   3. 非 item 行动携带 landscape → 忽略不落位（有明确叙事提示，不静默吞）
 *   4. 卡牌 automata 注册 → 铺设后的下一次行动真的触发其窗口效果（真效果，非空壳）
 *   5. 不变量④：地景与同 Command 其他产出一次提交
 *   6. 缺省安全：不开地景的战斗 state 无 landscape 键（JSON 序列化级缺席）
 *
 * 驱动模式照 phases.test.ts：createCombatState + applyOutcome 快进到 SlotConsume，
 * 直调 handleAction 断言 PhaseOutcome，再 applyOutcome 验证 state。
 */

import { describe, it, expect } from 'vitest';
import { createCombatState, applyOutcome, toView } from './state';
import { handleAction } from './phases/action';
import type { CombatCommand, CombatState } from './types';
import type { PhaseOutcome } from './phases/outcome';
import { mkBundle } from './test-utils';

/** DeclareAction 载荷（types.ts 是内联形状，从这里推导） */
type ActionPayload = Extract<CombatCommand, { kind: 'DeclareAction' }>['payload'];

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

/** 快进到甲的 SlotConsume（槽已发好，currentTurnIndex=0） */
function atSlotConsume(): CombatState {
  let s = createCombatState(mkBundle());
  s = applyOutcome(s, {
    changes: { ...emptyChg(), turnOpenSlots: [{ actorId: '甲', attacks: 1, actions: 1 }] },
    events: [],
    nextPhase: 'SlotConsume',
    currentTurnIndex: 0,
  });
  return s;
}

/** 构造带可选 landscape 载荷的 DeclareAction（mkAction 不支持扩展载荷） */
function mkLandscapeAction(
  commandId: string,
  state: CombatState,
  actorId: string,
  actionType: 'item' | 'move' | 'focus' | 'defend',
  landscape?: ActionPayload['landscape'],
): Extract<CombatCommand, { kind: 'DeclareAction' }> {
  return {
    commandId,
    expectedRevision: state.revision,
    kind: 'DeclareAction',
    actorId,
    cost: 'action',
    payload: { actionType, landscape },
  };
}

/** 一条灼热盆地（无 automata 版） */
function 灼热盆地() {
  return { name: '灼热盆地', cardTier: '白银', 词条: ['火', '地景'] };
}
/** 一条霜风谷地（无 automata 版） */
function 霜风谷地() {
  return { name: '霜风谷地', cardTier: '白银', 词条: ['冰', '地景'] };
}

// ── 用例 ──

describe('铺地景（item 行动）', () => {
  it('landscapePatch 落位 + LandscapeSet(replaced:null) + View 投影（覆盖 1）', () => {
    const s = atSlotConsume();
    const out: PhaseOutcome = handleAction(
      mkBundle(),
      s,
      mkLandscapeAction('l1', s, '甲', 'item', 灼热盆地()),
    );

    expect(out.rejection).toBeUndefined();
    expect(out.changes.landscapePatch).toMatchObject({
      name: '灼热盆地',
      cardTier: '白银',
      setByUnitId: '甲',
      setInRound: s.round,
    });
    const evt = out.events.find((e) => e.kind === 'LandscapeSet') as any;
    expect(evt).toMatchObject({ unitId: '甲', name: '灼热盆地', replaced: null });

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

  it('再铺一张 → 替换语义，replaced 记旧名（覆盖 2）', () => {
    let s = atSlotConsume();
    const first = handleAction(mkBundle(), s, mkLandscapeAction('l1', s, '甲', 'item', 灼热盆地()));
    s = applyOutcome(s, first);

    const second = handleAction(
      mkBundle(),
      s,
      mkLandscapeAction('l2', s, '甲', 'item', 霜风谷地()),
    );
    const evt = second.events.find((e) => e.kind === 'LandscapeSet') as any;
    expect(evt.replaced).toBe('灼热盆地');

    const next = applyOutcome(s, second);
    expect(next.landscape?.name).toBe('霜风谷地');
    // 至多一份：替换不是叠加
    expect(next.landscape?.词条).toEqual(['冰', '地景']);
  });

  it('非 item 行动携带 landscape → 忽略不落位，叙事明确提示（覆盖 3）', () => {
    const s = atSlotConsume();
    const out = handleAction(mkBundle(), s, mkLandscapeAction('m1', s, '甲', 'move', 灼热盆地()));
    expect(out.changes.landscapePatch).toBeUndefined();
    const hasHint = out.events.some(
      (e) => e.kind === 'NarrativeCue' && String((e as any).text).includes('使用道具'),
    );
    expect(hasHint).toBe(true);
  });

  it('缺省安全：不开地景的战斗 state 无 landscape 键（覆盖 6）', () => {
    const s = atSlotConsume();
    expect(s.landscape).toBeUndefined();
    expect(Object.keys(JSON.parse(JSON.stringify(s)))).not.toContain('landscape');
  });
});

describe('地景 automata 注册（覆盖 4：真效果，非空壳）', () => {
  /** 灼热盆地自带一条 action.declared automaton：每次行动申报时发出环境叙事 */
  function 带效果灼热盆地(): ActionPayload['landscape'] {
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

  it('铺设 Command 注册 automata；此后每次行动触发其窗口效果', () => {
    const bundle = mkBundle();
    const s = atSlotConsume();

    // 第一次行动：铺地景（本 Command 不触发自己——注册发生在本 Command 提交后）
    const play = handleAction(
      bundle,
      s,
      mkLandscapeAction('l1', s, '甲', 'item', 带效果灼热盆地()),
    );
    expect(play.activeEffects).toBeDefined();
    const next = applyOutcome(s, play);
    expect(next.landscape?.name).toBe('灼热盆地');

    // 第二次行动：action.declared 窗口命中地景 automaton → 其 NarrativeCue 出现
    const again = handleAction(bundle, next, mkLandscapeAction('a2', next, '甲', 'focus'));
    const cue = again.events.find(
      (e) => e.kind === 'NarrativeCue' && String((e as any).text).includes('热浪自盆地翻涌而出'),
    );
    expect(cue).toBeDefined();
  });

  it('编译不合规的 automaton 被剔除，铺设本身不受阻（错误隔离）', () => {
    const s = atSlotConsume();
    const bad = {
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
      ] as unknown as NonNullable<ActionPayload['landscape']>['automata'],
    };
    const out = handleAction(mkBundle(), s, mkLandscapeAction('l1', s, '甲', 'item', bad));
    expect(out.changes.landscapePatch).toBeDefined(); // 铺设照常
    expect(out.activeEffects).toBeUndefined(); // automata 全被剔除，索引不动
  });
});
