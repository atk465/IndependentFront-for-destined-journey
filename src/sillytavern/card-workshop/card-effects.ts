/**
 * card-effects.ts — 卡牌战斗效果池（2026-09-25 访谈共识实施）
 *
 * 两层架构（主人效果池文档）：
 * - 状态层：常驻/可叠层，带层数与剩余拍数（中毒/灼烧/流血/虚弱/易伤/迟缓/眩晕/冰冻/护盾/格挡）
 * - 动作层：一次性结算（伤害/治疗/吸血/连击/破防/驱散）
 * 效果描述公式：触发时机+目标+动作+数值+持续时间+代价（条件位留扩展，本批不实现）。
 *
 * 作者ship（访谈共识）：
 * - 元素→默认效果映射打底：所有战斗卡自动有保底区分（火→灼烧、暗→吸血…）
 * - 内容包 catalog.effects 可扩展池、可逐卡精配覆写（高阶 27 张精配表另批入库）
 * - 制卡：AI 从池内选（类型/目标/时机，数值池内定值），配 coerceCardEffects 门禁——
 *   池外选择丢弃、回落素材派生；AI 只写名字与描述
 *
 * 纯度约束：无 I/O、无 Vue；池注册是模块级 Map（与自定义天赋同款缝）。
 */

import type { CardTier } from '../field-enums';

/** 触发时机（首批三种） */
export type EffectTrigger = '打出时' | '每拍' | '受击时';
/** 目标三值：单血池下「敌全体」按 enemyCount 倍化 */
export type EffectTarget = '敌单体' | '敌全体' | '自身';
/** 动作层六动作 + 状态层十状态 */
export type EffectAction =
  // 动作层（一次性）
  | '伤害'
  | '治疗'
  | '吸血'
  | '连击'
  | '破防'
  | '驱散'
  | '真实伤害'
  | '净化'
  // 状态层（持续/叠层）
  | '中毒'
  | '灼烧'
  | '流血'
  | '虚弱'
  | '易伤'
  | '迟缓'
  | '眩晕'
  | '冰冻'
  | '护盾'
  | '格挡'
  // 状态层第二批（2026-09-25 效果批一）
  | '剧毒'
  | '恐惧'
  | '混乱'
  | '沉睡'
  | '束缚'
  | '诅咒'
  | '标记'
  | '圣盾'
  | '反伤'
  // 状态层第三批（效果批二）
  | '魅惑'
  | '沉默'
  | '招架'
  | '先攻'
  // 动作层第三批
  | '斩杀';

/** 代价（首批只收三种资源；正数值） */
export interface EffectCost {
  mp?: number;
  sp?: number;
  hp?: number;
}

/** 一条结构化卡牌效果（效果描述公式的落地形状） */
export interface CardEffectDef {
  trigger: EffectTrigger;
  target: EffectTarget;
  action: EffectAction;
  /** 数值（动作层=伤害/治疗量或倍率百分数；状态层=每拍量/层数强度） */
  value: number;
  /** 持续拍数（状态层；动作层缺省 0 = 即时） */
  duration?: number;
  /** 使用代价（本批只收资源） */
  cost?: EffectCost;
  /** 条件（schema 留位，本批不实现） */
  condition?: string;
}

/** 单卡效果集（卡定义上的新字段；派生打底与精配覆写都产出它） */
export type CardEffects = readonly CardEffectDef[];

/** 内建效果池：动作/状态的池内定值（AI 池内选的合法集；数值 = 初稿，终审对象） */
export interface PoolEntry {
  action: EffectAction;
  /** 池内定值（AI 不得改数） */
  value: number;
  /** 池内缺省持续拍数（状态层） */
  duration: number;
  /** 池内缺省代价 */
  cost?: EffectCost;
  /** 白话说明（AI 提示词与卡面展示共用） */
  text: string;
}

