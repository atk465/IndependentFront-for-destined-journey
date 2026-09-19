<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useGameStore, setRewriteLoadoutImpl, setCraftNarrateImpl, setCommissionNarrateImpl } from '../../stores/game-store';
import { useUIStore } from '../../stores/ui-store';
import { useSettingsStore } from '../../stores/settings-store';
import { unwireEffectSystem } from '@engine/effect-wiring';
import { GamePipeline, waitForGameSaveIdle } from '../../lib/game-pipeline';
import TopBar from './TopBar.vue';
import SideToolbar from './SideToolbar.vue';
import ChatFlow from './ChatFlow.vue';
import ScenePanel from './ScenePanel.vue';
import StatusHUD from './StatusHUD.vue';
import AppModal from '../shared/AppModal.vue';
import ItemsPanel from './ItemsPanel.vue';
import CharacterListPanel from './CharacterListPanel.vue';
import QuestsPanel from './QuestsPanel.vue';
import PlotPanel from './PlotPanel.vue';
import MemoryPanel from './MemoryPanel.vue';
import SnapshotPanel from './SnapshotPanel.vue';
import MapPanel from './MapPanel.vue';
import DebugPanel from './DebugPanel.vue';
import CardAlbumPanel from './cards/CardAlbumPanel.vue';
import FortuneAltar from './cards/FortuneAltar.vue';
import CommissionBoard from './cards/CommissionBoard.vue';
import ExplorationPanel from './cards/ExplorationPanel.vue';
import TalentPanel from './cards/TalentPanel.vue';
import CraftBench from './cards/CraftBench.vue';
import SkirmishPanel from './combat/SkirmishPanel.vue';

const game = useGameStore();
const ui = useUIStore();
const settings = useSettingsStore();
const s = settings.settings;

let pipeline: GamePipeline | null = null;
let disposed = false;
const requestedSaveId = ui.activeSaveId;
const ownsPage = () =>
  !disposed && ui.currentView === 'game' && ui.activeSaveId === requestedSaveId;
const streamingText = ref('');
const loadingSave = ref(true);
let streamingFrame: number | null = null;
let pendingStreamingText = '';

function cancelStreamingPreview() {
  if (streamingFrame !== null) cancelAnimationFrame(streamingFrame);
  streamingFrame = null;
  pendingStreamingText = '';
  streamingText.value = '';
}

/** 网络 delta 可能远快于绘制；每帧只提交最新可见快照，避免整段正文重复重排。 */
function handleStoryChunk(chunk: string, isComplete: boolean) {
  if (isComplete) {
    cancelStreamingPreview();
    return;
  }
  pendingStreamingText = chunk;
  if (streamingFrame !== null) return;
  streamingFrame = requestAnimationFrame(() => {
    streamingFrame = null;
    streamingText.value = pendingStreamingText;
  });
}

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown);
  console.log('[GamePage] onMounted, activeSaveId:', ui.activeSaveId);
  if (requestedSaveId) {
    try {
      console.log('[GamePage] loading save...');
      await waitForGameSaveIdle(requestedSaveId);
      if (!ownsPage()) return;
      if (!(await game.loadSave(requestedSaveId)) || !ownsPage()) return;
      // API endpoint construction is synchronous, so hydrate/migrate its secrets before creating it.
      await settings.initApiSecrets();
      if (!ownsPage()) return;
      console.log(
        '[GamePage] save loaded, hasOpeningPromptConsumed:',
        game.hasOpeningPromptConsumed,
        'openingPrompt exists:',
        !!game.openingPrompt,
      );
      // 创建 pipeline 实例
      pipeline = new GamePipeline({
        gameStore: game,
        settingsStore: settings,
        saveId: requestedSaveId,
      });
      // 🆕 重铸（2026-08-24）：单条目重铸的注入缝 —— GamePipeline 装配
      //     endpoint / chainData（含 worldBooks） / stateManager；store 与面板不直接碰装配。
      setRewriteLoadoutImpl((characterId, target, userDescription) =>
        pipeline
          ? pipeline.rewriteLoadoutItem(characterId, target, userDescription)
          : Promise.resolve({ ok: false, reason: '游戏管线还没就绪，稍后再试' }),
      );
      // 🆕 制卡主路（2026-09-17 第三档）：制卡在 store 里算完，只有命名与叙事
      //     需要 endpoint/clientFactory —— 同样走缝注入，store 与面板不碰装配。
      setCraftNarrateImpl((req) =>
        pipeline ? pipeline.narrateCardCraft(req) : Promise.reject(new Error('游戏管线还没就绪')),
      );
      // 🆕 委托终点叙事（2026-09-19 共识稿 #13 修订）：获得瞬间的叙事拍（获得场景，
      //     非颁授场景）——同一条缝模式，失败回退模板文案，发放永不被叙事阻塞。
      setCommissionNarrateImpl((req) =>
        pipeline
          ? pipeline.narrateCommissionFinale(req)
          : Promise.reject(new Error('游戏管线还没就绪')),
      );
      // 首次加载 → 自动发送开场 Prompt
      loadingSave.value = false;
      if (!game.hasOpeningPromptConsumed && game.openingPrompt) {
        console.log('[GamePage] sending opening prompt...');
        await pipeline.sendOpeningPrompt(handleStoryChunk);
      } else {
        console.log(
          '[GamePage] NOT sending opening prompt. consumed:',
          game.hasOpeningPromptConsumed,
          'prompt empty:',
          !game.openingPrompt,
        );
      }
    } catch (err) {
      if (ownsPage()) {
        ui.toast(`存档加载失败：${err instanceof Error ? err.message : '请重试'}`, 'error');
        ui.navigate('home');
      }
    }
  } else {
    console.log('[GamePage] no activeSaveId, skipping');
  }
});

