<script setup lang="ts">
/**
 * FortuneAltar.vue — 命运祭坛（抽封铭卡 · 专属面板，2026-09-17）
 *
 * 纯 Code 确定性抽卡：d100 掷档 → cardPool 按档抽卡 → CardItem 直落背包+卡册。
 * 不经对话、不走 item_gen、不打断叙事——抽到的卡由 {{CHARACTER_STATE}} 在后续回合自然进场。
 * canon 口径：帝冕币掷问（小额）/ 命运点掷问（必得中品以上）。
 */
import { computed, ref } from 'vue';
import { useGameStore } from '../../../stores/game-store';
import { FORTUNE_MODES } from '@engine/card-workshop/fortune-draw';
import type { FortuneMode } from '@engine/card-workshop/fortune-draw';
import { cardTierVar } from '../../../lib/quality-colors';
import AppButton from '../../shared/AppButton.vue';

const game = useGameStore();

// ═══ 好运之骰（SS 天赋；十面全部 Code 兑现，见 fortune-dice.ts）═══
const canRollDice = computed(() => game.hasMechanicGate('日掷'));
const diceLeft = computed(() => (canRollDice.value ? game.dailyRemaining('好运之骰', 1) : 0));
const diceBusy = ref(false);
const diceError = ref('');
const diceResult = ref<{ pip: number; faceId: string; tone: string; summary: string } | null>(null);

async function rollDice() {
  if (diceBusy.value || diceLeft.value <= 0) return;
  diceBusy.value = true;
  diceError.value = '';
  const r = await game.rollFortuneDice();
  diceBusy.value = false;
  if (!r.ok) {
    diceError.value = r.reason ?? '投骰失败';
    return;
  }
  diceResult.value = {
    pip: r.pip ?? 0,
    faceId: r.faceId ?? '',
    tone: r.tone ?? '平',
    summary: r.summary ?? '',
  };
}

const mode = ref<FortuneMode>('coin');
const rolling = ref(false);
const rollDisplay = ref<number | null>(null);
const drawing = ref(false);
const error = ref('');

/** 揭示结果（drawFortune 成功后填充） */
const reveal = ref<{
  tier: string;
  name: string;
  cardTier: string;
  词条: string[];
  description: string;
  d100: number;
  summary: string;
} | null>(null);

const history = ref<{ name: string; cardTier: string }[]>([]);

const canAfford = computed(() => {
  const spec = FORTUNE_MODES[mode.value];
  if (mode.value === 'coin') return (game.player?.money ?? 0) >= spec.gcCost;
  return (game.fp ?? 0) >= spec.fpCost;
});

const modeLabel = (m: FortuneMode) => {
  const spec = FORTUNE_MODES[m];
  return m === 'coin' ? `${spec.label}（${spec.gcCost} GC）` : `${spec.label}（${spec.fpCost} FP）`;
};

async function draw() {
  if (drawing.value || !canAfford.value) return;
  drawing.value = true;
  rolling.value = true;
  error.value = '';
  reveal.value = null;

  // 骰面滚动动画：掷点数字翻滚 ~900ms 后揭示
  const spin = setInterval(() => {
    rollDisplay.value = 1 + Math.floor(Math.random() * 100);
  }, 60);
  await new Promise((r) => setTimeout(r, 900));
  clearInterval(spin);

  const r = await game.drawFortune(mode.value);
  rolling.value = false;
  if (!r.ok) {
    rollDisplay.value = null;
    error.value = r.reason;
    drawing.value = false;
    return;
  }
  rollDisplay.value = r.d100;
  reveal.value = {
    tier: r.tier,
    name: r.card.name,
    cardTier: r.card.cardTier,
    词条: r.card.词条,
    description: r.card.description,
    d100: r.d100,
    summary: r.summary,
  };
  history.value.unshift({ name: r.card.name, cardTier: r.card.cardTier });
  drawing.value = false;
}
</script>

