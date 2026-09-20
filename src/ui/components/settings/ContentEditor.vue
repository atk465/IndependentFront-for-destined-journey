<script setup lang="ts">
/**
 * ContentEditor.vue — 开发者模式自定义内容编辑器（天赋 + 购卡池）
 *
 * 两个标签页：天赋编辑器 / 购卡编辑器。
 * 数据走 game-store 的 customTalents / customCards 通道（worldFlags 持久化）。
 * 天赋提交前走 validateTalentEntries 校验（AI 零编数门禁照旧）。
 */
import { computed, ref, watch } from 'vue';
import { useGameStore } from '../../stores/game-store';
import {
  TALENT_ENTRY_POOL,
  validateTalentEntries,
  registerCustomTalent,
  unregisterCustomTalent,
  getCustomTalents,
  type TalentTemplate,
  type TalentGrade,
  type TalentEntry,
} from '@engine/card-workshop/talent-entry';
import type { CardCatalogItem } from '@engine/start-catalog-mechanics';
import { CARD_TIERS, type CardTier } from '@engine/field-enums';
import { coerceCustomCards, coerceCustomTalents } from '@engine/card-workshop/custom-content';
import {
  coerceCustomCommissions,
  coerceCustomEvents,
  getCustomCommissions,
  getCustomEvents,
  registerCustomCommission,
  registerCustomEvent,
} from '@engine/card-workshop/custom-commissions';
import type { CommissionDef } from '@engine/card-workshop/commission';
import { QUEST_CHAIN_COMMISSION_SEEDS } from '@engine/card-workshop/quest-chain-seeds';
import type { RandomEventDef } from '@engine/types-random-events';
import { getMapPack } from '@engine/map-runtime';
import { getCommissionDefs } from '@engine/commission-runtime';
import { getPurchasableCardPool } from '@engine/card-workshop/card-pool';
import {
  TALENT_TEMPLATE,
  CARD_TEMPLATE,
  buildTemplateBundle,
} from '@engine/card-workshop/content-templates';
import AppButton from '../shared/AppButton.vue';

const game = useGameStore();
const tab = ref<'talent' | 'card' | 'commission'>('talent');

/**
 * 列表刷新闸（2026-09-18）。
 *
 * 🔴 自定义天赋/卡的注册表是**模块级普通 Map**（引擎层不引 Vue），`computed` 读它
 *    建立不了依赖 —— 保存/删除后列表不会重画（天赋那侧此前就带着这个毛病）。
 *    写操作之后手动自增一次，等于"重新读一遍注册表"。
 */
const listsVersion = ref(0);
function refreshLists() {
  listsVersion.value += 1;
}

// 切档/读档会把注册表按存档重建（game-store 的 loadCustomContent）—— 编辑器开着切档时也要重画
watch(() => game.activeSaveId, refreshLists);

// ════════════════════════════════════════════════════════════════════
// 天赋编辑器
// ════════════════════════════════════════════════════════════════════

const GRADES: TalentGrade[] = ['SSS', 'SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F'];
const SOURCES = ['universal', 'creation', 'story'] as const;

const tName = ref('');
const tGrade = ref<TalentGrade>('A');
const tSource = ref<string>('universal');
const tDesc = ref('');
const tEntries = ref<TalentEntry[]>([]);
const tMsg = ref('');
const tErr = ref('');

const allKinds = [...new Set(TALENT_ENTRY_POOL.map((e) => e.kind))];
const customTalents = computed(() => {
  void listsVersion.value; // 依赖：刷新闸（见其声明处）
  return getCustomTalents();
});

function addEntry() {
  const first = TALENT_ENTRY_POOL[0];
  tEntries.value.push({ kind: first.kind, channel: 'universal', params: { ...first.params } });
}
function removeEntry(i: number) {
  tEntries.value.splice(i, 1);
}
function onKindChange(entry: TalentEntry, kind: string) {
  entry.kind = kind as TalentEntry['kind'];
  const preset = TALENT_ENTRY_POOL.find((e) => e.kind === kind);
  if (preset) {
    entry.params = { ...preset.params };
    entry.channel = preset.channel;
  }
}

const tValidation = computed(() => validateTalentEntries(tEntries.value));

