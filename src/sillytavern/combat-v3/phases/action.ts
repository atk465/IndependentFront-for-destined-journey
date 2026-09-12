/**
 * combat-v3/phases/action.ts — 战术动作 / 逃跑 handler（M1/M3.5/阶段5）
 *
 * 架构真源：docs/reference/combat-system-architecture-v3.md §二 2.2 / §四 4.5 / §十 10.2
 * 实施计划：docs/planning/2026-07-31-combat-v3-implementation-plan.md §3.3 / §3.2 / §6.2（A35-1）
 * 阶段5 设计：docs/planning/2026-09-13-card-workshop-phase5-combat-wiring-design.md
 *
 * M1 最小实现：
 *   - DeclareAction：战术动作（道具/移动/专注/防御），消费动作槽（consumeSlot 管）+ 产 NarrativeCue 事件
 *   - Flee：逃跑检定（从 statusContest 取骰，d20 + 敏捷 vs DC 12），成功 → 移除单位离场
 *     （Bug C：不再整场 Terminal，终局交 checkTerminal；单敌人逃光 = 玩家获胜），
 *     失败 → 结束本回合进 MoraleCheck（Bug A：不占槽，不再 SLOT_EXHAUSTED），产 FleeAttempt
 *
 * M3.5 扩展（开放召唤出口，A35-1）：
 *   - DeclareAction 结算时求值 action.declared 窗口，若 automaton 返回 SpawnOrDespawnIntent(op:'spawn'):
 *       · templateRef 缺省（AI 创造性召唤）→ 冻结 spawn frame + 返回 RequiredInput.CharGenRequest
 *       · templateRef 命中（预生成池）→ 由 coordinator/reducer 实例化（本文件只标 requiredInput 信号，
 *         实际实例化走 SupplyUnit；templateRef 版本也可在此直接产事件——M3.5 先走 CharGenRequest 统一出口）
 *   - 非 spawn 意图（SpendResource 等）仍照常并入 pendingChanges（与冻结 FP 扣费同批）
 *
 * 阶段5 玩卡通道（卡牌工坊）：
 *   - DeclareAction(item).payload.card → 玩卡前置（槽位校验 / 启封判定 / automata 切分）：
 *       · sealed 卡先过意志对抗（intentCheck 通道 1 颗 d20 → card-workshop/unsealing 判定，
 *         骰走 state.dice 天然可回放）；哑火/反噬各有机械后果，暴走效果照发
 *       · 地景卡（词条含「地景」）：设 state.landscape + automata 全部持久注册（阶段4 语义）
 *       · 其余卡：action.declared 订阅者**打出即发动**（并入本次窗口求值，不持久注册），
 *         其余窗口订阅者持久注册（持续光环）——召唤/禁忌卡由此接上 M3.5 与 OverrideIntent 管线
 *
 * 槽位消费统一由 unit-turn.consumeSlot 处理（A1-1 行动槽强制）；本文件只结算动作的数值/事件。
 */

import { draw } from '../dice-tape';
import { runWindow, makeWindowRuntimeCtx } from '../windows';
import { validateBatch, applyIntents } from '../intents';
import { compileEffectProgram } from '../automata/compile';
import { updateIndex } from '../automata/index-active';
import type {
  ActiveEffectIndex,
  CombatCommand,
  CombatDefinitionBundle,
  CombatState,
  EffectIntent,
  SpawnOrDespawnIntent,
} from '../types';
// 阶段5 玩卡：判定/数值表全在 card-workshop（引擎内兄弟模块 import 先例：compile.ts 引 effect-types）
import {
  judgeUnseal,
  unsealDC,
  willModifierOf,
  UNSEAL_SLOT_COST,
  REBOUND_DAMAGE,
} from '../../card-workshop/unsealing';
import { LANDSCAPE_ENTRY } from '../../card-workshop/landscape';
import { CARD_TIERS, type CardTier } from '../../field-enums';
import { emptyChanges, type PhaseOutcome } from './outcome';

/** DeclareAction 的动作分支（架构 §二 2.2） */
export type TacticalActionType = 'item' | 'move' | 'focus' | 'defend';

/** 玩卡载荷（types.ts DeclareAction.payload.card 的内核侧视图，归一后） */
interface PlayedCard {
  name: string;
  cardTier: CardTier;
  词条: readonly string[];
  fusionKind: '叠加' | '相生' | '相克';
  sealed: boolean;
  automata?: NonNullable<
    NonNullable<Extract<CombatCommand, { kind: 'DeclareAction' }>['payload']['card']>['automata']
  >;
}

