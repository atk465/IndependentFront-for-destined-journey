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
  type CounterTag,
} from './skirmish';
import { activateListOf, type ActivateInput, type CardInPlayEffect } from './entry-combat';
import { duelSuppressesEffect, type DuelRules } from './battle-rules';
import { ENTRY_STRENGTH_BASELINE } from './talent-entry';

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
  /** 本场破封的卡名（结算时同窗持久化 sealed:false） */
  unsealedCards: string[];
  /** 行为合同（SSS 律师函警告）：禁止敌方某类招式，违反则反噬（2026-09-17） */
  contracts?: readonly SkirmishContract[];
  /** 倒也可斩是否已用（每场限一次） */
  nukeUsed?: boolean;
  /** 免死是否已在本场用掉（每场一次的守卫，与 nukeUsed 同款语义） */
  lastStandUsed?: boolean;
  /**
   * 决斗规则（S「西部决斗礼仪」宣战后生效）：禁用在场伙伴卡 + 抑制外部伤害/治疗。
   * 缺省 undefined = 普通战斗，零改写。
   */
  duel?: DuelRules;
  /** 已触发过组合技的双生卡名（每对每场一次的去重账） */
  comboFired?: string[];
  /** 真名看破是否已在本场念过（每场一次的守卫） */
  trueNameUsed?: boolean;
  /** 模块化热插拔本场已用次数（每场次数由条目限） */
  hotSwapsUsed?: number;
  /** 技能冷却账：卡名 → 剩余冷却拍数（战斗维度） */
  cooldowns?: Record<string, number>;
  /** 敌方数量（战斗维度：多敌；缺省 1） */
  enemyCount?: number;
  /** 敌方体型（战斗维度：体格差压制；缺省「常人」） */
  enemyScale?: string;
  /** 禁忌卡本场已用卡名账（每张每场限一次；2026-09-19 禁忌卡七链） */
  forbiddenUsed?: string[];
  /**
   * 体力账（2026-09-25 访谈共识：SP=体力命脉）：开战时玩家 SP 快照与本场已耗。
   * 🔴 只记账不落库——结算层同窗提交 `sp -= spSpent`；每拍实时扣太碎。
   * 力竭判据：playerSp − spSpent ≤ 0 → 败北（与 HP 归零同路径，先到先触发；
   * 复生/免死管死不管累，不救 SP 线）。缺省 undefined = 旧调用零改动。
   */
  playerSp?: number;
  spSpent?: number;
  /** 本场 MP 已耗（主动形态卡打出扣费；结算层提交 `mp -= mpSpent`） */
  mpSpent?: number;
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
  /**
   * 开战即生效的在场效果（**自身状态**用，如「吸魔」每拍回血）。
   * 缺省空——无自身状态的玩家零改动。
   */
  initialEffects?: readonly CardInPlayEffect[];
  /** 决斗规则（S「西部决斗礼仪」）：开战即进入 1v1。缺省 = 普通战斗 */
  duel?: DuelRules;
  /** 敌方数量（战斗维度：多敌；缺省 1） */
  enemyCount?: number;
  /** 敌方体型（战斗维度：体格差压制；缺省「常人」） */
  enemyScale?: string;
  /** 禁忌卡本场已用卡名账（每张每场限一次；2026-09-19 禁忌卡七链） */
  forbiddenUsed?: string[];
  /** 开战时玩家 SP 快照（体力账；缺省 = 不启用体力账，旧测试零迁移） */
  playerSp?: number;
}

const clampHp = (n: number, fallback: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
  return Number.isFinite(v) ? v : 0;
};

