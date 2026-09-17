import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  SaveSlot,
  CharacterState,
  ChatMessage,
  CardItem,
  InventoryItem,
  StatePatch,
  MemoryRecord,
  PlotEvent,
  PlotOutline,
  CardAlbumState,
  SaveProfile,
  AgentActivityRun,
  AgentActivityStep,
  DebugAgentEntry,
  DebugTurnRecord,
} from '@engine/types';
export type { DebugAgentEntry, DebugTurnRecord } from '@engine/types';
import { planQuench, planRepair } from '@engine/card-workshop/repair';
import {
  FORTUNE_MODES,
  drawFortuneCard,
  rollFortuneTier,
  type FortuneMode,
} from '@engine/card-workshop/fortune-draw';
import { cardCatalogToItem, parseCatalogData } from '@engine/start-catalog';
import { d100, rollDie } from '@engine/dice';
import { buildDemoCardsPatches, buildDemoDeckPatches } from '@engine/card-workshop/demo';
import { toPlainCardAlbum } from '@engine/card-workshop/album';
import { planDevour } from '@engine/card-workshop/card-devour';
import { planEmotionExtract, type Emotion } from '@engine/card-workshop/emotion-material';
import {
  planCaptureEnemy,
  planCorruptCompanion,
  planOffspring,
} from '@engine/card-workshop/companion-capture';
import { buildSummonCompanion } from '@engine/card-workshop/companion';
import { planStripEntry } from '@engine/card-workshop/card-strip';
import {
  planAffectionTribute,
  planEnthrone,
  type ConsortRank,
} from '@engine/card-workshop/companion-growth';
import { planDismantle } from '@engine/card-workshop/card-dismantle';
import {
  planAbyssContract,
  planContract,
  planMultiFusion,
  planReshape,
  planSmelt,
} from '@engine/card-workshop/card-smelt';
import {
  diceTablesOf,
  entryStrength,
  hasEntryKind,
} from '@engine/card-workshop/talent-rule-modifiers';
import { craftTierCeilingIndex } from '@engine/card-workshop/craft-rank';
import {
  buffActiveToday,
  coerceBuffs,
  coerceCounters,
  coerceLedger,
  counterOf,
  markBuff,
  remainingToday,
  tryUseToday,
  type DailyLedger,
} from '@engine/card-workshop/daily-ledger';
import { isRerollFace, rollOnTable } from '@engine/card-workshop/fortune-dice';
import { DAILY_BUFF_CRAFT_LUCK } from '@engine/card-workshop/fortune-dice';
import type { FortuneDiceTable } from '@engine/card-workshop/fortune-dice';
import { planRarityUpgrade } from '@engine/card-workshop/material';
import { planUnequalExchange } from '@engine/card-workshop/unequal-exchange';
import { floorRarityForLevel, planMaterialGacha } from '@engine/card-workshop/material-gacha';
import { addSpirit, coerceSpirits } from '@engine/card-workshop/behind-spirits';
import { TWIN_ENTRY, areTwins, coerceTwinBonds } from '@engine/card-workshop/battle-rules';
import { cardPower } from '@engine/card-workshop/deck-power';
import { cardKindOf } from '@engine/card-workshop/card-kind';
import {
  MISFORTUNE_KEY,
  planTrain,
  type TrainDirection,
} from '@engine/card-workshop/craft-flow-hooks';
import { planFootAlchemy } from '@engine/card-workshop/partner-alchemy';
import { planCardCraft } from '@engine/card-workshop/card-craft-plan';
import { coerceBlueprints, consumeBlueprint } from '@engine/card-workshop/opponent-blueprints';
import { fallbackCraftNarration } from '@engine/card-craft-narrate';
import {
  findSoulWeapon,
  planSoulWeapon,
  shouldUpgradeSoulWeapon,
  soulWeaponTierForLevel,
} from '@engine/card-workshop/soul-weapon';
import { tierForLevel } from '@engine/card-workshop/companion-capture';
import {
  FACE_SLAP_KEY,
  canRedeemFaceSlap,
  coerceNemesis,
} from '@engine/card-workshop/conditional-exp';
import { coerceTrueNames } from '@engine/card-workshop/true-name';
import { materialNameOf } from '@engine/card-workshop/card-dismantle';
import type { TalentEntry, TalentEntryKind } from '@engine/card-workshop/talent-entry';
import { planCommissionDelivery } from '@engine/card-workshop/commission';
import { getCommissionDefs } from '@engine/commission-runtime';
import { isEventCommissionActive } from '@engine/card-workshop/event-commission';
import type { CommissionDef } from '@engine/card-workshop/commission';
import { toEpochMinutes, MINUTES_PER_GAME_DAY } from '@engine/time-system';
import {
  fuseEntrySets,
  getExchangeCatalog,
  talentExchangePrice,
} from '@engine/card-workshop/talent-entry';
import {
  getReputation as getTalentReputation,
  getProfile,
  spendFP,
  setNarrativeIntent,
  getNarrativeIntents,
  clearNarrativeIntent as clearNarrativeIntentInDb,
} from '@engine/save-profile';
import { getContentRegistry } from './content-store';
import type { CardTier } from '@engine/field-enums';
import type { SkirmishSession } from '@engine/card-workshop/skirmish-session';
import type { SkirmishChoice } from '@engine/card-workshop/skirmish';
import {
  getSave,
  getSaves,
  getCharacters,
  getMemories,
  getPlotEvents,
  getSaveProfile,
  getLatestPlotOutline,
  getSnapshots,
  getDebugTurns,
  saveDebugTurn,
} from '@engine/database';
import { saveMessage, getMessages, saveSaveSlot } from '@engine/database';
import { getDatabase } from '@engine/database';
import { withSaveWriteLock } from '@engine/state-write-queue';
// 旧档经验保底归一化（方案 A，2026-08-24）：加载时对主角自愈「等级与累计经验矛盾」
//（旧档 totalExp 是层级内语义，新系统是全程累计）。幂等，正常存档零影响。
import { normalizePlayerProgression } from '@engine/database';
import {
  createStateManager,
  type PlayerPersonaDraft,
  type PlayerPersonaUpdateResult,
} from '@engine/state-manager';
import { wireEffectSystem, unwireEffectSystem } from '@engine/effect-wiring';
import { getExperienceMode } from '@engine/save-profile';
import { invalidatePromptSession } from '@engine/prompt-session-assembler';
import { allocateAttributePoint } from '@engine/attribute-allocation';
import type { AllocatableAttr } from '@engine/attribute-allocation';
import { detach } from './db-write';
import { agentActivityLabel, presentToolActivity } from '../lib/agent-activity';
// 🆕 重铸（2026-08-24）：单条目重铸的类型 + 注入缝（实现由 GamePage 挂 GamePipeline.rewriteLoadoutItem）
import type { RewriteTarget } from '@engine/item-gen-chain';

/** 重铸实现注入缝 —— GamePipeline 装配好 endpoint/chainData/stateManager 后由 GamePage 挂进来 */
export type RewriteLoadoutImpl = (
  characterId: string,
  target: RewriteTarget,
  userDescription: string,
) => Promise<{ ok: boolean; reason?: string }>;

export type TimelineRestoreResult =
  | { status: 'rejected'; error: string }
  | {
      status: 'restored';
      continuation: 'same-save' | 'save-switched';
      warning?: string;
    }
  | { status: 'projection-failed'; error: string };

let rewriteLoadoutImpl: RewriteLoadoutImpl | null = null;

/**
 * 制卡叙事实现注入缝（2026-09-17 第三档）——制卡本身在 store 里算完，
 * 只有「请 AI 命名 + 写叙事」这一步需要 endpoint/clientFactory，
 * 而那是 GamePipeline 装配出来的，所以按同一套缝模式注入。
 * 未注入时用 Code 兜底叙事——**制卡不因 AI 不可用而失败**。
 */
export type CraftNarrateImpl = (req: {
  saveId: string;
  provisionalName: string;
  tier: string;
  entries: string[];
  cost: number;
  rating: string;
  fusionKind: string;
  materials: string[];
  consumed: string[];
  intent: string;
  crafterName?: string;
  talentNotes?: string[];
}) => Promise<{ name?: string; narrative: string }>;

let craftNarrateImpl: CraftNarrateImpl | null = null;

/** 由 GamePage 在创建 GamePipeline 后调用（与 setRewriteLoadoutImpl 同款） */
export function setCraftNarrateImpl(impl: CraftNarrateImpl): void {
  craftNarrateImpl = impl;
}

/** 由 GamePage 在创建 GamePipeline 后调用，把引擎实现挂进 store（照 scene-image-seams 的缝模式） */
export function setRewriteLoadoutImpl(impl: RewriteLoadoutImpl): void {
  rewriteLoadoutImpl = impl;
}