export const EFFECT_POOL: readonly PoolEntry[] = [
  // ── 动作层（打出时一次性） ──
  { action: '伤害', value: 8, duration: 0, text: '造成 8 点直接伤害' },
  { action: '治疗', value: 12, duration: 0, text: '回复 12 点 HP' },
  { action: '吸血', value: 10, duration: 0, cost: { mp: 5 }, text: '造成 10 点伤害并回复其中三成 HP' },
  { action: '连击', value: 50, duration: 0, cost: { sp: 3 }, text: '本拍行动值 +50%（两段出手）' },
  { action: '破防', value: 4, duration: 0, text: '本场敌方防护 −4（穿透护甲）' },
  { action: '驱散', value: 0, duration: 0, text: '驱散敌方全部增益状态' },
  // ── 状态层（持续/叠层） ──
  { action: '中毒', value: 3, duration: 3, text: '每拍敌方 −3 HP，可叠层（3 拍）' },
  { action: '灼烧', value: 4, duration: 2, text: '每拍敌方 −4 HP（2 拍）' },
  { action: '流血', value: 2, duration: 4, text: '每拍敌方 −2 HP，可叠层（4 拍）' },
  { action: '虚弱', value: 3, duration: 2, text: '敌方威胁 −3（2 拍）' },
  { action: '易伤', value: 25, duration: 2, text: '敌方受到的伤害 +25%（2 拍）' },
  { action: '迟缓', value: 3, duration: 2, text: '敌方行动值 −3（2 拍）' },
  { action: '眩晕', value: 0, duration: 1, cost: { mp: 10 }, text: '敌方一拍放弃行动（稀有）' },
  { action: '冰冻', value: 2, duration: 2, cost: { mp: 8 }, text: '敌方跳过攻击且威胁 −2（2 拍）' },
  { action: '护盾', value: 6, duration: 3, text: '每拍玩家减伤 6（3 拍）' },
  { action: '格挡', value: 4, duration: 1, text: '本拍玩家减伤 4，可叠层' },
  // ── 状态层第二批（效果批一 2026-09-25） ──
  { action: '剧毒', value: 5, duration: 3, text: '每拍敌方损失当前气血的 5%，可叠层（3 拍）' },
  { action: '恐惧', value: 0, duration: 2, text: '敌方威胁减半且无法反制（2 拍）' },
  { action: '混乱', value: 6, duration: 2, text: '敌方每拍自伤 6（2 拍）' },
  { action: '沉睡', value: 0, duration: 2, text: '敌方沉睡两拍放弃行动' },
  { action: '束缚', value: 0, duration: 2, text: '敌方威胁锁 1（2 拍）' },
  { action: '诅咒', value: 20, duration: 4, text: '敌方受到的伤害 +20%（4 拍）' },
  { action: '标记', value: 5, duration: 3, text: '敌方每拍额外损失 5 HP（3 拍）' },
  { action: '圣盾', value: 0, duration: 1, cost: { mp: 12 }, text: '免疫下一拍的全部伤害（一次性）' },
  { action: '反伤', value: 5, duration: 2, text: '受击时敌方反弹 5 HP（2 拍）' },
  // ── 状态层第三批（效果批二 2026-09-25） ──
  { action: '魅惑', value: 0, duration: 1, cost: { mp: 10 }, text: '敌方本拍为你说話——它的攻击转嫁为对你的伤害减免（1 拍）' },
  { action: '沉默', value: 0, duration: 2, text: '敌方无法反制（威胁不变，2 拍）' },
  { action: '招架', value: 5, duration: 2, text: '反制成功时返还 2 SP（2 拍）' },
  { action: '先攻', value: 3, duration: 2, text: '反制掷骰 +3（2 拍）' },
  // ── 动作层第三批 ──
  { action: '斩杀', value: 15, duration: 0, cost: { mp: 20 }, text: '敌方当前气血低于 15% 时直接击杀（未达线则本条空过）' },
];

/** 池查询：动作 → 池内定值条目（找不到 = 池外，门禁丢弃） */
export function poolEntryOf(action: EffectAction): PoolEntry | undefined {
  return EFFECT_POOL.find((e) => e.action === action);
}

// ── 元素→默认效果映射（派生打底；2026-09-25 访谈共识九映射） ──

