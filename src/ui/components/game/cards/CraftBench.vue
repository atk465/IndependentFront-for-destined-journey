<script setup lang="ts">
/**
 * CraftBench.vue — 制卡工作台（卡牌工坊 MVP，实时预览）
 *
 * 选素材时即时算出融合结果与造价 —— 全部走引擎 card-workshop 两个纯函数模块：
 * - material.ts：库存物品 → MaterialSpec（tier/估价/元素推导）
 * - card-fusion.ts：fuse() 确定性融合（叠加/相生/相克、词条、造价、预期评级）
 *
 * 本台**只做预览不做炼制**：实际炼制经由叙事流程（<craft_request> marker 协议，
 * Phase 3 接入委托结算），这里绝不绕开制作链直接造卡。素材元素标签可手动增删
 * —— 推导只是缺省，玩家对自己素材的元素认知优先（确定性内核吃标签，不吃叙事）。
 */
import { computed, reactive, ref, watch } from 'vue';
import { useGameStore } from '../../../stores/game-store';
import { cardTierVar } from '../../../lib/quality-colors';
import type { CardItem, InventoryItem } from '@engine/types';
import { fuse } from '@engine/card-workshop/card-fusion';
import {
  ELEMENT_KEYWORDS,
  deriveElements,
  planRarityUpgrade,
  toMaterial,
} from '@engine/card-workshop/material';
import type { MaterialSpec } from '@engine/card-workshop/card-fusion';
import { deriveFallbackProductName } from '@engine/card-craft-narrate';
import { REPAIR_RECIPE, isDamaged, planQuench, planRepair } from '@engine/card-workshop/repair';
import type { RepairPlan } from '@engine/card-workshop/repair';
import { cardKindOf } from '@engine/card-workshop/card-kind';
import { planDevour } from '@engine/card-workshop/card-devour';
import {
  CONTRACT_AFFECTION_THRESHOLD,
  isSmeltable,
  planContract,
  planMultiFusion,
  planSmelt,
} from '@engine/card-workshop/card-smelt';
import { planDismantle } from '@engine/card-workshop/card-dismantle';
import { EMOTIONS, type Emotion } from '@engine/card-workshop/emotion-material';
import { planAbyssContract, planReshape } from '@engine/card-workshop/card-smelt';
import { planCorruptCompanion, planOffspring } from '@engine/card-workshop/companion-capture';
import { peekMaterialEntries, planStripEntry } from '@engine/card-workshop/card-strip';
import {
  CONSORT_RANKS,
  planAffectionTribute,
  type ConsortRank,
} from '@engine/card-workshop/companion-growth';
import { entryStrength } from '@engine/card-workshop/talent-rule-modifiers';
import {
  TRAIN_DIRECTIONS,
  planTrain,
  type TrainDirection,
} from '@engine/card-workshop/craft-flow-hooks';
import { planFootAlchemy } from '@engine/card-workshop/partner-alchemy';
import { planCardCraft } from '@engine/card-workshop/card-craft-plan';
import { craftTierCeilingIndex } from '@engine/card-workshop/craft-rank';
import type { TalentEntry, TalentEntryKind } from '@engine/card-workshop/talent-entry';
import AppButton from '../../shared/AppButton.vue';

const game = useGameStore();
const player = computed(() => game.player);

/**
 * 强度档取值（2026-09-17 参数化）：与 game-store 的提交路径**同源**。
 * 预览走引擎纯函数、提交也走引擎纯函数——但两处必须传同一个档位值，
 * 否则玩家看到的预览会与实际执行结果不一致。
 */
function strengthOf(kind: TalentEntryKind, param: keyof TalentEntry['params']): number {
  return entryStrength(game.player?.talents?.list, kind, param);
}

/** 素材取「材料」类物品（卡牌成品不是素材） */
const materials = computed<InventoryItem[]>(() =>
  (player.value?.inventory ?? []).filter((i) => i.type === '材料'),
);

// ═══ 修复区（契约召唤 C' 制：损坏的卡可修复，双轨制——模板直修 + 额外素材强化）═══

const damagedCards = computed<CardItem[]>(() =>
  (player.value?.inventory ?? []).filter((i): i is CardItem => i.type === '卡牌' && isDamaged(i)),
);
const repairCardName = ref('');
const selectedMaterials = ref<string[]>([]);
const repairing = ref(false);
const repairError = ref('');

const repairTarget = computed(() =>
  damagedCards.value.find((c) => c.name === repairCardName.value),
);
const repairRecipe = computed(() =>
  repairTarget.value ? REPAIR_RECIPE[repairTarget.value.cardTier] : undefined,
);
const resolvedSelected = computed<InventoryItem[]>(() =>
  selectedMaterials.value
    .map((n) => (player.value?.inventory ?? []).find((i) => i.name === n))
    .filter((i): i is InventoryItem => !!i),
);
/** 选中的素材按顺序切分：先填满模板配额，其余作为额外强化素材 */
const repairSplit = computed(() => {
  const quota = repairRecipe.value?.materialCount ?? 0;
  return {
    template: resolvedSelected.value.slice(0, quota),
    extra: resolvedSelected.value.slice(quota),
  };
});
const repairValidation = computed(() => {
  if (!repairTarget.value || repairSplit.value.template.length === 0) return undefined;
  return planRepair(repairTarget.value, repairSplit.value.template, repairSplit.value.extra);
});
const repairPlan = computed<RepairPlan | undefined>(() => repairValidation.value?.plan);
const canRepair = computed(() => !!repairTarget.value && !!repairValidation.value?.ok);

function toggleMaterial(name: string) {
  const i = selectedMaterials.value.indexOf(name);
  if (i === -1) selectedMaterials.value.push(name);
  else selectedMaterials.value.splice(i, 1);
}

async function doRepair() {
  if (!repairCardName.value || !canRepair.value) return;
  repairing.value = true;
  repairError.value = '';
  const r = await game.repairCard(
    repairCardName.value,
    repairSplit.value.template.map((m) => m.name),
    repairSplit.value.extra.map((m) => m.name),
  );
  repairing.value = false;
  if (!r.ok) {
    repairError.value = r.reason ?? '修复失败';
    return;
  }
  selectedMaterials.value = [];
}

type SlotKey = 'main' | 'sub1' | 'sub2';
const selection = reactive<Record<SlotKey, string>>({ main: '', sub1: '', sub2: '' });
/** 元素标签的手动状态（选材变化时按推导重置） */
const elementChips = reactive<Record<SlotKey, string[]>>({ main: [], sub1: [], sub2: [] });

function itemOf(slot: SlotKey): InventoryItem | undefined {
  return materials.value.find((m) => m.name === selection[slot]);
}

function specOf(slot: SlotKey): MaterialSpec | undefined {
  const item = itemOf(slot);
  if (!item) return undefined;
  return { ...toMaterial(item), elements: elementChips[slot] };
}

const mainSpec = computed(() => specOf('main'));
const subSpecs = computed(() =>
  [specOf('sub1'), specOf('sub2')].filter((s): s is MaterialSpec => !!s),
);

const result = computed(() => (mainSpec.value ? fuse(mainSpec.value, subSpecs.value) : null));

/**
 * 点素材区的一件材料 → 填入**第一个空槽**（主素材优先）。
 * 三槽全满时替换主素材（最常见的意图：换掉主料重做）。
 */
function fillSlot(name: string) {
  if (!selection.main) {
    selection.main = name;
    return;
  }
  if (!selection.sub1) {
    selection.sub1 = name;
    return;
  }
  if (!selection.sub2) {
    selection.sub2 = name;
    return;
  }
  selection.main = name; // 三槽全满 → 换主料
}

/** 清空某一槽 */
function clearSlot(slot: SlotKey) {
  selection[slot] = '';
}

/** 某件材料当前被几个槽位占用（同名可占多槽 —— 消耗按份数扣） */
function slotUsage(name: string): number {
  return (['main', 'sub1', 'sub2'] as SlotKey[]).filter((k) => selection[k] === name).length;
}

// 换素材 → 该槽元素标签重置为推导缺省
for (const slot of Object.keys(selection) as SlotKey[]) {
  watch(
    () => selection[slot],
    () => {
      elementChips[slot] = itemOf(slot) ? deriveElements(itemOf(slot)!) : [];
    },
  );
}
// 材料列表就绪时给主素材一个缺省选位
watch(
  materials,
  (list) => {
    if (!selection.main && list.length > 0) selection.main = list[0].name;
  },
  { immediate: true },
);

function toggleElement(slot: SlotKey, e: string) {
  const chips = elementChips[slot];
  const i = chips.indexOf(e);
  if (i === -1) chips.push(e);
  else chips.splice(i, 1);
}

// ═══ 淬炼区（2026-09-16：健康卡 + 素材 → 词条强化/品质跃迁；复用修复内核）═══

/** 可淬炼的健康战斗卡（非素材类、未损坏；损坏的走修复区） */
const quenchableCards = computed<CardItem[]>(() =>
  (player.value?.inventory ?? []).filter(
    (i): i is CardItem =>
      i.type === '卡牌' && !isDamaged(i) && cardKindOf((i as CardItem).词条 ?? []) !== '素材',
  ),
);
const quenchCardName = ref('');
const quenchMaterialNames = ref<string[]>([]);
const quenching = ref(false);
const quenchError = ref('');
const quenchResult = ref('');

const quenchTarget = computed(() =>
  quenchableCards.value.find((c) => c.name === quenchCardName.value),
);
const quenchMaterials = computed<InventoryItem[]>(() =>
  quenchMaterialNames.value
    .map((n) => (player.value?.inventory ?? []).find((i) => i.name === n))
    .filter((i): i is InventoryItem => !!i),
);
const quenchValidation = computed(() => {
  if (!quenchTarget.value || quenchMaterialNames.value.length === 0) return undefined;
  return planQuench(quenchTarget.value, quenchMaterials.value);
});
const quenchPlan = computed(() => quenchValidation.value?.plan);

function toggleQuenchMaterial(name: string) {
  const i = quenchMaterialNames.value.indexOf(name);
  if (i === -1) quenchMaterialNames.value.push(name);
  else quenchMaterialNames.value.splice(i, 1);
}

async function doQuench() {
  if (!quenchCardName.value || !quenchValidation.value?.ok) return;
  quenching.value = true;
  quenchError.value = '';
  quenchResult.value = '';
  const r = await game.quenchCard(quenchCardName.value, [...quenchMaterialNames.value]);
  quenching.value = false;
  if (!r.ok) {
    quenchError.value = r.reason ?? '淬炼失败';
    return;
  }
  quenchResult.value = r.summary ?? '淬炼完成';
  quenchMaterialNames.value = [];
}

// ═══ 吞噬区（SSS「吞噬一切」门槛）：目标卡吞掉一张卡/素材 → 成长 + 吸收词条 ═══

/** 天赋门槛：持有含「吞噬」条目的天赋才显示本区 */
const canDevour = computed(() => game.hasMechanicGate('吞噬'));

const devourTarget = ref('');
const devourFuel = ref('');
const devouring = ref(false);
const devourMsg = ref('');
const devourErr = ref('');

