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
  counterBonusOf,
  type EnemyIntent,
  type ExpAudit,
  type SkirmishAction,
  type SkirmishGrade,
  type CounterTag,
} from './skirmish';
import { activateListOf, type ActivateInput, type CardInPlayEffect } from './entry-combat';
import { duelSuppressesEffect, type DuelRules } from './battle-rules';
import { ENTRY_STRENGTH_BASELINE } from './talent-entry';
import { conditionsMet, effectLineOf, type CardEffectDef } from './card-effects';
import {
  aggregateDamage,
  coerceDifficulty,
  resolveSkillAmount,
  type Difficulty,
} from './multiplier';

/**
 * 技能公式上下文（v2 共识·替换制）：出卡拍由调用方组装传入。
 * 缺省 = 旧定值轨（2026-09-25 池定值语义；过渡双轨，批次 3 接线后删除）。
 */
export interface SkillContext {
  /** 主轴派生（deriveCardAtk：2×对应属性+等级） */
  mainDerivation: number;
  /** 副轴（门禁后的合法集，派生由调用方按面板算好） */
  secondary: readonly { axis: string; bonus: number; derivation: number }[];
  /** 难度档（敌情评估 AI 开战选定；脏值兜底标准表） */
  difficulty: Difficulty;
}

/** A 类 dot/护盾群（skill 轨：每拍量按难度表出手快照，Q12；削减族与 % 状态保持定点） */
const DOT_LIKE: ReadonlySet<string> = new Set([
  '中毒',
  '灼烧',
  '流血',
  '混乱',
  '标记',
  '寄生',
  '感染',
  '连携锚',
  '反伤',
  '护盾',
  '格挡',
]);

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
  /** 难度档（v2 共识：评估 AI 开战选定，整场锁定；脏值兜底标准表） */
  difficulty?: Difficulty;
  /** 敌方体型（战斗维度：体格差压制；缺省「常人」） */
  enemyScale?: string;
  /** 禁忌卡本场已用卡名账（每张每场限一次；2026-09-19 禁忌卡七链） */
  forbiddenUsed?: string[];
  /**
   * 敌人实体（2026-09-28 多敌实体化共识）：每个敌人独立 HP/意图轮换/状态/角色。
   * 缺省 undefined = 单实体退化（enemyHp 兼容字段照旧），旧存档与旧调用零迁移。
   * 首领/杂兵：首领倒下才胜利；杂兵存活给首领护卫减伤（每只 −20%，三只封顶 −60%）。
   */
  enemies?: readonly EnemyEntity[];
  /** 当前指定目标（enemies 下标）；缺省 = 威胁最高的存活敌 */
  targetIndex?: number;
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
  /** 效果池：本场敌方防护累计削减（破防；resolveBeat 侧 guard 减它） */
  guardDown?: number;
  /** 效果池：本场 MP 累计回复（凝神；结算层与 mpSpent 轧差落库） */
  mpGained?: number;
  /**
   * 治疗时响应（效果批六）：本场登记的「治疗时」效果（来自打出的卡）。
   * 每当本拍发生治疗，逐条触发一次（每拍每条至多一次）。
   */
  healResponses?: { name: string; action: string; value: number }[];
  /**
   * 交锋内事件账本（效果批七·条件位）：八事件计数器，拍拍递增、会话结束清零。
   * 条件效果（conditions）据此判定；缺省 undefined = 无事件发生（条件引用按 0 算）。
   */
  beatEvents?: Partial<Record<import('./card-effects').BeatEvent, number>>;
}