/** 九元素 → 默认效果动作（素材决定效果的保底口径） */
export const ELEMENT_DEFAULT_EFFECT: Readonly<Record<string, EffectAction>> = Object.freeze({
  火: '灼烧',
  水: '治疗',
  风: '迟缓',
  土: '护盾',
  雷: '连击',
  光: '伤害',
  暗: '吸血',
  冰: '冰冻',
  金: '破防',
});

// ── 数值微差轨（攻击/耗能/防护修正；元素+档位派生） ──

/** 元素 → 三条微差（初稿：火攻/水护/风耗能，其余中性） */
const ELEMENT_STAT_MODS: Readonly<Record<string, { atk?: number; mp?: number; guard?: number }>> =
  Object.freeze({
    火: { atk: 1 },
    雷: { atk: 1 },
    水: { guard: 1 },
    冰: { guard: 1 },
    风: { mp: -1 },
    土: { guard: 2, mp: 1 },
    金: { atk: 1, mp: 1 },
    光: { mp: 1 },
    暗: { atk: 1 },
  });

/** 卡牌战斗数值微差（双轨之二；程序化派生，玩家感知的「手感差」） */
export interface CardStatMods {
  /** 出卡行动值修正 */
  atk: number;
  /** MP 消耗修正（负 = 更省） */
  mp: number;
  /** 开战防护修正 */
  guard: number;
}

/** 从词条中的元素与档位派生微差（无元素词条全零） */
export function statModsOf(
  词条: readonly string[] | null | undefined,
  cardTier: CardTier,
): CardStatMods {
  const words = Array.isArray(词条) ? 词条 : [];
  const mods: CardStatMods = { atk: 0, mp: 0, guard: 0 };
  for (const w of words) {
    const m = ELEMENT_STAT_MODS[w];
    if (!m) continue;
    mods.atk += m.atk ?? 0;
    mods.mp += m.mp ?? 0;
    mods.guard += m.guard ?? 0;
  }
  // 档位微差：高阶卡略省 MP（星辉 −1，鎏金 0，其余 0）——高阶卡已经很贵
  if (cardTier === '星辉') mods.mp -= 1;
  return mods;
}

// ── 派生与覆写 ──

/** 模块级精配覆写表（卡名 → 效果集；内容包逐卡精配经 registerCardEffects 灌入） */
const cardEffectOverrides = new Map<string, CardEffects>();

/** 登记精配覆写（同名覆盖；内容包 catalog.cardEffects 通道灌入） */
export function registerCardEffects(map: Record<string, unknown> | undefined): void {
  if (!map) return;
  for (const [name, effects] of Object.entries(map)) {
    const coerced = coerceCardEffects(effects);
    if (coerced.length > 0) cardEffectOverrides.set(name.trim(), coerced);
  }
}

/** 测试用清空 */
export function clearCardEffectOverrides(): void {
  cardEffectOverrides.clear();
}

/**
 * 派生一张卡的完整效果集：精配覆写优先，否则元素映射打底（主元素取词条中首个
 * 命中九元素的）。无元素词条 → 空集（卡仍有力/MP/SP 的基础语义，不硬造）。
 */
export function deriveCardEffects(
  card: Pick<CardItemLike, 'name' | '词条' | 'cardTier'>,
): CardEffects {
  const override = cardEffectOverrides.get(card.name);
  if (override) return override;
  // 卡面登记效果（AI 池内选）次优先——存的是原始形状，读侧再门禁一次
  const stored = coerceCardEffects((card as { cardEffects?: unknown }).cardEffects);
  if (stored.length > 0) return stored;
  const words = Array.isArray(card.词条) ? card.词条 : [];
  const element = words.find((w) => ELEMENT_DEFAULT_EFFECT[w] !== undefined);
  if (!element) return [];
  const action = ELEMENT_DEFAULT_EFFECT[element];
  const entry = poolEntryOf(action);
  if (!entry) return [];
  const def: CardEffectDef = {
    trigger: entry.duration > 0 ? '每拍' : '打出时',
    target: action === '治疗' || action === '护盾' || action === '格挡' ? '自身' : '敌单体',
    action,
    value: entry.value,
    ...(entry.duration > 0 ? { duration: entry.duration } : {}),
    ...(entry.cost ? { cost: entry.cost } : {}),
  };
  return [def];
}