async function saveTalent() {
  if (!tName.value.trim()) {
    tErr.value = '名称不能为空';
    return;
  }
  if (!tValidation.value.ok) {
    tErr.value = tValidation.value.reason ?? '条目校验失败';
    return;
  }
  const tpl: TalentTemplate = {
    name: tName.value.trim(),
    source: tSource.value as TalentTemplate['source'],
    grade: tGrade.value,
    description: tDesc.value.trim(),
    entries: tEntries.value,
  };
  registerCustomTalent(tpl);
  game.saveCustomTalents(getCustomTalents());
  refreshLists();
  tMsg.value = `天赋【${tpl.name}】已保存`;
  tName.value = '';
  tDesc.value = '';
  tEntries.value = [];
}
function removeTalent(name: string) {
  unregisterCustomTalent(name);
  game.saveCustomTalents(getCustomTalents());
  refreshLists();
}

// ════════════════════════════════════════════════════════════════════
// 购卡编辑器
// ════════════════════════════════════════════════════════════════════

const FORMS = ['装备', '技能', '领域', '物资', '召唤', '军团'] as const;
const ELEMENTS = ['', '火', '水', '风', '土', '雷', '光', '暗', '冰', '金'] as const;

const cName = ref('');
const cTier = ref('');
const cForm = ref('');
const cElement = ref('');
const cDesc = ref('');
const cCost = ref(20);
// 物资/素材卡的产出定义 —— 没有它的物资卡是废卡（useSupplyCard 直接拒绝）
const cYieldName = ref('');
const cYieldQty = ref(1);
const cYieldIsMaterial = ref(false);
const cMsg = ref('');
const cErr = ref('');

/** 这张卡的形态是否需要产出定义（物资/素材） */
const needsYield = computed(() => cForm.value === '物资' || cForm.value === '素材');

async function saveCard() {
  if (!cName.value.trim()) {
    cErr.value = '名称不能为空';
    return;
  }
  if (!cTier.value) {
    cErr.value = '请选择品质';
    return;
  }
  if (!cForm.value) {
    cErr.value = '请选择形态';
    return;
  }
  const id = `custom-${Date.now()}`;
  const item: CardCatalogItem = {
    id,
    name: cName.value.trim(),
    cardTier: cTier.value as CardCatalogItem['cardTier'],
    formEntry: cForm.value as CardCatalogItem['formEntry'],
    description: cDesc.value.trim(),
    cost: cCost.value,
  };
  if (cElement.value) item.element = cElement.value;
  if (needsYield.value && cYieldName.value.trim()) {
    item.yield = {
      name: cYieldName.value.trim(),
      quantity: Math.max(1, Math.round(cYieldQty.value)),
      itemType: cYieldIsMaterial.value ? '材料' : '消耗品',
    };
  }
  game.addCustomCard(item);
  refreshLists();
  cMsg.value = `卡牌【${item.name}】已添加到购卡池${
    needsYield.value && !item.yield ? '（⚠️ 未填产出，这张卡在背包里用不了）' : ''
  }`;
  cName.value = '';
  cDesc.value = '';
  cTier.value = '';
  cForm.value = '';
  cElement.value = '';
  cYieldName.value = '';
  cYieldQty.value = 1;
  cYieldIsMaterial.value = false;
}
function removeCard(id: string) {
  game.removeCustomCard(id);
  refreshLists();
}

/** 自定义卡列表（刷新闸驱动；与天赋的 customTalents 同口径） */
const customCards = computed(() => {
  void listsVersion.value;
  return game.customCards();
});

// ════════════════════════════════════════════════════════════════════
// 导入 / 导出
// ════════════════════════════════════════════════════════════════════

const fileInput = ref<HTMLInputElement | null>(null);

/** 统一的 JSON 文件下载（导出/模板共用） */
function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportContent() {
  downloadJson('custom-content.json', {
    version: 1,
    exportedAt: new Date().toISOString(),
    talents: getCustomTalents(),
    cards: game.customCards(),
    commissions: getCustomCommissions(),
    explorationEvents: getCustomEvents(),
  });
  cMsg.value = `已导出：${getCustomTalents().length} 条天赋、${customCards.value.length} 张卡、${customCommissionList.value.length} 条委托、${customEventList.value.length} 条探索事件`;
}

/**
 * 下载模板。
 *
 * 模板按 tab 给单条示例（照着填一条最省事）；也提供整包模板（多条 + 导入说明）。
 */
function downloadTemplate(scope: 'talent' | 'card' | 'bundle') {
  if (scope === 'talent') {
    downloadJson('talent-template.json', { version: 1, talents: [TALENT_TEMPLATE], cards: [] });
    tMsg.value = '天赋模板已下载（改完直接导入即可）';
    return;
  }
  if (scope === 'card') {
    downloadJson('card-template.json', { version: 1, talents: [], cards: [CARD_TEMPLATE] });
    cMsg.value = '卡牌模板已下载（改完直接导入即可）';
    return;
  }
  downloadJson('custom-content-template.json', buildTemplateBundle());
  cMsg.value = '整包模板已下载（含导入说明）';
}

