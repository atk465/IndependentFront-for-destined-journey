<script setup lang="ts">
/**
 * CreateStepTalent.vue — 捏人第 3 步「出身天赋」（天赋系统 T-S3）
 *
 * 2026-09-16 二调：随机抽 8 选 1（池不足 8 全出）+ 品级徽章 + 按品级计价
 * （talentCreationPrice = 基础 10+5×(条目−1) × 品级乘数，货币为转生点）。
 * 骨架数值全部来自 TALENT_CATALOG/TALENT_ENTRY_POOL，本组件零数值逻辑。
 */
import { onMounted } from 'vue';
import { useCreateStore } from '../../stores/create-store';
import { talentExchangePrice } from '@engine/card-workshop/talent-entry';
import type { TalentTemplate } from '@engine/card-workshop/talent-entry';

const store = useCreateStore();

/** 品级定价（与 store.talentCost 同源：基础×品级乘数，转生点结算） */
function offerPrice(tpl: TalentTemplate): number {
  return talentExchangePrice(tpl);
}

const entryLines = (tpl: TalentTemplate): string[] => {
  return tpl.entries.map((e) => {
    const p = e.params;
    switch (e.kind) {
      case '材料限定':
        return `材料限定（${p.materialClass ?? '不限'}）`;
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
  store.toggleCreationTalent(name);
}

onMounted(() => {
  if (store.talentOffers.length === 0) store.rollTalentOffers();
});

function reroll() {
  store.rollTalentOffers();
}
</script>

<template>
  <div class="step-talent">
    <h2>出身天赋</h2>
    <p class="step-desc">
      每个在铭刻纪元启程的旅人，随身都带着底石写给他的第一行字。从下面抽到的天赋中选两件
      （必选，按品级计价），日后还能在冒险中习得更多、甚至融合出独一无二的新天赋。
    </p>

    <div class="talent-toolbar">
      <span class="toolbar-hint">本轮抽到 {{ store.talentOffers.length }} 份天赋</span>
      <button type="button" class="reroll-btn" @click="reroll">🎲 重抽一批</button>
    </div>

    <div class="talent-grid" role="radiogroup" aria-label="出身天赋">
      <button
        v-for="t in store.talentOffers"
        :key="t.name"
        type="button"
        class="talent-option"
        :class="{ selected: store.selectedCreationTalents.includes(t.name) }"
        role="radio"
        :aria-checked="store.selectedCreationTalents.includes(t.name)"
        :data-grade="t.grade"
        @click="pick(t.name)"
      >
        <span class="t-top">
          <span class="t-name">{{ t.name }}</span>
          <span class="t-grade" :data-grade="t.grade">{{ t.grade }}</span>
          <span class="t-price">{{ offerPrice(t) }} 点</span>
        </span>
        <span v-if="t.description" class="t-desc">{{ t.description }}</span>
        <span v-for="(line, i) in entryLines(t)" :key="i" class="t-entry">{{ line }}</span>
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
  line-height: 1.6;
}
.talent-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.toolbar-hint {
  font-size: 0.8rem;
  color: var(--theme-text-muted, #967756);
}
.reroll-btn {
  padding: 4px 14px;
  border: 1px solid var(--theme-card-border, #72502d);
  border-radius: var(--theme-radius-md, 6px);
  background: transparent;
  color: var(--theme-text-secondary, #c7a77e);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all var(--theme-transition-fast);
}
.reroll-btn:hover {
  border-color: var(--theme-primary, #c48c4b);
  color: var(--theme-primary, #c48c4b);
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
.t-top {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.t-name {
  font-weight: 600;
}
.t-grade {
  font-size: 0.6875rem;
  font-weight: 800;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--theme-card-border, #72502d);
  color: var(--theme-accent, #d2a25f);
}
.t-grade[data-grade='SSS'],
.t-grade[data-grade='SS'],
.t-grade[data-grade='S'] {
  color: var(--theme-quality-mythic, #e67e22);
  border-color: var(--theme-quality-mythic, #e67e22);
}
.t-grade[data-grade='A'] {
  color: var(--theme-quality-epic, #9b59b6);
  border-color: var(--theme-quality-epic, #9b59b6);
}
.t-price {
  margin-left: auto;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--theme-quality-rare, #3f7fd4);
  font-variant-numeric: tabular-nums;
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
