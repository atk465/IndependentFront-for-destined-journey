<script setup lang="ts">
/**
 * CombatDeckStrip.vue — 战斗卡组条（卡牌工坊可玩闭环 1.4）
 *
 * 显示本局带入的卡组（编组快照）与四态：可用 / 生效中（装备光环）/
 * 伙伴在场（召唤绑定）/ 本局已耗（封印破裂的消耗卡）——会话临时账的可视化。
 * 点击 = 把「打出X」提交进战斗文本通道（submitCombatIntent：解析器快路优先、
 * AI 主持人兜底）——不开第二条命令直发路径（共识 1.4）。
 */
import { computed } from 'vue';
import { useGameStore } from '../../../stores/game-store';
import { cardTierVar } from '../../../lib/quality-colors';

const game = useGameStore();
const strip = computed(() => game.combatDeckStripStates);

const STATE_STYLE: Record<string, string> = {
  可用: '',
  生效中: 'active',
  伙伴在场: 'active',
  本局已耗: 'spent',
};

function onCard(name: string, state: string) {
  if (state !== '可用') return; // 生效中/伙伴在场被内核拒绝、已耗不可再打——点击无意义
  void game.submitCombatIntent(`打出${name}`);
}
</script>

<template>
  <div v-if="(strip ?? []).length > 0" class="deck-strip" role="list" aria-label="本局卡组">
    <span class="strip-label">卡组</span>
    <button
      v-for="c in strip"
      :key="c.name"
      type="button"
      class="strip-card"
      :class="STATE_STYLE[c.state]"
      role="listitem"
      :title="`${c.name}（${c.cardTier}｜${c.state}）`"
      :disabled="c.state !== '可用'"
      @click="onCard(c.name, c.state)"
    >
      <span class="tier-dot" :style="{ background: cardTierVar(c.cardTier) }" />
      <span class="strip-name" :style="{ color: cardTierVar(c.cardTier) }">{{ c.name }}</span>
      <span v-if="c.state !== '可用'" class="strip-state">{{ c.state }}</span>
    </button>
  </div>
</template>

<style scoped>
.deck-strip {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--theme-spacing-xs);
  padding: var(--theme-spacing-xs) var(--theme-spacing-sm);
}
.strip-label {
  font-size: 0.6875rem;
  color: var(--theme-text-muted);
  flex-shrink: 0;
}
.strip-card {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  min-height: 24px;
  font-family: inherit;
  font-size: 0.6875rem;
  background: var(--theme-surface-muted);
  border: 1px solid var(--theme-card-border);
  border-radius: var(--theme-radius-sm);
  color: var(--theme-text-secondary);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}
.strip-card:hover:not(:disabled) {
  background: var(--theme-tab-hover-bg);
  color: var(--theme-text-primary);
}
.strip-card:disabled {
  cursor: default;
  opacity: 0.65;
}
.strip-card.active {
  border-color: color-mix(in srgb, var(--theme-primary) 30%, var(--theme-card-border));
  background: color-mix(in srgb, var(--theme-primary) 8%, var(--theme-card-bg));
}
.strip-card.spent {
  text-decoration: line-through;
  opacity: 0.5;
}
.tier-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.strip-name {
  font-weight: 600;
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.strip-state {
  font-size: 0.625rem;
  color: var(--theme-text-muted);
}
</style>
