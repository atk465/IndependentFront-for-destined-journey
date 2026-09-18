<script setup lang="ts">
/**
 * ContentEditor.vue — 开发者模式自定义内容编辑器（天赋 + 购卡池）
 *
 * 两个标签页：天赋编辑器 / 购卡编辑器。
 * 数据走 game-store 的 customTalents / customCards 通道（worldFlags 持久化）。
 * 天赋提交前走 validateTalentEntries 校验（AI 零编数门禁照旧）。
 */
import { computed, ref } from 'vue';
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
import AppButton from '../shared/AppButton.vue';

const game = useGameStore();
const tab = ref<'talent' | 'card'>('talent');

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
const customTalents = computed(() => getCustomTalents());

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
  tMsg.value = `天赋【${tpl.name}】已保存`;
  tName.value = '';
  tDesc.value = '';
  tEntries.value = [];
}
function removeTalent(name: string) {
  unregisterCustomTalent(name);
  game.saveCustomTalents(getCustomTalents());
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
const cMsg = ref('');
const cErr = ref('');

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
  game.addCustomCard(item);
  cMsg.value = `卡牌【${item.name}】已添加到购卡池`;
  cName.value = '';
  cDesc.value = '';
  cTier.value = '';
  cForm.value = '';
  cElement.value = '';
}
function removeCard(id: string) {
  game.removeCustomCard(id);
}

// ════════════════════════════════════════════════════════════════════
// 导入 / 导出
// ════════════════════════════════════════════════════════════════════

const fileInput = ref<HTMLInputElement | null>(null);

function exportContent() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    talents: getCustomTalents(),
    cards: game.customCards(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'custom-content.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function importContent(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    if (Array.isArray(raw.talents)) {
      for (const t of raw.talents) registerCustomTalent(t);
      game.saveCustomTalents(getCustomTalents());
    }
    if (Array.isArray(raw.cards)) {
      for (const c of raw.cards) game.addCustomCard(c);
    }
    cMsg.value = `导入完成：${raw.talents?.length ?? 0} 条天赋、${raw.cards?.length ?? 0} 张卡`;
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

      <p v-if="cMsg" class="ok-msg">{{ cMsg }}</p>
      <p v-if="cErr" class="err-msg">{{ cErr }}</p>
      <AppButton variant="primary" :disabled="!cName.trim() || !cTier || !cForm" @click="saveCard"
        >添加到购卡池</AppButton
      >

      <div v-if="game.customCardCount() > 0" class="custom-list">
        <span>自定义卡（{{ game.customCardCount() }}）：</span>
        <span
          v-for="c in game.customCards()"
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
