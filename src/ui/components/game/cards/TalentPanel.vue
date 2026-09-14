<script setup lang="ts">
/**
 * TalentPanel.vue — 天赋面板（卡牌工坊 天赋系统 T-S3，访谈共识 T1~T8）
 *
 * 列表（名字/描述/骨架条目摘要）+ 遗忘（无返还、二次确认）+ 融合工作台
 * （选两源 → fuseEntrySets 对消预览 → AI/玩家起名 → 执行）。
 * 数值不在这里算——预览调引擎纯函数，提交走 store 门禁通道。
 */
import { computed, ref } from 'vue';
import { useGameStore } from '../../../stores/game-store';
import { fuseEntrySets, type TalentEntry } from '@engine/card-workshop/talent-entry';

const game = useGameStore();
const talents = computed(() => game.player?.talents ?? { capacity: 3, list: [] });

/** 遗忘确认的两步态 */
const forgetCandidate = ref<string | null>(null);

/** 融合工作台：两个源 + 产物名/描述 */
const fuseA = ref<string | null>(null);
const fuseB = ref<string | null>(null);
const fuseName = ref('');
const fuseDesc = ref('');
const fuseFeedback = ref<{ kind: 'ok' | 'err'; msg: string } | null>(null);

const entryLine = (e: TalentEntry): string => {
  const p = e.params;
  switch (e.kind) {
    case '材料限定':
      return `材料限定（${p.materialClass ?? '不限'}）成功率+30%`;
    case '成品限定':
      return `成品限定（${p.productClass ?? '不限'}）`;
    case '成功率加成':
      return `成功率+${p.bonus ?? 0}%`;
    case '品质锁定':
      return `品质${p.direction ?? ''}：${p.tier ?? ''}`;
    case '品质突破':
      return `品质越一级（域：${p.productClass ?? p.materialClass ?? '不限'}）`;
    case '启封加值':
      return `启封判定+${p.amount ?? 0}`;
    case '行动值加成':
      return `行动值+${p.amount ?? 0}`;
    case '防御加值':
      return `防御+${p.amount ?? 0}`;
    default:
      return e.kind;
  }
};

/** 融合预览：对消规则与执行结果一致（同一引擎纯函数） */
const fusePreview = computed<(TalentEntry | TalentEntry)[] | null>(() => {
  if (!fuseA.value || !fuseB.value || fuseA.value === fuseB.value) return null;
  const a = talents.value.list.find((t) => t.name === fuseA.value);
  const b = talents.value.list.find((t) => t.name === fuseB.value);
  if (!a || !b) return null;
  return fuseEntrySets(a.entries, b.entries);
});

async function onForget(name: string) {
  if (forgetCandidate.value !== name) {
    forgetCandidate.value = name;
    return;
  }
  forgetCandidate.value = null;
  await game.forgetTalent(name);
}

async function onFuse() {
  if (!fuseA.value || !fuseB.value || !fuseName.value.trim()) return;
  const r = await game.fuseTalents(fuseA.value, fuseB.value, fuseName.value, fuseDesc.value);
  fuseFeedback.value = r.ok
    ? { kind: 'ok', msg: `融合完成——诞生了【${fuseName.value.trim()}】` }
    : { kind: 'err', msg: r.reason ?? '融合失败' };
  if (r.ok) {
    fuseA.value = null;
    fuseB.value = null;
    fuseName.value = '';
    fuseDesc.value = '';
  }
}
</script>

