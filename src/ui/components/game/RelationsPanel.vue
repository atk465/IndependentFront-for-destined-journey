<script setup lang="ts">
/**
 * RelationsPanel.vue — 关系网（2026-10-02 批次F2）
 *
 * 好感账本（SaveProfile.affections，键=角色名，±100）的全览：
 * 一行一人——名字 + 11 级标签（getAffectionLabel，仅展示不驱动行为）+ 数值条。
 * 数据只读；关系怎么演变归叙事，这里只把账本摊给玩家看。
 */
import { computed } from 'vue';
import { useGameStore } from '../../stores/game-store';
import { getAffectionLabel } from '@engine/affection-system';

const game = useGameStore();

const rows = computed(() => {
  const affections = game.saveProfile?.affections ?? {};
  return Object.entries(affections)
    .map(([name, value]) => {
      const v = Math.round(value);
      return {
        name,
        value: v,
        label: getAffectionLabel(v),
        ratio: Math.max(0, Math.min(1, (v + 100) / 200)),
        negative: v < 0,
      };
    })
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
});
</script>

<template>
  <div class="relations">
    <div v-if="rows.length === 0" class="empty-tab">
      好感账本还空着——让故事发生，名字自然会落到这里。
    </div>
    <ul v-else class="rel-list">
      <li v-for="r in rows" :key="r.name" class="rel-row">
        <span class="rel-name">{{ r.name }}</span>
        <span class="rel-label" :class="{ neg: r.negative }">{{ r.label }}</span>
        <span class="rel-bar" aria-hidden="true">
          <span
            class="rel-fill"
            :class="{ neg: r.negative }"
            :style="{ width: `${r.ratio * 100}%` }"
          />
        </span>
        <span class="rel-value" :class="{ neg: r.negative }"
          >{{ r.value > 0 ? '+' : '' }}{{ r.value }}</span
        >
      </li>
    </ul>
    <p class="rel-note">标签只是账本读数——她怎么想、会怎么做，看故事本身。</p>
  </div>
</template>

<style scoped>
.relations {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-md, 12px);
  padding: var(--theme-spacing-lg, 20px);
}
.rel-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-xs, 6px);
}
.rel-row {
  display: flex;
  align-items: center;
  gap: var(--theme-spacing-sm, 10px);
  padding: 7px 10px;
  background: var(--theme-card-bg);
  border: 1px solid var(--theme-card-border);
  border-radius: var(--theme-radius-md, 8px);
}
.rel-name {
  font-weight: 600;
  font-size: 0.875rem;
  min-width: 6em;
}
.rel-label {
  font-size: 0.6875rem;
  padding: 1px 8px;
  border-radius: 999px;
  color: var(--theme-success, #78b96d);
  border: 1px solid color-mix(in srgb, var(--theme-success, #78b96d) 40%, transparent);
  background: color-mix(in srgb, var(--theme-success, #78b96d) 10%, transparent);
  flex-shrink: 0;
}
.rel-label.neg {
  color: var(--theme-error, #cc594b);
  border-color: color-mix(in srgb, var(--theme-error, #cc594b) 40%, transparent);
  background: color-mix(in srgb, var(--theme-error, #cc594b) 10%, transparent);
}
.rel-bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--theme-surface-muted);
  border: 1px solid var(--theme-card-border);
  overflow: hidden;
}
.rel-fill {
  display: block;
  height: 100%;
  background: var(--theme-success, #78b96d);
  transition: width 0.3s ease;
}
.rel-fill.neg {
  background: var(--theme-error, #cc594b);
}
.rel-value {
  min-width: 3em;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 0.8125rem;
  color: var(--theme-text-primary);
}
.rel-value.neg {
  color: var(--theme-error, #cc594b);
}
.rel-note {
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
</style>
