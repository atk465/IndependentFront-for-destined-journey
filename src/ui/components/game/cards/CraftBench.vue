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
import { ELEMENT_KEYWORDS, deriveElements, toMaterial } from '@engine/card-workshop/material';
import type { MaterialSpec } from '@engine/card-workshop/card-fusion';
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

        <div class="slot-card">
          <div class="slot-head">
            <span class="slot-role">主素材</span>
            <span v-if="mainSpec" class="slot-price">估价 {{ mainSpec.price }} GC</span>
          </div>
          <select v-model="selection.main" class="slot-select" aria-label="选择主素材">
            <option v-for="m in materials" :key="m.name" :value="m.name">{{ m.name }}</option>
          </select>
          <div class="chip-row">
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

        <div v-for="slot in ['sub1', 'sub2'] as const" :key="slot" class="slot-card">
          <div class="slot-head">
            <span class="slot-role">副素材 {{ slot === 'sub1' ? '一' : '二' }}</span>
            <span v-if="specOf(slot)" class="slot-price">估价 {{ specOf(slot)!.price }} GC</span>
          </div>
          <select
            v-model="selection[slot]"
            class="slot-select"
            :aria-label="`选择副素材${slot === 'sub1' ? '一' : '二'}`"
          >
            <option value="">（不用）</option>
            <option v-for="m in materials" :key="m.name" :value="m.name">{{ m.name }}</option>
          </select>
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
var(--theme-card-border); }