async function importContent(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    // 🔴 走与读档同一套宽读函数：形状不对的条目**丢弃**而不是注册垃圾进注册表
    //    （此前直接 registerCustomTalent(raw)，模板里的示例/半成品会污染池子）
    const talents = coerceCustomTalents(raw.talents);
    const cards = coerceCustomCards(raw.cards);
    const commissions = coerceCustomCommissions(raw.commissions);
    const events = coerceCustomEvents(raw.explorationEvents);
    for (const t of talents) registerCustomTalent(t);
    if (talents.length) game.saveCustomTalents(getCustomTalents());
    for (const c of cards) game.addCustomCard(c);
    if (commissions.length || events.length) {
      for (const d of commissions) registerCustomCommission(d);
      for (const d of events) registerCustomEvent(d);
      game.saveCustomCommissions(getCustomCommissions());
      game.saveCustomEvents(getCustomEvents());
    }
    refreshLists();

    const skippedT = (Array.isArray(raw.talents) ? raw.talents.length : 0) - talents.length;
    const skippedC = (Array.isArray(raw.cards) ? raw.cards.length : 0) - cards.length;
    const skippedK =
      (Array.isArray(raw.commissions) ? raw.commissions.length : 0) - commissions.length;
    const skippedE =
      (Array.isArray(raw.explorationEvents) ? raw.explorationEvents.length : 0) - events.length;
    const skipped =
      skippedT + skippedC + skippedK + skippedE > 0
        ? `（跳过 ${skippedT} 条天赋、${skippedC} 张卡、${skippedK} 条委托、${skippedE} 条事件：形状不合法）`
        : '';
    cMsg.value = `导入完成：${talents.length} 条天赋、${cards.length} 张卡、${commissions.length} 条委托、${events.length} 条探索事件${skipped}`;
  } catch (err) {
    cErr.value = `导入失败：${err}`;
  }
  input.value = '';
}

// ════════════════════════════════════════════════════════════════════
// 委托编辑器（委托×地图闭环 2026-09-19，决议 #7 追加需求）
// ════════════════════════════════════════════════════════════════════

const COMMISSION_GRADE_OPTS = ['D', 'C', 'B', 'A', 'S'] as const;
const REQ_TYPES = ['收卡', '素材', '到访', '终点'] as const;
const FINALE_TYPES = ['谜题', '强敌', '场景制卡'] as const;

const kName = ref('');
const kDesc = ref('');
const kReqType = ref<(typeof REQ_TYPES)[number]>('素材');
const kGrade = ref<string>(''); // 空 = 普通委托（无品级分流）
// 收卡要求
const kMinTier = ref('');
const kFormEntry = ref('');
const kElements = ref<string[]>([]);
const kExactName = ref('');
// 素材 / 到访 / 终点
const kMatName = ref('');
const kMatCount = ref(1);
const kVisitMidTier = ref('');
const kVisitCount = ref(1);
const kFinaleType = ref<(typeof FINALE_TYPES)[number]>('谜题');
const kFinaleTarget = ref('');
const kFinaleMatName = ref('');
const kFinaleMatQty = ref(1);
// 路程（目的地/交差地/时限）
const kDest = ref('');
const kIssuer = ref('');
const kHasDeadline = ref(false);
const kDeadline = ref(7);
// 任务链
const kChainId = ref('');
const kChainOrder = ref<number | ''>('');
// 奖励
const kGc = ref<number | ''>('');
const kRep = ref<number | ''>('');
const kRewardMats = ref<{ name: string; quantity: number }[]>([]);
const kHasCardReward = ref(false);
const kCardReward = ref('');
const kGrantAt = ref<'delivery' | 'scene'>('delivery');
// 链节探索事件（谜题型终点的事件定义；可选）
const kHasEvent = ref(false);
const kEventName = ref('');
const kEventBrief = ref('');
const kMsg = ref('');
const kErr = ref('');

/** 中层选项（装了地图包才有；没包时手填 id 也可以——下拉换成输入框） */
const midTierOptions = computed(() =>
  getMapPack().midTiers.map((m) => ({ id: m.id, name: m.name })),
);
/** 奖励卡选项：卡池（内容包 + 自定义卡）——下拉只能选存在的卡（写错名报红的结构化解法） */
const cardOptions = computed(() => getPurchasableCardPool().map((c) => c.name));