/** 生成一个确定性 requestId（召唤冻结幂等键；零随机） */
let _spawnSeq = 0;
function spawnRequestId(actorId: string): string {
  _spawnSeq += 1;
  return `summon-${actorId}-${_spawnSeq}`;
}

/**
 * 结算一次 DeclareAction。
 * 该命令的 action 槽已由 consumeSlot 消费；这里只产事件与卡牌效果。
 *
 * 玩卡前置（阶段5）先于 action.declared 窗口求值：拒绝/哑火/反噬/骰尽路径不跑窗口。
 */
export function handleAction(
  bundle: CombatDefinitionBundle,
  state: CombatState,
  command: Extract<CombatCommand, { kind: 'DeclareAction' }>,
): PhaseOutcome {
  const out: PhaseOutcome = {
    changes: emptyChanges(),
    events: [],
    nextPhase: 'SlotConsume',
  };

  const actionType: TacticalActionType = command.payload.actionType;
  const payloadCard = command.payload.card;

  // ── 阶段5 玩卡前置 ──
  let playIndex = state.activeEffects;
  if (payloadCard && actionType === 'item') {
    const prelude = playCardPrelude(out, state, command, payloadCard);
    if (prelude.stop) return out;
    playIndex = prelude.playIndex;
  } else if (payloadCard && actionType !== 'item') {
    // 明确拒绝语义进叙事：卡牌只能以「使用道具」打出，静默忽略会变成看不见的丢牌
    out.events.push({
      kind: 'NarrativeCue',
      text: `卡牌【${payloadCard.name}】只能以使用道具的方式打出`,
    });
  }

  // 错误隔离：单 automaton 抛错不打断动作（rejections 由 runWindow 记进 out.events）
  const declaredIntents = runWindow(
    out.events,
    playIndex,
    'action.declared',
    makeWindowRuntimeCtx(state, {
      selfId: command.actorId,
      round: state.round,
      window: 'action.declared',
    }),
  );

  // 收集 spawn 意图 + 已验证的非 spawn 费用意图（A3-7 / A35-1）
  const { spawns, nonSpawn } = collectSpawnAndFees(declaredIntents);

  // 阶段4 补的缺口：action.declared 的**非 spawn** 意图在正常路径此前被计算后
  // 直接丢弃（只有 spawn 分支把同窗口费用冻进 frame 延迟提交）——召唤以外的
  // automaton 意图（叙事 / 资源 / 状态 / 禁忌卡 OverrideIntent）照 A3-7 同款语义落地。
  // 🔴 spawn 在场时**保持原语义**（费用随冻结 frame 与 SupplyUnit 同批原子提交），
  //    这里落地一次、spawn 分支再冻一次就是 case-06 的双倍扣 FP。
  if (spawns.length === 0 && nonSpawn.length > 0) {
    const applyCtx: Parameters<typeof applyIntents>[0] = {
      state,
      automatonOwner: command.actorId,
      present: (id) => Object.prototype.hasOwnProperty.call(state.units, id),
      resolveNumber: () => 0,
    };
    const res = applyIntents(applyCtx, nonSpawn, out.changes);
    for (const n of res.narrative) out.events.push({ kind: 'NarrativeCue', text: n });
  }

  if (spawns.length > 0) {
    return handleSpawnIntents(out, state, bundle, command, spawns, nonSpawn);
  }

  const actor = state.units[command.actorId];
  const actionName =
    actionType === 'item'
      ? '使用道具'
      : actionType === 'move'
        ? '移动'
        : actionType === 'focus'
          ? '专注'
          : '防御';

  out.events.push({
    kind: 'NarrativeCue',
    text: `${actor?.name ?? command.actorId} ${actionName}${command.payload.description ? `：${command.payload.description}` : ''}`,
  });

  return out;
}

// ──────────────────────────────────────────────────────────────────────────────
// 阶段5：玩卡前置（槽位校验 → 启封判定 → automata 切分 → 地景落位）
// ──────────────────────────────────────────────────────────────────────────────

/** playCardPrelude 的返回：stop=true 时 out 已写好（拒绝/骰尽/哑火/反噬），调用方直接返回 */
type CardPreludeResult = { stop: true } | { stop: false; playIndex: ActiveEffectIndex };

