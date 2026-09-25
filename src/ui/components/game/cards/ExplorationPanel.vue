<script setup lang="ts">
/**
 * ExplorationPanel.vue — 探索面板（委托×地图闭环 2026-09-19）
 *
 * 采集/垂钓的动作入口（gathering.ts 的 UI 面）：选环境 → 采集/垂钓 → 看产出与风险。
 * 全部判定在 store/引擎侧（Code 判数值），这里只展示：
 *   · 中层覆写表生效时显示「特产地」（当前所在中层的独家素材）
 *   · 风险四事件（魔兽来袭 → 战斗邀请提示；素材损坏/路人打断/空手而归 → 损失说明）
 *   · 抵达判定横幅（遭遇战提示/惊动守卫，含当日采集 DC +2 状态）
 *   · 探索事件入池提示与终点叙事
 */
import { computed, ref } from 'vue';
import { useGameStore, type GatherOutcome } from '../../../stores/game-store';
import { ENVIRONMENT_TABLE, type GatherEnvironment } from '@engine/card-workshop/gathering';

const game = useGameStore();

const ENVIRONMENTS = Object.keys(ENVIRONMENT_TABLE) as GatherEnvironment[];
const environment = ref<GatherEnvironment>('森林');
const depth = ref<1 | 2 | 3>(1);
const busy = ref(false);
const lastOutcome = ref<GatherOutcome | null>(null);

const midTier = computed(() => game.commissionsFlags().currentMidTier);
const threat = computed(() => game.commissionsFlags().arrivalThreat);
const alert = computed(() => game.commissionsFlags().alertedMidTier);
const alertActive = computed(() => alert.value && alert.value.midTierId === midTier.value?.id);

async function onGather() {
  busy.value = true;
  try {
    lastOutcome.value = await game.gatherMaterials(environment.value);
  } finally {
    busy.value = false;
  }
}

