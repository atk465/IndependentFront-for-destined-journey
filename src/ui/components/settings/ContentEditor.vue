<script setup lang="ts">
/**
 * ContentEditor.vue — 开发者模式自定义内容编辑器（天赋 + 购卡池）
 *
 * 两个标签页：天赋编辑器 / 购卡编辑器。
 * 数据走 game-store 的 customTalents / customCards 通道（worldFlags 持久化）。
 * 天赋提交前走 validateTalentEntries 校验（AI 零编数门禁照旧）。
 */
import { computed, ref, watch } from 'vue';
import { useGameStore } from '../../stores/game-store';
import {
  TALENT_ENTRY_POOL,
  validateTalentEntries,
  registerCustomTalent,
  unregisterCustomTalent,
  getCustomTalents,
  type TalentTemplate,
  type TalentGrade,
  type TalentEntry,
} from '@engine/card-workshop/talent-entry';
import type { CardCatalogItem } from '@engine/start-catalog-mechanics';
import { CARD_TIERS } from '@engine/field-enums';
import { coerceCustomCards, coerceCustomTalents } from '@engine/card-workshop/custom-content';
import {
  TALENT_TEMPLATE,
  CARD_TEMPLATE,
  buildTemplateBundle,
} from '@engine/card-workshop/content-templates';
import AppButton from '../shared/AppButton.vue';

const game = useGameStore();
const tab = ref<'talent' | 'card'>('talent');

/**
 * 列表刷新闸（2026-09-18）。
 *
 * 🔴 自定义天赋/卡的注册表是**模块级普通 Map**（引擎层不引 Vue），`computed` 读它
 *    建立不了依赖 —— 保存/删除后列表不会重画（天赋那侧此前就带着这个毛病）。
 *    写操作之后手动自增一次，等于"重新读一遍注册表"。
 */
const listsVersion = ref(0);
function refreshLists() {
  listsVersion.value += 1;
}

// 切档/读档会把注册表按存档重建（game-store 的 loadCustomContent）—— 编辑器开着切档时也要重画
watch(() => game.activeSaveId, refreshLists);

// ════════════════════════════════════════════════════════════════════
// 天赋编辑器
// ════════════════════════════════════════════════════════════════════

const GRADES: TalentGrade[] = ['SSS', 'SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F'];
const SOURCES = ['universal', 'creation', 'story'] as const;

const tName = ref('');
const tGrade = ref<TalentGrade>('A');
const tSource = ref<string>('universal');
const tDesc = ref('');
const tEntries = ref<TalentEntry[]>([]);
const tMsg = ref('');
const tErr = ref('');

const allKinds = [...new Set(TALENT_ENTRY_POOL.map((e) => e.kind))];
const customTalents = computed(() => {
  void listsVersion.value; // 依赖：刷新闸（见其声明处）
  return getCustomTalents();
});

function addEntry() {
  const first = TALENT_ENTRY_POOL[0];
  tEntries.value.push({ kind: first.kind, channel: 'universal', params: { ...first.params } });
}
function removeEntry(i: number) {
  tEntries.value.splice(i, 1);
}
function onKindChange(entry: TalentEntry, kind: string) {
  entry.kind = kind as TalentEntry['kind'];
  const preset = TALENT_ENTRY_POOL.find((e) => e.kind === kind);
  if (preset) {
    entry.params = { ...preset.params };
    entry.channel = preset.channel;
  }
}

const tValidation = computed(() => validateTalentEntries(tEntries.value));

async function saveTalent() {
  if (!tName.value.trim()) {
    tErr.value = '名称不能为空';
    return;
  }
  if (!tValidation.value.ok) {
    tErr.value = tValidation.value.reason ?? '条目校验失败';
    return;
  }
  const tpl: TalentTemplate = {
    name: tName.value.trim(),
    source: tSource.value as TalentTemplate['source'],
    grade: tGrade.value,
    description: tDesc.value.trim(),
    entries: tEntries.value,
  };
  registerCustomTalent(tpl);
  game.saveCustomTalents(getCustomTalents());
  refreshLists();
  tMsg.value = `天赋【${tpl.name}】已保存`;
  tName.value = '';
  tDesc.value = '';
  tEntries.value = [];
}
function removeTalent(name: string) {
  unregisterCustomTalent(name);
  game.saveCustomTalents(getCustomTalents());
  refreshLists();
}

