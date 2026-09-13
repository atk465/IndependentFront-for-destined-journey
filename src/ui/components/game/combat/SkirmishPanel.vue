<script setup lang="ts">
/**
 * SkirmishPanel.vue — 交锋拍制战斗面板（卡牌工坊 战斗形态改版 §8）
 *
 * 战报审计行走正文流（pipeline emitMessage），本面板只承载**活的战斗状态**：
 * 双方 HP / 本拍敌方意图（读招）/ 反制通道（基础应对三选一 + 出卡增强）/
 * 撤退。终局后显示评价徽记，按钮全部禁用——数值不在这里算，在这里只读。
 */
import { computed } from 'vue';
import type { CardItem } from '@engine/types';
import { useGameStore } from '../../../stores/game-store';
import type { BasicCounter } from '@engine/card-workshop/skirmish';
import { BASIC_COUNTERS } from '@engine/card-workshop/skirmish';
import { cardCombatTags } from '@engine/card-workshop/entry-combat';
import { cardTierVar } from '../../../lib/quality-colors';

const game = useGameStore();
const session = computed(() => game.skirmishSession);
const currentIntent = computed(() => {
  const s = session.value;
  if (!s || s.finished !== null) return null;
  return s.intents[s.beat] ?? null;
});
/** 出卡通道：未启封、未损坏的背包卡（会话层装配战力与标签） */
const cardOptions = computed(() => {
  const cards: CardItem[] = [];
  for (const item of game.player?.inventory ?? []) {
    if (item.type !== '卡牌') continue;
    const card = item as CardItem;
    if (card.sealed === true || card.data?.damaged === true) continue;
    cards.push(card);
  }
  return cards.map((c) => ({ name: c.name, cardTier: c.cardTier, tags: cardCombatTags(c.词条) }));
});

function onCounter(move: BasicCounter) {
  void game.submitSkirmishCounter({ kind: '应对', move });
}
function onCard(name: string) {
  void game.submitSkirmishCounter({ kind: '卡', name });
}
function onFlee() {
  void game.fleeSkirmish();
}
function dismiss() {
  game.setSkirmishSession(null);
}
</script>