/**
 * 玩卡前置。向 out 写入事件/变更（槽位补扣 / 反噬伤害 / 地景补丁 / 持久 automata），
 * 返回窗口求值应使用的索引（非地景卡含「打出即发动」的 action.declared 订阅者）。
 *
 * 顺序契约：
 *  1. 槽位不足 → rejection（reducer 对 rejection 不提交 consumeSlot 已扣的槽，零消费）
 *  2. sealed → intentCheck 抽骰判定；耗尽 → BeginOutput（flee 同款，半成品不提交）
 *  3. 哑火/反噬 → return stop（槽位照耗 = 尝试即代价；反噬落 REBOUND_DAMAGE）
 *  4. automata 切分：地景卡全部持久；其余卡 declared 即发动、其余持久
 *  5. 地景卡设 landscapePatch（阶段4 语义不变）
 */
function playCardPrelude(
  out: PhaseOutcome,
  state: CombatState,
  command: Extract<CombatCommand, { kind: 'DeclareAction' }>,
  rawCard: NonNullable<Extract<CombatCommand, { kind: 'DeclareAction' }>['payload']['card']>,
): CardPreludeResult {
  const card = normalizePlayedCard(rawCard);
  const actor = state.units[command.actorId];

  // 1. 槽位：封印卡按 UNSEAL_SLOT_COST（consumeSlot 已扣 1；此处校验总量，不足整命令拒绝，
  //    足够则补扣第二槽 —— 槽位账与效果同一次原子提交）
  if (card.sealed) {
    const needed = UNSEAL_SLOT_COST[card.cardTier];
    if ((actor?.actionsRemaining ?? 0) < needed) {
      out.rejection = {
        code: 'SLOT_EXHAUSTED',
        message: `启封【${card.name}】需要 ${needed} 个动作槽`,
      };
      return { stop: true };
    }
    if (needed > 1) {
      out.changes.slotConsumptions.push({ actorId: command.actorId, slot: 'action' });
    }

    // 2. 启封判定：意志对抗（intentCheck 通道，语义最贴；骰走 state.dice → 可回放）
    const r = draw(state.dice, 'intentCheck', 1);
    if ('exhausted' in r) {
      out.requiredInput = { kind: 'BeginOutput', channel: 'intentCheck' };
      return { stop: true };
    }
    out.dice = r.tape;
    const roll = r.rolls[0];
    const will = willModifierOf(actor?.attributes as Record<string, number> | undefined);
    const spec = { cardTier: card.cardTier, recipe: { fusionKind: card.fusionKind } };
    const judged = judgeUnseal(spec, roll, will);
    out.events.push({
      kind: 'UnsealJudged',
      unitId: command.actorId,
      name: card.name,
      outcome: judged.kind,
      roll,
      dc: unsealDC(spec),
      margin: judged.margin,
    });

    if (judged.kind === '哑火') {
      out.events.push({
        kind: 'NarrativeCue',
        text: `封印扛住了这次启封——【${card.name}】哑火`,
      });
      return { stop: true };
    }
    if (judged.kind === '反噬') {
      const dmg = REBOUND_DAMAGE[card.cardTier];
      out.changes.hpChanges[command.actorId] = (out.changes.hpChanges[command.actorId] ?? 0) - dmg;
      out.events.push({
        kind: 'NarrativeCue',
        text: `封印物反扑——【${card.name}】反噬 ${actor?.name ?? command.actorId}（-${dmg} HP）`,
      });
      return { stop: true };
    }
    if (judged.kind === '暴走') {
      out.events.push({
        kind: 'NarrativeCue',
        text: `封印脱控——【${card.name}】暴走，力量逸出掌控`,
      });
    }
  }

  // 4. 地景卡落位（词条含「地景」：设战场环境；替换语义与事件同阶段4。
  //    刻意先于 automata 切分——两者独立，且带 automata 的地景卡两条都要走）
  const isLandscape = card.词条.includes(LANDSCAPE_ENTRY);
  if (isLandscape) {
    out.changes.landscapePatch = {
      name: card.name,
      cardTier: card.cardTier,
      词条: [...card.词条],
      setByUnitId: command.actorId,
      setInRound: state.round,
    };
    const replaced = state.landscape?.name ?? null;
    out.events.push({
      kind: 'LandscapeSet',
      unitId: command.actorId,
      name: card.name,
      replaced,
    });
    out.events.push({
      kind: 'NarrativeCue',
      text: replaced
        ? `${actor?.name ?? command.actorId} 收起【${replaced}】，铺开地景【${card.name}】`
        : `${actor?.name ?? command.actorId} 铺开地景【${card.name}】`,
    });
  }

  // 5. automata 切分（compile 失败条目剔除不阻断，与召唤同款错误隔离）
  if (card.automata && card.automata.length > 0) {
    const compiled = compileEffectProgram({
      owner: command.actorId,
      source: card.name,
      idPrefix: `card-${command.actorId}-${state.round}`,
      divinity: actor?.ability?.divinity ?? 0,
      automata: card.automata,
    });
    if (compiled.automata.length > 0) {
      if (isLandscape) {
        // 地景卡：全部持久注册（环境常驻，从下一次行动起按窗口触发 —— 阶段4 语义）
        out.activeEffects = updateIndex(state.activeEffects, { add: compiled.automata });
        return { stop: false, playIndex: state.activeEffects };
      }
      const declaredOnes = compiled.automata.filter((a) => a.subscribe === 'action.declared');
      const persistent = compiled.automata.filter((a) => a.subscribe !== 'action.declared');
      if (persistent.length > 0) {
        out.activeEffects = updateIndex(state.activeEffects, { add: persistent });
      }
      if (declaredOnes.length > 0) {
        // 打出即发动：并入本次窗口求值（不持久注册 —— 重注册会在下个行动双发）
        return {
          stop: false,
          playIndex: updateIndex(state.activeEffects, { add: declaredOnes }),
        };
      }
    }
  }

  return { stop: false, playIndex: state.activeEffects };
}