async function onFish() {
  busy.value = true;
  try {
    lastOutcome.value = await game.fishAt(depth.value);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="exploration-panel" aria-label="探索">
    <!-- 抵达判定横幅 -->
    <div v-if="threat" class="threat-banner" :class="threat.kind">
      <template v-if="threat.kind === 'ambush'">
        <i class="fa-solid fa-skull" aria-hidden="true"></i>
        抵达「{{ threat.midTierName }}」时惊动了什么东西——它还在附近徘徊。
      </template>
      <template v-else>
        <i class="fa-solid fa-eye" aria-hidden="true"></i>
        你被「{{ threat.midTierName }}」的守卫盯上了——本层采集判定 +2（当日）。
      </template>
    </div>

    <!-- 当前中层 -->
    <p v-if="midTier" class="mid-tier-line">
      <i class="fa-solid fa-mountain-sun" aria-hidden="true"></i>
      当前所在：{{ midTier.name }}
      <span v-if="midTier.specialty" class="specialty-tag">特产 · {{ midTier.specialty }}</span>
      <span v-if="alertActive" class="alert-tag">守卫警觉中</span>
    </p>
    <p v-else class="mid-tier-line muted">不在任何已知中层——装一张地图包，先在地图上落脚。</p>

    <!-- 环境选择 -->
    <p class="label">在哪里采集：</p>
    <div class="env-row">
      <button
        v-for="env in ENVIRONMENTS"
        :key="env"
        type="button"
        class="env-btn"
        :class="{ picked: environment === env }"
        :disabled="busy"
        @click="environment = env"
      >
        {{ env }}
        <span class="env-danger" :title="`危险系数 ${ENVIRONMENT_TABLE[env].danger}`">
          {{ '⚠'.repeat(Math.min(3, ENVIRONMENT_TABLE[env].danger)) || '·' }}
        </span>
      </button>
    </div>

    <!-- 动作 -->
    <div class="action-row">
      <button type="button" class="explore-btn" :disabled="busy" @click="onGather">
        <i class="fa-solid fa-seedling" aria-hidden="true"></i>
        采集（30 分钟 · 10 SP）
      </button>
      <div class="fish-group">
        <select v-model.number="depth" class="depth-select" :disabled="busy" aria-label="水深">
          <option :value="1">浅水</option>
          <option :value="2">深水</option>
          <option :value="3">深渊</option>
        </select>
        <button type="button" class="explore-btn" :disabled="busy" @click="onFish">
          <i class="fa-solid fa-fish" aria-hidden="true"></i>
          垂钓（45 分钟 · 8 SP）
        </button>
      </div>
    </div>

    <!-- 结果 -->
    <p v-if="lastOutcome && !lastOutcome.ok" class="outcome err">
      {{ lastOutcome.reason }}
    </p>
    <div v-else-if="lastOutcome?.ok" class="outcome">
      <p class="outcome-summary">{{ lastOutcome.summary }}</p>
      <ul v-if="lastOutcome.items.length > 0" class="outcome-items">
        <li v-for="(item, i) in lastOutcome.items" :key="i">
          {{ item.name }}
          <span class="item-rarity">{{ item.rarity }}</span>
          <template v-if="item.isSpecialty"> · 特产</template>
        </li>
      </ul>
      <p
        v-if="lastOutcome.risk?.eventType"
        class="risk-note"
        :class="{ battle: lastOutcome.battlePrompt }"
      >
        <template v-if="lastOutcome.battlePrompt">
          ⚔ 魔兽来袭！{{ lastOutcome.risk.eventType }}——采到的东西全没了。回正文里迎战它，
          或在战斗面板开启一场交锋。
        </template>
        <template v-else> ✕ {{ lastOutcome.risk.eventType }}——这一趟白干了。 </template>
      </p>
      <p v-if="lastOutcome.explorationEventArmed" class="event-note">
        <i class="fa-solid fa-bell" aria-hidden="true"></i>
        探索中似乎发生了什么——留意正文的动静。
      </p>
      <p v-for="(n, i) in lastOutcome.finaleNarratives ?? []" :key="`f${i}`" class="finale-note">
        {{ n }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.exploration-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.threat-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--theme-radius-md, 6px);
  font-size: 0.8125rem;
}
.threat-banner.ambush {
  border: 1px solid color-mix(in srgb, var(--theme-error, #cc594b) 60%, transparent);
  color: var(--theme-error, #cc594b);
  background: color-mix(in srgb, var(--theme-error, #cc594b) 10%, transparent);
}
.threat-banner.alerted {
  border: 1px solid color-mix(in srgb, var(--theme-quality-epic, #b8860b) 60%, transparent);
  color: var(--theme-quality-epic, #b8860b);
  background: color-mix(in srgb, var(--theme-quality-epic, #b8860b) 10%, transparent);
}
.mid-tier-line {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--theme-text-secondary, #c7a77e);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.mid-tier-line.muted {
  color: var(--theme-text-muted, #967756);
}
.specialty-tag,
.alert-tag {
  padding: 0 6px;
  border-radius: 4px;
  font-size: 0.7rem;
}
.specialty-tag {
  border: 1px solid color-mix(in srgb, var(--theme-quality-uncommon, #78b96d) 50%, transparent);
  color: var(--theme-quality-uncommon, #78b96d);
}
.alert-tag {
  border: 1px solid color-mix(in srgb, var(--theme-quality-epic, #b8860b) 50%, transparent);
  color: var(--theme-quality-epic, #b8860b);
}
.label {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--theme-text-secondary, #c7a77e);
}
.env-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.env-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid var(--theme-card-border, #72502d);
  background: var(--theme-card-bg, #211810);
  color: var(--theme-text-primary, #eadcc5);
  cursor: pointer;
  font-size: 0.8125rem;
}
.env-btn.picked {
  border-color: var(--theme-primary, #c48c4b);
  background: var(--theme-primary-bg, rgba(196, 140, 75, 0.15));
}
.env-danger {
  font-size: 0.7rem;
  color: var(--theme-quality-epic, #b8860b);
}
.action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.fish-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.depth-select {
  padding: 4px 8px;
  border-radius: var(--theme-radius-sm, 4px);
  border: 1px solid var(--theme-card-border, #72502d);
  background: var(--theme-card-bg, #211810);
  color: var(--theme-text-primary, #eadcc5);
}
.explore-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-radius: var(--theme-radius-md, 6px);
  border: 1px solid var(--theme-primary, #c48c4b);
  background: var(--theme-primary-bg, rgba(196, 140, 75, 0.15));
  color: var(--theme-text-primary, #eadcc5);
  cursor: pointer;
  font-size: 0.875rem;
}
.explore-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--theme-primary, #c48c4b) 25%, transparent);
}
.explore-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.outcome {
  border: 1px dashed var(--theme-card-border, #72502d);
  border-radius: var(--theme-radius-md, 6px);
  padding: 10px 12px;
  font-size: 0.8125rem;
}
.outcome.err {
  color: var(--theme-error, #cc594b);
}
.outcome-summary {
  margin: 0 0 4px;
  color: var(--theme-text-primary, #eadcc5);
}
.outcome-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--theme-text-secondary, #c7a77e);
}
.item-rarity {
  color: var(--theme-accent, #d2a25f);
}
.risk-note {
  margin: 6px 0 0;
  color: var(--theme-text-muted, #967756);
}
.risk-note.battle {
  color: var(--theme-error, #cc594b);
}
.event-note {
  margin: 6px 0 0;
  color: var(--theme-quality-epic, #b8860b);
}
.finale-note {
  margin: 6px 0 0;
  color: var(--theme-accent, #d2a25f);
  white-space: pre-wrap;
}
</style>