/** 可选燃料：背包里除目标卡之外的卡牌与素材（材料） */
const devourFuels = computed<InventoryItem[]>(() =>
  (player.value?.inventory ?? []).filter(
    (i) => i.name !== devourTarget.value && (i.type === '卡牌' || i.type === '材料'),
  ),
);
const devourTargetCard = computed(() =>
  (player.value?.inventory ?? []).find(
    (i): i is CardItem => i.name === devourTarget.value && i.type === '卡牌',
  ),
);
const devourPreview = computed(() => {
  const t = devourTargetCard.value;
  const f = devourFuels.value.find((i) => i.name === devourFuel.value);
  if (!t || !f) return undefined;
  return planDevour(
    t,
    f,
    Math.random,
    craftTierCeilingIndex(game.player?.level, strengthOf('吞噬', 'levelBonus')),
  );
});

async function doDevour() {
  if (!devourTarget.value || !devourFuel.value) return;
  devouring.value = true;
  devourErr.value = '';
  devourMsg.value = '';
  const r = await game.devourCard(devourTarget.value, devourFuel.value);
  devouring.value = false;
  if (!r.ok) {
    devourErr.value = r.reason ?? '吞噬失败';
    return;
  }
  devourMsg.value = r.summary ?? '吞噬完成';
  devourFuel.value = '';
}

// ═══ 熔炼 / 缔约区（SSS「军团熔炉」门槛）═══

/** 天赋门槛：持有含「熔炼」条目的天赋才显示本区 */
const canSmelt = computed(() => game.hasMechanicGate('熔炼'));

const smeltSelected = ref<string[]>([]);
const smelting = ref(false);
const smeltMsg = ref('');
const smeltErr = ref('');

/** 可熔炼的伙伴卡（召唤卡、未损坏） */
const smeltables = computed<CardItem[]>(() =>
  (player.value?.inventory ?? []).filter(
    (i): i is CardItem => i.type === '卡牌' && isSmeltable(i as CardItem) && !isDamaged(i),
  ),
);
const smeltPreview = computed(() => {
  const src = smeltSelected.value
    .map((n) => smeltables.value.find((c) => c.name === n))
    .filter((c): c is CardItem => !!c);
  if (src.length < 2) return undefined;
  return planSmelt(src, strengthOf('熔炼', 'tierGain'));
});
function toggleSmelt(name: string) {
  const i = smeltSelected.value.indexOf(name);
  if (i === -1) smeltSelected.value.push(name);
  else smeltSelected.value.splice(i, 1);
}
async function doSmelt() {
  if (smeltSelected.value.length < 2) return;
  smelting.value = true;
  smeltErr.value = '';
  smeltMsg.value = '';
  const r = await game.smeltCards([...smeltSelected.value]);
  smelting.value = false;
  if (!r.ok) {
    smeltErr.value = r.reason ?? '熔炼失败';
    return;
  }
  smeltMsg.value = r.summary ?? '熔炼完成';
  smeltSelected.value = [];
}

/** 缔约：好感 ≥70 的伙伴卡 */
const contractTarget = ref('');
const contracting = ref(false);
const contractMsg = ref('');
const contractErr = ref('');
const contractPreview = computed(() => {
  const c = smeltables.value.find((x) => x.name === contractTarget.value);
  if (!c) return undefined;
  const affection = game.saveProfile?.affections?.[c.name];
  return planContract(c, affection, strengthOf('熔炼', 'threshold'));
});
async function doContract() {
  if (!contractTarget.value) return;
  contracting.value = true;
  contractErr.value = '';
  contractMsg.value = '';
  const r = await game.contractCard(contractTarget.value);
  contracting.value = false;
  if (!r.ok) {
    contractErr.value = r.reason ?? '缔约失败';
    return;
  }
  contractMsg.value = r.summary ?? '缔约完成';
}

// ═══ 拆解区（SSS「素材之王」非战斗侧）═══

const canDismantle = computed(() => game.hasMechanicGate('拆解'));
const dismantleTarget = ref('');
const dismantling = ref(false);
const dismantleMsg = ref('');
const dismantleErr = ref('');

/** 可拆解物品：背包里除材料外的一切（材料不可再拆） */
const dismantlables = computed<InventoryItem[]>(() =>
  (player.value?.inventory ?? []).filter((i) => i.type !== '材料'),
);
const dismantlePreview = computed(() => {
  const item = dismantlables.value.find((i) => i.name === dismantleTarget.value);
  if (!item) return undefined;
  return planDismantle(
    item,
    craftTierCeilingIndex(game.player?.level, strengthOf('拆解', 'levelBonus')),
  );
});

async function doDismantle() {
  if (!dismantleTarget.value) return;
  dismantling.value = true;
  dismantleErr.value = '';
  dismantleMsg.value = '';
  const r = await game.dismantleItem(dismantleTarget.value);
  dismantling.value = false;
  if (!r.ok) {
    dismantleErr.value = r.reason ?? '拆解失败';
    return;
  }
  dismantleMsg.value = r.summary ?? '拆解完成';
  dismantleTarget.value = '';
}

// ═══ 多卡融合区（SSS「万物归一」）═══

const canFuse = computed(() => game.hasMechanicGate('融合'));
const fuseSelected = ref<string[]>([]);
const fusing = ref(false);
const fuseMsg = ref('');
const fuseErr = ref('');

/** 可融合的卡（全部卡牌、未损坏） */
const fusables = computed<CardItem[]>(() =>
  (player.value?.inventory ?? []).filter((i): i is CardItem => i.type === '卡牌' && !isDamaged(i)),
);
const fusePreview = computed(() => {
  const src = fuseSelected.value
    .map((n) => fusables.value.find((c) => c.name === n))
    .filter((c): c is CardItem => !!c);
  if (src.length !== 3) return undefined;
  return planMultiFusion(
    src,
    Math.random,
    strengthOf('融合', 'tierGain'),
    craftTierCeilingIndex(game.player?.level, strengthOf('融合', 'levelBonus')),
  );
});
function toggleFuse(name: string) {
  const i = fuseSelected.value.indexOf(name);
  if (i === -1) {
    if (fuseSelected.value.length >= 3) return; // 恰好 3 张
    fuseSelected.value.push(name);
  } else {
    fuseSelected.value.splice(i, 1);
  }
}
async function doFuse() {
  if (fuseSelected.value.length !== 3) return;
  fusing.value = true;
  fuseErr.value = '';
  fuseMsg.value = '';
  const r = await game.fuseCards([...fuseSelected.value]);
  fusing.value = false;
  if (!r.ok) {
    fuseErr.value = r.reason ?? '融合失败';
    return;
  }
  fuseMsg.value = r.summary ?? '融合完成';
  fuseSelected.value = [];
}

// ═══ 情绪素材区（SSS「七宗罪之主」）═══

const canExtractEmotion = computed(() => game.hasMechanicGate('情绪素材'));
const EMOTION_LIST = EMOTIONS;
const extractingEmotion = ref<Emotion | ''>('');
const emotionMsg = ref('');
const emotionErr = ref('');

async function doExtractEmotion(e: Emotion) {
  extractingEmotion.value = e;
  emotionErr.value = '';
  emotionMsg.value = '';
  const r = await game.extractEmotion(e);
  extractingEmotion.value = '';
  if (!r.ok) {
    emotionErr.value = r.reason ?? '提取失败';
    return;
  }
  emotionMsg.value = r.summary ?? '提取完成';
}

// ═══ 深渊契约区（SSS「深渊领主」）═══

const canAbyss = computed(() => game.hasMechanicGate('深渊契约'));
const abyssTarget = ref('');
const abyssMsg = ref('');
const abyssErr = ref('');
const abyssPreview = computed(() => {
  const c = smeltables.value.find((x) => x.name === abyssTarget.value);
  if (!c) return undefined;
  return planAbyssContract(c, strengthOf('深渊契约', 'percent'));
});
async function doAbyss() {
  if (!abyssTarget.value) return;
  abyssErr.value = '';
  abyssMsg.value = '';
  const r = await game.abyssContract(abyssTarget.value);
  if (!r.ok) {
    abyssErr.value = r.reason ?? '契约失败';
    return;
  }
  abyssMsg.value = r.summary ?? '深渊契约已缔结';
}

// ═══ 制卡区（主路：Code 算完 → AI 只写叙事与命名，2026-09-17 第三档）═══
//
// 与「AI 对话里说我要做张卡」那条路的分工：这里玩家**亲手选素材、亲手写下想做成
// 什么样**，档位/词条/造价/评级/消耗/经验全部由 Code 当场算完（预览就可见），
// AI 只负责给卡起名和把过程写成一段话。
const craftMain = ref('');
const craftSubA = ref('');
const craftSubB = ref('');
const craftIntent = ref('');
const craftBlueprint = ref('');
const crafting = ref(false);
const craftMsg = ref('');
const craftErr = ref('');
/**
 * 只有真正在制才禁用按钮；「没选主素材 / 副素材与主素材相同」走点击校验给提示
 * （2026-09-23 真机反馈：禁用态视觉不明显，点了没反应像坏了）。
 */
const craftCard_busy = computed(() => crafting.value);
/** 手上的技能蓝本（S「支配者倒影」） */
const blueprints = computed(() => game.skillBlueprints());

/** 预览：与落库同源（planCardCraft 是纯函数，这里先看「会做出什么档次的东西」） */
const craftPreview = computed(() => {
  const inv = player.value?.inventory ?? [];
  if (!craftMain.value) return undefined;
  return planCardCraft({
    mainName: craftMain.value,
    subNames: [craftSubA.value, craftSubB.value].filter((s) => s && s !== craftMain.value),
    intent: craftIntent.value,
    inventory: inv,
    d20: 10, // 预览用中位数骰，实际掷骰在提交时
    fallbackName: deriveFallbackProductName(craftIntent.value) ?? `${craftMain.value}·卡`,
    talents: [],
    lift: {},
    ...(craftBlueprint.value ? { blueprint: { name: craftBlueprint.value } } : {}),
  });
});

async function doCraftCard() {
  if (crafting.value) return;
  if (!craftMain.value) {
    craftErr.value = '先在上方选一件主素材，再开始制卡。';
    return;
  }
  if (craftMain.value === craftSubA.value) {
    craftErr.value = '副素材甲与主素材相同——换一件，或把它清空。';
    return;
  }
  crafting.value = true;
  craftErr.value = '';
  craftMsg.value = '';
  const r = await game.craftCard({
    mainName: craftMain.value,
    subNames: [craftSubA.value, craftSubB.value].filter((s) => s && s !== craftMain.value),
    intent: craftIntent.value,
    ...(craftBlueprint.value ? { blueprintName: craftBlueprint.value } : {}),
  });
  crafting.value = false;
  if (!r.ok) {
    craftErr.value = r.reason ?? '制卡失败';
    return;
  }
  craftMsg.value =
    `【${r.productName}】${r.tier}／${r.rating}（造价 ${r.cost} GC，经验 +${r.exp}）` +
    (r.namedBy === 'fallback' && craftIntent.value.trim() ? '（AI 命名未生效，暂用此名）' : '');
  craftMain.value = '';
  craftSubA.value = '';
  craftSubB.value = '';
  craftIntent.value = '';
  craftBlueprint.value = '';
}