/** 🧪 开发用测试注入 — 仍限定 DEV 构建，且要求用户已开启开发者模式。 */
async function injectChatFlowTest() {
  if (!s.developerMode) return;
  // 确保所有系统事件类型都可见
  s.systemEventsVisible = true;
  s.systemEventFilters = {
    craft: true,
    char_gen: true,
    item_gen: true,
    combat: true,
    character_update: true,
    item_update: true,
    quest_update: true,
  };
  // 动态 import：test-fixtures 只在调用时加载，不进生产首包
  const { injectTestData, buildScenePreviewMock } = await import('../../lib/test-fixtures');
  // 注入 ScenePanel 中段(在场NPC + thoughts 心里话) 与下段(新闻) 预览数据
  // 经 store.getThoughts(CharacterState.thoughts 正式字段，M6 单源)、saveProfile.news 读取
  const preview = buildScenePreviewMock();
  game.hydratePreview(preview);
  // 先清空再注入 ChatFlow 消息
  injectTestData({
    messages: game.messages,
    isGenerating: game.isGenerating,
  });
}

// 暴露到全局，方便控制台调用: window.__injectChatFlowTest__()
// 🔒 P1-14: 仅 DEV 构建暴露 —— 生产构建不该有可注入测试数据的入口（会污染真实存档）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as any).__injectChatFlowTest__ = injectChatFlowTest;
}

// Alt+Shift+D 属于用户可控的开发者模式；Ctrl+Shift+T 测试注入仍只在 DEV 构建响应。
function onKeyDown(e: KeyboardEvent) {
  if (!s.developerMode) return;
  if (import.meta.env.DEV && e.ctrlKey && e.shiftKey && e.key === 'T') {
    e.preventDefault();
    void injectChatFlowTest();
  }
  // Alt+Shift+D 切换调试面板
  if (e.altKey && e.shiftKey && e.key === 'D') {
    e.preventDefault();
    showDebug.value = !showDebug.value;
  }
}

// ===== 调试面板 =====
const showDebug = ref(false);

// 关闭开关必须立刻收起所有原始诊断面，不能只把下次入口藏起来。
watch(
  () => s.developerMode,
  (enabled) => {
    if (enabled) return;
    showDebug.value = false;
    if (game.activeModal === 'debug') game.closeModal();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  disposed = true;
  game.invalidatePendingLoads();
  window.removeEventListener('keydown', onKeyDown);
  // 🔴 COR-02（2026-08-09 审查）：**先 abort 再清 isGenerating**。
  // 应用没有 KeepAlive（App.vue 用 `:key="ui.currentView"`），而「← 首页」是一个
  // 始终可点的按钮 —— 生成中途导航就会在这里卸载 GamePage。此前不调 abort，仍在飞的
  // run() 之后会走到 handleAgentResult → game.addMessage(...)，而 game-store 是从
  // **store** 而不是从 pipeline 取存档号的。于是「存档 A 生成中 → 回首页 → 打开存档 B」
  // 会把为 A 生成的正文追加进 B 并以 saveId:B 落库，永久留在 B 的历史里。
  // （漏网写入还有第二道闸：GamePipeline 内的 emitMessage 存档归属检查。）
  pipeline?.dispose();
  if (requestedSaveId) unwireEffectSystem(requestedSaveId);
  // 🆕 T4（设计 §8.1 / §9）：离开游戏页 = 存档切换/销毁的既有清理点。本 pipeline 是
  //    per-save 实例，invalidatePromptSessions 只清自己的 saveId 的全部 prompt session
  //    （切档/删档都发生在离开游戏页之后，而 session 是模块级内存态，不清会一直驻留）。

  cancelStreamingPreview();
  game.isGenerating = false;
  //    exitCombat 收掉挂起的 await（resolve(null)）并清确认态——否则 pipeline 的
  //    await 永久悬挂。战斗进行中/就绪态**不清**：切设置页再回来战斗还能接着打
  //    （CombatPanel 重新挂载后 v3ActiveCombat 还在，这是现状下能工作的场景）。
});