/** 载荷归一：非法 cardTier 兜底白铁、fusionKind 缺省叠加、sealed 缺省 false */
function normalizePlayedCard(
  raw: NonNullable<Extract<CombatCommand, { kind: 'DeclareAction' }>['payload']['card']>,
): PlayedCard {
  return {
    name: raw.name,
    cardTier: (CARD_TIERS as readonly string[]).includes(raw.cardTier)
      ? (raw.cardTier as CardTier)
      : '白铁',
    词条: raw.词条,
    fusionKind: raw.fusionKind ?? '叠加',
    sealed: raw.sealed ?? false,
    automata: raw.automata,
  };
}

/**
 * M3.5：处理 action.declared 窗口产出的 SpawnOrDespawnIntent（A35-1）。
 *
 * 取第一条 spawn 意图（多 spawn 意图本 milestone 按第一条，M4 串行处理）：
 *   - templateRef 缺省 → 冻结 spawn frame + 返回 RequiredInput.CharGenRequest
 *   - 把同窗口的非 spawn 意图（SpendResource FP / EmitNarrativeCue 等）apply 到 out.changes，
 *     使冻结 frame 的 pendingChanges 含费用扣减，与 SupplyUnit 恢复时同批原子提交（不变量④，A35-6）
 *
 * @param nonSpawn 同窗口已验证的非 spawn 意图（供 applyIntents 落地费用；spawn 意图本身不 apply）
 */
function handleSpawnIntents(
  out: PhaseOutcome,
  state: CombatState,
  _bundle: CombatDefinitionBundle,
  command: Extract<CombatCommand, { kind: 'DeclareAction' }>,
  spawns: readonly SpawnOrDespawnIntent[],
  nonSpawn: readonly EffectIntent[],
): PhaseOutcome {
  const spawn = spawns[0];

  // 落地费用意图（SpendResource FP=100 等进 out.changes.fpDelta，供冻结 frame 持有）
  if (nonSpawn.length > 0) {
    const applyCtx: Parameters<typeof applyIntents>[0] = {
      state,
      automatonOwner: command.actorId,
      present: (id) => Object.prototype.hasOwnProperty.call(state.units, id),
      resolveNumber: () => 0,
    };
    const res = applyIntents(applyCtx, nonSpawn, out.changes);
    for (const n of res.narrative) out.events.push({ kind: 'NarrativeCue', text: n });
  }

  const sourceItem = command.payload.description || '召唤技能';
  const summonerIntent =
    command.payload.description ||
    `${state.units[command.actorId]?.name ?? command.actorId} 发动召唤`;

  const requestId = spawnRequestId(command.actorId);

  // A35-1：templateRef 缺省（创造性召唤）→ 冻结 spawn frame + CharGenRequest
  out.requiredInput = {
    kind: 'CharGenRequest',
    requestId,
    prompt: {
      race: undefined,
      tier: undefined,
      role: undefined,
      sourceItem,
      summonerIntent,
    },
    constraints: {
      divinityCap: state.units[command.actorId]?.ability?.divinity ?? 0,
      attributeBudget: 300,
      durationRounds: spawn.duration?.rounds,
    },
  };
  out.suspended = { spawn: true };
  out.nextPhase = 'SlotConsume';
  return out;
}

