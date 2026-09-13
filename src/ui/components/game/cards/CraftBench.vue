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
import { REPAIR_RECIPE, isDamaged, planRepair } from '@engine/card-workshop/repair';
import type { RepairPlan } from '@engine/card-workshop/repair';
import AppButton from '../../shared/AppButton.vue';

const game = useGameStore();
const player = computed(() => game.player);

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
    <div v-if="materials.length === 0" class="empty-tab">背包里还没有可用的素材（材料）…</div>

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

    <!-- 修复区（契约召唤 C' 制：伙伴被打倒 → 卡损坏；有损坏卡时出现） -->
    <section v-if="damagedCards.length > 0" class="repair-section" aria-label="修复损坏的卡">
      <h4 class="d-label">修复损坏的卡</h4>
      <div class="slot-card">
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
