/**
 * talent-entry.ts — 天赋骨架条目池 + 融合化学反应（天赋系统 T-S1）
 *
 * 共识：docs/planning/2026-09-14-talent-system-design.md（访谈 T1~T8）。
 * 两层模型：表现归 AI（天赋名/描述），数值归 Code（骨架条目必须逐字命中池内预设）。
 *
 * 确定性契约：
 * - AI 零编数：validateTalentEntries 逐条比对池内预设（kind + params 全等），
 *   编出的数值/未知条目一律拒绝——这就是「AI 零写路径」在天赋上的门禁。
 * - 融合化学反应纯函数：品质锁定(保底) + 品质锁定(上限) → 品质突破（对消爆发，
 *   正是【垃圾摩托】的来历），其余条目照抄、去重、互斥组过滤，结果可复算。
 * - 品质「越一级」按 RARITY_LEVELS 索引 +1，制作封顶传说（唯一不可生产）。
 * - 池与独占都是**数据表**：加条目/加渠道 = 加数据不改代码（主人裁定：保留扩渠道）。
 */

import { RARITY_LEVELS, type Rarity } from '../field-enums';

/** 渠道（可扩展枚举：加渠道 = 加值 + 数据表加行） */
export type TalentChannel = 'creation' | 'story' | 'exchange' | 'fusion' | 'universal';

/** 骨架条目种类（v1 八条目） */
export type TalentEntryKind =
  // 数值层（Code 直算）
  | '材料限定'
  | '成品限定'
  | '成功率加成'
  | '品质锁定'
  | '品质突破'
  | '启封加值'
  | '行动值加成'
  | '防御加值'
  | '产出数量' // 每次制作额外产出 n 份（丰饶祝福）
  | '风险系数' // 成功率波动 ±%（梦境织造者时好时坏 / 侏儒工程师爆炸率）
  | '金钱加投' // 制卡时投入额外金钱换成功率与正面词条（鎏金大佬）
  | '判定取优' // 掷骰取两次较高者（欧皇系统）
  // 生成倾向层（改写炼制提示词：数值=权重档，内容=AI 生成）
  | '词条加权' // 关键词更常出现（倾向1/强倾向2/必附3）
  | '形态转化' // 产出物形态定向为某系列（猫娘/塞壬/菌娘…）
  // 战技赋予层（交锋拍战技表落地）
  | '战技附加' // 产出的卡带战斗状态（中毒/减速/眩晕…），params 携带量与持续拍数
  // 数值层·击杀与连胜
  | '击杀掠取' // 击败敌人时缴获赏金（踏碎的尊严/无限猎杀系统）
  | '连战递增' // 每多打一拍行动值递增（征服印记/无情连打）
  | '鉴定'; // 感知素材真实价值（风味条目，无机械参数）

/** 骨架条目：kind + 预设参数 + 独占渠道标记 */
export interface TalentEntry {
  kind: TalentEntryKind;
  channel: TalentChannel;
  params: {
    /** 材料限定 / 品质突破·域限定的材料类别（如「废弃」） */
    materialClass?: string;
    /** 成品限定 / 品质突破·域限定的成品类别（如「简单载具」「摩托」） */
    productClass?: string;
    /** 成功率加成档位（%）：20 / 30 / 50 / 100(必成) */
    bonus?: number;
    /** 品质锁定方向 */
    direction?: '保底' | '上限';
    /** 品质锁定档位（v1 预设：普通） */
    tier?: Rarity;
    /** 启封/行动值/防御 加值档位：1 / 2 / 3 / 4 */
    amount?: number;
    /** 互斥组（同组非空值不可共存，如「攻防」） */
    excl?: string;
    /** 产出数量（+n 份） */
    copies?: number;
    /** 风险系数（成功率波动 ±n%，或爆炸/劣化概率 n%） */
    risk?: number;
    /** 金钱加投（每次制卡额外投入 nG） */
    gold?: number;
    /** 词条加权的关键词组（如 忠诚/追踪） */
    keywords?: string[];
    /** 词条加权档位：1 倾向 / 2 强倾向 / 3 必附 */
    weight?: 1 | 2 | 3;
    /** 形态转化的系列名（猫娘/塞壬/菌娘…） */
    series?: string;
    /** 战技附加：状态名（中毒/减速/眩晕…） */
    status?: string;
    /** 战技附加：量（DoT 伤害 / 威胁降低值） */
    power?: number;
    /** 战技附加：持续拍数 */
    beats?: number;
  };
}

