<script setup lang="ts">
/**
 * CardAlbumPanel.vue — 卡册面板（卡牌工坊 MVP）
 *
 * 三栏：卡组（当前编入，同名≤2）/ 卡包（背包里的卡牌实物）/ 详情。
 * 规则判定全部走引擎 card-workshop/album.ts 纯函数，本组件只做展示与提交；
 * 落库走 game.updateCardAlbum（update_character.cardAlbum 唯一写入口）。
 */
import { computed, ref } from 'vue';
import { useGameStore } from '../../../stores/game-store';
import { cardTierVar } from '../../../lib/quality-colors';
import type { CardAlbumState, CardItem, InventoryItem } from '@engine/types';
import {
  DEFAULT_ALBUM_CAPACITY,
  DEFAULT_DECK_SIZE,
  addCardToAlbum,
  addToDeck,
  countInDeck,
  ensureCardAlbum,
  removeFromDeck,
} from '@engine/card-workshop/album';
import { UNSEAL_SLOT_COST, unsealDC, willModifierOf } from '@engine/card-workshop/unsealing';
import AppButton from '../../shared/AppButton.vue';

const game = useGameStore();

const player = computed(() => game.player);

/** 卡牌实物以背包为真源（quantity = 同名张数）；卡册 owned 是种类收录账 */
function isCard(i: InventoryItem): i is CardItem {
  return i.type === '卡牌';
}
const cardItems = computed<CardItem[]>(() => (player.value?.inventory ?? []).filter(isCard));

const album = computed<CardAlbumState>(() => ensureCardAlbum(player.value?.cardAlbum));

/** 卡组行：名字 + 张数（保持编入顺序）；tier 按名字反查背包实物上色 */
const deckRows = computed<{ name: string; count: number }[]>(() => {
  const seen: string[] = [];
  for (const name of album.value.deck) if (!seen.includes(name)) seen.push(name);
  return seen.map((name) => ({ name, count: countInDeck(album.value.deck, name) }));
});

function tierOf(name: string): string {
  return cardItems.value.find((c) => c.name === name)?.cardTier ?? '白铁';
}

const selectedName = ref('');
const selectedCard = computed<CardItem | undefined>(
  () => cardItems.value.find((c) => c.name === selectedName.value) ?? cardItems.value[0],
);

/** 最近一次操作提示（成功清空；失败展示原因） */
const opMessage = ref('');

async function commit(next: CardAlbumState) {
  const r = await game.updateCardAlbum(next);
  opMessage.value = r.ok ? '' : (r.error ?? '卡册保存失败');
}

/** 编入一张：先幂等收录种类（含容量校验），再过同名≤2 / 卡组上限判定 */
async function engrave(card: CardItem) {
  const withSpecies = addCardToAlbum(album.value, card.name);
  if (!withSpecies.ok) {
    opMessage.value = withSpecies.reason ?? '无法收录';
    return;
  }
  const r = addToDeck(withSpecies.album, card.name);
  if (!r.ok) {
    opMessage.value = r.reason ?? '无法编入';
    return;
  }
  opMessage.value = '';
  await commit(r.album);
}

async function withdraw(name: string) {
  opMessage.value = '';
  await commit(removeFromDeck(album.value, name));
}

function selectCard(name: string) {
  selectedName.value = name;
}

/** 启封者的意志修正（精神），用于详情区预览实际对抗难度 */
const willMod = computed(() => willModifierOf(player.value?.attributes));
</script>