// ════════════════════════════════════════════════════════════════════
// 购卡编辑器
// ════════════════════════════════════════════════════════════════════

const FORMS = ['装备', '技能', '领域', '物资', '召唤', '军团'] as const;
const ELEMENTS = ['', '火', '水', '风', '土', '雷', '光', '暗', '冰', '金'] as const;

const cName = ref('');
const cTier = ref('');
const cForm = ref('');
const cElement = ref('');
const cDesc = ref('');
const cCost = ref(20);
// 物资/素材卡的产出定义 —— 没有它的物资卡是废卡（useSupplyCard 直接拒绝）
const cYieldName = ref('');
const cYieldQty = ref(1);
const cYieldIsMaterial = ref(false);
const cMsg = ref('');
const cErr = ref('');

/** 这张卡的形态是否需要产出定义（物资/素材） */
const needsYield = computed(() => cForm.value === '物资' || cForm.value === '素材');

async function saveCard() {
  if (!cName.value.trim()) {
    cErr.value = '名称不能为空';
    return;
  }
  if (!cTier.value) {
    cErr.value = '请选择品质';
    return;
  }
  if (!cForm.value) {
    cErr.value = '请选择形态';
    return;
  }
  const id = `custom-${Date.now()}`;
  const item: CardCatalogItem = {
    id,
    name: cName.value.trim(),
    cardTier: cTier.value as CardCatalogItem['cardTier'],
    formEntry: cForm.value as CardCatalogItem['formEntry'],
    description: cDesc.value.trim(),
    cost: cCost.value,
  };
  if (cElement.value) item.element = cElement.value;
  if (needsYield.value && cYieldName.value.trim()) {
    item.yield = {
      name: cYieldName.value.trim(),
      quantity: Math.max(1, Math.round(cYieldQty.value)),
      itemType: cYieldIsMaterial.value ? '材料' : '消耗品',
    };
  }
  game.addCustomCard(item);
  refreshLists();
  cMsg.value = `卡牌【${item.name}】已添加到购卡池${
    needsYield.value && !item.yield ? '（⚠️ 未填产出，这张卡在背包里用不了）' : ''
  }`;
  cName.value = '';
  cDesc.value = '';
  cTier.value = '';
  cForm.value = '';
  cElement.value = '';
  cYieldName.value = '';
  cYieldQty.value = 1;
  cYieldIsMaterial.value = false;
}
function removeCard(id: string) {
  game.removeCustomCard(id);
  refreshLists();
}

/** 自定义卡列表（刷新闸驱动；与天赋的 customTalents 同口径） */
const customCards = computed(() => {
  void listsVersion.value;
  return game.customCards();
});

// ════════════════════════════════════════════════════════════════════
// 导入 / 导出
// ════════════════════════════════════════════════════════════════════

const fileInput = ref<HTMLInputElement | null>(null);

/** 统一的 JSON 文件下载（导出/模板共用） */
function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportContent() {
  downloadJson('custom-content.json', {
    version: 1,
    exportedAt: new Date().toISOString(),
    talents: getCustomTalents(),
    cards: game.customCards(),
  });
  cMsg.value = `已导出：${getCustomTalents().length} 条天赋、${customCards.value.length} 张卡`;
}

/**
 * 下载模板。
 *
 * 模板按 tab 给单条示例（照着填一条最省事）；也提供整包模板（多条 + 导入说明）。
 */
function downloadTemplate(scope: 'talent' | 'card' | 'bundle') {
  if (scope === 'talent') {
    downloadJson('talent-template.json', { version: 1, talents: [TALENT_TEMPLATE], cards: [] });
    tMsg.value = '天赋模板已下载（改完直接导入即可）';
    return;
  }
  if (scope === 'card') {
    downloadJson('card-template.json', { version: 1, talents: [], cards: [CARD_TEMPLATE] });
    cMsg.value = '卡牌模板已下载（改完直接导入即可）';
    return;
  }
  downloadJson('custom-content-template.json', buildTemplateBundle());
  cMsg.value = '整包模板已下载（含导入说明）';
}

