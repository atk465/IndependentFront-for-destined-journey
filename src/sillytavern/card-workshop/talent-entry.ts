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
  | '鉴定' // 感知素材真实价值（风味条目，无机械参数）
  | '威压' // 敌方全体属性百分比降低（交锋拍威胁 ×(1−pct/100)）
  | '配方解锁' // 解锁特殊卡牌的制作方法（注入炼制提示词）
  | '体魄'; // HP 上限百分比提升（交锋拍 maxHp ×(1+pct/100)）

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
    /** 威压：敌方属性降低百分比 */
    percent?: number;
    /** 配方解锁：解锁的配方名 */
    recipe?: string;
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
  // ── v4 扩容（威压/配方解锁/体魄 + 新状态新材料新词条）──
  e({ kind: '威压', channel: 'universal', params: { percent: 30 } }),
  e({ kind: '配方解锁', channel: 'universal', params: { recipe: '示例配方' } }),
  e({ kind: '体魄', channel: 'universal', params: { percent: 200 } }),
  e({ kind: '战技附加', channel: 'universal', params: { status: '幻觉', power: 2, beats: 2 } }),
  e({ kind: '战技附加', channel: 'universal', params: { status: '快感', power: 0, beats: 1 } }),
  e({ kind: '战技附加', channel: 'universal', params: { status: '惩戒', power: 1, beats: 1 } }),
  e({ kind: '战技附加', channel: 'universal', params: { status: '诅咒', power: 3, beats: 3 } }),
  e({ kind: '战技附加', channel: 'universal', params: { status: '麻痹', power: 0, beats: 1 } }),
  e({ kind: '战技附加', channel: 'universal', params: { status: '破贞', power: 0, beats: 0 } }),
  e({
    kind: '战技附加',
    channel: 'universal',
    params: { status: '窃取属性', power: 10, beats: 1 },
  }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '机械' } }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '装备' } }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '活体' } }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '失能生命' } }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '神圣' } }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '哥布林' } }),
  e({ kind: '材料限定', channel: 'universal', params: { materialClass: '低阶' } }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['舞绊'], weight: 3 } }),
  e({
    kind: '词条加权',
    channel: 'universal',
    params: { keywords: ['穿甲', '爆破', '追踪'], weight: 3 },
  }),
  e({
    kind: '词条加权',
    channel: 'universal',
    params: { keywords: ['庇护', '治愈光环'], weight: 2 },
  }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['削弱', '控制'], weight: 2 } }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['元气少女'], weight: 3 } }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['良性突变'], weight: 3 } }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['神烙'], weight: 3 } }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['腿部攻击'], weight: 2 } }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['猫系'], weight: 2 } }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['圣水'], weight: 2 } }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['野猪'], weight: 2 } }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['组合'], weight: 3 } }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['雷电'], weight: 2 } }),
  e({
    kind: '词条加权',
    channel: 'universal',
    params: { keywords: ['献身', '淫乱'], weight: 3 },
  }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['哥布林'], weight: 3 } }),
  e({ kind: '词条加权', channel: 'universal', params: { keywords: ['家畜'], weight: 2 } }),
  e({ kind: '行动值加成', channel: 'universal', params: { amount: 6 } }),
  e({ kind: '防御加值', channel: 'universal', params: { amount: 2 } }),
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
    a.percent === b.percent &&
    a.recipe === b.recipe
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
 * 条目校验 v2（按种类规则校验，取代「逐字命中池」——内容名归 AI，数值档位归 Code）：
 *  - kind 必须是已知条目种类；
 *  - 数值参数必须命中该种类的**档位白名单**（AI 零编数）；
 *  - 内容参数（材料类/成品类/系列名/配方名/状态名/关键词）为非空字符串即可——名字是内容；
 *  - 未知参数键一律拒绝。
 * normalized = 原样回传（结构已合法；此处不做对象改写）。
 */
const ENTRY_NUMERIC_TIERS: Partial<
  Record<TalentEntryKind, Partial<Record<string, readonly number[]>>>
