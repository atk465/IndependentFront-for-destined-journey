/**
 * multiplier.ts — 卡牌技能倍率纯函数叶（2026-09-30 v2 共识实施）
 *
 * 共识文档：docs/planning/2026-09-30-card-skill-multiplier-values-table.md
 * 访谈：2026-09-28 Q1–Q19 + 2026-09-30 重评 Q7'/Q8'/Q10'/Q13'/Q20/Q22
 *
 * 公式总则：
 * - 技能强度 = 主轴派生 × 主倍率 + Σ 副轴派生 × 副倍率（副轴独立加法项）
 * - 替换制：出卡拍伤害 = 技能公式值；行动值退役为纯命中轴；
 *   无卡拍基础强攻 = 力量轴派生 × 标准表 120%
 * - 难度三表（爽战/标准/长战）由敌情评估 AI 开战选档、整场锁定、兜底标准
 * - 乘区链（Q13' 同层加算·跨层乘算）：
 *   ⌊公式值 × (1+Σ本拍伤害%) × (1+Σ敌方承伤%) × 暴击 × 好感 × 懒惰 × 首领护卫⌋ + 碾压余量
 *
 * 数值权威：本文件的表 = values-table 终审稿格值，单测锁定。
 * 卡面 value = 标准表倍率（批次 2 池重写时 EFFECT_POOL 对齐此约定，coerce 校验基准）。
 *
 * 纯度约束：无 I/O、无 Vue、无 Math.random；脏数据兜底不抛。
 */

import type { CardTier } from '../field-enums';
import type { EffectAction } from './card-effects';
import type { AttributeAxis } from './derived-stats';

/** 难度档（敌情评估 AI 选定，开战锁定） */
export type Difficulty = '爽战' | '标准' | '长战';
const DIFFICULTIES: readonly Difficulty[] = Object.freeze(['爽战', '标准', '长战']);
export const DEFAULT_DIFFICULTY: Difficulty = '标准';

export function coerceDifficulty(raw: unknown): Difficulty {
  return DIFFICULTIES.includes(raw as Difficulty) ? (raw as Difficulty) : DEFAULT_DIFFICULTY;
}

// ═══ 四分类（Q8'：62 条池的重分类口径）═══

export type EffectClass = '输出量' | '百分数' | '削敌' | '控制';

const CLASS_OUTPUT: ReadonlySet<string> = new Set([
  // 直击/治疗
  '伤害',
  '吸血',
  '治疗',
  // dot/持续量（每拍量进倍率）
  '中毒',
  '灼烧',
  '流血',
  '混乱',
  '标记',
  '寄生',
  '感染',
  '连携锚',
  '反伤',
  // 防御输出量
  '护盾',
  '格挡',
  // 兑现类治疗（条件即溢价来源）
  '任务',
  '契约·血誓',
  '赌一手',
]);
const CLASS_PCT: ReadonlySet<string> = new Set([
  // Q7' 重定基：本拍伤害+%（乘区链加算层 1）
  '连击',
  '双击',
  '风怒',
  '觉醒',
  '狂暴',
  '进化',
  '时间裂缝',
  '连锁风暴',
  '夺式',
  '功业',
  '分支',
  // 敌方承伤+%（加算层 2）
  '易伤',
  '诅咒',
  // 威胁−%（C 类的百分数形式归 B 语义口——作用对象敌侧标定）
  '缴械',
  // 斩杀线（HP% 阈值）
  '斩杀',
  '超杀',
  '处决',
  // 气血百分比
  '剧毒',
  '汲取',
  '终结一击',
]);
const CLASS_CUT: ReadonlySet<string> = new Set([
  '破防',
  '穿透',
  '虚弱',
  '迟缓',
  '冰冻',
  '退化',
  '恐惧',
  '束缚',
  '封印',
  '断章',
  '变异',
]);

/** 四分类查询（池外动作按「控制」兜底——0 值语义最安全） */
export function effectClassOf(action: EffectAction): EffectClass {
  if (CLASS_OUTPUT.has(action)) return '输出量';
  if (CLASS_PCT.has(action)) return '百分数';
  if (CLASS_CUT.has(action)) return '削敌';
  return '控制';
}

// ═══ 三套难度表（A 类输出量主倍率%；标准表 = 卡面 value 与池重写基准）═══
//
// 格值 = values-table 终审稿第二节/第三节，逐格定死（不用系数推导，避免舍入歧义）。
// 感染是递增 dot：表存首拍，步长另表 INFECTION_STEP（标准 30/40/50 → 步长 10）。

type PctTable = Readonly<Partial<Record<EffectAction, number>>>;

