<script setup lang="ts">
/**
 * CommissionBoard.vue — 冒险者公会委托板（委托×地图闭环 2026-09-19 两栏版）
 *
 * 两栏：可接（静态 + 事件 + 生成填充）/ 进行中（接取状态，最多 3 个）。
 * 四种要求各有自己的交付路：收卡（选卡上交）/ 素材（缴纳独家素材）/
 * 到访（人到了就交差）/ 终点（场景行为完成时自动结算，这里只展示）。
 * A/S 级显示交差地；生成委托有过期倒计时（决议 #7/#11/#12）。
 * 开板三件事：生成委托保洁补充、违约结算、终点扫账（全部 Code 判定）。
 */
import { computed, onMounted, ref } from 'vue';
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
import type { CommissionDef } from '@engine/card-workshop/commission';

const game = useGameStore();
const staticCommissions = getCommissionDefs();
/** 动态事件委托（随机事件 × 委托板融合）：存档 flags 里仍有效的部分 */
const eventCommissions = computed(() => game.eventCommissions ?? []);
/** 生成填充（D/C/B；素材池取自中层覆写表） */
const generated = computed(() => game.commissionsFlags().generated ?? []);
const day = computed(() => game.currentGameDay());

/** 全量清单（动态在前） */
const allDefs = computed(() => {
  const dynamicNames = new Set(eventCommissions.value.map((ec) => ec.def.name));
  return [
    ...eventCommissions.value.map((ec) => ec.def),
    ...staticCommissions.filter((d) => !dynamicNames.has(d.name)),
    ...generated.value.map((gc) => gc.def).filter((d) => !dynamicNames.has(d.name)),
  ];
});