// ========== 骨架条目池 v1（单一真源；加条目 = 加数组元素） ==========

const e = (entry: TalentEntry): TalentEntry => entry;

/** 池内预设条目（AI 授予/兑换/捏人的条目只能从这里逐字选取） */
export const TALENT_ENTRY_POOL: readonly TalentEntry[] = [
  // ── 制作域 ──
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '废弃' } }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '犬类' } }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '羽毛' } }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '水晶' } }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '植物' } }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '血液' } }),
  e({ kind: '成品限定', channel: 'universal', params: { productClass: '简单载具' } }),
  e({ kind: '成品限定', channel: 'universal', params: { productClass: '靴袜腿甲' } }),
  e({ kind: '成品限定', channel: 'universal', params: { productClass: '武器' } }),
  e({ kind: '成功率加成', channel: 'universal', params: { bonus: 20 } }),
  e({ kind: '成功率加成', channel: 'universal', params: { bonus: 30 } }),
  e({ kind: '成功率加成', channel: 'universal', params: { bonus: 50 } }),
  e({ kind: '品质锁定', channel: 'universal', params: { direction: '保底', tier: '普通' } }),
  e({ kind: '品质锁定', channel: 'universal', params: { direction: '上限', tier: '普通' } }),
  e({
    kind: '品质突破',
    channel: 'fusion',
    params: { materialClass: '废弃', productClass: '摩托' },
  }),
  // ── 交锋拍域 ──
  e({ kind: '启封加值', channel: 'universal', params: { amount: 1 } }),
  e({ kind: '启封加值', channel: 'universal', params: { amount: 2 } }),
  e({ kind: '行动值加成', channel: 'universal', params: { amount: 2 } }),
  e({ kind: '行动值加成', channel: 'universal', params: { amount: 3 } }),
  e({ kind: '防御加值', channel: 'universal', params: { amount: 4 } }),
  e({ kind: '行动值加成', channel: 'universal', params: { amount: 3, excl: '攻防' } }),
  e({ kind: '防御加值', channel: 'universal', params: { amount: 4, excl: '攻防' } }),
  // ── v2 扩容（截图灵感；数值/倾向/战技三层）──
  e({ kind: '产出数量', channel: 'universal', params: { copies: 1 } }),
  e({ kind: '风险系数', channel: 'universal', params: { risk: 20 } }),
  e({ kind: '金钱加投', channel: 'universal', params: { gold: 50, bonus: 20 } }),
  e({ kind: '判定取优', channel: 'exchange', params: {} }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['忠诚', '追踪'], weight: 2 } }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['飞行', '加速'], weight: 2 } }),
  e({
    kind: '词条加权',
    channel: 'universal',
    params: { keywords: ['魔法增幅', '精神守护'], weight: 2 },
  }),
  e({
    kind: '词条加权',
    channel: 'universal',
    params: { keywords: ['迅捷', '优雅', '防滑'], weight: 1 },
  }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['加速', '暴击'], weight: 3 } }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['恶臭', '感染'], weight: 3 } }),
  e({ kind: '形态转化', channel: 'universal', params: { series: '猫娘' } }),
  e({ kind: '形态转化', channel: 'universal', params: { series: '塞壬' } }),
  e({ kind: '形态转化', channel: 'universal', params: { series: '菌娘' } }),
  e({ kind: '形态转化', channel: 'universal', params: { series: '树妖' } }),
  e({ kind: '战技附加', channel: 'universal', params: { status: '中毒', power: 3, beats: 3 } }),
  e({ kind: '战技附加', channel: 'universal', params: { status: '蚀血', power: 4, beats: 2 } }),
  e({ kind: '战技附加', channel: 'universal', params: { status: '减速', power: 4, beats: 2 } }),
  e({ kind: '战技附加', channel: 'universal', params: { status: '眩晕', power: 0, beats: 1 } }),
  e({ kind: '战技附加', channel: 'universal', params: { status: '魅惑', power: 0, beats: 1 } }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['敏捷'], weight: 2 } }),
  // ── v3 扩容（击杀/连胜/鉴定 + 新材料类）──
  e({ kind: '击杀掠取', channel: 'universal', params: { gold: 10 } }),
  e({ kind: '击杀掠取', channel: 'universal', params: { gold: 5 } }),
  e({ kind: '连战递增', channel: 'universal', params: { amount: 3 } }),
  e({ kind: '连战递增', channel: 'universal', params: { amount: 2 } }),
  e({ kind: '鉴定', channel: 'universal', params: {} }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '植物' } }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '亡灵' } }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '兽类' } }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '岩石' } }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '水域' } }),
  e({ kind: '成功率加成', channel: 'universal', params: { bonus: 100 } }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['圣遗物'], weight: 2 } }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['土墙', '地刺'], weight: 2 } }),
  e({ kind: '战技附加', channel: 'universal', params: { status: '驯服', power: 0, beats: 1 } }),
  e({ kind: '战技附加', channel: 'universal', params: { status: '退化', power: 6, beats: 2 } }),
  e({ kind: '战技附加', channel: 'universal', params: { status: '墨狼', power: 2, beats: 2 } }),
  // ── 渠道独占 ──
  e({ kind: '成功率加成', channel: 'creation', params: { bonus: 20, excl: '天才卡师' } }),
  e({
    kind: '启封加值',
    channel: 'story',
    params: { amount: 1, excl: '命运宠儿' },
  }),
  e({ kind: '行动值加成', channel: 'story', params: { amount: 1, excl: '命运宠儿' } }),
  e({ kind: '防御加值', channel: 'story', params: { amount: 1, excl: '命运宠儿' } }),
  e({ kind: '启封加值', channel: 'exchange', params: { amount: 2, excl: '卡牌宗师' } }),
  e({ kind: '行动值加成', channel: 'exchange', params: { amount: 2, excl: '卡牌宗师' } }),
];

