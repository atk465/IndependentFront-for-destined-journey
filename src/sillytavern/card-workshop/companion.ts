/**
 * companion.ts — 伙伴实体（实体为主卡为媒；2026-10-02 伙伴实体化批①）
 *
 * 共识裁定（主人 2026-09-17 访谈 + 2026-10-02 实体化访谈 16 决议）：
 * - 池的形态：内容仓 cardPool 预写召唤卡目录（鎏金/星辉档，每张带 CompanionSeed），
 *   抽封铭卡高阶档可出、开局购卡不卖——伙伴要在故事里相遇。
 * - 诞生时机（D3 获得即诞生）：任何入口获得含「召唤」词条的卡（制卡/购卡/捕获/掉落）
 *   → 立即按卡名 ensure 实体（存在即跳过）；同名卡 ≤2 拷贝共享同一实体。
 *   打出才诞生的「首召实体化」退役为兼容兜底（skirmish-settlement 保留）。
 * - 休眠—唤醒（D4）：同名卡全部离手 → 实体沉眠（isCompanionDormant 纯派生，
 *   叙事出口 update_character {present:false}）；重新获得同名卡 → 唤醒续接（present:true），
 *   等级/忠诚/进化数据完整保留。
 * - 生成方式：**确定性**（种族/性情取卡种子，面板按 companion-panel §2.3 公式锚定，
 *   零 AI 零延迟）；叙事演出交给 story 自由发挥。
 * - 军团卡不个体化（群像，canon：一窝低阶铭灵的协同阵）。
 *
 * 全部纯函数；落库由调用方产 add_character/update_character patch 同窗提交。
 */

import type { CardItem, CharacterState, InventoryItem } from '../types';
import { CARD_TIERS, type CardTier } from '../field-enums';
import { cardKindOf } from './card-kind';
import { CARD_EXP_CAP } from './skirmish';
import { buildCompanionPanel } from './companion-panel';
import { buildCompanionTalent } from './companion-talent';
import type { CompanionSeed } from '../start-catalog-mechanics';

/** cardTier → 伙伴档位（0 起；决定 tier/tierName 的确定性推导基数） */
const TIER_INDEX: Record<CardTier, number> = {
  黑铁: 0,
  青铜: 1,
  白银: 2,
  鎏金: 3,
  星辉: 4,
};

/** 召唤卡判定（军团卡排除——群像不个体化） */
export function isSummonCard(card: Pick<CardItem, '词条'>): boolean {
  return cardKindOf(card.词条) === '召唤';
}

/** 首召判定：存档内还没有同名角色（获得即诞生的 ensure 条件） */
export function needsFirstSummon(cardName: string, existingNames: readonly string[]): boolean {
  return !existingNames.includes(cardName);
}

/** 伙伴扩展袋（customFields.companion）。读写仅经 companion.ts 门禁函数。 */
export interface CompanionBag {
  /** 出生品阶快照（进化仪式升档后同步更新） */
  bornTier: CardTier;
  /** 佩戴表（批④落码；批①只建袋留空对象） */
  equip: { hand?: string; body?: string; charm?: string };
  /** 进化进度（批⑤落码；批①只建袋留默认值） */
  evolution: {
    archetype?: '炽野' | '贯城' | '镜影';
    routeName?: string;
    routeDesc?: string;
    unlocked: boolean;
    offerings: string[];
  };
  /** 重伤标记（伙伴实体化 D6，批② B2.4：挡刀池打空→true；恢复走修复素材/叙事） */
  injured?: boolean;
}

/**
 * 伙伴扩展袋读门禁：缺袋（旧档实体）/形状非法返回 null，不抛。
 * 形状校验按建袋形状：bornTier 合法档位 + equip 对象 + evolution{unlocked:boolean, offerings:string[]}.
 *
 * 🔴 返回**去响应式深拷贝**（2026-10-02 CMP-02）：entity 常来自 Vue 响应式角色数组，
 * 原样返回的 bag 是 Proxy——调用方把它 spread 进 `update_character` 补丁后，
 * IndexedDB `put` 直接 `DataCloneError`（佩戴/定倾向/伤愈/仪式全灭的真机根因）。
 * 袋是纯 JSON 数据，深拷贝无损失；所有调用方只读+spread，无引用语义依赖。
 */
export function companionBagOf(entity: CharacterState): CompanionBag | null {
  const raw = (entity?.customFields as Record<string, unknown> | undefined)?.companion;
  if (typeof raw !== 'object' || raw === null) return null;
  const bag = raw as Partial<CompanionBag>;
  if (typeof bag.equip !== 'object' || bag.equip === null) return null;
  const ev = bag.evolution;
  if (typeof ev !== 'object' || ev === null) return null;
  if (typeof ev.unlocked !== 'boolean' || !Array.isArray(ev.offerings)) return null;
  if (!(CARD_TIERS as readonly string[]).includes(bag.bornTier as string)) return null;
  return JSON.parse(JSON.stringify(bag)) as CompanionBag;
}

/**
 * 休眠判定（D4，纯派生不存储）：玩家 inventory 中同名卡（type:'卡牌'）Σquantity 为 0
 * → 该伙伴实体沉眠。拆一张还有一张时不受影响（Σ>0）。
 */