const finiteOr = (n: number | undefined, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? n : fallback;

/** 交锋拍 SP 拍耗（2026-09-25 访谈共识）：出卡 5 / 基础应对 3 */
export const SP_COST_PLAY = 5;
export const SP_COST_COUNTER = 3;

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
    ...(input.duel ? { duel: input.duel } : {}),
    activeEffects: (input.initialEffects ?? []).map((e) => ({
      ...e,
      amount: Math.max(0, Math.round(e.amount)),
      ...(e.beatsLeft !== undefined ? { beatsLeft: Math.max(1, e.beatsLeft) } : {}),
    })),
    unsealedCards: [],
    finished: null,
    ...(input.playerSp !== undefined
      ? { playerSp: Math.max(0, Math.round(finiteOr(input.playerSp, 0))) }
      : {}),
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

/** 打一拍的附加裁定（启封/在场激活/反冲） */
/** 一条行为合同：禁止敌方使用带指定反制标签的招式；违反则反噬 */
export interface SkirmishContract {
  /** 合同名（叙事用，如「行为合同·禁火」） */
  name: string;
  /** 禁止的招式标签（敌方意图 counters 含此标签 = 违约） */
  forbidden: CounterTag;
  /** 反噬伤害（真实伤害，不减免） */
  backlash: number;
}

/** 违约判定 + 反噬合计（纯函数）：逐条检查敌方本拍意图是否触碰禁条 */
export function contractBacklash(
  contracts: readonly SkirmishContract[] | undefined,
  intent: Pick<EnemyIntent, 'counters'>,
): { total: number; violated: SkirmishContract[] } {
  const violated: SkirmishContract[] = [];
  let total = 0;
  for (const c of contracts ?? []) {
    if ((intent.counters ?? []).includes(c.forbidden)) {
      violated.push(c);
      total += Math.max(0, Math.round(c.backlash));
    }
  }
  return { total, violated };
}

export interface BeatOptions {
  /** 本拍打出的在场卡（领域/场景/装备/召唤/军团），效果从下一拍起生效 */
  /** 本拍激活的在场效果（单条；战技附加会带来第二条，故也接受数组） */
  activate?: ActivateInput;
  /** 本拍 MP 扣费（主动形态卡；2026-09-25 访谈共识。拦人在 cardPlayPlan，这里只记账） */
  mpCost?: number;
  /** 启封判定等前置审计行（置于意图行之后、拍审计之前） */
  prepend?: string[];
  /** 暴走/反噬反冲：拍末玩家 HP −n（clamp 0，可致死 → 败北） */
  recoil?: number;
  /** 本拍破封的卡名 → 记入 unsealedCards（结算持久化 sealed:false） */
  sealBroke?: string;
  /** 倒也可斩（每场限一次，一次性大招） */
  nuke?: boolean;
  /** 倒也可斩的抹除强度：按敌方当前 HP 的百分比（缺省 = 基准 50） */
  nukePercent?: number;
  /** 本拍登记的行为合同（SSS 律师函警告；从下一拍起判定违约） */
  contract?: SkirmishContract;
  /** 第六终章（SSS）：第 N 拍起敌方被即刻抹除（巨额真实伤害，无视一切减免） */
  finalChapter?: boolean;
  /** 终章发动拍次（条目 `终章{beats}` 的强度档；缺省 = 基准 6） */
  finalChapterBeats?: number;
  /**
   * 免死（S「绞刑架幸存者」）：本拍玩家 HP 会被打到 0 时，锁血到 `hpFloor` 续战。
   * 由调用方按「持天赋 且 本场没用过」决定是否传；不传 = 没有免死。
   */
  lastStand?: { hpFloor: number };
  /** 本拍触发组合技后要记入账本的卡名（调用方算好，会话只落账） */
  comboFired?: string[];
  /** 本拍念出了真名 → 记入会话账（每场一次） */
  trueNameUsed?: boolean;
  // ── 禁忌卡六正本（2026-09-19 七链；每张每场限一次，代价由调用方结算层落） ──
  /** 本拍打出的禁忌卡名（守卫：同名每场一次；落 forbiddenUsed 账） */
  forbiddenCard?: string;
  /** 无名河·除名：敌方从本场战斗中彻底抹去（即刻终局·胜利） */
  barrenName?: boolean;
  /** 失年历·岁除：敌方状态回溯至入场之时（跳过下两轮） */
  ageEnd?: boolean;
  /** 焚天引·天罚：无视减免的真实伤害（敌方 max(当前,上限) 的 70%），打出后玩家 HP 锁 1 */
  heavenScourge?: boolean;
  /** 万兽园·兽潮：无期限的援军持续伤害（每拍结算） */
  beastTideAmount?: number;
  /** 称心秤·许愿：small=全回复 / mid=把敌方称到另一端（终局·胜利）/ grand=全回复+敌方跳两轮 */
  wish?: 'small' | 'mid' | 'grand';
  /** 白蜡城·蜡封之夜：敌方跳过下两轮 + 玩家回复最大气血的三成 */
  waxNight?: boolean;
}

export const FINAL_CHAPTER_BEAT = ENTRY_STRENGTH_BASELINE.终章.beats;
/** 倒也可斩的抹除百分比基准（50% 敌方当前 HP；由 name 型规则钩子带值，见 talent-hooks） */
export const NUKE_PERCENT = 50;

/** 打一拍：拍结算 + 记账 + 终局判定（只按 HP 归零终局；拍数不限，招式轮换）。
 *  未开始/已结束/无敌方招式 → 原样返回（幂等） */
export function playBeat(
  s: SkirmishSession,
  action: SkirmishAction,
  dice: number,
  opts?: BeatOptions,
): SkirmishSession {
  const intent = currentIntent(s);
  if (!intent) return s;

  // 倒也可斩：一次性大威力攻击（缺省 50% 敌方当前 HP），消耗 90% 玩家 HP/MP
  // 🔴 每场限一次（2026-09-17）：session.nukeUsed 守卫，重复请求按未请求处理
  const nukeRequested = opts?.nuke === true && s.nukeUsed !== true;
  const nukePct = Math.max(1, Math.round(opts?.nukePercent ?? NUKE_PERCENT));
  const nukeDamage = nukeRequested ? Math.max(1, Math.round((s.enemyHp * nukePct) / 100)) : 0;

  // 在场战技：眩晕（敌方本拍放弃行动）/ 减速（威胁降低），只在剩余拍数内生效
  const live = s.activeEffects.filter((e) => e.beatsLeft === undefined || e.beatsLeft > 0);
  const stunActive = live.some((e) => e.type === 'stun');
  const weakenTotal = live
    .filter((e) => e.type === 'weaken')
    .reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  const effectiveIntent = stunActive
    ? { ...intent, threat: 0 }
    : weakenTotal > 0
      ? { ...intent, threat: Math.max(0, intent.threat - weakenTotal) }
      : intent;
  const effectLines: string[] = [];
  if (stunActive) effectLines.push(`▸ 敌方被【眩晕】——本拍放弃行动`);
  else if (weakenTotal > 0) effectLines.push(`▸ 减速战技：敌方威胁 −${weakenTotal}`);

  // 在场加成（此前打出的领域/装备/召唤…）：行动值先行叠加，审计单列一行可复算
  const buffTotal = s.activeEffects
    .filter((e) => e.type === 'buff')
    .reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  const effectiveAction =
    buffTotal > 0 ? { ...action, power: Math.max(0, action.power) + buffTotal } : action;

  const result = resolveBeat({
    intent: effectiveIntent,
    action: effectiveAction,
    playerHp: s.playerHp,
    enemyHp: s.enemyHp,
    guard: s.guard,
    dice,
  });
  const lines = [
    // 出卡宣言（主人裁定：玩家写这张牌用来做什么，纯叙事素材，置于拍审计之前）
    ...(action.note ? [`▸ 意图：${action.note}`] : []),
    ...(opts?.prepend ?? []),
    ...effectLines,
    ...(buffTotal > 0 ? [`▸ 在场加成：行动值 +${buffTotal}`] : []),
    ...result.audit,
  ];

  // 在场持续伤害（领域 DoT）：拍末结算，可收到人头。
  // 决斗中场地不在场（免疫一切外部伤害）→ 抑制不结算。
  const dotSuppressed = duelSuppressesEffect('dot', s.duel);
  const dotTotal = dotSuppressed
    ? 0
    : s.activeEffects
        .filter((e) => e.type === 'dot')
        .reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  const enemyHpAfterDot = Math.max(0, result.enemyHp - dotTotal);
  if (dotTotal > 0 && result.enemyHp > 0) {
    lines.push(`▸ 在场持续：敌方 −${dotTotal}（${result.enemyHp} → ${enemyHpAfterDot}）`);
  } else if (dotSuppressed && s.activeEffects.some((e) => e.type === 'dot')) {
    lines.push('▸ 【决斗】场地不在场——持续伤害被隔离（免疫一切外部伤害）');
  }

  // 倒也可斩 nuke 伤害（拍末追加，可收人头）
  const afterNuke = nukeDamage > 0 ? Math.max(0, enemyHpAfterDot - nukeDamage) : enemyHpAfterDot;
  if (nukeDamage > 0) {
    lines.push(`▸ 倒也可斩：敌方 −${nukeDamage}（${enemyHpAfterDot} → ${afterNuke}）`);
  }

  // 行为合同反噬（SSS 律师函警告）：敌方本拍意图触碰禁条 → 真实伤害
  const contractHit = contractBacklash(s.contracts, intent);
  const afterContract = Math.max(0, afterNuke - contractHit.total);
  if (contractHit.total > 0) {
    lines.push(
      `▸ 行为合同违约（${contractHit.violated.map((c) => c.name).join('、')}）：敌方 −${contractHit.total} 真实伤害（${afterNuke} → ${afterContract}）`,
    );
  }

  // 终章：第 N 拍起敌方被即刻抹除（无视减免；N 缺省 6）
  const chapterAt = Math.max(1, Math.round(opts?.finalChapterBeats ?? FINAL_CHAPTER_BEAT));
  const chapterActive = opts?.finalChapter === true && s.beat + 1 >= chapterAt;
  if (chapterActive && afterContract > 0) {
    lines.push(`▸ 【第六终章】第 ${s.beat + 1} 次行动——抹除发动：敌方 −${afterContract}（归零）`);
  }
  let enemyHpFinal = chapterActive ? 0 : afterContract;

  // ── 禁忌卡六正本（2026-09-19 七链；每张每场限一次，代价由调用方结算层落） ──
  const forbiddenCard = opts?.forbiddenCard;
  const forbiddenGuard = !!forbiddenCard && !(s.forbiddenUsed ?? []).includes(forbiddenCard);
  let playerHpOverride: number | null = null;
  if (forbiddenGuard && forbiddenCard) {
    // 无名河·除名：从本场战斗中彻底抹去一名敌人（无论气血深浅）→ 即刻终局
    if (opts?.barrenName === true) {
      lines.push(
        `▸ 【禁忌卡·无名河】除名发动——河水漫过它的铭文：【${s.enemyName}】从这场战斗中被彻底抹去`,
      );
      enemyHpFinal = 0;
    }
    // 失年历·岁除：敌方状态回溯至入场之时，并跳过下两轮
    if (opts?.ageEnd === true) {
      lines.push(`▸ 【禁忌卡·失年历】岁除发动——被撕的那一页盖下：敌方回溯至入场之时，并失去下两轮`);
    }
    // 焚天引·天罚：无视一切减免的真实伤害 + 玩家 HP 锁 1（你在裂痕正下方）
    if (opts?.heavenScourge === true) {
      const scourge = Math.max(1, Math.round(Math.max(enemyHpFinal, s.enemyMaxHp) * 0.7));
      lines.push(`▸ 【禁忌卡·焚天引】天罚发动——撕裂法则的一击：敌方 −${scourge}（无视一切减免）`);
      enemyHpFinal = Math.max(0, enemyHpFinal - scourge);
      playerHpOverride = 1;
      lines.push(`▸ 【焚天引】代价兑现——你在裂痕正下方：HP 锁至 1`);
    }
    // 万兽园·兽潮：无期限援军（每拍结算持续伤害，不可消灭）
    const tide = opts?.beastTideAmount;
    if (typeof tide === 'number' && tide > 0) {
      lines.push(`▸ 【禁忌卡·万兽园】园门大开——兽潮涌入（此后每拍敌方 −${tide}，不可消灭）`);
    }
    // 称心秤·许愿：small=全回复 / mid=把敌方称到另一端 / grand=全回复+敌方跳两轮
    const wish = opts?.wish;
    if (wish === 'small') {
      lines.push(`▸ 【禁忌卡·称心秤】小愿兑现——全队气血回复如初`);
      playerHpOverride = s.playerMaxHp;
    } else if (wish === 'mid') {
      lines.push(
        `▸ 【禁忌卡·称心秤】中愿兑现——砝码落下：【${s.enemyName}】被称到秤的另一端（战斗结束才回来）`,
      );
      enemyHpFinal = 0;
    } else if (wish === 'grand') {
      lines.push(`▸ 【禁忌卡·称心秤】大愿兑现——败局被称了回去：全队气血回复如初，敌方失去下两轮`);
      playerHpOverride = s.playerMaxHp;
    }
    // 白蜡城·蜡封之夜：敌方跳过下两轮 + 玩家回复最大气血的三成
    if (opts?.waxNight === true) {
      const heal = Math.max(1, Math.round(s.playerMaxHp * 0.3));
      lines.push(
        `▸ 【禁忌卡·白蜡城】蜡封之夜发动——战场封进城里的一夜：敌方静止两轮，你回复 ${heal} HP`,
      );
      playerHpOverride =
        playerHpOverride === null
          ? Math.min(s.playerMaxHp, s.playerHp + heal)
          : Math.min(playerHpOverride + heal, s.playerMaxHp);
    }
  }

  // 暴走/反噬反冲（启封失败的代价）：拍末玩家扣血，可致死
  const recoil = opts?.recoil ?? 0;
  const playerHpAfterRecoil = Math.max(0, result.playerHp - Math.max(0, Math.round(recoil)));
  if (recoil > 0) {
    lines.push(
      `▸ 失控反冲：玩家 −${Math.round(recoil)}（${result.playerHp} → ${playerHpAfterRecoil}）`,
    );
  }

  // 自身状态·吸魔（regen）：拍末把吸收到的攻击转成 HP 回复（上限 = HP 上限）
  const regenTotal = duelSuppressesEffect('regen', s.duel)
    ? 0
    : s.activeEffects
        .filter((e) => e.type === 'regen')
        .reduce((sum, e) => sum + Math.max(0, Math.round(e.amount)), 0);
  const playerHpAfterRegen =
    regenTotal > 0
      ? Math.min(s.playerMaxHp, playerHpAfterRecoil + regenTotal)
      : playerHpAfterRecoil;
  if (regenTotal > 0 && playerHpAfterRegen > playerHpAfterRecoil) {
    lines.push(
      `▸ 【自身状态·吸魔】回复 ${playerHpAfterRegen - playerHpAfterRecoil}（${playerHpAfterRecoil} → ${playerHpAfterRegen}）`,
    );
  }

  // 禁忌卡 HP 覆盖（天罚锁 1 / 许愿回复 / 蜡封回复）——优先级高于反冲与吸魔
  const playerHpAfterOverride =
    playerHpOverride !== null ? Math.min(playerHpOverride, s.playerMaxHp) : playerHpAfterRegen;
  if (playerHpOverride !== null && playerHpAfterOverride !== playerHpAfterRegen) {
    lines.push(`▸ 禁忌之力改写了你的气血：${playerHpAfterRegen} → ${playerHpAfterOverride}`);
  }

  // 免死（绞刑架幸存者）：HP 本会归零 → 锁血续战（每场一次；MP 回满由调用方落库）
  const lastStand = opts?.lastStand;
  const lastStandFires = !!lastStand && playerHpAfterOverride <= 0 && s.lastStandUsed !== true;
  const playerHpFinal =
    lastStandFires && lastStand
      ? Math.max(1, Math.round(lastStand.hpFloor))
      : playerHpAfterOverride;
  if (lastStandFires) {
    lines.push(
      `▸ 【绞刑架幸存者】颈上的旧痕绷紧了——锁血至 ${playerHpFinal} HP，你没有倒下（本场仅此一次）`,
    );
  }

  // 本拍激活的在场卡：效果自下一拍起生效（带持续拍数的每拍递减，归零移除）
  const decremented = s.activeEffects.map((e) =>
    e.beatsLeft !== undefined ? { ...e, beatsLeft: Math.max(0, e.beatsLeft - 1) } : e,
  );
  const activateList = activateListOf(opts?.activate);
  const stunBeats: number | null =
    (opts?.ageEnd === true && forbiddenGuard) || (opts?.waxNight === true && forbiddenGuard)
      ? 2
      : opts?.wish === 'grand' && forbiddenGuard
        ? 2
        : null;
  const tideAmount: number | null =
    opts?.beastTideAmount !== undefined && forbiddenGuard ? opts.beastTideAmount : null;
  const nextEffects = [
    ...decremented.filter((e) => e.beatsLeft === undefined || e.beatsLeft > 0),
    ...activateList.map((a) => ({
      name: a.name,
      type: a.type,
      amount: Math.max(0, Math.round(a.amount)),
      ...(a.beatsLeft !== undefined ? { beatsLeft: Math.max(1, a.beatsLeft) } : {}),
      // 领域/场景卡建立的环境随效果存续（环境加成天赋据此判定）
      ...(a.env ? { env: a.env } : {}),
    })),
    // 禁忌卡效果（岁除/蜡封之夜/大愿=stun；兽潮=无期限 dot）
    ...(stunBeats !== null
      ? [
          {
            name: forbiddenCard ?? '禁忌卡',
            type: 'stun' as const,
            amount: 0,
            beatsLeft: stunBeats,
          },
        ]
      : []),
    ...(tideAmount !== null
      ? [{ name: forbiddenCard ?? '禁忌卡', type: 'dot' as const, amount: tideAmount }]
      : []),
  ];
  for (const a of activateList) {
    const line =
      a.type === 'dot'
        ? `灼烧生效——此后每拍敌方 −${a.amount}`
        : a.type === 'buff'
          ? `助阵生效——此后每拍行动值 +${a.amount}`
          : a.type === 'weaken'
            ? `减速生效——此后每拍敌方威胁 −${a.amount}`
            : `震慑生效——敌方将短暂失去战意`;
    lines.push(`▸ 【${a.name}】${line}`);
  }

  const next: SkirmishSession = {
    ...s,
    beat: s.beat + 1,
    playerHp: playerHpFinal,
    ...(lastStandFires ? { lastStandUsed: true } : {}),
    ...(opts?.comboFired ? { comboFired: opts.comboFired } : {}),
    ...(opts?.trueNameUsed ? { trueNameUsed: true } : {}),
    ...(forbiddenCard && forbiddenGuard
      ? { forbiddenUsed: [...(s.forbiddenUsed ?? []), forbiddenCard] }
      : {}),
    ...(s.duel ? { duel: s.duel } : {}),
    ...(s.hotSwapsUsed ? { hotSwapsUsed: s.hotSwapsUsed } : {}),
    ...(s.enemyCount !== undefined ? { enemyCount: s.enemyCount } : {}),
    ...(s.enemyScale !== undefined ? { enemyScale: s.enemyScale } : {}),
    enemyHp: enemyHpFinal,
    log: [...s.log, ...lines],
    playedCards:
      action.cardName && !s.playedCards.includes(action.cardName)
        ? [...s.playedCards, action.cardName]
        : s.playedCards,
    counteredBeats: s.counteredBeats + (result.countered ? 1 : 0),
    activeEffects: nextEffects,
    unsealedCards:
      opts?.sealBroke && !s.unsealedCards.includes(opts.sealBroke)
        ? [...s.unsealedCards, opts.sealBroke]
        : s.unsealedCards,
    // 合同登记（同名同禁条不重复；本拍登记的从下一拍才开始判定——本拍已用旧清单判过）
    ...(opts?.contract
      ? {
          contracts: [
            ...(s.contracts ?? []).filter(
              (c) => !(c.name === opts.contract!.name && c.forbidden === opts.contract!.forbidden),
            ),
            opts.contract,
          ],
        }
      : {}),
    ...(nukeRequested ? { nukeUsed: true } : {}),
  };
  if (next.enemyHp <= 0) {
    return withFinish(next, '胜利', [`▸ 【${s.enemyName}】倒下——胜利！`]);
  }
  if (next.playerHp <= 0) {
    return withFinish(next, '败北', [`▸ 玩家倒下——败北（经验照常结算，评价 C）`]);
  }
  // ── 体力账（2026-09-25 访谈共识）：出卡 5 SP / 基础应对 3 SP，拍拍扣 ──
  // MP 只记账不拦人（拦截在 cardPlayPlan 的硬门槛）；SP 归零 = 力竭败北，
  // 与 HP 归零同路径、先到先触发（敌方先倒下已在上面的胜利分支收口）。
  if (s.playerSp !== undefined) {
    const spCost = action.cardName ? SP_COST_PLAY : SP_COST_COUNTER;
    const mpCost = Math.max(0, Math.round(opts?.mpCost ?? 0));
    const spSpent = (s.spSpent ?? 0) + spCost;
    const lines2 = [
      `▸ 体力 −${spCost}（剩 ${Math.max(0, s.playerSp - spSpent)}）`,
      ...(mpCost > 0 ? [`▸ 精神 −${mpCost}`] : []),
    ];
    const withSpend: SkirmishSession = {
      ...next,
      spSpent,
      ...(mpCost > 0 ? { mpSpent: (s.mpSpent ?? 0) + mpCost } : {}),
      log: [...next.log, ...lines2],
    };
    if (s.playerSp - spSpent <= 0) {
      return withFinish(withSpend, '败北', [
        `▸ 体力耗尽——你扶着膝盖喘息，再抬不起手（力竭败北，经验照常结算，评价 C）`,
      ]);
    }
    return withSpend;
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

export function settleSkirmish(
  s: SkirmishSession,
  playerLevel: number,
  expMultiplier = 1,
): SkirmishSettlement | null {
  if (s.finished === null) return null;
  const grade = gradeBattle({
    fled: s.finished === '撤退',
    crush: s.finished === '碾压',
    defeated: s.finished === '败北',
    totalBeats: s.beat,
    counteredBeats: s.counteredBeats,
    hpLossRatio: s.playerMaxHp > 0 ? (s.playerMaxHp - s.playerHp) / s.playerMaxHp : 1,
  });
  const exp = battleExpChain(s.enemyLevel, playerLevel, grade, expMultiplier);
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