<template>
  <div class="card-album">
    <div class="album-summary">
      <span>卡册 {{ album.owned.length }}/{{ album.capacity || DEFAULT_ALBUM_CAPACITY }} 种</span>
      <span class="dot">·</span>
      <span>卡组 {{ album.deck.length }}/{{ DEFAULT_DECK_SIZE }} 张</span>
      <span v-if="opMessage" class="op-message" role="status">{{ opMessage }}</span>
    </div>

    <div class="album-columns">
      <!-- 卡组 -->
      <section class="album-col deck-col" aria-label="卡组">
        <h4 class="d-label">卡组（{{ album.deck.length }}/{{ DEFAULT_DECK_SIZE }}）</h4>
        <div v-if="deckRows.length === 0" class="empty-tab">卡组还空着…</div>
        <ul v-else class="card-list">
          <li v-for="row in deckRows" :key="row.name" class="deck-row">
            <span class="count-badge">×{{ row.count }}</span>
            <span class="card-name" :style="{ color: cardTierVar(tierOf(row.name)) }">{{
              row.name
            }}</span>
            <AppButton size="sm" variant="ghost" @click="withdraw(row.name)">撤出</AppButton>
          </li>
        </ul>
      </section>

      <!-- 卡包 -->
      <section class="album-col pack-col" aria-label="卡包">
        <h4 class="d-label">卡包</h4>
        <div v-if="cardItems.length === 0" class="empty-tab">还没有炼制过卡牌…</div>
        <ul v-else class="card-list">
          <li
            v-for="card in cardItems"
            :key="card.name"
            class="pack-row"
            :class="{ selected: selectedCard?.name === card.name }"
            @click="selectCard(card.name)"
          >
            <span class="tier-dot" :style="{ background: cardTierVar(card.cardTier) }" />
            <span class="card-name" :style="{ color: cardTierVar(card.cardTier) }">{{
              card.name
            }}</span>
            <span v-if="card.sealed" class="sealed-badge">未启封</span>
            <span v-if="card.quantity > 1" class="count-badge">×{{ card.quantity }}</span>
            <AppButton
              size="sm"
              variant="secondary"
              :disabled="album.deck.length >= DEFAULT_DECK_SIZE"
              @click.stop="engrave(card)"
            >
              编入
            </AppButton>
          </li>
        </ul>
      </section>

      <!-- 详情 -->
      <section class="album-col detail-col" aria-label="卡牌详情">
        <h4 class="d-label">详情</h4>
        <div v-if="!selectedCard" class="empty-tab">选一张卡看看…</div>
        <div v-else class="detail-card">
          <div class="d-header">
            <span
              class="tier-dot big"
              :style="{ background: cardTierVar(selectedCard.cardTier) }"
            />
            <span class="detail-name" :style="{ color: cardTierVar(selectedCard.cardTier) }">{{
              selectedCard.name
            }}</span>
            <span class="tier-badge">{{ selectedCard.cardTier }}</span>
          </div>
          <p v-if="selectedCard.description" class="detail-desc">{{ selectedCard.description }}</p>
          <div class="detail-section">
            <h5 class="d-label">词条</h5>
            <div v-if="selectedCard.词条?.length" class="chip-row">
              <span v-for="w in selectedCard.词条" :key="w" class="chip">{{ w }}</span>
            </div>
            <div v-else class="empty-tab small">无词条</div>
          </div>
          <div class="detail-section">
            <h5 class="d-label">配方</h5>
            <div class="kv-grid">
              <div class="kv-row">
                <span class="k">主素材</span>
                <span class="v">{{ selectedCard.recipe.mainMaterial }}</span>
              </div>
              <div class="kv-row">
                <span class="k">副素材</span>
                <span class="v">{{
                  selectedCard.recipe.subMaterials.length
                    ? selectedCard.recipe.subMaterials.join('、')
                    : '无'
                }}</span>
              </div>
              <div class="kv-row">
                <span class="k">融合</span>
                <span class="v">{{ selectedCard.recipe.fusionKind }}</span>
              </div>
              <div class="kv-row">
                <span class="k">造价</span>
                <span class="v">{{ selectedCard.recipe.cost }} GC</span>
              </div>
            </div>
          </div>
          <div v-if="selectedCard.sealed" class="detail-section">
            <h5 class="d-label">封印</h5>
            <div class="kv-grid">
              <div class="kv-row">
                <span class="k">封印 DC</span>
                <span class="v"
                  >{{ unsealDC(selectedCard) }}（你的意志修正 {{ willMod >= 0 ? '+' : ''
                  }}{{ willMod }}）</span
                >
              </div>
              <div class="kv-row">
                <span class="k">启封槽位</span>
                <span class="v">{{ UNSEAL_SLOT_COST[selectedCard.cardTier] }} 动作槽</span>
              </div>
            </div>
            <p class="seal-note">启封即使用：意志对抗失败将遭抗命——哑火、暴走，或反噬。</p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.card-album {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-md);
  padding: var(--theme-spacing-lg);
  min-height: 24rem;
}
.album-summary {
  display: flex;
  align-items: center;
  gap: var(--theme-spacing-sm);
  color: var(--theme-text-secondary);
  font-size: 0.8125rem;
}
.album-summary .dot {
  color: var(--theme-text-muted);
}
.op-message {
  margin-left: auto;
  color: var(--theme-error);
  font-size: 0.75rem;
}
.album-columns {
  display: flex;
  gap: var(--theme-spacing-lg);
  flex: 1;
  align-items: flex-start;
}
.album-col {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-sm);
  min-width: 0;
}
.deck-col {
  width: 15rem;
  flex-shrink: 0;
}
.pack-col {
  width: 19rem;
  flex-shrink: 0;
}
.detail-col {
  flex: 1;
}
.d-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-family: var(--theme-font-title);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--theme-text-primary);
}
.d-label::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(to right, var(--theme-card-border), transparent);
}
.card-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-xs);
}
.deck-row,
.pack-row {
  display: flex;
  align-items: center;
  gap: var(--theme-spacing-sm);
  padding: 7px 10px;
  background: var(--theme-card-bg);
  border: 1px solid var(--theme-card-border);
  border-radius: var(--theme-radius-md);
  box-shadow: var(--paper-stack);
}
.pack-row {
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}
.pack-row:hover {
  background: var(--theme-tab-hover-bg);
}
.pack-row.selected {
  background: color-mix(in srgb, var(--theme-primary) 8%, var(--theme-card-bg));
  border-color: color-mix(in srgb, var(--theme-primary) 30%, var(--theme-card-border));
}
.deck-row .card-name,
.pack-row .card-name {
  flex: 1;
}
.pack-row .card-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-name {
  font-weight: 600;
  font-size: 0.8125rem;
}
.tier-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.tier-dot.big {
  width: 10px;
  height: 10px;
}
.count-badge {
  font-size: 0.6875rem;
  color: var(--theme-text-muted);
  background: var(--theme-surface-muted);
  border-radius: var(--theme-radius-sm);
  padding: 1px 6px;
  flex-shrink: 0;
}
.sealed-badge {
  font-size: 0.6875rem;
  color: var(--theme-text-muted);
  border: 1px solid var(--theme-card-border);
  border-radius: var(--theme-radius-sm);
  padding: 0 6px;
  flex-shrink: 0;
}
.detail-card {
  background: var(--theme-card-bg);
  border: 1px solid var(--theme-card-border);
  border-radius: var(--theme-radius-md);
  box-shadow: var(--paper-stack);
  padding: var(--theme-spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-md);
}
.d-header {
  display: flex;
  align-items: center;
  gap: var(--theme-spacing-sm);
  padding-bottom: var(--theme-spacing-sm);
  border-bottom: 1px solid var(--theme-card-border);
}
.detail-name {
  font-family: var(--theme-font-title);
  font-size: 1.125rem;
  font-weight: 700;
}
.tier-badge {
  margin-left: auto;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--theme-text-secondary);
  border: 1px solid var(--theme-card-border);
  border-radius: var(--theme-radius-sm);
  padding: 1px 8px;
}
.detail-desc {
  margin: 0;
  color: var(--theme-text-secondary);
  font-size: 0.8125rem;
  line-height: 1.6;
}
.detail-section {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-xs);
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--theme-spacing-xs);
}
.chip {
  font-size: 0.6875rem;
  color: var(--theme-text-secondary);
  background: var(--theme-surface-muted);
  border: 1px solid var(--theme-card-border);
  border-radius: var(--theme-radius-sm);
  padding: 2px 8px;
}
.kv-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 14px;
}
.kv-row {
  display: flex;
  justify-content: space-between;
  gap: var(--theme-spacing-sm);
  font-size: 0.8125rem;
}
.kv-row .k {
  color: var(--theme-text-muted);
}
.kv-row .v {
  color: var(--theme-text-primary);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.seal-note {
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
.empty-tab.small {
  padding: 12px 0;
}
.empty-tab.small::before {
  display: none;
}
</style>