// ═══ 足之炼金术区（`炼金` 条目：S「足之炼金术」）═══
const canAlchemy = computed(() => game.hasMechanicGate('炼金'));
const alchemyPartner = ref('');
const alchemyMaterial = ref('');
const alchemyMsg = ref('');
const alchemyErr = ref('');
const alchemyPreview = computed(() => {
  const p = smeltables.value.find((c) => c.name === alchemyPartner.value);
  const m = materials.value.find((x) => x.name === alchemyMaterial.value);
  if (!p || !m) return undefined;
  return planFootAlchemy(p, m, 3);
});
async function doAlchemy() {
  if (!alchemyPartner.value || !alchemyMaterial.value) return;
  alchemyErr.value = '';
  alchemyMsg.value = '';
  const r = await game.footAlchemy(alchemyPartner.value, alchemyMaterial.value);
  if (!r.ok) {
    alchemyErr.value = r.reason ?? '炼金失败';
    return;
  }
  alchemyMsg.value = r.summary ?? '炼成';
  alchemyMaterial.value = '';
}

// ═══ 打脸点数（`打脸` 条目：S「打脸升级系统」）═══
const canSlap = computed(() => game.hasMechanicGate('打脸'));
const slapPoints = computed(() => (canSlap.value ? game.faceSlapPoints() : 0));
const nemesis = computed(() => game.currentNemesis());
const slapBusy = ref(false);
const slapMsg = ref('');
const slapErr = ref('');
async function doRedeemSlap() {
  slapBusy.value = true;
  slapErr.value = '';
  slapMsg.value = '';
  const r = await game.redeemFaceSlap();
  slapBusy.value = false;
  if (!r.ok) {
    slapErr.value = r.reason ?? '兑换失败';
    return;
  }
  slapMsg.value = r.summary ?? '兑换完成';
}

// ═══ 调教区（`调教` 条目：S「调教大师系统」）═══
const canTrain = computed(() => game.hasMechanicGate('调教'));
const trainTarget = ref('');
const trainDirection = ref<TrainDirection>('忠犬');
const trainMsg = ref('');
const trainErr = ref('');
const misfortunes = computed(() => (game.hasMechanicGate('赌运') ? game.misfortuneLayers() : 0));
/** 已调教到顶的伙伴不再列出（planTrain 会拒，这里提前过滤免得点了报错） */
const trainables = computed(() => smeltables.value.filter((c) => planTrain(c, '忠犬', 99).ok));
async function doTrain() {
  if (!trainTarget.value) return;
  trainErr.value = '';
  trainMsg.value = '';
  const r = await game.trainCompanion(trainTarget.value, trainDirection.value);
  if (!r.ok) {
    trainErr.value = r.reason ?? '调教失败';
    return;
  }
  trainMsg.value = r.summary ?? '调教完成';
}

// ═══ 时间回溯预付（`回溯` 条目：S「时间回溯」）═══
const canRewind = computed(() => game.hasMechanicGate('回溯'));
const rewindArmed = computed(() => (canRewind.value ? game.pendingRewind() : false));
const rewindBusy = ref(false);
const rewindMsg = ref('');
const rewindErr = ref('');
async function toggleRewind(use: boolean) {
  rewindBusy.value = true;
  rewindErr.value = '';
  rewindMsg.value = '';
  const r = await game.setPendingRewind(use);
  rewindBusy.value = false;
  if (!r.ok) {
    rewindErr.value = r.reason ?? '操作失败';
    return;
  }
  rewindMsg.value = use ? '下一次制卡若失败，将回溯重裁一次（扣精神力）' : '已取消回溯';
}

// ═══ 双生羁绊区（`羁绊` 条目：S「双生羁绊」）═══
const canBind = computed(() => game.hasMechanicGate('羁绊'));
const bindA = ref('');
const bindB = ref('');
const bindMsg = ref('');
const bindErr = ref('');
/** 已有的羁绊文案（面板展示） */
const bondList = computed(() => game.twinBonds().map((p) => `${p.a} ⇄ ${p.b}`));
async function doBind() {
  bindErr.value = '';
  bindMsg.value = '';
  const r = await game.bindTwins(bindA.value, bindB.value);
  if (!r.ok) {
    bindErr.value = r.reason ?? '缔结失败';
    return;
  }
  bindMsg.value = r.summary ?? '羁绊已缔结';
  bindA.value = '';
  bindB.value = '';
}

// ═══ 身后灵区（`成灵` 条目：S「瓦尔哈拉的门票」）═══
const canSpirit = computed(() => game.hasMechanicGate('成灵'));
const spiritTarget = ref('');
const spiritMsg = ref('');
const spiritErr = ref('');
const spiritList = computed(() => game.behindSpirits());
async function doSpirit() {
  if (!spiritTarget.value) return;
  spiritErr.value = '';
  spiritMsg.value = '';
  const r = await game.makeSpirit(spiritTarget.value);
  if (!r.ok) {
    spiritErr.value = r.reason ?? '成灵失败';
    return;
  }
  spiritMsg.value = r.summary ?? '她已在你身后';
  spiritTarget.value = '';
}

// ═══ 不等价交换区（`置换` 条目：S「不等价交换」）═══
const canExchange = computed(() => game.hasMechanicGate('置换'));
const exchangeTarget = ref('');
const exchangeMsg = ref('');
const exchangeErr = ref('');
/** 可置换的：素材 + 卡牌（装备/道具不在描述范围内） */
const exchangeables = computed<InventoryItem[]>(() =>
  (player.value?.inventory ?? []).filter((i) => i.type === '材料' || i.type === '卡牌'),
);
async function doExchange() {
  if (!exchangeTarget.value) return;
  exchangeErr.value = '';
  exchangeMsg.value = '';
  const r = await game.exchangeItem(exchangeTarget.value);
  if (!r.ok) {
    exchangeErr.value = r.reason ?? '置换失败';
    return;
  }
  exchangeMsg.value = r.summary ?? '置换完成';
  exchangeTarget.value = '';
}

// ═══ 败犬烙印区（`烙印` 条目：SS「败犬烙印」；累计计数）═══
//
// 制卡由叙事驱动（AI 在正文里出制卡意图），玩家无法在那一刻点按钮——
// 所以这里是**预付开关**：勾上之后，下一次制卡自动扣一枚烙印并把评级上浮两档。
const canScar = computed(() => game.hasMechanicGate('烙印'));
const scarLeft = computed(() => (canScar.value ? game.scarCount() : 0));
const scarPending = computed(() => (canScar.value ? game.pendingScar() : false));
const scarBusy = ref(false);
const scarMsg = ref('');
const scarErr = ref('');

async function toggleScar(use: boolean) {
  scarBusy.value = true;
  scarErr.value = '';
  scarMsg.value = '';
  const r = await game.setPendingScar(use);
  scarBusy.value = false;
  if (!r.ok) {
    scarErr.value = r.reason ?? '操作失败';
    return;
  }
  scarMsg.value = use ? '下一次制卡将烧掉一枚烙印（评级上浮两档）' : '已取消预付';
}

// ═══ 素材点金区（`点金` 条目：S「素材点金」；每日账本的首个消费者）═══

const canPointGold = computed(() => game.hasMechanicGate('点金'));
/** 今日剩余次数（跨天自动恢复；账本在 store 里读 saveProfile.worldFlags.dailyUses） */
const pointGoldLeft = computed(() => (canPointGold.value ? game.dailyRemaining('素材点金', 1) : 0));
const pointGoldTarget = ref('');
const pointGoldMsg = ref('');
const pointGoldErr = ref('');
/** 可点金的素材：材料类且未到顶（「唯一」品质点不动） */
const pointables = computed<InventoryItem[]>(() =>
  materials.value.filter((m) => planRarityUpgrade(m, 1).ok),
);
const pointGoldPreview = computed(() => {
  const m = pointables.value.find((x) => x.name === pointGoldTarget.value);
  if (!m) return undefined;
  return planRarityUpgrade(m, 1);
});
async function doPointGold() {
  if (!pointGoldTarget.value) return;
  pointGoldErr.value = '';
  pointGoldMsg.value = '';
  const r = await game.upgradeMaterial(pointGoldTarget.value);
  if (!r.ok) {
    pointGoldErr.value = r.reason ?? '点金失败';
    return;
  }
  pointGoldMsg.value = r.summary ?? '点金完成';
  pointGoldTarget.value = '';
}

// ═══ 形态改造区（`改造` 条目：SSS「突变巫师」/ SS「画师」）═══

const canReshape = computed(() => game.hasMechanicGate('改造'));
const RESHAPE_SERIES = ['猫娘', '龙娘', '赛马娘', '泰坦', '塞壬', '菌娘', '树妖'] as const;
const reshapeTarget = ref('');
const reshapeSeries = ref<string>(RESHAPE_SERIES[0]);
const reshapeMsg = ref('');
const reshapeErr = ref('');
const reshapePreview = computed(() => {
  const c = fusables.value.find((x) => x.name === reshapeTarget.value);
  if (!c) return undefined;
  return planReshape(c, reshapeSeries.value);
});
async function doReshape() {
  if (!reshapeTarget.value) return;
  reshapeErr.value = '';
  reshapeMsg.value = '';
  const r = await game.reshapeCard(reshapeTarget.value, reshapeSeries.value);
  if (!r.ok) {
    reshapeErr.value = r.reason ?? '改造失败';
    return;
  }
  reshapeMsg.value = r.summary ?? '改造完成';
}

// ═══ 孕育区（SSS「种付支配」/「神孕之屌」）═══

const canBreed = computed(() => game.hasMechanicGate('孕育'));
const breedMother = ref('');
const breedFather = ref('');
const breedMsg = ref('');
const breedErr = ref('');
const breedPreview = computed(() => {
  const m = smeltables.value.find((c) => c.name === breedMother.value);
  const f = smeltables.value.find((c) => c.name === breedFather.value);
  if (!m || !f) return undefined;
  return planOffspring(m, f);
});
async function doBreed() {
  if (!breedMother.value || !breedFather.value) return;
  breedErr.value = '';
  breedMsg.value = '';
  const r = await game.breedCompanions(breedMother.value, breedFather.value);
  if (!r.ok) {
    breedErr.value = r.reason ?? '孕育失败';
    return;
  }
  breedMsg.value = r.summary ?? '子嗣诞生';
}

// ═══ 转化区（SSS「变肉便器吧」）═══

const canCorrupt = computed(() => game.hasMechanicGate('转化'));
const corruptTarget = ref('');
const corruptMsg = ref('');
const corruptErr = ref('');
const corruptPreview = computed(() => {
  const c = smeltables.value.find((x) => x.name === corruptTarget.value);
  if (!c) return undefined;
  return planCorruptCompanion(c);
});
async function doCorrupt() {
  if (!corruptTarget.value) return;
  corruptErr.value = '';
  corruptMsg.value = '';
  const r = await game.corruptCompanion(corruptTarget.value);
  if (!r.ok) {
    corruptErr.value = r.reason ?? '转化失败';
    return;
  }
  corruptMsg.value = r.summary ?? '转化完成';
  corruptTarget.value = '';
}

