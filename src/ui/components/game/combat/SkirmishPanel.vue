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

/** 行为合同（SSS 律师函警告）：本拍出卡时附加的禁条（需持「合同」条目） */
const CONTRACT_TAGS = ['强攻', '防御', '闪避', '打断'] as const;
const canContract = computed(() => game.hasMechanicGate('合同'));
const contractForbidden = ref<'' | (typeof CONTRACT_TAGS)[number]>('');

/** 倒也可斩（SSS）：每场一次的一击。按钮只按「本场未用」显示；
 *  天赋门槛（oncePerBattleNuke 钩子）由编排层 skirmishNuke 再校验——UI 不越权判天赋。 */
const nukeAvailable = computed(
  () => !!session.value && session.value.finished === null && session.value.nukeUsed !== true,
);

async function doNuke() {
  await game.triggerSkirmishNuke();
}

/** 决斗宣战（S「西部决斗礼仪」）：本场禁用伙伴卡、隔离外部伤害与治疗 */
const canDuel = computed(() => game.hasMechanicGate('决斗'));
const duelAvailable = computed(
  () => canDuel.value && !!session.value && session.value.finished === null && !session.value.duel,
);
async function doDuel() {
  await game.declareDuel();
}

/** 献祭召唤（S「召唤媒介系统」）：献祭 HP 换数拍的行动值加成 */
const canSacrifice = computed(() => game.hasMechanicGate('献祭'));
async function doSacrifice() {
  await game.sacrificeSummon();
}

/** 禁忌卡六正本（委托×地图七链）：背包持有且本场未用的可打出 */
const FORBIDDEN_CARDS = [
  '禁忌卡·无名河',
  '禁忌卡·失年历',
  '禁忌卡·焚天引',
  '禁忌卡·万兽园',
  '禁忌卡·称心秤',
  '禁忌卡·白蜡城',
] as const;
const heldForbiddenCards = computed(() =>
  FORBIDDEN_CARDS.filter(
    (n) =>
      (game.player?.inventory ?? []).some((i) => i.name === n && i.type === '卡牌') &&
      !(session.value?.forbiddenUsed ?? []).includes(n),
  ),
);
const wishTier = ref<'small' | 'mid' | 'grand'>('small');
async function doCastForbidden(cardName: string) {
  const tier = cardName === '禁忌卡·称心秤' ? wishTier.value : undefined;
  await game.castForbiddenCard(cardName, tier);
}

/** 念出真名（S「真名看破系统」）：每场一次的精神冲击 */
const canTrueName = computed(() => game.hasMechanicGate('真名'));
const trueNameUsed = computed(() => session.value?.trueNameUsed === true);
const knownTrueNames = computed(() => game.knownTrueNames());
async function doTrueName() {
  await game.speakTrueName();
}

/** 热插拔（S「模块化天才」）：把已上场的模块化载具换一种形态再发动 */
const canHotSwap = computed(() => game.hasMechanicGate('模块化'));
async function doHotSwap() {
  await game.hotSwapModule();
}