export function isCompanionDormant(cardName: string, inventory: InventoryItem[]): boolean {
  const items = Array.isArray(inventory) ? inventory : [];
  const total = items
    .filter((i) => i?.type === '卡牌' && i.name === cardName)
    .reduce(
      (sum, i) => sum + (typeof i.quantity === 'number' && i.quantity > 0 ? i.quantity : 0),
      0,
    );
  return total === 0;
}

/** 目录占位配方判定：cardCatalogToItem 写 mainMaterial=卡名 + 0 副素材（素材项 0 口径） */
function isCatalogPlaceholderRecipe(card: Pick<CardItem, 'name' | 'recipe'>): boolean {
  const r = card.recipe;
  return !r || (r.mainMaterial === card.name && r.subMaterials.length === 0);
}

/**
 * desc 首句截 40 字（伙伴实体化 B3.5 的性格回落口径：<personality> 解析失败时用）。
 * 首句按 。！？\n 切分；无内容返回 undefined（调用方继续走既有兜底文案）。
 */
export function personalityFromDesc(desc: string | undefined): string | undefined {
  const first = String(desc ?? '')
    .split(/[。！？\n]/)
    .map((t) => t.trim())
    .find((t) => t.length > 0);
  const sliced = first?.slice(0, 40);
  return sliced && sliced.length > 0 ? sliced : undefined;
}

/**
 * 由召唤卡（+可选种子）确定性构造伙伴实体。
 *
 * - 名字 = 卡名（铁律1；好感共鸣 bondForCard 按同名查 affection，天然接通）
 * - 面板 = companion-panel §2.3 公式锚定（评级取 recipe.rating；目录入口/占位配方按
 *   '成功' + 素材项 0；真实配方素材品质读不到按 1/项）；level=1，expToNext=品阶管容
 * - 种族/性情优先取内容仓种子；缺省落「铭灵」通用口径（显世皆女性形貌）
 * - 性格（B3.5）：制卡叙事提取的 personalityOverride 优先（D3 性格从叙事派生），
 *   缺省回落种子/「铭灵」通用文案
 */
export function buildSummonCompanion(input: {
  card: Pick<CardItem, 'name' | 'cardTier' | '词条' | 'description' | 'recipe'>;
  seed?: CompanionSeed;
  saveId: string;
  playerName: string;
  location: string;
  /** 制卡叙事提取的性格（B3.5；缺省回落种子/通用文案） */
  personalityOverride?: string;
  /** AI 选定的伙伴天赋 kind（B4.6；池外/缺省按回落表） */
  talentKind?: string;
  /** AI 选定的天赋名（B4.6；≤12 字，缺省 `${品阶}·${kind}`） */
  talentName?: string;
}): CharacterState {
  const { card, seed } = input;
  const idx = TIER_INDEX[card.cardTier] ?? 0;

  // 面板段（§2.3）：评级取 recipe.rating（无 recipe/目录占位 → '成功'，素材项 0）
  const catalog = isCatalogPlaceholderRecipe(card);
  const rating = card.recipe?.rating ?? '成功';
  const materialTiers = catalog ? [] : [1, ...card.recipe.subMaterials.map(() => 1)]; // 素材品质读不到按 1/项
  const panel = buildCompanionPanel({
    cardTier: card.cardTier,
    rating,
    词条: card.词条,
    materialTiers,
  });
  // 伙伴天赋（B4.6）：AI 叙事选 kind（池白名单校验）/name；params 引擎按品阶定标
  const talent = buildCompanionTalent(card.cardTier, card.词条, input.talentKind, input.talentName);

  return {
    id: crypto.randomUUID(),
    saveId: input.saveId,
    type: 'summon',
    name: card.name,
    race: seed?.race ?? '铭灵',
    identity: ['召唤伙伴'],
    occupation: [],
    tier: idx + 1,
    tierName: ['普通', '中坚', '精英', '史诗', '传说'][idx] ?? '普通',
    level: 1,
    totalExp: 0,
    expToNext: CARD_EXP_CAP[card.cardTier] ?? CARD_EXP_CAP['黑铁'],
    attributes: panel.attributes,
    freeAttrPoints: 0,
    hp: panel.maxHp,
    maxHp: panel.maxHp,
    mp: panel.maxMp,
    maxMp: panel.maxMp,
    sp: panel.maxSp,
    maxSp: panel.maxSp,
    skills: [],
    inventory: [],
    statusEffects: [],
    money: 0,
    location: input.location,
    present: true,
    currentAction: '',
    bloodlineIds: [],
    gender: '女',
    personality:
      input.personalityOverride?.trim() || seed?.temperament || '像一段有了性情的文字，偏执而押韵',
    appearance: `铭灵显世的女性形貌，铭色随词条：${card.词条.join('、')}`,
    background: seed
      ? `由制卡师首召入库的${seed.race}铭灵，性情：${seed.temperament}`
      : '由制卡师首召入库的铭灵伙伴',
    talents: {
      capacity: 1,
      list: [
        {
          name: talent.name,
          source: 'universal',
          entries: [{ kind: talent.kind, channel: 'universal', params: { bonus: talent.params } }],
        },
      ],
    },
    customFields: {
      origin: 'summon_card',
      ownerName: input.playerName,
      companion: {
        bornTier: card.cardTier,
        equip: {},
        evolution: { unlocked: false, offerings: [] },
        injured: false,
      } satisfies CompanionBag,
    },
  };
}