const customCommissionList = computed(() => {
  void listsVersion.value;
  // 合并视图：包内置 + 七链种子 + 自定义（与委托板同源）；种子条目可「隐藏」
  const customNames = new Set(getCustomCommissions().map((d) => d.name));
  return getCommissionDefs().map((d) => ({
    def: d,
    isSeed: !customNames.has(d.name) && QUEST_CHAIN_COMMISSION_SEEDS.some((s) => s.name === d.name),
  }));
});
const customEventList = computed(() => {
  void listsVersion.value;
  return getCustomEvents();
});

function addRewardMat() {
  kRewardMats.value.push({ name: '', quantity: 1 });
}
function removeRewardMat(i: number) {
  kRewardMats.value.splice(i, 1);
}

async function saveCommission() {
  kErr.value = '';
  const name = kName.value.trim();
  if (!name) {
    kErr.value = '委托名不能为空';
    return;
  }
  // 奖励卡存在性当场报红（下拉本身只列存在的卡，这里兜手改 JSON 的情况）
  if (kHasCardReward.value && !cardOptions.value.includes(kCardReward.value)) {
    kErr.value = `奖励卡「${kCardReward.value}」不在卡池/自定义卡里——先去购卡编辑器建它`;
    return;
  }

  const def: CommissionDef = {
    name,
    ...(kDesc.value.trim() ? { description: kDesc.value.trim() } : {}),
    rewards: {
      ...(typeof kGc.value === 'number' && kGc.value > 0 ? { gc: Math.round(kGc.value) } : {}),
      ...(typeof kRep.value === 'number' && kRep.value !== 0
        ? { reputation: Math.round(kRep.value) }
        : {}),
      ...(kRewardMats.value.some((m) => m.name.trim())
        ? {
            materials: kRewardMats.value
              .filter((m) => m.name.trim())
              .map((m) => ({ name: m.name.trim(), quantity: Math.max(1, Math.round(m.quantity)) })),
          }
        : {}),
      ...(kHasCardReward.value
        ? { card: { name: kCardReward.value, grantAt: kGrantAt.value } }
        : {}),
    },
  };

  switch (kReqType.value) {
    case '收卡':
      def.requireCard = {
        ...(kMinTier.value ? { minTier: kMinTier.value as CardTier } : {}),
        ...(kFormEntry.value ? { formEntry: kFormEntry.value } : {}),
        ...(kElements.value.length > 0 ? { elements: [...kElements.value] } : {}),
        ...(kExactName.value.trim() ? { exactName: kExactName.value.trim() } : {}),
      };
      break;
    case '素材':
      if (!kMatName.value.trim()) {
        kErr.value = '素材委托要填素材名';
        return;
      }
      def.requireMaterial = {
        name: kMatName.value.trim(),
        count: Math.max(1, Math.round(kMatCount.value)),
      };
      break;
    case '到访':
      if (!kVisitMidTier.value) {
        kErr.value = '探索委托要选目的地中层';
        return;
      }
      def.requireVisit = {
        midTier: kVisitMidTier.value,
        count: Math.max(1, Math.round(kVisitCount.value)),
      };
      break;
    case '终点': {
      const target = kFinaleTarget.value.trim() || (kHasEvent.value ? kEventName.value.trim() : '');
      def.finale = {
        type: kFinaleType.value,
        ...(target ? { target } : {}),
        ...(kFinaleType.value === '场景制卡' && kFinaleMatName.value.trim()
          ? {
              materials: [
                {
                  name: kFinaleMatName.value.trim(),
                  quantity: Math.max(1, Math.round(kFinaleMatQty.value)),
                },
              ],
            }
          : {}),
      };
      break;
    }
  }

  if (kGrade.value) def.grade = kGrade.value as CommissionDef['grade'];
  if (kDest.value) def.destMidTier = kDest.value;
  if (kIssuer.value) def.issuerMidTier = kIssuer.value;
  if (kHasDeadline.value && kDeadline.value > 0) def.deadlineDays = Math.round(kDeadline.value);
  if (kChainId.value.trim()) {
    def.chainId = kChainId.value.trim();
    if (typeof kChainOrder.value === 'number' && kChainOrder.value > 0) {
      def.chainOrder = Math.round(kChainOrder.value);
    }
  }

  // 链节探索事件（可选）：exploration 触发器 + 任务门（接取中才可能触发，不白烧 once）
  if (kHasEvent.value && kEventName.value.trim()) {
    const eventName = kEventName.value.trim();
    const event: RandomEventDef = {
      name: eventName,
      brief:
        kEventBrief.value.trim() || `【${name}】的终点时刻到了——${kFinaleType.value}的最后一搏。`,
      trigger: {
        type: 'exploration',
        ...(kDest.value ? { scope: { anyOf: [kDest.value] } } : {}),
        chancePct: 100,
      },
      once: true,
      priority: 10,
      // 任务门：委托接取中（update_quest 立的同名任务）才可能入池
      available: { quest: { name, statusAnyOf: ['进行中'] } },
    };
    const events = [...getCustomEvents().filter((d) => d.name !== eventName), event];
    game.saveCustomEvents(events);
  } else if (!kHasEvent.value) {
    // 取消勾选 = 连旧事件一起摘（按同名约定）
    const linked = getCustomEvents().filter((d) => d.name === `${name}·终点`);
    if (linked.length > 0) {
      game.saveCustomEvents(getCustomEvents().filter((d) => d.name !== `${name}·终点`));
    }
  }

  const list = [...getCustomCommissions().filter((d) => d.name !== name), def];
  game.saveCustomCommissions(list);
  refreshLists();
  kMsg.value = `委托【${name}】已保存${kHasEvent.value ? '（含链节探索事件）' : ''}`;
  kName.value = '';
  kDesc.value = '';
  kMatName.value = '';
  kFinaleTarget.value = '';
  kFinaleMatName.value = '';
  kEventName.value = '';
  kEventBrief.value = '';
  kRewardMats.value = [];
}