<template>
  <div class="fortune-altar">
    <p class="altar-verse">
      守誓人守着一座封铭卡堆，任人向底石掷问。<br />
      你抽到的不是「你想要的」，是底石此刻愿意说的。
    </p>

    <!-- 掷问口径 -->
    <div class="mode-row" role="radiogroup" aria-label="掷问方式">
      <button
        v-for="m in ['coin', 'fp'] as const"
        :key="m"
        type="button"
        class="mode-btn"
        :class="{ active: mode === m }"
        role="radio"
        :aria-checked="mode === m"
        :disabled="drawing"
        @click="mode = m"
      >
        {{ modeLabel(m) }}
      </button>
    </div>

    <!-- 骰面 -->
    <div class="dice-stage" aria-live="polite">
      <div v-if="rolling" class="dice-rolling">{{ rollDisplay }}</div>
      <div v-else-if="reveal" class="dice-final" :data-tier="reveal.tier">
        {{ reveal.d100 }}
      </div>
      <div v-else class="dice-idle">d100</div>
    </div>

    <!-- 揭示 -->
    <div v-if="reveal" class="reveal-card" :data-tier="reveal.cardTier">
      <div class="reveal-head">
        <span class="reveal-name">{{ reveal.name }}</span>
        <span class="reveal-tier" :style="{ color: cardTierVar(reveal.cardTier) }">{{
          reveal.cardTier
        }}</span>
      </div>
      <div class="reveal-词条">
        <span v-for="w in reveal.词条" :key="w" class="chip">{{ w }}</span>
      </div>
      <p v-if="reveal.description" class="reveal-desc">{{ reveal.description }}</p>
      <p class="reveal-note">已入卡册（未编入卡组）——抽中什么念出什么，不许当场弃卡。</p>
    </div>

    <p v-if="error" class="altar-error" role="alert">{{ error }}</p>

    <!-- 好运之骰（SS）：每日一次的十面骰，十面全部 Code 兑现 -->
    <section v-if="canRollDice" class="altar-dice" aria-label="好运之骰">
      <h4 class="d-label">好运之骰（天赋：好运之骰）</h4>
      <p class="altar-verse small">
        每天一次投十面骰——十面各有各的兑现，底石说完就作数。<b>今日剩余 {{ diceLeft }} 次</b>。
      </p>
      <div v-if="diceResult" class="dice-result" :data-tone="diceResult.tone">
        <span class="dice-pip">{{ diceResult.pip }}</span>
        <span class="dice-face">{{ diceResult.faceId }}（{{ diceResult.tone }}）</span>
        <p class="dice-summary">{{ diceResult.summary }}</p>
      </div>
      <p v-if="diceError" class="altar-error" role="alert">{{ diceError }}</p>
      <AppButton
        variant="primary"
        :disabled="diceLeft <= 0 || diceBusy"
        :loading="diceBusy"
        @click="rollDice"
      >
        {{ diceLeft > 0 ? '投十面骰' : '今日已投过' }}
      </AppButton>
    </section>

    <AppButton variant="primary" :disabled="!canAfford || drawing" :loading="drawing" @click="draw">
      {{
        mode === 'coin'
          ? `掷问一次（${FORTUNE_MODES.coin.gcCost} GC）`
          : `掷问一次（${FORTUNE_MODES.fp.fpCost} FP）`
      }}
    </AppButton>

    <div v-if="history.length" class="altar-history">
      <span class="hist-label">今晚的卡堆：</span>
      <span v-for="(h, i) in history" :key="i" class="hist-item">
        {{ h.name }}（{{ h.cardTier }}）<template v-if="i < history.length - 1">、</template>
      </span>
    </div>
  </div>
</template>

<style scoped>
.fortune-altar {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-md);
  padding: var(--theme-spacing-md);
  min-height: 20rem;
}
.altar-verse {
  margin: 0;
  text-align: center;
  color: var(--theme-text-secondary);
  font-size: 0.85rem;
  line-height: 1.8;
  font-style: italic;
}
.mode-row {
  display: flex;
  gap: var(--theme-spacing-sm);
  justify-content: center;
}
.mode-btn {
  padding: 8px 18px;
  border: 1px solid var(--theme-card-border);
  border-radius: var(--theme-radius-md);
  background: var(--theme-card-bg);
  color: var(--theme-text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  font-family: inherit;
  transition: all var(--theme-transition-fast);
}
.mode-btn.active {
  border-color: var(--theme-primary);
  color: var(--theme-primary);
  background: color-mix(in srgb, var(--theme-primary) 10%, transparent);
}
.mode-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dice-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 5.5rem;
}
.dice-idle {
  font-size: 1.5rem;
  color: var(--theme-text-muted);
  opacity: 0.4;
  font-variant-numeric: tabular-nums;
}
.dice-rolling {
  font-size: 2.5rem;
  font-family: var(--theme-font-title, serif);
  color: var(--theme-primary);
  font-variant-numeric: tabular-nums;
  animation: dice-pulse 0.12s infinite alternate;
}
@keyframes dice-pulse {
  from {
    opacity: 0.55;
    transform: scale(0.97);
  }
  to {
    opacity: 1;
    transform: scale(1.05);
  }
}
.dice-final {
  font-size: 2.75rem;
  font-family: var(--theme-font-title, serif);
  font-weight: 700;
  color: var(--theme-text-primary);
  font-variant-numeric: tabular-nums;
}
.reveal-card {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-sm);
  padding: var(--theme-spacing-md);
  border: 1px solid var(--theme-primary);
  border-radius: var(--theme-radius-md);
  background: color-mix(in srgb, var(--theme-primary) 6%, var(--theme-card-bg));
  animation: reveal-in 0.35s ease;
}
@keyframes reveal-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.reveal-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--theme-spacing-sm);
}
.reveal-name {
  font-family: var(--theme-font-title, serif);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--theme-text-primary);
}
.reveal-tier {
  font-size: 0.95rem;
  font-weight: 700;
}
.reveal-词条 {
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
.reveal-desc {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--theme-text-secondary);
  line-height: 1.6;
}
.reveal-note {
  margin: 0;
  font-size: 0.72rem;
  color: var(--theme-text-muted);
  font-style: italic;
}
.altar-error {
  margin: 0;
  font-size: 0.8rem;
  color: var(--theme-error);
  text-align: center;
}
.altar-history {
  font-size: 0.75rem;
  color: var(--theme-text-muted);
  line-height: 1.7;
}
.hist-label {
  font-weight: 600;
}
</style>