/** 参数全等（逐键比较全部已知参数位；新参数加入时同步这里） */
function sameParams(a: TalentEntry['params'], b: TalentEntry['params']): boolean {
  return (
    a.materialClass === b.materialClass &&
    a.productClass === b.productClass &&
    a.bonus === b.bonus &&
    a.direction === b.direction &&
    a.tier === b.tier &&
    a.amount === b.amount &&
    a.excl === b.excl &&
    a.copies === b.copies &&
    a.risk === b.risk &&
    a.gold === b.gold &&
    a.weight === b.weight &&
    a.series === b.series &&
    a.status === b.status &&
    a.power === b.power &&
    a.beats === b.beats &&
    a.gold === b.gold &&
    a.copies === b.copies
  );
}

/** 条目全等（kind + params + channel 逐字段；校验和融合都用它，不落 JSON.stringify） */
export function sameEntry(a: TalentEntry, b: TalentEntry): boolean {
  return a.kind === b.kind && a.channel === b.channel && sameParams(a.params, b.params);
}

/** 池内查找：kind + params 全等即命中（channel 由授予渠道决定，不参与比对） */
function findPreset(entry: TalentEntry): TalentEntry | undefined {
  return TALENT_ENTRY_POOL.find((p) => p.kind === entry.kind && sameParams(p.params, entry.params));
}

/** 条目规范化：命中池 → 返回池内规范对象（channel 以池为准）；未命中 → null */
export function normalizeTalentEntry(entry: TalentEntry): TalentEntry | null {
  return findPreset(entry) ?? null;
}

/**
 * 条目校验（AI 零编数门禁）：每一条都必须逐字命中池内预设；命中后**回填池内规范对象**
 * （channel 以池为准——独占天赋的条目渠道标记不可被授予方改写）。任一条不命中 → 整组拒绝。
 */