/** 捕获（SSS「你是我的了」）：战胜后把对手变成伙伴卡 */
const canCapture = computed(() => game.hasMechanicGate('捕获'));
const capturing = ref(false);
const captureMsg = ref('');
const captureErr = ref('');
/** 可捕获时机：交锋已结束且为胜利/碾压 */
const captureAvailable = computed(() => {
  const s = session.value;
  if (!s || !canCapture.value) return false;
  if (s.finished !== '胜利' && s.finished !== '碾压') return false;
  return !(game.player?.inventory ?? []).some((i) => i.name === s.enemyName);
});
async function doCapture() {
  capturing.value = true;
  captureErr.value = '';
  captureMsg.value = '';
  const r = await game.captureEnemy();
  capturing.value = false;
  if (!r.ok) {
    captureErr.value = r.reason ?? '捕获失败';
    return;
  }
  captureMsg.value = r.summary ?? '捕获完成';
}
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
    ...(contractForbidden.value ? { contractForbidden: contractForbidden.value } : {}),
  });
  selectedCard.value = null;
  cardIntentText.value = '';
  contractForbidden.value = '';
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
        v-if="duelAvailable"
        type="button"
        class="counter-btn duel"
        :disabled="game.skirmishBusy"
        title="1v1：伙伴卡不上场，外部伤害与治疗被隔离"
        @click="doDuel"
      >
        宣战决斗（1v1）
      </button>
      <button
        v-if="canSacrifice"
        type="button"
        class="counter-btn sacrifice"
        :disabled="game.skirmishBusy"
        title="献祭一部分 HP，召唤存在助战数拍"
        @click="doSacrifice"
      >
        献祭召唤
      </button>
      <button
        v-if="canHotSwap"
        type="button"
        class="counter-btn modular"
        :disabled="game.skirmishBusy"
        title="把已上场的模块化载具换一种形态再发动（每场次数有限）"
        @click="doHotSwap"
      >
        热插拔模块
      </button>
      <button
        v-if="canTrueName && !trueNameUsed"
        type="button"
        class="counter-btn truename"
        :disabled="game.skirmishBusy"
        :title="
          knownTrueNames.includes(session?.enemyName ?? '')
            ? '这个名字你认过——冲击加成'
            : '念出对方真名，造成一次精神冲击（每场一次）'
        "
        @click="doTrueName"
      >
        念出真名
      </button>
      <button
        v-for="cardName in heldForbiddenCards"
        :key="cardName"
        type="button"
        class="counter-btn forbidden"
        :disabled="game.skirmishBusy"
        :title="`打出禁忌正本【${cardName}】——规则改写，每场限一次，代价照收`"
        @click="doCastForbidden(cardName)"
      >
        禁忌·{{ cardName.replace('禁忌卡·', '') }}
      </button>
      <div v-if="heldForbiddenCards.includes('禁忌卡·称心秤')" class="wish-tier-row">
        <span class="wish-label">称心秤档位：</span>
        <label v-for="t in ['small', 'mid', 'grand'] as const" :key="t" class="wish-opt">
          <input v-model="wishTier" type="radio" :value="t" :disabled="game.skirmishBusy" />
          {{ t === 'small' ? '小愿(回复)' : t === 'mid' ? '中愿(称走一敌)' : '大愿(逆转)' }}
        </label>
      </div>
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
      <div v-if="canContract" class="contract-row">
        <span class="strip-label">行为合同</span>
        <select
          v-model="contractForbidden"
          class="slot-select contract-select"
          aria-label="合同禁条"
        >
          <option value="">（不附加合同）</option>
          <option v-for="t in CONTRACT_TAGS" :key="t" :value="t">禁止敌方【{{ t }}】</option>
        </select>
        <span class="tag-hint">违约 → 敌方受反噬真实伤害</span>
      </div>
    </div>

    <div v-if="captureAvailable" class="nuke-row">
      <button type="button" class="capture-btn" :disabled="capturing" @click="doCapture">
        {{ capturing ? '捕获中…' : `捕获【${session?.enemyName}】为伙伴` }}
      </button>
    </div>
    <p v-if="captureMsg" class="tag-hint">{{ captureMsg }}</p>
    <p v-if="captureErr" class="tag-hint">{{ captureErr }}</p>

    <div v-if="nukeAvailable" class="nuke-row">
      <button type="button" class="nuke-btn" :disabled="game.skirmishBusy" @click="doNuke">
        倒也可斩（本场一次：半血一击，代价 90% HP）
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
background: color-mix(in srgb, var(--theme-success) 10%, transparent); } .contract-row { display:
flex; align-items: center; gap: var(--theme-spacing-sm); margin-top: var(--theme-spacing-xs);
flex-wrap: wrap; } .contract-select { max-width: 14rem; } .nuke-row { display: flex;
justify-content: center; margin-block: var(--theme-spacing-sm); } .nuke-btn { padding: 6px 18px;
border: 1px solid color-mix(in srgb, var(--theme-error, #e74c3c) 55%, var(--theme-card-border));
border-radius: var(--theme-radius-md); background: color-mix(in srgb, var(--theme-error, #e74c3c)
10%, transparent); color: var(--theme-error, #e74c3c); font-weight: 700; font-size: 0.8125rem;
cursor: pointer; font-family: inherit; } .nuke-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.capture-btn { padding: 6px 18px; border: 1px solid color-mix(in srgb, var(--theme-primary) 55%,
var(--theme-card-border)); border-radius: var(--theme-radius-md); background: color-mix(in srgb,
var(--theme-primary) 10%, transparent); color: var(--theme-primary); font-weight: 700; font-size:
0.8125rem; cursor: pointer; font-family: inherit; } .capture-btn:disabled { opacity: 0.5; cursor:
not-allowed; }