// ═══ 词条剥离区（SSS「词条之王」）═══

const canStrip = computed(() => game.hasMechanicGate('剥离'));
const stripTarget = ref('');
const stripEntryName = ref('');
const stripMsg = ref('');
const stripErr = ref('');
const stripTargetCard = computed(() => fusables.value.find((c) => c.name === stripTarget.value));
const stripCandidates = computed(() => (stripTargetCard.value?.词条 ?? []).filter((w) => !!w));
const stripPreview = computed(() => {
  const c = stripTargetCard.value;
  if (!c || !stripEntryName.value) return undefined;
  return planStripEntry(c, stripEntryName.value);
});
async function doStrip() {
  if (!stripTarget.value || !stripEntryName.value) return;
  stripErr.value = '';
  stripMsg.value = '';
  const r = await game.stripEntry(stripTarget.value, stripEntryName.value);
  if (!r.ok) {
    stripErr.value = r.reason ?? '剥离失败';
    return;
  }
  stripMsg.value = r.summary ?? '剥离完成';
  stripEntryName.value = '';
}

/** 素材透视（词条之王的「看到隐藏词条」）：只读展示背包素材的可推导词条 */
const materialPeek = computed(() =>
  materials.value.slice(0, 12).map((m) => ({
    name: m.name,
    entries: peekMaterialEntries(m as { name?: string; effects?: Record<string, unknown> }),
  })),
);

// ═══ 伙伴进阶区（最终兵器／结缘／位份）═══

const canAdvance = computed(
  () =>
    game.hasMechanicGate('自我进化') ||
    game.hasMechanicGate('结缘') ||
    game.hasMechanicGate('位份'),
);
const advanceTarget = ref('');
const advanceRank = ref<ConsortRank>(CONSORT_RANKS[1]);
const advanceMsg = ref('');
const advanceErr = ref('');
const advanceCard = computed(() => smeltables.value.find((c) => c.name === advanceTarget.value));
const tributePreview = computed(() => {
  const c = advanceCard.value;
  if (!c) return undefined;
  return planAffectionTribute(
    c,
    game.saveProfile?.affections?.[c.name],
    strengthOf('结缘', 'threshold'),
  );
});
async function doFinalWeapon() {
  if (!advanceTarget.value) return;
  advanceErr.value = '';
  advanceMsg.value = '';
  const r = await game.designateFinalWeapon(advanceTarget.value);
  if (!r.ok) {
    advanceErr.value = r.reason ?? '操作失败';
    return;
  }
  advanceMsg.value = r.summary ?? '已立为最终兵器';
}
async function doTribute() {
  if (!advanceTarget.value) return;
  advanceErr.value = '';
  advanceMsg.value = '';
  const r = await game.bondTribute(advanceTarget.value);
  if (!r.ok) {
    advanceErr.value = r.reason ?? '结缘失败';
    return;
  }
  advanceMsg.value = r.summary ?? '结缘完成';
}
async function doEnthrone() {
  if (!advanceTarget.value) return;
  advanceErr.value = '';
  advanceMsg.value = '';
  const r = await game.enthroneCard(advanceTarget.value, advanceRank.value);
  if (!r.ok) {
    advanceErr.value = r.reason ?? '册封失败';
    return;
  }
  advanceMsg.value = r.summary ?? '册封完成';
}

const KIND_LABEL: Record<string, string> = { 叠加: '同类叠加', 相生: '相生复合', 相克: '相克不稳' };
const RATING_HINT: Record<string, string> = {
  大失败: '灾祸难挡',
  失败: '凶多吉少',
  成功: '稳中向好',
  精益求精: '灵光乍现',
};
</script>

