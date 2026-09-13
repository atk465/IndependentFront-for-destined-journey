<script setup lang="ts">
/** 开发者模式分区 —— 单一开关 + 清晰的诊断边界。 */
import { ref } from 'vue';
import AppCard from '../shared/AppCard.vue';
import { useSettingsStore } from '../../stores/settings-store';
import { useGameStore } from '../../stores/game-store';

const s = useSettingsStore().settings;
const game = useGameStore();
const devSeeding = ref(false);
const devFeedback = ref<{ kind: 'ok' | 'err'; msg: string } | null>(null);

defineProps<{ devMode?: boolean }>();

async function seedDemo() {
  devSeeding.value = true;
  const r = await game.seedDemoCards();
  devSeeding.value = false;
  devFeedback.value = r.ok
    ? { kind: 'ok', msg: '演示卡已注入背包并编入卡组，可进战斗验证玩卡链路' }
    : { kind: 'err', msg: r.reason ?? '注入失败' };
}

/** 交锋拍试打：直接发起遭遇战（busy 守卫在 store 入口） */
function onSkirmishTrial() {
  void game.startSkirmish();
}
</script>

<template>
  <section class="section centered">
    <h3>开发者模式</h3>
    <p class="section-desc">
      解锁 Agent 诊断与原始运行数据。普通游玩中的回合进程仍使用游戏语言，不会变成技术控制台。
    </p>

    <AppCard padding="md" class="developer-mode-card" :class="{ 'is-enabled': s.developerMode }">
      <div class="developer-toggle-row">
        <div class="developer-copy">
          <div class="developer-title-row">
            <h4>开发者模式</h4>
            <span class="developer-state" :class="{ 'is-enabled': s.developerMode }">
              <i
                :class="s.developerMode ? 'fa-solid fa-code' : 'fa-solid fa-lock'"
                aria-hidden="true"
              ></i>
              {{ s.developerMode ? '已开启' : '已关闭' }}
            </span>
          </div>
          <p id="developer-mode-help" class="card-desc">
            开启后，游戏工具栏会出现「调试」入口，并启用 Alt + Shift + D 诊断抽屉。
          </p>
        </div>

        <label class="toggle-label developer-toggle">
          <input
            v-model="s.developerMode"
            type="checkbox"
            role="switch"
            class="toggle-input"
            aria-label="开发者模式"
            aria-describedby="developer-mode-help"
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
    </AppCard>

    <AppCard padding="md">
      <h4>启用后可查看</h4>
      <ul class="developer-capabilities">
        <li>
          <i class="fa-solid fa-bug" aria-hidden="true"></i>
          <span><strong>Agent 调用日志</strong>请求消息、模型响应、耗时与 token 用量</span>
        </li>
        <li>
          <i class="fa-solid fa-screwdriver-wrench" aria-hidden="true"></i>
          <span><strong>工具往返</strong>工具名称、参数、结果与失败原因</span>
        </li>
        <li>
          <i class="fa-solid fa-file-export" aria-hidden="true"></i>
          <span><strong>诊断导出</strong>当前回合与存档快照，便于复现和定位问题</span>
        </li>
      </ul>

      <p class="developer-warning" role="note">
        <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
        诊断内容可能包含对话正文、提示词与模型原始输出。分享导出文件前请先检查内容。
      </p>
    </AppCard>

    <!-- 演示卡注入（仅 dev 模式可见）——真机走查玩卡链路用，生产构建自动消除 -->
    <AppCard v-if="devMode" padding="md">
      <h4>演示卡注入（dev）</h4>
      <p class="card-desc">
        一键给玩家背包塞 4 张覆盖八类的演示卡（灼热盆地白银/远古巨兽·岩爪鎏金/
        燃魂打击青铜/苍穹之翼白银）+ 3 份常用素材，并自动编入卡组。进战斗后即可在
        「战斗卡组条」看到四态显示、单击出牌——专用于不依赖 LLM 也能验证玩卡链路。
      </p>
      <div class="developer-toggle-row">
        <button
          type="button"
          class="app-btn btn-primary btn-md"
          :disabled="devSeeding || !s.developerMode"
          @click="seedDemo"
        >
          {{ devSeeding ? '注入中…' : '注入演示卡' }}
        </button>
        <p
          v-if="devFeedback"
          class="card-desc"
          :class="devFeedback.kind === 'err' ? 'developer-feedback-err' : 'developer-feedback-ok'"
        >
          {{ devFeedback.msg }}
        </p>
      </div>
    </AppCard>

    <!-- 交锋拍试打（仅 dev 模式可见）——不依赖 dispatcher 触发，直接开一场遭遇战 -->
    <AppCard v-if="devMode" padding="md">
      <h4>交锋拍试打（dev）</h4>
      <p class="card-desc">
        跳过 combat_trigger，直接发起一场遭遇战（敌情评估一次 AI 调用 → 交锋拍 → 终局结算落库 →
        终局演绎一次 AI 调用）。战报审计行走正文流，状态栏与反制 按钮在游戏页的「战斗模式 ·
        交锋拍」面板。需要 skirmish_eval / skirmish_epilogue 两个 Agent 可解析到 API 池。
      </p>
      <div class="developer-toggle-row">
        <button
          type="button"
          class="app-btn btn-primary btn-md"
          :disabled="devSeeding || !s.developerMode || game.skirmishBusy"
          @click="onSkirmishTrial"
        >
          {{ game.skirmishBusy ? '交锋进行中…' : '发起遭遇战' }}
        </button>
      </div>
    </AppCard>
  </section>