async function handleSend(content: string) {
  // 🔴 交锋活跃分流（2026-09-17 路线图 1.1）：自由文本提名出卡。
  //  L1 卡名精确匹配 + L2 AI 意图解析都在 pipeline.trySkirmishFreeText 内；
  //  返回 false（没有出牌/应对意思）→ 照旧走叙事管线，交锋中的自由对话不禁止。
  if (pipeline && game.skirmishSession && !game.skirmishSession.finished && !game.isGenerating) {
    const handled = await pipeline.trySkirmishFreeText(content);
    if (handled) return;
  }

  // 🔴 2026-09-13 真机：这两个守卫原先**静默 return** —— 一旦某个请求长时间不返回
  //（上游 60s 超时/重试中），玩家看到的就是「按什么都没反应」，无从判断是卡死还是
  // 在生成。改为明说原因：生成中提示可点停止；管线缺失提示重进存档。
  if (!pipeline) {
    ui.toast('游戏管线未就绪，请退出存档后重新进入', 'error');
    return;
  }
  if (game.isGenerating) {
    ui.toast('本回合生成中：可点「停止」中断，或等待其结束', 'info');
    return;
  }
  cancelStreamingPreview();
  await pipeline.run(content, handleStoryChunk);
}

function handleStop() {
  pipeline?.abort();
  cancelStreamingPreview();
}

function handleToolClick(id: string) {
  if (id === 'settings') {
    ui.navigate('settings');
    return;
  }
  if (id === 'debug' && !s.developerMode) return;
  game.showModal(id);
}

function handleSelectOption(text: string) {
  game.fillInput(text);
}

function onModalOpenChange(v: boolean) {
  if (!v) game.closeModal();
}
</script>

<template>
  <div class="game-page-layout">
    <TopBar />
    <div class="game-body" :class="{ 'rail-collapsed': game.sidebarCollapsed }">
      <SideToolbar @tool-click="handleToolClick" />
      <ScenePanel />
      <div v-if="loadingSave" class="save-loading" role="status">
        正在加载存档，等待上一回合收尾…
      </div>
      <ChatFlow
        v-else
        :messages="game.messages"
        :is-generating="game.isGenerating"
        :system-events-visible="s.systemEventsVisible"
        :system-event-filters="s.systemEventFilters"
        :streaming-text="streamingText"
        @send="handleSend"
        @select-option="handleSelectOption"
        @stop="handleStop"
      />
      <StatusHUD />
    </div>

    <!-- 交锋拍制战斗面板（设计共识 §8；session 驱动，战报审计行走正文流） -->
    <SkirmishPanel />

    <AppModal
      title="背包 / 装备 / 技能"
      :open="game.activeModal === 'items'"
      size="xxl"
      closable
      @close="game.closeModal()"
      @update:open="onModalOpenChange"
    >
      <ItemsPanel />
    </AppModal>
    <AppModal
      title="角色列表"
      :open="game.activeModal === 'characters'"
      size="xxl"
      closable
      @close="game.closeModal()"
      @update:open="onModalOpenChange"
    >
      <CharacterListPanel />
    </AppModal>
    <AppModal
      title="任务"
      :open="game.activeModal === 'quests'"
      size="xxl"
      closable
      @close="game.closeModal()"
      @update:open="onModalOpenChange"
    >
      <QuestsPanel />
    </AppModal>
    <AppModal
      title="剧情规划"
      :open="game.activeModal === 'plot'"
      size="xxl"
      closable
      @close="game.closeModal()"
      @update:open="onModalOpenChange"
    >
      <PlotPanel />
    </AppModal>
    <AppModal
      title="记忆"
      :open="game.activeModal === 'memory'"
      size="xxl"
      closable
      @close="game.closeModal()"
      @update:open="onModalOpenChange"
    >
      <MemoryPanel />
    </AppModal>
    <AppModal
      title="快照"
      :open="game.activeModal === 'snapshots'"
      size="md"
      closable
      @close="game.closeModal()"
      @update:open="onModalOpenChange"
    >
      <SnapshotPanel />
    </AppModal>
    <AppModal
      title="地图"
      :open="game.activeModal === 'map'"
      size="xxl"
      closable
      @close="game.closeModal()"
      @update:open="onModalOpenChange"
    >
      <MapPanel />
    </AppModal>
    <AppModal
      title="调试 & 导出"
      :open="s.developerMode && game.activeModal === 'debug'"
      size="xxl"
      closable
      @close="game.closeModal()"
      @update:open="onModalOpenChange"
    >
      <DebugPanel />
    </AppModal>
    <AppModal
      title="卡册 · 铭刻纪元"
      :open="game.activeModal === 'cardAlbum'"
      size="xl"
      closable
      @close="game.closeModal()"
      @update:open="onModalOpenChange"
    >
      <CardAlbumPanel />
    </AppModal>
    <AppModal
      title="命运祭坛 · 铭刻纪元"
      :open="game.activeModal === 'fortuneAltar'"
      size="md"
      closable
      @close="game.closeModal()"
      @update:open="onModalOpenChange"
    >
      <FortuneAltar />
    </AppModal>
    <AppModal
      title="公会委托板 · 铭刻纪元"
      :open="game.activeModal === 'commissionBoard'"
      size="lg"
      closable
      @close="game.closeModal()"
      @update:open="onModalOpenChange"
    >
      <CommissionBoard />
    </AppModal>
    <AppModal
      title="野外探索 · 铭刻纪元"
      :open="game.activeModal === 'exploration'"
      size="md"
      closable
      @close="game.closeModal()"
      @update:open="onModalOpenChange"
    >
      <ExplorationPanel />
    </AppModal>
    <AppModal
      title="天赋 · 铭刻纪元"
      :open="game.activeModal === 'talentPanel'"
      size="lg"
      closable
      @close="game.closeModal()"
      @update:open="onModalOpenChange"
    >
      <TalentPanel />
    </AppModal>
    <AppModal
      title="制卡工作台"
      :open="game.activeModal === 'craftBench'"
      size="xl"
      closable
      @close="game.closeModal()"
      @update:open="onModalOpenChange"
    >
      <CraftBench />
    </AppModal>

    <!-- 调试面板 (Alt+Shift+D) -->
    <Teleport to="body">
      <div v-if="s.developerMode && showDebug" class="debug-drawer">
        <div class="debug-header">
          <span>Debug Panel</span>
          <button @click="showDebug = false">✕</button>
        </div>
        <div class="debug-section">
          <h4>Messages ({{ game.messages.length }})</h4>
          <pre>{{ JSON.stringify(game.messages.slice(-5), null, 2) }}</pre>
        </div>
        <div class="debug-section">
          <h4>Save Profile</h4>
          <pre>{{ JSON.stringify(game.saveProfile, null, 2) }}</pre>
        </div>
        <div class="debug-section">
          <h4>Characters ({{ game.characters.length }})</h4>
          <pre>{{
            JSON.stringify(
              game.characters.map((c) => ({ id: c.id, name: c.name, type: c.type })),
              null,
              2,
            )
          }}</pre>
        </div>
        <div class="debug-section">
          <h4>Pending Options</h4>
          <pre>{{ JSON.stringify(game.pendingOptions, null, 2) }}</pre>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.save-loading {
  flex: 1;
  align-self: center;
  padding: var(--theme-spacing-lg);
  color: var(--theme-text-secondary);
  text-align: center;
}