/**
 * 从 action.declared 收集的 intent 中提取全部 SpawnOrDespawnIntent（op='spawn'），
 * 同时聚合同窗口所有**已验证**的非 spawn 意图（供费用落地）。
 * batch 校验失败（A3-7 批原子性）→ 该 batch 的意图整体忽略。
 */
function collectSpawnAndFees(
  batches: readonly { automatonId: string; owner: string; intents: readonly EffectIntent[] }[],
): { spawns: SpawnOrDespawnIntent[]; nonSpawn: EffectIntent[] } {
  const spawns: SpawnOrDespawnIntent[] = [];
  const nonSpawn: EffectIntent[] = [];
  for (const b of batches) {
    const valid = validateBatch(b.intents);
    if (!valid.ok) continue; // 该 batch 非法 → 整批忽略
    for (const intent of b.intents) {
      if (intent.kind === 'SpawnOrDespawnIntent') {
        const sp = intent as SpawnOrDespawnIntent;
        if (sp.op === 'spawn') spawns.push(sp);
      } else {
        nonSpawn.push(intent);
      }
    }
  }
  return { spawns, nonSpawn };
}

/**
 * 结算一次逃跑（Flee，cost 'none'，Bug A 2026-08-12）。
 *
 * 检定：从 statusContest 取骰 → `d20 + 敏捷` ≥ DC 12 成功。
 * 成功（Bug C 修复）→ **不再结束整场战斗**：只把逃跑者移出战场
 *   （removeUnitIds + UnitDespawned('fled')，applyOutcome 同步摘 initiativeOrder），
 *   终局交给 checkTerminal 兜底——单敌人逃光 → hp_zero/player（玩家获胜）；
 *   多敌人逃一个 → 战斗继续。nextPhase 'UnitTurnClose'：逃跑者回合就此结束。
 * 失败 → 直接进 MoraleCheck（结束本回合、推进下一位）。Flee 不消费槽位，
 *   留在 SlotConsume 会无限等同一单位的命令（卡死），故不再「两槽自然归零」。
 */
export function handleFlee(
  bundle: CombatDefinitionBundle,
  state: CombatState,
  command: Extract<CombatCommand, { kind: 'Flee' }>,
): PhaseOutcome {
  const out: PhaseOutcome = {
    changes: emptyChanges(),
    events: [],
    nextPhase: 'MoraleCheck',
  };
  const actor = state.units[command.actorId];
  if (!actor) {
    out.rejection = { code: 'TARGET_NOT_PRESENT', message: '逃跑者不在场' };
    return out;
  }

  const r = draw(state.dice, 'statusContest', 1);
  if ('exhausted' in r) {
    out.requiredInput = { kind: 'BeginOutput', channel: 'statusContest' };
    return out;
  }
  out.dice = r.tape;
  const roll = r.rolls[0];

  const check = roll + actor.attributes.dex;
  const success = check >= 12;

  out.events.push({ kind: 'FleeAttempt', unitId: actor.id, success, roll });

  if (success) {
    // Bug C（2026-08-12）：逃跑成功只移除该单位，不设 Terminal / 不进 Terminal 相位。
    // 终局判定交给 checkTerminal（reducer 每步后调用）：单敌人逃光 → hp_zero/player。
    out.removeUnitIds = [actor.id];
    out.events.push({ kind: 'UnitDespawned', unitId: actor.id, reason: 'fled' });
    out.nextPhase = 'UnitTurnClose';
  } else {
    // Bug A（2026-08-12）：逃跑失败也结束本回合（直接 MoraleCheck → 下一位），
    // 不留在 SlotConsume 无限等命令。
    out.nextPhase = 'MoraleCheck';
  }
  return out;
}