</template>

<!-- 共用外壳（.section>h3 / .section-desc / .toggle-*）：唯一一份在 settings-chrome.css -->
<style scoped src="./settings-chrome.css"></style>

<style scoped>
.developer-mode-card {
  transition:
    border-color var(--theme-transition-fast),
    background-color var(--theme-transition-fast);
}

.developer-mode-card.is-enabled {
  border-color: color-mix(in srgb, var(--theme-primary) 45%, var(--theme-card-border));
  background-color: color-mix(in srgb, var(--theme-primary) 5%, var(--theme-card-bg));
}

.developer-toggle-row,
.developer-title-row {
  display: flex;
  align-items: center;
}

.developer-toggle-row {
  justify-content: space-between;
  gap: var(--theme-spacing-lg);
}

.developer-copy {
  min-width: 0;
  flex: 1;
}

.developer-title-row {
  flex-wrap: wrap;
  gap: var(--theme-spacing-sm);
  margin-bottom: var(--theme-spacing-xs);
}

.developer-title-row h4 {
  margin: 0;
  color: var(--theme-text-primary);
  font-size: 0.95rem;
}

.developer-copy .card-desc {
  margin: 0;
}

.developer-state {
  display: inline-flex;
  align-items: center;
  gap: var(--theme-spacing-xs);
  padding: calc(var(--theme-spacing-xs) / 2) var(--theme-spacing-sm);
  border: 1px solid var(--theme-card-border);
  border-radius: 999px;
  color: var(--theme-text-muted);
  background: var(--theme-content-bg);
  font-size: 0.6875rem;
  line-height: 1.5;
}

.developer-state.is-enabled {
  border-color: color-mix(in srgb, var(--theme-success) 36%, var(--theme-card-border));
  color: var(--theme-success);
  background: color-mix(in srgb, var(--theme-success) 8%, var(--theme-card-bg));
}

.developer-toggle {
  flex: 0 0 auto;
  min-width: 44px;
  min-height: 44px;
  justify-content: center;
}

.developer-capabilities {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--theme-spacing-md);
}

.developer-capabilities li {
  min-width: 0;
  display: grid;
  grid-template-columns: 1.75rem minmax(0, 1fr);
  align-items: start;
  gap: var(--theme-spacing-sm);
  padding: var(--theme-spacing-md);
  border: 1px solid var(--theme-card-border);
  border-radius: var(--theme-radius-md);
  color: var(--theme-text-secondary);
  background: var(--theme-content-bg);
  font-size: 0.75rem;
  line-height: 1.55;
}

.developer-capabilities li > i {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  color: var(--theme-primary);
  background: color-mix(in srgb, var(--theme-primary) 9%, var(--theme-card-bg));
  font-size: 0.6875rem;
}

.developer-capabilities strong {
  display: block;
  margin-bottom: calc(var(--theme-spacing-xs) / 2);
  color: var(--theme-text-primary);
  font-size: 0.8rem;
}

.developer-warning {
  display: flex;
  align-items: flex-start;
  gap: var(--theme-spacing-sm);
  margin: var(--theme-spacing-md) 0 0;
  padding-top: var(--theme-spacing-md);
  border-top: 1px solid var(--theme-card-border);
  color: var(--theme-text-muted);
  font-size: 0.75rem;
  line-height: 1.55;
}

.developer-warning i {
  margin-top: 0.15em;
  color: var(--theme-primary);
}

@media (max-width: 900px) {
  .developer-capabilities {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .developer-toggle-row {
    align-items: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .developer-mode-card {
    transition: none;
  }
}
</style>