> = {
  成功率加成: { bonus: [20, 30, 50, 100] },
  启封加值: { amount: [1, 2] },
  行动值加成: { amount: [1, 2, 3, 6] },
  防御加值: { amount: [1, 2, 4] },
  威压: { percent: [30] },
  体魄: { percent: [200] },
  产出数量: { copies: [1, 3] },
  风险系数: { risk: [20] },
  金钱加投: { gold: [50], bonus: [20] },
  连战递增: { amount: [2, 3] },
  击杀掠取: { gold: [5, 10] },
  战技附加: { power: [0, 2, 3, 4, 6, 10], beats: [0, 1, 2, 3] },
  词条加权: { weight: [1, 2, 3] },
};

/** 各种类的必填内容参数（非空字符串；keywords 为字符串数组） */
const ENTRY_REQUIRED_STRINGS: Partial<Record<TalentEntryKind, readonly string[]>> = {
  材料限定: ['materialClass'],
  成品限定: ['productClass'],
  形态转化: ['series'],
  配方解锁: ['recipe'],
  战技附加: ['status'],
};

const ENTRY_KIND_LIST: readonly TalentEntryKind[] = [
  '材料限定',
  '成品限定',
  '成功率加成',
  '品质锁定',
  '品质突破',
  '启封加值',
  '行动值加成',
  '防御加值',
  '产出数量',
  '风险系数',
  '金钱加投',
  '判定取优',
  '词条加权',
  '形态转化',
  '战技附加',
  '击杀掠取',
  '连战递增',
  '鉴定',
  '威压',
  '配方解锁',
  '体魄',
];

