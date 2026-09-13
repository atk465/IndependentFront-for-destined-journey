/**
 * skirmish-session.ts — 交锋拍会话账本（卡牌工坊 交锋拍制）
 *
 * 把 skirmish.ts 的纯拍结算串成一场战斗：预提交意图逐拍揭示、玩家反制、HP 与
 * 审计行累积、参战卡账本、终局（胜利/碾压/撤退/败北）结算数据。**只记账不落库**
 * ——HP/经验/卡牌经验的持久化由集成层（game-store / game-pipeline）在同一窗内
 * 原子提交，账本本身零副作用。
 *
 * 确定性契约：纯函数、不 mutate 入参（每拍返回新账本）；骰值调用方传入；
 * 结束态之后的行动原样返回同一账本（幂等）。
 * 评价口径：撤退与败北同为 C（初稿，数值总表终审）；碾压速胜评价封顶 S。
 */

import {
  coerceIntents,
  gradeBattle,
  battleExpChain,
  formatExpAudit,
  cardExpGain,
  resolveBeat,
  type EnemyIntent,
  type ExpAudit,
  type SkirmishAction,
  type SkirmishGrade,
} from './skirmish';
import type { CardInPlayEffect } from './entry-combat';

/** 会话终局态；null = 交锋中 */
export type SkirmishFinish = null | '胜利' | '碾压' | '撤退' | '败北';

export interface SkirmishSession {
  enemyName: string;
  /** 敌方等级（TL，经验公式链用） */
  enemyLevel: number;
  /** AI 预提交意图序列（夹逼后的可信形状） */
  intents: readonly EnemyIntent[];
  /** 已完成的拍数 */
  beat: number;
  playerHp: number;
  playerMaxHp: number;
  enemyHp: number;
  enemyMaxHp: number;
  /** 派生防御（反制失败减伤基数） */
  guard: number;
  /** 审计行累积（战报卡正文，开场即有行） */
  log: string[];
  /** 参战卡账本（去重；卡牌经验分成对象） */
  playedCards: string[];
  counteredBeats: number;
  finished: SkirmishFinish;
  /** 玩家主动结束战斗时写的理由（终局记叙的收束参考；其余终局缺省） */
  endReason?: string;
  /** 在场持续效果（领域/场景/装备/召唤/军团；从打出后的下一拍起每拍生效） */
  activeEffects: readonly CardInPlayEffect[];
}

export interface StartSkirmishInput {
  enemyName: string;
  enemyLevel?: number;
  intents: unknown;
  playerHp: number;
  playerMaxHp?: number;
  enemyHp: number;
  enemyMaxHp?: number;
  guard?: number;
}

const clampHp = (n: number, fallback: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
  return Number.isFinite(v) ? v : 0;
};

