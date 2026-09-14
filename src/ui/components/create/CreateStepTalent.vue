<script setup lang="ts">
/**
 * CreateStepTalent.vue — 捏人第 9 步「出身天赋」（天赋系统 T-S3）
 *
 * 7 选 1 必选（通用池 6 + 出身独占【天才卡师】）；条目摘要只读展示——
 * 骨架数值全部来自 TALENT_CATALOG/TALENT_ENTRY_POOL，本组件零数值逻辑。
 */
import { useCreateStore } from '../../stores/create-store';
import { getCreationCatalog } from '@engine/card-workshop/talent-entry';

const store = useCreateStore();
const options = getCreationCatalog();

const entryLines = (name: string): string[] => {
  const tpl = options.find((t) => t.name === name);
  if (!tpl) return [];
  return tpl.entries.map((e) => {
    const p = e.params;
    switch (e.kind) {
      case '材料限定':
        return `材料限定（${p.materialClass ?? '不限'}）：成功率+30%`;
      case '成品限定':
        return `成品限定（${p.productClass ?? '不限'}）`;
      case '成功率加成':
        return `成功率+${p.bonus ?? 0}%`;
      case '品质锁定':
        return `品质${p.direction ?? ''}：${p.tier ?? ''}`;
      case '品质突破':
        return '品质越一级';
      case '启封加值':
        return `启封判定+${p.amount ?? 0}`;
      case '行动值加成':
        return `行动值+${p.amount ?? 0}`;
      case '防御加值':
        return `防御+${p.amount ?? 0}`;
      default:
        return e.kind;
    }
  });
};

function pick(name: string) {
  store.selectedCreationTalent = name;
}
</script>

<template>
  <div class="step-talent">
    <h2>出身天赋</h2>
    <p class="step-desc">
      每个卡兰大陆的旅人，都带着一份与生俱来的天赋启程。它是你身份的一部分（必选），
      日后还能在冒险中习得更多、甚至融合出独一无二的新天赋。
    </p>

    <div class="talent-grid" role="radiogroup" aria-label="出身天赋">
      <button
        v-for="t in options"
        :key="t.name"
        type="button"
        class="talent-option"
        :class="{ selected: store.selectedCreationTalent === t.name }"
        role="radio"
        :aria-checked="store.selectedCreationTalent === t.name"
        @click="pick(t.name)"
      >
        <span class="t-name">
          {{ t.name }}
          <span v-if="t.source === 'creation'" class="t-exclusive">出身独占</span>
        </span>
        <span v-if="t.description" class="t-desc">{{ t.description }}</span>
        <span v-for="(line, i) in entryLines(t.name)" :key="i" class="t-entry">{{ line }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.step-talent {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.step-desc {
  margin: 0;
  color: var(--theme-text-secondary, #c7a77e);
}
.talent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
.talent-option {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  text-align: left;
  border: 1px solid var(--theme-card-border, #72502d);
  border-radius: var(--theme-radius-md, 6px);
  background: var(--theme-card-bg, #211810);
  color: var(--theme-text-primary, #eadcc5);
  cursor: pointer;
}
.talent-option:hover {
  border-color: var(--theme-primary, #c48c4b);
}
.talent-option.selected {
  border-color: var(--theme-primary, #c48c4b);
  background: var(--theme-primary-bg, rgba(196, 140, 75, 0.12));
}
.t-name {
  font-weight: 600;
}
.t-exclusive {
  margin-left: 6px;
  font-size: 0.6875rem;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--theme-primary-bg, rgba(196, 140, 75, 0.15));
  color: var(--theme-accent, #d2a25f);
}
.t-desc {
  font-size: 0.8125rem;
  color: var(--theme-text-secondary, #c7a77e);
}
.t-entry {
  font-size: 0.75rem;
  color: var(--theme-text-muted, #967756);
}
</style>