<template>
  <div class="craft-bench">
    <div v-if="materials.length === 0" class="empty-tab">
      背包里还没有可用的素材（材料）——素材来自冒险掉落、店铺采买与委托奖励。
    </div>

    <div v-else class="bench-columns">
      <!-- 素材选择 -->
      <section class="bench-col slots-col" aria-label="素材">
        <h4 class="d-label">素材（1 主 + 0~2 副）</h4>

        <div class="slot-card" :class="{ 'slot-filled': !!selection.main }">
          <div class="slot-head">
            <span class="slot-role">主素材</span>
            <span v-if="mainSpec" class="slot-price">估价 {{ mainSpec.price }} GC</span>
            <button
              v-if="selection.main"
              type="button"
              class="slot-clear"
              title="清空这一槽"
              @click="clearSlot('main')"
            >
              ×
            </button>
          </div>
          <div v-if="selection.main" class="slot-value">{{ selection.main }}</div>
          <div v-else class="slot-empty">点下方素材填入</div>
          <div v-if="selection.main" class="chip-row">
            <button
              v-for="e in ELEMENT_KEYWORDS"
              :key="e"
              type="button"
              class="chip toggle"
              :class="{ on: elementChips.main.includes(e) }"
              @click="toggleElement('main', e)"
            >
              {{ e }}
            </button>
          </div>
        </div>

        <div
          v-for="slot in ['sub1', 'sub2'] as const"
          :key="slot"
          class="slot-card"
          :class="{ 'slot-filled': !!selection[slot] }"
        >
          <div class="slot-head">
            <span class="slot-role">副素材 {{ slot === 'sub1' ? '一' : '二' }}</span>
            <span v-if="specOf(slot)" class="slot-price">估价 {{ specOf(slot)!.price }} GC</span>
            <button
              v-if="selection[slot]"
              type="button"
              class="slot-clear"
              title="清空这一槽"
              @click="clearSlot(slot)"
            >
              ×
            </button>
          </div>
          <div v-if="selection[slot]" class="slot-value">{{ selection[slot] }}</div>
          <div v-else class="slot-empty">（不用）</div>
          <div v-if="selection[slot]" class="chip-row">
            <button
              v-for="e in ELEMENT_KEYWORDS"
              :key="e"
              type="button"
              class="chip toggle"
              :class="{ on: elementChips[slot].includes(e) }"
              @click="toggleElement(slot, e)"
            >
              {{ e }}
            </button>
          </div>
        </div>

        <!-- 背包素材区：点一下填入空槽（2026-09-18 UI 改造） -->
        <div class="material-pool">
          <h5 class="pool-title">背包素材 <span class="pool-hint">点一下填入空槽</span></h5>
          <div class="pool-list">
            <button
              v-for="m in materials"
              :key="m.name"
              type="button"
              class="pool-item"
              :class="{ used: slotUsage(m.name) > 0 }"
              @click="fillSlot(m.name)"
            >
              <i class="fa-solid fa-cube pool-icon" />
              <span class="pool-name">{{ m.name }}</span>
              <span class="pool-qty">×{{ m.quantity ?? 1 }}</span>
              <span v-if="slotUsage(m.name) > 0" class="pool-used"
                >已选{{ slotUsage(m.name) }}</span
              >
            </button>
          </div>
        </div>
      </section>

      <!-- 实时预览 -->
      <section class="bench-col preview-col" aria-label="融合预览">
        <h4 class="d-label">融合预览</h4>
        <div v-if="!result" class="empty-tab">选好主素材就能看见成卡…</div>
        <div v-else class="preview-card">
          <div class="preview-head">
            <span class="kind-badge" :class="{ clash: result.fusionKind === '相克' }">
              {{ KIND_LABEL[result.fusionKind] }}
            </span>
            <span class="tier-name" :style="{ color: cardTierVar(result.tier) }">{{
              result.tier
            }}</span>
            <span class="tier-badge">卡牌品质</span>
          </div>

          <p v-if="result.fusionKind === '相克'" class="clash-warn" role="alert">
            相克之材并不安稳：造价七折，启封时封印物更易抗命。
          </p>

          <div class="detail-section">
            <h5 class="d-label">词条</h5>
            <div v-if="result.词条.length" class="chip-row">
              <span v-for="w in result.词条" :key="w" class="chip">{{ w }}</span>
            </div>
            <div v-else class="empty-tab small">无词条</div>
          </div>

          <div class="detail-section">
            <h5 class="d-label">结算</h5>
            <div class="kv-grid">
              <div class="kv-row">
                <span class="k">造价</span>
                <span class="v">{{ result.cost }} GC（估价）</span>
              </div>
              <div class="kv-row">
                <span class="k">预期评级</span>
                <span class="v">{{ result.rating }} · {{ RATING_HINT[result.rating] }}</span>
              </div>
              <div class="kv-row">
                <span class="k">副素材</span>
                <span class="v">{{
                  result.subMaterials.length ? result.subMaterials.join('、') : '无'
                }}</span>
              </div>
            </div>
          </div>

          <p class="bench-note">
            实际炼制经由叙事流程（制卡委托）结算；本台只做确定性预览，不作数。
          </p>
        </div>
      </section>
    </div>

    <!-- 吞噬区（SSS「吞噬一切」门槛，2026-09-17） -->
    <section v-if="canDevour" class="repair-section" aria-label="卡牌吞噬">
      <h4 class="d-label">吞噬（天赋：吞噬一切）</h4>
      <div v-if="materials.length === 0 && devourFuels.length === 0" class="empty-tab small">
        背包里没有可作为燃料的卡或素材…
      </div>
      <div v-else class="slot-card">
        <div class="slot-head">
          <select v-model="devourTarget" class="slot-select" aria-label="选择目标卡">
            <option value="" disabled>选择要成长的目标卡…</option>
            <option
              v-for="c in (player?.inventory ?? []).filter((i) => i.type === '卡牌')"
              :key="c.name"
              :value="c.name"
            >
              {{ c.name }}（{{ (c as CardItem).cardTier }}）
            </option>
          </select>
        </div>
        <div class="slot-head">
          <select v-model="devourFuel" class="slot-select" aria-label="选择燃料">
            <option value="" disabled>选择燃料（卡牌 / 素材）…</option>
            <option v-for="f in devourFuels" :key="f.name" :value="f.name">
              {{ f.name }}（{{ f.type }}）
            </option>
          </select>
        </div>
        <div v-if="devourPreview?.plan" class="kv-grid">
          <div class="kv-row">
            <span class="k">战力跃升</span>
            <span class="v">+{{ devourPreview.plan.powerUps }}</span>
          </div>
          <div class="kv-row">
            <span class="k">吸收词条</span>
            <span class="v">{{ devourPreview.plan.absorbedEntry ?? '（无可用词条）' }}</span>
          </div>
        </div>
        <p v-if="devourPreview && !devourPreview.ok" class="clash-warn" role="alert">
          {{ devourPreview.reason }}
        </p>
        <p v-if="devourMsg" class="bench-note">{{ devourMsg }}</p>
        <p v-if="devourErr" class="clash-warn" role="alert">{{ devourErr }}</p>
        <AppButton
          size="sm"
          variant="primary"
          :disabled="!devourPreview?.ok || devouring"
          :loading="devouring"
          @click="doDevour"
        >
          吞噬
        </AppButton>
      </div>
    </section>

    <!-- 拆解区（SSS「素材之王」非战斗侧，2026-09-17） -->
    <section v-if="canDismantle" class="repair-section" aria-label="素材拆解">
      <h4 class="d-label">拆解（天赋：素材之王）</h4>
      <div v-if="dismantlables.length === 0" class="empty-tab small">背包里没有可拆解的物品…</div>
      <div v-else class="slot-card">
        <div class="slot-head">
          <select v-model="dismantleTarget" class="slot-select" aria-label="选择拆解对象">
            <option value="" disabled>选择要拆解的物品…</option>
            <option v-for="i in dismantlables" :key="i.name" :value="i.name">
              {{ i.name }}（{{ i.type }}）
            </option>
          </select>
        </div>
        <div v-if="dismantlePreview?.plan" class="kv-grid">
          <div class="kv-row">
            <span class="k">产出素材</span>
            <span class="v">{{
              dismantlePreview.plan.yields.map((y) => `${y.name}×${y.quantity}`).join('、')
            }}</span>
          </div>
        </div>
        <p v-if="dismantlePreview && !dismantlePreview.ok" class="clash-warn" role="alert">
          {{ dismantlePreview.reason }}
        </p>
        <p v-if="dismantleMsg" class="bench-note">{{ dismantleMsg }}</p>
        <p v-if="dismantleErr" class="clash-warn" role="alert">{{ dismantleErr }}</p>
        <AppButton
          size="sm"
          variant="primary"
          :disabled="!dismantlePreview?.ok || dismantling"
          :loading="dismantling"
          @click="doDismantle"
        >
          拆解
        </AppButton>
      </div>
    </section>

    <!-- 多卡融合区（SSS「万物归一」门槛，2026-09-17） -->
    <section v-if="canFuse" class="repair-section" aria-label="多卡融合">
      <h4 class="d-label">多卡融合（天赋：万物归一）</h4>
      <div v-if="fusables.length < 3" class="empty-tab small">需要至少 3 张卡牌才能融合…</div>
      <div v-else class="slot-card">
        <div class="slot-price">
          点选恰好 3 张卡（任意类型）→ 产出全新卡：档位 +1，各源取一词条 + 随机专属词条。
        </div>
        <div class="chip-row">
          <button
            v-for="c in fusables"
            :key="c.name"
            type="button"
            class="chip toggle"
            :class="{ on: fuseSelected.includes(c.name) }"
            @click="toggleFuse(c.name)"
          >
            {{ c.name }}（{{ c.cardTier }}）
          </button>
        </div>
        <p v-if="fusePreview?.plan" class="bench-note">{{ fusePreview.plan.summary }}</p>
        <p v-if="fusePreview && !fusePreview.ok" class="clash-warn" role="alert">
          {{ fusePreview.reason }}
        </p>
        <p v-if="fuseMsg" class="bench-note">{{ fuseMsg }}</p>
        <p v-if="fuseErr" class="clash-warn" role="alert">{{ fuseErr }}</p>
        <AppButton
          size="sm"
          variant="primary"
          :disabled="!fusePreview?.ok || fusing"
          :loading="fusing"
          @click="doFuse"
        >
          融合（已选 {{ fuseSelected.length }} / 3）
        </AppButton>
      </div>
    </section>

    <!-- 情绪素材区（SSS「七宗罪之主」门槛，2026-09-17） -->
    <section v-if="canExtractEmotion" class="repair-section" aria-label="情绪素材提取">
      <h4 class="d-label">情绪素材（天赋：七宗罪之主）</h4>
      <div class="slot-card">
        <div class="slot-price">
          从精神侵蚀中提取情绪力量化为素材——每天每种情绪一次，产物可直接用于制卡。
        </div>
        <div class="chip-row">
          <button
            v-for="e in EMOTION_LIST"
            :key="e"
            type="button"
            class="chip toggle"
            :disabled="extractingEmotion === e"
            @click="doExtractEmotion(e)"
          >
            {{ extractingEmotion === e ? '提取中…' : e }}
          </button>
        </div>
        <p v-if="emotionMsg" class="bench-note">{{ emotionMsg }}</p>
        <p v-if="emotionErr" class="clash-warn" role="alert">{{ emotionErr }}</p>
      </div>
    </section>

    <!-- 词条剥离区（SSS「词条之王」门槛，2026-09-17） -->
    <section v-if="canStrip" class="repair-section" aria-label="词条剥离">
      <h4 class="d-label">词条剥离（天赋：词条之王）</h4>
      <div v-if="fusables.length === 0" class="empty-tab small">没有可剥离的卡牌…</div>
      <div v-else class="slot-card">
        <div class="slot-price">把一个词条从卡上摘下来变成素材（形态/标记词条不可剥）。</div>
        <div class="slot-head">
          <select v-model="stripTarget" class="slot-select" aria-label="选择卡牌">
            <option value="" disabled>选择要剥离的卡…</option>
            <option v-for="c in fusables" :key="c.name" :value="c.name">
              {{ c.name }}（{{ c.cardTier }}）
            </option>
          </select>
          <select v-model="stripEntryName" class="slot-select" aria-label="选择词条">
            <option value="" disabled>选择要剥离的词条…</option>
            <option v-for="w in stripCandidates" :key="w" :value="w">{{ w }}</option>
          </select>
        </div>
        <p v-if="stripPreview?.plan" class="bench-note">{{ stripPreview.plan.summary }}</p>
        <p v-if="stripPreview && !stripPreview.ok" class="clash-warn" role="alert">
          {{ stripPreview.reason }}
        </p>
        <p v-if="stripMsg" class="bench-note">{{ stripMsg }}</p>
        <p v-if="stripErr" class="clash-warn" role="alert">{{ stripErr }}</p>
        <AppButton size="sm" variant="primary" :disabled="!stripPreview?.ok" @click="doStrip">
          剥离
        </AppButton>
        <div v-if="materialPeek.length > 0" class="peek-block">
          <span class="slot-role">素材透视（隐藏词条）</span>
          <span v-for="p in materialPeek" :key="p.name" class="chip">
            {{ p.name }}<template v-if="p.entries.length"> → {{ p.entries.join('/') }}</template>
          </span>
        </div>
      </div>
    </section>

    <!-- 伙伴进阶区（最终兵器／结缘／位份门槛，2026-09-17） -->
    <section
      v-if="canAdvance && smeltables.length > 0"
      class="repair-section"
      aria-label="伙伴进阶"
    >
      <h4 class="d-label">伙伴进阶（最终兵器 / 结缘 / 位份）</h4>
      <div class="slot-card">
        <div class="slot-head">
          <select v-model="advanceTarget" class="slot-select" aria-label="选择伙伴卡">
            <option value="" disabled>选择伙伴卡…</option>
            <option v-for="c in smeltables" :key="c.name" :value="c.name">
              {{ c.name }}（{{ c.cardTier }}）
            </option>
          </select>
        </div>
        <p v-if="tributePreview?.plan" class="bench-note">{{ tributePreview.plan.summary }}</p>
        <p v-if="tributePreview && !tributePreview.ok" class="bench-note">
          {{ tributePreview.reason }}
        </p>
        <div class="chip-row">
          <button
            v-if="game.hasMechanicGate('自我进化')"
            type="button"
            class="chip toggle"
            :disabled="!advanceTarget"
            @click="doFinalWeapon"
          >
            立为最终兵器
          </button>
          <button
            v-if="game.hasMechanicGate('结缘')"
            type="button"
            class="chip toggle"
            :disabled="!tributePreview?.ok"
            @click="doTribute"
          >
            结缘（好感 ≥90）
          </button>
        </div>
        <div v-if="game.hasMechanicGate('位份')" class="slot-head">
          <select v-model="advanceRank" class="slot-select" aria-label="选择位份">
            <option v-for="r in CONSORT_RANKS" :key="r" :value="r">{{ r }}</option>
          </select>
          <button type="button" class="chip toggle" :disabled="!advanceTarget" @click="doEnthrone">
            册封位份
          </button>
        </div>
        <p v-if="advanceMsg" class="bench-note">{{ advanceMsg }}</p>
        <p v-if="advanceErr" class="clash-warn" role="alert">{{ advanceErr }}</p>
      </div>
    </section>

    <!-- 孕育区（SSS「种付支配」「神孕之屌」门槛，2026-09-17） -->
    <section v-if="canBreed" class="repair-section" aria-label="伙伴卡孕育">
      <h4 class="d-label">孕育（天赋：种付支配 / 神孕之屌）</h4>
      <div v-if="smeltables.length < 2" class="empty-tab small">需要两张伙伴卡作为双亲…</div>
      <div v-else class="slot-card">
        <div class="slot-price">
          双亲伙伴卡 → 子嗣卡（继承双亲各一词条，档位取较高者；双亲不退场）。
        </div>
        <div class="slot-head">
          <select v-model="breedMother" class="slot-select" aria-label="选择亲本一">
            <option value="" disabled>亲本一…</option>
            <option v-for="c in smeltables" :key="c.name" :value="c.name">
              {{ c.name }}（{{ c.cardTier }}）
            </option>
          </select>
          <select v-model="breedFather" class="slot-select" aria-label="选择亲本二">
            <option value="" disabled>亲本二…</option>
            <option v-for="c in smeltables" :key="c.name" :value="c.name">
              {{ c.name }}（{{ c.cardTier }}）
            </option>
          </select>
        </div>
        <p v-if="breedPreview?.plan" class="bench-note">{{ breedPreview.plan.summary }}</p>
        <p v-if="breedPreview && !breedPreview.ok" class="clash-warn" role="alert">
          {{ breedPreview.reason }}
        </p>
        <p v-if="breedMsg" class="bench-note">{{ breedMsg }}</p>
        <p v-if="breedErr" class="clash-warn" role="alert">{{ breedErr }}</p>
        <AppButton size="sm" variant="primary" :disabled="!breedPreview?.ok" @click="doBreed">
          孕育
        </AppButton>
      </div>
    </section>

    <!-- 转化区（SSS「变肉便器吧」门槛，2026-09-17） -->
    <section v-if="canCorrupt" class="repair-section" aria-label="伙伴卡转化">
      <h4 class="d-label">转化（天赋：变肉便器吧）</h4>
      <div v-if="smeltables.length === 0" class="empty-tab small">没有可转化的伙伴卡…</div>
      <div v-else class="slot-card">
        <div class="slot-price">伙伴卡退场，其词条逐条兑成素材（品质随卡档）——卡不再回来。</div>
        <div class="slot-head">
          <select v-model="corruptTarget" class="slot-select" aria-label="选择转化对象">
            <option value="" disabled>选择要转化的伙伴卡…</option>
            <option v-for="c in smeltables" :key="c.name" :value="c.name">
              {{ c.name }}（{{ c.cardTier }}）
            </option>
          </select>
        </div>
        <p v-if="corruptPreview?.plan" class="bench-note">{{ corruptPreview.plan.summary }}</p>
        <p v-if="corruptPreview && !corruptPreview.ok" class="clash-warn" role="alert">
          {{ corruptPreview.reason }}
        </p>
        <p v-if="corruptMsg" class="bench-note">{{ corruptMsg }}</p>
        <p v-if="corruptErr" class="clash-warn" role="alert">{{ corruptErr }}</p>
        <AppButton size="sm" variant="primary" :disabled="!corruptPreview?.ok" @click="doCorrupt">
          转化
        </AppButton>
      </div>
    </section>

    <!-- 深渊契约区（SSS「深渊领主」门槛，2026-09-17） -->
    <section v-if="canAbyss" class="repair-section" aria-label="深渊契约">
      <h4 class="d-label">深渊契约（天赋：深渊领主）</h4>
      <div v-if="smeltables.length === 0" class="empty-tab small">没有可缔约的伙伴卡…</div>
      <div v-else class="slot-card">
        <div class="slot-price">
          与深海系（水／冰）伙伴卡缔结深渊契约 → 获「深海」「深渊压制」词条并跃迁一阶（水下全属性
          +40%）。
        </div>
        <div class="slot-head">
          <select v-model="abyssTarget" class="slot-select" aria-label="选择契约对象">
            <option value="" disabled>选择深海系伙伴卡…</option>
            <option v-for="c in smeltables" :key="c.name" :value="c.name">
              {{ c.name }}（{{ c.cardTier }}｜{{ (c.词条 || []).join('/') }}）
            </option>
          </select>
        </div>
        <p v-if="abyssPreview?.plan" class="bench-note">{{ abyssPreview.plan.summary }}</p>
        <p v-if="abyssPreview && !abyssPreview.ok" class="clash-warn" role="alert">
          {{ abyssPreview.reason }}
        </p>
        <p v-if="abyssMsg" class="bench-note">{{ abyssMsg }}</p>
        <p v-if="abyssErr" class="clash-warn" role="alert">{{ abyssErr }}</p>
        <AppButton size="sm" variant="primary" :disabled="!abyssPreview?.ok" @click="doAbyss">
          缔结深渊契约
        </AppButton>
      </div>
    </section>

    <!-- 制卡区（主路：Code 算完 → AI 只写叙事与命名） -->
    <section class="repair-section" aria-label="制卡">
      <h4 class="d-label">制卡</h4>
      <div v-if="materials.length === 0" class="empty-tab small">手上一件素材都没有…</div>
      <div v-else class="slot-card">
        <div class="slot-price">
          选素材、写下你想做成什么样——<b>档位/词条/造价/评级由工坊当场定案</b>， AI
          只负责给它起名、把过程写成一段话。
        </div>
        <div class="slot-head">
          <select v-model="craftMain" class="slot-select" aria-label="选择主素材">
            <option value="" disabled>主素材…</option>
            <option v-for="m in materials" :key="m.name" :value="m.name">{{ m.name }}</option>
          </select>
          <select v-model="craftSubA" class="slot-select" aria-label="选择副素材甲">
            <option value="">副素材（可空）…</option>
            <option v-for="m in materials" :key="m.name" :value="m.name">{{ m.name }}</option>
          </select>
          <select v-model="craftSubB" class="slot-select" aria-label="选择副素材乙">
            <option value="">副素材（可空）…</option>
            <option v-for="m in materials" :key="m.name" :value="m.name">{{ m.name }}</option>
          </select>
        </div>
        <select
          v-if="blueprints.length > 0"
          v-model="craftBlueprint"
          class="slot-select"
          aria-label="选择技能蓝本"
        >
          <option value="">不用蓝本…</option>
          <option v-for="b in blueprints" :key="b.name" :value="b.name">
            {{ b.name }}（抄自 {{ b.from }}）
          </option>
        </select>
        <textarea
          v-model="craftIntent"
          class="note-input"
          rows="2"
          placeholder="你想做成什么样？（影响卡名与叙事，不改变数值）"
        ></textarea>
        <div v-if="craftPreview?.plan" class="craft-preview">
          <span class="chip">{{ craftPreview.plan.product.cardTier }}</span>
          <span v-for="w in craftPreview.plan.product.词条" :key="w" class="chip">{{ w }}</span>
          <span class="chip">造价 {{ craftPreview.plan.cost }} GC</span>
          <span class="chip">消耗 {{ craftPreview.plan.consumed.join('、') || '无' }}</span>
          <p class="bench-note">（预览按中位骰；实际评级在提交时掷）</p>
        </div>
        <p v-if="craftPreview && !craftPreview.ok" class="clash-warn" role="alert">
          {{ craftPreview.reason }}
        </p>
        <p v-if="craftMsg" class="bench-note">{{ craftMsg }}</p>
        <p v-if="craftErr" class="clash-warn" role="alert">{{ craftErr }}</p>
        <AppButton
          size="sm"
          variant="primary"
          :disabled="craftCard_busy"
          :loading="crafting"
          @click="doCraftCard"
        >
          开始制卡
        </AppButton>
      </div>
    </section>

    <!-- 足之炼金术区（门槛：`炼金` 条目——S「足之炼金术」） -->
    <section v-if="canAlchemy" class="repair-section" aria-label="足之炼金术">
      <h4 class="d-label">足之炼金术（天赋：足之炼金术）</h4>
      <div v-if="smeltables.length === 0 || materials.length === 0" class="empty-tab small">
        需要一张伙伴卡与一件素材…
      </div>
      <div v-else class="slot-card">
        <div class="slot-price">
          让伙伴卡踩踏一件素材——炼出<b>全新的道具卡</b>。
          <b>素材会被消耗，她不会</b>（她是踩踏者，不是原料）。
        </div>
        <div class="slot-head">
          <select v-model="alchemyPartner" class="slot-select" aria-label="选择踩踏的伙伴卡">
            <option value="" disabled>选伙伴卡…</option>
            <option v-for="c in smeltables" :key="c.name" :value="c.name">{{ c.name }}</option>
          </select>
          <select v-model="alchemyMaterial" class="slot-select" aria-label="选择被踩踏的素材">
            <option value="" disabled>选素材…</option>
            <option v-for="m in materials" :key="m.name" :value="m.name">
              {{ m.name }}（{{ m.rarity ?? '普通' }}）
            </option>
          </select>
        </div>
        <p v-if="alchemyPreview?.plan" class="bench-note">{{ alchemyPreview.plan.summary }}</p>
        <p v-if="alchemyMsg" class="bench-note">{{ alchemyMsg }}</p>
        <p v-if="alchemyErr" class="clash-warn" role="alert">{{ alchemyErr }}</p>
        <AppButton size="sm" variant="primary" :disabled="!alchemyPreview?.plan" @click="doAlchemy">
          踩踏炼金
        </AppButton>
      </div>
    </section>

    <!-- 打脸点数（门槛：`打脸` 条目——S「打脸升级系统」） -->
    <section v-if="canSlap" class="repair-section" aria-label="打脸点数">
      <h4 class="d-label">打脸点数（天赋：打脸升级系统）</h4>
      <div class="slot-card">
        <div class="slot-price">
          被人看不起之后打赢，就能攒下打脸点数——点数可折成一件装备。
          <b>当前 {{ slapPoints }} 点</b>。
          <span v-if="nemesis">
            宿敌：<b>{{ nemesis.name }}</b
            >（Lv{{ nemesis.level }}）——与他一战经验翻倍。
          </span>
        </div>
        <p v-if="slapMsg" class="bench-note">{{ slapMsg }}</p>
        <p v-if="slapErr" class="clash-warn" role="alert">{{ slapErr }}</p>
        <AppButton
          size="sm"
          variant="primary"
          :disabled="slapPoints <= 0 || slapBusy"
          @click="doRedeemSlap"
        >
          兑换装备
        </AppButton>
      </div>
    </section>

    <!-- 调教区（门槛：`调教` 条目——S「调教大师系统」） -->
    <section v-if="canTrain" class="repair-section" aria-label="调教伙伴卡">
      <h4 class="d-label">调教（天赋：调教大师系统）</h4>
      <div v-if="trainables.length === 0" class="empty-tab small">没有可调教的伙伴卡…</div>
      <div v-else class="slot-card">
        <div class="slot-price">
          调教塑造她的性格与能力——<b>每级 +1 卡面战力</b>，方向在第一次调教时定下。
          <span v-if="misfortunes > 0"
            >当前厄运 <b>{{ misfortunes }}</b> 层（下一次对冲融合会替你押上）。</span
          >
        </div>
        <div class="slot-head">
          <select v-model="trainTarget" class="slot-select" aria-label="选择要调教的伙伴卡">
            <option value="" disabled>选择伙伴卡…</option>
            <option v-for="c in trainables" :key="c.name" :value="c.name">{{ c.name }}</option>
          </select>
          <select v-model="trainDirection" class="slot-select" aria-label="调教方向">
            <option v-for="d in TRAIN_DIRECTIONS" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
        <p v-if="trainMsg" class="bench-note">{{ trainMsg }}</p>
        <p v-if="trainErr" class="clash-warn" role="alert">{{ trainErr }}</p>
        <AppButton size="sm" variant="primary" :disabled="!trainTarget" @click="doTrain">
          调教一次
        </AppButton>
      </div>
    </section>

    <!-- 时间回溯预付（门槛：`回溯` 条目——S「时间回溯」） -->
    <section v-if="canRewind" class="repair-section" aria-label="时间回溯">
      <h4 class="d-label">时间回溯（天赋：时间回溯）</h4>
      <div class="slot-card">
        <div class="slot-price">
          预付一次回溯：<b>下一次制卡若失败</b>，把那一刻倒回去重裁一次——代价是精神力。
          成功时不触发、也不扣。
        </div>
        <p v-if="rewindArmed" class="bench-note">已预付：下一次制卡失败时会回溯。</p>
        <p v-if="rewindMsg" class="bench-note">{{ rewindMsg }}</p>
        <p v-if="rewindErr" class="clash-warn" role="alert">{{ rewindErr }}</p>
        <AppButton
          v-if="!rewindArmed"
          size="sm"
          variant="primary"
          :disabled="rewindBusy"
          @click="toggleRewind(true)"
        >
          预付回溯
        </AppButton>
        <AppButton v-else size="sm" :disabled="rewindBusy" @click="toggleRewind(false)">
          取消预付
        </AppButton>
      </div>
    </section>

    <!-- 双生羁绊区（门槛：`羁绊` 条目——S「双生羁绊」） -->
    <section v-if="canBind" class="repair-section" aria-label="双生羁绊">
      <h4 class="d-label">双生羁绊（天赋：双生羁绊）</h4>
      <div v-if="smeltables.length < 2" class="empty-tab small">至少需要两张伙伴卡…</div>
      <div v-else class="slot-card">
        <div class="slot-price">
          指定两张伙伴卡结为双生——她们共享感官，<b>先后打出时触发组合技</b>。
        </div>
        <div class="slot-head">
          <select v-model="bindA" class="slot-select" aria-label="第一张伙伴卡">
            <option value="" disabled>选第一位…</option>
            <option v-for="c in smeltables" :key="c.name" :value="c.name">{{ c.name }}</option>
          </select>
          <select v-model="bindB" class="slot-select" aria-label="第二张伙伴卡">
            <option value="" disabled>选第二位…</option>
            <option v-for="c in smeltables" :key="c.name" :value="c.name">{{ c.name }}</option>
          </select>
        </div>
        <p v-if="bondList.length" class="bench-note">已有的双生：{{ bondList.join('；') }}</p>
        <p v-if="bindMsg" class="bench-note">{{ bindMsg }}</p>
        <p v-if="bindErr" class="clash-warn" role="alert">{{ bindErr }}</p>
        <AppButton size="sm" variant="primary" :disabled="!bindA || !bindB" @click="doBind">
          缔结羁绊
        </AppButton>
      </div>
    </section>

    <!-- 身后灵区（门槛：`成灵` 条目——S「瓦尔哈拉的门票」） -->
    <section v-if="canSpirit" class="repair-section" aria-label="身后灵">
      <h4 class="d-label">身后灵（天赋：瓦尔哈拉的门票）</h4>
      <div v-if="smeltables.length === 0" class="empty-tab small">没有可以送灵的伙伴卡…</div>
      <div v-else class="slot-card">
        <div class="slot-price">
          送一位伙伴成灵——她<b>不再上场</b>，换一枚永远跟在你身后的守护（每枚 +防御）。
        </div>
        <div class="slot-head">
          <select v-model="spiritTarget" class="slot-select" aria-label="选择要送灵的伙伴卡">
            <option value="" disabled>选择伙伴卡…</option>
            <option v-for="c in smeltables" :key="c.name" :value="c.name">{{ c.name }}</option>
          </select>
        </div>
        <p v-if="spiritList.length" class="bench-note">
          现有身后灵 {{ spiritList.length }} 位：{{ spiritList.map((s) => s.name).join('、') }}
        </p>
        <p v-if="spiritMsg" class="bench-note">{{ spiritMsg }}</p>
        <p v-if="spiritErr" class="clash-warn" role="alert">{{ spiritErr }}</p>
        <AppButton size="sm" variant="primary" :disabled="!spiritTarget" @click="doSpirit">
          送她成灵
        </AppButton>
      </div>
    </section>

    <!-- 不等价交换区（门槛：`置换` 条目——S「不等价交换」） -->
    <section v-if="canExchange" class="repair-section" aria-label="不等价交换">
      <h4 class="d-label">不等价交换（天赋：不等价交换）</h4>
      <div v-if="exchangeables.length === 0" class="empty-tab small">没有可放弃的素材或卡牌…</div>
      <div v-else class="slot-card">
        <div class="slot-price">
          放弃一件素材或卡牌，换回 1~2 个<b>同类型、品质不高于原来</b>的回报。
          份数与抽到哪张都由天意决定——<b>换亏是认了的</b>。
        </div>
        <div class="slot-head">
          <select v-model="exchangeTarget" class="slot-select" aria-label="选择要放弃的物品">
            <option value="" disabled>选择要放弃的物品…</option>
            <option v-for="i in exchangeables" :key="i.name" :value="i.name">
              {{ i.name }}（{{
                i.type === '卡牌' ? (i as CardItem).cardTier : (i.rarity ?? '普通')
              }}）
            </option>
          </select>
        </div>
        <p v-if="exchangeMsg" class="bench-note">{{ exchangeMsg }}</p>
        <p v-if="exchangeErr" class="clash-warn" role="alert">{{ exchangeErr }}</p>
        <AppButton size="sm" variant="primary" :disabled="!exchangeTarget" @click="doExchange">
          放弃并置换
        </AppButton>
      </div>
    </section>

    <!-- 败犬烙印区（门槛：`烙印` 条目——SS「败犬烙印」；战败累计，制卡时烧一枚） -->
    <section v-if="canScar" class="repair-section" aria-label="败犬烙印">
      <h4 class="d-label">败犬烙印（天赋：败犬烙印）</h4>
      <div class="slot-card">
        <div class="slot-price">
          每一败都在灵魂上留一枚烙印，攒着不散。<b>当前 {{ scarLeft }} 枚</b>。<br />
          预付一枚：下一次制卡评级<b>上浮两档</b>——「强行扭转一次词条冲突，化腐朽为神奇」。
        </div>
        <p v-if="scarPending" class="bench-note">已预付：下一次制卡将烧掉一枚烙印。</p>
        <p v-if="scarMsg" class="bench-note">{{ scarMsg }}</p>
        <p v-if="scarErr" class="clash-warn" role="alert">{{ scarErr }}</p>
        <AppButton
          v-if="!scarPending"
          size="sm"
          variant="primary"
          :disabled="scarLeft <= 0 || scarBusy"
          @click="toggleScar(true)"
        >
          {{ scarLeft > 0 ? '预付一枚烙印' : '没有可用的烙印' }}
        </AppButton>
        <AppButton v-else size="sm" :disabled="scarBusy" @click="toggleScar(false)">
          取消预付
        </AppButton>
      </div>
    </section>

    <!-- 素材点金区（门槛：`点金` 条目——S「素材点金」；每日一次走账本） -->
    <section v-if="canPointGold" class="repair-section" aria-label="素材点金">
      <h4 class="d-label">素材点金（天赋：素材点金）</h4>
      <div v-if="pointables.length === 0" class="empty-tab small">
        没有可点金的素材（材料类且未到最高品质）…
      </div>
      <div v-else class="slot-card">
        <div class="slot-price">
          每天一次，把一个素材的品质提升一个大档。<b>今日剩余 {{ pointGoldLeft }} 次</b>。
        </div>
        <div class="slot-head">
          <select v-model="pointGoldTarget" class="slot-select" aria-label="选择要点金的素材">
            <option value="" disabled>选择素材…</option>
            <option v-for="m in pointables" :key="m.name" :value="m.name">
              {{ m.name }}（{{ m.rarity ?? '普通' }}）
            </option>
          </select>
        </div>
        <p v-if="pointGoldPreview?.plan" class="bench-note">{{ pointGoldPreview.plan.summary }}</p>
        <p v-if="pointGoldMsg" class="bench-note">{{ pointGoldMsg }}</p>
        <p v-if="pointGoldErr" class="clash-warn" role="alert">{{ pointGoldErr }}</p>
        <AppButton
          size="sm"
          variant="primary"
          :disabled="!pointGoldPreview?.plan || pointGoldLeft <= 0"
          @click="doPointGold"
        >
          点金
        </AppButton>
      </div>
    </section>

    <!-- 形态改造区（门槛：`改造` 条目——SSS「突变巫师」/ SS「画师」，2026-09-17） -->
    <section v-if="canReshape" class="repair-section" aria-label="卡牌形态改造">
      <h4 class="d-label">形态改造（天赋：突变巫师 / 画师）</h4>
      <div v-if="fusables.length === 0" class="empty-tab small">没有可改造的卡牌…</div>
      <div v-else class="slot-card">
        <div class="slot-price">
          把一张卡改写为指定形态系列（追加形态词条）。自身改造走「声明意图」通道。
        </div>
        <div class="slot-head">
          <select v-model="reshapeTarget" class="slot-select" aria-label="选择改造对象">
            <option value="" disabled>选择要改造的卡…</option>
            <option v-for="c in fusables" :key="c.name" :value="c.name">
              {{ c.name }}（{{ c.cardTier }}）
            </option>
          </select>
          <select v-model="reshapeSeries" class="slot-select" aria-label="选择目标形态">
            <option v-for="sr in RESHAPE_SERIES" :key="sr" :value="sr">{{ sr }}</option>
          </select>
        </div>
        <p v-if="reshapePreview?.plan" class="bench-note">{{ reshapePreview.plan.summary }}</p>
        <p v-if="reshapePreview && !reshapePreview.ok" class="clash-warn" role="alert">
          {{ reshapePreview.reason }}
        </p>
        <p v-if="reshapeMsg" class="bench-note">{{ reshapeMsg }}</p>
        <p v-if="reshapeErr" class="clash-warn" role="alert">{{ reshapeErr }}</p>
        <AppButton size="sm" variant="primary" :disabled="!reshapePreview?.ok" @click="doReshape">
          改造
        </AppButton>
      </div>
    </section>

    <!-- 熔炼 / 缔约区（SSS「军团熔炉」门槛，2026-09-17） -->
    <section v-if="canSmelt" class="repair-section" aria-label="伙伴卡熔炼与缔约">
      <h4 class="d-label">熔炼 · 缔约（天赋：军团熔炉）</h4>
      <div v-if="smeltables.length === 0" class="empty-tab small">
        背包里没有可熔炼的伙伴卡（召唤卡）…
      </div>
      <div v-else class="slot-card">
        <div class="slot-price">
          点选 2 张伙伴卡＝融合；点选 ≥3 张＝献祭（产出档位 +1，各源取一词条 + 集合体标记）。
        </div>
        <div class="chip-row">
          <button
            v-for="c in smeltables"
            :key="c.name"
            type="button"
            class="chip toggle"
            :class="{ on: smeltSelected.includes(c.name) }"
            @click="toggleSmelt(c.name)"
          >
            {{ c.name }}（{{ c.cardTier }}）
          </button>
        </div>
        <p v-if="smeltPreview?.plan" class="bench-note">{{ smeltPreview.plan.summary }}</p>
        <p v-if="smeltPreview && !smeltPreview.ok" class="clash-warn" role="alert">
          {{ smeltPreview.reason }}
        </p>
        <p v-if="smeltMsg" class="bench-note">{{ smeltMsg }}</p>
        <p v-if="smeltErr" class="clash-warn" role="alert">{{ smeltErr }}</p>
        <AppButton
          size="sm"
          variant="primary"
          :disabled="!smeltPreview?.ok || smelting"
          :loading="smelting"
          @click="doSmelt"
        >
          {{ smeltSelected.length >= 3 ? '献祭熔炼' : '融合熔炼' }}
        </AppButton>
      </div>

      <div v-if="smeltables.length > 0" class="slot-card">
        <div class="slot-price">
          缔约：好感 ≥{{ CONTRACT_AFFECTION_THRESHOLD }}（深厚羁绊）的伙伴卡 → 档位跃迁一阶。
        </div>
        <div class="slot-head">
          <select v-model="contractTarget" class="slot-select" aria-label="选择缔约对象">
            <option value="" disabled>选择伙伴卡…</option>
            <option v-for="c in smeltables" :key="c.name" :value="c.name">
              {{ c.name }}（{{ c.cardTier }}）
            </option>
          </select>
        </div>
        <p v-if="contractPreview?.plan" class="bench-note">{{ contractPreview.plan.summary }}</p>
        <p v-if="contractPreview && !contractPreview.ok" class="clash-warn" role="alert">
          {{ contractPreview.reason }}
        </p>
        <p v-if="contractMsg" class="bench-note">{{ contractMsg }}</p>
        <p v-if="contractErr" class="clash-warn" role="alert">{{ contractErr }}</p>
        <AppButton
          size="sm"
          variant="primary"
          :disabled="!contractPreview?.ok || contracting"
          :loading="contracting"
          @click="doContract"
        >
          缔约
        </AppButton>
      </div>
    </section>

    <!-- 淬炼区（2026-09-16：健康卡 + 素材 → 词条强化/品质跃迁） -->
    <section class="repair-section" aria-label="淬炼强化">
      <h4 class="d-label">淬炼强化</h4>
      <div v-if="quenchableCards.length === 0" class="empty-tab small">背包里没有可淬炼的铭卡…</div>
      <div v-else-if="materials.length === 0" class="empty-tab small">
        没有素材可消耗——先去弄点材料。
      </div>
      <div v-else class="slot-card">
        <div class="slot-head">
          <select v-model="quenchCardName" class="slot-select" aria-label="选择要淬炼的卡">
            <option value="" disabled>选择要淬炼的卡…</option>
            <option v-for="c in quenchableCards" :key="c.name" :value="c.name">
              {{ c.name }}（{{ c.cardTier }}）
            </option>
          </select>
        </div>
        <div class="slot-price">
          点选消耗的素材：元素并入词条、相生可复合；素材品质高于卡时，品质跃迁一档。
        </div>
        <div class="chip-row">
          <button
            v-for="m in materials"
            :key="m.name"
            type="button"
            class="chip toggle"
            :class="{ on: quenchMaterialNames.includes(m.name) }"
            @click="toggleQuenchMaterial(m.name)"
          >
            {{ m.name }}
          </button>
        </div>
        <div v-if="quenchPlan" class="kv-grid">
          <div class="kv-row">
            <span class="k">跃迁</span>
            <span class="v">{{
              quenchPlan.upgraded ? `${quenchTarget?.cardTier} → ${quenchPlan.newTier}` : '否'
            }}</span>
          </div>
          <div class="kv-row">
            <span class="k">词条变化</span>
            <span class="v">{{
              quenchPlan.new词条.length ? quenchPlan.new词条.join('、') : '无'
            }}</span>
          </div>
        </div>
        <p v-if="quenchValidation && !quenchValidation.ok" class="clash-warn" role="alert">
          {{ quenchValidation.reason }}
        </p>
        <p v-if="quenchResult" class="bench-note">{{ quenchResult }}</p>
        <p v-if="quenchError" class="clash-warn" role="alert">{{ quenchError }}</p>
        <AppButton
          size="sm"
          variant="primary"
          :disabled="!quenchValidation?.ok || quenching"
          :loading="quenching"
          @click="doQuench"
        >
          淬炼
        </AppButton>
      </div>
    </section>

    <!-- 修复区（契约召唤 C' 制：伙伴被打倒 → 卡损坏） -->
    <section class="repair-section" aria-label="修复损坏的卡">
      <h4 class="d-label">修复损坏的卡</h4>
      <div v-if="damagedCards.length === 0" class="empty-tab small">
        没有损坏的卡——伙伴被打倒时，损伤由卡承载，那时来这里修。
      </div>
      <div v-else class="slot-card">
        <div class="slot-head">
          <select v-model="repairCardName" class="slot-select" aria-label="选择损坏的卡">
            <option value="" disabled>选择损坏的卡…</option>
            <option v-for="c in damagedCards" :key="c.name" :value="c.name">
              {{ c.name }}（{{ c.cardTier }}）
            </option>
          </select>
        </div>
        <div v-if="repairRecipe" class="slot-price">
          配方：{{ repairRecipe.materialCount }} 份稀有度 ≥{{ repairRecipe.minMaterialTier }}
          的素材（点选下方素材，先填满模板配额，其余作为强化）
        </div>
        <div class="chip-row">
          <button
            v-for="m in materials"
            :key="m.name"
            type="button"
            class="chip toggle"
            :class="{ on: selectedMaterials.includes(m.name) }"
            @click="toggleMaterial(m.name)"
          >
            {{ m.name }}
          </button>
        </div>
        <div v-if="repairPlan" class="kv-grid">
          <div class="kv-row">
            <span class="k">跃迁</span>
            <span class="v">{{
              repairPlan.upgraded ? `${repairTarget?.cardTier} → ${repairPlan.newTier}` : '否'
            }}</span>
          </div>
          <div class="kv-row">
            <span class="k">新增词条</span>
            <span class="v">{{
              repairPlan.new词条.length ? repairPlan.new词条.join('、') : '无'
            }}</span>
          </div>
        </div>
        <p v-if="repairPlan?.summary" class="bench-note">{{ repairPlan.summary }}</p>
        <p v-if="repairError" class="clash-warn" role="alert">{{ repairError }}</p>
        <AppButton
          size="sm"
          variant="primary"
          :disabled="!canRepair || repairing"
          :loading="repairing"
          @click="doRepair"
        >
          修复
        </AppButton>
      </div>
    </section>
  </div>