export const NUMERIC_TABLES: Readonly<Record<Difficulty, PctTable>> = Object.freeze({
  爽战: Object.freeze({
    伤害: 150,
    吸血: 120,
    治疗: 180,
    中毒: 50,
    灼烧: 80,
    流血: 45,
    混乱: 75,
    标记: 55,
    寄生: 50,
    感染: 35,
    连携锚: 45,
    反伤: 35,
    护盾: 30,
    格挡: 35,
    任务: 150,
    契约·血誓: 175,
    赌一手: 190,
  }),
  标准: Object.freeze({
    伤害: 120,
    吸血: 100,
    治疗: 150,
    中毒: 40,
    灼烧: 65,
    流血: 35,
    混乱: 60,
    标记: 45,
    寄生: 40,
    感染: 30,
    连携锚: 35,
    反伤: 30,
    护盾: 25,
    格挡: 30,
    任务: 120,
    契约·血誓: 140,
    赌一手: 150,
  }),
  长战: Object.freeze({
    伤害: 100,
    吸血: 80,
    治疗: 120,
    中毒: 30,
    灼烧: 50,
    流血: 30,
    混乱: 50,
    标记: 35,
    寄生: 30,
    感染: 25,
    连携锚: 30,
    反伤: 25,
    护盾: 20,
    格挡: 25,
    任务: 100,
    契约·血誓: 115,
    赌一手: 125,
  }),
});

/** 基础强攻倍率（无卡拍：力量轴派生 × 此值；Q7' 替换制） */
export const BASIC_ATTACK_PCT: Readonly<Record<Difficulty, number>> = Object.freeze({
  爽战: 150,
  标准: 120,
  长战: 100,
});

/** 感染（逐拍加深）的每拍步长 */
export const INFECTION_STEP: Readonly<Record<Difficulty, number>> = Object.freeze({
  爽战: 15,
  标准: 10,
  长战: 5,
});

/** A 类动作在指定难度表下的主倍率%（非 A 类/池外 → undefined） */
export function numericPctOf(action: EffectAction, difficulty: Difficulty): number | undefined {
  return NUMERIC_TABLES[difficulty][action];
}

// ═══ 副轴（Q4/Q6：离散档位池 + 0/1/1/2/2 条数阶梯）═══

/** 副倍率离散池（全档通用；AI/设计者只选档不写数） */
export const SECONDARY_POOL: readonly number[] = Object.freeze([20, 40, 60, 100]);

/** 每卡副轴条数上限（黑铁/青铜/白银/鎏金/星辉）——读侧走 secondarySlotsOf */
const SECONDARY_SLOTS: Readonly<Record<CardTier, number>> = Object.freeze({
  黑铁: 0,
  青铜: 1,
  白银: 1,
  鎏金: 2,
  星辉: 2,
});

export function secondarySlotsOf(tier: CardTier): number {
  return SECONDARY_SLOTS[tier] ?? 0;
}

/** 一条副轴加成（derivation 由接缝层按角色面板派生后传入结算；纯形状存卡面） */
export interface SecondaryAxis {
  axis: AttributeAxis;
  bonus: number;
}

const AXES: ReadonlySet<string> = new Set(['str', 'dex', 'con', 'int', 'spi']);

/**
 * 副轴门禁（与 coerceCardEffects 同款口径）：
 * - 非数组/超条数（档位上限）→ 整批丢弃
 * - 轴必须在五轴内、≠主轴、同轴不重复、bonus 必须在离散池内——违者丢弃该条
 * 全部非法 → []（无副轴，黑铁即此形态）。
 */
export function coerceSecondaryAxes(
  raw: unknown,
  mainAxis: AttributeAxis,
  tier: CardTier,
): SecondaryAxis[] {
  if (!Array.isArray(raw)) return [];
  const cap = secondarySlotsOf(tier);
  if (raw.length > cap) return [];
  const out: SecondaryAxis[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Partial<SecondaryAxis>;
    if (typeof e.axis !== 'string' || !AXES.has(e.axis)) continue;
    if (e.axis === mainAxis) continue; // 副轴≠主轴
    if (seen.has(e.axis)) continue; // 同轴不重复
    if (!SECONDARY_POOL.includes(e.bonus as number)) continue; // 池外档 → 丢弃
    seen.add(e.axis);
    out.push({ axis: e.axis as AttributeAxis, bonus: e.bonus as number });
  }
  return out;
}

// ═══ 技能公式（A 类输出量的结算基数）═══

export interface SkillAmountInput {
  /** A 类动作 */
  action: EffectAction;
  difficulty: Difficulty;
  /** 主轴派生（deriveCardAtk，接缝层传入） */
  mainDerivation: number;
  /** 副轴（derivation = 该轴派生 2×属性+等级，接缝层传入） */
  secondary: readonly { bonus: number; derivation: number }[];
}

