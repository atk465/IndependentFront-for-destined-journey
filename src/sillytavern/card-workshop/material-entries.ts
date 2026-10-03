/**
 * material-entries.ts — 素材词条池（2026-10-02 批次D：负面词条 + 主/副素材位差）
 *
 * 设计（竞品借鉴 × 本仓纪律）：
 * - 素材可携带自己的词条：存 `data.词条` 数据袋（对齐调教/倾向先例），读侧池内
 *   门禁——池外名字丢弃（对齐 coerceCardEffects「只选不改数」口径）；
 * - 词条带**生效位**（主位/副位/通用）：同一素材换位就换生效面——位差的落地；
 * - 负面词条让低阶素材不再严格更差（受潮/残瑕/杂质/涩纹）；
 * - 消费点唯一：planCardCraft（评级掷骰 ± 与理解修正同一条加算链、产物卡面战力 ±、
 *   产物必得元素词条），全部确定性、逐条进审计，AI 不参与结算。
 *
 * 纯度约束：纯函数、无 I/O；注册缝与 materialElements 同款（内建基线 + 内容包同名覆写）。
 */
import type { InventoryItem } from '../types';
import { deriveElements } from './material';

export interface MaterialEntryDef {
  name: string;
  /** 生效位：主位/副位/通用——同一素材不同位激活不同词条（位差） */
  slot: '主位' | '副位' | '通用';
  polarity: '正' | '负';
  /** UI 与提示词共用措辞 */
  text: string;
  /** 制卡评级掷骰 ±（与理解修正同一条加算链） */
  dc?: number;
  /** 产物卡面战力 ±（允许轻微负值 = 瑕疵打折的 D3 弱化口径，不引入品相档） */
  power?: number;
  /** 产物必得该素材的首个元素词条（产物已有则不重复） */
  bonusElement?: boolean;
}

export const MATERIAL_ENTRY_POOL: readonly MaterialEntryDef[] = [
  // ── 正 ──
  { name: '灵光', slot: '通用', polarity: '正', dc: 2, text: '制卡评级掷骰 +2——主副位皆生效' },
  { name: '浑成', slot: '主位', polarity: '正', power: 1, text: '作为主素材时，产物卡面战力 +1' },
  { name: '凝萃', slot: '副位', polarity: '正', dc: 1, text: '作为副素材时，制卡评级掷骰 +1' },
  {
    name: '引韵',
    slot: '副位',
    polarity: '正',
    bonusElement: true,
    text: '作为副素材时，产物必得它的首个元素词条',
  },
  // ── 负 ──
  {
    name: '受潮',
    slot: '主位',
    polarity: '负',
    dc: -2,
    text: '作为主素材时，制卡评级掷骰 −2——湿气侵纹',
  },
  {
    name: '残瑕',
    slot: '主位',
    polarity: '负',
    power: -1,
    text: '作为主素材时，产物卡面战力 −1——纹路里带着旧伤',
  },
  { name: '杂质', slot: '副位', polarity: '负', dc: -1, text: '作为副素材时，制卡评级掷骰 −1' },
  { name: '涩纹', slot: '副位', polarity: '负', power: -1, text: '作为副素材时，产物卡面战力 −1' },
];

const ENTRY_BY_NAME: ReadonlyMap<string, MaterialEntryDef> = new Map(
  MATERIAL_ENTRY_POOL.map((d) => [d.name, d]),
);

/** 素材名 → 词条名（内建基线 + 内容包 catalog.materialEntries 同名覆写） */
const MATERIAL_ENTRY_OVERRIDES = new Map<string, readonly string[]>();

/** 登记素材词条（同名覆盖；内容包 catalog.materialEntries 通道灌入） */
export function registerMaterialEntries(map: Record<string, unknown> | undefined): void {
  if (!map) return;
  for (const [name, entries] of Object.entries(map)) {
    if (Array.isArray(entries) && entries.length > 0) {
      MATERIAL_ENTRY_OVERRIDES.set(name.trim(), entries.map(String));
    }
  }
}

/** 素材名 → 生效词条名清单（覆写优先，回落内建基线） */
function entryNamesOfMaterial(name: string): readonly string[] {
  return MATERIAL_ENTRY_OVERRIDES.get(name) ?? BUILTIN_MATERIAL_ENTRIES[name] ?? [];
}

/**
 * 单件素材的词条（读侧门禁）：池内才认、去重、最多 3 条——
 * 上限封住聚合面（3 素材 × 3 词条，掷骰修正有界）。
 */