function removeCommission(item: { def: { name: string }; isSeed: boolean }) {
  if (item.isSeed) {
    game.hideQuestChainSeed(item.def.name);
  } else {
    game.saveCustomCommissions(getCustomCommissions().filter((d) => d.name !== item.def.name));
  }
  refreshLists();
}
</script>

<template>
  <div class="content-editor">
    <div class="tab-row" role="tablist">
      <button
        type="button"
        class="tab-btn"
        :class="{ active: tab === 'talent' }"
        @click="tab = 'talent'"
      >
        天赋编辑
      </button>
      <button
        type="button"
        class="tab-btn"
        :class="{ active: tab === 'card' }"
        @click="tab = 'card'"
      >
        购卡编辑
      </button>
      <button
        type="button"
        class="tab-btn"
        :class="{ active: tab === 'commission' }"
        @click="tab = 'commission'"
      >
        委托编辑
      </button>
      <span class="io-btns">
        <button type="button" class="tab-btn" title="导出 JSON" @click="exportContent">导出</button>
        <button type="button" class="tab-btn" title="从 JSON 导入" @click="fileInput?.click()">
          导入
        </button>
        <button
          type="button"
          class="tab-btn"
          :title="
            tab === 'talent'
              ? '下载天赋 JSON 模板'
              : tab === 'card'
                ? '下载卡牌 JSON 模板'
                : '下载整包模板'
          "
          @click="downloadTemplate(tab === 'commission' ? 'bundle' : tab)"
        >
          模板
        </button>
        <input
          ref="fileInput"
          type="file"
          accept=".json"
          style="display: none"
          @change="importContent"
        />
      </span>
    </div>

    <div v-if="tab === 'talent'" class="editor-panel">
      <div class="field-row">
        <label>名称<input v-model="tName" placeholder="天赋名称" /></label>
        <label
          >品级<select v-model="tGrade">
            <option v-for="g in GRADES" :key="g" :value="g">{{ g }}</option>
          </select></label
        >
        <label
          >来源<select v-model="tSource">
            <option v-for="s in SOURCES" :key="s" :value="s">{{ s }}</option>
          </select></label
        >
      </div>
      <label class="full"
        >描述<textarea v-model="tDesc" rows="2" placeholder="天赋描述（给玩家看的）" />
      </label>

      <div class="entries-section">
        <div class="entries-head">
          <span>条目（{{ tEntries.length }}）</span>
          <AppButton size="sm" @click="addEntry">+ 添加条目</AppButton>
        </div>
        <div v-for="(entry, i) in tEntries" :key="i" class="entry-row">
          <select
            :value="entry.kind"
            @change="onKindChange(entry, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="k in allKinds" :key="k" :value="k">{{ k }}</option>
          </select>
          <input
            :value="JSON.stringify(entry.params)"
            placeholder='参数 JSON，如 {"bonus": 20}'
            @change="
              try {
                entry.params = JSON.parse(($event.target as HTMLInputElement).value);
              } catch {
                /* ignore */
              }
            "
          />
          <button type="button" class="remove-btn" @click="removeEntry(i)">✕</button>
        </div>
        <p v-if="tEntries.length > 0 && !tValidation.ok" class="warn">{{ tValidation.reason }}</p>
      </div>

      <p v-if="tMsg" class="ok-msg">{{ tMsg }}</p>
      <p v-if="tErr" class="err-msg">{{ tErr }}</p>
      <AppButton variant="primary" :disabled="!tName.trim() || !tValidation.ok" @click="saveTalent"
        >保存天赋</AppButton
      >

      <div v-if="customTalents.length" class="custom-list">
        <span>已保存（{{ customTalents.length }}）：</span>
        <span
          v-for="t in customTalents"
          :key="t.name"
          class="chip"
          title="点击删除"
          @click="removeTalent(t.name)"
          >{{ t.name }} ✕</span
        >
      </div>
    </div>

    <div v-if="tab === 'card'" class="editor-panel">
      <div class="field-row">
        <label>名称<input v-model="cName" placeholder="卡牌名称" /></label>
        <label
          >品质<select v-model="cTier">
            <option value="" disabled>品质</option>
            <option v-for="t in CARD_TIERS" :key="t" :value="t">{{ t }}</option>
          </select></label
        >
        <label
          >形态<select v-model="cForm">
            <option value="" disabled>形态</option>
            <option v-for="f in FORMS" :key="f" :value="f">{{ f }}</option>
          </select></label
        >
      </div>
      <div class="field-row">
        <label
          >元素<select v-model="cElement">
            <option value="">无</option>
            <option v-for="e in ELEMENTS.slice(1)" :key="e" :value="e">{{ e }}</option>
          </select></label
        >
        <label
          >代价<input v-model.number="cCost" type="number" min="0" placeholder="转生点"
        /></label>
      </div>
      <label class="full">描述<textarea v-model="cDesc" rows="2" placeholder="卡牌描述" /></label>

      <!-- 物资/素材卡必须有产出定义，否则进背包也用不了（useSupplyCard 直接拒绝） -->
      <div v-if="needsYield" class="field-row yield-row">
        <label
          >产出物品<input v-model="cYieldName" placeholder="产出的物品名（留空 = 用不了）"
        /></label>
        <label>数量<input v-model.number="cYieldQty" type="number" min="1" step="1" /></label>
        <label class="check-label"
          ><input v-model="cYieldIsMaterial" type="checkbox" />产出为制卡素材</label
        >
      </div>

      <p v-if="cMsg" class="ok-msg">{{ cMsg }}</p>
      <p v-if="cErr" class="err-msg">{{ cErr }}</p>
      <AppButton variant="primary" :disabled="!cName.trim() || !cTier || !cForm" @click="saveCard"
        >添加到购卡池</AppButton
      >

      <div v-if="customCards.length > 0" class="custom-list">
        <span>自定义卡（{{ customCards.length }}）：</span>
        <span
          v-for="c in customCards"
          :key="c.id"
          class="chip"
          title="点击删除"
          @click="removeCard(c.id)"
          >{{ c.name }} ✕</span
        >
      </div>
    </div>

    <div v-if="tab === 'commission'" class="editor-panel">
      <div class="field-row">
        <label>委托名<input v-model="kName" placeholder="如：北境雪莲征集" /></label>
        <label
          >品级<select v-model="kGrade">
            <option value="">普通（无分流）</option>
            <option v-for="g in COMMISSION_GRADE_OPTS" :key="g" :value="g">{{ g }}</option>
          </select></label
        >
      </div>
      <label class="full"
        >描述<textarea
          v-model="kDesc"
          rows="2"
          placeholder="给玩家看的一句话（也供 AI 叙事取材）"
        />
      </label>

      <div class="field-row">
        <label
          >要求类型<select v-model="kReqType">
            <option v-for="t in REQ_TYPES" :key="t" :value="t">{{ t }}</option>
          </select></label
        >
        <label
          >目的地中层<select v-model="kDest">
            <option value="">不限 / 手填</option>
            <option v-for="m in midTierOptions" :key="m.id" :value="m.id">
              {{ m.name }}（{{ m.id }}）
            </option>
          </select></label
        >
        <label
          >交差地（A/S 级）<select v-model="kIssuer">
            <option value="">面板交付</option>
            <option v-for="m in midTierOptions" :key="m.id" :value="m.id">
              {{ m.name }}（{{ m.id }}）
            </option>
          </select></label
        >
      </div>

      <!-- 收卡要求 -->
      <div v-if="kReqType === '收卡'" class="sub-form">
        <div class="field-row">
          <label
            >品质下限<select v-model="kMinTier">
              <option value="">不限</option>
              <option v-for="t in CARD_TIERS" :key="t" :value="t">{{ t }}</option>
            </select></label
          >
          <label
            >形态<select v-model="kFormEntry">
              <option value="">不限</option>
              <option v-for="f in FORMS" :key="f" :value="f">{{ f }}</option>
            </select></label
          >
          <label>指定卡名<input v-model="kExactName" placeholder="留空 = 不限" /></label>
        </div>
        <div class="field-row">
          <span class="inline-label">元素（可多选）：</span>
          <label v-for="e in ELEMENTS.slice(1)" :key="e" class="check-label" style="flex: 0 0 auto">
            <input v-model="kElements" :value="e" type="checkbox" />{{ e }}
          </label>
        </div>
      </div>

      <!-- 素材要求 -->
      <div v-else-if="kReqType === '素材'" class="sub-form">
        <div class="field-row">
          <label
            >素材名<input v-model="kMatName" placeholder="如：雪莲（建议用中层独家素材）"
          /></label>
          <label>数量<input v-model.number="kMatCount" type="number" min="1" step="1" /></label>
        </div>
      </div>

      <!-- 到访要求 -->
      <div v-else-if="kReqType === '到访'" class="sub-form">
        <div class="field-row">
          <label
            >目的地中层<select v-model="kVisitMidTier">
              <option value="" disabled>选择中层</option>
              <option v-for="m in midTierOptions" :key="m.id" :value="m.id">
                {{ m.name }}（{{ m.id }}）
              </option>
            </select></label
          >
          <label
            >到访次数<input v-model.number="kVisitCount" type="number" min="1" step="1"
          /></label>
        </div>
        <p class="hint">接取后到访才计数（基线快照）——接取前去过的不算。</p>
      </div>

      <!-- 终点 -->
      <div v-else class="sub-form">
        <div class="field-row">
          <label
            >终点型<select v-model="kFinaleType">
              <option v-for="t in FINALE_TYPES" :key="t" :value="t">{{ t }}</option>
            </select></label
          >
          <label
            >目标<input
              v-model="kFinaleTarget"
              :placeholder="
                kFinaleType === '谜题'
                  ? '终点事件名（可由下方事件生成）'
                  : kFinaleType === '强敌'
                    ? '敌人名'
                    : '目标卡名'
              "
          /></label>
        </div>
        <div v-if="kFinaleType === '场景制卡'" class="field-row">
          <label>配方素材<input v-model="kFinaleMatName" placeholder="独家素材名" /></label>
          <label>数量<input v-model.number="kFinaleMatQty" type="number" min="1" step="1" /></label>
        </div>
        <p class="hint">
          场景获得：卡在那座危险的地方被换来，不是回城被递过来。谜题型勾选下方探索事件后，
          事件名会自动成为终点目标。
        </p>
      </div>

      <!-- 时限与任务链 -->
      <div class="field-row">
        <label class="check-label" style="flex: 0 0 auto"
          ><input v-model="kHasDeadline" type="checkbox" />限时</label
        >
        <label v-if="kHasDeadline"
          >时限（天）<input v-model.number="kDeadline" type="number" min="1" step="1"
        /></label>
        <label>任务链 id<input v-model="kChainId" placeholder="留空 = 散委托" /></label>
        <label v-if="kChainId.trim()"
          >链内节序<input
            v-model.number="kChainOrder"
            type="number"
            min="1"
            step="1"
            placeholder="1"
        /></label>
      </div>

      <!-- 奖励 -->
      <div class="sub-form">
        <p class="sub-title">奖励</p>
        <div class="field-row">
          <label
            >赏金（GC）<input v-model.number="kGc" type="number" min="0" placeholder="0"
          /></label>
          <label>声望<input v-model.number="kRep" type="number" step="1" placeholder="0" /></label>
          <label
            >独家卡<select v-model="kCardReward">
              <option value="">无</option>
              <option v-for="n in cardOptions" :key="n" :value="n">{{ n }}</option>
            </select></label
          >
          <label v-if="kCardReward"
            >发放时机<select v-model="kGrantAt">
              <option value="delivery">交付时</option>
              <option value="scene">终点场景（获得瞬间）</option>
            </select></label
          >
        </div>
        <div class="field-row">
          <span class="inline-label">素材奖励：</span>
          <button type="button" class="mini-btn" @click="addRewardMat">+ 加一行</button>
        </div>
        <div v-for="(m, i) in kRewardMats" :key="i" class="entry-row">
          <input v-model="m.name" placeholder="素材名" />
          <input v-model.number="m.quantity" type="number" min="1" step="1" placeholder="数量" />
          <button type="button" class="remove-btn" @click="removeRewardMat(i)">✕</button>
        </div>
      </div>

      <!-- 链节探索事件 -->
      <div class="sub-form">
        <label class="check-label"
          ><input v-model="kHasEvent" type="checkbox" />附带链节探索事件（谜题型终点用）</label
        >
        <template v-if="kHasEvent">
          <div class="field-row">
            <label
              >事件名<input v-model="kEventName" placeholder="终点事件的逻辑键（唯一）"
            /></label>
          </div>
          <label class="full"
            >事件简报<textarea
              v-model="kEventBrief"
              rows="2"
              placeholder="给 AI 的事件简报（留空 = 自动生成）"
            />
          </label>
          <p class="hint">事件随任务链走：只在目的地中层、且本委托接取中时可能触发，全程一次。</p>
        </template>
      </div>

      <p v-if="kMsg" class="ok-msg">{{ kMsg }}</p>
      <p v-if="kErr" class="err-msg">{{ kErr }}</p>
      <AppButton variant="primary" :disabled="!kName.trim()" @click="saveCommission"
        >保存委托</AppButton
      >

      <div v-if="customCommissionList.length > 0" class="custom-list">
        <span>委托总览（{{ customCommissionList.length }}）：</span>
        <span
          v-for="item in customCommissionList"
          :key="item.def.name"
          class="chip"
          :title="item.isSeed ? '内置七链委托——点击隐藏（可再导入恢复）' : '点击删除'"
          @click="removeCommission(item)"
          >{{ item.def.name }}{{ item.isSeed ? ' ·内置' : ' ✕' }}</span
        >
      </div>
      <div v-if="customEventList.length > 0" class="custom-list">
        <span>自定义探索事件（{{ customEventList.length }}）：</span>
        <span v-for="d in customEventList" :key="d.name" class="chip static-chip">{{
          d.name
        }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.content-editor {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.tab-row {
  display: flex;
  gap: 0.25rem;
}
.tab-btn {
  padding: 0.4rem 1rem;
  border: 1px solid var(--bg-dark);
  background: transparent;
  cursor: pointer;
  border-radius: 0.25rem 0.25rem 0 0;
}
.tab-btn.active {
  background: var(--bg-dark);
  color: var(--text-bright);
}
.editor-panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem;
  border: 1px solid var(--bg-dark);
  border-radius: 0 0.25rem 0.25rem;
}
.field-row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.field-row label {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.75rem;
  flex: 1;
  min-width: 100px;
}
.full {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.75rem;
}
/* 产出定义行：勾选项与输入框同排，不撑成整列 */
.yield-row {
  border-left: 2px solid var(--bg-dark);
  padding-left: 0.5rem;
}
.field-row label.check-label {
  flex: 0 0 auto;
  flex-direction: row;
  align-items: center;
  gap: 0.3rem;
  align-self: flex-end;
  padding-bottom: 0.3rem;
}
.field-row label.check-label input {
  width: auto;
}
input,
select,
textarea {
  padding: 0.3rem;
  border: 1px solid var(--bg-dark);
  border-radius: 0.25rem;
  background: var(--bg-light);
  color: var(--text);
  font-size: 0.85rem;
}
.entries-section {
  border: 1px dashed var(--bg-dark);
  padding: 0.5rem;
  border-radius: 0.25rem;
}
.entries-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.35rem;
}
.entry-row {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.35rem;
  align-items: center;
}
.entry-row select {
  flex: 0 0 130px;
}
.entry-row input {
  flex: 1;
  font-size: 0.75rem;
  font-family: monospace;
}
.remove-btn {
  background: none;
  border: none;
  color: var(--danger, #e74c3c);
  cursor: pointer;
  font-size: 0.85rem;
}
.custom-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  font-size: 0.75rem;
}
.chip {
  padding: 0.15rem 0.5rem;
  border: 1px solid var(--bg-dark);
  border-radius: 1rem;
  cursor: pointer;
  font-size: 0.75rem;
}
.chip:hover {
  background: var(--bg-dark);
}
.chip.static-chip {
  cursor: default;
}
.sub-form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  border: 1px dashed var(--bg-dark);
  border-radius: 0.25rem;
  padding: 0.5rem;
}
.sub-title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
}
.inline-label {
  font-size: 0.75rem;
  align-self: center;
}
.hint {
  margin: 0;
  font-size: 0.7rem;
  color: var(--text-muted, #967756);
}
.mini-btn {
  padding: 0.15rem 0.6rem;
  font-size: 0.7rem;
  border: 1px solid var(--bg-dark);
  background: transparent;
  border-radius: 0.25rem;
  cursor: pointer;
}
.ok-msg {
  color: var(--success, #2ecc71);
  font-size: 0.8rem;
}
.err-msg,
.warn {
  color: var(--danger, #e74c3c);
  font-size: 0.8rem;
}
</style>