<template>
  <!-- 终局后收成一条紧凑横幅：评价在正文流，这里只留出口 -->
  <section
    v-if="session && session.finished"
    class="skirmish-panel is-done"
    role="region"
    aria-label="交锋终局"
  >
    <span>战斗结束</span>
    <span class="finish-badge" :class="session.finished">{{ session.finished }}</span>
    <span class="done-hint">战报见正文</span>
    <button type="button" class="counter-btn" @click="dismiss">收起</button>
  </section>

  <!-- 交锋中：悬浮 HUD（战报审计行走正文流，这里只承载活状态与反制入口） -->
  <section v-else-if="session" class="skirmish-panel" role="region" aria-label="交锋拍战斗">
    <header class="skirmish-head">
      <h3>战斗模式 · 交锋拍</h3>
      <span class="beat-badge">第 {{ session.beat + 1 }} / {{ session.intents.length }} 拍</span>
    </header>

    <div class="hp-row">
      <div class="hp-block">
        <div class="hp-head">
          <span class="hp-name">{{ session.enemyName }}</span>
          <span class="hp-level">Lv.{{ session.enemyLevel }}</span>
          <span class="hp-text">{{ session.enemyHp }}/{{ session.enemyMaxHp }}</span>
        </div>
        <div class="hp-bar foe">
          <div
            class="hp-fill"
            :style="{ width: `${(session.enemyHp / Math.max(1, session.enemyMaxHp)) * 100}%` }"
          />
        </div>
      </div>
      <div class="hp-block">
        <div class="hp-head">
          <span class="hp-name">你</span>
          <span class="hp-text">{{ session.playerHp }}/{{ session.playerMaxHp }}</span>
        </div>
        <div class="hp-bar mine">
          <div
            class="hp-fill"
            :style="{ width: `${(session.playerHp / Math.max(1, session.playerMaxHp)) * 100}%` }"
          />
        </div>
      </div>
    </div>

    <p v-if="currentIntent" class="intent-line">
      ▶ {{ currentIntent.move }}（威胁 {{ currentIntent.threat }} ｜ 可反制：{{
        currentIntent.counters.join(' / ')
      }})
    </p>

    <div v-if="!session.finished" class="counter-row">
      <button
        v-for="m in BASIC_COUNTERS"
        :key="m"
        type="button"
        class="counter-btn"
        :disabled="game.skirmishBusy"
        @click="onCounter(m)"
      >
        {{ m }}
      </button>
      <button type="button" class="counter-btn flee" :disabled="game.skirmishBusy" @click="onFlee">
        撤退
      </button>
    </div>

    <div
      v-if="!session.finished && cardOptions.length > 0"
      class="card-strip"
      role="list"
      aria-label="出卡反制"
    >
      <span class="strip-label">出卡</span>
      <button
        v-for="c in cardOptions"
        :key="c.name"
        type="button"
        class="strip-card"
        role="listitem"
        :disabled="game.skirmishBusy"
        :title="c.tags.length > 0 ? `${c.name}｜反制：${c.tags.join('/')}` : c.name"
        @click="onCard(c.name)"
      >
        <span class="tier-dot" :style="{ background: cardTierVar(c.cardTier) }" />
        {{ c.name }}
        <span v-if="c.tags.length > 0" class="tag-hint">{{ c.tags.join('·') }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.skirmish-panel {
  position: fixed;
  bottom: 96px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 900;
  width: min(46rem, 92vw);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid var(--theme-card-border, #72502d);
  border-radius: var(--theme-radius-md, 6px);
  background: color-mix(in srgb, var(--theme-card-bg, #211810) 94%, transparent);
  backdrop-filter: blur(3px);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  color: var(--theme-text-primary, #eadcc5);
}
.skirmish-panel.is-done {
  bottom: 72px;
  width: auto;
  max-width: min(32rem, 90vw);
  flex-direction: row;
  align-items: center;
  gap: 10px;
}
.done-hint {
  font-size: 0.75rem;
  color: var(--theme-text-muted, #967756);
}
.skirmish-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.skirmish-head h3 {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--theme-text-primary, #eadcc5);
}
.beat-badge,
.finish-badge {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--theme-primary-bg, rgba(196, 140, 75, 0.15));
  color: var(--theme-accent, #d2a25f);
}
.finish-badge.胜利,
.finish-badge.碾压 {
  background: rgba(120, 185, 109, 0.18);
  color: var(--theme-success, #78b96d);
}
.finish-badge.撤退 {
  background: var(--theme-surface-muted, #1a130d);
  color: var(--theme-text-muted, #967756);
}
.finish-badge.败北 {
  background: rgba(204, 89, 75, 0.2);
  color: var(--theme-error, #cc594b);
}
.hp-row {
  display: flex;
  gap: 12px;
}
.hp-block {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hp-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.hp-name {
  font-weight: 600;
  color: var(--theme-text-primary, #eadcc5);
}
.hp-level {
  font-size: 0.75rem;
  color: var(--theme-text-muted, #967756);
}
.hp-text {
  margin-left: auto;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--theme-text-secondary, #c7a77e);
}
.hp-bar {
  height: 8px;
  border-radius: 4px;
  background: var(--theme-surface-muted, #1a130d);
  border: 1px solid var(--theme-card-border, #72502d);
  overflow: hidden;
}
.hp-fill {
  height: 100%;
  transition: width 0.3s ease;
}
.hp-bar.foe .hp-fill {
  background: var(--theme-hp, #b94636);
}
.hp-bar.mine .hp-fill {
  background: var(--theme-success, #78b96d);
}
.intent-line {
  margin: 0;
  font-size: 0.875rem;
  color: var(--theme-text-secondary, #c7a77e);
}
.counter-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.counter-btn {
  padding: 4px 14px;
  border-radius: var(--theme-radius-sm, 4px);
  border: 1px solid var(--theme-card-border, #72502d);
  background: var(--theme-surface-muted, #1a130d);
  color: var(--theme-text-primary, #eadcc5);
  cursor: pointer;
}
.counter-btn:hover:not(:disabled) {
  background: var(--theme-primary-bg, rgba(196, 140, 75, 0.15));
  border-color: var(--theme-primary, #c48c4b);
}
.counter-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.counter-btn.flee {
  margin-left: auto;
}
.card-strip {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.strip-label {
  font-size: 0.6875rem;
  color: var(--theme-text-muted, #967756);
}
.strip-card {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--theme-card-border, #72502d);
  background: var(--theme-surface-muted, #1a130d);
  color: var(--theme-text-primary, #eadcc5);
  cursor: pointer;
  font-size: 0.8125rem;
}
.strip-card:hover:not(:disabled) {
  background: var(--theme-primary-bg, rgba(196, 140, 75, 0.15));
  border-color: var(--theme-primary, #c48c4b);
}
.strip-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.tier-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.tag-hint {
  font-size: 0.6875rem;
  color: var(--theme-text-muted, #967756);
}
</style>