/** 进行中（接取状态） */
const activeList = computed(() => {
  const progressByName = new Map(
    (game.commissionProgress ?? []).map((p) => [p.defName, p]),
  );
  const defs = allDefs.value;
  return (game.activeCommissions ?? [])
    .map((a) => {
      const def = defs.find((d) => d.name === a.defName);
      return def
        ? { def, progress: progressByName.get(a.defName), acceptDay: a.acceptDay }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
});

const activeNames = computed(() => new Set((game.activeCommissions ?? []).map((a) => a.defName)));

/** 可接 = 全量 − 进行中（完成任务链前置的解锁判定在 store 的接取动作里拦） */
const availableList = computed(() =>
  allDefs.value.filter((d) => !activeNames.value.has(d.name)),
);

const reputation = computed(() => (game.saveProfile ? getReputation(game.saveProfile) : 0));
/** 冒险者等级 = 声望派生（card-workshop/adventurer-rank，不落库自动更新） */
const rank = computed(() => rankForReputation(reputation.value));

const selectedName = ref<string | null>(null);
const feedback = ref<{ kind: 'ok' | 'err'; msg: string } | null>(null);
const busy = ref(false);

const selected = computed(
  () => allDefs.value.find((c) => c.name === selectedName.value) ?? null,
);

function pick(id: string) {
  selectedName.value = selectedName.value === id ? null : id;
  feedback.value = null;
}

/** 所选委托的可交付卡：类型/品质/元素验收通过且未损坏的背包卡 */
const deliverableCards = computed(() => {
  if (!selected.value) return [];
  const out: { name: string; cardTier: string; label: string }[] = [];
  for (const item of game.player?.inventory ?? []) {
    if (item.type !== '卡牌') continue;
    const card = item as CardItem;
    if (card.data?.damaged === true) continue;
    if (!matchesCommission(card, selected.value.requireCard ?? {})) continue;
    const qty = typeof card.quantity === 'number' && card.quantity > 1 ? ` ×${card.quantity}` : '';
    out.push({ name: card.name, cardTier: card.cardTier, label: `${card.name}${qty}` });
  }
  return out;
});

async function onAccept(defName: string) {
  busy.value = true;
  try {
    const r = await game.acceptCommissionByName(defName);
    feedback.value = r.ok
      ? { kind: 'ok', msg: `已接取「${defName}」——进行中的委托最多 ${3} 条` }
      : { kind: 'err', msg: r.reason ?? '接取失败' };
    if (r.ok) selectedName.value = null;
  } finally {
    busy.value = false;
  }
}

async function onAbandon(defName: string) {
  busy.value = true;
  try {
    const r = await game.abandonCommissionByName(defName);
    feedback.value = r.ok
      ? { kind: 'ok', msg: `已放弃「${defName}」——重接会重新计算到访基线` }
      : { kind: 'err', msg: r.reason ?? '放弃失败' };
  } finally {
    busy.value = false;
  }
}

async function onDeliverByName(defName: string, cardName?: string) {
  busy.value = true;
  try {
    const r = await game.deliverCommissionByName(defName, cardName);
    feedback.value = r.ok
      ? { kind: 'ok', msg: r.note ?? `「${defName}」完成——奖励到账` }
      : { kind: 'err', msg: r.reason ?? '交付失败' };
    if (r.ok) selectedName.value = null;
  } finally {
    busy.value = false;
  }
}

/** 开板三件事（全部幂等；失败静默——旁路账本不挡 UI） */
onMounted(() => {
  void game.refreshGeneratedCommissions();
  void game.settleCommissionBreaches();
  void game.scanFinaleCommissions();
});

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

function isEventDef(def: CommissionDef): boolean {
  return eventCommissions.value.some((ec) => ec.def.name === def.name);
}
function isGeneratedDef(def: CommissionDef): boolean {
  return generated.value.some((gc) => gc.def.name === def.name);
}
function generatedRemainingDays(def: CommissionDef): number | null {
  const gc = generated.value.find((g) => g.def.name === def.name);
  if (!gc) return null;
  return Math.max(0, gc.expiresDay - day.value);
}
function gradeClass(grade: string | undefined): string {
  return grade ? `grade-${grade}` : '';
}

function requirementText(def: CommissionDef): string {
  const req = def.requireCard;
  const cardParts: string[] = [];
  if (req?.exactName) cardParts.push(`指定卡「${req.exactName}」`);
  if (req?.minTier) cardParts.push(`品质 ≥ ${req.minTier}`);
  if (req?.formEntry) cardParts.push(`${req.formEntry}类`);
  if (req?.elements && req.elements.length > 0) cardParts.push(`含 ${req.elements.join('、')} 元素`);
  if (cardParts.length > 0) return `收卡：${cardParts.join(' · ')}`;
  if (def.requireMaterial) return `缴纳：${def.requireMaterial.name} ×${def.requireMaterial.count}`;
  if (def.requireVisit) return `亲赴「${def.requireVisit.midTier}」${def.requireVisit.count} 次`;
  if (def.finale) {
    if (def.finale.type === '谜题') return `终点：解开${def.finale.target ? `「${def.finale.target}」` : '谜题'}`;
    if (def.finale.type === '强敌') return `终点：击败${def.finale.target ?? '守卫之敌'}`;
    return `终点：现场制出「${def.finale.target ?? '目标卡'}」`;
  }
  return '要求：不限';
}
function rewardsText(def: CommissionDef): string {
  const rewards = def.rewards;
  const parts: string[] = [];
  if (rewards.gc) parts.push(`${rewards.gc}G`);
  if (rewards.reputation) parts.push(`声望 +${rewards.reputation}`);
  if (rewards.materials && rewards.materials.length > 0)
    parts.push(rewards.materials.map((m) => `${m.name}×${m.quantity}`).join('、'));
  if (rewards.card) parts.push(`独家卡「${rewards.card.name}」`);
  return parts.length > 0 ? parts.join(' ｜ ') : '面议';
}
function routeText(def: CommissionDef): string {
  const parts: string[] = [];
  if (def.destMidTier) parts.push(`目的地 ${def.destMidTier}`);
  if (def.issuerMidTier) parts.push(`交差地 ${def.issuerMidTier}`);
  return parts.length > 0 ? parts.join(' · ') : '';
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

    <!-- ═══ 进行中 ═══ -->
    <p class="section-title">
      <i class="fa-solid fa-scroll" aria-hidden="true"></i>
      进行中（{{ activeList.length }}/3）
    </p>
    <p v-if="activeList.length === 0" class="board-empty">
      手头没有进行中的委托——接一条，出发吧。
    </p>
    <ul v-else class="commission-list">
      <li
        v-for="entry in activeList"
        :key="entry.def.name"
        class="commission-item active"
        :class="{ selected: selectedName === entry.def.name }"
      >
        <button type="button" class="commission-head" @click="pick(entry.def.name)">
          <span class="c-name-row">
            <span class="c-name">{{ entry.def.name }}</span>
            <span v-if="entry.def.grade" class="c-grade" :class="gradeClass(entry.def.grade)">{{
              entry.def.grade
            }}</span>
            <span v-if="isEventDef(entry.def)" class="c-event-tag" title="由随机事件触发">事件</span>
          </span>
          <span v-if="entry.def.description" class="c-desc">{{ entry.def.description }}</span>
          <span class="c-meta">
            {{ requirementText(entry.def) }}
            <template v-if="entry.progress">
              ｜ 进度 {{ entry.progress.have }}/{{ entry.progress.need }}
            </template>
            ｜ 报酬：{{ rewardsText(entry.def) }}
          </span>
          <span v-if="routeText(entry.def)" class="c-meta">📍 {{ routeText(entry.def) }}</span>
          <span
            v-if="entry.progress?.expiresDay"
            class="c-meta c-deadline"
            :class="{ urgent: entry.progress.expiresDay - day <= 1 }"
          >
            ⏳ 剩 {{ Math.max(0, entry.progress.expiresDay - day) }} 天
          </span>
        </button>
        <div v-if="selectedName === entry.def.name" class="deliver-zone">
          <!-- 素材委托：直接缴纳 -->
          <button
            v-if="entry.def.requireMaterial"
            type="button"
            class="deliver-card"
            :disabled="busy"
            @click="onDeliverByName(entry.def.name)"
          >
            缴纳素材（背包 {{ entry.progress?.have ?? 0 }}/{{ entry.progress?.need }})
          </button>
          <!-- 到访委托：人到即交 -->
          <button
            v-else-if="entry.def.requireVisit"
            type="button"
            class="deliver-card"
            :disabled="busy"
            @click="onDeliverByName(entry.def.name)"
          >
            交差（已到 {{ entry.progress?.have ?? 0 }}/{{ entry.progress?.need }} 次）
          </button>
          <!-- 终点委托：场景行为自动结算 -->
          <p v-else-if="entry.def.finale" class="deliver-none">
            终点委托没有交付按钮——在目的地完成最后一搏，它会自动结案。
          </p>
          <!-- 收卡委托：选卡上交 -->
          <template v-else>
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
                @click="onDeliverByName(entry.def.name, c2.name)"
              >
                <span class="tier-dot" :style="{ background: cardTierVar(c2.cardTier) }" />
                {{ c2.label }}
              </button>
            </div>
          </template>
          <button type="button" class="abandon-btn" :disabled="busy" @click="onAbandon(entry.def.name)">
            放弃（基线作废）
          </button>
        </div>
      </li>
    </ul>

    <!-- ═══ 可接 ═══ -->
    <p class="section-title">
      <i class="fa-solid fa-bullhorn" aria-hidden="true"></i>
      可接
    </p>
    <p v-if="availableList.length === 0" class="board-empty">
      委托板空空如也——当前内容包没有委托（第 15 分节 commissions），或生成原料未备。
    </p>
    <ul v-else class="commission-list">
      <li
        v-for="c in availableList"
        :key="c.name"
        class="commission-item"
        :class="{ selected: selectedName === c.name }"
      >
        <button type="button" class="commission-head" @click="pick(c.name)">
          <span class="c-name-row">
            <span class="c-name">{{ c.name }}</span>
            <span v-if="c.grade" class="c-grade" :class="gradeClass(c.grade)">{{ c.grade }}</span>
            <span v-if="isEventDef(c)" class="c-event-tag" title="由随机事件触发——限时">事件</span>
            <span v-else-if="isGeneratedDef(c)" class="c-gen-tag" title="公会自动张贴的征集">征集</span>
          </span>
          <span v-if="c.description" class="c-desc">{{ c.description }}</span>
          <span class="c-meta">
            {{ requirementText(c) }} ｜ 报酬：{{ rewardsText(c) }}
          </span>
          <span v-if="routeText(c)" class="c-meta">📍 {{ routeText(c) }}</span>
          <span
            v-if="isGeneratedDef(c) && generatedRemainingDays(c) !== null"
            class="c-meta c-deadline"
          >
            ⏳ 张贴剩余 {{ generatedRemainingDays(c) }} 天
          </span>
        </button>

        <div v-if="selectedName === c.name" class="deliver-zone">
          <button type="button" class="deliver-card" :disabled="busy" @click="onAccept(c.name)">
            接取
          </button>
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
.section-title {
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
.commission-item.active {
  border-color: color-mix(in srgb, var(--theme-primary, #c48c4b) 55%, transparent);
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
.c-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.c-name {
  font-weight: 600;
  color: var(--theme-text-primary, #eadcc5);
}
.c-grade {
  padding: 0 6px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
}
.grade-S {
  border: 1px solid color-mix(in srgb, var(--theme-quality-legendary, #ff6b35) 60%, transparent);
  color: var(--theme-quality-legendary, #ff6b35);
}
.grade-A {
  border: 1px solid color-mix(in srgb, var(--theme-quality-epic, #b8860b) 60%, transparent);
  color: var(--theme-quality-epic, #b8860b);
}
.grade-B {
  border: 1px solid color-mix(in srgb, var(--theme-quality-rare, #4a90d9) 60%, transparent);
  color: var(--theme-quality-rare, #4a90d9);
}
.grade-C {
  border: 1px solid color-mix(in srgb, var(--theme-quality-uncommon, #78b96d) 60%, transparent);
  color: var(--theme-quality-uncommon, #78b96d);
}
.grade-D {
  border: 1px solid color-mix(in srgb, var(--theme-text-muted, #967756) 60%, transparent);
  color: var(--theme-text-muted, #967756);
}
.c-event-tag,
.c-gen-tag {
  flex-shrink: 0;
  padding: 0 6px;
  border: 1px solid color-mix(in srgb, var(--theme-quality-epic, #b8860b) 50%, transparent);
  border-radius: 4px;
  font-size: 0.7rem;
  color: var(--theme-quality-epic, #b8860b);
}
.c-gen-tag {
  border-color: color-mix(in srgb, var(--theme-quality-uncommon, #78b96d) 50%, transparent);
  color: var(--theme-quality-uncommon, #78b96d);
}
.c-desc {
  font-size: 0.8125rem;
  color: var(--theme-text-secondary, #c7a77e);
}
.c-meta {
  font-size: 0.75rem;
  color: var(--theme-text-muted, #967756);
}
.c-deadline.urgent {
  color: var(--theme-error, #cc594b);
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
.abandon-btn {
  align-self: flex-start;
  padding: 2px 10px;
  border: 0;
  background: transparent;
  color: var(--theme-text-muted, #967756);
  font-size: 0.75rem;
  cursor: pointer;
  text-decoration: underline;
}
.abandon-btn:hover:not(:disabled) {
  color: var(--theme-error, #cc594b);
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