export interface SkillAmountResult {
  /** 主项点数 */
  mainAmount: number;
  /** 主倍率%（审计行用） */
  mainPct: number;
  /** 副轴项合计点数 */
  secondaryAmount: number;
  /** 公式值 = 主项 + Σ副项（乘区链的输入基数） */
  amount: number;
}

/**
 * 技能公式值 = round(主轴派生×主倍率/100) + Σ round(副轴派生×副倍率/100)。
 * 取整口径：主项/副项各自四舍五入；乘区链结束后整体向下取整（aggregateDamage）。
 */
export function resolveSkillAmount(input: SkillAmountInput): SkillAmountResult {
  const mainPct = numericPctOf(input.action, input.difficulty) ?? 0;
  const main = Math.round((safeNum(input.mainDerivation) * mainPct) / 100);
  let secondaryAmount = 0;
  for (const s of input.secondary) {
    secondaryAmount += Math.round((safeNum(s.derivation) * s.bonus) / 100);
  }
  return { mainAmount: main, mainPct, secondaryAmount, amount: main + secondaryAmount };
}

/** 脏派生兜底（deriveCombatStats 同款纪律：绝不 NaN，非有限数按 0） */
function safeNum(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

// ═══ 乘区聚合器（Q13'：同层加算·跨层乘算）═══

export interface MultiplierBundle {
  /** 加算层 1：Σ本拍伤害%（连击/双击/风怒/觉醒/狂暴/进化/时间裂缝/连锁风暴/夺式/功业/分支） */
  powerBonusPct?: number;
  /** 加算层 2：Σ敌方承伤%（易伤/诅咒/变异承伤分支） */
  vulnerabilityPct?: number;
  /** 暴击倍率（d100 判定产物；缺省 1 = 未暴击） */
  crit?: number;
  /** 好感共鸣（×1.1~1.5；缺省 1） */
  affection?: number;
  /** 懒惰/双生 ×2 */
  lazy?: boolean;
  /** 首领护卫减免%（存活杂兵×20，封顶 60；只作用打向首领的伤害） */
  guardWingPct?: number;
}

export interface AggregateResult {
  total: number;
  /** 审计行（逐乘区可复算，结算行拆公式的素材） */
  trace: string[];
}

/**
 * 总伤害 = floor(公式值 × (1+Σ伤害%) × (1+Σ承伤%) × 暴击 × 好感 × 懒惰 × (1−护卫%))。
 * 碾压余量（margin）不在本函数内——由调用方在乘区外追加（Q13' 签核口径）。
 */
export function aggregateDamage(formula: number, bundle: MultiplierBundle): AggregateResult {
  const p1 = safePct(bundle.powerBonusPct);
  const p2 = safePct(bundle.vulnerabilityPct);
  const crit = safeMult(bundle.crit, 1);
  const aff = safeMult(bundle.affection, 1);
  const lazy = bundle.lazy ? 2 : 1;
  const wing = Math.min(60, Math.max(0, safePct(bundle.guardWingPct)));

  let v = Math.max(0, Math.round(formula));
  const trace: string[] = [`公式值 ${v}`];
  if (p1 > 0) {
    v = v * (1 + p1 / 100);
    trace.push(`×伤害+${p1}%`);
  }
  if (p2 > 0) {
    v = v * (1 + p2 / 100);
    trace.push(`×承伤+${p2}%`);
  }
  if (crit !== 1) {
    v *= crit;
    trace.push(`×暴击${crit}`);
  }
  if (aff !== 1) {
    v *= aff;
    trace.push(`×共鸣${aff}`);
  }
  if (lazy !== 1) {
    v *= 2;
    trace.push('×懒惰2');
  }
  if (wing > 0) {
    v *= 1 - wing / 100;
    trace.push(`×护卫−${wing}%`);
  }
  return { total: Math.floor(v), trace };
}

function safePct(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}
function safeMult(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 理论极值审计锚（values-table 第六节：≈×44 打杂兵 / ×17.5 打首领；实战不可达） */
export function theoreticalExtremeMultiplier(): number {
  // 加算层 1 全开：连击50+双击100+风怒150+觉醒25+狂暴50+进化第10拍50+时间裂缝50
  //   +连锁风暴15+在场10层30+夺式12+功业25+分支12 = 569%
  const p1 = 569;
  const p2 = 45; // 易伤25+诅咒20
  return (1 + p1 / 100) * (1 + p2 / 100) * 1.5 * 1.5 * 2;
}