<template>
  <section class="talent-panel" aria-label="天赋">
    <header class="talent-head">
      <span class="capacity">天赋位 {{ talents.list.length }} / {{ talents.capacity }}</span>
    </header>

    <p v-if="talents.list.length === 0" class="talent-empty">
      尚无天赋——出身、剧情机缘或声望兑换皆可获得。
    </p>

    <ul class="talent-list">
      <li v-for="t in talents.list" :key="t.name" class="talent-item">
        <div class="talent-row">
          <div class="talent-info">
            <span class="talent-name">{{ t.name }}</span>
            <span v-if="t.description" class="talent-desc">{{ t.description }}</span>
            <span class="talent-entries">{{ t.entries.map(entryLine).join('，') }}</span>
          </div>
          <button type="button" class="talent-btn" @click="onForget(t.name)">
            {{ forgetCandidate === t.name ? '确认遗忘？' : '遗忘' }}
          </button>
        </div>
      </li>
    </ul>

    <div class="fuse-zone">
      <p class="fuse-title">融合工作台</p>
      <p class="fuse-hint">
        选两源天赋 → 骨架条目化学反应（品质保底 + 品质上限 = 品质突破）→ 为产物起名。
        名字与描述可以交给 AI，也可以自己写。
      </p>
      <div class="fuse-row">
        <select v-model="fuseA" class="fuse-select" aria-label="融合源一">
          <option :value="null" disabled>源天赋一</option>
          <option v-for="t in talents.list" :key="t.name" :value="t.name">{{ t.name }}</option>
        </select>
        <span class="fuse-plus">+</span>
        <select v-model="fuseB" class="fuse-select" aria-label="融合源二">
          <option :value="null" disabled>源天赋二</option>
          <option v-for="t in talents.list" :key="t.name" :value="t.name">{{ t.name }}</option>
        </select>
      </div>
      <template v-if="fusePreview">
        <div class="fuse-preview">
          <span class="fuse-preview-label">产物条目预览：</span>
          <span v-for="(e, i) in fusePreview" :key="i" class="fuse-entry">{{ entryLine(e) }}</span>
        </div>
        <input v-model="fuseName" class="fuse-name" placeholder="为融合产物起个名字…" />
        <textarea
          v-model="fuseDesc"
          class="fuse-desc"
          rows="2"
          placeholder="描述它的表现（可留空，交给 AI 补写）…"
        ></textarea>
        <button type="button" class="talent-btn primary" @click="onFuse">执 行 融 合</button>
        <p v-if="fuseFeedback" class="fuse-feedback" :class="fuseFeedback.kind">
          {{ fuseFeedback.msg }}
        </p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.talent-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.talent-head {
  display: flex;
  justify-content: flex-end;
}
.capacity {
  font-size: 0.875rem;
  color: var(--theme-accent, #d2a25f);
}
.talent-empty {
  margin: 0;
  color: var(--theme-text-muted, #967756);
}
.talent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.talent-item {
  border: 1px solid var(--theme-card-border, #72502d);
  border-radius: var(--theme-radius-md, 6px);
  background: var(--theme-surface-muted, #1a130d);
}
.talent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}
.talent-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.talent-name {
  font-weight: 600;
  color: var(--theme-text-primary, #eadcc5);
}
.talent-desc {
  font-size: 0.8125rem;
  color: var(--theme-text-secondary, #c7a77e);
}
.talent-entries {
  font-size: 0.75rem;
  color: var(--theme-text-muted, #967756);
}
.talent-btn {
  padding: 4px 12px;
  border-radius: var(--theme-radius-sm, 4px);
  border: 1px solid var(--theme-card-border, #72502d);
  background: var(--theme-card-bg, #211810);
  color: var(--theme-text-primary, #eadcc5);
  cursor: pointer;
  white-space: nowrap;
}
.talent-btn:hover {
  border-color: var(--theme-primary, #c48c4b);
}
.talent-btn.primary {
  background: var(--theme-primary-bg, rgba(196, 140, 75, 0.15));
  border-color: var(--theme-primary, #c48c4b);
  color: var(--theme-accent, #d2a25f);
}
.fuse-zone {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px dashed var(--theme-card-border, #72502d);
  border-radius: var(--theme-radius-md, 6px);
}
.fuse-title {
  margin: 0;
  font-weight: 600;
  color: var(--theme-text-primary, #eadcc5);
}
.fuse-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--theme-text-muted, #967756);
}
.fuse-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fuse-select {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--theme-card-border, #72502d);
  border-radius: var(--theme-radius-sm, 4px);
  background: var(--theme-card-bg, #211810);
  color: var(--theme-text-primary, #eadcc5);
}
.fuse-plus {
  color: var(--theme-accent, #d2a25f);
}
.fuse-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 0.8125rem;
  color: var(--theme-text-secondary, #c7a77e);
}
.fuse-preview-label {
  color: var(--theme-text-muted, #967756);
}
.fuse-entry {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--theme-primary-bg, rgba(196, 140, 75, 0.15));
}
.fuse-name,
.fuse-desc {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--theme-card-border, #72502d);
  border-radius: var(--theme-radius-sm, 4px);
  background: var(--theme-window-bg, #120e0b);
  color: var(--theme-text-primary, #eadcc5);
  font: inherit;
  font-size: 0.875rem;
}
.fuse-desc {
  resize: vertical;
}
.fuse-feedback {
  margin: 0;
  font-size: 0.8125rem;
}
.fuse-feedback.ok {
  color: var(--theme-success, #78b96d);
}
.fuse-feedback.err {
  color: var(--theme-error, #cc594b);
}
</style>