/** 单个敌人实体（多敌实体化 2026-09-28） */
export interface EnemyEntity {
  /** 敌名（同场可重名，内部以下标区分） */
  name: string;
  role: '首领' | '杂兵';
  hp: number;
  maxHp: number;
  /** 该敌的意图轮换（循环使用） */
  intents: readonly EnemyIntent[];
  /** 轮换游标 */
  intentIndex: number;
  /** 逐敌独立登记的负面状态（效果批五/六语义：各自层数与剩余拍数） */
  statuses: { name: string; type: string; amount: number; beatsLeft?: number }[];
  /** 风格（拖时间/爆发/均衡…，评估 Agent 定，仅叙事与数值标定参考） */
  style?: string;
  /** 是否已退场（HP 归零；退场后意图不再结算） */
  dead?: boolean;
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
  /** 难度档（v2 共识：评估 AI 开战选定；脏值兜底标准表） */
  difficulty?: unknown;
  /** 敌方体型（战斗维度：体格差压制；缺省「常人」） */
  enemyScale?: string;
  /** 禁忌卡本场已用卡名账（每张每场限一次；2026-09-19 禁忌卡七链） */
  forbiddenUsed?: string[];
  /** 开战时玩家 SP 快照（体力账；缺省 = 不启用体力账，旧测试零迁移） */
  playerSp?: number;
  /**
   * 多敌实体（2026-09-28 多敌实体化）：每敌独立 HP/意图轮换/角色（首领|杂兵）。
   * 传入即启用多敌模式（enemyHp 单池兼容字段照旧可用作首领血量）；缺省 = 单敌。
   */
  enemies?: readonly {
    name: string;
    role?: '首领' | '杂兵';
    hp: number;
    intents: readonly EnemyIntent[];
    style?: string;
  }[];
  /** 开战即登记的治疗时响应（效果批六；测试与特殊遭遇用） */
  healResponses?: { name: string; action: string; value: number }[];
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
    difficulty: coerceDifficulty(input.difficulty),
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
    ...(input.healResponses ? { healResponses: input.healResponses } : {}),
    ...(input.enemies && input.enemies.length > 0
      ? {
          enemies: input.enemies.map((e) => ({
            name: e.name,
            role: (e.role ?? '杂兵') as '首领' | '杂兵',
            hp: clampHp(e.hp, 0),
            maxHp: clampHp(e.hp, 0),
            intents: e.intents,
            intentIndex: 0,
            statuses: [],
            ...(e.style ? { style: e.style } : {}),
            dead: false,
          })),
        }
      : {}),
  };
  // 无敌方招式（评估被夹逼成空）→ 不战自溃，UI 永不卡在无拍可打的账本上
  if (intents.length === 0 && !(session.enemies && session.enemies.some((e) => !e.dead))) {
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
  /**
   * 本拍打出的卡带来的结构化效果（2026-09-25 效果池；调用方 deriveCardEffects 算好传入）。
   * 翻译规则见 translateCardEffects：动作层即时结算进拍账，状态层入 activeEffects。
   */
  effects?: readonly CardEffectDef[];
  /** 敌方数量（敌全体倍化用；缺省 1）——与 session.enemyCount 同源，避免再读会话 */
  enemyCount?: number;
  /** 技能公式上下文（v2 共识·替换制）：出卡拍传 → A 类公式化+乘区链；缺省旧定值轨 */
  skill?: SkillContext;
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
// ═══ 效果池翻译（2026-09-25：CardEffectDef → 拍内结算） ═══

/** 翻译结果：动作层的即时结算值 + 状态层的在场登记 */
export interface TranslatedEffects {
  /** 打出时·伤害 → 行动值追加（skill 轨：技能公式点数合计） */
  powerBonus: number;
  /** 打出时·连击 → 行动值乘区（1.5 = +50%；与 powerBonus 相乘前先加；skill 轨弃用） */
  powerMult: number;
  /**
   * Q7' 重定基：Σ「本拍伤害+%」（连击族/觉醒/狂暴/时间裂缝/连锁风暴/夺式/分支——
   * 乘区链加算层 1；skill 轨专用，旧轨恒 0）
   */
  powerBonusPct: number;
  /** 打出时·治疗/吸血 → 拍末玩家 HP 回复（吸血按本拍对敌伤害折算在 playBeat 内补） */
  heal: number;
  /** 打出时·凝神 → 拍末 MP 回复（落库由结算层） */
  mpHeal: number;
  /** 打出时·破防 → 本场敌方防护削减（累计） */
  guardDown: number;
  /** 打出时·真实伤害 → 拍末无视减免直扣敌方 HP（2026-09-25 效果批一） */
  directDamage?: number;
  /** 打出时·斩杀线（% of 敌方上限；效果批二） */
  executePct?: number;
  /** 打出时·窥探（效果批八）：本拍战报揭示敌方完整招式轮换 */
  revealRotation?: boolean;
  /** 打出时·分支（效果批八）：掷骰定路——骰成走伤害路，骰败走回复路 */
  branch?: { successDamage: number; fallbackHeal: number };
  /** 打出时·终结一击（效果批九）：按敌方已损失气血 % 计真实伤害 */
  finisherPct?: number;
  /** 打出时·断章（效果批十）：本拍敌方随机换式（骰子驱动）且威胁减半 */
  suddenShift?: boolean;
  /** 打出时·夺式（效果批十）：窃取敌方最强一式之力（最高威胁一半，上限 12） */
  stealForm?: boolean;
  /** 打出时·连锁风暴（效果批十）：行动值 +base%，每层在场效果再 +perEffect% */
  chainStorm?: { base: number; perEffect: number };
  /** 打出时·赌一手（效果批十一）：押注本拍反制结果——注金/彩头/失手伤 */
  bet?: { stake: number; winHeal: number; winMp: number; loseHurt: number };
  /** 拍结束·伤害（效果批五）：全部结算完成后直扣敌方 */
  endBeatDamage?: number;
  /** 拍结束·治疗（效果批五）：并入玩家 HP 链 */
  endBeatHeal?: number;
  /** 消耗时效果（效果批五）：消耗结算时落给玩家（治疗/MP） */
  onConsume?: { action: string; value: number }[];
  /** 治疗时效果（效果批六）：登记为本场响应（打出的卡带此触发时） */
  healResponses?: { name: string; action: string; value: number }[];
  /** 击杀时效果（效果批三：汲取等；胜利时结算） */
  onKill?: { action: string; value: number }[];
  /** 条件不满足的效果（效果批七：空过，战报注明） */
  skipped?: { effect: CardEffectDef; reason: string }[];
  /** 状态层 → 在场登记（叠层合并后） */
  activate: CardInPlayEffect[];
  /** 审计行 */
  lines: string[];
}

/**
 * CardEffectDef[] → 拍内结算件。敌全体按 enemyCount 倍化（单血池语义：打一群就是
 * 打得多）。吸血拆两半：即时 HP 按 value 三成、真伤折算部分并入本拍对敌伤害
 * ——初稿只做定值半（value 三成），伤害折算另批精化。
 */
export function translateCardEffects(
  effects: readonly CardEffectDef[] | undefined,
  enemyCount: number,
  ledger?: Partial<Record<import('./card-effects').BeatEvent, number>>,
  skill?: SkillContext,
): TranslatedEffects {
  const out: TranslatedEffects = {
    powerBonus: 0,
    powerMult: 1,
    powerBonusPct: 0,
    heal: 0,
    mpHeal: 0,
    guardDown: 0,
    activate: [],
    lines: [],
  };
  if (!effects || effects.length === 0) return out;
  const mult = Math.max(1, Math.round(enemyCount));
  // v2 共识·替换制（skill 轨）：A 类输出量按三套难度表换算成公式点数（出手快照），
  // Q7' 重定基的 B 类「本拍伤害+%」进乘区加算层；旧轨维持池定值语义（批次 3 删）。
  const skillify = (e: CardEffectDef): number => {
    if (!skill) return e.value;
    const r = resolveSkillAmount({
      action: e.action,
      difficulty: skill.difficulty,
      mainDerivation: skill.mainDerivation,
      secondary: skill.secondary,
    });
    const base = r.mainAmount + r.secondaryAmount;
    return e.target === '敌全体' ? base * mult : base;
  };
  const formulaLine = (e: CardEffectDef, amt: number): string => {
    if (!skill) return `${amt}`;
    const r = resolveSkillAmount({
      action: e.action,
      difficulty: skill.difficulty,
      mainDerivation: skill.mainDerivation,
      secondary: skill.secondary,
    });
    return skill.secondary.length > 0
      ? `${r.mainAmount}+副轴${r.secondaryAmount}`
      : `${r.mainAmount}`;
  };
  for (const e of effects) {
    // 条件位（效果批七）：不满足 → 空过+战报注明
    if (!conditionsMet(e.conditions, ledger)) {
      out.skipped = out.skipped ?? [];
      out.skipped.push({ effect: e, reason: '条件未满足' });
      out.lines.push(`▸ 【效果】${e.action}——条件未满足，本拍空过`);
      continue;
    }
    const scaled = e.target === '敌全体' ? e.value * mult : e.value;
    // skill 轨：A 类输出量按难度表换算（出手快照）；旧轨维持池定值
    const scaledAmt = skill ? skillify(e) : scaled;
    switch (e.action) {
      case '伤害':
        // 拍结束触发（效果批五）：不进行动值，延迟到拍末全部结算后直扣敌方
        if (e.trigger === '拍结束') {
          out.endBeatDamage = (out.endBeatDamage ?? 0) + scaledAmt;
          out.lines.push(`▸ 【效果】拍末追加 ${scaledAmt} 伤害`);
          break;
        }
        out.powerBonus += scaledAmt;
        out.lines.push(
          `▸ 【效果】直接伤害 +${scaledAmt}${skill ? `（公式 ${formulaLine(e, scaledAmt)}）` : ''}`,
        );
        break;
      case '连击':
      case '双击':
      case '风怒':
        if (skill) {
          // Q7' 重定基：本拍行动值+% → 本拍伤害+%（乘区链加算层 1）
          out.powerBonusPct += scaled;
          out.lines.push(`▸ 【效果】【${e.action}】本拍伤害 +${scaled}%`);
        } else {
          out.powerMult *= 1 + scaled / 100;
          out.lines.push(`▸ 【效果】【${e.action}】本拍行动值 +${scaled}%`);
        }
        break;
      case '穿透':
        if (skill) {
          // Q22 归并威胁族：敌方防护轴取消 → 敌方威胁 −8（本场）
          out.activate.push({
            name: '穿透',
            type: 'weaken',
            amount: e.value,
          });
          out.lines.push(`▸ 【效果】穿透：敌方威胁 −${e.value}（本场）`);
        } else {
          out.guardDown += scaled;
          out.lines.push(`▸ 【效果】穿透：敌方防护 −${scaled}（本场）`);
        }
        break;
      case '治疗':
        // 每拍触发：持续回复 → regen 在场效果（领域/装备型持续治疗）
        if (e.trigger === '每拍') {
          out.activate.push({
            name: e.action,
            type: 'regen',
            amount: scaledAmt,
            beatsLeft: Math.max(1, Math.round(e.duration ?? 2)),
          });
          out.lines.push(`▸ 【效果】持续回复：此后每拍 +${scaledAmt} HP`);
          break;
        }
        // 拍结束触发：治疗并入拍末 HP 链（与常规治疗同通道、时机在拍末）
        if (e.trigger === '拍结束') {
          out.endBeatHeal = (out.endBeatHeal ?? 0) + scaledAmt;
          out.lines.push(`▸ 【效果】拍末回复 ${scaledAmt} HP`);
          break;
        }
        out.heal += scaledAmt;
        out.lines.push(`▸ 【效果】回复 ${scaledAmt} HP`);
        break;
      case '吸血':
        out.heal += Math.round(scaledAmt * 0.3);
        out.powerBonus += scaledAmt;
        out.lines.push(`▸ 【效果】吸血：伤害 +${scaledAmt}，并回复其三成`);
        break;
      case '破防':
        if (skill) {
          // Q22 归并威胁族：敌方防护轴取消 → 敌方威胁 −4（本场）
          out.activate.push({ name: '破防', type: 'weaken', amount: e.value });
          out.lines.push(`▸ 【效果】破防：敌方威胁 −${e.value}（本场）`);
        } else {
          out.guardDown += scaled;
          out.lines.push(`▸ 【效果】破防：敌方防护 −${scaled}（本场）`);
        }
        break;
      case '驱散':
        // 拍制下敌方无增益系统（2026-09-25 实现期替换：凝神）——保留类型位，结算走 mpHeal
        out.mpHeal += 10;
        out.lines.push(`▸ 【效果】凝神：MP +10`);
        break;
      case '真实伤害':
        // 无视护盾/减免：直接从敌方 HP 扣（敌方防护减免对它无效）——标记为真实，结算层扣
        out.directDamage = (out.directDamage ?? 0) + scaled;
        out.lines.push(`▸ 【效果】真实伤害 ${scaled}（无视一切减免）`);
        break;
      case '斩杀':
      case '超杀':
      case '处决':
        // 终局判定在 playBeat（敌方 HP% 对阈值）；此处只登记阈值（多条取最高线）
        out.executePct = Math.max(out.executePct ?? 0, e.value);
        out.lines.push(`▸ 【效果】${e.action}线 ${e.value}%（当前气血低于此线直接击杀）`);
        break;
      case '窥探':
        // 信息效果（效果批八）：读侧-only，轮换正文在 playBeat 依敌方实体现拼
        out.revealRotation = true;
        out.lines.push(`▸ 【效果】窥探：敌方的招式轮换在你眼前摊开`);
        break;
      case '分支':
        // 掷骰分支（效果批八）：骰子只有 playBeat 有——此处只登记两路口径
        out.branch = { successDamage: scaled, fallbackHeal: 8 };
        out.lines.push(`▸ 【效果】分支：命运掷骰，杀伐或回护各安一途`);
        break;
      case '终结一击':
        // 特殊类（效果批九）：斩杀线同族——伤害侧按已损失气血 %，playBeat 依敌方实体现算
        out.finisherPct = scaled;
        out.lines.push(`▸ 【效果】终结一击：斩得越深越痛（已损失气血 ${scaled}% 计真伤）`);
        break;
      case '断章':
        // 慎用（效果批十）：换式与骰子只在 playBeat——此处登记口径
        out.suddenShift = true;
        out.lines.push(`▸ 【效果】断章：撕掉它的下一页——敌方被迫变招（预警：扰乱位）`);
        break;
      case '夺式':
        // 慎用（效果批十）：威胁表只有 playBeat 有——此处登记口径
        out.stealForm = true;
        out.lines.push(`▸ 【效果】夺式：它的最强一式易主了（预警：窃取位）`);
        break;
      case '连锁风暴':
        // 慎用（效果批十）：无限连锁降级为有界连锁——放大倍率随在场层数
        out.chainStorm = { base: scaled, perEffect: 3 };
        out.lines.push(`▸ 【效果】连锁风暴：每层在场效果都在为它供能（预警：连锁位）`);
        break;
      case '赌一手':
        // 赌注（效果批十一）：输赢只有拍末知道——playBeat 依反制结果清算
        out.bet = { stake: 10, winHeal: 20, winMp: 5, loseHurt: 10 };
        out.lines.push(`▸ 【效果】赌一手：注金压上桌了——这一拍见分晓`);
        break;
      case '死亡倒计时': {
        const beats = Math.max(1, Math.round(e.duration ?? 3));
        out.activate.push({
          name: '死亡倒计时',
          type: 'deathTimer',
          amount: beats,
          beatsLeft: beats,
        });
        out.lines.push(`▸ 【效果】死亡倒计时 ${beats} 拍——倒数结束敌方直接倒下`);
        break;
      }
      case '净化':
        // 我方负面状态系统双向化之前先挂 MP 通道（同驱散位；状态可叠加后即有真实目标）
        out.mpHeal += 8;
        out.lines.push(`▸ 【效果】净化：MP +8`);
        break;
      case '觉醒': {
        // 特殊类（效果批九）：血祭开眼——百分比乘区 + 每拍回复，双通道均整场（beatsLeft 缺省）
        out.activate.push(
          { name: '觉醒', type: 'frenzy', amount: scaled },
          { name: '觉醒·回复', type: 'regen', amount: 2 },
        );
        out.lines.push(`▸ 【效果】${effectLineOf(e)}`);
        break;
      }
      case '时间裂缝': {
        // 慎用（效果批十）：额外一拍 = 敌方不行动（stun 现成）+ 行动值乘区（frenzy 现成）
        out.activate.push(
          { name: '时间裂缝', type: 'stun', amount: 0, beatsLeft: 1 },
          { name: '时间裂缝·加速', type: 'frenzy', amount: scaled, beatsLeft: 1 },
        );
        out.lines.push(`▸ 【效果】${effectLineOf(e)}`);
        break;
      }
      case '中毒':
      case '灼烧':
      case '流血':
      case '虚弱':
      case '易伤':
      case '迟缓':
      case '眩晕':
      case '冰冻':
      case '护盾':
      case '格挡':
      case '剧毒':
      case '恐惧':
      case '混乱':
      case '沉睡':
      case '束缚':
      case '诅咒':
      case '标记':
      case '圣盾':
      case '反伤':
      case '魅惑':
      case '沉默':
      case '招架':
      case '先攻':
      case '寄生':
      case '感染':
      case '退化':
      case '缴械':
      case '变异':
      case '免疫':
      case '洞悉':
      case '任务':
      case '时之锚':
      case '狂暴':
      case '进化':
      case '连携锚':
      case '支配':
      case '封印':
      case '契约·血誓':
      case '功业': {
        const type =
          e.action === '易伤' || e.action === '诅咒'
            ? 'vulnerable'
            : e.action === '护盾' ||
                e.action === '格挡' ||
                e.action === '圣盾' ||
                e.action === '反伤'
              ? 'shield'
              : e.action === '剧毒'
                ? 'poisonPct'
                : e.action === '恐惧'
                  ? 'fear'
                  : e.action === '混乱'
                    ? 'confusion'
                    : e.action === '沉睡'
                      ? 'sleep'
                      : e.action === '束缚'
                        ? 'bind'
                        : e.action === '标记'
                          ? 'mark'
                          : e.action === '变异'
                            ? 'mutation'
                            : e.action === '魅惑'
                              ? 'charm'
                              : e.action === '沉默'
                                ? 'silence'
                                : e.action === '招架'
                                  ? 'parry'
                                  : e.action === '先攻'
                                    ? 'initiative'
                                    : e.action === '寄生'
                                      ? 'drain'
                                      : e.action === '感染'
                                        ? 'infest'
                                        : e.action === '退化'
                                          ? 'degrade'
                                          : e.action === '缴械'
                                            ? 'disarm'
                                            : e.action === '洞悉'
                                              ? 'insight'
                                              : e.action === '任务'
                                                ? 'quest'
                                                : e.action === '时之锚'
                                                  ? 'timeAnchor'
                                                  : e.action === '狂暴'
                                                    ? 'berserk'
                                                    : e.action === '进化'
                                                      ? 'evolution'
                                                      : e.action === '连携锚'
                                                        ? 'comboAnchor'
                                                        : e.action === '支配'
                                                          ? 'dominate'
                                                          : e.action === '封印'
                                                            ? 'seal'
                                                            : e.action === '契约·血誓'
                                                              ? 'pact'
                                                              : e.action === '功业'
                                                                ? 'feat'
                                                                : 'dot';
        const eff: CardInPlayEffect = {
          name: e.action,
          type: type as CardInPlayEffect['type'],
          // 任务的目标张数是契约口径，不随敌全体倍化；时之锚金额 0（锚点在 playBeat 落定）；
          // skill 轨：dot/护盾群的每拍量按难度表出手快照（Q12），削减族与 % 状态保持定点
          amount:
            e.action === '任务' || e.action === '契约·血誓' || e.action === '功业'
              ? Math.max(1, Math.round(e.value))
              : e.action === '时之锚'
                ? 0
                : DOT_LIKE.has(e.action)
                  ? scaledAmt
                  : scaled,
          // duration 0 = 整场（批九：狂暴/连携锚外，进化成长不递减）
          ...((e.duration ?? 0) > 0 ? { beatsLeft: Math.max(1, Math.round(e.duration ?? 1)) } : {}),
        };
        const twin = out.activate.find((a) => a.name === eff.name && a.type === eff.type);
        if (twin) {
          // 叠层：量叠加、时长取长
          twin.amount += eff.amount;
          twin.beatsLeft = Math.max(twin.beatsLeft ?? 1, eff.beatsLeft ?? 1);
        } else {
          out.activate.push(eff);
        }
        out.lines.push(`▸ 【效果】${effectLineOf(e)}`);
        break;
      }
      default:
        break;
    }
  }
  // 击杀时（效果批三）：胜利时结算的效果账
  for (const e of effects) {
    if (e.trigger !== '击杀时') continue;
    if (!out.onKill) out.onKill = [];
    out.onKill.push({ action: e.action, value: e.value });
  }
  // 消耗时（效果批五）：技能/领域/场景卡在结算时被消耗——效果账带出（治疗/MP 落结算窗）
  for (const e of effects) {
    if (e.trigger !== '消耗时') continue;
    if (!out.onConsume) out.onConsume = [];
    out.onConsume.push({ action: e.action, value: e.value });
  }
  // 治疗时（效果批六）：登记为本场响应——此后每次治疗触发一次
  for (const e of effects) {
    if (e.trigger !== '治疗时') continue;
    if (!out.healResponses) out.healResponses = [];
    out.healResponses.push({ name: `治疗响应·${e.action}`, action: e.action, value: e.value });
  }
  return out;
}

export function playBeat(
  s: SkirmishSession,
  action: SkirmishAction,
  dice: number,
  opts?: BeatOptions & { targetIndex?: number },
): SkirmishSession {
  // 多敌模式（2026-09-28 多敌实体化）：逐敌结算——目标敌走反制/伤害主路，
  // 其余存活敌威胁照常砸玩家（防护/护盾减，不可反制）
  if (s.enemies && s.enemies.length > 0) return playMultiEnemyBeat(s, action, dice, opts);
  const intent = currentIntent(s);
  if (!intent) return s;

  // 倒也可斩：一次性大威力攻击（缺省 50% 敌方当前 HP），消耗 90% 玩家 HP/MP
  // 🔴 每场限一次（2026-09-17）：session.nukeUsed 守卫，重复请求按未请求处理
  const nukeRequested = opts?.nuke === true && s.nukeUsed !== true;
  const nukePct = Math.max(1, Math.round(opts?.nukePercent ?? NUKE_PERCENT));
  const nukeDamage = nukeRequested ? Math.max(1, Math.round((s.enemyHp * nukePct) / 100)) : 0;

  // 在场战技：眩晕（敌方本拍放弃行动）/ 减速（威胁降低），只在剩余拍数内生效
  const live = s.activeEffects.filter((e) => e.beatsLeft === undefined || e.beatsLeft > 0);
  const stunActive = live.some((e) => e.type === 'stun') || live.some((e) => e.type === 'sleep');
  const weakenTotal = live
    .filter((e) => e.type === 'weaken' || e.type === 'degrade')
    .reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  // 效果批一（2026-09-25）：恐惧/束缚的意图改写——恐惧=威胁减半+反制面关闭；
  // 束缚=威胁锁 1。多效果叠加取最强（恐惧 > 束缚 > 减速）。
  const liveFear = live.some((e) => e.type === 'fear');
  const liveBind = live.some((e) => e.type === 'bind');
  // 封印（效果批十·慎用）：威胁锁 1 整场——束缚的整场加强版
  const liveSeal = live.some((e) => e.type === 'seal');
  const liveSilence = live.some((e) => e.type === 'silence');
  const liveDisarm = live.some((e) => e.type === 'disarm');
  let effectiveIntent = stunActive
    ? { ...intent, threat: 0 }
    : liveFear
      ? {
          ...intent,
          threat: Math.max(1, Math.round(intent.threat / 2)),
          counters: [] as typeof intent.counters,
        }
      : liveDisarm
        ? { ...intent, threat: Math.max(1, Math.round(intent.threat * 0.6)) }
        : liveSilence
          ? { ...intent, counters: [] as typeof intent.counters }
          : liveBind
            ? { ...intent, threat: 1 }
            : liveSeal
              ? { ...intent, threat: Math.min(intent.threat, 1) }
              : weakenTotal > 0
                ? { ...intent, threat: Math.max(0, intent.threat - weakenTotal) }
                : intent;
  const effectLines: string[] = [];
  if (stunActive) {
    const sleeping = live.some((e) => e.type === 'sleep');
    effectLines.push(
      sleeping ? `▸ 敌方【沉睡】——这几拍放弃行动` : `▸ 敌方被【眩晕】——本拍放弃行动`,
    );
  } else if (liveFear) effectLines.push(`▸ 【恐惧】攫住了它——威胁减半，反制面关闭`);
  else if (liveDisarm) effectLines.push(`▸ 【缴械】它的兵器脱手——威胁 −40%`);
  else if (liveSilence) effectLines.push(`▸ 【沉默】封了它的口——无法反制`);
  else if (liveBind) effectLines.push(`▸ 【束缚】缠住了它的手脚——威胁锁 1`);
  else if (liveSeal) effectLines.push(`▸ 【封印】符咒贴死了它的每一式——威胁锁 1（整场）`);
  else if (weakenTotal > 0) effectLines.push(`▸ 减速战技：敌方威胁 −${weakenTotal}`);

  // 在场加成（此前打出的领域/装备/召唤…）：行动值先行叠加，审计单列一行可复算
  // （skill 轨：buffTotal 并入伤害基数不再进行动值——Q11；evolution 重定基为伤害%）
  const buffTotal = s.activeEffects
    .filter((e) => e.type === 'buff' || e.type === 'evolution')
    .reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  // 事件账本（效果批七·条件位）：本拍开始时快照供条件判定（本拍新事件不影响本拍条件）
  const ledgerAtStart: Partial<Record<import('./card-effects').BeatEvent, number>> = {
    ...(s.beatEvents ?? {}),
  };
  // 效果池翻译（2026-09-25）：打出时动作层即时结算、状态层进在场登记
  const fx = translateCardEffects(
    opts?.effects,
    opts?.enemyCount ?? s.enemyCount ?? 1,
    ledgerAtStart,
    opts?.skill,
  );

  // 终结一击（效果批九）：按敌方已损失气血 % 计真伤——走 directDamage 无视减免通道
  if (fx.finisherPct) {
    const missing = Math.max(0, s.enemyMaxHp - s.enemyHp);
    const fin = Math.round((missing * fx.finisherPct) / 100);
    if (fin > 0) {
      fx.directDamage = (fx.directDamage ?? 0) + fin;
      fx.lines.push(
        `▸ 【终结一击】斩口深可见骨——已损失气血 ${missing} × ${fx.finisherPct}% = +${fin} 真伤`,
      );
    }
  }
  // 连携锚（效果批九）：本拍出了卡 → 拍末追加连携伤害（激活拍登记，次拍起计）
  const comboDamage = action.cardName
    ? live
        .filter((e) => e.type === 'comboAnchor')
        .reduce((sum, e) => sum + Math.max(0, e.amount), 0)
    : 0;
  if (comboDamage > 0) {
    fx.endBeatDamage = (fx.endBeatDamage ?? 0) + comboDamage;
    fx.lines.push(`▸ 【连携锚】连击成势——拍末追加 ${comboDamage} 伤害`);
  }

  // 夺式（效果批十·慎用）：窃取最强一式之力——skill 轨重定基为伤害%（上限 12%），旧轨点数
  if (fx.stealForm) {
    const maxThreat = Math.max(...s.intents.map((it) => Math.max(0, Math.round(it.threat))));
    const stolen = Math.min(12, Math.round(maxThreat / 2));
    if (stolen > 0) {
      if (opts?.skill) {
        fx.powerBonusPct += stolen;
        fx.lines.push(`▸ 【夺式】它最强一式的力道到了你手上——伤害 +${stolen}%（预警：窃取位）`);
      } else {
        fx.powerBonus += stolen;
        fx.lines.push(`▸ 【夺式】它最强一式的力道到了你手上——行动值 +${stolen}（预警：窃取位）`);
      }
    }
  }
  // 断章（效果批十·慎用）：骰子驱动随机换式——轮换节奏作废，变招威胁减半（洞悉因此失准）
  if (fx.suddenShift && s.intents.length > 1) {
    const pick = s.intents[(s.beat + dice) % s.intents.length];
    if (pick && pick !== intent) {
      effectiveIntent = {
        ...pick,
        threat: Math.max(1, Math.round(pick.threat / 2)),
      };
      fx.lines.push(
        `▸ 【断章】它的下一页被撕掉了——仓促变招为「${pick.move}」（威胁减半，预警：扰乱位）`,
      );
    }
  }

  // 变异（效果批五）：live 时每拍按拍骰随机一项——威胁+3 / 敌承伤+8% / 敌自伤4
  const liveMutation = live.some((e) => e.type === 'mutation');
  let mutationThreat = 0;
  let mutationVuln = 0;
  let mutationSelf = 0;
  if (liveMutation) {
    const roll = dice % 3;
    if (roll === 0) mutationThreat = 3;
    else if (roll === 1) mutationVuln = 8;
    else mutationSelf = 4;
  }
  // 分支（效果批八）：命运掷骰定路——skill 轨重定基：d10 ≥ 6 伤害 +12%，骰败回复 8 HP
  if (fx.branch) {
    const br = (dice % 10) + 1;
    if (br >= 6) {
      if (opts?.skill) {
        fx.powerBonusPct += fx.branch.successDamage;
        fx.lines.push(
          `▸ 【分支】命运掷骰 d10=${br} ≥ 6——走向杀伐：伤害 +${fx.branch.successDamage}%`,
        );
      } else {
        fx.powerBonus += fx.branch.successDamage;
        fx.lines.push(
          `▸ 【分支】命运掷骰 d10=${br} ≥ 6——走向杀伐：行动值 +${fx.branch.successDamage}`,
        );
      }
    } else {
      fx.heal += fx.branch.fallbackHeal;
      fx.lines.push(
        `▸ 【分支】命运掷骰 d10=${br} < 6——走向回护：回复 ${fx.branch.fallbackHeal} HP`,
      );
    }
  }

  // 窥探（效果批八）：敌方招式轮换尽数展现（▶ 为本拍正在出的一式）
  if (fx.revealRotation) {
    const cur = s.beat % s.intents.length;
    const fmt = s.intents
      .map(
        (it, i) =>
          `${i === cur ? '▶' : i + 1}.${it.move} 威胁${it.threat}` +
          (it.counters?.length ? `（反制:${it.counters.join('/')}）` : ''),
      )
      .join(' ｜ ');
    fx.lines.push(`▸ 【窥探】共 ${s.intents.length} 式：${fmt}`);
  }

  // 洞悉（效果批八）：预读未来 2 拍的招式与威胁（读侧信息，不改敌方意图本体）
  if (live.some((e) => e.type === 'insight')) {
    const L = s.intents.length;
    const peek = (k: number) => {
      const it = s.intents[(s.beat + k) % L];
      return it
        ? `下${k === 1 ? '' : '下'}拍「${it.move}」威胁 ${it.threat}` +
            (it.counters?.length ? `（反制:${it.counters.join('/')}）` : '')
        : null;
    };
    const reveals = [peek(1), peek(2)].filter(Boolean);
    if (reveals.length > 0) fx.lines.push(`▸ 【洞悉】预读：${reveals.join(' ｜ ')}`);
  }

  // 觉醒/狂暴（效果批九）：百分比行动值乘区（frenzy 整场、berserk 窗口内）
  const frenzyPct = live
    .filter((e) => e.type === 'frenzy' || e.type === 'berserk')
    .reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  // 连锁风暴（效果批十·慎用）：无限连锁降级为有界——每层在场效果 +3%
  const stormPct = fx.chainStorm ? fx.chainStorm.base + live.length * fx.chainStorm.perEffect : 0;
  if (stormPct > 0) {
    fx.lines.push(
      `▸ 【连锁风暴】${live.length} 层在场连锁供能——行动值 +${stormPct}%（预警：连锁位）`,
    );
  }
  // 双轨装配（v2 共识·替换制）：
  // - skill 轨：伤害 = 技能公式点数（A 类合计+召唤压场）× 乘区链（aggregateDamage），
  //   行动值退役为纯命中轴；碾压余量由 resolveBeat 在乘区外追加（Q13'）
  // - 旧轨（过渡，批次 3 接线后删）：行动值伤害语义
  let effectiveAction: SkirmishAction;
  let beatDamage: number | undefined;
  if (opts?.skill) {
    const evoPct = live
      .filter((e) => e.type === 'evolution')
      .reduce((sum, e) => sum + Math.max(0, e.amount), 0);
    const liveVulnPct = live
      .filter((e) => e.type === 'vulnerable')
      .reduce((sum, e) => sum + Math.max(0, e.amount), 0);
    const agg = aggregateDamage(Math.max(0, fx.powerBonus) + buffTotal, {
      powerBonusPct: fx.powerBonusPct + frenzyPct + stormPct + evoPct,
      vulnerabilityPct: liveVulnPct + mutationVuln,
    });
    beatDamage = agg.total;
    effectiveAction = { ...action };
    fx.lines.push(
      `▸ 【公式】伤害基数 ${agg.total}${agg.trace.length > 1 ? `（${agg.trace.join(' ')}）` : ''}`,
    );
  } else {
    const rawPower =
      (Math.max(0, action.power) + fx.powerBonus) * (1 + (frenzyPct + stormPct) / 100);
    effectiveAction = {
      ...action,
      power: Math.round(rawPower * fx.powerMult) + (buffTotal > 0 ? buffTotal : 0),
    };
  }
  // 支配（效果批十·慎用）：控制权转移——它把自己的威胁尽数打在自己身上（真伤），你不受其击。
  // 必须在 effectiveThreat 捕获前清零：DC/伤害基准都走这条变量
  const pendingDominate = live.some((e) => e.type === 'dominate') ? effectiveIntent.threat : 0;
  if (pendingDominate > 0) {
    effectiveIntent = { ...effectiveIntent, threat: 0 };
    fx.directDamage = (fx.directDamage ?? 0) + pendingDominate;
    fx.lines.push(
      `▸ 【支配】夺其心志——它的 ${pendingDominate} 点威胁将尽数落在自己身上（预警：控制位）`,
    );
  }

  // 变异威胁：仅影响本拍敌方威胁判定（resolveBeat 输入侧），不改敌方意图本体
  const effectiveThreat = effectiveIntent.threat + mutationThreat;

  // 本拍在场护盾（护盾/格挡状态）+ 本拍易伤层数——供 resolveBeat 乘区与减伤
  const liveShield = live
    .filter((e) => e.type === 'shield')
    .reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  const liveVuln = live
    .filter((e) => e.type === 'vulnerable')
    .reduce((sum, e) => sum + Math.max(0, e.amount), 0);

  // 圣盾（效果批一）：一次性免疫下一拍全部伤害——live 时玩家承伤归 0，拍末消耗
  const liveDivine = live.find((e) => e.type === 'divineShield');
  // 先攻（效果批二）：持续期间反制掷骰 +3
  const liveInitiative = live.some((e) => e.type === 'initiative');
  // 治疗时响应（效果批六）：本拍有任何治疗 → 登记的响应连锁触发（每拍每条一次）
  const fxHealEarly = Math.max(0, Math.round(fx.heal));
  const drainEarly = live
    .filter((e) => e.type === 'drain')
    .reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  const baseHealedEarly = fxHealEarly + drainEarly;
  const responses = baseHealedEarly > 0 ? (s.healResponses ?? []) : [];
  const responseHeal = responses
    .filter((r) => r.action === '治疗')
    .reduce((sum, r) => sum + Math.max(0, Math.round(r.value)), 0);
  const responseShield = responses
    .filter((r) => r.action === '护盾')
    .reduce((sum, r) => sum + Math.max(0, Math.round(r.value)), 0);
  // 免疫（效果批六）：N 拍全免窗——全部伤害归零（强于圣盾的持续版）
  const liveImmune = live.some((e) => e.type === 'immune');
  const result = resolveBeat({
    intent: { ...effectiveIntent, threat: effectiveThreat },
    action: effectiveAction,
    playerHp: s.playerHp,
    enemyHp: s.enemyHp,
    // Q22 止血：guardDown 曾被减到玩家防护上（破防卡反噬自己）；敌方防护轴已取消，
    // 破防/穿透在 skill 轨走威胁族（weaken），此处不再削玩家防护
    guard: Math.max(0, s.guard),
    dice: dice + (liveInitiative ? 3 : 0),
    ...(liveShield + responseShield > 0 ? { shield: liveShield + responseShield } : {}),
    // skill 轨：易伤乘区已并入 aggregateDamage（Q13'，margin 在乘区外），不再传 resolveBeat
    ...(opts?.skill
      ? {}
      : liveVuln + mutationVuln > 0
        ? { vulnerable: liveVuln + mutationVuln }
        : {}),
    ...(beatDamage !== undefined ? { damage: beatDamage } : {}),
  });
  const playerDamageBase = result.playerDamage ?? 0;
  const divineBlocked = liveDivine !== undefined && playerDamageBase > 0;
  const immuneBlocked = liveImmune && playerDamageBase > 0;

  // 事件账本（效果批七·条件位）：单敌分支——受击/反制/击杀在 resolveBeat 后即可记账
  const events: Partial<Record<import('./card-effects').BeatEvent, number>> = {
    ...(s.beatEvents ?? {}),
  };
  const bump = (k: import('./card-effects').BeatEvent, n = 1) => {
    events[k] = (events[k] ?? 0) + n;
  };
  if (action.cardName) bump('出卡');
  if (!result.countered && playerDamageBase > 0) bump('承受伤害');
  if (result.countered) bump('反制成功');
  if (result.enemyHp <= 0) bump('击杀');
  const lines = [
    // 出卡宣言（主人裁定：玩家写这张牌用来做什么，纯叙事素材，置于拍审计之前）
    ...(action.note ? [`▸ 意图：${action.note}`] : []),
    ...(opts?.prepend ?? []),
    ...effectLines,
    ...fx.lines,
    ...(buffTotal > 0 ? [`▸ 在场加成：行动值 +${buffTotal}`] : []),
    ...result.audit,
  ];

  // 在场持续伤害（领域 DoT）：拍末结算，可收到人头。
  // 决斗中场地不在场（免疫一切外部伤害）→ 抑制不结算。
  const dotSuppressed = duelSuppressesEffect('dot', s.duel);
  const dotTotal = dotSuppressed
    ? 0
    : s.activeEffects
        .filter((e) => e.type === 'dot' || e.type === 'infest')
        .reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  // 效果批一（2026-09-25）：剧毒=当前气血百分比毒；标记=固定额外扣；混乱=敌方自伤
  const poisonPctTotal = dotSuppressed
    ? 0
    : s.activeEffects
        .filter((e) => e.type === 'poisonPct')
        .reduce((sum, e) => sum + Math.max(1, Math.round((result.enemyHp * e.amount) / 100)), 0);
  const markTotal = dotSuppressed
    ? 0
    : s.activeEffects
        .filter((e) => e.type === 'mark')
        .reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  const confusionTotal = dotSuppressed
    ? 0
    : s.activeEffects
        .filter((e) => e.type === 'confusion')
        .reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  // 魅惑（效果批二）：敌方本拍为玩家作战——它的攻击（威胁值）转嫁为对它自己的伤害
  const charmTotal = dotSuppressed
    ? 0
    : live.some((e) => e.type === 'charm')
      ? Math.max(0, effectiveIntent.threat)
      : 0;
  // 寄生（效果批三）：每拍敌方 −X、玩家 +X（双头结算）
  const liveDrain = dotSuppressed ? [] : live.filter((e) => e.type === 'drain');
  const drainEnemy = liveDrain.reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  const drainHeal = liveDrain.reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  const extraDot =
    poisonPctTotal + markTotal + confusionTotal + charmTotal + drainEnemy + mutationSelf;
  const enemyHpAfterDot = Math.max(0, result.enemyHp - dotTotal - extraDot);
  if (dotTotal > 0 && result.enemyHp > 0) {
    lines.push(`▸ 在场持续：敌方 −${dotTotal}（${result.enemyHp} → ${enemyHpAfterDot}）`);
  } else if (dotSuppressed && s.activeEffects.some((e) => e.type === 'dot')) {
    lines.push('▸ 【决斗】场地不在场——持续伤害被隔离（免疫一切外部伤害）');
  }
  if (poisonPctTotal > 0) {
    lines.push(`▸ 【剧毒】腐蚀：敌方 −${poisonPctTotal}（当前气血的百分比）`);
  }
  if (markTotal > 0) {
    lines.push(`▸ 【标记】锁定：敌方额外 −${markTotal}`);
  }
  if (confusionTotal > 0) {
    lines.push(`▸ 【混乱】反噬：敌方自伤 −${confusionTotal}`);
  }
  if (mutationSelf > 0) {
    lines.push(`▸ 【变异】铭文扭曲：敌方自伤 −${mutationSelf}`);
  }
  if (charmTotal > 0) {
    lines.push(`▸ 【魅惑】它为你出手——攻击转嫁：敌方 −${charmTotal}`);
  }

  // 反伤（效果批一）：受击时反弹——未被反制且实受了伤害才弹
  const liveThorns = dotSuppressed
    ? 0
    : live.filter((e) => e.type === 'thorns').reduce((sum, e) => sum + Math.max(0, e.amount), 0);
  const thornsDamage = !result.countered && playerDamageBase > 0 && liveThorns > 0 ? liveThorns : 0;
  const enemyHpAfterThorns = Math.max(0, enemyHpAfterDot - thornsDamage);
  if (thornsDamage > 0) {
    lines.push(`▸ 【反伤】荆棘回敬：敌方 −${thornsDamage}`);
  }

  // 倒也可斩 nuke 伤害（拍末追加，可收人头）
  const afterNuke =
    nukeDamage > 0 ? Math.max(0, enemyHpAfterThorns - nukeDamage) : enemyHpAfterThorns;
  if (nukeDamage > 0) {
    lines.push(`▸ 倒也可斩：敌方 −${nukeDamage}（${enemyHpAfterDot} → ${afterNuke}）`);
  }

  // 效果池·真实伤害（效果批一）：无视一切减免，拍末直扣
  const directDamage = Math.max(0, Math.round(fx.directDamage ?? 0));
  const afterDirect = Math.max(0, afterNuke - directDamage);
  if (directDamage > 0) {
    lines.push(`▸ 【效果】真实伤害：敌方 −${directDamage}（无视一切减免）`);
  }

  // 行为合同反噬（SSS 律师函警告）：敌方本拍意图触碰禁条 → 真实伤害
  const contractHit = contractBacklash(s.contracts, intent);
  const afterContract = Math.max(0, afterDirect - contractHit.total);

  // 拍结束·伤害（效果批五）：常规结算全部完成后追加（受护盾/减免影响的其余部分已定，此段为追加直伤——非无视减免）
  const endBeatDamage = Math.max(0, Math.round(fx.endBeatDamage ?? 0));
  const afterEndBeat = Math.max(0, afterContract - endBeatDamage);
  if (endBeatDamage > 0) {
    lines.push(`▸ 【效果】拍末追加：敌方 −${endBeatDamage}`);
  }
  if (contractHit.total > 0) {
    lines.push(
      `▸ 行为合同违约（${contractHit.violated.map((c) => c.name).join('、')}）：敌方 −${contractHit.total} 真实伤害（${afterNuke} → ${afterContract}）`,
    );
  }

  // 终章：第 N 拍起敌方被即刻抹除（无视减免；N 缺省 6）
  const chapterAt = Math.max(1, Math.round(opts?.finalChapterBeats ?? FINAL_CHAPTER_BEAT));
  const chapterActive = opts?.finalChapter === true && s.beat + 1 >= chapterAt;
  if (chapterActive && afterEndBeat > 0) {
    lines.push(`▸ 【第六终章】第 ${s.beat + 1} 次行动——抹除发动：敌方 −${afterContract}（归零）`);
  }
  let enemyHpFinal = chapterActive ? 0 : afterEndBeat;

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

  // 圣盾（效果批一）：一次性免疫——被挡下的伤害原样补回 HP 链
  const hpAfterBeat = result.playerHp + (immuneBlocked || divineBlocked ? playerDamageBase : 0);
  if (immuneBlocked) {
    lines.push(`▸ 【免疫】本拍 ${playerDamageBase} 点伤害被完全挡下`);
  } else if (divineBlocked && liveDivine) {
    lines.push(`▸ 【圣盾】光芒展开——本拍 ${playerDamageBase} 点伤害被完全挡下（护盾消耗）`);
  }

  // 暴走/反噬反冲（启封失败的代价）：拍末玩家扣血，可致死
  const recoil = opts?.recoil ?? 0;
  const playerHpAfterRecoil = Math.max(0, hpAfterBeat - Math.max(0, Math.round(recoil)));
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

  // 效果池·打出时回复（治疗/吸血三成）：并入 HP 链（上限钳制）
  const fxHeal = Math.max(0, Math.round(fx.heal));
  // 寄生（效果批三）：拍末吸血转给玩家
  const drainHealAmount = Math.max(0, Math.round(drainHeal));
  const endBeatHeal = Math.max(0, Math.round(fx.endBeatHeal ?? 0));
  const baseHealed = fxHeal + drainHealAmount + endBeatHeal;
  const healedTotal = baseHealed + responseHeal;
  if (baseHealed > 0) bump('治疗');
  const playerHpAfterFxHeal =
    healedTotal > 0
      ? Math.min(s.playerMaxHp, playerHpAfterRegen + healedTotal)
      : playerHpAfterRegen;
  if (fxHeal > 0 && playerHpAfterFxHeal > playerHpAfterRegen) {
    lines.push(`▸ 【效果】回复 ${playerHpAfterFxHeal - playerHpAfterRegen} HP`);
  }
  if (responseHeal > 0 && playerHpAfterFxHeal > playerHpAfterRegen) {
    lines.push(
      `▸ 【治疗时响应】额外回复 ${playerHpAfterFxHeal - playerHpAfterRegen - fxHeal - drainHealAmount - endBeatHeal} HP`,
    );
  }
  if (endBeatHeal > 0 && playerHpAfterFxHeal > playerHpAfterRegen + fxHeal) {
    lines.push(`▸ 【效果】拍末回复 ${playerHpAfterFxHeal - playerHpAfterRegen - fxHeal} HP`);
  }

  if (drainHealAmount > 0 && playerHpAfterFxHeal > playerHpAfterRegen + fxHeal) {
    lines.push(
      `▸ 【寄生】汲取 ${playerHpAfterFxHeal - playerHpAfterRegen - fxHeal} HP（${playerHpAfterRegen + fxHeal} → ${playerHpAfterFxHeal}）`,
    );
  }

  // 禁忌卡 HP 覆盖（天罚锁 1 / 许愿回复 / 蜡封回复）——优先级高于反冲与吸魔
  const playerHpAfterOverride =
    playerHpOverride !== null ? Math.min(playerHpOverride, s.playerMaxHp) : playerHpAfterFxHeal;
  if (playerHpOverride !== null && playerHpAfterOverride !== playerHpAfterFxHeal) {
    lines.push(`▸ 禁忌之力改写了你的气血：${playerHpAfterFxHeal} → ${playerHpAfterOverride}`);
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
  const activateList = [...activateListOf(opts?.activate), ...fx.activate];
  const stunBeats: number | null =
    (opts?.ageEnd === true && forbiddenGuard) || (opts?.waxNight === true && forbiddenGuard)
      ? 2
      : opts?.wish === 'grand' && forbiddenGuard
        ? 2
        : null;
  const tideAmount: number | null =
    opts?.beastTideAmount !== undefined && forbiddenGuard ? opts.beastTideAmount : null;
  // 同名同型叠层合并（效果池 2026-09-25：灼烧/流血等可叠层——量叠加、时长取长）
  const mergedEffects = [
    ...decremented.filter((e) => e.beatsLeft === undefined || e.beatsLeft > 0),
  ];
  for (const a of activateList) {
    const normalized = {
      name: a.name,
      type: a.type,
      amount: Math.max(0, Math.round(a.amount)),
      ...(a.beatsLeft !== undefined ? { beatsLeft: Math.max(1, a.beatsLeft) } : {}),
      // 领域/场景卡建立的环境随效果存续（环境加成天赋据此判定）
      ...(a.env ? { env: a.env } : {}),
    };
    const twin = mergedEffects.find(
      (e) => e.name === normalized.name && e.type === normalized.type,
    );
    if (twin) {
      twin.amount += normalized.amount;
      if (normalized.beatsLeft !== undefined || twin.beatsLeft !== undefined) {
        twin.beatsLeft = Math.max(twin.beatsLeft ?? 0, normalized.beatsLeft ?? 0);
      }
    } else {
      mergedEffects.push(normalized);
    }
  }
  // 感染/退化（效果批三）：逐拍加深 +1——只成长「上一拍已在场」的效果，
  // 本拍新激活的从下一拍才开始加深（首拍按池内定值结算）
  for (const e of mergedEffects) {
    if ((e.type === 'infest' || e.type === 'degrade') && decremented.includes(e)) e.amount += 1;
    // 进化（效果批九）：在场每过 1 拍行动值加成 +5（池内定值步进，同感染/退化的成长式）
    if (e.type === 'evolution' && decremented.includes(e)) e.amount += 5;
  }
  const nextEffects = [
    ...mergedEffects,
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

  let next: SkirmishSession = {
    ...s,
    beat: s.beat + 1,
    beatEvents: events,
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
    ...(fx.guardDown > 0 ? { guardDown: (s.guardDown ?? 0) + fx.guardDown } : {}),
    ...(fx.mpHeal > 0 ? { mpGained: (s.mpGained ?? 0) + fx.mpHeal } : {}),
  };
  // 狂暴（效果批九）：窗口内每拍自伤（amount/10，50→5）——置于终局判定前，可致死
  const berserkSelf = live
    .filter((e) => e.type === 'berserk')
    .reduce((sum, e) => sum + Math.max(1, Math.round(e.amount / 10)), 0);
  if (berserkSelf > 0 && next.playerHp > 0) {
    next = {
      ...next,
      playerHp: Math.max(0, next.playerHp - berserkSelf),
      log: [...next.log, `▸ 【狂暴】血脉贲张反噬己身——自伤 ${berserkSelf} HP`],
    };
  }
  // 时之锚（效果批九）：激活拍末落锚 → 之后任一拍末跌破锚点回溯（一次性，不救致死拍）
  const anchor = (next.activeEffects ?? []).find((e) => e.type === 'timeAnchor');
  if (anchor && next.playerHp > 0) {
    if ((anchor.amount ?? 0) <= 0) {
      const effects2 = [...(next.activeEffects ?? [])];
      effects2[effects2.indexOf(anchor)] = { ...anchor, amount: next.playerHp };
      next = {
        ...next,
        activeEffects: effects2,
        log: [...next.log, `▸ 【时之锚】锚点落定于 ${next.playerHp} HP`],
      };
    } else if (next.playerHp < anchor.amount) {
      const effects2 = (next.activeEffects ?? []).filter((e) => e !== anchor);
      next = {
        ...next,
        playerHp: anchor.amount,
        activeEffects: effects2,
        log: [...next.log, `▸ 【时之锚】时光倒流——气血回溯至锚点 ${anchor.amount} HP`],
      };
    }
  }

  // 赌一手（效果批十一）：押注本拍反制——赢了通吃，输了注金尽没再加伤（注金不押到致死）
  if (fx.bet && next.playerHp > 0) {
    const stake = Math.min(fx.bet.stake, next.playerHp);
    next = {
      ...next,
      playerHp: next.playerHp - stake,
      log: [...next.log, `▸ 【赌一手】押上 ${stake} HP 作注`],
    };
    if (result.countered) {
      // skill 轨：兑现治疗按治疗表倍率（150% 主轴派生，Q8' 兑现类）；旧轨定值 20
      const winHeal = opts?.skill
        ? resolveSkillAmount({
            action: '赌一手',
            difficulty: opts.skill.difficulty,
            mainDerivation: opts.skill.mainDerivation,
            secondary: [],
          }).amount
        : fx.bet.winHeal;
      next = {
        ...next,
        playerHp: Math.min(s.playerMaxHp, next.playerHp + winHeal),
        mpGained: (s.mpGained ?? 0) + fx.bet.winMp,
        log: [...next.log, `▸ 【赌一手】赌胜——赢回 ${winHeal} HP 与 ${fx.bet.winMp} MP`],
      };
    } else {
      next = {
        ...next,
        playerHp: Math.max(0, next.playerHp - fx.bet.loseHurt),
        log: [...next.log, `▸ 【赌一手】失手——注金尽没，再伤 ${fx.bet.loseHurt} HP`],
      };
    }
  }
  // 死亡倒计时到期（效果批三）：倒数走完 → 敌方直接倒下
  const timerExpired = decremented.find((e) => e.type === 'deathTimer' && (e.beatsLeft ?? 1) <= 0);
  if (timerExpired) {
    lines.push(`▸ 【死亡倒计时】归零——【${s.enemyName}】的铭文走到了尽头`);
  }

  // 斩杀（效果批二）：本拍打出了斩杀效果，且敌方当前气血低于阈值 → 直接击杀
  const executePct = Math.max(0, Math.round(fx.executePct ?? 0));
  if (executePct > 0 && next.enemyHp > 0) {
    const threshold = Math.max(1, Math.round((s.enemyMaxHp * executePct) / 100));
    if (next.enemyHp <= threshold) {
      return withFinish(
        {
          ...next,
          enemyHp: 0,
          log: [...next.log, `▸ 【斩杀】${s.enemyName} 的气血已坠过 ${executePct}% 之线——当场了结`],
        },
        '胜利',
        [`▸ 【${s.enemyName}】倒下——胜利！`],
      );
    }
  }
  if (next.enemyHp <= 0 || timerExpired) {
    if (timerExpired) next = { ...next, enemyHp: 0 };
    // 击杀时效果（效果批三·汲取）：胜利的同窗内回复
    let victory = next;
    const killLines: string[] = [];
    for (const k of fx.onKill ?? []) {
      if (k.action === '汲取') {
        const heal = Math.max(1, Math.round((s.playerMaxHp * k.value) / 100));
        victory = { ...victory, playerHp: Math.min(s.playerMaxHp, victory.playerHp + heal) };
        killLines.push(`▸ 【汲取】吞噬余烬——回复 ${heal} HP`);
      }
    }
    return withFinish(victory, '胜利', [...killLines, `▸ 【${s.enemyName}】倒下——胜利！`]);
  }
  if (next.playerHp <= 0) {
    return withFinish(next, '败北', [`▸ 玩家倒下——败北（经验照常结算，评价 C）`]);
  }
  // 任务（效果批八）：账本出卡数达标 → 奖励落袋、任务移除（终局拍不结算；超时由时长递减自然作废）
  const quest = (next.activeEffects ?? []).find((e) => e.type === 'quest');
  if (quest && (events['出卡'] ?? 0) >= Math.max(1, quest.amount)) {
    // skill 轨：兑现治疗按治疗表倍率（Q8' 兑现类）；旧轨定值 15
    const reward = opts?.skill
      ? resolveSkillAmount({
          action: '任务',
          difficulty: opts.skill.difficulty,
          mainDerivation: opts.skill.mainDerivation,
          secondary: [],
        }).amount
      : 15;
    next = {
      ...next,
      playerHp: Math.min(s.playerMaxHp, next.playerHp + reward),
      activeEffects: (next.activeEffects ?? []).filter((e) => e !== quest),
      log: [...next.log, `▸ 【任务】完成——出卡 ${quest.amount} 张如期兑现，回复 ${reward} HP`],
    };
  }
  // 契约·血誓（效果批十一）：到期清算——达标兑现，违约反噬（任务区结算：不救致死拍）
  const expiringPacts = s.activeEffects.filter((e) => e.type === 'pact' && (e.beatsLeft ?? 1) <= 1);
  for (const pact of expiringPacts) {
    const goal = Math.max(1, pact.amount);
    const pactReward = opts?.skill
      ? resolveSkillAmount({
          action: '契约·血誓',
          difficulty: opts.skill.difficulty,
          mainDerivation: opts.skill.mainDerivation,
          secondary: [],
        }).amount
      : 18;
    if ((events['出卡'] ?? 0) >= goal) {
      next = {
        ...next,
        playerHp: Math.min(s.playerMaxHp, next.playerHp + pactReward),
        log: [...next.log, `▸ 【契约·血誓】守约兑现——${goal} 张卡如期打出，回复 ${pactReward} HP`],
      };
    } else {
      next = {
        ...next,
        playerHp: Math.max(0, next.playerHp - 8),
        log: [
          ...next.log,
          `▸ 【契约·血誓】违约反噬——出卡 ${events['出卡'] ?? 0}/${goal}，自伤 8 HP`,
        ],
      };
    }
  }
  // 功业（效果批十一）：成就达成——账本反制数达标即兑现嘉奖（一次性，buff 不涉生死）
  const feat = (next.activeEffects ?? []).find((e) => e.type === 'feat');
  if (feat && (events['反制成功'] ?? 0) >= Math.max(1, feat.amount)) {
    // skill 轨：Q7' 重定基 +25% 伤害（frenzy 乘区加算层）；旧轨 +10 行动值
    const featReward = opts?.skill
      ? { name: '功业·嘉奖', type: 'frenzy' as const, amount: 25 }
      : { name: '功业·嘉奖', type: 'buff' as const, amount: 10 };
    next = {
      ...next,
      activeEffects: [...(next.activeEffects ?? []).filter((e) => e !== feat), featReward],
      log: [
        ...next.log,
        opts?.skill
          ? `▸ 【功业】达成——${feat.amount} 次反制如愿，伤害 +25%（整场）`
          : `▸ 【功业】达成——${feat.amount} 次反制如愿，行动值 +10（整场）`,
      ],
    };
  }
  // ── 体力账（2026-09-25 访谈共识）：出卡 5 SP / 基础应对 3 SP，拍拍扣 ──
  // MP 只记账不拦人（拦截在 cardPlayPlan 的硬门槛）；SP 归零 = 力竭败北，
  // 与 HP 归零同路径、先到先触发（敌方先倒下已在上面的胜利分支收口）。
  if (s.playerSp !== undefined) {
    const spCost = action.cardName ? SP_COST_PLAY : SP_COST_COUNTER;
    const mpCost = Math.max(0, Math.round(opts?.mpCost ?? 0));
    // 招架（效果批二）：反制成功返还 2 SP——在账内轧差，结算落库自然少扣
    const parryRefund = result.countered && live.some((e) => e.type === 'parry') ? 2 : 0;
    const spSpent = Math.max(0, (s.spSpent ?? 0) + spCost - parryRefund);
    const lines2 = [
      `▸ 体力 −${spCost}${parryRefund ? `（招架返还 2）` : ''}（剩 ${Math.max(0, s.playerSp - spSpent)}）`,
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

/**
 * 多敌拍结算（2026-09-28 多敌实体化共识）：
 * - 每个存活敌各出一条意图，全部结算：玩家反制指定目标（免其伤+造成伤），
 *   其余敌威胁照常（防护/护盾减，不可反制）
 * - 敌全体（AOE）行动逐敌全额结算（护卫减伤只保护首领）
 * - 护卫减伤：存活杂兵每只首领承伤 −20%，三只封顶 −60%
 * - 死亡：逐敌 HP 归零即退场（意图移除）；首领倒下 = 即刻胜利；全灭 = 胜利
 * 确定性契约与单敌同款：纯函数、骰值传入、终局后幂等。
 */
export function playMultiEnemyBeat(
  s: SkirmishSession,
  action: SkirmishAction,
  dice: number,
  opts?: BeatOptions & { targetIndex?: number },
): SkirmishSession {
  const enemies = s.enemies;
  if (!enemies || enemies.length === 0) return s;
  const alive = enemies.map((e, i) => ({ e, i })).filter(({ e }) => !e.dead && e.hp > 0);
  if (alive.length === 0) return withFinish(s, '胜利', ['▸ 敌方已全灭——胜利！']);

  // 目标：指定下标（存活才有效），否则默认威胁最高者
  const targetIdx =
    opts?.targetIndex !== undefined &&
    enemies[opts.targetIndex] &&
    !enemies[opts.targetIndex].dead &&
    enemies[opts.targetIndex].hp > 0
      ? opts.targetIndex
      : alive.reduce((best, cur) => (cur.e.hp > enemies[best].hp ? cur.i : best), alive[0].i);
  const target = enemies[targetIdx];
  const targetIntent = target.intents[target.intentIndex % target.intents.length] ?? null;

  const lines: string[] = [];
  const spCost = action.cardName ? SP_COST_PLAY : SP_COST_COUNTER;
  const mpCost = Math.max(0, Math.round(opts?.mpCost ?? 0));

  // ── 玩家行动 vs 目标敌 ──
  const targetThreat = targetIntent ? Math.max(0, Math.round(targetIntent.threat)) : 0;
  const targetCounters = targetIntent?.counters ?? [];
  const bonus = counterBonusOf(
    { move: targetIntent?.move ?? '', threat: targetThreat, counters: targetCounters },
    action.tags,
  );
  const roll = dice + Math.max(0, Math.round(action.power)) + bonus;
  const countered = roll >= targetThreat;
  const playerToTarget =
    Math.max(0, Math.round(action.power)) + (countered ? roll - targetThreat : 0);
  lines.push(
    countered
      ? `▸ 反制【${target.name}】的 ${targetIntent?.move ?? '攻击'}：d20=${dice}+行动值${Math.max(0, Math.round(action.power))}+克制${bonus} = ${roll} ≥ 威胁${targetThreat} → 反制成功（余量 ${roll - targetThreat}）`
      : `▸ 反制失败（差 ${targetThreat - roll}）——行动值 ${Math.max(0, Math.round(action.power))} 仍造成等量伤害`,
  );

  // 信息策略·读侧（效果批八）：窥探/洞悉在多敌分支作用于目标敌（纯战报，不改意图本体）
  const fmtIntent = (it: EnemyIntent | undefined, tag: string) =>
    it
      ? `${tag}「${it.move}」威胁 ${it.threat}` +
        (it.counters?.length ? `（反制:${it.counters.join('/')}）` : '')
      : null;
  if (opts?.effects?.some((e) => e.action === '窥探')) {
    const cur = target.intentIndex % target.intents.length;
    const fmt = target.intents
      .map(
        (it, i) =>
          `${i === cur ? '▶' : i + 1}.${it.move} 威胁${it.threat}` +
          (it.counters?.length ? `（反制:${it.counters.join('/')}）` : ''),
      )
      .join(' ｜ ');
    lines.push(`▸ 【窥探】【${target.name}】共 ${target.intents.length} 式：${fmt}`);
  }
  if ((s.activeEffects ?? []).some((e) => e.type === 'insight' && (e.beatsLeft ?? 0) > 0)) {
    const L = target.intents.length;
    const reveals = [1, 2]
      .map((k) =>
        fmtIntent(target.intents[(target.intentIndex + k) % L], k === 1 ? '下拍' : '下下拍'),
      )
      .filter(Boolean);
    if (reveals.length > 0) lines.push(`▸ 【洞悉】预读【${target.name}】：${reveals.join(' ｜ ')}`);
  }

  // ── 其余存活敌：威胁直砸玩家（防护/护盾减免，不可反制） ──
  let incoming = 0;
  const incomingLines: string[] = [];
  for (const { e, i } of alive) {
    if (i === targetIdx) continue;
    const it = e.intents[e.intentIndex % e.intents.length];
    const t = it ? Math.max(0, Math.round(it.threat)) : 0;
    if (t <= 0) continue;
    incoming += t;
    incomingLines.push(`▸ 【${e.name}】${it?.move ?? '攻击'}：威胁 ${t}`);
  }

  // ── 死亡退场 ──
  const deaths: string[] = [];

  // 玩家承伤：目标未反制部分 + 其余敌直砸，防护/护盾/免疫统一在入口减
  const attackerCount = alive.length;
  const playerDamage = countered
    ? Math.max(attackerCount > 0 ? 1 : 0, incoming - Math.floor(s.guard / 2))
    : Math.max(1, targetThreat + incoming - Math.floor(s.guard / 2));

  // 目标承伤：玩家伤害（反制成功加余量），护卫减伤只保护首领
  const aliveMinions = alive.filter(({ e: en }) => en.role === '杂兵').length;
  let targetDamage = playerToTarget;
  if (target.role === '首领') {
    const reduce = Math.min(60, aliveMinions * 20);
    targetDamage = Math.max(0, Math.round(targetDamage * (1 - reduce / 100)));
    if (reduce > 0) lines.push(`▸ 【护卫】${aliveMinions} 只杂兵庇护——首领承伤 −${reduce}%`);
  }
  const targetHpAfter = Math.max(0, target.hp - targetDamage);
  lines.push(
    `▸ ${action.cardName ? `打出 ${action.cardName}：` : ''}对【${target.name}】造成 ${targetDamage}（HP ${target.hp} → ${targetHpAfter}）`,
  );

  // 死亡判定
  if (targetHpAfter <= 0) deaths.push(`▸ 【${target.name}】倒下！`);

  // ── 敌方意图游标推进 ──
  const nextEnemies = enemies.map((e, i) => {
    if (e.dead || e.hp <= 0) return e;
    const hp = i === targetIdx ? targetHpAfter : e.hp;
    if (hp <= 0) return { ...e, hp: 0, dead: true, intentIndex: e.intentIndex + 1 };
    return { ...e, hp, intentIndex: (e.intentIndex + 1) % Math.max(1, e.intents.length) };
  });

  // 事件账本递增（效果批七）：本拍发生的全部事件计数
  const events: Partial<Record<import('./card-effects').BeatEvent, number>> = {
    ...(s.beatEvents ?? {}),
  };
  let next: SkirmishSession = {
    ...s,
    beat: s.beat + 1,
    beatEvents: events,
    playerHp: Math.max(0, s.playerHp - playerDamage),
    enemies: nextEnemies,
    playedCards:
      action.cardName && !s.playedCards.includes(action.cardName)
        ? [...s.playedCards, action.cardName]
        : s.playedCards,
    counteredBeats: s.counteredBeats + (countered ? 1 : 0),
    log: [...s.log, ...lines, ...incomingLines, ...deaths],
  };
  const bump = (k: import('./card-effects').BeatEvent, n = 1) => {
    events[k] = (events[k] ?? 0) + n;
  };
  if (action.cardName) bump('出卡');
  if (!countered && playerDamage > 0) bump('承受伤害');
  if (countered) bump('反制成功');
  // 多敌分支的治疗：打出时治疗/每拍寄生（drain）——本拍有任一来源即计
  const multiHealSources =
    (opts?.effects ?? []).some((e) => e.action === '治疗' && e.trigger !== '拍结束') ||
    (next.enemies ?? []).some(
      (e) => !e.dead && (e.statuses ?? []).some((st) => st.type === 'drain'),
    );
  if (multiHealSources) bump('治疗');
  if (next.enemyHp <= 0) bump('击杀');
  const deadThisBeat = (next.enemies ?? []).filter(
    (e, i) => e.dead && !(s.enemies?.[i]?.dead ?? false),
  ).length;
  if ((s.enemies?.length ?? 0) > 1 && deadThisBeat > 0) bump('友方退场', deadThisBeat);
  next.beatEvents = events;

  // 狂暴自伤 + 时之锚（效果批九·多敌同序：终局判定前，自伤可致死、锚不救致死拍）
  const berserkSelfMulti = (s.activeEffects ?? [])
    .filter((e) => e.type === 'berserk' && (e.beatsLeft === undefined || (e.beatsLeft ?? 0) > 0))
    .reduce((sum, e) => sum + Math.max(1, Math.round(e.amount / 10)), 0);
  if (berserkSelfMulti > 0 && next.playerHp > 0) {
    next = {
      ...next,
      playerHp: Math.max(0, next.playerHp - berserkSelfMulti),
      log: [...next.log, `▸ 【狂暴】血脉贲张反噬己身——自伤 ${berserkSelfMulti} HP`],
    };
  }
  const anchorMulti = (next.activeEffects ?? []).find((e) => e.type === 'timeAnchor');
  if (anchorMulti && next.playerHp > 0) {
    if ((anchorMulti.amount ?? 0) <= 0) {
      const effects3 = [...(next.activeEffects ?? [])];
      effects3[effects3.indexOf(anchorMulti)] = { ...anchorMulti, amount: next.playerHp };
      next = {
        ...next,
        activeEffects: effects3,
        log: [...next.log, `▸ 【时之锚】锚点落定于 ${next.playerHp} HP`],
      };
    } else if (next.playerHp < anchorMulti.amount) {
      const effects3 = (next.activeEffects ?? []).filter((e) => e !== anchorMulti);
      next = {
        ...next,
        playerHp: anchorMulti.amount,
        activeEffects: effects3,
        log: [...next.log, `▸ 【时之锚】时光倒流——气血回溯至锚点 ${anchorMulti.amount} HP`],
      };
    }
  }

  // 终局：首领倒下或全灭 → 胜利
  const leaderDead = nextEnemies.some((e) => e.role === '首领' && e.dead);
  const allDead = nextEnemies.every((e) => e.dead || e.hp <= 0);
  if (leaderDead || allDead) {
    return withFinish(next, '胜利', [
      ...(leaderDead ? [`▸ 【首领】倒下——护卫崩解，胜利！`] : []),
      `▸ 【敌方全灭】——胜利！`,
    ]);
  }
  if (next.playerHp <= 0) {
    return withFinish(next, '败北', ['▸ 玩家倒下——败北（经验照常结算，评价 C）']);
  }
  // ── 体力账（补齐：与单敌分支同口径——出卡 5 / 应对 3，招架返还 2，力竭败北） ──
  if (s.playerSp !== undefined) {
    const parryRefund =
      countered && (s.activeEffects ?? []).some((e) => e.type === 'parry' && (e.beatsLeft ?? 0) > 0)
        ? 2
        : 0;
    const spSpent = Math.max(0, (s.spSpent ?? 0) + spCost - parryRefund);
    const lines2 = [
      `▸ 体力 −${spCost}${parryRefund ? `（招架返还 2）` : ''}（剩 ${Math.max(0, s.playerSp - spSpent)}）`,
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
