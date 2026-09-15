<script setup lang="ts">
/**
 * CommissionBoard.vue — 冒险者公会委托板（卡牌工坊 委托接线 切片 D）
 *
 * 委托清单来自内容包第 15 分节（经 commission-runtime 注入缝）；接取在剧情里由 AI
 * 立同名 quest（{{COMMISSIONS}} 注入块的指引），本面板负责**交付**：选委托 → 从背包
 * 选符合条件的卡 → `deliverCommission`（验收 + 上交 + 奖励一次原子提交，AI 零写路径）。
 * 验收判定全部走引擎纯函数（matchesCommission / planCommissionDelivery），面板只展示。
 */
import { computed, ref } from 'vue';
import type { CardItem } from '@engine/types';
import { useGameStore } from '../../../stores/game-store';
import { getCommissionDefs } from '@engine/commission-runtime';
import { getReputation } from '@engine/save-profile';
import { matchesCommission } from '@engine/card-workshop/commission';
import {
  getExchangeCatalog,
  talentExchangePrice,
  type TalentTemplate,
} from '@engine/card-workshop/talent-entry';
import { cardTierVar } from '../../../lib/quality-colors';
import { rankForReputation } from '@engine/card-workshop/adventurer-rank';

const game = useGameStore();
const commissions = getCommissionDefs();
const reputation = computed(() => (game.saveProfile ? getReputation(game.saveProfile) : 0));
/** 冒险者等级 = 声望派生（card-workshop/adventurer-rank，不落库自动更新） */
const rank = computed(() => rankForReputation(reputation.value));

const selectedName = ref<string | null>(null);
const feedback = ref<{ kind: 'ok' | 'err'; msg: string } | null>(null);
const busy = ref(false);

const selected = computed(() => commissions.find((c) => c.name === selectedName.value) ?? null);

/** 所选委托的可交付卡：类型/品质/元素验收通过且未损坏的背包卡 */
const deliverableCards = computed(() => {
  if (!selected.value) return [];
  const out: { name: string; cardTier: string; label: string }[] = [];
  for (const item of game.player?.inventory ?? []) {
    if (item.type !== '卡牌') continue;
    const card = item as CardItem;
    if (card.data?.damaged === true) continue;
    if (!matchesCommission(card, selected.value.requireCard)) continue;
    const qty = typeof card.quantity === 'number' && card.quantity > 1 ? ` ×${card.quantity}` : '';
    out.push({ name: card.name, cardTier: card.cardTier, label: `${card.name}${qty}` });
  }
  return out;
});

function pick(id: string) {
  selectedName.value = selectedName.value === id ? null : id;
  feedback.value = null;
}
async function onDeliver(cardName: string) {
  if (!selectedName.value) return;
  busy.value = true;
  try {
    const r = await game.deliverCommission(selectedName.value, cardName);
    feedback.value = r.ok
      ? { kind: 'ok', msg: `已交付【${cardName}】——奖励到账，去任务栏看看声望变化吧` }
      : { kind: 'err', msg: r.reason ?? '交付失败' };
    if (r.ok) selectedName.value = null;
  } finally {
    busy.value = false;
  }
}

const exchangeCatalog = getExchangeCatalog();
const ownedNames = computed(() => new Set(game.player?.talents?.list.map((t) => t.name) ?? []));
function priceOf(t: TalentTemplate): number {
  return talentExchangePrice(t);
}
async function onExchange(t: TalentTemplate) {
  busy.value = true;
  try {
    const r = await game.exchangeTalent(t.name);
    feedback.value = r.ok
      ? { kind: 'ok', msg: `已习得天赋【${t.name}】` }
      : { kind: 'err', msg: r.reason ?? '兑换失败' };
  } finally {
    busy.value = false;
  }
}

function requirementText(requireCard: {
  minTier?: string;
  formEntry?: string;
  elements?: readonly string[];
  exactName?: string;
}): string {
  const parts: string[] = [];
  if (requireCard.exactName) parts.push(`指定卡「${requireCard.exactName}」`);
  if (requireCard.minTier) parts.push(`品质 ≥ ${requireCard.minTier}`);
  if (requireCard.formEntry) parts.push(`${requireCard.formEntry}类`);
  if (requireCard.elements && requireCard.elements.length > 0)
    parts.push(`含 ${requireCard.elements.join('、')} 元素`);
  return parts.length > 0 ? parts.join(' · ') : '不限';
}
function rewardsText(rewards: {
  gc?: number;
  reputation?: number;
  materials?: readonly { name: string; quantity: number }[];
}): string {
  const parts: string[] = [];
  if (rewards.gc) parts.push(`${rewards.gc}G`);
  if (rewards.reputation) parts.push(`声望 +${rewards.reputation}`);
  if (rewards.materials && rewards.materials.length > 0)
    parts.push(rewards.materials.map((m) => `${m.name}×${m.quantity}`).join('、'));
  return parts.length > 0 ? parts.join(' ｜ ') : '面议';
}
</script>

