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

  // ── v7 第三批 S 级全量（主人 2026-09-15；多为规则层/情境层，entries 空 = 纯叙事或见描述）──
  {
    name: '绞刑架幸存者',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '曾被吊死却奇迹生还。你的颈部极其坚韧，免疫一切窒息、绞杀类伤害。当你的HP归零时，有一次机会以1点HP强行锁血复活，并瞬间获得满额MP。',
    entries: [],
  },
  {
    name: '西部决斗礼仪',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '可以强制任何目标与你进行1v1对决。在此期间，双方均无法使用【伙伴卡】，且免疫一切外部伤害与治疗。',
    entries: [],
  },
  {
    name: '雌雄双煞',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '当你队伍中只有一名异性伙伴卡，且你们都在被通缉时，你们的全属性提升50%，且脱战后可以通过深入的体液交换瞬间恢复满血满蓝。',
    entries: [],
  },
  {
    name: '霜巨人体魄',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你的体型和肌肉密度异于常人。HP上限增加200%，免疫击退效果。在各种贴身肉搏或深夜互动中，你拥有绝对的体型压制力和破坏力。',
    entries: [{ kind: '体魄', channel: 'universal', params: { percent: 200 } }],
  },
  {
    name: '瓦尔哈拉的门票',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '当你的女性伙伴卡战死时，她的灵魂不会消散，而是化作半透明的女武神幽灵永远绑定在你的身体，成为身后灵。',
    entries: [],
  },
  {
    name: '吞噬之口',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '伙伴卡能将嘴或下体变得巨大，直接【活吞】体型较小的敌人。被吞噬的敌人会在其体内被缓慢消化，成为她的养分。',
    entries: [],
  },
  {
    name: '支配者倒影',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你崇拜着将你踩在脚下的强者。被敌人击败后，你可以复制对方的一个技能，并以此为蓝本，在制卡时创造出一张全新的技能卡。',
    entries: [],
  },
  {
    name: '天气掌控者',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '能够制作出影响战场的天气类【领域卡】，如【祈雨】、【烈日】、【沙暴】、【雷云】，为特定属性的卡牌提供强大的主场优势。',
    entries: [
      { kind: '配方解锁', channel: 'universal', params: { recipe: '天气领域卡' } },
      {
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['祈雨', '烈日', '沙暴', '雷云'], weight: 2 },
      },
    ],
  },
  {
    name: '武器大师',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '对所有类型的武器都有深刻理解。制作任何武器卡时，都有较高概率提升一个稀有度等级，并有几率领悟出该武器的专属【武器技能】词条。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['武器技能'], weight: 2 } },
    ],
  },
  {
    name: '防具大师',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '对所有类型的防具有深刻理解。制作任何防具卡时，都能完美平衡重量与防御，并有几率附加【套装】词条，多件激活额外效果。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['套装'], weight: 2 } },
    ],
  },
  {
    name: '模块化天才',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你制作的载具卡天生拥有额外的改装槽位，且其部件支持战斗中热插拔，能够根据战况瞬间切换形态与功能，是战场上的变形金刚。',
    entries: [],
  },
  {
    name: '瘟疫之源',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你天生就是行走的灾厄。使用任何有毒素材制作道具卡，其毒性都会被数倍放大，并有极高几率附加【传染】、【变异】、【腐化】等恶性词条。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '毒' } },
      {
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['传染', '变异', '腐化'], weight: 3 },
      },
    ],
  },
  {
    name: '双生药剂',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '制作任何药水类道具卡时，有一定几率额外生成一张效果完全相反的双生卡。例如，制作【巨力药水】时，可能附赠一张【虚弱药水】。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '双生药剂' } }],
  },
  {
    name: '奇迹卷轴',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '制作卷轴类道具卡时，有极小概率发生奇迹突变，使卷轴效果升华为更高阶的魔法，甚至可能随机召唤出强大的存在。',
    entries: [],
  },
  {
    name: '共生体',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你能制作出特殊的【共生体】道具卡，使用后会与使用者（或其载具）结合，提供强大的属性和技能，但同时也会持续汲取生命力或精神力。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '共生体' } }],
  },
  {
    name: '病娇烙印',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '制作的生物卡牌对主人有极强的占有欲，当主人受创时会陷入狂暴，攻击力剧增。但它们会优先攻击任何靠近主人的单位，包括友军。',
    entries: [
      {
        kind: '战技附加',
        channel: 'universal',
        params: { status: '病娇狂暴', power: 3, beats: 2 },
      },
    ],
  },
  {
    name: '懒惰天才',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '制作的生物卡牌拥有极高的面板属性，但极度懒惰，有50%的几率会摸鱼而跳过行动。但只要它们行动，必定产生暴击或效果翻倍。',
    entries: [],
  },
  {
    name: '克苏鲁的呼唤',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '使用蕴含疯狂或扭曲概念的素材时，你更容易成功，并有概率为卡牌附加【古神低语】词条，对敌人造成理智削减效果。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '疯狂扭曲' } },
      { kind: '词条加权', channel: 'universal', params: { keywords: ['古神低语'], weight: 2 } },
    ],
  },
  {
    name: '降维打击',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你制作的领域卡，有极小概率会演化为【世界卡】。使用时，会将敌人拉入一个由你主宰的小世界中。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '世界卡' } }],
  },
  {
    name: '赌徒谬论',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '使用【对冲融合】流派时，每次大失败都会为你叠加一层厄运，每层厄运都会显著提高下一次对冲融合的大成功概率。此天赋是赌徒的福音，也是非酋的诅咒。',
    entries: [],
  },
  {
    name: '巨人的宠爱',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '制作出的女性伙伴卡体型会变得异常巨大。她们视制卡师为掌中玩物，战斗中会将制卡师放在肩膀上提供绝对保护，并能将敌人像小石子一样弹飞。',
    entries: [{ kind: '形态转化', channel: 'universal', params: { series: '巨女' } }],
  },
  {
    name: '足之炼金术',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '极度稀有的天赋。制作出的女性伙伴卡能通过踩踏不同的素材，将其转化为全新的道具卡。例如踩踏矿石可能炼出金属，踩踏草药可能炼出药剂。',
    entries: [],
  },
  {
    name: '绝对支配宣言',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '制作出的女性伙伴卡在登场时，会强制所有敌方男性单位进行一次意志检定。检定失败者会陷入【痴迷】状态，优先攻击该卡牌的队友。',
    entries: [
      { kind: '战技附加', channel: 'universal', params: { status: '痴迷', power: 0, beats: 1 } },
    ],
  },
  {
    name: '天使之羽',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '制作出的女性卡牌会拥有圣洁的羽翼，身份为天使或女武神。她们天生拥有飞行能力和神圣属性攻击，对亡灵和恶魔造成巨大伤害。她们的思维中，绝对正义高于一切，有时会做出冷酷的抉择。',
    entries: [
      { kind: '形态转化', channel: 'universal', params: { series: '天使/女武神' } },
      { kind: '词条加权', channel: 'universal', params: { keywords: ['飞行', '神圣'], weight: 2 } },
    ],
  },
  {
    name: '女王的恩赐',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '制作出的女性伙伴卡必定为巨女体型，性格极其高傲。她们的普通攻击即为踩踏，对小型单位造成碾压伤害，并有几率附加恐惧状态。她们视万物为蝼蚁，存在的唯一乐趣就是寻找值得用脚尖玩弄的玩具。',
    entries: [
      { kind: '形态转化', channel: 'universal', params: { series: '巨女' } },
      {
        kind: '战技附加',
        channel: 'universal',
        params: { status: '践踏恐惧', power: 2, beats: 1 },
      },
    ],
  },
  {
    name: '踏星者',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '制作出的卡牌可以在虚空中行走，她们的每一步都踏在星辰之上。她们无视任何地形障碍，并且可以在战场上任意传送，其攻击会附带星辰陨落的范围伤害。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['星辰陨落'], weight: 2 } },
    ],
  },
  {
    name: '素材十连系统',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '每天获得一次免费的素材十连抽机会，保底获得一张不低于自身等级的稀有素材，有极小概率抽出高阶突变词条。',
    entries: [],
  },
  {
    name: '亲吻女神系统',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '亲吻任意女性可触发一次轮盘抽奖。对方实力越强、颜值越高、好感度越低，奖励轮盘的品质就越高，奖励包括但不限于临时强力Buff、稀有素材或对方的技能卡碎片。',
    entries: [],
  },
  {
    name: '宿敌认证系统',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '当你被一名强大的敌人视为宿敌时，系统会激活。每次与宿敌战斗或想到他时，你的训练效率都会翻倍，战胜宿敌后更能夺取其部分气运或一项技能。',
    entries: [],
  },
  {
    name: '搞事系统',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你搞出的乱子越大，影响范围越广，事后获得的混乱源质就越多。混乱源质是制作【畸变卡】和【混沌系】卡牌的顶级材料。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['混乱源质'], weight: 3 } },
    ],
  },
  {
    name: '圣液收集系统',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '通过各种方式收集到的女性体液都能被系统提纯为高级炼金素材或强力药剂。特定人物的体液更有奇效。',
    entries: [{ kind: '材料限定', channel: 'universal', params: { materialClass: '圣液' } }],
  },
  {
    name: '打脸升级系统',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '当你被人嘲讽、鄙视或看不起后，再用实力狠狠打对方的脸，你将获得海量经验值和打脸点数，可用于兑换特殊称号或装备。',
    entries: [],
  },
  {
    name: '剧透者系统',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你能在关键时刻看到弹幕或旁白，提前预知接下来的剧情走向或敌人的技能。但强行改变剧情会遭到世界意志的反噬。',
    entries: [],
  },
  {
    name: '调教大师系统',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你制作或捕获的女性伙伴卡，可以通过调教来塑造其性格和能力。无论是培养成忠犬还是女王，都由你决定。调教程度越高，她们的潜力激发得越彻底。',
    entries: [],
  },
  {
    name: '召唤媒介系统',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你的身体是一个特殊的召唤媒介，可以通过献祭自身的生命值或精神力，召唤出异世界的强大存在为你作战，但召唤物通常不受完全控制。',
    entries: [],
  },
  {
    name: '真名看破系统',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你可以看穿一切伪装，洞悉他人的真名和部分真实信息。念出对方的真名，可以对其造成一次强大的精神冲击。',
    entries: [],
  },
  {
    name: '恶魔之角',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '制作出的女性卡牌会长出恶魔的角和尾巴，身份为恶魔或堕天使。她们擅长使用火焰和暗影魔法，能诱惑敌人或汲取其生命力。她们的思维方式以利己为核心，信奉力量与欲望。',
    entries: [
      { kind: '形态转化', channel: 'universal', params: { series: '恶魔/堕天使' } },
      {
        kind: '战技附加',
        channel: 'universal',
        params: { status: '生命汲取', power: 3, beats: 2 },
      },
    ],
  },
  {
    name: '万能武装',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '制作出的女性卡牌能使用任何她能接触到的武器，并能瞬间发挥其最大效能。使用武器类装备时，该装备卡等级自动提升一个大等级，装备卡的经验值获取速度提升100%。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['万能武装'], weight: 3 } },
    ],
  },
  {
    name: '堕落英雄',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description: '制作的卡牌拥有神圣和邪恶双重属性，可以在高攻的堕落形态和高防的救赎形态之间切换。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '堕落/救赎形态切换' } }],
  },
  {
    name: '时间回溯',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '制卡失败时，你可以选择回溯时间，消耗大量精神力重新进行一次制卡过程，所有素材和状态将返回至制卡前。',
    entries: [],
  },
  {
    name: '魂之烙印',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '获得【魂缚仆从】【伙伴卡】和附属【灵魂渔网】【装备卡】的制作方法。制作魂缚仆从需要较为完整的灵魂素材。成功后，该生物将转化为绝对忠诚的伙伴卡，保留其生前的部分技能与记忆，但其意识将被彻底奴役。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '魂缚仆从/灵魂渔网' } }],
  },
  {
    name: '淫欲具象',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '获得【心魔魅影】【伙伴卡】的制作方法。此伙伴卡会具象化为能勾起女性敌人内心最深处淫欲与恐惧的幻象，对其进行精神层面的绝对支配与折磨，甚至可以永久策反。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '心魔魅影' } }],
  },
  {
    name: '畸变温床',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '获得【血肉殖装】【装备卡】（饰品）的制作方法。血肉殖装是一种活体寄生装备，它会与宿主深度共生，通过吞噬其他装备卡或魔物血肉进行自我进化与变异，但也会不断侵蚀宿主的理智。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '血肉殖装' } }],
  },
  {
    name: '足下亡魂',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你的女性伙伴卡通过踩踏攻击击杀敌人后，会从尸体上凝聚出【足下魂晶】素材，该素材是制作诅咒和束缚类技能卡的极品材料。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['足下魂晶'], weight: 2 } },
    ],
  },
  {
    name: '法则扭曲者',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '获得【绝对王权】【领域卡】的制作方法。在绝对王权领域内，制卡师可以指定一条战斗规则进行篡改，例如将治疗效果转化为伤害效果，或禁止敌方使用特定属性卡牌。此领域是足以逆转战局的霸道天赋。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '绝对王权' } }],
  },
  {
    name: '娇小巨神兵',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你只擅长制作体型娇小的女性伙伴卡。但你的所有伙伴卡都拥有召唤巨神兵的能力，可以召唤出与其体型形成巨大反差的机甲或魔像进行战斗，伙伴的属性会直接增幅于召唤物。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '巨神兵召唤' } }],
  },
  {
    name: '人外新娘',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '制卡时，你可以献祭自己的精血作为核心素材。这会必定制作出一张强大的人外形态伙伴卡，她会将你视为唯一的配偶，对你抱有极端的忠诚与占有欲。',
    entries: [
      { kind: '配方解锁', channel: 'universal', params: { recipe: '人外新娘' } },
      { kind: '材料限定', channel: 'universal', params: { materialClass: '精血' } },
    ],
  },
  {
    name: '永恒幼神',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你制作的伙伴卡外表将永远停留在幼年期。但她们的本质是远古神灵的容器，实力不随等级提升，而是通过吞噬特定的祭品来解锁更强大的力量。',
    entries: [{ kind: '形态转化', channel: 'universal', params: { series: '永恒幼神' } }],
  },
  {
    name: '堕落圣女',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '当你击败神圣、纯洁属性的雌性单位时，有50%的几率使其堕落，转化为属性相反的淫魔或荡妇，并有极高概率直接收为伙伴卡。',
    entries: [],
  },
  {
    name: '混沌赌徒',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '获得【潘多拉魔盒】【技能卡】的制作方法。使用此卡将从一个包含极度有利和毁灭性灾难的混沌效果池中随机触发一个效果，作用于场上所有单位。是疯子与赌徒的最终王牌。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '潘多拉魔盒' } }],
  },
  {
    name: '孕育之喰',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '获得【魔胎寄生】【技能卡】的制作方法。此卡能将一枚魔胎植入敌人体内，经过一回合的潜伏孕育后爆发，对宿主造成毁灭性穿透伤害，并孵化出一只临时的恶兆孽物为你作战，战斗结束后化为魔胎晶体素材。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '魔胎寄生' } }],
  },
  {
    name: '万法归寂',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '获得【禁忌石碑】【领域卡】的制作方法。在禁忌石碑领域内，所有单位的技能卡将被封印，所有装备卡与伙伴卡的被动词条效果将被压制。该领域将一切化为原始的肉搏。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '禁忌石碑' } }],
  },
  {
    name: '魅魔体质',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你的身体对异性/同性有天然吸引力。进行欲望主导制卡时，失败的惩罚会转化为对你身体的快感奖励。',
    entries: [],
  },
  {
    name: '调教大师系统',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你制作或捕获的女性伙伴卡，可以通过调教来塑造其性格和能力。无论是培养成忠犬还是女王，都由你决定。调教程度越高，她们的潜力激发得越彻底。',
    entries: [],
  },
  {
    name: '不等价交换',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你可以将自己的素材和卡牌放弃，天赋会给你带来1-2个类型相同，品质不高于原来的回报。',
    entries: [],
  },
  {
    name: '禁忌知识',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你天生就能解读古代文献和禁忌魔法，制作的卡牌有概率携带禁忌词条，如恶魔契约、灵魂囚笼。',
    entries: [
      {
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['恶魔契约', '灵魂囚笼'], weight: 2 },
      },
    ],
  },
  {
    name: '淫欲化身',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '进行欲望主导制卡时，你不仅免疫精神侵蚀，还能将溢出的欲望能量凝聚成欲望结晶素材，在进化或制作卡牌时加入可以让卡牌的欲望属性增强。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['欲望结晶'], weight: 3 } },
    ],
  },
  {
    name: '巨女的蹂躏',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你制作的女性伙伴卡体型会变得异常巨大。她们的普通攻击自带震慑和碾压效果，对体型小于自己的单位造成额外伤害。制卡时使用体型相关词条效果翻倍。',
    entries: [
      { kind: '形态转化', channel: 'universal', params: { series: '巨女' } },
      { kind: '词条加权', channel: 'universal', params: { keywords: ['震慑', '碾压'], weight: 2 } },
    ],
  },
  {
    name: '双生羁绊',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你可以指定两张伙伴卡建立双生羁绊，她们将共享感官和伤害，并能在战斗中释放强大的组合技。',
    entries: [],
  },
  {
    name: '素材点金',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description: '每天一次，你可以指定一个素材，使其品质提升一个大等级（如黑铁到青铜）。',
    entries: [],
  },
  {
    name: '堕落之种',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '进行欲望主导制卡时，你有概率向卡牌灵魂中植入堕落之种。拥有此种子的卡牌，在经历特定羞辱或快乐事件后，会开启恶堕的专属进化路线。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['堕落之种'], weight: 2 } },
    ],
  },
  {
    name: '圣遗物',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '对于每一个人形伙伴卡，你都可以指定一件物品作为伙伴卡的圣物。只要该伙伴卡向你奉献一件穿戴过的圣物，战斗力就会大幅提升，穿戴时间越久增幅越强。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['圣物'], weight: 3 } },
    ],
  },
  {
    name: '足尖舞者',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你制作的伙伴卡脚部会得到超级强化，更喜欢使用腿法战斗。自带高跟鞋踢、践踏、足交榨取等特殊技能。',
    entries: [
      {
        kind: '战技附加',
        channel: 'universal',
        params: { status: '足尖榨取', power: 2, beats: 1 },
      },
    ],
  },
  {
    name: '纯真塑形',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你制作的伙伴卡有极高概率以幼态或萝莉形态诞生，无论使用何种素材。这些卡牌拥有极高的成长潜力和更多的进化分支，但初始能力较弱。',
    entries: [{ kind: '形态转化', channel: 'universal', params: { series: '幼态萝莉' } }],
  },
  {
    name: '血灵根（东方）',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '血灵根代表生命的本源与邪道。击杀敌人后可吸收精血补充体力，同时必定获得被吸收者随机一个天赋或词条的弱化版，你更容易创造出诡异强大的血咒卡牌。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['血咒'], weight: 2 } },
    ],
  },
  {
    name: '无垢仙体（东方）',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你的身体纯净无暇，能自动净化素材中的负面与杂质词条，并免疫一切诅咒与侵蚀。你是欲望主导流派天生的克星。',
    entries: [],
  },
  {
    name: '功德金身（东方）',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你的灵魂中蕴含着浩然正气，制卡时可将善念注入其中，创造出具有守护与净化奇效的卡牌。邪恶生物会对你产生天然的畏惧。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['守护', '净化'], weight: 2 } },
    ],
  },
  {
    name: '生命摇篮',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你的灵魂深处烙印着生命最原始的法则。你制作的所有女性伙伴卡都将获得主动技能原始胎动：激活后化为生命源泉，每隔数秒孵化出一个同种类的衍生物。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '原始胎动' } }],
  },
  {
    name: '痛苦引擎',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你深知痛苦是最高效的燃料。制卡时可对其施虐，大幅降低初始忠诚度或增加一个负面词条，以此为代价强制提升该卡牌一个大等级。',
    entries: [],
  },
  {
    name: '自体熔炉',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你能将活物直接作为燃料和材料投入你的移动工厂机械中。被吞噬的生物等级越高，生产出的自走火炮或突击傀儡品质就越好。',
    entries: [
      { kind: '配方解锁', channel: 'universal', params: { recipe: '移动工厂' } },
      { kind: '材料限定', channel: 'universal', params: { materialClass: '活体' } },
    ],
  },
  {
    name: '古代知识',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你能够解读并制作古代或失落文明的卡牌，它们往往拥有独特而强大的机制，但材料也极为稀有。',
    entries: [{ kind: '材料限定', channel: 'universal', params: { materialClass: '古代文明' } }],
  },
  {
    name: '无限军火库',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你的所有伙伴卡，装备装备卡时不再有部位限制，一个伙伴可以同时装备多把武器或多件盔甲。',
    entries: [],
  },
  {
    name: '卡牌降临',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你可以将一张伙伴卡以降临形态召唤到自己身上，短时间内获得该伙伴的核心能力与外貌特征，成为一个强大的战士。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '降临形态' } }],
  },
  {
    name: '神性窃取',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '使用蕴含神性的物品作为材料，你有极小概率能窃取一丝神性，制造出拥有伪神词条的伙伴卡，她们拥有微弱的权能，但性格极其傲慢。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['伪神'], weight: 2 } },
    ],
  },
  {
    name: '深渊编织者',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description: '可使用古神残片、异界血肉等材料，制造出拥有触手攻击的伙伴卡，擅长束缚和精神污染。',
    entries: [
      {
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['触手', '束缚', '精神污染'], weight: 2 },
      },
    ],
  },
  {
    name: '巨龙血脉（伪）',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description: '你制作的卡组都拥有微弱的龙系血脉。可制造龙息（伪）、龙威（伪）等技能卡。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '龙息/龙威伪' } }],
  },
  {
    name: '母马驯师',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '将雌性目标永久改造为保留心智的人形母马，通过调教与骑乘将其彻底驯服后，她将成为集高速移动、恢复支援与专属战斗技能于一体的专属坐骑。',
    entries: [
      { kind: '形态转化', channel: 'universal', params: { series: '人形母马' } },
      { kind: '战技附加', channel: 'universal', params: { status: '驯服', power: 0, beats: 1 } },
    ],
  },
  {
    name: '地精国王',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description: '你会被野生的哥布林当作国王崇拜，并且制作有关哥布林的卡牌时必定大成功。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '哥布林' } },
      { kind: '成功率加成', channel: 'universal', params: { bonus: 100 } },
    ],
  },
  {
    name: '再生',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description: '你的身体拥有极其强大的再生能力，不会真正的死亡，哪怕是变成肉块都能重新活过来。',
    entries: [],
  },
  {
    name: '蛇符咒',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description: '你可以隐身。',
    entries: [],
  },
  {
    name: '爬虫王朝',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description: '当你制作有关爬行类卡牌时必定大成功，并且开局就拥有一张青铜级爬行类伙伴卡。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '爬行类' } },
      { kind: '成功率加成', channel: 'universal', params: { bonus: 100 } },
    ],
  },
  {
    name: '贝蒙斯坦',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description: '你可以吸收魔法和远程攻击，将其转换为hp和mp。',
    entries: [],
  },
  {
    name: '痛苦阶梯',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '该伙伴卡获得一个独特的痛苦能量槽，通过对敌人造成伤害和折磨来填充。能量槽每填满一阶，她的体型和力量都会发生一次可见的永久性增长，同时性格会变得更加残暴嗜虐。',
    entries: [],
  },
  {
    name: '恐虐印记',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '使用恶魔或混沌类素材制卡时，伙伴卡将携带恐虐印记，每次击杀敌人都能获得一层杀戮祝福，提升伤害和体型，最多叠加8层。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['恐虐印记'], weight: 2 } },
    ],
  },
  {
    name: '传奇车组',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你契约的伙伴卡将分别获得快速装填、驾驶好手、冷静指挥、火力压制等正面词条。凑齐传奇车组羁绊，你们可以一起驾驶一台炼金坦克。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['传奇车组'], weight: 2 } },
    ],
  },
  {
    name: '以人为本',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description: '可以使用失去战斗力的生命作为制卡素材。',
    entries: [{ kind: '材料限定', channel: 'universal', params: { materialClass: '失能生命' } }],
  },
  {
    name: '夏蝉与蟪蛄',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你所制得的人物卡血量必定是1，但是却有着虚化能力，除了设定的特定属性无法命中你的人物卡。你的人物卡必定带有病弱特性，外貌看起来十分虚弱。',
    entries: [],
  },
  {
    name: '命运之骰',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '每天可以投一次命运之骰，六个面分别是天灾、倒霉透顶、略有不顺、略有好运、诸事顺利、福缘天降。投出结果由世界的随机数决定，无法引导。',
    entries: [],
  },
  {
    name: '卡面来打',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你可以用金属、生物等素材制作特殊的腰带型装备卡，当你使用这种装备卡后你会获得变身的能力。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '变身腰带' } }],
  },
  {
    name: '娘化人物爱好者',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '来自异世界的历史知识充盈了你的大脑，你可以用异世界的历史知识作为素材来进行制卡，以此办法进行的制卡一定大成功，触发的良性进化会锁定伙伴卡的性别为女。',
    entries: [{ kind: '材料限定', channel: 'universal', params: { materialClass: '异世界历史' } }],
  },
  {
    name: '信仰成神',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你只能制作伙伴卡，你制作的伙伴卡将会带有狂信徒词条，且将伙伴卡的忠诚度改为信仰值。随着信仰值的提升，伙伴卡将会自行衍生出技能卡领域卡和装备卡。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['狂信徒'], weight: 3 } },
    ],
  },
  {
    name: 'flag?',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description: '你向别人立下的flag从不让人失望，以各种奇怪的形式。',
    entries: [],
  },
  {
    name: '脏枪小子',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description: '你拥有一把可以无限改造，增加任何东西的枪。枪越大，枪口越多，声音越响，火力越猛。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['脏枪'], weight: 3 } },
    ],
  },
  {
    name: '海底捞月',
    grade: 'S' as TalentGrade,
    source: 'universal',
    description:
      '你在进行任何打捞、采集、搜索行为时，有额外15%的概率获得超出预期一个等级的物品或素材。该概率在月圆之夜翻倍至30%。',
    entries: [],
  },

  // ── v8 第四批 A 级全量（主人 2026-09-15；制作专精/系统/规则/形态转化，条目映射或纯叙事）──
  {
    name: '荒野镖客',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '孤狼的浪漫。在没有【伙伴卡】出战的单人状态下，你的所有基础属性提升25%，暴击率提升15%。',
    entries: [],
  },
  {
    name: '西部骑乘位',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '当你处于【骑乘】状态时，你的攻击必定暴击，且腰部与大腿力量绵绵不绝。',
    entries: [],
  },
  {
    name: '狂野女牛仔',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '仅限女性，装备马靴、皮鞭或套索时，对目标造成额外30%的伤害；若使用皮鞭抽击，有概率直接将低等级敌人驯化为【奴隶】。',
    entries: [
      {
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['马靴', '皮鞭', '套索'], weight: 2 },
      },
    ],
  },
  {
    name: '左轮轮盘赌',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '技能卡冷却完毕时，有六分之一的概率该技能威力提升500%，但有六分之五的概率炸膛，扣除自身20%HP并陷入【爆衣】状态。',
    entries: [],
  },
  {
    name: '烈马调教者',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你在制作或对抗带有【野性】、【傲慢】标签的魔物娘/伙伴卡时，拥有绝对压制力。每次攻击都有概率削减其忠诚底线，最终将其变为你的专属坐骑。',
    entries: [],
  },
  {
    name: '女王的衣橱',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '该天赋解锁一系列女王/女主人风格的卡牌外观。制作的伙伴卡能根据战况瞬间切换不同的SM服装，每套服装对应一种战斗模式。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '女王衣橱' } }],
  },
  {
    name: '人偶师之线',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '伙伴卡能射出几乎看不见的魔力丝线，操控敌人的四肢，使其自相残杀或做出滑稽的动作。她视所有人为自己的提线木偶。',
    entries: [],
  },
  {
    name: '财务榨取',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '制作的伙伴卡会变成女王或大小姐性格，她会不断向你索要金钱。你越上贡，她在战斗中就越强大，并能使用金钱攻击直接对敌人造成财富打击。',
    entries: [],
  },
  {
    name: '修女的神圣戒律',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '伙伴卡化身为禁欲又渴望惩戒罪人的战斗修女，身着修女服。她们使用十字架和圣水战斗，对恶魔和亡灵系敌人有特攻，并坚信你是需要被净化的罪人。',
    entries: [
      { kind: '形态转化', channel: 'universal', params: { series: '战斗修女' } },
      {
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['圣水', '十字架'], weight: 2 },
      },
    ],
  },
  {
    name: '孤高之作',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '制卡成功率不高，但一旦成功，必是精品。成品卡牌通常会带有【唯一】词条，无法被复制。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['唯一'], weight: 3 } },
    ],
  },
  {
    name: '宝石迷恋',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '使用宝石作为核心材料时，能完美激发其能量，制作出的法术卡威力倍增，装备卡必定附加华丽的元素抗性或攻击词条。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '宝石' } },
      { kind: '词条加权', channel: 'universal', params: { keywords: ['元素抗性'], weight: 2 } },
    ],
  },
  {
    name: '精神塑造者',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '擅长制作幻术、心灵冲击、读心等精神系法术卡，能直接攻击敌人的意志。',
    entries: [
      {
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['幻术', '心灵冲击', '读心'], weight: 2 },
      },
    ],
  },
  {
    name: '地行龙骑',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '对使用龙类、亚龙类及大型爬行魔物素材制作载具卡有特殊心得，成品更容易获得龙鳞装甲、吐息炮、野性冲锋等词条。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '龙类爬行' } },
      {
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['龙鳞装甲', '吐息炮', '野性冲锋'], weight: 2 },
      },
    ],
  },
  {
    name: '浮空城之梦',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '在制作飞行或浮空类载具时，大幅降低MP消耗与材料要求，并有更高几率制作出可供多人搭乘的大型空中载具。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '浮空载具' } }],
  },
  {
    name: '爆破狂人',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你对爆炸就是艺术的信条深信不疑。制作的所有炸弹、爆弹类道具卡，爆炸范围和伤害都显著提升，且有几率引发连锁爆炸。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['爆炸'], weight: 2 } },
    ],
  },
  {
    name: '陷阱大师',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你制作的陷阱类道具卡（符文、地雷、捕兽夹等）更难被侦测，触发条件更隐蔽，且效果往往比描述的更阴险。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '陷阱道具卡' } }],
  },
  {
    name: '自毁协议',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你可以在制作任何载具卡时，额外为其植入一张隐藏的自爆道具卡，可在载具被摧毁或主动引爆时触发，造成巨大范围伤害。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '自爆装置' } }],
  },
  {
    name: '炼金气雾师',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '你能将药水与炸弹结合，制作出能大范围播撒治疗、毒雾或减益效果的炼金气雾弹。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '炼金气雾弹' } }],
  },
  {
    name: '活体弹药',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你可以将小型的、活的魔物（如史莱姆、尖叫蘑菇）直接封印成道具卡，作为投掷武器，命中后会释放其生物特性。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '活体封印' } }],
  },
  {
    name: '森之低语',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '制作植物或德鲁伊相关卡牌时，成品会拥有更高的活性，如树人伙伴卡能缓慢自愈，藤蔓技能卡能自主寻找敌人。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '植物' } },
      { kind: '词条加权', channel: 'universal', params: { keywords: ['自愈'], weight: 1 } },
    ],
  },
  {
    name: '雷霆之怒',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '制作雷电系技能卡时，有极高概率附加麻痹和连锁闪电词条。',
    entries: [
      { kind: '战技附加', channel: 'universal', params: { status: '麻痹', power: 0, beats: 1 } },
      { kind: '词条加权', channel: 'universal', params: { keywords: ['连锁闪电'], weight: 2 } },
    ],
  },
  {
    name: '锻火之心',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '使用金属矿石制作武器卡时，有概率制造出更高等级的卡牌，并有几率附加灼热、熔岩等火属性词条。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '金属矿石' } },
      { kind: '词条加权', channel: 'universal', params: { keywords: ['灼热', '熔岩'], weight: 2 } },
    ],
  },
  {
    name: '天衣无缝',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '制作任何布甲、皮甲类服装卡时，成品的基础防御力和舒适度远超常规，有极高概率附加轻盈、韧性词条。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['轻盈', '韧性'], weight: 2 } },
    ],
  },
  {
    name: '狐之魅',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你制作的卡牌会转化为狡黠的狐妖系列生物，天生擅长幻术与精神魅惑，战斗风格诡秘，但有收集亮晶晶东西的怪癖。',
    entries: [
      { kind: '形态转化', channel: 'universal', params: { series: '狐妖' } },
      { kind: '词条加权', channel: 'universal', params: { keywords: ['幻术'], weight: 2 } },
    ],
  },
  {
    name: '神圣马角',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你制作的卡牌会转化为圣洁的独角兽系列生物，拥有强大的治疗与净化能力，无法容忍任何邪恶或污秽的存在，对使用者有极高的道德要求。',
    entries: [
      { kind: '形态转化', channel: 'universal', params: { series: '独角兽' } },
      { kind: '词条加权', channel: 'universal', params: { keywords: ['治疗', '净化'], weight: 2 } },
    ],
  },
  {
    name: '狮鹫骑士',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你制作的卡牌会转化为兼具威严与忠诚的狮鹫拟人系列生物，拥有飞行的能力与王者的气度，认定你是其唯一的效忠对象，并会主动守护你的荣耀。',
    entries: [
      { kind: '形态转化', channel: 'universal', params: { series: '狮鹫' } },
      { kind: '词条加权', channel: 'universal', params: { keywords: ['飞行'], weight: 2 } },
    ],
  },
  {
    name: '哲学家',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你制作的伙伴卡总是会思考一些深刻的问题，比如我为何而战。她们的忠诚度不容易提升，但一旦认可你，将至死不渝，并有概率在战斗中领悟专属技能。',
    entries: [],
  },
  {
    name: '量子纠缠',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你制作的卡牌，其效果会在成功和失败两种状态中叠加，直到使用时才最终确定。例如，一张火球卡在使用前，你不知道它会是大火球还是小火苗。',
    entries: [],
  },
  {
    name: '模仿者',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '制卡时，你可以指定一张自己的手牌作为模板，新制成的卡牌有概率复制模板卡的一个词条。',
    entries: [],
  },
  {
    name: '赛博格',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你擅长将生物素材与机械素材结合，制作出的赛博格伙伴卡同时拥有生物的成长性和机械的可改造性。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '生物' } },
      { kind: '材料限定', channel: 'universal', params: { materialClass: '机械' } },
    ],
  },
  {
    name: '灵魂低语者',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '在融合阶段，你能模糊地听到素材词条的意愿，更容易找到最和谐的融合路径。使用和谐共鸣流派时，可控失败的概率大幅降低。',
    entries: [],
  },
  {
    name: '王室血誓',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '制作出的女性卡牌拥有高贵的王室血统。她们自带领导光环，能提升我方所有单位的士气。战斗风格为正统的骑士剑术，坚信荣誉与守护，绝不使用卑劣的手段。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['领导'], weight: 2 } },
    ],
  },
  {
    name: '小人国的女王',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '制作出的女性伙伴卡在面对复数个等级低于自己的敌人时，全属性会获得提升。敌人越多，她就越强。',
    entries: [],
  },
  {
    name: '军靴的纪律',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '制作出的卡牌必定穿着厚重的军靴，性格严苛冷酷。她们擅长使用踢技，能够轻易踢碎敌人的护甲。其卡牌自带威压光环，降低敌方全体单位的士气。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['军靴', '威压'], weight: 2 } },
    ],
  },
  {
    name: '每日签到系统',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '每天可进行一次签到，随机获得卡币、素材或消耗品。连续签到天数越多，出现稀有奖励的概率越高，特定天数更有保底大奖。',
    entries: [],
  },
  {
    name: '美食家系统',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '品尝不同的食物可以获得美食点数，累积点数可永久提升基础属性。品尝到传说级或蕴含特殊能量的料理时，可直接领悟新的技能或词条。',
    entries: [],
  },
  {
    name: '万物图鉴系统',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你接触到的任何新物种、新素材、新卡牌都会被自动记录在图鉴中。每完成一个分类的图鉴，就能获得一次针对该分类的永久性加成。',
    entries: [],
  },
  {
    name: '行走印钞机系统',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '你每走一公里，系统就会自动生成一定数量的卡币。你的等级越高，每公里的汇率也越高。',
    entries: [],
  },
  {
    name: '反派洗白系统',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你拥有与生俱来的亲和力，与恶阵营的角色交流时，有更高几率触发特殊剧情，说服他们，甚至让他们弃暗投明，成为你的伙伴。',
    entries: [],
  },
  {
    name: '师道尊严系统',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '当你收下弟子并传授其知识或技能时，你能获得其成长经验的20%作为反馈。弟子越强，你获得的好处越多。',
    entries: [],
  },
  {
    name: 'BOSS首杀系统',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你作为队长第一次击杀区域BOSS或副本BOSS时，队伍将获得额外奖励，包括稀有称号、专属装备和大量经验。',
    entries: [],
  },
  {
    name: '任务发布系统',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你可以像系统一样，向其他人发布任务。当他们接受并完成后，你可以获得一部分系统奖励，而他们也能得到你设定的报酬。',
    entries: [],
  },
  {
    name: '献祭系统',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你可以通过献祭物品、卡牌甚至活物来取悦某个未知的存在，以换取力量、知识或实现一个愿望。祭品越珍贵，回报越丰厚。',
    entries: [],
  },
  {
    name: '催眠大师系统',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '通过眼神、声音或特定道具，你可以对他人进行催眠，植入指令或篡改记忆。效果强弱取决于双方的精神力差距。',
    entries: [],
  },
  {
    name: '神之右手系统',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你的右手拥有特殊的力量，无论是制卡、抚摸还是战斗，都能发挥出远超平常的精准度和力量。俗称麒麟臂。',
    entries: [],
  },
  {
    name: '贪婪系统',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你击杀敌人后，战利品的掉落数量和稀有度会得到提升。你还可以指定一件物品，在下一次交易中强买强卖。',
    entries: [],
  },
  {
    name: '等价交换系统',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你可以向系统献祭任何物品来换取炼成值。消耗炼成值，你可以指定一个模糊的方向，系统将为你随机生成一件符合描述的物品，品质完全随机。',
    entries: [],
  },
  {
    name: '万物骸骨',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '制作的任何生物卡牌都会变成对应的骷髅形态，种族变为亡灵，免疫精神与血肉类攻击，但受到光属性和钝击伤害加倍。',
    entries: [{ kind: '形态转化', channel: 'universal', params: { series: '亡灵骷髅' } }],
  },
  {
    name: '废品专家',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '你总能从可控失败的废卡中发现意想不到的价值，其负面词条有概率转化为特殊正面词条。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['变废为宝'], weight: 2 } },
    ],
  },
  {
    name: '集群母狗',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你拥有的母狗单位超过3个时，激活犬舍光环，所有母狗单位的全属性提升10%。每多拥有一个，额外提升2%。',
    entries: [],
  },
  {
    name: '贡金契约',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你每天必须向你的女性伙伴卡上缴一定数额的金钱作为贡金。上缴越多，她当天反馈给你的随机buff就越强。若无法上缴，你将受到奴隶的惩戒debuff。',
    entries: [],
  },
  {
    name: '虐待狂化',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你的女性伙伴卡在HP低于30%时，会进入虐待狂化状态。攻击力与攻击速度大幅提升，但在战斗结束后，会持续虐待你直到状态结束。',
    entries: [],
  },
  {
    name: '将就着用',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你每天可以使一个等级不高于你一级的素材直接变成一张相关卡牌，卡牌等级低于原素材等级一级。',
    entries: [],
  },
  {
    name: '百毒之体（东方）',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你天生不惧任何剧毒。处理剧毒素材时不会受到任何负面影响，并能最大化地提炼其毒性词条。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '剧毒' } },
      { kind: '词条加权', channel: 'universal', params: { keywords: ['剧毒'], weight: 2 } },
    ],
  },
  {
    name: '魔种寄生（东方）',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '一颗上古魔种寄生在你的心脏。它时刻引诱你堕落，但也赋予你强大的力量。使用欲望主导流派制卡时，效果和成功率提升，但每次都会侵蚀你的理智。',
    entries: [],
  },
  {
    name: '炼金巧手',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '分解素材时，有较高概率获得额外的稀有材料。',
    entries: [],
  },
  {
    name: '痛苦链接',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '制卡失败或卡牌爆炸时，你受到的伤害和损失的mp会转化为等量的MP，并且下一次制卡成功率小幅提升。',
    entries: [],
  },
  {
    name: '魔物亲和',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你可以与部分智慧型魔物进行交流。使用魔物素材制卡时，有更高概率保留其原始的野性词条。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '魔物' } },
      { kind: '词条加权', channel: 'universal', params: { keywords: ['野性'], weight: 2 } },
    ],
  },
  {
    name: '黑市贵宾',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '你在黑市中声名远扬，所有交易都能享受折扣，并能接到一些不对外开放的特殊委托。',
    entries: [],
  },
  {
    name: '活体巢穴',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '获得虫巢子宫装备卡的制作方法。虫巢子宫可寄生于雌性伙伴体内，通过持续吸收其生命力来孕育并高速产下悍不畏死的虫族战士。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '虫巢子宫' } }],
  },
  {
    name: '糖果与鞭挞',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '制作萝莉型伙伴卡时，会附加双面词条，使其在可爱外表下拥有截然相反的腹黑或病娇人格，并获得一套独立的技能组。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['双面'], weight: 2 } },
    ],
  },
  {
    name: '圣水之泉',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '获得祝福之泉领域卡的制作方法。需指定一名伙伴卡在领域中心，其尿液将形成喷泉治愈友军并净化负面状态；同时会对敌人造成精神冲击与属性腐蚀。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '祝福之泉' } }],
  },
  {
    name: '血肉契约',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '获得血肉魔偶伙伴卡的制作方法。允许制卡师将生物的血肉肢体作为核心素材，制造出绝对忠诚的魔偶。使用的血肉部位越关键、越新鲜，魔偶的初始属性与成长潜力就越强。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '血肉魔偶' } }],
  },
  {
    name: '精神烙印',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '获得支配项圈技能卡的制作方法。该项圈可强行作用于敌人颈部，通过注入混合着痛苦与快感的精神冲击来摧毁其意志，有较高概率将其转化为临时奴隶。失败将遭到精神反噬。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '支配项圈' } }],
  },
  {
    name: '丝袜裁缝',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你天生擅长制作丝织品。在制作腿部和脚部的袜类装备卡时，材料消耗减少，且必定会附加一个随机的正面词条。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['丝袜'], weight: 2 } },
    ],
  },
  {
    name: '忠诚之鞭',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '获得调教鞭装备卡的制作方法，使用该卡牌鞭打你的伙伴或奴隶，会小幅降低其HP，但能大幅提升其忠诚度和短时间内的攻击力。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '调教鞭' } }],
  },
  {
    name: '痛苦回响',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '获得荆棘之心技能卡的制作方法。被动技能，将自身或伙伴卡受到的所有伤害转化为纯粹痛苦，按一定比例无视防御地反射给攻击者。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '荆棘之心' } }],
  },
  {
    name: '强制受孕',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '获得温床刻印技能卡的制作方法。此歹毒印记可打入敌人体内，强制其受孕并孕育出一头凶暴的寄生孽子。孽子会啃食母体，破体而出后为己方作战。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '温床刻印' } }],
  },
  {
    name: '污秽之力',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '获得绝望泥沼领域卡的制作方法。制卡时需混入大量污秽之物。领域内，敌人将持续受到恶臭与不洁影响，全属性大幅降低，而亡灵、恶魔等友军单位则会获得强化。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '绝望泥沼' } }],
  },
  {
    name: '机械改造',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你可以进行残忍的活体改造手术，将生物肢体替换为精密的机械造物，大幅提升其战斗能力。改造过程不可逆，且有概率发生排异反应导致机体崩溃。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '机械改造手术' } }],
  },
  {
    name: '萝莉养成',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你培育萝莉伙伴卡的效率提升100%。通过调教指令，你可以自定义她们的成长方向，甚至为其增添新的词条。',
    entries: [{ kind: '形态转化', channel: 'universal', params: { series: '萝莉' } }],
  },
  {
    name: '雷灵根（东方）',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你的体内有一股狂暴的东方之力——雷灵根。它是天罚的化身，你制作的卡牌会附带毁灭性的雷霆灵力，迅捷且霸道。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['雷霆灵力'], weight: 2 } },
    ],
  },
  {
    name: '风灵根（东方）',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你的体内有一股飘逸的东方之力——风灵根。它是自由的象征，你制作的卡牌会附带灵动的风之灵力，轻盈且迅疾。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['风之灵力'], weight: 2 } },
    ],
  },
  {
    name: '冰灵根（东方）',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你的体内有一股极寒的东方之力——冰灵根。它是万物寂灭的体现，你制作的卡牌会附带冻结一切的玄冰灵力，兼具控制与杀伤。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['玄冰灵力'], weight: 2 } },
    ],
  },
  {
    name: '触手之友',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你天生对触手类生物有极强的吸引力。制作或使用触手类卡牌时，效果增强30%，且能通过与触手交媾来恢复精神力。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['触手'], weight: 2 } },
    ],
  },
  {
    name: '卡牌美食家',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你可以通过吃掉卡牌来分解它，获得比普通分解更多的核心素材，并有小概率直接领悟卡牌的部分能力。',
    entries: [],
  },
  {
    name: '催眠之瞳',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你的眼睛拥有微弱的催眠能力，在与NPC交涉时成功率提升。在制卡时，可以对素材进行催眠，使其词条更易于引导。',
    entries: [],
  },
  {
    name: '流体亲和',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你对史莱姆、元素凝胶等流体生物有特殊亲和力，能将它们制作成具有塑形、束缚、侵蚀、吞噬等能力的特殊卡牌。',
    entries: [
      { kind: '形态转化', channel: 'universal', params: { series: '流体生物' } },
      {
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['塑形', '束缚', '侵蚀'], weight: 2 },
      },
    ],
  },
  {
    name: '共鸣之躯',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '制卡时，你可以与主素材进行精神共鸣，亲身体验其核心情感，大幅提升保留高品质词条的概率。',
    entries: [],
  },
  {
    name: '血肉炼成',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '你可以将自己的血肉作为素材融入卡牌，大幅提升卡牌的生命链接，但会永久消耗HP上限。',
    entries: [],
  },
  {
    name: '卡牌附身',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你可以让一张伙伴卡临时附身于你，借用其部分能力和属性，但期间你的身体主导权会受到伙伴卡性格的影响。',
    entries: [],
  },
  {
    name: '深渊墨水',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '每天都会获得一份深渊墨水，你可以使用深渊墨水作为制卡素材。使用后，必定为卡牌附加恶堕或魔化词条，并扭曲其原有词条，但失败和发生变异的可能性同时增大。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['恶堕', '魔化'], weight: 3 } },
    ],
  },
  {
    name: '破瓜者',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '成功夺取雌性生物的第一次后，你将永久夺取其1个随机词条，并可获得特殊素材染血的元阴。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['染血的元阴'], weight: 3 } },
    ],
  },
  {
    name: '魔乳炼成',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '仅限女性伙伴卡，你可以提取伙伴卡的乳汁作为素材，能显著提升制卡成功率，并有概率为卡牌附加哺乳、催乳、巨乳化等特殊词条。',
    entries: [
      {
        kind: '词条加权',
        channel: 'universal',
        params: { keywords: ['哺乳', '催乳', '巨乳化'], weight: 2 },
      },
    ],
  },
  {
    name: '圣秽之躯',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你制作的伙伴卡有大概率携带圣遗物词条，拥有该词条的伙伴卡，其所有排泄物都有非常强大的恢复能力和随机正向buff，但本身携带的异味会放大两倍。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['圣遗物'], weight: 3 } },
    ],
  },
  {
    name: '嫉妒之火',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '当你的伙伴卡与除你之外的任何人发生亲密互动被你目击时，你的下一次制卡必定会触发良性突变。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['良性突变'], weight: 3 } },
    ],
  },
  {
    name: '肉体改造家',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你可以主动在制卡时添加改造词条，为诞生的伙伴卡附加额外的非人部件，如触手、翅膀、兽耳等，并赋予其相应能力。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['改造'], weight: 2 } },
    ],
  },
  {
    name: '魅魔君主',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你制作的所有卡牌，都会天生带有吸精词条，可以通过性行为从任何生物身上汲取生命力和魔力，用于自我恢复和成长。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['吸精'], weight: 3 } },
    ],
  },
  {
    name: '魔能熔炉',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你可以将两张低于你制卡师等级一阶或以下的卡牌熔炼，有概率获得一张更高级的、融合两者特性的新技能卡，但也有可能彻底损毁。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '魔能熔炉' } }],
  },
  {
    name: '神之血',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '使用蕴含神性的材料时，有概率制造出天使、英灵等伙伴卡，她们拥有强大的圣属性，并天生对恶魔、亡灵有克制效果。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '神性' } },
      { kind: '词条加权', channel: 'universal', params: { keywords: ['圣属性'], weight: 2 } },
    ],
  },
  {
    name: '堕落的救赎',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你对圣洁或纯洁的伙伴卡使用堕落材料时，有概率使其转化为属性更强、技能更具侵略性的堕落形态。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '堕落的救赎' } }],
  },
  {
    name: '战争之王',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '你场上的伙伴卡数量越多，所有伙伴卡的攻击力越高（每多一张+5%）。',
    entries: [],
  },
  {
    name: '悖论制造者',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '你制作的卡牌有概率同时拥有两个完全相反的词条，并能从中获得意想不到的强大力量。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['相反词条'], weight: 2 } },
    ],
  },
  {
    name: '群星的回想',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '每轮对话，群星会告诉你一个关于卡兰大陆的情报。你也可以主动问你想知道的，但需要花费一定代价。',
    entries: [],
  },
  {
    name: '双生梦魇',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '制造伙伴卡时，有一定概率额外生成一张同名的镜像卡。两张卡共享生命，但性格与能力往往截然相反，一个是光，另一个就是影。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '镜像双生' } }],
  },
  {
    name: '童话编织者',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你能以童话故事为蓝本制造卡牌，并能自由扭曲其设定，例如制造出猎杀王子的白雪公主或用魔法开办工厂的灰姑娘。',
    entries: [],
  },
  {
    name: '元素融合',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '制卡时，可将两种不冲突的元素材料融合，制造出拥有双重属性的卡牌（如熔岩）。',
    entries: [{ kind: '配方解锁', channel: 'universal', params: { recipe: '双元素融合' } }],
  },
  {
    name: '英雄之王',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你可以将传说级英雄的圣遗物作为核心，制造出独一无二的英灵伙伴卡。一个卡组只能存在一张英灵卡，但它的战斗力远超同级，并拥有复数个专属技能。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '英雄圣遗物' } },
      { kind: '配方解锁', channel: 'universal', params: { recipe: '英灵' } },
    ],
  },
  {
    name: '铸剑为犁',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '你制造战斗系卡牌的成功率下降，制作工具类、服装类卡牌时，必定触发良性突变。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['良性突变'], weight: 3 } },
    ],
  },
  {
    name: '成龙',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '你可以把任何东西当作装备来使用。',
    entries: [],
  },
  {
    name: '军团之主',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '制卡时，你可以明确你创造的卡牌是个性鲜明的领军或是数量众多的士兵，前者必定拥有强大的独特技能并且性格突出，后者则必定带有群体召唤词条，但数值将平均分配至每个单位。',
    entries: [],
  },
  {
    name: '黑死牟',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你拥有六只眼睛。你获得一套完整的黑铁级的月之呼吸精英级卡组。这能帮助你在前期使用日本刀术击败一些实力不错的对手。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['月之呼吸'], weight: 3 } },
    ],
  },
  {
    name: '邀月对饮',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '将等级不大于卡牌的素材其中一项词条，剪为意象妆点卡牌外观。',
    entries: [],
  },
  {
    name: '天妒英才',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你制作的伙伴卡都身患一种残疾，但拥有得天独厚的天赋。生成时等级越高则残疾越重，天赋也越是卓越。',
    entries: [],
  },
  {
    name: '神匠之手',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '当你制作装备卡时，装备卡的基础属性将会是素材提供的最大值，有10%的几率使制作的装备提升一个等级。',
    entries: [],
  },
  {
    name: '蒸汽元素',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你可以制作特殊的元素卡，蒸汽元素。蒸汽元素因为由高温和水分子组成，所以免疫火和水属性的伤害。',
    entries: [
      { kind: '材料限定', channel: 'universal', params: { materialClass: '蒸汽' } },
      { kind: '配方解锁', channel: 'universal', params: { recipe: '蒸汽元素' } },
    ],
  },
  {
    name: '寒蝉的鸣泣',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你制得的人物卡有着心理疾病，若是能解决心理疾病则她会获得天真纯洁的特质，若是不能则会获得杀人狂的黑化特质。此心理疾病会传染，但仅会传染到女性人物卡身上。',
    entries: [],
  },
  {
    name: '天生贵胄',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你的皇族血脉给你带来了皇族气质，你制作的非伙伴卡都自带皇家高贵相关词条，你制作的伙伴卡将根据制作素材带有各不相同的特殊贵族词条。',
    entries: [
      { kind: '词条加权', channel: 'universal', params: { keywords: ['皇家', '高贵'], weight: 2 } },
    ],
  },
  {
    name: '傲慢无礼',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '只可以使用非伙伴卡，战斗中可以将自身任意张伙伴卡视作装备卡进行使用，可以对敌方至多一张伙伴卡发动，有概率将其视作装备卡装备在自身上。',
    entries: [],
  },
  {
    name: '厨神？',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '你做的食物很好看且拥有随机永久增益效果，但非常难吃。',
    entries: [],
  },
  {
    name: '替身之力',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你的攻击会伴随欧拉欧拉或者木大木大等意义不明的叫声，同时会出现一个其他人看不见的替身攻击敌方。',
    entries: [],
  },
  {
    name: '反间计',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你可以通过言语描述、虚假情报等任意方式，降低敌方伙伴卡的忠诚度，降低程度决定于你言语的煽动性、逻辑合理性。',
    entries: [],
  },
  {
    name: '这他妈就离谱！',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description: '当你将一件事说的越离谱时，NPC将会越相信你的话。你的语言，将引来神灵的关注。',
    entries: [],
  },
  {
    name: '深渊之瞳',
    grade: 'A' as TalentGrade,
    source: 'universal',
    description:
      '你的双眼适应了深海的黑暗。在水下环境中获得完美的暗视能力，且能看穿一切隐身与幻术效果。在陆地上，你的视力在黑夜中同样优越，但强光会对你造成短暂致盲。',
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