export function validateTalentEntries(entries: readonly TalentEntry[]): {
  ok: boolean;
  reason?: string;
  normalized: TalentEntry[];
} {
  const normalized: TalentEntry[] = [];
  for (const entry of entries) {
    const preset = findPreset(entry);
    if (!preset) {
      return {
        ok: false,
        reason: `条目「${entry.kind}」不在骨架条目池内（AI 零编数）`,
        normalized: [],
      };
    }
    normalized.push(preset);
  }
  return { ok: true, normalized };
}

// ========== 融合化学反应 ==========

/** 品质越一级（RARITY_LEVELS 索引 +1，制作封顶传说——唯一不可生产） */
export function tierUp(tier: Rarity): Rarity {
  const idx = RARITY_LEVELS.indexOf(tier);
  const next = RARITY_LEVELS[Math.min(idx + 1, RARITY_LEVELS.indexOf('传说'))];
  return next ?? '传说';
}

/**
 * 融合化学反应（纯函数）：两源条目合并 →
 *   ① 对消爆发：品质锁定(保底) + 品质锁定(上限) → 品质突破（域取两源并集）；
 *   ② 其余照抄、完全同条目去重；
 *   ③ 互斥组过滤：同组非空 excl 只保留先出现的一条。
 * 结果可复算——审计行按本函数逐步出。
 */
export function fuseEntrySets(a: readonly TalentEntry[], b: readonly TalentEntry[]): TalentEntry[] {
  let merged: TalentEntry[] = [...a, ...b];
  const floorIdx = merged.findIndex((t) => t.kind === '品质锁定' && t.params.direction === '保底');
  const capIdx = merged.findIndex((t) => t.kind === '品质锁定' && t.params.direction === '上限');
  if (floorIdx !== -1 && capIdx !== -1) {
    // 突破的域从合并集的 材料限定/成品限定 条目收获（节俭持家×摩托小子 → 废弃+摩托）
    const materialClass = merged.find((t) => t.kind === '材料限定')?.params.materialClass;
    const productClass = merged.find((t) => t.kind === '成品限定')?.params.productClass;
    const breakthrough: TalentEntry = {
      kind: '品质突破',
      channel: 'fusion',
      params: {
        ...(materialClass ? { materialClass } : {}),
        ...(productClass ? { productClass } : {}),
      },
    };
    merged = merged.filter((_, i) => i !== floorIdx && i !== capIdx);
    merged.push(breakthrough);
  }
  // 去重（完全同条目）
  const deduped: TalentEntry[] = [];
  for (const t of merged) {
    if (!deduped.some((d) => sameEntry(d, t))) deduped.push(t);
  }
  // 互斥组过滤：同组非空 excl 保先出现的
  const seen = new Set<string>();
  return deduped.filter((t) => {
    const g = t.params.excl;
    if (!g) return true;
    if (seen.has(g)) return false;
    seen.add(g);
    return true;
  });
}

// ========== 天赋目录（捏人/兑换/剧情授予的命名模板；融合独占条目也在册但不可直接获得） ==========

/** 天赋品级（照截图品级制；影响兑换定价与（未来）授予出现权重） */
export type TalentGrade = 'SSS' | 'SS' | 'S' | 'A' | 'B' | 'C' | 'D' | 'E';

/** 品级 → 兑换定价乘数（初稿：SSS×4 … E×1；数值总表终审对象） */
export const GRADE_PRICE_MULTIPLIER: Record<TalentGrade, number> = {
  SSS: 4,
  SS: 3,
  S: 2.5,
  A: 2,
  B: 1.5,
  C: 1.2,
  D: 1,
  E: 1,
};

/** 命名天赋模板：渠道归属 + 品级 + 骨架条目组合（名字即模板键） */
export interface TalentTemplate {
  name: string;
  source: TalentChannel;
  grade: TalentGrade;
  /** 融合独占：只能由融合产生，任何渠道不可直接获得 */
  fusionOnly?: boolean;
  description?: string;
  entries: TalentEntry[];
}

const entry = (
  kind: TalentEntryKind,
  channel: TalentChannel,
  params: TalentEntry['params'],
): TalentEntry => ({ kind, channel, params });