export function materialEntriesOf(item: Pick<InventoryItem, 'name' | 'data'>): MaterialEntryDef[] {
  const raw = (item.data as { 词条?: unknown } | null | undefined)?.词条;
  if (!Array.isArray(raw)) return [];
  const out: MaterialEntryDef[] = [];
  for (const n of raw) {
    const def = ENTRY_BY_NAME.get(String(n));
    if (def && !out.some((d) => d.name === def.name)) out.push(def);
    if (out.length >= 3) break;
  }
  return out;
}

/** 单件素材的生效词条：先取数据袋 `data.词条`，空则回落注册表（内建/内容包） */
function effectiveEntries(item: Pick<InventoryItem, 'name' | 'data'>): MaterialEntryDef[] {
  const fromData = materialEntriesOf(item);
  if (fromData.length > 0) return fromData;
  const out: MaterialEntryDef[] = [];
  for (const n of entryNamesOfMaterial(item.name ?? '')) {
    const def = ENTRY_BY_NAME.get(n);
    if (def) out.push(def);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * 单件素材的**可见**生效词条（2026-10-02 D-1）：与 `aggregateMaterialEntries` 的结算
 * 入口（effectiveEntries）同源——数据袋有 `data.词条` 用之，否则回落名字映射。
 * 此前 UI 只读 `materialEntriesOf`（严格数据袋），「月光苔→灵光」等内建映射词条
 * 只在结算时生效、面板永不显示（看不见却生效）。UI 一律走本入口，别再分叉。
 */
export function visibleMaterialEntries(
  item: Pick<InventoryItem, 'name' | 'data'>,
): MaterialEntryDef[] {
  return effectiveEntries(item);
}

export interface MaterialEntryMods {
  /** 评级掷骰合计 ± */
  dc: number;
  /** 产物卡面战力合计 ± */
  power: number;
  /** 产物必得的元素词条（引韵类） */
  bonus词条: string[];
  /** 逐条审计/叙事行 */
  notes: string[];
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

/**
 * 聚合一次制卡的素材词条（纯函数）：主素材按「主位」、副素材按「副位」激活
 * 各自生效位的词条，「通用」恒生效。匹配优先级：同源元素 > 相生 > 相克 > 中性。
 */
export function aggregateMaterialEntries(
  inventory: readonly InventoryItem[],
  mainName: string,
  subNames: readonly string[],
): MaterialEntryMods {
  const mods: MaterialEntryMods = { dc: 0, power: 0, bonus词条: [], notes: [] };
  const collect = (item: InventoryItem | undefined, role: '主位' | '副位'): void => {
    if (!item) return;
    for (const def of effectiveEntries(item)) {
      if (def.slot !== '通用' && def.slot !== role) continue;
      if (def.dc) {
        mods.dc += def.dc;
        mods.notes.push(`【${item.name}】${def.name}：掷骰 ${signed(def.dc)}（${def.slot}）`);
      }
      if (def.power) {
        mods.power += def.power;
        mods.notes.push(
          `【${item.name}】${def.name}：产物战力 ${signed(def.power)}（${def.slot}）`,
        );
      }
      if (def.bonusElement) {
        const element = deriveElements(item)[0];
        if (element && !mods.bonus词条.includes(element)) {
          mods.bonus词条.push(element);
          mods.notes.push(`【${item.name}】${def.name}：产物必得「${element}」（${def.slot}）`);
        }
      }
    }
  };
  collect(
    inventory.find((i) => i.name === mainName),
    '主位',
  );
  for (const sub of subNames) {
    collect(
      inventory.find((i) => i.name === sub),
      '副位',
    );
  }
  return mods;
}

/**
 * 内建素材词条基线（对齐 BUILTIN_MATERIAL_ELEMENTS 先例：正典风味指派，内容包可覆写）。
 * 🔴 刻意避开测试夹具用的素材名（火晶/赤铁矿/风羽/寒水珠/止血草）——已钉死的
 *    评级断言不因本批而漂。
 */
export const BUILTIN_MATERIAL_ENTRIES: Readonly<Record<string, string[]>> = Object.freeze({
  月光苔: ['灵光'], // 泛冷光的苔——磨锐心神
  千年树心: ['浑成'], // 千年整材——浑然一体
  精灵花: ['引韵'], // 花头引元素之韵
  世界树嫩芽: ['凝萃'], // 嫩芽萃一线生机
  铜矿: ['残瑕'], // 粗矿带着旧伤般的杂纹
  水草: ['受潮'], // 泡在水里的草——湿气侵纹
  河蚌: ['杂质'], // 壳内常裹着泥沙
  沙粒: ['涩纹'], // 涩涩的粗纹磨手
});

// 模块加载即注册内建基线（包面数据随后可同名覆盖）
registerMaterialEntries(BUILTIN_MATERIAL_ENTRIES);