/** 卡形状（避免引入 types 全量依赖） */
export interface CardItemLike {
  name: string;
  词条: readonly string[] | null | undefined;
  cardTier: CardTier;
  /** 卡面登记效果（AI 池内选经门禁存储；读侧再门禁——存档健壮性口径） */
  cardEffects?: unknown;
}

// ── 门禁（AI 池内选的越权防线） ──

/**
 * AI 效果选择 → 合法效果集（门禁）：
 * - 非数组/超量（>2 条）→ 整批丢弃（返回 []，调用方回落派生打底）
 * - 单条：动作必须在池内，且 value/duration/cost 与池内定值一致（AI 只选不改数）
 * - 触发时机/目标不在白名单 → 丢弃该条
 * 全部非法时返回 []（派生打底兜底）；部分合法保留合法条。
 */
export function coerceCardEffects(raw: unknown): CardEffects {
  if (!Array.isArray(raw)) return [];
  if (raw.length > 2) return []; // 超量整批丢弃（防滥用；单卡上限 2 条）
  const out: CardEffectDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Partial<CardEffectDef>;
    const entry = poolEntryOf(e.action as EffectAction);
    if (!entry) continue; // 池外动作 → 丢弃
    if (!isTrigger(e.trigger) || !isTarget(e.target)) continue;
    const value = typeof e.value === 'number' && Number.isFinite(e.value) ? Math.round(e.value) : -1;
    if (value !== entry.value) continue; // AI 改数 → 丢弃
    const duration = Math.max(0, Math.round(typeof e.duration === 'number' ? e.duration : 0));
    if (duration !== entry.duration) continue;
    const cost = sanitizeCost(e.cost, entry.cost);
    if (JSON.stringify(cost ?? {}) !== JSON.stringify(entry.cost ?? {})) continue;
    out.push({
      trigger: e.trigger,
      target: e.target,
      action: entry.action,
      value,
      ...(duration > 0 ? { duration } : {}),
      ...(cost ? { cost } : {}),
    });
  }
  return out;
}

function isTrigger(v: unknown): v is EffectTrigger {
  return v === '打出时' || v === '每拍' || v === '受击时';
}
function isTarget(v: unknown): v is EffectTarget {
  return v === '敌单体' || v === '敌全体' || v === '自身';
}
function sanitizeCost(raw: unknown, pool: EffectCost | undefined): EffectCost | undefined {
  if (!pool) return raw === undefined || raw === null ? undefined : { mp: -1 }; // 池内无代价而 AI 给了 → 非法
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Partial<EffectCost>;
  const clean: EffectCost = {};
  if (pool.mp !== undefined) clean.mp = typeof c.mp === 'number' ? Math.round(c.mp) : pool.mp;
  if (pool.sp !== undefined) clean.sp = typeof c.sp === 'number' ? Math.round(c.sp) : pool.sp;
  if (pool.hp !== undefined) clean.hp = typeof c.hp === 'number' ? Math.round(c.hp) : pool.hp;
  return clean;
}

/** 效果的卡面展示行（UI 与 AI 提示词共用措辞） */
export function effectLineOf(e: CardEffectDef): string {
  const entry = poolEntryOf(e.action);
  const text = entry ? entry.text : e.action;
  // 动作名置前（状态名即识别符）；「自身」省目标前缀；敌全体带「对每个敌人」；
  // 持续时长池内 text 自带，此处不重复追加
  const prefix = e.target === '敌全体' ? '对每个敌人：' : '';
  const cost = e.cost
    ? `［代价 ${[
        e.cost.mp ? `${e.cost.mp}MP` : '',
        e.cost.sp ? `${e.cost.sp}SP` : '',
        e.cost.hp ? `${e.cost.hp}HP` : '',
      ]
        .filter(Boolean)
        .join('/')}］`
    : '';
  return `${prefix}【${e.action}】${text}${cost}`;
}