<template>
  <section class="commission-board" aria-label="委托板">
    <header class="board-head">
      <p class="reputation" title="完成委托可提升公会声望；声望达标自动晋升冒险者等级">
        <i class="fa-solid fa-star" aria-hidden="true"></i>
        公会声望 {{ reputation }} · {{ rank }} 级
      </p>
    </header>

    <p v-if="commissions.length === 0" class="board-empty">
      委托板空空如也——当前内容包没有委托（第 15 分节 commissions）。
    </p>

    <ul v-else class="commission-list">
      <li
        v-for="c in commissions"
        :key="c.name"
        class="commission-item"
        :class="{ selected: selectedName === c.name }"
      >
        <button type="button" class="commission-head" @click="pick(c.name)">
          <span class="c-name">{{ c.name }}</span>
          <span v-if="c.description" class="c-desc">{{ c.description }}</span>
          <span class="c-meta">
            收卡：{{ requirementText(c.requireCard) }} ｜ 报酬：{{ rewardsText(c.rewards) }}
          </span>
        </button>

        <div v-if="selectedName === c.name" class="deliver-zone">
          <p class="deliver-hint">选择一张符合条件的卡上交：</p>
          <p v-if="deliverableCards.length === 0" class="deliver-none">
            背包里没有符合条件的卡——去炼制一张再回来吧。
          </p>
          <div class="deliver-cards">
            <button
              v-for="c2 in deliverableCards"
              :key="c2.name"
              type="button"
              class="deliver-card"
              :disabled="busy"
              @click="onDeliver(c2.name)"
            >
              <span class="tier-dot" :style="{ background: cardTierVar(c2.cardTier) }" />
              {{ c2.label }}
            </button>
          </div>
        </div>
      </li>
    </ul>

    <div v-if="exchangeCatalog.length > 0" class="exchange-zone">
      <p class="exchange-title">
        <i class="fa-solid fa-star" aria-hidden="true"></i>
        声望兑换（当前声望 {{ reputation }}）
      </p>
      <div class="exchange-list">
        <div v-for="t in exchangeCatalog" :key="t.name" class="exchange-item">
          <div class="exchange-info">
            <span class="c-name">{{ t.name }}</span>
            <span v-if="t.description" class="c-desc">{{ t.description }}</span>
            <span class="c-meta">
              {{ t.entries.length }} 条骨架 ｜ 价格 {{ priceOf(t) }} 声望
            </span>
          </div>
          <button
            type="button"
            class="deliver-card"
            :disabled="busy || ownedNames.has(t.name) || reputation < priceOf(t)"
            @click="onExchange(t)"
          >
            {{ ownedNames.has(t.name) ? '已习得' : '兑换' }}
          </button>
        </div>
      </div>
    </div>

    <p v-if="feedback" class="board-feedback" :class="feedback.kind">{{ feedback.msg }}</p>
  </section>
</template>

<style scoped>
.commission-board {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.board-head {
  display: flex;
  justify-content: flex-end;
}
.reputation {
  margin: 0;
  font-size: 0.875rem;
  color: var(--theme-accent, #d2a25f);
}
.board-empty {
  margin: 0;
  color: var(--theme-text-muted, #967756);
}
.commission-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.commission-item {
  border: 1px solid var(--theme-card-border, #72502d);
  border-radius: var(--theme-radius-md, 6px);
  background: var(--theme-surface-muted, #1a130d);
  overflow: hidden;
}
.commission-item.selected {
  border-color: var(--theme-primary, #c48c4b);
}
.commission-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
}
.commission-head:hover {
  background: var(--theme-primary-bg, rgba(196, 140, 75, 0.1));
}
.c-name {
  font-weight: 600;
  color: var(--theme-text-primary, #eadcc5);
}
.c-desc {
  font-size: 0.8125rem;
  color: var(--theme-text-secondary, #c7a77e);
}
.c-meta {
  font-size: 0.75rem;
  color: var(--theme-text-muted, #967756);
}
.deliver-zone {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px 12px;
  border-top: 1px dashed var(--theme-card-border, #72502d);
}
.deliver-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--theme-text-secondary, #c7a77e);
}
.deliver-none {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--theme-text-muted, #967756);
}
.deliver-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.deliver-card {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--theme-card-border, #72502d);
  background: var(--theme-card-bg, #211810);
  color: var(--theme-text-primary, #eadcc5);
  cursor: pointer;
  font-size: 0.8125rem;
}
.deliver-card:hover:not(:disabled) {
  border-color: var(--theme-primary, #c48c4b);
  background: var(--theme-primary-bg, rgba(196, 140, 75, 0.15));
}
.deliver-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.tier-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.board-feedback {
  margin: 0;
  font-size: 0.8125rem;
}
.exchange-zone {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px dashed var(--theme-card-border, #72502d);
}
.exchange-title {
  margin: 0;
  font-size: 0.875rem;
  color: var(--theme-accent, #d2a25f);
}
.exchange-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.exchange-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--theme-card-border, #72502d);
  border-radius: var(--theme-radius-sm, 4px);
  background: var(--theme-surface-muted, #1a130d);
}
.exchange-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.board-feedback.ok {
  color: var(--theme-success, #78b96d);
}
.board-feedback.err {
  color: var(--theme-error, #cc594b);
}
</style>