export const useGameStore = defineStore('game', () => {
  // === 存档 ===
  const saves = ref<SaveSlot[]>([]);
  const activeSaveId = ref<string | null>(null);
  let loadGeneration = 0;

  function invalidatePendingLoads() {
    loadGeneration++;
  }
  const activeSave = computed(
    () => saves.value.find((s: SaveSlot) => s.id === activeSaveId.value) || null,
  );

  // === 角色 ===
  const characters = ref<CharacterState[]>([]);
  const player = computed(
    () => characters.value.find((c: CharacterState) => c.type === 'player') || null,
  );
  const npcs = computed(() => characters.value.filter((c: CharacterState) => c.type === 'npc'));

  // === 对话 ===
  const messages = ref<ChatMessage[]>([]);
  const isGenerating = ref(false);

  const recentMemories = ref<MemoryRecord[]>([]);
  const activePlotEvents = ref<PlotEvent[]>([]);
  const plotOutline = ref<PlotOutline | null>(null);

  // === 战斗（交锋拍）===
  /** 交锋进行中判据（委托结算静默等消费方）：会话存在且未终局 */
  const isInCombat = computed(
    () => skirmishSession.value !== null && skirmishSession.value.finished === null,
  );

  // ══════ 交锋拍制战斗（设计共识 §8）：store 持响应式状态，pipeline 持编排 ══════
  // 架构约束与 v3 同款：store 接触不到 pipeline，pipeline 经 setter 写状态、经
  // controller 句柄挂编排（同 combatCoordinator 先例）；UI 只调本区块的三个入口。

  /** 交锋拍会话账本（game-pipeline 唯一写入口；null = 无交锋进行中） */
  const skirmishSession = ref<SkirmishSession | null>(null);
  /** AI 评估/演绎或结算提交进行中（反制按钮禁用依据，防并发拍） */
  const skirmishBusy = ref(false);

  function setSkirmishSession(s: SkirmishSession | null) {
    skirmishSession.value = s;
  }
  function setSkirmishBusy(b: boolean) {
    skirmishBusy.value = b;
  }

  /** pipeline 挂进来的交锋编排句柄 */
  const skirmishController = ref<{
    start: (enemyHint?: string, sceneHint?: string) => Promise<{ ok: boolean; reason?: string }>;
    counter: (choice: SkirmishChoice) => Promise<void>;
    flee: (endReason?: string) => Promise<void>;
    /** 倒也可斩（SSS）：每场一次的一击 */
    nuke: () => Promise<void>;
    /** 宣战决斗（S「西部决斗礼仪」） */
    duel: () => Promise<void>;
    /** 献祭召唤（S「召唤媒介系统」） */
    sacrifice: () => Promise<void>;
    /** 念出真名（S「真名看破系统」） */
    trueName: () => Promise<void>;
    /** 热插拔模块（S「模块化天才」） */
    hotSwap: () => Promise<void>;
  } | null>(null);

  /** controller 未就绪时点下的开战请求（attach 后自动补发——消灭「点了没反应」的时序窗） */
  let pendingSkirmishStart: { enemyHint?: string; sceneHint?: string } | null = null;

  function setSkirmishController(
    c: {
      start: (enemyHint?: string, sceneHint?: string) => Promise<{ ok: boolean; reason?: string }>;
      counter: (choice: SkirmishChoice) => Promise<void>;
      flee: (endReason?: string) => Promise<void>;
      nuke: () => Promise<void>;
      /** 宣战决斗（S「西部决斗礼仪」） */
      duel: () => Promise<void>;
      /** 献祭召唤（S「召唤媒介系统」） */
      sacrifice: () => Promise<void>;
      /** 念出真名（S「真名看破系统」） */
      trueName: () => Promise<void>;
      /** 热插拔模块（S「模块化天才」） */
      hotSwap: () => Promise<void>;
    } | null,
  ) {
    skirmishController.value = c;
    if (c && pendingSkirmishStart) {
      const p = pendingSkirmishStart;
      pendingSkirmishStart = null;
      void startSkirmish(p.enemyHint, p.sceneHint);
    }
  }

  /** UI 入口：开战（敌情评估预提交整场意图）。busy 防双击；结果明示，不静默 */
  async function startSkirmish(
    enemyHint?: string,
    sceneHint?: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (skirmishBusy.value) return { ok: false, reason: '上一场交锋还在处理中，稍候片刻' };
    const c = skirmishController.value;
    if (!c) {
      // 编排未就绪（存档还在加载）——记下请求，setSkirmishController 就绪后自动补发
      pendingSkirmishStart = { enemyHint, sceneHint };
      return { ok: false, reason: '战斗编排尚未就绪（存档加载中）——已记下，就绪后自动开战' };
    }
    skirmishBusy.value = true;
    try {
      return await c.start(enemyHint, sceneHint);
    } finally {
      skirmishBusy.value = false;
    }
  }

  /** UI 入口：一拍反制（出卡或基础应对）。交锋中且静止时才受理 */
  async function submitSkirmishCounter(choice: SkirmishChoice): Promise<void> {
    if (skirmishBusy.value) return;
    if (!skirmishSession.value || skirmishSession.value.finished !== null) return;
    const c = skirmishController.value;
    if (!c) return;
    skirmishBusy.value = true;
    try {
      await c.counter(choice);
    } finally {
      skirmishBusy.value = false;
    }
  }

  /**
   * 委托交付（卡牌工坊 委托接线 切片 C）：清点（委托存在 / 卡可交付 / matchesCommission
   * 验收）→ buildDeliveryPatches（上交 + 赏金 + 声望 + 素材）一次 commitChatState 原子提交。
   * 委托清单来自 commission-runtime 注入缝（内容包第 15 面）；接取由 AI 按委托名立 quest。
   */
  async function deliverCommission(
    commissionName: string,
    cardName: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!activeSaveId.value) return { ok: false, reason: '无活跃存档' };
    const playerChar = player.value;
    if (!playerChar) return { ok: false, reason: '无玩家角色' };
    // 委托清单 = 静态（内容包第 15 面）+ 动态（事件委托，随机事件 × 委托板融合）。
    // 动态委托从存档 flags 读（gameDay 过滤过期），交付时**一次性移除**。
    const dynamic = activeEventCommissions.value;
    const dynamicDef = dynamic.find((ec) => ec.def.name === commissionName);
    const staticDef = getCommissionDefs().find((d) => d.name === commissionName);
    // 同名时动态优先（事件是「正在发生的事」，覆盖常驻委托）
    const def = dynamicDef?.def ?? staticDef;
    if (!def) {
      return dynamic.length === 0
        ? { ok: false, reason: '当前没有委托板（未装含委托的内容包）' }
        : { ok: false, reason: `委托板上没有名为【${commissionName}】的委托` };
    }
    const found = playerChar.inventory.find((i) => i.name === cardName);
    const card = found?.type === '卡牌' ? (found as never as CardItem) : undefined;
    if (card && card.data?.damaged === true) {
      return { ok: false, reason: `【${cardName}】已损坏，先去制卡台修复再交付` };
    }
    const plan = planCommissionDelivery({
      commissions: [def],
      commissionName,
      card,
      playerName: playerChar.name,
    });
    if (!plan.ok) return { ok: false, reason: plan.reason };
    const sm = createStateManager(activeSaveId.value);
    // 动态委托是一次性的：交付与移除同一次原子提交（防「交付了还能再交」的刷取窗口）
    const patches =
      dynamicDef !== undefined
        ? [
            ...plan.patches,
            {
              op: 'set_variable' as const,
              target: 'worldFlags.randomEvents.eventCommissions',
              value: dynamic
                .filter((ec) => ec.def.name !== commissionName)
                .map((ec) => ({ ...ec })),
            },
          ]
        : plan.patches;
    const result = await sm.commitChatState(patches);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };
    await refreshFromDb();
    return { ok: true };
  }

  /** 当前 gameDay（存档 gameTime → 整数天；与 state-manager.gameDayOf 同一公式） */
  function currentGameDay(): number {
    const gt = saveProfile.value?.gameTime;
    if (!gt) return 0;
    return Math.floor(toEpochMinutes(gt) / MINUTES_PER_GAME_DAY);
  }

  /**
   * 事件委托（随机事件 × 委托板融合）：当前存档里**仍然有效**的动态委托清单。
   * 数据源 = `worldFlags.randomEvents.eventCommissions`（state-manager 事件结算时写入），
   * 过期过滤按存档 gameTime 折算的 gameDay。
   */
  const eventCommissions = computed(() => {
    const flags = (saveProfile.value?.worldFlags as Record<string, any> | undefined)?.randomEvents;
    const list = flags?.eventCommissions;
    if (!Array.isArray(list)) return [];
    const day = currentGameDay();
    return list
      .filter((ec) => isEventCommissionActive(ec, day))
      .map((ec: any) => ({
        def: ec.def as CommissionDef,
        sourceEvent: String(ec.sourceEvent ?? ''),
        armedDay: Number(ec.armedDay ?? 0),
        expiresDay: Number(ec.expiresDay ?? 0),
      }));
  });
  const activeEventCommissions = computed(() => eventCommissions.value);

  /** UI 入口：结束战斗（主人裁定 2026-09-13：附结束理由，供终局记叙参考；评价 C） */
  async function fleeSkirmish(endReason?: string): Promise<void> {
    if (skirmishBusy.value || !skirmishSession.value) return;
    const c = skirmishController.value;
    if (!c) return;
    skirmishBusy.value = true;
    try {
      await c.flee(endReason);
    } finally {
      skirmishBusy.value = false;
    }
  }

  /**
   * 演示卡注入（仅 dev 模式可调——生产构建会因 import.meta.env.DEV=false 而保留
   * 函数本身但调用入口在 UI 守卫，生产 bundle 不渲染按钮）。给玩家背包塞 4 张
   * 各类型演示卡 + 3 份常用素材，并重置卡组为演示卡全集——主人进战斗即可看
   * 玩卡链路（卡组条 → 单击出牌 → 启封判定 → 召唤/地景/装备/技能效果）。
   */
  async function seedDemoCards(): Promise<{ ok: boolean; reason?: string }> {
    if (!activeSaveId.value || !player.value) return { ok: false, reason: '无活跃存档' };
    const playerName = player.value.name;
    const sm = createStateManager(activeSaveId.value);
    const patches = [...buildDemoCardsPatches(playerName), ...buildDemoDeckPatches(playerName)];
    const result = await sm.commitChatState(patches);
    if (result.success) await refreshFromDb();
    return result.success ? { ok: true } : { ok: false, reason: result.errors.join('; ') };
  }

  /**
   * 修复损坏的卡（契约召唤 C' 制，卡牌工坊可玩闭环 4/9）。
   * 双轨制：模板素材承担修复（必成功）；额外素材强化（元素并入 + 相生复合），
   * 素材品质高于卡品质 → 品质跃迁（卡 cardTier 与角色 tier 同一次提交双写 + 属性包）。
   * 规则校验全在引擎 card-workshop/repair.ts 纯函数，这里只装配 patches 提交。
   */
  async function repairCard(
    cardName: string,
    templateMaterialNames: string[],
    extraMaterialNames: string[],
  ): Promise<{ ok: boolean; reason?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    const resolve = (names: string[]): InventoryItem[] =>
      names
        .map((n) => playerChar.inventory.find((i) => i.name === n))
        .filter((i): i is InventoryItem => !!i);
    const card = playerChar.inventory.find(
      (i): i is CardItem => i.name === cardName && i.type === '卡牌',
    );
    if (!card) return { ok: false, reason: '找不到该卡' };

    const templateMaterials = resolve(templateMaterialNames);
    const extraMaterials = resolve(extraMaterialNames);
    const { ok, reason, plan } = planRepair(card, templateMaterials, extraMaterials);
    if (!ok) return { ok: false, reason };

    const patches: StatePatch[] = [
      {
        op: 'update_item',
        target: `characters.${playerChar.name}`,
        value: {
          name: cardName,
          changes: {
            data: { ...(card.data ?? {}), ...plan.cardData },
            ...(plan.upgraded ? { cardTier: plan.newTier } : {}),
          },
        },
      },
      ...[...templateMaterialNames, ...extraMaterialNames].map((name) => ({
        op: 'remove_item' as const,
        target: `characters.${playerChar.name}`,
        value: { name, quantity: 1 },
      })),
    ];
    if (plan.upgraded) {
      // 品质跃迁双写（世界内投影）：角色 tier +1（delta）+ 属性包
      patches.push({
        op: 'update_character',
        target: `characters.${playerChar.name}`,
        value: { tier: 1, attributes: plan.attributeDelta },
        metadata: { delta: true, source: 'card_repair' },
      } as StatePatch);
    }
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState(patches);
    if (result.success) await refreshFromDb();
    return result.success ? { ok: true } : { ok: false, reason: result.errors.join('; ') };
  }

  /**
   * 淬炼：健康卡 + 素材 → 词条强化/品质跃迁（2026-09-16）。
   * 与 repairCard 同形状的原子提交：update_item（词条/cardTier）+ remove_item（素材）
   * + 跃迁时 update_character（tier delta + 属性包）。
   */
  async function quenchCard(
    cardName: string,
    materialNames: string[],
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    const materials = materialNames
      .map((n) => playerChar.inventory.find((i) => i.name === n))
      .filter((i): i is InventoryItem => !!i);
    const card = playerChar.inventory.find(
      (i): i is CardItem => i.name === cardName && i.type === '卡牌',
    );
    if (!card) return { ok: false, reason: '找不到该卡' };

    const { ok, reason, plan } = planQuench(card, materials);
    if (!ok) return { ok: false, reason };

    const patches: StatePatch[] = [
      {
        op: 'update_item',
        target: `characters.${playerChar.name}`,
        value: {
          name: cardName,
          changes: {
            词条: plan.new词条,
            ...(plan.upgraded ? { cardTier: plan.newTier } : {}),
          },
        },
      },
      ...materialNames.map((name) => ({
        op: 'remove_item' as const,
        target: `characters.${playerChar.name}`,
        value: { name, quantity: 1 },
      })),
    ];
    if (plan.upgraded) {
      patches.push({
        op: 'update_character',
        target: `characters.${playerChar.name}`,
        value: { tier: 1, attributes: plan.attributeDelta },
        metadata: { delta: true, source: 'card_quench' },
      } as StatePatch);
    }
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState(patches);
    if (result.success) await refreshFromDb();
    return result.success
      ? { ok: true, summary: plan.summary }
      : { ok: false, reason: result.errors.join('; ') };
  }

  /**
   * 抽封铭卡（命运祭坛，2026-09-17）：d100 掷档 → cardPool 按档抽卡 →
   * CardItem 直落背包+卡册。纯 Code 确定性，不经叙事链、不走 item_gen。
   * coin 模式扣帝冕币（update_character 绝对值），fp 模式扣命运点（spendFP）。
   */
  async function drawFortune(mode: FortuneMode): Promise<
    | {
        ok: true;
        tier: CardTier;
        card: { name: string; cardTier: CardTier; 词条: string[]; description: string };
        d100: number;
        summary: string;
      }
    | { ok: false; reason: string }
  > {
    const spec = FORTUNE_MODES[mode];
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };

    // 卡池：内容注册表 catalog.cardPool（装内容包后为铭刻卡池，未装则占位小样）
    const pool = parseCatalogData(getContentRegistry().catalog).cardPool.filter(
      (c) => !c.imitation,
    );
    if (pool.length === 0) return { ok: false, reason: '命运卡堆是空的（需安装内容包）' };

    // 费用预检
    if (mode === 'coin' && playerChar.money < spec.gcCost) {
      return { ok: false, reason: `帝冕币不足（需 ${spec.gcCost} GC）` };
    }
    const profile = saveProfile.value;
    if (mode === 'fp' && (profile?.fp ?? 0) < spec.fpCost) {
      return { ok: false, reason: `命运点不足（需 ${spec.fpCost} FP）` };
    }

    // 掷问
    const roll = d100();
    const tier = rollFortuneTier(mode, roll.total);
    const picked = drawFortuneCard(pool, tier);
    if (!picked) return { ok: false, reason: '命运卡堆是空的（需安装内容包）' };
    const cardItem = cardCatalogToItem(picked);

    const patches: StatePatch[] = [
      {
        op: 'add_item',
        target: `characters.${playerChar.name}`,
        value: cardItem as unknown as Record<string, unknown>,
      },
    ];
    if (mode === 'coin') {
      patches.push({
        op: 'update_character',
        target: `characters.${playerChar.name}`,
        value: { money: playerChar.money - spec.gcCost },
      } as StatePatch);
    }
    // 收录进卡册 owned（不自动编组——编组是玩家在卡册的决策）
    // 🔴 `playerChar` 是 Vue reactive：cardAlbum 成员是 Proxy，直接塞进 patch 会让
    //    IndexedDB 报 DataCloneError（2026-09-17 真机：祭坛抽卡落库失败）。
    //    统一走 toPlainCardAlbum 净化（与 updateCardAlbum 同一口径）。
    const album = toPlainCardAlbum(playerChar.cardAlbum ?? { owned: [], deck: [], capacity: 60 });
    if (!album.owned.includes(cardItem.name)) {
      patches.push({
        op: 'update_character',
        target: `characters.${playerChar.name}`,
        value: {
          cardAlbum: {
            owned: [...album.owned, cardItem.name].slice(0, album.capacity),
            deck: album.deck,
            capacity: album.capacity,
          },
        },
      } as StatePatch);
    }
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState(patches);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };

    if (mode === 'fp') {
      const fresh = await getProfile(activeSaveId.value);
      await spendFP(fresh, spec.fpCost, '命运祭坛掷问', 'other');
      await refreshFromDb();
    } else {
      await refreshFromDb();
    }

    const summary = `底石说：「${picked.name}」——${tier}品质的${picked.formEntry}卡${picked.element ? `，铭着${picked.element}行铭文` : ''}。`;
    return {
      ok: true,
      tier,
      card: {
        name: picked.name,
        cardTier: picked.cardTier,
        词条: cardItem.词条,
        description: picked.description,
      },
      d100: roll.total,
      summary,
    };
  }

  /** 倒也可斩（SSS）：触发每场一次的一击（天赋门槛在编排层校验） */
  async function triggerSkirmishNuke(): Promise<void> {
    if (skirmishBusy.value) return;
    await skirmishController.value?.nuke();
  }

  /** 天赋门槛：玩家是否持有解锁该机制的天赋（吞噬一切/军团熔炉/素材之王/万物归一/律师函警告/第六终章） */
  function hasMechanicGate(kind: TalentEntryKind): boolean {
    return hasEntryKind(player.value?.talents?.list, kind);
  }

  /**
   * 每日账本读取（2026-09-17）：存档落点 `worldFlags.dailyUses.<key>`，
   * 与情绪素材的 `worldFlags.emotionExtract` 同一格。旧档/脏值一律由 coerceLedger 兜底。
   */
  function dailyLedger(): DailyLedger {
    return coerceLedger(saveProfile.value?.worldFlags?.dailyUses);
  }

  /** 记一次每日使用（走既有 set_variable 通道，不新增 SaveProfile 字段） */
  function dailyUsePatch(key: string, next: DailyLedger): StatePatch {
    return {
      op: 'set_variable',
      target: `worldFlags.dailyUses.${key}`,
      value: next[key],
    } as StatePatch;
  }

  /** 该天赋今日还能不能用（perDay 从条目档位取，缺省 1） */
  function dailyRemaining(key: string, perDay = 1): number {
    return remainingToday(dailyLedger(), key, currentGameDay(), perDay);
  }

  /** 玩家持有的骰表（好运之骰十面 / 命运之骰六面——可能同时持有两张） */
  function ownedDiceTables(): FortuneDiceTable[] {
    return diceTablesOf(player.value?.talents?.list);
  }

  /** 累计计数（不随天失效）：如【败犬烙印】 */
  function counters(): Record<string, number> {
    return coerceCounters(saveProfile.value?.worldFlags?.counters);
  }

  /** 败犬烙印当前持有数 */
  function scarCount(): number {
    return counterOf(counters(), '败犬烙印');
  }

  /**
   * 标记「下一次制卡消耗一枚烙印」。
   *
   * 制卡由叙事驱动（AI 在正文里出制卡意图），玩家无法在那一刻点按钮——
   * 所以做成**预付开关**：先勾上，下一次制卡时引擎自动扣一枚并把评级上浮两档。
   */
  async function setPendingScar(use: boolean): Promise<{ ok: boolean; reason?: string }> {
    if (!activeSaveId.value) return { ok: false, reason: '无活跃存档' };
    if (use && !hasMechanicGate('烙印')) {
      return { ok: false, reason: '需要天赋【败犬烙印】' };
    }
    if (use && scarCount() <= 0) return { ok: false, reason: '烙印已经用完了' };
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'set_variable',
        target: 'worldFlags.pendingScar',
        value: use,
      } as StatePatch,
    ]);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };
    await refreshFromDb();
    return { ok: true };
  }

  /** 下一次制卡是否已预付烙印 */
  function pendingScar(): boolean {
    return saveProfile.value?.worldFlags?.pendingScar === true;
  }

  /**
   * 强度档取值（2026-09-17 参数化）：同一条机制，SSS 配的档和 SS 配的档可以不同。
   * 条目声明了该数值就按声明走；没声明则回退基准（= 参数化前的硬编码常量）。
   * 提交路径与 CraftBench 预览路径必须取同一个值，否则预览与实际不一致。
   */
  function strengthOf(kind: TalentEntryKind, param: keyof TalentEntry['params']): number {
    return entryStrength(player.value?.talents?.list, kind, param);
  }

  /**
   * 吞噬（SSS「吞噬一切」）：目标卡吞掉一张卡/一件素材 → 成长 + 随机吸收一个词条。
   * 燃料被消耗；目标卡更新 cardExp/cardPowerBonus/词条。同窗原子提交。
   */
  async function devourCard(
    targetName: string,
    fuelName: string,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('吞噬')) {
      return { ok: false, reason: '需要天赋【吞噬一切】才能启用吞噬' };
    }
    const target = playerChar.inventory.find(
      (i): i is CardItem => i.name === targetName && i.type === '卡牌',
    );
    const fuel = playerChar.inventory.find((i) => i.name === fuelName);
    if (!target) return { ok: false, reason: '找不到目标卡' };
    if (!fuel) return { ok: false, reason: '找不到燃料' };

    const { ok, reason, plan } = planDevour(
      target,
      fuel,
      Math.random,
      craftTierCeilingIndex(playerChar.level, strengthOf('吞噬', 'levelBonus')),
    );
    if (!ok || !plan) return { ok: false, reason };

    const patches: StatePatch[] = [
      {
        op: 'update_item',
        target: `characters.${playerChar.name}`,
        value: {
          name: targetName,
          changes: {
            cardExp: plan.cardExp,
            cardPowerBonus: plan.cardPowerBonus,
            词条: plan.new词条,
          },
        },
      },
      {
        op: 'remove_item',
        target: `characters.${playerChar.name}`,
        value: { name: plan.fuelName, quantity: 1 },
      },
    ];
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState(patches);
    if (result.success) await refreshFromDb();
    return result.success
      ? { ok: true, summary: plan.summary }
      : { ok: false, reason: result.errors.join('; ') };
  }

  /**
   * 熔炼（SSS「军团熔炉」）：N 张伙伴卡 → 1 张集合体卡（2 源=融合 / ≥3 源=献祭）。
   */
  async function smeltCards(
    sourceNames: string[],
  ): Promise<{ ok: boolean; reason?: string; summary?: string; productName?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('熔炼')) {
      return { ok: false, reason: '需要天赋【军团熔炉】才能启用熔炼' };
    }
    const sources = sourceNames
      .map((n) => playerChar.inventory.find((i) => i.name === n))
      .filter((i): i is InventoryItem => !!i);
    const { ok, reason, plan } = planSmelt(sources as CardItem[], strengthOf('熔炼', 'tierGain'));
    if (!ok || !plan) return { ok: false, reason };

    const patches: StatePatch[] = [
      {
        op: 'add_item',
        target: `characters.${playerChar.name}`,
        value: plan.product as unknown as Record<string, unknown>,
      },
      ...plan.consumed.map((name) => ({
        op: 'remove_item' as const,
        target: `characters.${playerChar.name}`,
        value: { name, quantity: 1 },
      })),
    ];
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState(patches);
    if (result.success) await refreshFromDb();
    return result.success
      ? { ok: true, summary: plan.summary, productName: plan.productName }
      : { ok: false, reason: result.errors.join('; ') };
  }

  /**
   * 缔约（契约对接好感共鸣）：好感 ≥70 的伙伴卡 → 档位跃迁一阶（持久）。
   */
  async function contractCard(
    cardName: string,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('熔炼')) {
      return { ok: false, reason: '需要天赋【军团熔炉】才能缔约' };
    }
    const card = playerChar.inventory.find(
      (i): i is CardItem => i.name === cardName && i.type === '卡牌',
    );
    if (!card) return { ok: false, reason: '找不到该卡' };
    const affection = saveProfile.value?.affections?.[cardName];
    const { ok, reason, plan } = planContract(card, affection, strengthOf('熔炼', 'threshold'));
    if (!ok || !plan) return { ok: false, reason };

    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'update_item',
        target: `characters.${playerChar.name}`,
        value: { name: cardName, changes: { cardTier: plan.newTier } },
      },
    ]);
    if (result.success) await refreshFromDb();
    return result.success
      ? { ok: true, summary: plan.summary }
      : { ok: false, reason: result.errors.join('; ') };
  }

  /**
   * 拆解（SSS「素材之王」非战斗侧）：物品 → 素材（材料）。
   */
  /**
   * 唤醒/升档本名武器（SS「天生剑骨」「战意破苍穹」）：
   *  - 首次调用 → 按等级生成绑定装备卡（词条含「本名」+ 武器类型）
   *  - 等级提升后再调 → 档位随 tierForLevel 重算（只升不降——「同步成长」）
   * 门槛：持 `本名武器` 条目；武器类型从条目 params 读。
   */
  async function ensureSoulWeapon(): Promise<{
    ok: boolean;
    reason?: string;
    summary?: string;
    productName?: string;
  }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('本名武器')) {
      return { ok: false, reason: '需要持有本名武器类天赋' };
    }
    const entry = (playerChar.talents?.list ?? [])
      .flatMap((t) => t.entries ?? [])
      .find((e) => e.kind === '本名武器');
    const weaponType = String(entry?.params.weapon ?? '剑') as '剑' | '弓';

    const existing = findSoulWeapon(playerChar.inventory, playerChar.name);
    if (existing && !shouldUpgradeSoulWeapon(existing as CardItem, playerChar.level)) {
      return {
        ok: false,
        reason: `【${existing.name}】已在你手中（${(existing as CardItem).cardTier}）——她随你成长，无需再唤醒`,
      };
    }

    const tier = soulWeaponTierForLevel(playerChar.level);
    const card = planSoulWeapon(playerChar.name, weaponType, playerChar.level);
    const sm = createStateManager(activeSaveId.value);
    const patches: StatePatch[] = existing
      ? [
          {
            op: 'update_item',
            target: `characters.${playerChar.name}`,
            value: {
              name: existing.name,
              changes: { cardTier: tier, 词条: card.词条 },
            },
          },
        ]
      : [
          {
            op: 'add_item',
            target: `characters.${playerChar.name}`,
            value: card as unknown as Record<string, unknown>,
          },
        ];
    const result = await sm.commitChatState(patches);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };
    await refreshFromDb();
    return {
      ok: true,
      productName: card.name,
      summary: existing
        ? `【${existing.name}】随你成长——品质升至 ${tier}`
        : `【${card.name}】应声而出（${tier}）——她与你因果绑定，随你成长`,
    };
  }

  /**
   * 制卡主路（2026-09-17 第三档）：**Code 侧一次算完，AI 只写叙事与命名**。
   *
   * 流程：玩家选素材 + 写「想做成什么样」 → `planCardCraft` 算档位/词条/造价/评级/
   * 消耗/经验 → 请 AI 命名并写叙事（失败则兜底） → 一次成型落库。
   *
   * 数值这条线上 AI 没有位置：漏调工具的失败面随之消失，素材经济不再依赖 AI 的自觉。
   */
  async function craftCard(input: {
    mainName: string;
    subNames: string[];
    intent: string;
    /** 技能蓝本名（S「支配者倒影」；用掉即从账上扣） */
    blueprintName?: string;
  }): Promise<{
    ok: boolean;
    reason?: string;
    productName?: string;
    tier?: string;
    rating?: string;
    cost?: number;
    exp?: number;
    audit?: string[];
    narrative?: string;
  }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };

    // ① Code 侧算完（骰值在这里掷；planCardCraft 是纯函数）
    const luckToday = buffActiveToday(
      coerceBuffs(saveProfile.value?.worldFlags?.dailyBuffs),
      DAILY_BUFF_CRAFT_LUCK,
      currentGameDay(),
    );
    const { ok, reason, plan } = planCardCraft({
      mainName: input.mainName,
      subNames: input.subNames,
      intent: input.intent,
      ...(input.blueprintName ? { blueprint: { name: input.blueprintName } } : {}),
      inventory: playerChar.inventory,
      d20: 1 + Math.floor(Math.random() * 20),
      fallbackName: `${input.mainName}·卡`,
      talents: playerChar.talents?.list ?? [],
      expMult: strengthOf('经验倍率', 'expMult'),
      lift: {
        baseLift: luckToday ? 1 : 0, // 「制卡顺利」+1（烙印是预付流程，不在这里）
        misfortune: {
          layers: counterOf(counters(), MISFORTUNE_KEY),
          maxLift: strengthOf('赌运', 'maxLift'),
        },
        rewind: { armed: pendingRewind(), lift: 1 },
      },
    });
    if (!ok || !plan) return { ok: false, reason };

    // ② AI 命名 + 叙事（无工具；失败则兜底，绝不影响产物落库）
    const materials = [input.mainName, ...input.subNames].filter(Boolean);
    let productName = plan.product.name;
    let narrative = '';
    if (craftNarrateImpl) {
      try {
        const said = await craftNarrateImpl({
          saveId: activeSaveId.value,
          provisionalName: plan.product.name,
          tier: plan.product.cardTier,
          entries: plan.product.词条,
          cost: plan.cost,
          rating: plan.rating,
          fusionKind: plan.product.recipe.fusionKind,
          materials,
          consumed: plan.consumed,
          intent: input.intent,
          crafterName: playerChar.name,
          talentNotes: plan.notes,
        });
        if (said.name) productName = said.name;
        narrative = said.narrative;
      } catch (err) {
        console.warn('[game-store] 制卡叙事失败（用兜底文案）:', err);
        narrative = fallbackCraftNarration(plan, materials);
      }
    } else {
      narrative = fallbackCraftNarration(plan, materials);
    }

    // ③ 一次成型落库：素材消耗 + 产物 + 卡册 + 造价 + 经验（全部 Code 算）
    const card: CardItem = { ...plan.product, name: productName };
    const album = toPlainCardAlbum(playerChar.cardAlbum ?? { owned: [], deck: [], capacity: 60 });
    const patches: StatePatch[] = [
      ...plan.consumed.map((name) => ({
        op: 'remove_item' as const,
        target: `characters.${playerChar.name}`,
        value: { name, quantity: 1 },
      })),
      {
        op: 'add_item',
        target: `characters.${playerChar.name}`,
        value: card as unknown as Record<string, unknown>,
      },
      ...(album.owned.includes(productName)
        ? []
        : [
            {
              op: 'update_character',
              target: `characters.${playerChar.name}`,
              value: {
                cardAlbum: {
                  owned: [...album.owned, productName].slice(0, album.capacity),
                  deck: album.deck,
                  capacity: album.capacity,
                },
              },
            } as StatePatch,
          ]),
      {
        op: 'update_character',
        target: `characters.${playerChar.name}`,
        value: { money: Math.max(0, playerChar.money - plan.cost) },
      } as StatePatch,
      ...(plan.exp > 0
        ? [
            {
              op: 'update_character',
              target: `characters.${playerChar.name}`,
              value: { totalExp: plan.exp },
              metadata: { delta: true, source: 'card-craft' },
            } as StatePatch,
          ]
        : []),
      // 支配者倒影：蓝本用掉即扣
      ...(plan.blueprintUsed && input.blueprintName
        ? [
            {
              op: 'set_variable',
              target: 'worldFlags.skillBlueprints',
              value: consumeBlueprint(
                coerceBlueprints(saveProfile.value?.worldFlags?.skillBlueprints),
                input.blueprintName,
              ),
            } as StatePatch,
          ]
        : []),
      ...(plan.misfortuneConsumed > 0
        ? [
            {
              op: 'set_variable',
              target: `worldFlags.counters.${MISFORTUNE_KEY}`,
              value: 0,
            } as StatePatch,
          ]
        : []),
      ...(plan.rewindUsed
        ? [
            {
              op: 'update_character',
              target: `characters.${playerChar.name}`,
              value: { mp: Math.max(0, playerChar.mp - strengthOf('回溯', 'mpCost')) },
            } as StatePatch,
            { op: 'set_variable', target: 'worldFlags.pendingRewind', value: false } as StatePatch,
          ]
        : []),
    ];
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState(patches);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };
    await refreshFromDb();
    return {
      ok: true,
      productName,
      tier: card.cardTier,
      rating: plan.rating,
      cost: plan.cost,
      exp: plan.exp,
      audit: plan.audit,
      narrative,
    };
  }

  /**
   * 足之炼金术（S）：伙伴卡踩踏素材 → 炼出全新道具卡。
   * **素材被消耗、伙伴卡不消耗**（她是踩踏者不是原料）——这是这条天赋的成本。
   */
  async function footAlchemy(
    partnerName: string,
    materialName: string,
  ): Promise<{ ok: boolean; reason?: string; summary?: string; productName?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('炼金')) return { ok: false, reason: '需要天赋【足之炼金术】' };
    const partner = playerChar.inventory.find(
      (i): i is CardItem => i.name === partnerName && i.type === '卡牌',
    );
    if (!partner) return { ok: false, reason: '找不到该伙伴卡' };
    const material = playerChar.inventory.find((i) => i.name === materialName);
    if (!material) return { ok: false, reason: '找不到该素材' };

    const { ok, reason, plan } = planFootAlchemy(partner, material, strengthOf('炼金', 'maxTier'));
    if (!ok || !plan) return { ok: false, reason };

    const album = toPlainCardAlbum(playerChar.cardAlbum ?? { owned: [], deck: [], capacity: 60 });
    const patches: StatePatch[] = [
      {
        op: 'remove_item',
        target: `characters.${playerChar.name}`,
        value: { name: plan.consumedMaterial, quantity: 1 },
      },
      {
        op: 'add_item',
        target: `characters.${playerChar.name}`,
        value: plan.product as unknown as Record<string, unknown>,
      },
      ...(album.owned.includes(plan.product.name)
        ? []
        : [
            {
              op: 'update_character',
              target: `characters.${playerChar.name}`,
              value: {
                cardAlbum: {
                  owned: [...album.owned, plan.product.name].slice(0, album.capacity),
                  deck: album.deck,
                  capacity: album.capacity,
                },
              },
            } as StatePatch,
          ]),
    ];
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState(patches);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };
    await refreshFromDb();
    return { ok: true, summary: plan.summary, productName: plan.product.name };
  }

  /**
   * 调教伙伴卡（S「调教大师系统」）：每级 +1 卡面战力，方向词条（忠犬/女王）在
   * 第一次调教时定下。调教度存卡的 `data.调教`，战力增量走既有的 cardPowerBonus。
   */
  async function trainCompanion(
    cardName: string,
    direction: TrainDirection,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('调教')) {
      return { ok: false, reason: '需要天赋【调教大师系统】' };
    }
    const card = playerChar.inventory.find(
      (i): i is CardItem => i.name === cardName && i.type === '卡牌',
    );
    if (!card) return { ok: false, reason: '找不到该伙伴卡' };
    if (cardKindOf(card.词条 ?? []) !== '召唤') {
      return { ok: false, reason: `【${cardName}】不是伙伴卡——调教只对伙伴有效` };
    }
    const { ok, reason, plan } = planTrain(card, direction, strengthOf('调教', 'maxLevel'));
    if (!ok || !plan) return { ok: false, reason };

    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'update_item',
        target: `characters.${playerChar.name}`,
        value: {
          name: cardName,
          changes: {
            cardPowerBonus: (card.cardPowerBonus ?? 0) + plan.powerGain,
            data: { ...(card.data ?? {}), 调教: plan.to },
          },
        },
      },
    ]);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };
    await refreshFromDb();
    return { ok: true, summary: plan.summary };
  }

  /**
   * 打脸点数兑换（S「打脸升级系统」）：花点数换一件装备。
   * 装备档位按点数消耗量走（一次兑一件，品质对齐当前冒险者等级）。
   */
  async function redeemFaceSlap(): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('打脸')) return { ok: false, reason: '需要天赋【打脸升级系统】' };
    const cost = strengthOf('打脸', 'redeemCost');
    const have = counterOf(counters(), FACE_SLAP_KEY);
    if (!canRedeemFaceSlap(have, cost)) {
      return { ok: false, reason: `打脸点数不足（当前 ${have}，需要 ${cost}）` };
    }
    const tier = tierForLevel(playerChar.level);
    const name = `打脸所得·${tier}装备`;
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'add_item',
        target: `characters.${playerChar.name}`,
        value: {
          name,
          quantity: 1,
          type: '装备',
          rarity: '稀有',
          description: '被人看不起之后，用实力换来的东西。',
        } as unknown as Record<string, unknown>,
      },
      {
        op: 'set_variable',
        target: `worldFlags.counters.${FACE_SLAP_KEY}`,
        value: have - cost,
      } as StatePatch,
    ]);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };
    await refreshFromDb();
    return { ok: true, summary: `花掉 ${cost} 点打脸点数——换来【${name}】` };
  }

  /** 打脸点数（面板展示用） */
  function faceSlapPoints(): number {
    return counterOf(counters(), FACE_SLAP_KEY);
  }

  /** 当前宿敌（面板展示用） */
  function currentNemesis() {
    return coerceNemesis(saveProfile.value?.worldFlags?.nemesis);
  }

  /** 手上有哪些技能蓝本（面板展示与制卡选择用） */
  function skillBlueprints() {
    return coerceBlueprints(saveProfile.value?.worldFlags?.skillBlueprints);
  }

  /** 已记住的真名（面板展示用） */
  function knownTrueNames(): string[] {
    return coerceTrueNames(saveProfile.value?.worldFlags?.trueNames);
  }

  /** 标记「下一次制卡失败时回溯」（S「时间回溯」） */
  async function setPendingRewind(use: boolean): Promise<{ ok: boolean; reason?: string }> {
    if (!activeSaveId.value) return { ok: false, reason: '无活跃存档' };
    const playerChar = player.value;
    if (use && !hasMechanicGate('回溯')) return { ok: false, reason: '需要天赋【时间回溯】' };
    if (use) {
      const cost = strengthOf('回溯', 'mpCost');
      if ((playerChar?.mp ?? 0) < cost) {
        return { ok: false, reason: `精神力不足（需 ${cost} MP）` };
      }
    }
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      { op: 'set_variable', target: 'worldFlags.pendingRewind', value: use } as StatePatch,
    ]);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };
    await refreshFromDb();
    return { ok: true };
  }

  /** 下一次制卡是否已预付回溯 */
  function pendingRewind(): boolean {
    return saveProfile.value?.worldFlags?.pendingRewind === true;
  }

  /** 厄运层数（赌徒谬论；面板展示用） */
  function misfortuneLayers(): number {
    return counterOf(counters(), MISFORTUNE_KEY);
  }

  /**
   * 成灵（S「瓦尔哈拉的门票」）：把一张伙伴卡化为身后灵——卡退场，换一枚永久守护。
   *
   * 裁断：引擎里伙伴卡不会在战斗中「战死」（卡没有生命值，也没有战死结算通道），
   * 所以触发权交回玩家手里。语义仍是「她的灵魂从此跟着你」。
   */
  async function makeSpirit(
    cardName: string,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('成灵')) {
      return { ok: false, reason: '需要天赋【瓦尔哈拉的门票】' };
    }
    const card = playerChar.inventory.find(
      (i): i is CardItem => i.name === cardName && i.type === '卡牌',
    );
    if (!card) return { ok: false, reason: '找不到该伙伴卡' };
    if (cardKindOf(card.词条 ?? []) !== '召唤') {
      return { ok: false, reason: `【${cardName}】不是伙伴卡——只有伙伴能成灵` };
    }
    const before = coerceSpirits(saveProfile.value?.worldFlags?.behindSpirits);
    if (before.some((s) => s.name === cardName)) {
      return { ok: false, reason: `【${cardName}】已经是身后灵了` };
    }
    const after = addSpirit(before, { name: cardName, power: cardPower(card) });
    const album = toPlainCardAlbum(playerChar.cardAlbum ?? { owned: [], deck: [], capacity: 60 });
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'remove_item',
        target: `characters.${playerChar.name}`,
        value: { name: cardName, quantity: 1 },
      },
      // 卡册同步摘掉（她不在册上了，但永远在你身后）
      {
        op: 'update_character',
        target: `characters.${playerChar.name}`,
        value: {
          cardAlbum: {
            owned: album.owned.filter((n) => n !== cardName),
            deck: album.deck.filter((n) => n !== cardName),
            capacity: album.capacity,
          },
        },
      } as StatePatch,
      { op: 'set_variable', target: 'worldFlags.behindSpirits', value: after } as StatePatch,
    ]);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };
    await refreshFromDb();
    return {
      ok: true,
      summary: `【${cardName}】化作身后灵——她不再上场，但每一场都在你身后（+${
        after.length * strengthOf('成灵', 'guardPerSpirit')
      } 防御）`,
    };
  }

  /** 已化灵的名单（面板展示用） */
  function behindSpirits() {
    return coerceSpirits(saveProfile.value?.worldFlags?.behindSpirits);
  }

  /**
   * 缔结双生羁绊（S「双生羁绊」）：指定两张伙伴卡，她们共享感官——
   * 先后打出时触发组合技。两张卡都会打上「双生」印记。
   */
  async function bindTwins(
    a: string,
    b: string,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('羁绊')) return { ok: false, reason: '需要天赋【双生羁绊】' };
    if (!a || !b) return { ok: false, reason: '要指定两张伙伴卡' };
    if (a === b) return { ok: false, reason: '同一张卡不能与自己缔结羁绊' };
    const bonds = coerceTwinBonds(saveProfile.value?.worldFlags?.twinBonds);
    if (areTwins(bonds, a, b)) return { ok: false, reason: '她们已经结过羁绊了' };
    const cards = [a, b].map((n) =>
      playerChar.inventory.find((i): i is CardItem => i.name === n && i.type === '卡牌'),
    );
    for (const [i, c] of cards.entries()) {
      if (!c) return { ok: false, reason: `找不到【${[a, b][i]}】` };
      if (cardKindOf(c.词条 ?? []) !== '召唤') {
        return { ok: false, reason: `【${c.name}】不是伙伴卡——羁绊只结在伙伴之间` };
      }
    }
    const next = [...bonds, { a, b }];
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      // 两张卡都打上「双生」印记（词条是卡的单一真源）
      ...cards.map((c) => ({
        op: 'update_item' as const,
        target: `characters.${playerChar.name}`,
        value: {
          name: c!.name,
          changes: {
            词条: (c!.词条 ?? []).includes(TWIN_ENTRY) ? c!.词条 : [...(c!.词条 ?? []), TWIN_ENTRY],
          },
        },
      })),
      { op: 'set_variable', target: 'worldFlags.twinBonds', value: next } as StatePatch,
    ]);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };
    await refreshFromDb();
    return { ok: true, summary: `【${a}】与【${b}】结为双生——先后打出时触发组合技` };
  }

  /** 已缔结的羁绊（面板展示用） */
  function twinBonds() {
    return coerceTwinBonds(saveProfile.value?.worldFlags?.twinBonds);
  }

  /** 宣战决斗（S「西部决斗礼仪」） */
  async function declareDuel(): Promise<void> {
    await skirmishController.value?.duel();
  }

  /** 献祭召唤（S「召唤媒介系统」） */
  async function sacrificeSummon(): Promise<void> {
    await skirmishController.value?.sacrifice();
  }

  /** 念出真名（S「真名看破系统」） */
  async function speakTrueName(): Promise<void> {
    await skirmishController.value?.trueName();
  }

  /** 热插拔模块（S「模块化天才」）：把已上场的模块化载具换一种形态再发动 */
  async function hotSwapModule(): Promise<void> {
    await skirmishController.value?.hotSwap();
  }

  /**
   * 素材十连（S「素材十连系统」）：每天一次十连抽素材，保底不低于自身等级。
   * 每日限次走账本；保底与突变概率在 material-gacha.ts（纯函数、可复算）。
   */
  async function drawMaterialTen(): Promise<{
    ok: boolean;
    reason?: string;
    summary?: string;
    rolls?: { rarity: string; mutated: boolean; mutationEntry?: string }[];
  }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('抽奖')) {
      return { ok: false, reason: '需要天赋【素材十连系统】才能抽素材' };
    }
    const key = '素材十连';
    const gate = tryUseToday(
      dailyLedger(),
      key,
      currentGameDay(),
      strengthOf('抽奖', 'perDay'),
      key,
    );
    if (!gate.ok) return { ok: false, reason: gate.reason };

    const result = planMaterialGacha(
      strengthOf('抽奖', 'times'),
      floorRarityForLevel(playerChar.level),
    );

    // 同稀有度合并成一份 add_item（素材无 id，逻辑键=名字）
    const byRarity = new Map<string, number>();
    for (const r of result.rolls) {
      const name =
        r.mutated && r.mutationEntry
          ? `${materialNameOf(r.rarity)}·${r.mutationEntry}`
          : materialNameOf(r.rarity);
      byRarity.set(name, (byRarity.get(name) ?? 0) + 1);
    }
    const rarityOf = new Map<string, string>();
    for (const r of result.rolls) {
      const name =
        r.mutated && r.mutationEntry
          ? `${materialNameOf(r.rarity)}·${r.mutationEntry}`
          : materialNameOf(r.rarity);
      rarityOf.set(name, r.rarity);
    }

    const patches: StatePatch[] = [
      ...[...byRarity.entries()].map(([name, quantity]) => ({
        op: 'add_item' as const,
        target: `characters.${playerChar.name}`,
        value: { name, quantity, type: '材料', rarity: rarityOf.get(name) } as unknown as Record<
          string,
          unknown
        >,
      })),
      dailyUsePatch(key, gate.next),
    ];
    const sm = createStateManager(activeSaveId.value);
    const commit = await sm.commitChatState(patches);
    if (!commit.success) return { ok: false, reason: commit.errors.join('; ') };
    await refreshFromDb();
    return {
      ok: true,
      summary: `${key}：${result.summary}`,
      rolls: result.rolls.map((r) => ({
        rarity: r.rarity,
        mutated: r.mutated,
        ...(r.mutationEntry ? { mutationEntry: r.mutationEntry } : {}),
      })),
    };
  }

  /**
   * 不等价交换（S「不等价交换」）：放弃一件素材/卡牌，换回 1~2 个同类型、
   * 品质不高于原来的回报。**换亏是设计的一部分**——份数与抽到哪张都由骰值决定。
   */
  async function exchangeItem(
    itemName: string,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('置换')) {
      return { ok: false, reason: '需要天赋【不等价交换】才能置换' };
    }
    const item = playerChar.inventory.find((i) => i.name === itemName);
    if (!item) return { ok: false, reason: '找不到该物品' };

    const pool = parseCatalogData(getContentRegistry().catalog).cardPool.filter(
      (c) => !c.imitation,
    );
    const { ok, reason, plan } = planUnequalExchange(
      item as unknown as Parameters<typeof planUnequalExchange>[0],
      pool,
      Math.random,
      strengthOf('置换', 'maxReturn'),
    );
    if (!ok || !plan) return { ok: false, reason };

    const patches: StatePatch[] = [
      {
        op: 'remove_item',
        target: `characters.${playerChar.name}`,
        value: { name: plan.sourceName, quantity: 1 },
      },
      ...plan.gains.map((g) => ({
        op: 'add_item' as const,
        target: `characters.${playerChar.name}`,
        value: g as unknown as Record<string, unknown>,
      })),
    ];
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState(patches);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };
    await refreshFromDb();
    return { ok: true, summary: plan.summary };
  }

  /**
   * 好运之骰（SS）：每天一次投十面骰。**十面全部 Code 兑现**（fortune-dice.ts），
   * AI 只负责把结果写成一段像命运的话——抽奖是唯一的纯随机入口，结果必须可复算。
   *
   * 兑现分派：
   *  - 即时发放：金钱 / 素材 / 卡（走祭坛同一条抽卡内核）/ 等级 / 好感
   *  - 账本操作：「再来一次」退还今日次数（不写账本）
   *  - 当日增益：写 worldFlags.dailyBuffs（跨天自动失效）
   */
  async function rollFortuneDice(tableKey: string): Promise<{
    ok: boolean;
    reason?: string;
    pip?: number;
    faceId?: string;
    tone?: string;
    text?: string;
    summary?: string;
  }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('日掷')) {
      return { ok: false, reason: '需要持有能投骰的天赋' };
    }
    // 该表必须是玩家**真的持有**的那张（防止 UI 被绕过后投出不存在的骰子）
    const table = ownedDiceTables().find((t) => t.key === tableKey);
    if (!table) return { ok: false, reason: `你没有【${tableKey}】这枚骰子` };

    const today = currentGameDay();
    const key = table.key;
    const perDay = strengthOf('日掷', 'perDay');
    const gate = tryUseToday(dailyLedger(), key, today, perDay, key);
    if (!gate.ok) return { ok: false, reason: gate.reason };

    const face = rollOnTable(table, rollDie(table.faces));
    const patches: StatePatch[] = [];
    const notes: string[] = [];
    let summary = `【${face.id}】${face.text}`;

    switch (face.reward.kind) {
      case 'none':
        break;
      case 'money': {
        const next = Math.max(0, Math.round(playerChar.money + face.reward.amount));
        patches.push({
          op: 'update_character',
          target: `characters.${playerChar.name}`,
          value: { money: next },
        } as StatePatch);
        notes.push(`金钱 ${face.reward.amount > 0 ? '+' : ''}${face.reward.amount} → ${next}`);
        break;
      }
      case 'material': {
        const name = materialNameOf(face.reward.rarity);
        patches.push({
          op: 'add_item',
          target: `characters.${playerChar.name}`,
          value: {
            name,
            quantity: face.reward.copies,
            type: '材料',
            rarity: face.reward.rarity,
          } as unknown as Record<string, unknown>,
        } as StatePatch);
        notes.push(`${name} ×${face.reward.copies}`);
        break;
      }
      case 'card': {
        const pool = parseCatalogData(getContentRegistry().catalog).cardPool.filter(
          (c) => !c.imitation,
        );
        const picked = drawFortuneCard(pool, face.reward.cardTier);
        if (!picked) {
          // 卡池为空（未装内容包）——不吞掉这次机会，按「谢谢惠顾」结算
          summary = `【${face.id}】命运卡堆是空的（需安装内容包）——这一面暂时落空。`;
          break;
        }
        const cardItem = cardCatalogToItem(picked);
        patches.push({
          op: 'add_item',
          target: `characters.${playerChar.name}`,
          value: cardItem as unknown as Record<string, unknown>,
        } as StatePatch);
        // 卡册收录（与祭坛同源：toPlainCardAlbum 净化 reactive proxy，防 DataCloneError）
        const album = toPlainCardAlbum(
          playerChar.cardAlbum ?? { owned: [], deck: [], capacity: 60 },
        );
        if (!album.owned.includes(cardItem.name)) {
          patches.push({
            op: 'update_character',
            target: `characters.${playerChar.name}`,
            value: {
              cardAlbum: {
                owned: [...album.owned, cardItem.name].slice(0, album.capacity),
                deck: album.deck,
                capacity: album.capacity,
              },
            },
          } as StatePatch);
        }
        notes.push(`得卡【${cardItem.name}】（${cardItem.cardTier}）`);
        break;
      }
      case 'level': {
        patches.push({
          op: 'update_character',
          target: `characters.${playerChar.name}`,
          value: { level: playerChar.level + face.reward.steps },
        } as StatePatch);
        notes.push(`等级 ${playerChar.level} → ${playerChar.level + face.reward.steps}`);
        break;
      }
      case 'affection': {
        const affections = (saveProfile.value?.affections ?? {}) as Record<string, number>;
        const top = Object.entries(affections)
          .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
          .sort((a, b) => b[1] - a[1])[0];
        if (!top) {
          summary = `【${face.id}】你还没有任何羁绊可以更近一步——这一面落空。`;
          break;
        }
        const next = Math.min(100, Math.round(top[1] + face.reward.amount));
        patches.push({
          op: 'set_variable',
          target: `profile.affections.${top[0]}`,
          value: next,
        } as StatePatch);
        notes.push(`与【${top[0]}】的好感 ${Math.round(top[1])} → ${next}`);
        break;
      }
      case 'reroll':
        // 退还今日次数：**不写账本**，等于这一掷没花掉机会
        break;
      case 'dailyBuff': {
        const buffs = markBuff(
          coerceBuffs(saveProfile.value?.worldFlags?.dailyBuffs),
          face.reward.key,
          today,
        );
        patches.push({
          op: 'set_variable',
          target: `worldFlags.dailyBuffs.${face.reward.key}`,
          value: buffs[face.reward.key],
        } as StatePatch);
        notes.push(`${face.reward.label}（今日有效）`);
        break;
      }
    }

    // 账本：正常消耗一次；「再来一次」不消耗（退还今日机会）
    if (!isRerollFace(face)) patches.push(dailyUsePatch(key, gate.next));
    if (notes.length > 0) summary += `\n▸ ${notes.join('；')}`;

    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState(patches);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };
    await refreshFromDb();
    return {
      ok: true,
      pip: face.pip,
      faceId: face.id,
      tone: face.tone,
      text: face.text,
      summary,
    };
  }

  /**
   * 素材点金（S「素材点金」）：每天一次，指定一个素材提升一个品质大档。
   * 每日限次走账本（`worldFlags.dailyUses.素材点金`），第二天自然恢复。
   */
  async function upgradeMaterial(
    itemName: string,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('点金')) {
      return { ok: false, reason: '需要天赋【素材点金】才能启用点金' };
    }
    const item = playerChar.inventory.find((i) => i.name === itemName);
    if (!item) return { ok: false, reason: '找不到该素材' };

    const key = '素材点金';
    const perDay = strengthOf('点金', 'perDay');
    const gate = tryUseToday(dailyLedger(), key, currentGameDay(), perDay, key);
    if (!gate.ok) return { ok: false, reason: gate.reason };

    const { ok, reason, plan } = planRarityUpgrade(item, strengthOf('点金', 'tierGain'));
    if (!ok || !plan) return { ok: false, reason };

    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'update_item',
        target: `characters.${playerChar.name}`,
        value: { name: itemName, changes: { rarity: plan.to } },
      },
      dailyUsePatch(key, gate.next),
    ]);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };
    await refreshFromDb();
    return { ok: true, summary: plan.summary };
  }

  async function dismantleItem(
    itemName: string,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('拆解')) {
      return { ok: false, reason: '需要天赋【素材之王】才能拆解' };
    }
    const item = playerChar.inventory.find((i) => i.name === itemName);
    if (!item) return { ok: false, reason: '找不到该物品' };

    const { ok, reason, plan } = planDismantle(
      item,
      craftTierCeilingIndex(playerChar.level, strengthOf('拆解', 'levelBonus')),
    );
    if (!ok || !plan) return { ok: false, reason };

    const patches: StatePatch[] = [
      {
        op: 'remove_item',
        target: `characters.${playerChar.name}`,
        value: { name: plan.sourceName, quantity: 1 },
      },
      ...plan.yields.map((y) => ({
        op: 'add_item' as const,
        target: `characters.${playerChar.name}`,
        value: y as unknown as Record<string, unknown>,
      })),
    ];
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState(patches);
    if (result.success) await refreshFromDb();
    return result.success
      ? { ok: true, summary: plan.summary }
      : { ok: false, reason: result.errors.join('; ') };
  }

  /**
   * 多卡融合（SSS「万物归一」）：恰好 3 张任意卡 → 1 张全新卡（继承部分词条 + 随机专属词条）。
   */
  async function fuseCards(
    sourceNames: string[],
  ): Promise<{ ok: boolean; reason?: string; summary?: string; productName?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('融合')) {
      return { ok: false, reason: '需要天赋【万物归一】才能多卡融合' };
    }
    const sources = sourceNames
      .map((n) => playerChar.inventory.find((i) => i.name === n))
      .filter((i): i is InventoryItem => !!i);
    const { ok, reason, plan } = planMultiFusion(
      sources as CardItem[],
      Math.random,
      strengthOf('融合', 'tierGain'),
      craftTierCeilingIndex(playerChar.level, strengthOf('融合', 'levelBonus')),
    );
    if (!ok || !plan) return { ok: false, reason };

    const patches: StatePatch[] = [
      {
        op: 'add_item',
        target: `characters.${playerChar.name}`,
        value: plan.product as unknown as Record<string, unknown>,
      },
      ...plan.consumed.map((name) => ({
        op: 'remove_item' as const,
        target: `characters.${playerChar.name}`,
        value: { name, quantity: 1 },
      })),
    ];
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState(patches);
    if (result.success) await refreshFromDb();
    return result.success
      ? { ok: true, summary: plan.summary, productName: plan.product.name }
      : { ok: false, reason: result.errors.join('; ') };
  }

  /**
   * 情绪素材提取（SSS「七宗罪之主」）：每天每种情绪一次，产出材料供制卡。
   * 记账落在 SaveProfile.worldFlags.emotionExtract[情绪] = gameDay。
   */
  async function extractEmotion(
    emotion: Emotion,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('情绪素材')) {
      return { ok: false, reason: '需要天赋【七宗罪之主】才能提取情绪素材' };
    }
    const today = currentGameDay();
    const ledger = (saveProfile.value?.worldFlags?.emotionExtract ?? {}) as Partial<
      Record<Emotion, number>
    >;
    const { ok, reason, plan } = planEmotionExtract(emotion, today, ledger[emotion]);
    if (!ok || !plan) return { ok: false, reason };

    const patches: StatePatch[] = [
      {
        op: 'add_item',
        target: `characters.${playerChar.name}`,
        value: { name: plan.materialName, quantity: plan.quantity, type: '材料' },
      },
      {
        op: 'set_variable',
        target: `worldFlags.emotionExtract.${emotion}`,
        value: today,
      } as StatePatch,
    ];
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState(patches);
    if (result.success) await refreshFromDb();
    return result.success
      ? { ok: true, summary: plan.summary }
      : { ok: false, reason: result.errors.join('; ') };
  }

  /**
   * 深渊契约（SSS「深渊领主」）：深海系伙伴卡 → 获「深海」「深渊压制」词条 + 跃迁一阶。
   */
  async function abyssContract(
    cardName: string,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('深渊契约')) {
      return { ok: false, reason: '需要天赋【深渊领主】才能缔结深渊契约' };
    }
    const card = playerChar.inventory.find(
      (i): i is CardItem => i.name === cardName && i.type === '卡牌',
    );
    if (!card) return { ok: false, reason: '找不到该卡' };
    const { ok, reason, plan } = planAbyssContract(card, strengthOf('深渊契约', 'percent'));
    if (!ok || !plan) return { ok: false, reason };

    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'update_item',
        target: `characters.${playerChar.name}`,
        value: {
          name: cardName,
          changes: {
            词条: plan.new词条,
            ...(plan.upgraded ? { cardTier: plan.newTier } : {}),
          },
        },
      },
    ]);
    if (result.success) await refreshFromDb();
    return result.success
      ? { ok: true, summary: plan.summary }
      : { ok: false, reason: result.errors.join('; ') };
  }

  /**
   * 肉体改造（SSS「突变巫师」）：把一张卡改写为指定形态系列（追加形态词条）。
   */
  async function reshapeCard(
    cardName: string,
    series: string,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('改造')) {
      return { ok: false, reason: '需要天赋【突变巫师】才能改造卡牌形态' };
    }
    const card = playerChar.inventory.find(
      (i): i is CardItem => i.name === cardName && i.type === '卡牌',
    );
    if (!card) return { ok: false, reason: '找不到该卡' };
    const { ok, reason, plan } = planReshape(card, series);
    if (!ok || !plan) return { ok: false, reason };

    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'update_item',
        target: `characters.${playerChar.name}`,
        value: { name: cardName, changes: { 词条: plan.new词条 } },
      },
    ]);
    if (result.success) await refreshFromDb();
    return result.success
      ? { ok: true, summary: plan.summary }
      : { ok: false, reason: result.errors.join('; ') };
  }

  /**
   * 捕获（SSS「你是我的了」）：把刚战胜的敌人变成伙伴卡 + 实体。
   * 条件：交锋已结束且为胜利/碾压；敌方等级 ≤ 玩家等级+1；未捕获过同名。
   */
  async function captureEnemy(): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    const session = skirmishSession.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('捕获')) {
      return { ok: false, reason: '需要天赋【你是我的了】才能捕获敌人' };
    }
    if (!session) return { ok: false, reason: '没有可捕获的对手（先打一场）' };
    if (session.finished !== '胜利' && session.finished !== '碾压') {
      return { ok: false, reason: '只有在战胜之后才谈得上捕获' };
    }
    if (playerChar.inventory.some((i) => i.name === session.enemyName)) {
      return { ok: false, reason: `【${session.enemyName}】已经在你身边了` };
    }
    const { ok, reason, plan } = planCaptureEnemy(
      session.enemyName,
      session.enemyLevel,
      playerChar.level,
      Math.random,
      strengthOf('捕获', 'levelBonus'),
    );
    if (!ok || !plan) return { ok: false, reason };

    // 卡入背包 + 卡册收录 + 实体化（与首召入库同源：type='summon'）
    const album = toPlainCardAlbum(playerChar.cardAlbum ?? { owned: [], deck: [], capacity: 60 });
    const patches: StatePatch[] = [
      {
        op: 'add_item',
        target: `characters.${playerChar.name}`,
        value: plan.card as unknown as Record<string, unknown>,
      },
      ...(album.owned.includes(plan.card.name)
        ? []
        : [
            {
              op: 'update_character' as const,
              target: `characters.${playerChar.name}`,
              value: {
                cardAlbum: {
                  owned: [...album.owned, plan.card.name].slice(0, album.capacity),
                  deck: album.deck,
                  capacity: album.capacity,
                },
              },
            } as StatePatch,
          ]),
      {
        op: 'add_character',
        target: 'characters',
        value: buildSummonCompanion({
          card: plan.card,
          saveId: activeSaveId.value,
          playerName: playerChar.name,
          location: playerChar.location,
        }) as unknown as Record<string, unknown>,
      } as StatePatch,
    ];
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState(patches);
    if (result.success) await refreshFromDb();
    return result.success
      ? { ok: true, summary: plan.summary }
      : { ok: false, reason: result.errors.join('; ') };
  }

  /**
   * 孕育（SSS「种付支配」/「神孕之屌」）：双亲伙伴卡 → 子嗣卡（继承双亲各一词条）。
   */
  async function breedCompanions(
    motherName: string,
    fatherName: string,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('孕育')) {
      return { ok: false, reason: '需要天赋【种付支配】或【神孕之屌】才能孕育' };
    }
    const find = (n: string) =>
      playerChar.inventory.find((i): i is CardItem => i.name === n && i.type === '卡牌');
    const mother = find(motherName);
    const father = find(fatherName);
    if (!mother || !father) return { ok: false, reason: '找不到双亲卡' };

    const { ok, reason, plan } = planOffspring(mother, father);
    if (!ok || !plan) return { ok: false, reason };

    const album = toPlainCardAlbum(playerChar.cardAlbum ?? { owned: [], deck: [], capacity: 60 });
    const patches: StatePatch[] = [
      {
        op: 'add_item',
        target: `characters.${playerChar.name}`,
        value: plan.card as unknown as Record<string, unknown>,
      },
      ...(album.owned.includes(plan.card.name)
        ? []
        : [
            {
              op: 'update_character' as const,
              target: `characters.${playerChar.name}`,
              value: {
                cardAlbum: {
                  owned: [...album.owned, plan.card.name].slice(0, album.capacity),
                  deck: album.deck,
                  capacity: album.capacity,
                },
              },
            } as StatePatch,
          ]),
    ];
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState(patches);
    if (result.success) await refreshFromDb();
    return result.success
      ? { ok: true, summary: plan.summary }
      : { ok: false, reason: result.errors.join('; ') };
  }

  /**
   * 转化（SSS「变肉便器吧」）：伙伴卡退场，词条逐条兑成素材。
   */
  async function corruptCompanion(
    cardName: string,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('转化')) {
      return { ok: false, reason: '需要天赋【变肉便器吧】才能转化伙伴卡' };
    }
    const card = playerChar.inventory.find(
      (i): i is CardItem => i.name === cardName && i.type === '卡牌',
    );
    if (!card) return { ok: false, reason: '找不到该卡' };
    const { ok, reason, plan } = planCorruptCompanion(card);
    if (!ok || !plan) return { ok: false, reason };

    const patches: StatePatch[] = [
      {
        op: 'remove_item',
        target: `characters.${playerChar.name}`,
        value: { name: plan.sourceName, quantity: 1 },
      },
      ...plan.materials.map((m) => ({
        op: 'add_item' as const,
        target: `characters.${playerChar.name}`,
        value: m as unknown as Record<string, unknown>,
      })),
    ];
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState(patches);
    if (result.success) await refreshFromDb();
    return result.success
      ? { ok: true, summary: plan.summary }
      : { ok: false, reason: result.errors.join('; ') };
  }

  /**
   * 词条剥离（SSS「词条之王」）：卡上一个词条 → 一份素材，卡保留其余词条。
   */
  async function stripEntry(
    cardName: string,
    entry: string,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('剥离')) {
      return { ok: false, reason: '需要天赋【词条之王】才能剥离词条' };
    }
    const card = playerChar.inventory.find(
      (i): i is CardItem => i.name === cardName && i.type === '卡牌',
    );
    if (!card) return { ok: false, reason: '找不到该卡' };
    const { ok, reason, plan } = planStripEntry(card, entry);
    if (!ok || !plan) return { ok: false, reason };

    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'update_item',
        target: `characters.${playerChar.name}`,
        value: { name: cardName, changes: { 词条: plan.new词条 } },
      },
      {
        op: 'add_item',
        target: `characters.${playerChar.name}`,
        value: plan.material as unknown as Record<string, unknown>,
      },
    ]);
    if (result.success) await refreshFromDb();
    return result.success
      ? { ok: true, summary: plan.summary }
      : { ok: false, reason: result.errors.join('; ') };
  }

  /** 立为「最终兵器」（SSS「最终兵器：她」）：打上标记后每场战斗结束自动进化。 */
  async function designateFinalWeapon(
    cardName: string,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('自我进化')) {
      return { ok: false, reason: '需要天赋【最终兵器：她】' };
    }
    const card = playerChar.inventory.find(
      (i): i is CardItem => i.name === cardName && i.type === '卡牌',
    );
    if (!card) return { ok: false, reason: '找不到该卡' };
    if (!(card.词条 ?? []).includes('召唤')) {
      return { ok: false, reason: '只有伙伴卡可以被立为最终兵器' };
    }
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'update_item',
        target: `characters.${playerChar.name}`,
        value: {
          name: cardName,
          changes: { data: { ...((card.data as object) ?? {}), finalWeapon: true } },
        },
      },
    ]);
    if (result.success) await refreshFromDb();
    return result.success
      ? { ok: true, summary: `【${cardName}】被立为最终兵器——此后每场战斗结束都会自我进化` }
      : { ok: false, reason: result.errors.join('; ') };
  }

  /** 结缘（SSS「后宫之主系统」）：好感 ≥90 的伙伴 → 她的一项词条永久归你 + 她得后宫光环。 */
  async function bondTribute(
    cardName: string,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('结缘')) {
      return { ok: false, reason: '需要天赋【后宫之主系统】' };
    }
    const card = playerChar.inventory.find(
      (i): i is CardItem => i.name === cardName && i.type === '卡牌',
    );
    if (!card) return { ok: false, reason: '找不到该卡' };
    const affection = saveProfile.value?.affections?.[cardName];
    const { ok, reason, plan } = planAffectionTribute(
      card,
      affection,
      strengthOf('结缘', 'threshold'),
    );
    if (!ok || !plan) return { ok: false, reason };

    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'update_item',
        target: `characters.${playerChar.name}`,
        value: { name: cardName, changes: { 词条: plan.herNew词条 } },
      },
    ]);
    if (result.success) await refreshFromDb();
    return result.success
      ? { ok: true, summary: plan.summary }
      : { ok: false, reason: result.errors.join('; ') };
  }

  /** 册封位份（SSS「后宫三千」）：皇后得全卡组伙伴战力 10%（上限 20）。 */
  async function enthroneCard(
    cardName: string,
    rank: ConsortRank,
  ): Promise<{ ok: boolean; reason?: string; summary?: string }> {
    const playerChar = player.value;
    if (!activeSaveId.value || !playerChar) return { ok: false, reason: '无活跃存档' };
    if (!hasMechanicGate('位份')) {
      return { ok: false, reason: '需要天赋【后宫三千】' };
    }
    const card = playerChar.inventory.find(
      (i): i is CardItem => i.name === cardName && i.type === '卡牌',
    );
    if (!card) return { ok: false, reason: '找不到该卡' };
    const deckNames = playerChar.cardAlbum?.deck ?? [];
    const others = deckNames
      .filter((n) => n !== cardName)
      .map((n) => playerChar.inventory.find((i) => i.name === n && i.type === '卡牌'))
      .filter((c): c is CardItem => !!c);
    const { ok, reason, plan } = planEnthrone(card, rank, others, strengthOf('位份', 'percent'));
    if (!ok || !plan) return { ok: false, reason };

    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'update_item',
        target: `characters.${playerChar.name}`,
        value: { name: cardName, changes: { 词条: plan.new词条 } },
      },
      ...(plan.bonus > 0
        ? [
            {
              op: 'update_item' as const,
              target: `characters.${playerChar.name}`,
              value: {
                name: cardName,
                changes: {
                  cardPowerBonus: Math.max(0, Math.round(card.cardPowerBonus ?? 0)) + plan.bonus,
                },
              },
            } as StatePatch,
          ]
        : []),
    ]);
    if (result.success) await refreshFromDb();
    return result.success
      ? { ok: true, summary: plan.summary }
      : { ok: false, reason: result.errors.join('; ') };
  }

  // === 元数据 ===
  const saveProfile = ref<SaveProfile | null>(null);
  const fp = computed(() => saveProfile.value?.fp || 0);
  const gameTime = computed(() => saveProfile.value?.gameTime ?? null);
  /** 🆕 经验档位（简单/普通模式，2026-08-24）：读 SaveProfile.experienceMode，旧档缺字段兜底 normal */
  const experienceMode = computed(() =>
    getExperienceMode(saveProfile.value ?? ({} as SaveProfile)),
  );

  // === 新闻（存档级，守护非可选字段的运行时缺失与坏数据） ===
  const news = computed(() =>
    (saveProfile.value?.news ?? []).filter((n: any) => n && n.id != null),
  );

  // === 心里话 ===
  // 唯一真源: CharacterState.thoughts 正式字段（规范 §7，M6 T1 切读收口）
  function getThoughts(char?: CharacterState): string {
    return char?.thoughts ?? '';
  }

  // === 玩家可见的回合活动 ===
  const agentActivityRuns = ref<AgentActivityRun[]>([]);
  let activitySequence = 0;

  const currentAgentActivityRun = computed(
    () =>
      [...agentActivityRuns.value]
        .reverse()
        .find((run) => run.status === 'running' || run.status === 'stopping') ?? null,
  );

  function activityRun(runId?: string): AgentActivityRun | undefined {
    if (runId) return agentActivityRuns.value.find((run) => run.id === runId);
    return currentAgentActivityRun.value ?? undefined;
  }

  function startAgentActivityRun(sourceMessageId?: string, standalone = false): string {
    const id = `activity-${Date.now()}-${++activitySequence}`;
    agentActivityRuns.value.push({
      id,
      sourceMessageId:
        sourceMessageId ??
        [...messages.value].reverse().find((msg) => msg.role === 'user')?.id ??
        null,
      status: 'running',
      startedAt: Date.now(),
      standalone,
      steps: [],
    });
    return id;
  }

  function ensureActivityRun(runId?: string): AgentActivityRun {
    const existing = activityRun(runId);
    if (existing) return existing;
    const createdId = startAgentActivityRun(undefined, true);
    return activityRun(createdId)!;
  }

  function updateAgentStatus(agentId: string, runId?: string): string | undefined {
    const run = ensureActivityRun(runId);
    if (run.status === 'stopping') return undefined;
    const existing = [...run.steps]
      .reverse()
      .find((step) => step.agentId === agentId && step.status === 'running');
    if (existing) return existing.id;

    const occurrence = run.steps.filter((step) => step.agentId === agentId).length + 1;
    const step: AgentActivityStep = {
      id: `${run.id}:${agentId}:${occurrence}`,
      agentId,
      label: agentActivityLabel(agentId),
      status: 'running',
      startedAt: Date.now(),
      tools: [],
    };
    run.steps.push(step);
    return step.id;
  }

  function clearAgentStatus(agentId: string, error?: string, runId?: string) {
    const run = activityRun(runId);
    if (!run) return;
    const step = [...run.steps]
      .reverse()
      .find((entry) => entry.agentId === agentId && entry.status === 'running');
    if (!step) return;
    step.status = error ? 'failed' : 'completed';
    step.completedAt = Date.now();

    if (run.standalone && !run.steps.some((entry) => entry.status === 'running')) {
      finishAgentActivityRun(run.id, error ? 'failed' : 'completed');
    }
  }

  function recordAgentToolActivity(
    agentId: string,
    toolName: string,
    args: unknown,
    result: unknown,
    runId?: string,
  ) {
    const run = ensureActivityRun(runId);
    let step = [...run.steps]
      .reverse()
      .find((entry) => entry.agentId === agentId && entry.status === 'running');
    if (!step) {
      updateAgentStatus(agentId, run.id);
      step = [...run.steps]
        .reverse()
        .find((entry) => entry.agentId === agentId && entry.status === 'running');
    }
    if (!step) return;
    const sequence = step.tools.length + 1;
    step.tools.push(
      presentToolActivity(toolName, args, result, `${step.id}:tool:${sequence}`, Date.now()),
    );
  }

  function markAgentActivityStopping(runId: string) {
    const run = activityRun(runId);
    if (run?.status === 'running') run.status = 'stopping';
  }

  function finishAgentActivityRun(
    runId: string,
    status: 'completed' | 'failed' | 'cancelled',
    message?: string,
  ) {
    const run = activityRun(runId);
    if (!run || ['completed', 'failed', 'cancelled'].includes(run.status)) return;
    const completedAt = Date.now();
    run.status = status;
    run.completedAt = completedAt;
    run.message = message;
    for (const step of run.steps) {
      if (step.status !== 'running') continue;
      step.status = status === 'completed' ? 'completed' : status;
      step.completedAt = completedAt;
    }
  }

  function clearAllAgentStatus() {
    agentActivityRuns.value = [];
  }

  // === UI 布局状态 (Phase 7e) ===
  const sidebarCollapsed = ref(false);
  const activeModal = ref<string | null>(null);
  const fullscreenStatus = ref(false);

  // 选项填充 — ChatFlow 点击选项 → InputBar 填入
  const pendingInput = ref('');

  function fillInput(text: string) {
    pendingInput.value = text;
  }
  function clearPendingInput() {
    pendingInput.value = '';
  }

  /** 是否已消费开场 Prompt（未消费 → 需要自动发送）
   *  注意：仅以 openingPromptConsumed 元数据为准，messages 长度不作为消费判定。
   *  因为创角流程可能会预先插入一条消息，但开场 prompt 仍应自动发送。 */
  const hasOpeningPromptConsumed = computed(() => {
    return activeSave.value?.metadata?.openingPromptConsumed === true;
  });

  /** 获取开场 Prompt 文本 */
  const openingPrompt = computed(() => {
    return activeSave.value?.metadata?.openingPrompt ?? null;
  });

  /** 最近 10 回合的 Agent 调试历史；当前回合永远是最后一条。 */
  const agentLogHistory = ref<DebugTurnRecord[]>([]);
  const agentLog = computed(
    () => agentLogHistory.value[agentLogHistory.value.length - 1]?.entries ?? [],
  );
  let debugLogWriteQueue: Promise<void> = Promise.resolve();

  function queueDebugTurnWrite(turn: DebugTurnRecord): void {
    let snapshot: DebugTurnRecord;
    try {
      // Pinia 把嵌套对象包成 Proxy，structuredClone 会直接抛 DataCloneError。
      // 调试导出本来就是 JSON 契约，按同一口径取不可变快照最稳妥。
      snapshot = JSON.parse(JSON.stringify(turn)) as DebugTurnRecord;
    } catch (error) {
      console.error('[game-store] 调试历史序列化失败:', error);
      return;
    }
    debugLogWriteQueue = debugLogWriteQueue
      .then(() => saveDebugTurn(snapshot))
      .catch((error) => console.error('[game-store] 调试历史持久化失败:', error));
  }

  async function flushAgentLogWrites(): Promise<void> {
    await debugLogWriteQueue;
  }

  function startAgentLogTurn(input: {
    id: string;
    saveId: string;
    turn: number;
    sourceMessageId?: string;
    startedAt?: number;
  }): void {
    if (!activeSaveId.value || activeSaveId.value !== input.saveId) return;
    const record: DebugTurnRecord = {
      id: input.id,
      saveId: input.saveId,
      turn: input.turn,
      sourceMessageId: input.sourceMessageId,
      status: 'running',
      startedAt: input.startedAt ?? Date.now(),
      entries: [],
    };
    agentLogHistory.value.push(record);
    if (agentLogHistory.value.length > 10) agentLogHistory.value.splice(0, 1);
    queueDebugTurnWrite(record);
  }

  /** 追加或补全一次 Agent 调用；只按 invocationId 更新，不再覆盖同名 Agent 的其他调用。 */
  function addAgentLogEntry(entry: DebugAgentEntry) {
    const turn = agentLogHistory.value.find((candidate) => candidate.id === entry.turnId);
    if (!turn) return;
    const existing = turn.entries.findIndex(
      (e: DebugAgentEntry) => e.invocationId === entry.invocationId,
    );
    if (existing >= 0) {
      turn.entries[existing] = entry;
    } else {
      turn.entries.push(entry);
    }
    queueDebugTurnWrite(turn);
  }

  function finishAgentLogTurn(id: string, status: DebugTurnRecord['status']): void {
    const turn = agentLogHistory.value.find((candidate) => candidate.id === id);
    if (!turn || turn.status !== 'running') return;
    turn.status = status;
    turn.completedAt = Date.now();
    queueDebugTurnWrite(turn);
  }

  /** 兼容手动清空当前回合；不会删除此前回合。 */
  function clearAgentLog() {
    const turn = agentLogHistory.value[agentLogHistory.value.length - 1];
    if (!turn) return;
    turn.entries = [];
    queueDebugTurnWrite(turn);
  }

  /**
   * 工坊 P2 (ADR-30 D5) — EJS 变量差量被体积护栏**整份拒绝**的诊断行。
   *
   * 存在的理由: 拒绝是静默的簿记失灵，只 toast 一次事后就查不到了；杜绝
   * 「状态机不动了，只能从剧情怪异反推」的最坏调试体验。**内存级、随会话丢弃**
   * （不落库、不进备份），随 DebugPanel 的 JSON 导出一起被带走。
   * 与 agentLog 不同，**不随每轮清空** —— 它是整局的累计计数。
   */
  const ejsVarsRejections = ref<
    Array<{ agentId: string; label: string; count: number; lastAt: number; lastSize: number }>
  >([]);

  /** 记一次 EJS 差量拒绝（同来源累加计数、刷新时间戳与体积） */
  function recordEjsVarsRejection(agentId: string, label: string, size: number) {
    const hit = ejsVarsRejections.value.find((r) => r.agentId === agentId);
    if (hit) {
      hit.count += 1;
      hit.lastAt = Date.now();
      hit.lastSize = size;
      return;
    }
    ejsVarsRejections.value.push({ agentId, label, count: 1, lastAt: Date.now(), lastSize: size });
  }

  /**
   * 世界书条目 EJS 求值失败、已回退原文注入的诊断行（工坊 P2 / 能力面 D8）。
   *
   * 存在的理由与 `ejsVarsRejections` 同源：**回退是静默的** —— 条目照常进提示词，
   * 只是没被求值，玩家看到的现象往往是「那段状态面板变成了一堆源码」或者干脆没反应，
   * 而 `console.warn` 没人会去翻。内存级、随会话丢弃、**整局累计不随轮清空**，
   * 随 DebugPanel 的 JSON 导出一起被带走。
   */
  const ejsFallbacks = ref<
    Array<{
      agentId: string;
      uid: number;
      bookName?: string;
      error: string;
      count: number;
      lastAt: number;
    }>
  >([]);

  /** 记一次 EJS 条目回退（同 agent+uid 累加计数） */
  function recordEjsFallback(
    agentId: string,
    entries: Array<{ uid: number; bookName?: string; error: string }>,
  ) {
    for (const e of entries) {
      const hit = ejsFallbacks.value.find((r) => r.agentId === agentId && r.uid === e.uid);
      if (hit) {
        hit.count += 1;
        hit.lastAt = Date.now();
        hit.error = e.error; // 留最近一次的错因（同条目换个错更值得看）
        continue;
      }
      ejsFallbacks.value.push({
        agentId,
        uid: e.uid,
        bookName: e.bookName,
        error: e.error,
        count: 1,
        lastAt: Date.now(),
      });
    }
  }

  /**
   * EJS `ui.log` 的环形缓冲（能力面 §3.11）—— **内容作者自己打的调试输出**。
   *
   * 之前它只活在 `GamePipeline` 的私有字段里，`getEjsDebugLog()` 全仓零调用点：
   * 收集了、没人读。store 这一份是唯一的家，DebugPanel 直接读。
   */
  const ejsUiLog = ref<string[]>([]);
  /** 会话级天花板（在能力面 §3.11 的每 pass 限频之外再加一道） */
  const EJS_UI_LOG_MAX = 512;

  /** 记一行 EJS `ui.log` 输出（超出上限丢最旧的） */
  function recordEjsUiLog(line: string) {
    ejsUiLog.value.push(line);
    if (ejsUiLog.value.length > EJS_UI_LOG_MAX) ejsUiLog.value.shift();
  }

  /**
   * 改写当前存档的 `metadata` 若干键并落库 —— **三个 UI 辅助字段写入口共用这一份**（Q-16）。
   *
   * ADR-21 的受控例外（P1-09）：`metadata` 里这几个是**纯 UI 辅助字段**，允许 UI 层
   * 直写，但必须走统一写入函数 + try/catch，不裸 `db.put`。AI 产生的存档变更仍必须走
   * `vars_update` 语义 op，不在此例外内。此前三个公开函数各写一份同形骨架，
   * 其中两个有并发保护、一个没有 —— 下一个 UI 辅助字段抄到哪份全看运气。
   *
   * 写完同步回内存 `saves`，否则 `activeSave` 仍是旧值，面板会显示成没改动。
   *
   * 🔴 `optimistic` **每个调用点显式给值，刻意没有默认值**：给一条本来没有重入风险的
   * 路径加上乐观写是行为变更而非等价重构（面板会短暂显示一个尚未落库的值）。
   * - `true`：在第一个 await **之前**写内存，用于要挡住「共享 Store 的第二条管线」
   *   重复启动的原子认领；失败时按 `updatedAt` 守卫回滚（期间被别人改过就不回滚，
   *   免得把新值也一起抹掉）。
   * - `false`：落库成功后才写内存，失败什么也不动。
   */
  async function patchSaveMetadataFor(
    saveId: string,
    patch: Record<string, unknown>,
    opts: { optimistic: boolean; failMessage: string },
  ): Promise<boolean> {
    const current = saves.value.find((save: SaveSlot) => save.id === saveId);
    if (!current) return false;

    const idx = saves.value.findIndex((save: SaveSlot) => save.id === current.id);
    if (opts.optimistic && idx < 0) return false;

    const previous = idx >= 0 ? saves.value[idx] : undefined;
    const clean = detach(current);
    clean.metadata = { ...(clean.metadata ?? {}), ...patch };
    clean.updatedAt = Date.now();

    if (opts.optimistic) saves.value[idx] = clean;
    try {
      await saveSaveSlot(clean);
      if (!opts.optimistic && idx >= 0) saves.value[idx] = clean;
      return true;
    } catch (err) {
      if (opts.optimistic && previous && saves.value[idx]?.updatedAt === clean.updatedAt) {
        saves.value[idx] = previous;
      }
      console.error(`[game-store] ${opts.failMessage}:`, err);
      return false;
    }
  }

  async function patchSaveMetadata(
    patch: Record<string, unknown>,
    opts: { optimistic: boolean; failMessage: string },
  ): Promise<boolean> {
    if (!activeSaveId.value) return false;
    return patchSaveMetadataFor(activeSaveId.value, patch, opts);
  }

  /** 改写本存档的世界书条目启用轴（`metadata.enabledWorldBookEntries`） */
  async function setEnabledWorldBookEntries(entries: string[]): Promise<boolean> {
    // 非乐观：这条路径没有重入风险，乐观写只会让面板短暂显示一个尚未落库的启用轴
    return patchSaveMetadata(
      { enabledWorldBookEntries: [...entries] },
      { optimistic: false, failMessage: '写入世界书启用轴失败' },
    );
  }

  /** 从扩展管理页改写指定存档的工坊启用轴，不要求该存档已进入游戏。 */
  async function setSaveEnabledWorldBookEntries(
    saveId: string,
    entries: string[],
  ): Promise<boolean> {
    return patchSaveMetadataFor(
      saveId,
      { enabledWorldBookEntries: [...entries] },
      { optimistic: false, failMessage: '写入指定存档的世界书启用轴失败' },
    );
  }

  /** 在生成开始前原子认领开场 Prompt。 */
  async function markOpeningPromptConsumed(): Promise<boolean> {
    const current = activeSave.value;
    if (!current || current.metadata?.openingPromptConsumed) return false;
    // 乐观：内存要在第一个 await 之前就位，否则共享 Store 的第二条管线会重复启动
    return patchSaveMetadata(
      { openingPromptConsumed: true },
      { optimistic: true, failMessage: '标记开场 Prompt 失败' },
    );
  }

  /**
   * 归还开场 Prompt 认领。
   *
   * 只在「这一轮什么正文都没产出」时用：认领发生在长管线之前，API 一次抽风就会把
   * 开场永久烧掉 —— 玩家拿到一个只有自己那句话、没有任何叙事、也没法重来的存档。
   * 归还之后重挂载会重跑开场；调用方负责保证不会重复插同一条用户消息。
   */
  async function releaseOpeningPromptClaim(saveId = activeSaveId.value): Promise<boolean> {
    if (!saveId) return false;
    const generation = loadGeneration;
    try {
      const restored = await withSaveWriteLock(saveId, async () => {
        const db = getDatabase();
        return db.transaction('rw', db.saves, db.messages, async () => {
          const save = await db.saves.get(saveId);
          if (!save?.metadata?.openingPromptConsumed) return null;
          const narrative = await db.messages
            .where('saveId')
            .equals(saveId)
            .filter((msg) => msg.role === 'assistant')
            .first();
          if (narrative) return null;
          save.metadata.openingPromptConsumed = false;
          save.updatedAt = Date.now();
          await db.saves.put(save);
          return save;
        });
      });
      if (!restored) return false;
      if (generation === loadGeneration && activeSaveId.value === saveId) {
        const index = saves.value.findIndex((save) => save.id === saveId);
        if (index >= 0) saves.value[index] = restored;
      }
      return true;
    } catch (err) {
      console.error('[GameStore] 归还开场 Prompt 认领失败:', err);
      return false;
    }
  }

  // === 选项管理 ===
  /** vars_update 解析出的行动选项 */
  const pendingOptions = ref<string[]>([]);

  /** 设置行动选项（供 GamePipeline 回调使用） */
  function setPendingOptions(options: string[]) {
    pendingOptions.value = options;
  }

  // === 背包聚焦 — 持有物点击 → 打开背包并选中该物品 ===
  const pendingItemFocus = ref<{
    category: 'inventory' | 'equipment' | 'skills';
    itemName: string;
  } | null>(null);

  function focusItem(category: 'inventory' | 'equipment' | 'skills', itemName: string) {
    pendingItemFocus.value = { category, itemName };
    activeModal.value = 'items';
  }
  function clearItemFocus() {
    pendingItemFocus.value = null;
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }
  function showModal(id: string) {
    activeModal.value = id;
  }
  function closeModal() {
    activeModal.value = null;
  }
  function toggleFullscreen() {
    fullscreenStatus.value = !fullscreenStatus.value;
  }

  /** 预览/测试注入：供 Ctrl+Shift+T 直接灌入 characters 与 saveProfile，不绕 IndexedDB。
   *  采用合并语义而非替换，避免覆盖从 IndexedDB 加载的真实存档数据。 */
  function hydratePreview(payload: { characters?: any[]; saveProfile?: any }) {
    if (payload.characters) {
      const existingMap = new Map(characters.value.map((c) => [c.id, c]));
      for (const c of payload.characters) {
        const existing = existingMap.get(c.id);
        if (existing) {
          // 已有角色 → 合并覆盖字段（mock 只带 id/name/race/tier/location/customFields，不会破坏属性/装备/背包）
          Object.assign(existing, c);
        } else if (c.type === 'player') {
          // Mock 玩家：只更新真实玩家的 location，不添加假玩家
          const realPlayer = characters.value.find((rp) => rp.type === 'player');
          if (realPlayer) {
            if (c.location) realPlayer.location = c.location;
            if (c.customFields) {
              realPlayer.customFields = { ...realPlayer.customFields, ...c.customFields };
            }
          }
        } else {
          // 新 NPC → 追加
          characters.value.push(c as CharacterState);
        }
      }
    }
    if (payload.saveProfile) {
      // 浅合并：保留真实 fp/quests 等字段，只覆盖 mock 提供的 gameTime/news/worldFlags
      saveProfile.value = { ...saveProfile.value, ...payload.saveProfile } as SaveProfile;
    }
  }

  // === 消息管理 ===
  let turnCounter = 0;

  /** 持久化单条消息到 IndexedDB */
  async function persistMessage(msg: ChatMessage) {
    if (!activeSaveId.value) {
      // 规范 §10: 消息 saveId 必填；无活跃存档时拒绝写入，避免产生永不召回的孤儿消息 (#13)
      console.error(
        '[game-store] persistMessage 拒绝: activeSaveId 为空，消息未持久化:',
        msg.content.slice(0, 50),
      );
      return;
    }
    try {
      await saveMessage({ ...msg, saveId: activeSaveId.value });
    } catch (err) {
      console.error('[game-store] 消息持久化失败:', err);
    }
  }

  /** 从 IndexedDB 恢复消息到内存（始终覆写，无消息时清空） */
  async function restoreMessages(saveId = activeSaveId.value) {
    if (!saveId || saveId !== activeSaveId.value) return;
    const generation = loadGeneration;
    try {
      const restored = await getMessages(saveId);
      if (generation !== loadGeneration || saveId !== activeSaveId.value) return;
      messages.value = restored;
    } catch (err) {
      console.error('[game-store] 恢复消息失败:', err);
      if (generation === loadGeneration && saveId === activeSaveId.value) messages.value = [];
    }
  }

  /**
   * 追加一条消息，**并把它交回调用方**。
   *
   * 返回值不是装饰：情景插画按 `(saveId, messageId, occurrence)` 反查挂回正文（图像
   * 生成 D2），所以刚产出这条 assistant 消息的那一方必须拿得到它的 `id` 与 `turn`。
   * 从 `messages` 末尾去捞是个会随时被别的写入者破坏的假设。
   */
  function addMessage(content: string, role: 'user' | 'assistant'): ChatMessage {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role,
      content,
      timestamp: Date.now(),
      saveId: activeSaveId.value ?? undefined,
      turn: role === 'user' ? ++turnCounter : turnCounter,
    };
    messages.value.push(msg);
    // 异步持久化（不阻塞 UI）。`void` 是显式的「发射后不管」——
    // persistMessage 自己 try/catch 到底，不会拒绝。
    void persistMessage(msg);
    return msg;
  }

  function addSystemMessage(systemEvent: import('@engine/types').SystemEvent): void {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'system',
      content: systemEvent.narrative,
      timestamp: Date.now(),
      saveId: activeSaveId.value ?? undefined,
      turn: turnCounter,
      systemEvent,
    };
    messages.value.push(msg);
    void persistMessage(msg);
  }

  // === 动作 ===
  async function loadSaves() {
    saves.value = await getSaves();
  }

  async function loadSave(saveId: string): Promise<boolean> {
    clearActive();
    const generation = loadGeneration;
    const projection = await readTimelineProjection(saveId);
    if (generation !== loadGeneration) return false;
    const debugTurns = await getDebugTurns(saveId);
    if (generation !== loadGeneration) return false;

    activeSaveId.value = saveId;
    saves.value = [projection.save];
    characters.value = projection.characters;
    recentMemories.value = projection.memories;
    activePlotEvents.value = projection.plotEvents;
    plotOutline.value = projection.outline;
    saveProfile.value = projection.profile;
    messages.value = projection.messages;
    agentLogHistory.value = debugTurns;
    turnCounter = projection.turn;
    wireEffectSystem(saveId, projection.characters);
    return true;
  }

  async function readTimelineProjection(saveId: string) {
    const [save, chars, mems, events, profile, outline, restoredMessages] = await Promise.all([
      getSave(saveId),
      getCharacters(saveId),
      getMemories(saveId),
      getPlotEvents(saveId),
      getSaveProfile(saveId),
      getLatestPlotOutline(saveId),
      getMessages(saveId),
    ]);
    if (!save) throw new Error(`Save ${saveId} not found after timeline restore`);

    const restoredCharacters = (await normalizePlayerProgression(chars as CharacterState[])) ?? [];
    const lastMessage = restoredMessages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .pop();

    return {
      save,
      characters: restoredCharacters,
      memories: (mems as MemoryRecord[]) ?? [],
      plotEvents: (events as PlotEvent[]) ?? [],
      profile: (profile as SaveProfile) ?? null,
      outline: (outline as PlotOutline) ?? null,
      messages: restoredMessages,
      turn: lastMessage?.turn ?? 0,
    };
  }

  /** 🆕 轻量回读：管线跑完后 StateManager / 侧链直接写了 Dexie，
   *  把 DB 里更新后的 save.metadata / characters / saveProfile 同步回内存。
   *  不动 messages / agentLog / combat 等 UI 态（与 loadSave 的全量重载区分开）。 */
  async function refreshFromDb(saveId = activeSaveId.value) {
    if (!saveId || saveId !== activeSaveId.value) return;
    const generation = loadGeneration;
    try {
      const [save, dbChars, profile, outline, dbPlotEvents] = await Promise.all([
        getSave(saveId),
        getCharacters(saveId), // M6: saveId 索引查询（M1 建索引；侧链 NPC 由 applyAddCharacter 注入 saveId）
        getSaveProfile(saveId),
        getLatestPlotOutline(saveId),
        getPlotEvents(saveId),
      ]);

      if (generation !== loadGeneration || saveId !== activeSaveId.value) return;
      await normalizePlayerProgression(dbChars as CharacterState[]);
      if (generation !== loadGeneration || saveId !== activeSaveId.value) return;

      // 1. save.metadata（totalTurns / openingPromptConsumed 等）
      if (save) {
        const idx = saves.value.findIndex((s: SaveSlot) => s.id === save.id);
        if (idx >= 0) saves.value[idx] = save;
        else saves.value.push(save);
      }

      // 2. characters：合并语义 —— DB 版本覆盖同 id 内存版本（拿到最新背包/装备/资源），
      //    DB 里属于本存档但内存没有的角色追加（查询已按 saveId 索引预过滤）；内存独有的（预览注入等）保留。
      //    先做旧档经验保底归一化（就地改 + 有变化落库），这样合并进内存的也是归一化后的数。
      const dbById = new Map((dbChars as CharacterState[]).map((c) => [c.id, c]));
      characters.value = characters.value.map((c) => dbById.get(c.id) ?? c);
      const memIds = new Set(characters.value.map((c) => c.id));
      for (const c of dbChars as CharacterState[]) {
        if (!memIds.has(c.id)) {
          characters.value.push(c);
        }
      }

      // 3. saveProfile（gameTime / fp / quests / news）
      if (profile) saveProfile.value = profile as SaveProfile;

      // 4. 剧情大纲 + 事件回读（post_check 落库后 PlotPanel 需要最新态）
      if (outline) plotOutline.value = outline as PlotOutline;
      if (dbPlotEvents) activePlotEvents.value = dbPlotEvents as PlotEvent[];
    } catch (err) {
      console.error('[game-store] refreshFromDb 失败:', err);
    }
  }

  function clearSessionRuntime() {
    clearAllAgentStatus();
    isGenerating.value = false;
    characters.value = [];
    messages.value = [];
    recentMemories.value = [];
    activePlotEvents.value = [];
    plotOutline.value = null;
    saveProfile.value = null;
    pendingInput.value = '';
    pendingOptions.value = [];
    pendingItemFocus.value = null;
    activeModal.value = null;
    ejsVarsRejections.value = [];
    ejsFallbacks.value = [];
    ejsUiLog.value = [];
    turnCounter = 0;
  }

  function clearActive() {
    if (activeSaveId.value) unwireEffectSystem(activeSaveId.value);
    invalidatePendingLoads();
    clearSessionRuntime();
    agentLogHistory.value = [];
    activeSaveId.value = null;
  }

  async function restoreTimeline(snapshotId: string): Promise<TimelineRestoreResult> {
    const saveId = activeSaveId.value;
    if (!saveId) return { status: 'rejected', error: '无活跃存档' };
    if (isGenerating.value) return { status: 'rejected', error: '生成进行中，无法恢复' };
    if (isInCombat.value) return { status: 'rejected', error: '战斗进行中，无法恢复' };

    isGenerating.value = true;
    let authorityRestored = false;
    try {
      const result = await createStateManager(saveId).restoreSnapshot(snapshotId);
      if (!result.success) {
        return { status: 'rejected', error: result.errors.join('; ') || '恢复快照失败' };
      }
      authorityRestored = true;

      invalidatePromptSession(saveId);
      unwireEffectSystem(saveId);

      if (activeSaveId.value !== saveId) {
        return {
          status: 'restored',
          continuation: 'save-switched',
          warning: '时间线已恢复；当前已切换到其他存档',
        };
      }

      const projection = await readTimelineProjection(saveId);
      if (activeSaveId.value !== saveId) {
        return {
          status: 'restored',
          continuation: 'save-switched',
          warning: '时间线已恢复；当前已切换到其他存档',
        };
      }

      clearSessionRuntime();
      activeSaveId.value = saveId;
      saves.value = [projection.save];
      characters.value = projection.characters;
      recentMemories.value = projection.memories;
      activePlotEvents.value = projection.plotEvents;
      saveProfile.value = projection.profile;
      plotOutline.value = projection.outline;
      messages.value = projection.messages;
      turnCounter = projection.turn;
      wireEffectSystem(saveId, projection.characters);

      return { status: 'restored', continuation: 'same-save' };
    } catch (err) {
      if (!authorityRestored) {
        console.error('[game-store] 时间线恢复失败:', err);
        return {
          status: 'rejected',
          error: err instanceof Error ? err.message : '恢复快照失败',
        };
      }

      console.error('[game-store] 时间线恢复后的投影重载失败:', err);
      try {
        unwireEffectSystem(saveId);
      } catch (cleanupError) {
        console.error('[game-store] 清理失败的效果接线时出错:', cleanupError);
      }
      if (activeSaveId.value === saveId) clearActive();
      return {
        status: 'projection-failed',
        error: '时间线已恢复，但界面重载失败，请重新进入存档',
      };
    } finally {
      if (activeSaveId.value === saveId) isGenerating.value = false;
    }
  }

  /**
   * 花掉 1 点自由属性点（玩家在状态总览里点「+」）。
   *
   * 本层只做「谁」的解析与回读：校验（有没有点 / 到没到层级上限）与落库全在引擎的
   * `allocateAttributePoint` 里（ADR-11 数值规则归 Code、ADR-21 写入走 StateManager）。
   * 成功后走 `refreshFromDb()` —— 引擎直写 Dexie，不回读的话面板上的属性与剩余点数
   * 都还是旧值，玩家会以为点了没反应。
   *
   * 失败原因原样交回调用方（组件转 toast），本层不自己弹提示。
   */
  async function allocateAttrPoint(
    attr: AllocatableAttr,
  ): Promise<{ ok: boolean; error?: string }> {
    const saveId = activeSaveId.value;
    if (!saveId) return { ok: false, error: '无活跃存档' };
    const p = player.value;
    if (!p) return { ok: false, error: '找不到主角' };

    try {
      const result = await allocateAttributePoint(saveId, p.name, attr);
      if (result.ok) await refreshFromDb();
      return result;
    } catch (err) {
      console.error('[game-store] 分配自由属性点失败:', err);
      return { ok: false, error: '属性点分配失败' };
    }
  }

  /**
   * 玩家主动修订当前存档的叙事人设。
   *
   * 引擎负责锁内重读与窄字段落库；本层只做运行态守卫，并在成功后接入引擎返回的
   * 权威角色。这里不失效 prompt session —— 下一次组装会用现有投影产生最小 Delta。
   */
  async function updatePlayerPersona(
    draft: PlayerPersonaDraft,
  ): Promise<PlayerPersonaUpdateResult> {
    const saveId = activeSaveId.value;
    if (!saveId) return { ok: false, error: '无活跃存档' };
    if (!player.value) return { ok: false, error: '找不到主角' };
    if (isGenerating.value) {
      return { ok: false, error: '当前回合生成中，暂时无法编辑人设' };
    }
    if (isInCombat.value) return { ok: false, error: '战斗结束后才能编辑人设' };

    try {
      const result = await createStateManager(saveId).updatePlayerPersona(draft);
      if (!result.ok || activeSaveId.value !== saveId) return result;

      const index = characters.value.findIndex((char) => char.id === result.character.id);
      if (index >= 0) characters.value.splice(index, 1, result.character);
      if (result.changed) saves.value = await getSaves();
      return result;
    } catch (error) {
      console.error('[game-store] 玩家人设保存失败:', error);
      return { ok: false, error: '人设保存失败，请重试' };
    }
  }

  // === 快照回退 (快照面板 + 右键回退重发) ===

  /** 右键「回退」：撤回当前回合 → 恢复上一轮快照 + 把这轮玩家输入回填输入框。
   *  回退后原样发送 = 重新生成；编辑后发送 = 编辑重发。
   *  不可回退（最早回合/生成中/战斗中/无存档/无快照）时返回 rejected。 */
  async function rollbackOneTurn(): Promise<TimelineRestoreResult> {
    if (!activeSaveId.value) return { status: 'rejected', error: '无活跃存档' };
    if (isGenerating.value) return { status: 'rejected', error: '生成进行中，无法回退' };
    if (isInCombat.value) return { status: 'rejected', error: '战斗进行中，无法回退' };

    // 当前回合 = 最新一条 user 消息（删除前先捕获其输入）
    const userMsgs = messages.value.filter((m) => m.role === 'user');
    const currentUserMsg = userMsgs[userMsgs.length - 1];
    if (!currentUserMsg) return { status: 'rejected', error: '已是最早回合，无可回退' };
    const currentTurn = currentUserMsg.turn ?? 0;
    const capturedInput = currentUserMsg.content;

    // 找上一轮快照（turn <= currentTurn-1 中最新者；快照 turn = 已完成回合数）
    const prevTargetTurn = currentTurn - 1;
    if (prevTargetTurn < 1) return { status: 'rejected', error: '已是最早回合，无可回退' };
    const snapshots = await getSnapshots(activeSaveId.value);
    const prevSnapshot = snapshots
      .filter((s) => s.turn <= prevTargetTurn)
      .sort((a, b) => b.turn - a.turn)[0];
    if (!prevSnapshot) return { status: 'rejected', error: '找不到上一轮快照' };

    const result = await restoreTimeline(prevSnapshot.id);
    if (result.status === 'restored' && result.continuation === 'same-save') {
      fillInput(capturedInput);
    }
    return result;
  }

  /** 快照面板「恢复」：恢复到指定历史快照（不回填输入，从该点继续游戏）。 */
  async function restoreToSnapshot(snapshotId: string): Promise<TimelineRestoreResult> {
    return restoreTimeline(snapshotId);
  }

  // === 玩家主动删除（物品/装备/技能/角色）—— 用户可自由清理持有物 ===

  /**
   * 丢弃/删除一件物品（含装备）。经 commitChatState 走 remove_item op，
   * 数量扣到 0 自动移除条目。改名/装备进背包等关联由引擎处理。
   */
  async function removeItem(
    itemName: string,
    quantity = 1,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!activeSaveId.value) return { ok: false, error: '无活跃存档' };
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'remove_item',
        target: `characters.${player.value?.name ?? ''}`,
        value: { name: itemName, quantity },
      },
    ]);
    if (result.success) await refreshFromDb();
    return result.success ? { ok: true } : { ok: false, error: result.errors.join('; ') };
  }

  /** 删除一个技能（按名）。 */
  async function removeSkill(skillName: string): Promise<{ ok: boolean; error?: string }> {
    if (!activeSaveId.value) return { ok: false, error: '无活跃存档' };
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'remove_skill',
        target: `characters.${player.value?.name ?? ''}`,
        value: { name: skillName },
      },
    ]);
    if (result.success) await refreshFromDb();
    return result.success ? { ok: true } : { ok: false, error: result.errors.join('; ') };
  }

  /**
   * 卡册唯一写入口（卡牌工坊 MVP）：整份 CardAlbumState 经 update_character 落库。
   * 规则校验（同名≤2 / 容量）在引擎 card-workshop/album.ts，UI 先过纯函数再交这里；
   * 这里不做规则判断，只负责「提交 → 回读」。
   */
  async function updateCardAlbum(album: CardAlbumState): Promise<{ ok: boolean; error?: string }> {
    if (!activeSaveId.value) return { ok: false, error: '无活跃存档' };
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'update_character',
        target: `characters.${player.value?.name ?? ''}`,
        // 🔴 真机 DataCloneError：面板传来的 album 携带 Pinia 响应式数组（Proxy），
        // IDB 结构化克隆拒收——落库前深净化成普通数组
        value: { cardAlbum: toPlainCardAlbum(album) },
      },
    ]);
    if (result.success) await refreshFromDb();
    return result.success ? { ok: true } : { ok: false, error: result.errors.join('; ') };
  }

  /**
   * 声望兑换天赋（卡牌工坊 切片 T-S2b）：查兑换目录 → 同名唯一/容量/互斥由
   * state-manager 门禁终审 → 声望扣费（delta_variable profile.reputation，
   * source='talent-exchange'）+ 天赋列表追加，同一次 commitChatState 原子提交。
   */
  async function exchangeTalent(talentName: string): Promise<{ ok: boolean; reason?: string }> {
    if (!activeSaveId.value) return { ok: false, reason: '无活跃存档' };
    const playerChar = player.value;
    if (!playerChar) return { ok: false, reason: '无玩家角色' };
    const template = getExchangeCatalog().find((t) => t.name === talentName);
    if (!template) return { ok: false, reason: '兑换清单里没有这个天赋' };
    const profile = saveProfile.value;
    const reputation = profile ? getTalentReputation(profile) : 0;
    const price = talentExchangePrice(template);
    if (reputation < price) {
      return { ok: false, reason: `声望不足（需要 ${price}，当前 ${reputation}）` };
    }
    const current = playerChar.talents ?? { capacity: 3, list: [] };
    if (current.list.some((t) => t.name === template.name)) {
      return { ok: false, reason: '同名天赋不可重复习得' };
    }
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'update_character',
        target: `characters.${playerChar.name}`,
        value: {
          talents: {
            capacity: current.capacity ?? 3,
            list: [
              ...current.list.map((t) => ({ ...t })),
              {
                name: template.name,
                description: template.description,
                source: 'exchange' as const,
                entries: template.entries.map((e) => ({ ...e })),
              },
            ],
          },
        },
      },
      {
        op: 'delta_variable',
        target: 'profile.reputation',
        amount: -price,
        metadata: { source: 'talent-exchange' },
      },
    ]);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };
    await refreshFromDb();
    return { ok: true };
  }

  /** 遗忘天赋（T-S3）：腾出容量位，无返还（二次确认由面板负责）。 */
  async function forgetTalent(talentName: string): Promise<{ ok: boolean; reason?: string }> {
    if (!activeSaveId.value) return { ok: false, reason: '无活跃存档' };
    const playerChar = player.value;
    const current = playerChar?.talents;
    if (!playerChar || !current) return { ok: false, reason: '无玩家角色' };
    if (!current.list.some((t) => t.name === talentName)) {
      return { ok: false, reason: `没有天赋【${talentName}】` };
    }
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'update_character',
        target: `characters.${playerChar.name}`,
        value: {
          talents: {
            capacity: current.capacity,
            list: current.list.filter((t) => t.name !== talentName),
          },
        },
      },
    ]);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };
    await refreshFromDb();
    return { ok: true };
  }

  /**
   * 天赋融合（T-S3 融合工作台）：两源天赋条目化学反应（fuseEntrySets：品质保底+
   * 上限对消成品质突破，其余叠加去重、互斥过滤）→ 产物占用 1 格。
   * 名字/描述由面板提供（T8-② 裁定：AI 起名为主、玩家自填兜底）；提交带
   * metadata source='talent-fusion'，写入门禁据此放行品质突破条目。
   */
  async function fuseTalents(
    sourceAName: string,
    sourceBName: string,
    productName: string,
    productDescription?: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!activeSaveId.value) return { ok: false, reason: '无活跃存档' };
    const playerChar = player.value;
    const current = playerChar?.talents;
    if (!playerChar || !current) return { ok: false, reason: '无玩家角色' };
    if (sourceAName === sourceBName) return { ok: false, reason: '不能拿同一个天赋融合自己' };
    const a = current.list.find((t) => t.name === sourceAName);
    const b = current.list.find((t) => t.name === sourceBName);
    if (!a || !b) return { ok: false, reason: '源天赋不存在' };
    const name = productName.trim();
    if (!name) return { ok: false, reason: '融合产物需要一个名字' };
    const mergedEntries = fuseEntrySets(a.entries, b.entries);
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      {
        op: 'update_character',
        target: `characters.${playerChar.name}`,
        value: {
          talents: {
            capacity: current.capacity,
            list: [
              ...current.list.filter((t) => t.name !== sourceAName && t.name !== sourceBName),
              {
                name,
                ...(productDescription?.trim() ? { description: productDescription.trim() } : {}),
                source: 'fusion' as const,
                entries: mergedEntries,
              },
            ],
          },
        },
        metadata: { source: 'talent-fusion' },
      },
    ]);
    if (!result.success) return { ok: false, reason: result.errors.join('; ') };
    await refreshFromDb();
    return { ok: true };
  }

  /** 融合起名缝（game-pipeline 注入；T8-② 裁定 B：AI 起名为主，玩家自填兜底） */
  let fuseNamingImpl:
    | ((
        sourceA: string,
        sourceB: string,
        entryLines: string[],
      ) => Promise<{ name: string; description: string }>)
    | null = null;
  function setFuseNamingImpl(
    impl: (
      sourceA: string,
      sourceB: string,
      entryLines: string[],
    ) => Promise<{ name: string; description: string }>,
  ): void {
    fuseNamingImpl = impl;
  }
  async function requestFusionNaming(
    sourceA: string,
    sourceB: string,
    entryLines: string[],
  ): Promise<{ ok: boolean; name?: string; description?: string; reason?: string }> {
    if (!fuseNamingImpl) return { ok: false, reason: 'AI 起名未接入' };
    try {
      const r = await fuseNamingImpl(sourceA, sourceB, entryLines);
      return { ok: true, name: r.name, description: r.description };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * 单条目重铸（2026-08-24）：把某角色的一条技能/装备/物品交给 item_gen 重写。
   *
   * 🔴 实现走注入缝（GamePipeline.rewriteLoadoutItem），store 不直接碰引擎装配；
   *    成功即 refreshFromDb 回读最新 characters（含替换后的条目），面板随之刷新。
   *    存档安全：remove 旧 + add 新同一次 commitChatState（原子），玩家可用快照回退。
   */
  async function rewriteLoadoutItem(
    characterId: string,
    target: RewriteTarget,
    userDescription = '',
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!activeSaveId.value) return { ok: false, reason: '无活跃存档' };
    if (!rewriteLoadoutImpl) return { ok: false, reason: '游戏管线未就绪' };
    const result = await rewriteLoadoutImpl(characterId, target, userDescription);
    if (result.ok) await refreshFromDb();
    return result;
  }

  /**
   * 手动落位：把玩家的位置路径改成某个地块名（势力地图「设为当前位置」唯一写入口）。
   *
   * 🔴 **只提交一条 `set_location`，绝不自己写 `worldFlags.map`**：地块是位置路径的
   *    **投影**（ADR-31 / 裁定 §12-1），而那次投影由 `applySetLocation` 里的
   *    `syncMapLocation` 钩子在**位置路径落库之后**做（含 packStamp 自愈与「只跟玩家」
   *    那两条）。在这里顺手补一份 `lastTileId` 是很诱人的 —— 那等于开第二条写路径，
   *    写的还是一个没有 patch 背书的派生态：换包自愈、快照回退都会与它打架，且不报错。
   * 🔴 值是**地块名**不是 id：AI 与存档里的位置一律按名字说话（§8.3），
   *    落位再经 `placeBindings` 解回地块 —— 这也是一次地图点击**诚实的粒度**。
   */
  async function setPlayerLocation(tileName: string): Promise<{ ok: boolean; error?: string }> {
    if (!activeSaveId.value) return { ok: false, error: '无活跃存档' };
    const name = typeof tileName === 'string' ? tileName.trim() : '';
    if (name.length === 0) return { ok: false, error: '地块名为空' };
    const playerName = player.value?.name ?? '';
    if (playerName.length === 0) return { ok: false, error: '没有玩家角色' };

    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      { op: 'set_location', target: `characters.${playerName}`, value: name },
    ]);
    // 回读是必须的：`saveProfile` 里的落位投影由引擎钩子写，不刷新则地图上的棋子不动
    if (result.success) await refreshFromDb();
    return result.success ? { ok: true } : { ok: false, error: result.errors.join('; ') };
  }

  /**
   * 删除一个角色（按名）。用于清理龙套/NPC。
   * 🔴 只删角色行本身，不清理记忆/剧情关联（用户意图是删龙套，非清除叙事痕迹）。
   * 🔴 成功后**整表替换**内存角色：refreshFromDb 是合并语义，删掉的角色不会从内存消失。
   */
  async function removeCharacter(characterName: string): Promise<{ ok: boolean; error?: string }> {
    if (!activeSaveId.value) return { ok: false, error: '无活跃存档' };
    if (player.value?.name === characterName) return { ok: false, error: '不能删除玩家角色' };
    const sm = createStateManager(activeSaveId.value);
    const result = await sm.commitChatState([
      { op: 'remove_character', target: `characters.${characterName}` },
    ]);
    if (result.success) {
      characters.value = (await getCharacters(activeSaveId.value)) as CharacterState[];
    }
    return result.success ? { ok: true } : { ok: false, error: result.errors.join('; ') };
  }

  /** 当前存档的叙事意图（天赋面板展示用；只读投影）。 */
  const narrativeIntents = computed(() =>
    getNarrativeIntents(saveProfile.value ?? ({} as SaveProfile)),
  );

  /** 撤回某天赋的叙事意图。 */
  async function clearNarrativeIntent(talent: string): Promise<{ ok: boolean; reason?: string }> {
    if (!activeSaveId.value) return { ok: false, reason: '无活跃存档' };
    try {
      const fresh = await clearNarrativeIntentInDb(activeSaveId.value, talent);
      saveProfile.value = fresh;
      return { ok: true };
    } catch (err) {
      console.warn('[GameStore] 撤回叙事意图失败:', err);
      return { ok: false, reason: '落库失败' };
    }
  }

  /**
   * 叙事意图（2026-09-17 纯记不向路线）：玩家在世界规则干预/制卡结果操控/
   * 禁忌炼金等纯叙事 SSS 天赋下声明的「只记不向」指令，落到 SaveProfile.narrativeIntents。
   * AI 下一拍生成看到 {{NARRATIVE_INTENTS}} 注入，**不作数值反哺**。
   */
  async function declareNarrativeIntent(input: {
    talent: string;
    text: string;
  }): Promise<{ ok: boolean; reason?: string }> {
    if (!activeSaveId.value || !saveProfile.value) {
      return { ok: false, reason: '无活跃存档' };
    }
    const atMinutes = toEpochMinutes(saveProfile.value.gameTime);
    try {
      const fresh = await setNarrativeIntent(activeSaveId.value, {
        atMinutes,
        from: 'player',
        talent: input.talent,
        text: input.text,
      });
      saveProfile.value = fresh;
      return { ok: true };
    } catch (err) {
      console.warn('[GameStore] 叙事意图落库失败（不影响本回合正文）:', err);
      return { ok: false, reason: '落库失败' };
    }
  }

  /**
   * 调试面板「下回合触发」：把一条随机事件按 forced 塞进候选池（开发者模式专用）。
   *
   * 校验与落库全在引擎的 `devForceArmRandomEvent`（ADR-21 唯一写入口）；本层只解析「谁」
   * 并回读 —— 不回读的话调试面板上那条「在池」标记要等下一次时间推进才亮，
   * 而这个按钮的全部价值就是**立刻**看到它进池了。
   */
  async function devArmRandomEvent(name: string): Promise<{ ok: boolean; error?: string }> {
    if (!activeSaveId.value) return { ok: false, error: '无活跃存档' };
    try {
      const sm = createStateManager(activeSaveId.value);
      const result = await sm.devForceArmRandomEvent(name);
      if (result.ok) await refreshFromDb();
      return result;
    } catch (err) {
      console.error('[game-store] 随机事件调试入池失败:', err);
      return { ok: false, error: '调试入池失败' };
    }
  }

  return {
    saves,
    activeSaveId,
    activeSave,
    characters,
    player,
    npcs,
    messages,
    isGenerating,
    recentMemories,
    activePlotEvents,
    plotOutline,
    repairCard,
    quenchCard,
    drawFortune,
    devourCard,
    smeltCards,
    contractCard,
    dismantleItem,
    craftCard,
    ensureSoulWeapon,
    upgradeMaterial,
    exchangeItem,
    drawMaterialTen,
    footAlchemy,
    skillBlueprints,
    redeemFaceSlap,
    faceSlapPoints,
    currentNemesis,
    knownTrueNames,
    trainCompanion,
    setPendingRewind,
    pendingRewind,
    misfortuneLayers,
    makeSpirit,
    behindSpirits,
    bindTwins,
    twinBonds,
    declareDuel,
    sacrificeSummon,
    speakTrueName,
    hotSwapModule,
    rollFortuneDice,
    ownedDiceTables,
    scarCount,
    setPendingScar,
    pendingScar,
    dailyRemaining,
    fuseCards,
    hasMechanicGate,
    seedDemoCards,
    skirmishSession,
    isInCombat,
    skirmishBusy,
    setSkirmishSession,
    setSkirmishBusy,
    setSkirmishController,
    startSkirmish,
    submitSkirmishCounter,
    fleeSkirmish,
    triggerSkirmishNuke,
    deliverCommission,
    eventCommissions,
    exchangeTalent,
    forgetTalent,
    fuseTalents,
    declareNarrativeIntent,
    narrativeIntents,
    extractEmotion,
    abyssContract,
    reshapeCard,
    captureEnemy,
    breedCompanions,
    corruptCompanion,
    stripEntry,
    designateFinalWeapon,
    bondTribute,
    enthroneCard,
    clearNarrativeIntent,
    setFuseNamingImpl,
    requestFusionNaming,
    getCommissionDefs,
    saveProfile,
    fp,
    gameTime,
    experienceMode,
    news,
    getThoughts,
    sidebarCollapsed,
    activeModal,
    fullscreenStatus,
    toggleSidebar,
    showModal,
    closeModal,
    toggleFullscreen,
    hydratePreview,
    addMessage,
    addSystemMessage,
    loadSaves,
    loadSave,
    invalidatePendingLoads,
    refreshFromDb,
    clearActive,
    pendingInput,
    fillInput,
    clearPendingInput,
    hasOpeningPromptConsumed,
    openingPrompt,
    markOpeningPromptConsumed,
    releaseOpeningPromptClaim,
    setEnabledWorldBookEntries,
    setSaveEnabledWorldBookEntries,
    pendingOptions,
    setPendingOptions,
    pendingItemFocus,
    focusItem,
    clearItemFocus,
    agentActivityRuns,
    currentAgentActivityRun,
    startAgentActivityRun,
    finishAgentActivityRun,
    markAgentActivityStopping,
    recordAgentToolActivity,
    updateAgentStatus,
    clearAgentStatus,
    clearAllAgentStatus,
    agentLog,
    agentLogHistory,
    startAgentLogTurn,
    addAgentLogEntry,
    finishAgentLogTurn,
    flushAgentLogWrites,
    clearAgentLog,
    ejsVarsRejections,
    recordEjsVarsRejection,
    ejsFallbacks,
    recordEjsFallback,
    ejsUiLog,
    recordEjsUiLog,
    persistMessage,
    restoreMessages,
    allocateAttrPoint,
    updatePlayerPersona,
    rollbackOneTurn,
    restoreToSnapshot,
    removeItem,
    removeSkill,
    updateCardAlbum,
    removeCharacter,
    setPlayerLocation,
    rewriteLoadoutItem,
    devArmRandomEvent,
  };
});