async function importContent(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    // 🔴 走与读档同一套宽读函数：形状不对的条目**丢弃**而不是注册垃圾进注册表
    //    （此前直接 registerCustomTalent(raw)，模板里的示例/半成品会污染池子）
    const talents = coerceCustomTalents(raw.talents);
    const cards = coerceCustomCards(raw.cards);
    for (const t of talents) registerCustomTalent(t);
    if (talents.length) game.saveCustomTalents(getCustomTalents());
    for (const c of cards) game.addCustomCard(c);
    refreshLists();

    const skippedT = (Array.isArray(raw.talents) ? raw.talents.length : 0) - talents.length;
    const skippedC = (Array.isArray(raw.cards) ? raw.cards.length : 0) - cards.length;
    const skipNote =
      skippedT + skippedC > 0 ? `（跳过 ${skippedT} 条天赋、${skippedC} 张卡：形状不合法）` : '';
    cMsg.value = `导入完成：${talents.length} 条天赋、${cards.length} 张卡${skipNote}`;
  } catch (err) {
    cErr.value = `导入失败：${err}`;
  }
  input.value = '';
}
</script>

<template>
  <div class="content-editor">
    <div class="tab-row" role="tablist">
      <button
        type="button"
        class="tab-btn"
        :class="{ active: tab === 'talent' }"
        @click="tab = 'talent'"
      >
        天赋编辑
      </button>
      <button
        type="button"
        class="tab-btn"
        :class="{ active: tab === 'card' }"
        @click="tab = 'card'"
      >
        购卡编辑
      </button>
      <span class="io-btns">
        <button type="button" class="tab-btn" title="导出 JSON" @click="exportContent">导出</button>
        <button type="button" class="tab-btn" title="从 JSON 导入" @click="fileInput?.click()">
          导入
        </button>
        <button
          type="button"
          class="tab-btn"
          :title="tab === 'talent' ? '下载天赋 JSON 模板' : '下载卡牌 JSON 模板'"
          @click="downloadTemplate(tab)"
        >
          模板
        </button>
        <input
          ref="fileInput"
          type="file"
          accept=".json"
          style="display: none"
          @change="importContent"
        />
      </span>
    </div>

    <div v-if="tab === 'talent'" class="editor-panel">
      <div class="field-row">
        <label>名称<input v-model="tName" placeholder="天赋名称" /></label>
        <label
          >品级<select v-model="tGrade">
            <option v-for="g in GRADES" :key="g" :value="g">{{ g }}</option>
          </select></label
        >
        <label
          >来源<select v-model="tSource">
            <option v-for="s in SOURCES" :key="s" :value="s">{{ s }}</option>
          </select></label
        >
      </div>
      <label class="full"
        >描述<textarea v-model="tDesc" rows="2" placeholder="天赋描述（给玩家看的）" />
      </label>

      <div class="entries-section">
        <div class="entries-head">
          <span>条目（{{ tEntries.length }}）</span>
          <AppButton size="sm" @click="addEntry">+ 添加条目</AppButton>
        </div>
        <div v-for="(entry, i) in tEntries" :key="i" class="entry-row">
          <select
            :value="entry.kind"
            @change="onKindChange(entry, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="k in allKinds" :key="k" :value="k">{{ k }}</option>
          </select>
          <input
            :value="JSON.stringify(entry.params)"
            placeholder='参数 JSON，如 {"bonus": 20}'
            @change="
              try {
                entry.params = JSON.parse(($event.target as HTMLInputElement).value);
              } catch {
                /* ignore */
              }
            "
          />
          <button type="button" class="remove-btn" @click="removeEntry(i)">✕</button>
        </div>
        <p v-if="tEntries.length > 0 && !tValidation.ok" class="warn">{{ tValidation.reason }}</p>
      </div>

      <p v-if="tMsg" class="ok-msg">{{ tMsg }}</p>
      <p v-if="tErr" class="err-msg">{{ tErr }}</p>
      <AppButton variant="primary" :disabled="!tName.trim() || !tValidation.ok" @click="saveTalent"
        >保存天赋</AppButton
      >

      <div v-if="customTalents.length" class="custom-list">
        <span>已保存（{{ customTalents.length }}）：</span>
        <span
          v-for="t in customTalents"
          :key="t.name"
          class="chip"
          title="点击删除"
          @click="removeTalent(t.name)"
          >{{ t.name }} ✕</span
        >
      </div>
    </div>

    <div v-if="tab === 'card'" class="editor-panel">
      <div class="field-row">
        <label>名称<input v-model="cName" placeholder="卡牌名称" /></label>
        <label
          >品质<select v-model="cTier">
            <option value="" disabled>品质</option>
            <option v-for="t in CARD_TIERS" :key="t" :value="t">{{ t }}</option>
          </select></label
        >
        <label
          >形态<select v-model="cForm">
            <option value="" disabled>形态</option>
            <option v-for="f in FORMS" :key="f" :value="f">{{ f }}</option>
          </select></label
        >
      </div>
      <div class="field-row">
        <label
          >元素<select v-model="cElement">
            <option value="">无</option>
            <option v-for="e in ELEMENTS.slice(1)" :key="e" :value="e">{{ e }}</option>
          </select></label
        >
        <label
          >代价<input v-model.number="cCost" type="number" min="0" placeholder="转生点"
        /></label>
      </div>
      <label class="full">描述<textarea v-model="cDesc" rows="2" placeholder="卡牌描述" /></label>

      <!-- 物资/素材卡必须有产出定义，否则进背包也用不了（useSupplyCard 直接拒绝） -->
      <div v-if="needsYield" class="field-row yield-row">
        <label
          >产出物品<input v-model="cYieldName" placeholder="产出的物品名（留空 = 用不了）"
        /></label>
        <label>数量<input v-model.number="cYieldQty" type="number" min="1" step="1" /></label>
        <label class="check-label"
          ><input v-model="cYieldIsMaterial" type="checkbox" />产出为制卡素材</label
        >
      </div>

      <p v-if="cMsg" class="ok-msg">{{ cMsg }}</p>
      <p v-if="cErr" class="err-msg">{{ cErr }}</p>
      <AppButton variant="primary" :disabled="!cName.trim() || !cTier || !cForm" @click="saveCard"
        >添加到购卡池</AppButton
      >

      <div v-if="customCards.length > 0" class="custom-list">
        <span>自定义卡（{{ customCards.length }}）：</span>
        <span
          v-for="c in customCards"
          :key="c.id"
          class="chip"
          title="点击删除"
          @click="removeCard(c.id)"
          >{{ c.name }} ✕</span
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
.content-editor {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.tab-row {
  display: flex;
  gap: 0.25rem;
}
.tab-btn {
  padding: 0.4rem 1rem;
  border: 1px solid var(--bg-dark);
  background: transparent;
  cursor: pointer;
  border-radius: 0.25rem 0.25rem 0 0;
}
.tab-btn.active {
  background: var(--bg-dark);
  color: var(--text-bright);
}
.editor-panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem;
  border: 1px solid var(--bg-dark);
  border-radius: 0 0.25rem 0.25rem;
}
.field-row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.field-row label {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.75rem;
  flex: 1;
  min-width: 100px;
}
.full {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.75rem;
}
/* 产出定义行：勾选项与输入框同排，不撑成整列 */
.yield-row {
  border-left: 2px solid var(--bg-dark);
  padding-left: 0.5rem;
}
.field-row label.check-label {
  flex: 0 0 auto;
  flex-direction: row;
  align-items: center;
  gap: 0.3rem;
  align-self: flex-end;
  padding-bottom: 0.3rem;
}
.field-row label.check-label input {
  width: auto;
}
input,
select,
textarea {
  padding: 0.3rem;
  border: 1px solid var(--bg-dark);
  border-radius: 0.25rem;
  background: var(--bg-light);
  color: var(--text);
  font-size: 0.85rem;
}
.entries-section {
  border: 1px dashed var(--bg-dark);
  padding: 0.5rem;
  border-radius: 0.25rem;
}
.entries-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.35rem;
}
.entry-row {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.35rem;
  align-items: center;
}
.entry-row select {
  flex: 0 0 130px;
}
.entry-row input {
  flex: 1;
  font-size: 0.75rem;
  font-family: monospace;
}
.remove-btn {
  background: none;
  border: none;
  color: var(--danger, #e74c3c);
  cursor: pointer;
  font-size: 0.85rem;
}
.custom-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  font-size: 0.75rem;
}
.chip {
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--bg-dark);
  border-radius: 1rem;
  cursor: pointer;
  font-size: 0.75rem;
}
.chip:hover {
  background: var(--bg-dark);
}
.ok-msg {
  color: var(--success, #2ecc71);
  font-size: 0.8rem;
}
.err-msg,
.warn {
  color: var(--danger, #e74c3c);
  font-size: 0.8rem;
}
</style>