</template>

<style scoped>
.craft-bench {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-md);
  padding: var(--theme-spacing-lg);
  min-height: 24rem;
}
.bench-columns {
  display: flex;
  gap: var(--theme-spacing-lg);
  align-items: flex-start;
}
.bench-col {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-sm);
  min-width: 0;
}
.slots-col {
  width: 20rem;
  flex-shrink: 0;
}
.preview-col {
  flex: 1;
}
.d-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-family: var(--theme-font-title);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--theme-text-primary);
}
.d-label::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(to right, var(--theme-card-border), transparent);
}
.slot-card,
.preview-card {
  background: var(--theme-card-bg);
  border: 1px solid var(--theme-card-border);
  border-radius: var(--theme-radius-md);
  box-shadow: var(--paper-stack);
  padding: var(--theme-spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-sm);
}
.slot-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--theme-spacing-sm);
}
.slot-role {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--theme-text-secondary);
}
.slot-price {
  font-size: 0.75rem;
  color: var(--theme-text-muted);
}
.slot-select {
  width: 100%;
  padding: 7px 10px;
  min-height: 36px;
  font-family: inherit;
  font-size: 0.8125rem;
  color: var(--theme-text-primary);
  background: var(--theme-surface-muted);
  border: 1px solid var(--theme-card-border);
  border-radius: var(--theme-radius-sm);
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--theme-spacing-xs);
}
.chip {
  font-size: 0.6875rem;
  color: var(--theme-text-secondary);
  background: var(--theme-surface-muted);
  border: 1px solid var(--theme-card-border);
  border-radius: var(--theme-radius-sm);
  padding: 2px 8px;
}
.chip.toggle {
  cursor: pointer;
  font-family: inherit;
  min-height: 24px;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}