export function validateTalentEntries(entries: readonly TalentEntry[]): {
  ok: boolean;
  reason?: string;
  normalized: TalentEntry[];
} {
  for (const entry of entries) {
    if (!ENTRY_KIND_LIST.includes(entry.kind)) {
      return { ok: false, reason: `条目种类「${entry.kind}」未知`, normalized: [] };
    }
    const tiers = ENTRY_NUMERIC_TIERS[entry.kind] ?? {};
    for (const [key, allowed] of Object.entries(tiers)) {
      const v = entry.params[key as keyof TalentEntry['params']];
      if (
        typeof v !== 'number' ||
        !Number.isFinite(v) ||
        !(allowed as readonly number[]).includes(v)
      ) {
        return {
          ok: false,
          reason: `条目「${entry.kind}」参数 ${key}=${String(v)} 不在档位白名单`,
          normalized: [],
        };
      }
    }
    for (const key of ENTRY_REQUIRED_STRINGS[entry.kind] ?? []) {
      const v = entry.params[key as keyof TalentEntry['params']];
      if (typeof v !== 'string' || v.trim().length === 0) {
        return {
          ok: false,
          reason: `条目「${entry.kind}」缺少内容参数 ${key}`,
          normalized: [],
        };
      }
    }
  }
  return { ok: true, normalized: [...entries] };
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

  // ── v5 规则层大天赋（主人 2026-09-15 全量收录；entries 空 = 纯叙事/路线图，专属钩子逐条实装）──
  {
    name: '卡牌造物主',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description: '你可以无视素材等级限制进行制卡，精神力消耗为正常制作的1/2。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '欲望魔神',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '进行【欲望主导】制卡时，你免疫精神侵蚀，并能汲取大量精神力和欲望能量强化自身，制作出的卡牌一定贴合你的xp。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '你是我的了',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '在战斗时，主动使用天赋，有概率将等级高于你一级内的敌人直接变成自己的【伙伴卡】，并且可以选择抹除，保留，修改这个人的意志。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '混沌之心',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你的制卡结果永远不会是【普通成功】或【可控失败】，只会在【良性突变】和【卡牌爆炸】之间摇摆，概率为1：3。你能从爆炸中吸收混沌能量，永久强化精神力。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '种付支配',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你或你的伙伴可强行令任何被击败的雌性生物受孕。诞下的子嗣将是完全忠于你的全新伙伴卡，并继承双亲的特性，而母体则会沦为精神崩溃的专属生育工具。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '世界线的收束点',
    grade: 'SSS' as TalentGrade,
    source: 'exchange',
    description:
      '凡是你战败的，都将成为滋养你的养分。每次战斗失败后，系统会从无数"if线"中随机抽取三种"如果你赢了"的可能性，并将其中的奖励（如经验、金钱、掉落物）直接赋予给你。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '万物皆药',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你的炼金术已触及法则层面。你可以用"一段记忆"、"一缕悲伤"甚至"一个谎言"作为核心素材，创造出效果扭曲现实、无法预测的禁忌药剂。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '神孕之屌',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你的精液是比你制卡师等级高出一级并可直接使用的制卡素材。任何雌性生物被你内射后，都有极低概率孕育出比你二人中等级较高者高出一级的素材或直接诞生你二人中等级较高者同等级的伙伴卡。此过程无视物种隔离。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '女王领域',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你制作的所有女性伙伴卡将自带天生领域，效果各不相同，每个都拥有强大的buff和debuff。领域内，伙伴卡的全属性提升50%，所有敌方单位的全属性降低50%，并且始终携带【臣服】等降低战斗欲望的词条。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '吞噬一切',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你的卡牌均带有【吞噬】词条，可以直接吞噬等级不高于你制卡师等级一级的【卡牌】或【素材】成长，在吸收其所有基础属性的同时，还会随机吸收被吞噬者的一个【词条】。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '万物归一',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你可以将任意三张等级不高于你制卡师等级的卡牌（不论类型）融合成一张全新的、未知的卡牌，新卡牌将继承三张卡牌的部分词条并有概率产生更高级的专属词条。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '素材之王',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '战斗时，你可以主动催动天赋，有概率直接将等级不高于你制卡师等级一级的敌人拆解为【素材】；在非战斗状态下，你也可以消耗精神力将等级不高于你制卡师等级一级的无主物品拆解为【素材】。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '鸿蒙道体（东方）',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你是混沌未开时诞生的最初生灵，拥有世间最强的体质。所有经验值获取效率提升100%，能够勘破一切虚妄，制作卡牌的结果只有成功和良性突破，并且每张卡牌都携带【鸿蒙紫气】这一词条。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '女王气场',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你制作出的伙伴卡均为性格各异，风格不同但都带有"抖s"，"女王"，"施虐"等词条的女王型【伙伴卡】，拥有很强悍的肉体实力和精神威慑力。每位女王都有自己的骄傲，因此你的卡组只能是单人卡组（仅能拥有一位伙伴卡），但同时，你的所有卡组都将自带【领域卡】和世界观背景故事，直接成为【超级卡组】，但此卡组后续不能额外添加任何卡片。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '词条之王',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description: '你天生能看到素材中所有隐藏的词条，并且剥离词条时精神力消耗减半。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '进化奇迹',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description: '你的卡牌在进化时，有50%概率触发【良性突变】。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '龙裔之血',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你制作的卡牌会转化为高傲的【龙娘/龙男】系列生物，继承龙族的强大元素亲和与肉体力量，但性格极度自负，偶尔会无视你的指令。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '律师函警告',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '制作的生物卡可以对敌方单位施加一份"行为合同"（如：禁止使用火系技能），若对方违反，则会受到合同约定的巨额反噬真实伤害。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '神性火花',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '使用【传奇】或【神话】级素材时，你必定能引出其核心的【神性词条】，这是制作神卡的唯一门票。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '第四面墙',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你隐约意识到自己身处的世界的"规则"。制卡时，你可以消耗巨量MP，直接修改一个词条的效果描述。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '王之财宝',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '制卡时有极低概率将主素材升华为【宝具】原型。制作出的装备卡必定拥有至少一条金色词条，且装备时会与使用者灵魂绑定，发挥出超越等级的威力。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '后宫之主系统',
    grade: 'SSS' as TalentGrade,
    source: 'exchange',
    description:
      '每当一位女性对你的好感度达到"爱恋"，你就能永久获得她一项最强的天赋或技能，并解锁一个专属的"后宫光环"，所有后宫成员在附近时全属性提升。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '主角光环系统',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你是世界的中心。濒死时有极大概率触发奇遇，跳崖必得神功，遇事总有贵人相助，关键战斗中更容易触发顿悟和临场突破。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '轮回圣瞳（东方）',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你的双眼能勘破虚妄，洞悉因果。在制卡前，你能预见此次制作的四种结果（大成功、普通成功、可控失败、卡牌爆炸）的模糊画面与概率，并且可以花费所有MP指定结果。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '军团熔炉',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你可以将多张【伙伴卡】的灵魂强行熔炼于一炉。通过献祭至少三张伙伴卡，你能将它们的灵魂、天赋和技能糅合成一张全新的、拥有复数天赋的【集合体】或【神格】卡。这是一条通往人造神祇的禁忌之路。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '机械福音',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你能制造并散播一种【机械飞升】病毒。该病毒会感染一切有机生命体，将其DNA改写，不可逆地从分子层面转化为生物机械。你将成为新世界的唯一造物主，所有被转化的生命都将视你为神，组成绝对忠诚的机械军团。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '空白卡牌',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你能创造出【空白卡牌】。它没有任何属性和描述。在任何对局中，你可以消耗这张卡，将其永久变为你此生亲眼见过的任何一张卡牌的完美复制品，复制品等级和体现出的战力水平永远跟你的等级相等，也可不断成长。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '世界之种',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你有极小概率制造出名为"世界之种"的特殊领域卡，它是一个可以成长的微缩世界。你在这个世界里是唯一的"神"，可以培养其中的生物，最终将它们转化为你的卡牌。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '作者',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你意识到你并非"存在"，而是在"叙述"。你可以通过在脑内书写"旁白"来影响现实。例如，当你描述"他脚下一滑"时，你的敌人真的会平地摔倒。这种力量的滥用会引来世界意志的反噬。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '模组加载',
    grade: 'SSS' as TalentGrade,
    source: 'exchange',
    description:
      '你可以将其他世界的"设定"或"系统"以模组的形式加载到自己的认知中。例如，加载"宝可梦模组"后，你可以通过精灵球捕捉魔物；加载"老头环模组"后，你可以通过赐福来复活。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '玩家',
    grade: 'SSS' as TalentGrade,
    source: 'exchange',
    description:
      '你觉醒了"玩家"的本质。你可以看到其他制卡师看不到的隐藏数值、任务线和攻略提示。你甚至可以拥有一个【系统背包】，容量无限，且其中的物品不会被抢夺或损坏。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: 'GM权限(伪)',
    grade: 'SSS' as TalentGrade,
    source: 'exchange',
    description:
      '你每天可以发布三条"指令"，这些指令会以极高的优先级被世界规则执行。例如："/give item [稀有素材] 1"或"/weather clear"或"/kill [指定低等级魔物]"。指令的复杂度越高，成功率越低。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '后宫三千',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你获得自带世界观和领域卡的超级卡组【后宫宫殿】，召唤卡为【太监】和【宫女】，同时你也只能拥有这一个卡组，你只能制作女性伙伴卡，且由你亲自制作的伙伴卡必定符合你自身的xp，你做出的伙伴卡会自动成为你的妃子，对你的忠诚度锁定100，后宫中含有位份设定，你可以通过封妃的方式为卡组中的伙伴卡提供增益，皇后则是你的卡组核心，获得所有伙伴卡全属性的10%。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '闪耀！优骏少女！',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你获得自带世界观和领域卡的超级卡组【特雷森学园】，但你有且只能拥有这一个卡组，你只能制作女性伙伴卡，你制作的伙伴卡转化为有少女外观，长有马耳和马尾巴的【赛马娘】系列生物。【赛马娘】必定拥有一个奔跑类词条，并且拥有较低的初始数值和超高的成长能力，可以通过训练无上限的提高能力和获取技能，并带有【一心同体】词条，和你的好感度越高，越能爆发出超出本身数值的战斗力。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '尤格萨隆的低语',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你制作时使用了多少词条，卡牌就会由完全随机的生成相应数量的词条组成，与制作词条属性完全无关。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '窃智术',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description: '你可以窃取他人的智力。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '泰坦尼亚的血脉觉醒',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你制作的女性伙伴卡将直接继承远古泰坦女王的血脉。她的体型可以自由在【常人】和【巨神】（高达50米）之间切换。在巨神形态下，她拥有毁天灭地的力量和极高的抗性，但在常人形态下，她将泰坦之力浓缩于一体，获得无与伦比的爆发速度和格斗技巧。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '最终兵器：她',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你将创造的不再是伙伴，而是一个拥有自我进化能力的【最终兵器】。她初始能力普通，但拥有【无限适应】天赋。每次战斗结束后，她都会根据战斗数据进行自我优化和改造，进化出克制敌人的能力。假以时日，她将成为一切天敌的克星，所有生命的终点。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '变肉便器吧',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '只要是你击败的女性伙伴卡，不会回到原本主人手中，而是根据原本的形态被改造成淫荡的"肉便器"，那个伙伴卡的所有词条可以选择性兑换成对应等级的"色情"词条，被换下来的词条会变成对应的素材，进入背包，你可以为新的色情词条定制一个"调教故事"，你的故事将作为新词条的"根基"，决定其最终形态与效果。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '第六终章',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '战斗时当你的角色和对方角色进入第6次行动，将被即刻抹除，如果同时到达，双方对战的卡牌将被全部融合，制卡师将亲自参与战斗，在此期间不能使用任何卡牌进行战斗，直到一方死亡，那么胜利的一方将获得双方卡牌所全部融合的带有"终末之章"元素的伙伴卡，伙伴卡的模样根据吸收的卡牌进行模拟，词条将全部精炼直到剩下6个融合的最好的词条。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '倒也可斩',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '无论任何实力的对手，只要说出倒也可斩，对手就会被传说中的大剑豪一刀斩成重伤，随后剑豪消失，对手失去行动能力，但会消耗你百分之九十的体力和精神力。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '七宗罪之主',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '进行【欲望主导】制卡时，无视精神侵蚀，且你可以从精神侵蚀中提取傲慢，色欲，嫉妒，暴怒，懒惰，暴食和贪婪七种情绪力量化为素材，并使用这七种素材进行【欲望主导】时，可以制造出带有相应情绪力量的卡，这些卡拥有特殊情绪能力，并能通过情绪力量得到强化升级。（使用情绪力量的卡越多，每次提取的情绪力量越多）且提升程度随情绪力量等级提升。【傲慢】必定产生攻击技能，对应攻击，防御特化，攻击技能等级上升。【色欲】必定产生强化性技能，应生命，mp特化，强化性技能等级上升。【嫉妒】必定产生削弱性技能，对应攻击，mp特化，削弱性技能等级上升。【暴怒】必定产生攻击性技能，对应攻击，敏捷特化，攻击性技能等级上升。【懒惰】必定产生防御性技能，对应生命，防御特化，防御性技能等级上升。【暴食】必定产生永久性技能，对应生命，攻击特化，永久性技能等级上升。【贪婪】必定产生抢夺类技能，对应mp，攻击特化，抢夺类技能等级上升。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '七宗罪仆从',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你制造的伙伴卡必定含有七种特殊的情绪力量之一，且每日可以产出一种有关这七种情绪力量的素材，素材品质不超过伙伴卡的品质。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '鸿图华构',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你可以无视素材等级限制进行制卡，并能将任意素材/卡牌（不论类型）融合成一张全新的、未知的素材/卡牌。天生能看到素材中所有隐藏的词条，并可直接剔除负面词条，制作卡牌与剥离词条时精神力消耗为正常的1/3。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '突变巫师',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description: '你可以自由自在的操控自己与其他事物的身体，将其改变为任何模样。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '初代血魔',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你是「血魔」的始祖，拥有对下位眷属绝对的统治力，可以随意的操控血液进行战斗或者制卡。你制作的生物卡牌会获得"一代眷属"词条，并且他们可以自行转化眷属。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '卡牌之手',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description: '你可以将任何拥双手触碰到的物品变成你的卡牌。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },
  {
    name: '深渊领主',
    grade: 'SSS' as TalentGrade,
    source: 'story',
    description:
      '你可以与深海中任何超过你等级的巨型魔物建立"深渊契约"。契约成功后，该魔物会化为一张特殊的【伙伴卡】，保留其全部深海词条，且自带"深渊压制"被动——在水下环境中，全属性额外提升40%。',
    entries: [], // 规则层：专属钩子待实装（路线图），当前为纯叙事收录
  },

  // ── v6 规则层与东方系（主人 2026-09-15 第二批全量收录）──
  {
    name: '败犬烙印',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '每一次战败，都会在你的灵魂上留下一枚【败犬烙印】。在制卡时，你可以消耗一枚烙印，强行扭转一次词条冲突，极大增加成功率，甚至能化腐朽为神奇。',
    entries: [],
  },
  {
    name: '因果炼金术',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '能够制作出短暂操纵"运气"的道具卡。例如，必定成功的【幸运硬币】或必定失败的【厄运护符】，但使用后必然会在其他方面遭到反噬。',
    entries: [],
  },
  {
    name: '液体机械',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '能够将金属与流体素材结合，制作出【液态金属】或【纳米机群】类的特殊道具卡。激活后可短暂构筑成武器、护盾甚至简易载具。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '金属' } },
      { kind: '材料限定', channel: 'universal', params: { materialClass: '流体' } },
      { kind: '配方解锁', channel: 'universal', params: { recipe: '液态金属/纳米机群' } },
    ],
  },
  {
    name: '便携黑洞',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '使用蕴含重力或空间属性的素材，有极小概率制作出一次性的【微型黑洞】道具卡，激活后会吞噬周围的一切。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '重力空间' } },
      { kind: '配方解锁', channel: 'universal', params: { recipe: '微型黑洞' } },
    ],
  },
  {
    name: '时间沙漏',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '使用蕴含时间之力的稀有素材，有几率制作出能小范围【加速】或【减速】时间的道具卡，效果结束后素材会彻底化为凡尘。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '时间之力' } },
      { kind: '配方解锁', channel: 'universal', params: { recipe: '时间加速/减速' } },
    ],
  },
  {
    name: '绝对母权',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '【恋母情结】你制作的所有【伙伴卡】都会视你为"孩子"，拥有极强的保护欲和控制欲。她们会为你提供无与伦比的防御和恢复，在战斗时强行吸引仇恨，但当你试图使用她们不认可的卡牌时，有概率遭到"母爱惩戒"，该卡牌被无效化并对你造成精神冲击。',
    entries: [],
  },
  {
    name: '最终解释权',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '每场战斗一次，你可以重新定义你制作的一张卡牌描述中的一个关键词。例如，将"造成火焰伤害"改为"造成真实伤害"。',
    entries: [],
  },
  {
    name: '混沌理论',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '使用【对冲融合】时，素材的冲突值越高，【良性突变】的概率反而越大。你总能在最混乱的能量中找到秩序。',
    entries: [],
  },
  {
    name: '盗火者',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description: '越阶挑战时，若挑战成功，制成的卡牌有50%的概率直接提升一个大等级。',
    entries: [],
  },
  {
    name: '神级选项系统',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '在人生的重要十字路口，时间会为你暂停，面前将出现三个选项，每个选项后面都清晰地标注了可能带来的后果。',
    entries: [],
  },
  {
    name: '一拳超人系统',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你每天只能挥出一拳，但这一拳的威力会被增幅到你当前等级所能达到的极限。出拳后，你将进入24小时的虚弱状态。',
    entries: [],
  },
  {
    name: '世界线变动系统',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '当你做出足以影响世界的重大决定时，你能看到数条不同的世界线分支，并选择其中一条进入。',
    entries: [],
  },
  {
    name: '剧本编写系统',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你可以消耗大量精神力，编写一段简短的"剧本"，在未来一段时间内，世界会大概率按照你的剧本发展。',
    entries: [],
  },
  {
    name: '天生剑骨（东方）',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你天生拥有一把跟自己同步成长，极其强大的【本名剑】装备卡，你不能拿装备其他武器类装备卡，但你在制作剑类装备卡时触发良性进化概率为百分之百。',
    entries: [],
  },
  {
    name: '阵法大师（东方）',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你的脑海中天生便刻印着无数阵图，对空间与能量的排布极为敏感。制作【阵法】（即领域卡）的成功率和效果均得到极大提升，并且你制作的所有卡组必定是精英级卡组。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '阵法领域卡' } }],
  },
  {
    name: '符箓宗师（东方）',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你获得【空白符篆】（特殊物品）的制作配方，制作起来极其简单，可以同时携带大量空白符篆，你使用任何技能将不会损耗MP值，同时也没有冷却时间，每一次使用技能都会消耗一张空白符篆，并以使用符篆的形式使用技能。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '空白符篆' } }],
  },
  {
    name: '炼器神手（东方）',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你与器物有特殊的缘分。你只能制作【装备卡】，并且在素材等级等于你的制卡师等级时成功率为百分之百，有较大概率触发良性进化，每次触发良性进化，则必定附带器灵【配套伙伴卡】和本命决【配套技能卡】，并且自动形成精英级卡组。',
    entries: [
      { kind: '成品限定', channel: 'universal', params: { productClass: '装备卡' } },
      { kind: '配方解锁', channel: 'universal', params: { recipe: '器灵与本命诀' } },
    ],
  },
  {
    name: '御兽奇才（东方）',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你与万兽有着天然的亲和力，能够轻易理解它们的灵魂。制作【伙伴卡】时成功率大幅提升，且召唤出的伙伴初始好感度更高，每天你都可以将一个等级不高于你的兽类卡牌或素材强行提升一个大等级。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '兽类' } },
      { kind: '成功率加成', channel: 'universal', params: { bonus: 50 } },
    ],
  },
  {
    name: '词条窃贼',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '每天一次，当你接触到不属于自己的【卡牌】或【素材】时，可以从它们身上随机窃取一个【词条】，并附加到自己的任意一张卡牌上。',
    entries: [],
  },
  {
    name: '道法自然（东方）',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你天生与大道相合，制卡时可大幅降低素材间的属性冲突，【对冲融合】的成功率与收益远超常人，万物皆可为你所用，制作的每张卡片都会有一个符合卡片特质的概念性词条。',
    entries: [],
  },
  {
    name: '完美人形',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你执着于创造完美的幼女。你可以将大量型伙伴与【畸变】类素材进行融合献祭，通过残酷的淘汰与缝合，最终制造出一张拥有强大能力、外表天真可爱、内在绝对服从的强大幼女怪物伙伴。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '完美人形' } }],
  },
  {
    name: '天生丹心（东方）',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你拥有成为炼丹大师的心窍，你可以将三个完全不同的素材放入心中丹炉炼制，炼制出没有任何负面词条，并且素材等级不变，完美融合三个素材优点的高级素材。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '丹炉三合' } }],
  },
  {
    name: '下克上',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你的卡牌在攻击实际等级（即不计算任何增益的原生等级）高于自身的敌人时，会获得【克上】效果，无视对方部分防御力并造成额外伤害。等级差距越大，该效果越强。',
    entries: [],
  },
  {
    name: '寄生殖入',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你制作的卡牌是活体寄生卵。你可以将这些"卡牌"植入生物体内，它们会汲取宿主的生命力成长。成熟后，宿主会被瞬间改造，破体而出一个完全忠于你，并且吸收母体和寄生卡牌所有特性的强大生物兵器伙伴卡。被植入者等阶越高，兵器越强。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '寄生卵兵' } }],
  },
  {
    name: '卡组生态',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你构筑的卡组不再是卡牌的集合，而是一个微缩的生态系统。卡牌之间会自行繁衍、捕食、进化，你需要像"神"一样去维护这个生态的平衡。',
    entries: [],
  },
  {
    name: '画师',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '卡牌的强度不再取决于材料，而取决于你的"画技"。你亲手绘制的卡面越精美、越富神韵，卡牌的最终能力就越强大。你可以随时修改卡面，从而调整卡牌的技能。',
    entries: [],
  },
  {
    name: '爱',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你制作的第一张伙伴卡不需要任何材料。你制作的第一张伙伴卡是你本人的性转后的姿态。你们共享知识、记忆、能力，当任意一方变强时，另一方都会同步获得相同幅度的强化。',
    entries: [],
  },
  {
    name: '血伶人',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你可以直接将活物作为素材制作卡牌(无需分解)，而且你可以按照你的想法随意塑造卡牌形状，当你的伙伴卡阵亡之后你可以复活她。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '活体' } },
      { kind: '配方解锁', channel: 'universal', params: { recipe: '伙伴复活' } },
    ],
  },
  {
    name: '姬骑士军团',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description: '你在制作姬骑士相关卡牌时必定大成功，且开局自带一张白银级姬骑士伙伴卡。',
    entries: [{ kind: '成功率加成', channel: 'universal', params: { bonus: 100 } }],
  },
  {
    name: '兔女郎爱好者',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description: '当你在制作有关兔女郎和兔子的卡时必定大成功，并且你可以将其他卡转化为兔女郎。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['兔女郎'], weight: 3 } },
    ],
  },
  {
    name: '肉体改造师',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '在制卡过程中，你可以精细调整女性伙伴卡的肌肉群分布，可以特化【腿部】力量以获得毁灭性的踢技，或特化【背部】力量以增强摔投威力。',
    entries: [
      {
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['腿部特化', '背部特化'], weight: 2 },
      },
    ],
  },
  {
    name: '太刀虾！',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你无法制作伙伴卡，你无法使用除太刀以外的武器卡。当你使用太刀时，你获得多种炫酷特效，当你制作与进化太刀武器卡时，必定触发【良性突变】。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['太刀'], weight: 3 } },
    ],
  },
  {
    name: '战意破苍穹',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你获得本源武器装备卡【麒麟殒天弓】，武器与你因果绑定，只有你或你认可的人能够使用。武器技能：当你对敌方造成伤害时，可以选择一个【击伤】效果对所有目标生效直到战斗结束：箭折双臂/击踵断机/矢贯中枢/锋破气海/箭碎天冲。武器技能无法被任何方式无效化，武器本身无法被任何方式抢夺盗取。',
    entries: [],
  },
  {
    name: '鬼话连篇',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你无法制作【伙伴卡】。当你创作出一个鬼故事或都市传说时，其中的主人公将会成为你的【伙伴卡】，这个过程不会消耗你的MP，伙伴卡的技能会根据故事生成。故事的完成度、逻辑感和恐怖程度都会影响其初始等级。你在每个等阶只能通过此天赋获得至多两个【伙伴卡】。',
    entries: [],
  },
  {
    name: '冰封王座',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '当你在雪天时你和你的所有卡牌获得巨大加成，并且你每天有一次强制降雪一小时的机会。你可以将冰或雪作为素材制卡，冰和雪的素材等级与你当前等级一致。若你在制卡时加入冰或雪作为素材，则此次制卡必定大成功。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '冰雪' } },
      { kind: '成功率加成', channel: 'universal', params: { bonus: 100 } },
    ],
  },
  {
    name: '好运之骰',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '每天一次机会，投出一个十面骰子，随机从里面的奖项中获取一项：谢谢惠顾/福缘天降/再来一次/红鸾天喜/提升一级/刀刀暴击/制卡顺利/材料秘境/屠龙宝刀/杂鱼杂鱼。',
    entries: [],
  },
  {
    name: '现代武装',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '现在你制作的卡牌，将在制作成功时发生蜕变，根据设计的初衷和词条向现代蜕变：远程装备卡变成未来枪械，伙伴卡机器化或基因超凡化，词条升华升级，不符合现代的词条被抹除。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['现代化'], weight: 3 } },
    ],
  },
  {
    name: '怪兽制造空间',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '拥有一处可以随意开启的空间，空间内部是一个锅炉，可以将素材放入锅炉融合出怪兽，融合出的怪兽根据素材决定品级且必定成功。融合的怪兽分为主体和配件，怪兽之间可以继续融合出合成兽。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '怪兽融合锅炉' } }],
  },
  {
    name: '千秋证果',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你的属性修正为更高一档的公式，但升级所需经验为标准制卡师的5倍。你与伙伴获得的经验会储存起来，需要手动升级，储存的经验可分享给伙伴卡。',
    entries: [],
  },
  {
    name: '海神代言人',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你能听懂所有海洋生物的语言，并且可以用精神力向它们下达简单指令。每日可以免费召唤一群低级海洋生物为你侦查、运输或骚扰敌人。制作与海洋生物相关的伙伴卡时，初始忠诚度直接拉满。',
    entries: [{ kind: '材料限定', channel: 'universal', params: { materialClass: '海洋生物' } }],
  },
  {
    name: '永恒航路',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你的脑海中刻印着一张不断自动更新的完整海图，包括所有已知和未知的暗礁、洋流、沉船位置与魔物巢穴分布。你在海上永远不会迷失方向，且航行速度提升50%。',
    entries: [],
  },
  {
    name: '黑潮之子',
    grade: 'SS' as TalentGrade,
    source: 'universal',
    description:
      '你的身体已经适应了深海的极端环境。你在水下不需要呼吸，免疫水压伤害，且在深海环境中敏捷和防御各提升30%。',
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