.game-page-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  min-width: 900px;
  background: var(--theme-window-bg);
  color: var(--theme-text-primary);
  overflow: hidden;
}
/* 三分屏比例（PC 16:9）: 左 25% (工具栏 + 场景栏) | 正文 50% | 状态栏 25%
   --rail-w 是工具栏实宽，ScenePanel 用 calc(25% - var(--rail-w)) 补足左侧那 25%，
   所以侧栏折叠时场景栏自动吃掉让出的宽度，左块恒为 25%。 */
.game-body {
  --rail-w: 4.2rem;
  display: flex;
  flex: 1;
  overflow: hidden;
}
.game-body.rail-collapsed {
  --rail-w: 1.925rem;
}
.placeholder-panel {
  padding: 2.5rem;
  text-align: center;
  color: var(--theme-text-muted);
  font-size: 0.875rem;
  min-height: 12.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* Panel content inside modals needs explicit height to scroll */
:deep(.modal-body) > :first-child {
  max-height: 55vh;
  overflow-y: auto;
}

/* ===== 调试面板 ===== */
.debug-drawer {
  position: fixed;
  top: 0;
  right: 0;
  width: 420px;
  max-width: 90vw;
  height: 100vh;
  background: var(--theme-content-bg);
  color: var(--theme-text-primary);
  border-left: 1px solid var(--theme-card-border);
  z-index: var(--z-tooltip, 500);
  overflow-y: auto;
  padding: 16px;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 0.75rem;
}
.debug-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--theme-card-border);
}
.debug-header span {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--theme-primary);
}
.debug-header button {
  background: none;
  border: 1px solid var(--theme-card-border);
  color: var(--theme-text-muted);
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.debug-section {
  margin-bottom: 16px;
}
.debug-section h4 {
  font-size: 0.75rem;
  color: var(--theme-text-secondary);
  margin: 0 0 4px;
}
.debug-section pre {
  background: var(--theme-window-bg);
  padding: 8px;
  border-radius: 4px;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
