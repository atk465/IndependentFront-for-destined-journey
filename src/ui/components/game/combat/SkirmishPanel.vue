<script setup lang="ts">
/**
 * SkirmishPanel.vue — 交锋拍制战斗面板（卡牌工坊 战斗形态改版 §8）
 *
 * 战报审计行走正文流（pipeline emitMessage），本面板只承载**活的战斗状态**：
 * 双方 HP / 本拍敌方意图（读招）/ 反制通道（基础应对三选一 + 出卡增强，出卡可附
 * 一句宣言作终局记叙素材）/ 结束战斗（附理由）。数值不在这里算，这里只读。
 */
import { computed, ref } from 'vue';
import type { CardItem } from '@engine/types';
import { useGameStore } from '../../../stores/game-store';
import type { BasicCounter } from '@engine/card-workshop/skirmish';
import { BASIC_COUNTERS } from '@engine/card-workshop/skirmish';
import { cardCombatTags } from '@engine/card-workshop/entry-combat';
import { recommendCards } from '@engine/card-workshop/free-card-play';
import { battleReadyCards } from '@engine/card-workshop/deck-power';
import { cardTierVar } from '../../../lib/quality-colors';

const game = useGameStore();
const session = computed(() => game.skirmishSession);
const currentIntent = computed(() => {
  const s = session.value;
  if (!s || s.finished !== null || s.intents.length === 0) return null;
  return s.intents[s.beat % s.intents.length] ?? null;
});
/** 出卡通道（2026-09-17 deck 战斗化）：只能打出**编入卡组**的卡；卡组未整备时回退全背包。
 *  推荐徽章（2026-09-17 L3）：按当前敌方意图的反制标签命中数排序，命中≥1 亮「相性」。 */
const cardOptions = computed(() => {
  const all: CardItem[] = (game.player?.inventory ?? []).filter(
    (i): i is CardItem => i.type === '卡牌',
  );
  const deck = game.player?.cardAlbum?.deck ?? [];
  const used = new Set(session.value?.playedCards ?? []);
  const ranked = recommendCards(battleReadyCards(all, deck), currentIntent.value?.counters, used);
  return ranked.map((c) => ({
    name: c.name,
    cardTier: c.cardTier,
    tags: cardCombatTags(c.词条),
    used: used.has(c.name),
    counterHits: c.counterHits,
    recommended: c.recommended,
  }));
});

/** 已选中待发动的卡（点卡 → 填宣言 → 发动） */
const selectedCard = ref<string | null>(null);
const cardIntentText = ref('');
/** 结束战斗流（展开理由输入） */
const ending = ref(false);
const endReasonText = ref('');

function onCounter(move: BasicCounter) {
  void game.submitSkirmishCounter({ kind: '应对', move });
}
function onCard(name: string) {
  selectedCard.value = name;
  cardIntentText.value = '';
}
function confirmCard() {
  if (!selectedCard.value) return;
  const intent = cardIntentText.value.trim();
  void game.submitSkirmishCounter({
    kind: '卡',
    name: selectedCard.value,
    ...(intent ? { intent } : {}),
  });
  selectedCard.value = null;
  cardIntentText.value = '';
}
function cancelCard() {
  selectedCard.value = null;
  cardIntentText.value = '';
}
function onEndBattle() {
  ending.value = true;
  endReasonText.value = '';
}
function confirmEnd() {
  const reason = endReasonText.value.trim();
  void game.fleeSkirmish(reason || undefined);
  ending.value = false;
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
      <button
        type="button"
        class="counter-btn flee"
        :disabled="game.skirmishBusy"
        @click="onEndBattle"
      >
        结束战斗…
      </button>
    </div>

    <!-- 结束战斗：理由作为终局 AI 记叙的收束参考（可留空） -->
    <div v-if="ending && !session.finished" class="note-box">
      <textarea
        v-model="endReasonText"
        class="note-input"
        rows="2"
        placeholder="为何在此收手？（如：它已无战意 / 我体力见底要先撤……留空则直接脱离）"
      ></textarea>
      <div class="note-actions">
        <button type="button" class="counter-btn" :disabled="game.skirmishBusy" @click="confirmEnd">
          确认结束
        </button>
        <button type="button" class="counter-btn" @click="ending = false">继续战斗</button>
      </div>
    </div>

    <!-- 出卡宣言：纯叙事素材，数值照常结算 -->
    <div v-if="selectedCard && !session.finished" class="note-box">
      <p class="note-title">用【{{ selectedCard }}】做什么？（可留空——终局 AI 记叙会参考这句话）</p>
      <textarea
        v-model="cardIntentText"
        class="note-input"
        rows="2"
        placeholder="如：扬手掷出符卡，火线掠地烧它的后腿"
      ></textarea>
      <div class="note-actions">
        <button
          type="button"
          class="counter-btn primary"
          :disabled="game.skirmishBusy"
          @click="confirmCard"
        >
          发动
        </button>
        <button type="button" class="counter-btn" @click="cancelCard">取消</button>
      </div>
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
        :class="{ selected: selectedCard === c.name, spent: c.used }"
        role="listitem"
        :disabled="game.skirmishBusy || c.used"
        :title="
          c.used
            ? `${c.name}｜本局已用（一场一次）`
            : c.tags.length > 0
              ? `${c.name}｜反制：${c.tags.join('/')}`
              : c.name
        "
        @click="onCard(c.name)"
      >
        <span class="tier-dot" :style="{ background: cardTierVar(c.cardTier) }" />
        {{ c.name }}
        <span v-if="c.recommended" class="rec-badge">相性✓</span>
        <span v-if="c.used" class="tag-hint">已用</span>
        <span v-else-if="c.tags.length > 0" class="tag-hint">{{ c.tags.join('·') }}</span>
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
.note-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px dashed var(--theme-card-border, #72502d);
  border-radius: var(--theme-radius-sm, 4px);
  background: var(--theme-surface-muted, #1a130d);
}
.note-title {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--theme-text-secondary, #c7a77e);
}
.note-input {
  width: 100%;
  resize: vertical;
  padding: 6px 8px;
  border: 1px solid var(--theme-card-border, #72502d);
  border-radius: var(--theme-radius-sm, 4px);
  background: var(--theme-window-bg, #120e0b);
  color: var(--theme-text-primary, #eadcc5);
  font: inherit;
  font-size: 0.875rem;
}
.note-actions {
  display: flex;
  gap: 6px;
}
.counter-btn.primary {
  background: var(--theme-primary-bg, rgba(196, 140, 75, 0.15));
  border-color: var(--theme-primary, #c48c4b);
  color: var(--theme-accent, #d2a25f);
}
.strip-card.selected {
  border-color: var(--theme-primary, #c48c4b);
  background: var(--theme-primary-bg, rgba(196, 140, 75, 0.15));
}
.strip-card.spent {
  opacity: 0.45;
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
.rec-badge { font-size: 0.625rem; font-weight: 700; padding: 0 5px; border-radius: 999px; color:
var(--theme-success); border: 1px solid color-mix(in srgb, var(--theme-success) 40%, transparent);
background: color-mix(in srgb, var(--theme-success) 10%, transparent); }