const finiteOr = (n: number | undefined, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? n : fallback;

/** 开战：预提交意图夹逼入账，开场行写审计 */
export function startSkirmish(input: StartSkirmishInput): SkirmishSession {
  const intents = coerceIntents(input.intents);
  const playerHp = clampHp(input.playerHp, 0);
  const enemyHp = clampHp(input.enemyHp, 0);
  const session: SkirmishSession = {
    enemyName: typeof input.enemyName === 'string' ? input.enemyName : '未知敌人',
    enemyLevel: Math.max(1, Math.round(finiteOr(input.enemyLevel, 1))),
    intents,
    beat: 0,
    playerHp,
    playerMaxHp: clampHp(finiteOr(input.playerMaxHp, playerHp), playerHp),
    enemyHp,
    enemyMaxHp: clampHp(finiteOr(input.enemyMaxHp, enemyHp), enemyHp),
    guard: Math.max(0, Math.round(finiteOr(input.guard, 0))),
    log: [
      `◆ 战斗模式 · 交锋拍制 ◆`,
      `▸ 【${input.enemyName}】Lv.${Math.max(1, Math.round(finiteOr(input.enemyLevel, 1)))} 现身——${intents.length} 式招已锁定（招式轮换，打到一方倒下或冒险者收手为止）`,
    ],
    playedCards: [],
    counteredBeats: 0,
    activeEffects: [],
    finished: null,
  };
  // 无敌方招式（评估被夹逼成空）→ 不战自溃，UI 永不卡在无拍可打的账本上
  if (intents.length === 0) {
    return withFinish(session, '胜利', [`▸ 【${session.enemyName}】毫无章法——不战自溃！`]);
  }
  return session;
}

/** 本拍敌方意图（序列打完按原序轮换；已终局 → null） */
export function currentIntent(s: SkirmishSession): EnemyIntent | null {
  if (s.finished !== null || s.intents.length === 0) return null;
  return s.intents[s.beat % s.intents.length] ?? null;
}

const withFinish = (
  s: SkirmishSession,
  finish: Exclude<SkirmishFinish, null>,
  lines: string[],
): SkirmishSession => ({
  ...s,
  log: [...s.log, ...lines],
  finished: finish,
});

/** 打一拍：拍结算 + 记账 + 终局判定（只按 HP 归零终局；拍数不限，招式轮换）。
 *  activate = 本拍打出的在场卡（领域/场景/装备/召唤/军团），效果从下一拍起生效。
 *  未开始/已结束/无敌方招式 → 原样返回（幂等） */
export function playBeat(
  s: SkirmishSession,
  action: SkirmishAction,
  dice: number,
  activate?: { name: string; type: 'dot' | 'buff'; amount: number },
): SkirmishSession {
  const intent = currentIntent(s);
  if (!intent) return s;

  // 在场加成（此前打出的领域/装备/召唤…）：行动值先行叠加，审计单列一行可复算
  const buffTotal = s.activeEffects
    .filter((e) => e.type === 'buff')
    .reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  const effectiveAction =
    buffTotal > 0 ? { ...action, power: Math.max(0, action.power) + buffTotal } : action;

  const result = resolveBeat({
    intent: intent,
    action: effectiveAction,
    playerHp: s.playerHp,
    enemyHp: s.enemyHp,
    guard: s.guard,
    dice,
  });
  const lines = [
    // 出卡宣言（主人裁定：玩家写这张牌用来做什么，纯叙事素材，置于拍审计之前）
    ...(action.note ? [`▸ 意图：${action.note}`] : []),
    ...(buffTotal > 0 ? [`▸ 在场加成：行动值 +${buffTotal}`] : []),
    ...result.audit,
  ];

  // 在场持续伤害（领域 DoT）：拍末结算，可收到人头
  const dotTotal = s.activeEffects
    .filter((e) => e.type === 'dot')
    .reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  const enemyHpAfterDot = Math.max(0, result.enemyHp - dotTotal);
  if (dotTotal > 0 && result.enemyHp > 0) {
    lines.push(`▸ 在场持续：敌方 −${dotTotal}（${result.enemyHp} → ${enemyHpAfterDot}）`);
  }

  // 本拍激活的在场卡：效果自下一拍起生效
  const nextEffects = activate
    ? [
        ...s.activeEffects,
        {
          name: activate.name,
          type: activate.type,
          amount: Math.max(0, Math.round(activate.amount)),
        },
      ]
    : s.activeEffects;
  if (activate) {
    lines.push(
      `▸ 【${activate.name}】${activate.type === 'dot' ? '灼烧' : '助阵'}生效——此后每拍${activate.type === 'dot' ? `敌方 −${activate.amount}` : `行动值 +${activate.amount}`}`,
    );
  }

  const next: SkirmishSession = {
    ...s,
    beat: s.beat + 1,
    playerHp: result.playerHp,
    enemyHp: enemyHpAfterDot,
    log: [...s.log, ...lines],
    playedCards:
      action.cardName && !s.playedCards.includes(action.cardName)
        ? [...s.playedCards, action.cardName]
        : s.playedCards,
    counteredBeats: s.counteredBeats + (result.countered ? 1 : 0),
    activeEffects: nextEffects,
  };
  if (next.enemyHp <= 0) {
    return withFinish(next, '胜利', [`▸ 【${s.enemyName}】倒下——胜利！`]);
  }
  if (next.playerHp <= 0) {
    return withFinish(next, '败北', [`▸ 玩家倒下——败北（经验照常结算，评价 C）`]);
  }
  return next;
}

/** 数值碾压速胜：跳过交锋直接结算（评价封顶 S，经验照常） */
export function crushFinish(s: SkirmishSession): SkirmishSession {
  if (s.finished !== null) return s;
  return withFinish(s, '碾压', [`▸ 数值碾压：我方战力达敌方 ×${2} → 跳过交锋，直接结算`]);
}

/** 玩家主动结束战斗（主人裁定 2026-09-13：附结束理由，供终局记叙参考），评价 C */
export function fleeSkirmish(s: SkirmishSession, endReason?: string): SkirmishSession {
  if (s.finished !== null) return s;
  const reason = typeof endReason === 'string' ? endReason.trim().slice(0, 200) : '';
  return {
    ...withFinish(s, '撤退', [
      ...(reason ? [`▸ 冒险者收手：「${reason}」`] : []),
      `▸ 撤退成功——脱离接触（评价 C）`,
    ]),
    ...(reason ? { endReason: reason } : {}),
  };
}

/** 终局结算数据（未结束 → null）。只算账不落库：玩家 EXP/卡牌经验持久化由集成层提交 */
export interface SkirmishSettlement {
  finish: Exclude<SkirmishFinish, null>;
  grade: SkirmishGrade;
  exp: ExpAudit;
  expLines: string[];
  /** 参战卡 → 卡牌经验（每张 = round(总战斗经验 × 50%)） */
  cardExp: { name: string; gain: number }[];
}

export function settleSkirmish(s: SkirmishSession, playerLevel: number): SkirmishSettlement | null {
  if (s.finished === null) return null;
  const grade = gradeBattle({
    fled: s.finished === '撤退',
    crush: s.finished === '碾压',
    defeated: s.finished === '败北',
    totalBeats: s.beat,
    counteredBeats: s.counteredBeats,
    hpLossRatio: s.playerMaxHp > 0 ? (s.playerMaxHp - s.playerHp) / s.playerMaxHp : 1,
  });
  const exp = battleExpChain(s.enemyLevel, playerLevel, grade);
  const gain = cardExpGain(exp.total);
  const cardExp = s.playedCards.map((name) => ({ name, gain }));
  return {
    finish: s.finished,
    grade,
    exp,
    expLines: [
      ...formatExpAudit(exp),
      ...cardExp.map((c) => `▸ 参战卡【${c.name}】分得 ${c.gain} 卡牌经验`),
    ],
    cardExp,
  };
}
