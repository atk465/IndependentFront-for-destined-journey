<script setup lang="ts">
/**
 * CreateStepSelections — Step 5: 开局购卡（2026-09-16 卡牌化）
 *
 * 旧 CDN 装备/道具/技能目录退役。卡来自内容仓 catalog.cardPool，
 * 按可战斗四类（装备/技能/领域/物资）分栏选购，点数按 cardTier 计价。
 * 提交时由 store 确定性构造 CardItem 直落卡组（含白铁保底两张）。
 */
import { computed } from 'vue';
import { useCreateStore } from '../../stores/create-store';
import { STARTER_CARDS } from '@engine/start-catalog';
import CategoryTabs from './CategoryTabs.vue';

const store = useCreateStore();

const categories = computed(() =>
  store.CARD_CATEGORIES.map((key) => ({
    key,
    label: `${key}卡`,
    count: store.cardPool.filter((c) => c.formEntry === key).length,
  })),
);
</script>

<template>
  <section class="step-cards">
    <h2 class="step-title">开局购卡</h2>
    <p class="step-desc">
      用转生点预先购入铭卡，开局即入卡组、交锋可打。召唤卡与军团卡不做开局售卖——伙伴要在故事里相遇。
    </p>

    <div class="starter-note">
      <span class="starter-badge">自带保底</span>
      <span v-for="c in STARTER_CARDS" :key="c.id" class="starter-card">
        {{ c.name }}（{{ c.cardTier }}·{{ c.formEntry }}）
      </span>
      <span class="starter-hint">零点赠送，已入本命卡组</span>
    </div>

    <CategoryTabs
      :categories="categories"
      :model-value="store.activeCardCategory"
      @update:model-value="store.activeCardCategory = $event as never"
    />

    <div class="card-list">
      <button
        v-for="card in store.filteredCards"
        :key="card.id"
        type="button"
        class="card-row"
        :class="{
          selected: store.isCardSelected(card),
          disabled: !store.canSelectCard(card),
        }"
        :aria-pressed="store.isCardSelected(card)"
        @click="store.toggleCard(card)"
      >
        <span class="card-check">{{ store.isCardSelected(card) ? '✓' : '' }}</span>
        <span class="card-name">{{ card.name }}</span>
        <span class="card-tier">{{ card.cardTier }}</span>
        <span v-if="card.element" class="card-element">{{ card.element }}</span>
        <span class="card-desc">{{ card.description }}</span>
        <span class="card-cost">{{ card.cost }} 点</span>
      </button>
      <p v-if="store.filteredCards.length === 0" class="empty">
        该分类暂无可购铭卡（装内容包后到此选购）
      </p>
    </div>

    <div class="buy-summary">
      <span>已购 {{ store.selectedCards.length }} 张 · 计 {{ store.cardCost }} 点</span>
      <span>剩余转生点 {{ store.remainingPoints }}</span>
    </div>
  </section>
</template>

<style scoped>
.step-cards {
  max-width: 100%;
}
.step-title {
  font-family: var(--theme-font-title, serif);
  color: var(--theme-text-primary);
  font-size: 1.3rem;
  margin-bottom: var(--theme-spacing-xs);
}
.step-desc {
  color: var(--theme-text-secondary);
  font-size: 0.85rem;
  margin-bottom: var(--theme-spacing-md);
  line-height: 1.6;
}
.starter-note {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--theme-spacing-sm);
  padding: var(--theme-spacing-sm) var(--theme-spacing-md);
  margin-bottom: var(--theme-spacing-md);
  border: 1px dashed color-mix(in srgb, var(--theme-success) 40%, var(--theme-card-border));
  border-radius: var(--theme-radius-md);
  background: color-mix(in srgb, var(--theme-success) 6%, transparent);
  font-size: 0.8rem;
}
.starter-badge {
  padding: 1px 8px;
  border-radius: var(--theme-radius-sm);
  background: color-mix(in srgb, var(--theme-success) 18%, transparent);
  color: var(--theme-success);
  font-weight: 700;
  font-size: 0.7rem;
}
.starter-card {
  color: var(--theme-text-primary);
  font-weight: 600;
}
.starter-hint {
  color: var(--theme-text-muted);
  font-size: 0.7rem;
}
.card-list {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-xs);
}
.card-row {
  display: grid;
  grid-template-columns: 1.6em minmax(8em, auto) 3.5em 2em minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--theme-spacing-sm);
  padding: var(--theme-spacing-xs) var(--theme-spacing-md);
  border: 1px solid var(--theme-card-border);
  border-radius: var(--theme-radius-md);
  background: var(--theme-card-bg);
  color: var(--theme-text-primary);
  text-align: left;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all var(--theme-transition-fast);
}
.card-row:hover:not(.disabled) {
  border-color: var(--theme-color-primary);
  background: color-mix(in srgb, var(--theme-color-primary) 6%, var(--theme-card-bg));
}
.card-row.selected {
  border-color: var(--theme-color-primary);
  box-shadow: 0 0 0 1px var(--theme-color-primary);
  background: color-mix(in srgb, var(--theme-color-primary) 8%, var(--theme-card-bg));
}
.card-row.disabled {
  opacity: 0.45;
  cursor: not-allowed;
  filter: grayscale(40%);
}
.card-check {
  width: 1.4em;
  height: 1.4em;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--theme-card-border);
  font-size: 0.75em;
  color: var(--theme-color-primary);
  font-weight: 700;
}
.card-row.selected .card-check {
  background: var(--theme-color-primary);
  border-color: var(--theme-color-primary);
  color: var(--theme-primary-text);
}
.card-name {
  font-weight: 700;
}
.card-tier {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--theme-text-secondary);
  text-align: center;
  border: 1px solid var(--theme-card-border);
  border-radius: var(--theme-radius-sm);
  padding: 0 0.4em;
}
.card-element {
  font-size: 0.75rem;
  color: var(--theme-text-secondary);
  text-align: center;
}
.card-desc {
  font-size: 0.75rem;
  color: var(--theme-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-cost {
  font-weight: 700;
  color: var(--theme-quality-rare, #3f7fd4);
  font-variant-numeric: tabular-nums;
}
.empty {
  text-align: center;
  color: var(--theme-text-muted);
  padding: var(--theme-spacing-lg) 0;
  font-size: 0.85em;
}
.buy-summary {
  display: flex;
  justify-content: space-between;
  gap: var(--theme-spacing-md);
  margin-top: var(--theme-spacing-md);
  padding: var(--theme-spacing-sm) var(--theme-spacing-md);
  background: var(--theme-surface-muted);
  border: 1px solid var(--theme-card-border);
  border-radius: var(--theme-radius-md);
  font-size: 0.8rem;
  color: var(--theme-text-secondary);
}
</style>
