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
  | '材料限定'
  | '成品限定'
  | '成功率加成'
  | '品质锁定'
  | '品质突破'
  | '启封加值'
  | '行动值加成'
  | '防御加值';

/** 骨架条目：kind + 预设参数 + 独占渠道标记 */
export interface TalentEntry {
  kind: TalentEntryKind;
  channel: TalentChannel;
  params: {
    /** 材料限定 / 品质突破·域限定的材料类别（如「废弃」） */
    materialClass?: string;
    /** 成品限定 / 品质突破·域限定的成品类别（如「简单载具」「摩托」） */
    productClass?: string;
    /** 成功率加成档位（%）：20 / 30 / 50 */
    bonus?: number;
    /** 品质锁定方向 */
    direction?: '保底' | '上限';
    /** 品质锁定档位（v1 预设：普通） */
    tier?: Rarity;
    /** 启封/行动值/防御 加值档位：1 / 2 / 3 / 4 */
    amount?: number;
    /** 互斥组（同组非空值不可共存，如「攻防」） */
    excl?: string;
  };
}

// ========== 骨架条目池 v1（单一真源；加条目 = 加数组元素） ==========

const e = (entry: TalentEntry): TalentEntry => entry;

/** 池内预设条目（AI 授予/兑换/捏人的条目只能从这里逐字选取） */
export const TALENT_ENTRY_POOL: readonly TalentEntry[] = [
  // ── 制作域 ──
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '废弃' } }),
  e({ kind: '成品限定', channel: 'universal', params: { productClass: '简单载具' } }),
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

/** 条目全等（kind + params + channel 逐字段；校验和融合都用它，不落 JSON.stringify） */
export function sameEntry(a: TalentEntry, b: TalentEntry): boolean {
  return (
    a.kind === b.kind &&
    a.channel === b.channel &&
    a.params.materialClass === b.params.materialClass &&
    a.params.productClass === b.params.productClass &&
    a.params.bonus === b.params.bonus &&
    a.params.direction === b.params.direction &&
    a.params.tier === b.params.tier &&
    a.params.amount === b.params.amount &&
    a.params.excl === b.params.excl
  );
}

/** 池内查找：kind + params 全等即命中（channel 由授予渠道决定，不参与比对） */
function findPreset(entry: TalentEntry): TalentEntry | undefined {
  return TALENT_ENTRY_POOL.find(
    (p) =>
      p.kind === entry.kind &&
      p.params.materialClass === entry.params.materialClass &&
      p.params.productClass === entry.params.productClass &&
      p.params.bonus === entry.params.bonus &&
      p.params.direction === entry.params.direction &&
      p.params.tier === entry.params.tier &&
      p.params.amount === entry.params.amount &&
      p.params.excl === entry.params.excl,
  );
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

/** 命名天赋模板：渠道归属 + 骨架条目组合（名字即模板键） */
export interface TalentTemplate {
  name: string;
  source: TalentChannel;
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
    source: 'universal',
    description: '封印物在你面前总是格外温顺。',
    entries: [entry('启封加值', 'universal', { amount: 2 })],
  },
  {
    name: '斗志昂扬',
    source: 'universal',
    description: '出手永远带着三分先声。',
    entries: [entry('行动值加成', 'universal', { amount: 3, excl: '攻防' })],
  },
  {
    name: '铜筋铁骨',
    source: 'universal',
    description: '硬挨一下，不丢人。',
    entries: [entry('防御加值', 'universal', { amount: 4, excl: '攻防' })],
  },
  {
    name: '卡牌大师',
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
    source: 'creation',
    description: '天生就是吃这碗饭的。',
    entries: [entry('成功率加成', 'creation', { bonus: 20, excl: '天才卡师' })],
  },
  {
    name: '命运宠儿',
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
    source: 'exchange',
    description: '宗师之手，点卡成金。',
    entries: [
      entry('启封加值', 'exchange', { amount: 2, excl: '卡牌宗师' }),
      entry('行动值加成', 'exchange', { amount: 2, excl: '卡牌宗师' }),
    ],
  },
  // ── 融合独占 ──
  {
    name: '垃圾摩托',
    source: 'fusion',
    fusionOnly: true,
    description: '你的摩托是自己用边角料攒的，但它能和豪车媲美。',
    entries: [entry('品质突破', 'fusion', { materialClass: '废弃', productClass: '摩托' })],
  },
  {
    name: '封印斗士',
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

/** 兑换定价（初稿）：10 + 5×(条目数−1)，即单条目 10、双条目 15；数值总表终审对象 */
export function talentExchangePrice(template: TalentTemplate): number {
  return 10 + 5 * Math.max(0, template.entries.length - 1);
}