/** v1 天赋目录（单一真源；加天赋 = 加一条模板） */
export const TALENT_CATALOG: readonly TalentTemplate[] = [
  // ── 通用池（三渠道皆可）──
  {
    name: '节俭持家',
    grade: 'D' as TalentGrade,
    source: 'universal',
    description: '总能把垃圾变成不那么垃圾的东西。',
    entries: [
      entry('材料限定', 'universal', { materialClass: '废弃' }),
      entry('成功率加成', 'universal', { bonus: 50 }),
      entry('品质锁定', 'universal', { direction: '保底', tier: '普通' }),
    ],
  },
  {
    name: '摩托小子',
    grade: 'D' as TalentGrade,
    source: 'universal',
    description: '只对结构简单的双轮魔动车感兴趣，且颇有手感。',
    entries: [
      entry('成品限定', 'universal', { productClass: '简单载具' }),
      entry('成功率加成', 'universal', { bonus: 30 }),
      entry('品质锁定', 'universal', { direction: '上限', tier: '普通' }),
    ],
  },
  {
    name: '封印亲和',
    grade: 'B' as TalentGrade,
    source: 'universal',
    description: '封印物在你面前总是格外温顺。',
    entries: [entry('启封加值', 'universal', { amount: 2 })],
  },
  {
    name: '斗志昂扬',
    grade: 'B' as TalentGrade,
    source: 'universal',
    description: '出手永远带着三分先声。',
    entries: [entry('行动值加成', 'universal', { amount: 3, excl: '攻防' })],
  },
  {
    name: '铜筋铁骨',
    grade: 'B' as TalentGrade,
    source: 'universal',
    description: '硬挨一下，不丢人。',
    entries: [entry('防御加值', 'universal', { amount: 4, excl: '攻防' })],
  },
  {
    name: '卡牌大师',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '启封与出手，一气呵成。',
    entries: [
      entry('启封加值', 'universal', { amount: 1 }),
      entry('行动值加成', 'universal', { amount: 2 }),
    ],
  },
  // ── 渠道独占 ──
  {
    name: '天才卡师',
    grade: 'C' as TalentGrade,
    source: 'creation',
    description: '天生就是吃这碗饭的。',
    entries: [entry('成功率加成', 'creation', { bonus: 20, excl: '天才卡师' })],
  },
  {
    name: '命运宠儿',
    grade: 'S' as TalentGrade,
    source: 'story',
    description: '命运偶尔也会偏心。',
    entries: [
      entry('启封加值', 'story', { amount: 1, excl: '命运宠儿' }),
      entry('行动值加成', 'story', { amount: 1, excl: '命运宠儿' }),
      entry('防御加值', 'story', { amount: 1, excl: '命运宠儿' }),
    ],
  },
  {
    name: '卡牌宗师',
    grade: 'SS' as TalentGrade,
    source: 'exchange',
    description: '宗师之手，点卡成金。',
    entries: [
      entry('启封加值', 'exchange', { amount: 2, excl: '卡牌宗师' }),
      entry('行动值加成', 'exchange', { amount: 2, excl: '卡牌宗师' }),
    ],
  },
  // ── v2 扩容（截图灵感精选；生成倾向/战技/数值三层）──
  {
    name: '犬类伙伴',
    grade: 'C' as TalentGrade,
    source: 'universal',
    description: '你更容易获得犬类魔物的信任。',
    entries: [
      e({ kind: '材料限定', channel: 'universal', params: { materialClass: '犬类' } }),
      e({
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['忠诚', '追踪'], weight: 2 },
      }),
    ],
  },
  {
    name: '风之语',
    grade: 'B' as TalentGrade,
    source: 'universal',
    description: '羽毛与落叶会向你低语风的方向。',
    entries: [
      e({ kind: '材料限定', channel: 'universal', params: { materialClass: '羽毛' } }),
      e({
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['飞行', '加速'], weight: 2 },
      }),
    ],
  },
  {
    name: '水晶雕刻家',
    grade: 'D' as TalentGrade,
    source: 'universal',
    description: '水晶与宝石在你手里格外听话。',
    entries: [
      e({ kind: '材料限定', channel: 'universal', params: { materialClass: '水晶' } }),
      e({
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['魔法增幅', '精神守护'], weight: 2 },
      }),
    ],
  },
  {
    name: '恋足癖',
    grade: 'C' as TalentGrade,
    source: 'universal',
    description: '专注足部装备卡，成品常带令人在意的风味。',
    entries: [
      e({ kind: '成品限定', channel: 'universal', params: { productClass: '靴袜腿甲' } }),
      e({
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['迅捷', '优雅', '防滑'], weight: 1 },
      }),
    ],
  },
  {
    name: '污秽武装',
    grade: 'C' as TalentGrade,
    source: 'universal',
    description: '武器会散发令人不适的气息——对敌人而言。',
    entries: [
      e({ kind: '成品限定', channel: 'universal', params: { productClass: '武器' } }),
      e({
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['恶臭', '感染'], weight: 3 },
      }),
    ],
  },
  {
    name: '速度与激情',
    grade: 'B' as TalentGrade,
    source: 'universal',
    description: '你做的所有卡都格外快，且带一点疯狂。',
    entries: [
      e({
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['加速', '暴击'], weight: 3 },
      }),
    ],
  },
  {
    name: '猫之九命',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description: '你的卡牌会转化为慵懒而敏捷的猫娘系生物。',
    entries: [
      e({ kind: '形态转化', channel: 'universal', params: { series: '猫娘' } }),
      e({ kind: '词条加权', channel: 'universal', params: { keywords: ['敏捷'], weight: 2 } }),
    ],
  },
  {
    name: '海妖之歌',
    grade: 'B' as TalentGrade,
    source: 'universal',
    description: '歌声能魅惑心智不坚定的敌人。',
    entries: [
      e({ kind: '形态转化', channel: 'universal', params: { series: '塞壬' } }),
      e({ kind: '形态转化', channel: 'universal', params: { series: '菌娘' } }),
      e({ kind: '形态转化', channel: 'universal', params: { series: '树妖' } }),
      e({
        kind: '战技附加',
        channel: 'universal',
        params: { status: '魅惑', power: 0, beats: 1 },
      }),
    ],
  },
  {
    name: '足尖的剧毒',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '足尖的剧毒会慢慢侵蚀敌人的神经。',
    entries: [
      e({
        kind: '战技附加',
        channel: 'universal',
        params: { status: '中毒', power: 3, beats: 3 },
      }),
    ],
  },
  {
    name: '收缩射线',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '被射线照到的敌人会暂时变小、大幅削弱属性。',
    entries: [
      e({
        kind: '战技附加',
        channel: 'universal',
        params: { status: '减速', power: 4, beats: 2 },
      }),
    ],
  },
  {
    name: '丰饶祝福',
    grade: 'B' as TalentGrade,
    source: 'universal',
    description: '受到丰收女神的眷顾，产出总比预期多一份。',
    entries: [e({ kind: '产出数量', channel: 'universal', params: { copies: 1 } })],
  },
  {
    name: '鎏金大佬',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description: '投的钱越多，卡越好看——这是真理。',
    entries: [e({ kind: '金钱加投', channel: 'universal', params: { gold: 50, bonus: 20 } })],
  },
  {
    name: '欧皇系统',
    grade: 'SS' as TalentGrade,
    source: 'exchange',
    description: '你的幸运值被锁定在一个极高的水平。',
    entries: [e({ kind: '判定取优', channel: 'exchange', params: {} })],
  },
  {
    name: '梦境织造者',
    grade: 'D' as TalentGrade,
    source: 'universal',
    description: '睡着后制卡，效果时好时坏。',
    entries: [e({ kind: '风险系数', channel: 'universal', params: { risk: 20 } })],
  },

  // ── v3 扩容（击杀/连胜/鉴定/新材料）──
  {
    name: '踏碎的尊严',
    grade: 'B' as TalentGrade,
    source: 'universal',
    description: '击败敌人时，总能从尸体上踩出少量卡币。',
    entries: [e({ kind: '击杀掠取', channel: 'universal', params: { gold: 10 } })],
  },
  {
    name: '无限猎杀系统',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description: '每击杀一个敌人都会掉落灵魂碎片，可用于提升等级或强化装备。',
    entries: [e({ kind: '击杀掠取', channel: 'universal', params: { gold: 5 } })],
  },
  {
    name: '我来!我见!我征服!',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description: '每击败一名目标，你就获得一层征服印记，越战越强。',
    entries: [e({ kind: '连战递增', channel: 'universal', params: { amount: 3 } })],
  },
  {
    name: '无情连打',
    grade: 'C' as TalentGrade,
    source: 'universal',
    description: '他会执着于将一个敌人彻底击倒。',
    entries: [e({ kind: '连战递增', channel: 'universal', params: { amount: 2 } })],
  },
  {
    name: '植物大战僵尸',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description: '制作植物和亡灵卡时必定成功。',
    entries: [
      e({ kind: '材料限定', channel: 'universal', params: { materialClass: '植物' } }),
      e({ kind: '材料限定', channel: 'universal', params: { materialClass: '亡灵' } }),
      e({ kind: '成功率加成', channel: 'universal', params: { bonus: 100 } }),
    ],
  },
  {
    name: '御兽奇才·东方',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description: '你与万兽有天然的亲和力，制作伙伴卡时成功率大幅提升。',
    entries: [
      e({ kind: '材料限定', channel: 'universal', params: { materialClass: '兽类' } }),
      e({ kind: '成功率加成', channel: 'universal', params: { bonus: 50 } }),
    ],
  },
  {
    name: '血肉诅咒',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '擅长用血液、脓胎等素材制作恶毒的诅咒道具。',
    entries: [
      e({ kind: '材料限定', channel: 'universal', params: { materialClass: '血液' } }),
      e({
        kind: '战技附加',
        channel: 'universal',
        params: { status: '蚀血', power: 4, beats: 2 },
      }),
    ],
  },
  {
    name: '墨绘丹青',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '水墨风味的卡牌，生物移动时会留下墨狼。',
    entries: [
      e({
        kind: '战技附加',
        channel: 'universal',
        params: { status: '墨狼', power: 2, beats: 2 },
      }),
      e({
        kind: '战技附加',
        channel: 'universal',
        params: { status: '减速', power: 4, beats: 2 },
      }),
    ],
  },
  {
    name: '汗湿的诱惑',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '极常出汗的女性卡牌，散发出浓郁的气息。',
    entries: [
      e({
        kind: '战技附加',
        channel: 'universal',
        params: { status: '魅惑', power: 0, beats: 1 },
      }),
    ],
  },
  {
    name: '黏菌共生体',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '你的卡牌会转化为可爱的菌娘，能够分裂并拥抱感染敌人。',
    entries: [
      e({ kind: '形态转化', channel: 'universal', params: { series: '菌娘' } }),
      e({
        kind: '战技附加',
        channel: 'universal',
        params: { status: '魅惑', power: 0, beats: 1 },
      }),
    ],
  },
  {
    name: '烈马驯教者',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '拥有绝对压制力，桀骜的坐骑终将变为你的专属。',
    entries: [
      e({
        kind: '战技附加',
        channel: 'universal',
        params: { status: '驯服', power: 0, beats: 1 },
      }),
    ],
  },
  {
    name: '退化射线',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description: '能将敌人的伙伴卡在战斗中降低一个等级。',
    entries: [
      e({
        kind: '战技附加',
        channel: 'universal',
        params: { status: '退化', power: 6, beats: 2 },
      }),
    ],
  },
  {
    name: '圣婴之躯',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '制作的伙伴卡有概率携带圣遗物——异味也会放大两倍。',
    entries: [
      e({
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['圣遗物'], weight: 2 },
      }),
    ],
  },
  {
    name: '大地之握',
    grade: 'B' as TalentGrade,
    source: 'universal',
    description: '岩石与土壤在你手里坚不可摧。',
    entries: [
      e({ kind: '材料限定', channel: 'universal', params: { materialClass: '岩石' } }),
      e({
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['土墙', '地刺'], weight: 2 },
      }),
    ],
  },
  {
    name: '草药学徒',
    grade: 'C' as TalentGrade,
    source: 'universal',
    description: '植物类素材制作治疗药水时，成功率更高。',
    entries: [
      e({ kind: '材料限定', channel: 'universal', params: { materialClass: '植物' } }),
      e({ kind: '成功率加成', channel: 'universal', params: { bonus: 30 } }),
    ],
  },
  {
    name: '深海测试',
    grade: 'C' as TalentGrade,
    source: 'universal',
    description: '专精于水下与水面载具，密封性与抗压性一流。',
    entries: [e({ kind: '材料限定', channel: 'universal', params: { materialClass: '水域' } })],
  },
  {
    name: '树妖之心',
    grade: 'B' as TalentGrade,
    source: 'universal',
    description: '你的卡牌会转化为热爱自然的树妖。',
    entries: [e({ kind: '形态转化', channel: 'universal', params: { series: '树妖' } })],
  },
  {
    name: '理科生',
    grade: 'D' as TalentGrade,
    source: 'universal',
    description: '介绍文字就是干巴巴的数据和公式，但效果稳定可靠。',
    entries: [],
  },
  {
    name: '赌徒直觉',
    grade: 'B' as TalentGrade,
    source: 'universal',
    description: '进行赌卡时，你能感觉到卡牌或素材的真实价值。',
    entries: [e({ kind: '鉴定', channel: 'universal', params: {} })],
  },
  {
    name: '口才',
    grade: 'E' as TalentGrade,
    source: 'universal',
    description: '你说话比较利索，与人争论时不容易吃亏。',
    entries: [],
  },
  {
    name: '早起',
    grade: 'E' as TalentGrade,
    source: 'universal',
    description: '每天早上你会比别人更早醒来，多出一些自由活动时间。',
    entries: [],
  },
  {
    name: '声优',
    grade: 'E' as TalentGrade,
    source: 'universal',
    description: '你很会模仿各种声音，有时可以用来迷惑敌人。',
    entries: [],
  },
  {
    name: '不挑食',
    grade: 'E' as TalentGrade,
    source: 'universal',
    description: '吃任何食物都能正常恢复体力，哪怕是味道古怪的炼金产物。',
    entries: [],
  },

  // ── 融合独占 ──
  {
    name: '垃圾摩托',
    grade: 'A' as TalentGrade,
    source: 'fusion',
    fusionOnly: true,
    description: '你的摩托是自己用边角料攒的，但它能和豪车媲美。',
    entries: [entry('品质突破', 'fusion', { materialClass: '废弃', productClass: '摩托' })],
  },
  {
    name: '封印斗士',
    grade: 'S' as TalentGrade,
    source: 'fusion',
    fusionOnly: true,
    description: '开封即出鞘，出鞘必见血。',
    entries: [
      entry('启封加值', 'fusion', { amount: 2 }),
      entry('行动值加成', 'fusion', { amount: 3 }),
    ],
  },
];

/** 按名字查目录模板 */
export function getTalentTemplate(name: string): TalentTemplate | undefined {
  return TALENT_CATALOG.find((t) => t.name === name);
}

/** 捏人出身可选清单：通用池 + 出身独占（融合产物除外） */
export function getCreationCatalog(): TalentTemplate[] {
  return TALENT_CATALOG.filter(
    (t) => !t.fusionOnly && (t.source === 'universal' || t.source === 'creation'),
  );
}

/** 声望兑换清单：通用池 + 兑换独占（融合产物/出身/剧情独占除外） */
export function getExchangeCatalog(): TalentTemplate[] {
  return TALENT_CATALOG.filter(
    (t) => !t.fusionOnly && (t.source === 'universal' || t.source === 'exchange'),
  );
}

/** 兑换定价（初稿）：基础 10+5×(条目数−1)，再乘品级乘数；数值总表终审对象 */
export function talentExchangePrice(template: TalentTemplate): number {
  const base = 10 + 5 * Math.max(0, template.entries.length - 1);
  const mult = GRADE_PRICE_MULTIPLIER[template.grade] ?? 1;
  return Math.round((base * mult) / 5) * 5; // 5 的倍数取整，好看
}