.chip.toggle:hover {
  background: var(--theme-tab-hover-bg);
  color: var(--theme-text-primary);
}
.chip.toggle.on {
  background: color-mix(in srgb, var(--theme-primary) 12%, transparent);
  color: var(--theme-primary);
  border-color: color-mix(in srgb, var(--theme-primary) 30%, transparent);
}
.preview-head {
  display: flex;
  align-items: center;
  gap: var(--theme-spacing-sm);
  padding-bottom: var(--theme-spacing-sm);
  border-bottom: 1px solid var(--theme-card-border);
}
.kind-badge {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--theme-success);
  background: color-mix(in srgb, var(--theme-success) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-success) 30%, transparent);
  border-radius: var(--theme-radius-sm);
  padding: 2px 8px;
}
.kind-badge.clash {
  color: var(--theme-error);
  background: color-mix(in srgb, var(--theme-error) 12%, transparent);
  border-color: color-mix(in srgb, var(--theme-error) 30%, transparent);
}
.tier-name {
  font-family: var(--theme-font-title);
  font-size: 1.125rem;
  font-weight: 700;
}
.tier-badge {
  margin-left: auto;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--theme-text-secondary);
  border: 1px solid var(--theme-card-border);
  border-radius: var(--theme-radius-sm);
  padding: 1px 8px;
}
.clash-warn {
  margin: 0;
  font-size: 0.75rem;
  color: var(--theme-error);
  background: color-mix(in srgb, var(--theme-error) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-error) 25%, transparent);
  border-radius: var(--theme-radius-sm);
  padding: 6px 10px;
}
.detail-section {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-xs);
}
.kv-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 14px;
}
.kv-row {
  display: flex;
  justify-content: space-between;
  gap: var(--theme-spacing-sm);
  font-size: 0.8125rem;
}
.kv-row .k {
  color: var(--theme-text-muted);
}
.kv-row .v {
  color: var(--theme-text-primary);
  text-align: right;
}
.bench-note {
  margin: 0;
  font-size: 0.75rem;
  color: var(--theme-text-muted);
  font-style: italic;
}
.empty-tab {
  padding: 32px 0;
  text-align: center;
  color: var(--theme-text-muted);
  font-size: 0.8125rem;
  font-style: italic;
}
.empty-tab::before {
  content: '—';
  display: block;
  margin-bottom: 8px;
  font-size: 1.25rem;
  opacity: 0.3;
}
.empty-tab.small {
  padding: 12px 0;
}
.empty-tab.small::before {
  display: none;
}
.repair-section {
  margin-top: var(--theme-spacing-md);
}
</style>
.peek-block { display: flex; flex-wrap: wrap; align-items: center; gap: var(--theme-spacing-xs);
margin-top: var(--theme-spacing-xs); padding-top: var(--theme-spacing-xs); border-top: 1px solid
var(--theme-card-border); } /* ===== 背包素材区（2026-09-18 UI 改造：下拉 → 点选卡片）===== */
.slot-filled .slot-value { font-size: 0.875rem; font-weight: 600; color: var(--theme-text-primary);
padding: 6px 10px; border-radius: var(--theme-radius-sm); background: var(--theme-surface-muted);
border: 1px solid var(--theme-card-border); } .slot-empty { font-size: 0.8125rem; color:
var(--theme-text-muted); font-style: italic; padding: 6px 10px; } .slot-clear { margin-left: auto;
width: 1.5em; height: 1.5em; display: flex; align-items: center; justify-content: center; border:
1px solid var(--theme-card-border); border-radius: var(--theme-radius-sm); background: transparent;
color: var(--theme-text-muted); font-size: 0.875rem; line-height: 1; cursor: pointer; transition:
all var(--theme-transition-fast); } .slot-clear:hover { border-color: var(--theme-error); color:
var(--theme-error); } .material-pool { margin-top: var(--theme-spacing-sm); padding:
var(--theme-spacing-sm); border: 1px dashed var(--theme-card-border); border-radius:
var(--theme-radius-md); } .pool-title { margin: 0 0 6px; font-size: 0.75rem; font-weight: 700;
color: var(--theme-text-secondary); display: flex; align-items: baseline; gap: 6px; } .pool-hint {
font-weight: 400; font-size: 0.6875rem; color: var(--theme-text-muted); } .pool-list { display:
flex; flex-wrap: wrap; gap: var(--theme-spacing-xs); max-height: 8.5rem; overflow-y: auto; }
.pool-item { display: flex; align-items: center; gap: 5px; padding: 4px 9px; border: 1px solid
var(--theme-card-border); border-radius: var(--theme-radius-sm); background: var(--theme-card-bg);
color: var(--theme-text-primary); font-family: inherit; font-size: 0.8125rem; cursor: pointer;
transition: all var(--theme-transition-fast); } .pool-item:hover { border-color:
var(--theme-primary); background: color-mix(in srgb, var(--theme-primary) 8%, transparent); }
.pool-item.used { border-color: color-mix(in srgb, var(--theme-primary) 45%,
var(--theme-card-border)); background: color-mix(in srgb, var(--theme-primary) 9%, transparent); }
.pool-icon { font-size: 0.7rem; color: var(--theme-text-muted); } .pool-qty { color:
var(--theme-text-muted); font-size: 0.7rem; } .pool-used { font-size: 0.625rem; font-weight: 700;
color: var(--theme-primary); padding: 0 4px; border-radius: 999px; background: color-mix(in srgb,
var(--theme-primary) 15%, transparent); }
