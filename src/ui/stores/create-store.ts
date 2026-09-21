/**
 * 捏人页 Store — 角色创建状态管理
 *
 * 数据来源:
 * - start-catalog-mechanics.ts — 难度档位/性别枚举 + 目录 schema 与纯函数（**引擎**，D24）
 * - 内容注册表 `catalog` 面 — 背景/种族费用/身份费用/起始地树（**内容**，D24；命定核心已下线）
 * - 内容注册表 `bloodlines` 面 — 血脉集（D25②，经 `getBloodlineSet()` 读）
 * - 内容注册表 `branding` 面 — 纪元名（D9，存档创建时盖章）
 * - tier-constants.ts — 7 层级 HP/MP/SP 乘数
 * - custom_start_index.html — BP/AP/消耗计算 原版逻辑
 *
 * 🔴 **内容三面是异步加载的**（D16/D24）：`initContent()` 是本 store 的加载门，
 * 捏人页在挂载时 await 它。加载完成前所有目录派生的 computed 都是空列表 ——
 * 组件必须看 `contentStatus` 决定画加载态/空态，而不是把空列表当成「没有内容」。
 */

import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type {
  CharacterState,
  CreatePreset,
  PlotSettings,
  PlotOutline,
  SaveSlot,
  ApiEndpoint,
  AgentConfig,
  ExperienceMode,
  CardItem,
} from '@engine/types';
import { calcResources } from '@engine/tier-constants';
// 🆕 经验系统改造 v1：创建角色时 totalExp/expToNext 用累计表语义（旧 expCap 已退役）
import { getRequiredXpForLevel, xpToNextNumber } from '@engine/exp-table';
// Q-05：从模型输出抢救 JSON 的唯一入口
import { extractJsonPayload } from '@engine/model-json';
import { getBloodlineList, getBloodlineSet, type BloodlineSet } from '@engine/bloodlines';
import { AgentClient } from '@engine/agent-client';
import {
  tryParseOutline,
  outlineToEvents,
  createOutlineFromAgent,
  type ParsedOutlineOutput,
} from '@engine/plot-outline';
import type { AgentContext } from '@engine/types';
import { createDefaultTime, formatGameTime, GAME_EPOCH_YEAR } from '@engine/time-system';
import {
  getCreationCatalog,
  getDrawableCatalog,
  talentExchangePrice,
  type TalentTemplate,
} from '@engine/card-workshop/talent-entry';
// 购卡池唯一口径：内容仓 cardPool + 运行时自定义卡（2026-09-18 开发者模式接线）
import { getCustomCards, mergeCards } from '@engine/card-workshop/custom-content';
import { useSettingsStore } from './settings-store';
import {
  type CatalogData,
  type CardCatalogItem,
  type CardFormEntry,
  type DifficultyPreset,
  type BackgroundCategory,
  GENDER_OPTIONS,
  ATTRIBUTE_NAMES,
  ATTR_CN_TO_EN,
  STARTER_CARDS,
  cardCatalogToItem,
  parseCatalogData,
  isCatalogPopulated,
  findDifficultyPreset,
  lookupCost,
  costTableOptions,
  CUSTOM_OPTION_KEY,
  flattenLocationTree,
  filterBackgroundsByCategory,
  countBackgroundsByCategory,
} from '@engine/start-catalog';
import { ensureContentRegistryLoaded, getContentRegistry } from './content-store';
import { getBranding } from '../branding-defaults';
import { loadWorldBooksWithFallback } from '@engine/builtin-worldbooks';
import { useWorldBookStore } from './worldbook-store';
import { getAgentSettings } from './agent-settings';
// 🆕 F10（2026-09-04）：plot_outline 端点解析与 game-pipeline 走同一个 fail-closed 解析器
import { resolveAgentEndpoint } from '../lib/endpoint-resolver';
import type { WorldBook } from '@engine/types';

// ===== 类型 =====

/**
 * 捏人预设 —— 定义已迁到 `@engine/types`（分层收口）。
 *
 * 它是 Dexie `createPresets` 表的落库形状，`database.ts` 要拿它标 `CreatePresetRecord.data`；
 * 留在本 store 里就只能让引擎反向 `import type ... from '../ui/stores/create-store'`。
 * 这里 re-export 同一个名字，`PresetModal.vue` 等既有消费方的 import 路径一字未改。
 */
export type { CreatePreset } from '@engine/types';

// ===== 原版常量 (custom_start_index.html) =====
const MAX_BP = 25;
const BP_PER_ATTR_MAX = 6;

function getTier(level: number): number {
  if (level <= 4) return 1;
  if (level <= 8) return 2;
  if (level <= 12) return 3;
  if (level <= 16) return 4;
  if (level <= 20) return 5;
  if (level <= 24) return 6;
  return 7;
}

const TIER_NAMES = ['普通', '中坚', '精英', '史诗', '传说', '神话', '神祗'];

// ===== Store =====

export const useCreateStore = defineStore('create', () => {
  // ═══════════════════════════════════════════════════════
  // 步骤控制
  // ═══════════════════════════════════════════════════════
  const currentStep = ref(0);

  const stepValid = computed<Record<number, boolean>>(() => ({
    0: difficulty.value !== null,
    1: name.value.trim().length > 0 && race.value !== '' && attributesFullyAllocated.value,
    2: selectedCreationTalent.value !== null, // 出身天赋（7 选 1 必选；第 3 步，供剧情规划参照）
    3: true, // 装备选择
    4: true, // 剧情规划
  }));

  function nextStep() {
    if (currentStep.value < 4 && stepValid.value[currentStep.value]) currentStep.value++;
  }
  function prevStep() {
    if (currentStep.value > 0) currentStep.value--;
  }

  // ═══════════════════════════════════════════════════════
  // 内容加载门（D16/D24）—— 捏人页整页的前置
  // ═══════════════════════════════════════════════════════

  /**
   * 目录内容态。组件按它画加载态/空态。
   *
   * - `idle` 还没有人 await 过 `initContent()`
   * - `loading` 首轮加载在飞
   * - `ready` 注册表给出了非空目录
   * - `empty` 注册表就绪但目录是空的（内容缺席 / JSON 坏了 / fetch 失败）
   *
   * 🔴 `empty` **不是异常**，是「这台机器上没有内容」。捏人页要画空态而不是崩 ——
   * 注册表的逐面加载器本身永不抛（失败面保持原值），所以「加载失败」在这里
   * 与「内容确实为空」不可区分，也不必区分。
   */
  /**
   * 当前目录内容（注册表 `catalog` 面的收窄结果）。
   *
   * 🔴 **必须是 ref 而不是直接读 `getContentRegistry()`**：注册表是模块级普通变量、
   * 不带响应式，computed 里直接读它会在首次求值后永久缓存住空目录 —— 表现是
   * 内容加载完了但捏人页还是空的。装包重灌注册表时同理，靠 `initContent(true)` 重取。
   *
   * 🔴 构造时**同步**取一次：boot 链（`loadProjectDefaults`）已经灌过注册表，
   * 于是常态下 store 一建好就有内容，加载门只在冷路径（直接进捏人页 URL / 装包后）
   * 才真的等。少了这一步，每次进页面都会先闪一帧空列表。
   */
  const catalog = ref<CatalogData>(parseCatalogData(getContentRegistry().catalog));

  /** 当前血脉集（注册表 `bloodlines` 面，D25②）——同样为了响应式才落 ref */
  const bloodlineSet = ref<BloodlineSet>(getBloodlineSet());

  /**
   * 纪元名（注册表 `branding` 面，D9）。
   *
   * 🔴 引擎里**没有**具体纪元名（`time-system` 的缺省是中性空串）。真值由内容侧供给，
   * 内容缺席时落 `NEUTRAL_BRANDING.era`（中性名，不是 IP 纪元名）。
   * 存档创建时它被盖章进 `SaveProfile.gameTime.era`，此后只读存档（D9）。
   *
   * 🔴 解析走 `branding-defaults` 的 `getBranding()`（品牌面**唯一**解析处，D26），
   * 不在这里另写一个「读 raw.era」—— 两个解析器就是漂移的来路。
   */
  const era = ref(getBranding().era);

  const contentStatus = ref<'idle' | 'loading' | 'ready' | 'empty'>(
    isCatalogPopulated(catalog.value) ? 'ready' : 'idle',
  );

  /** 首轮加载的 memo（幂等闸）；`initContent(true)` 清掉它重取 */
  let contentPromise: Promise<void> | null = null;

  /**
   * 自定义内容版本号（2026-09-18）。
   *
   * 🔴 自定义天赋/卡的注册表是**模块级普通 Map**（引擎层不引 Vue），它的变化不会
   *    触发 computed —— 而 store 是常驻的，`cardPool` 会一直缓存第一次算出的结果。
   *    进页面（`initContent`）时自增一次，等于"重新读一遍注册表"。
   */
  const customContentVersion = ref(0);

  /**
   * 捏人页的内容加载门（幂等、**永不抛**）。
   *
   * 组件在 `onMounted` 里 `await store.initContent()`；重复调用零 I/O。
   * 注册表自身的 fetch 已经逐面兜底并上报 `contentStatus`（content-store），
   * 这里只负责把它的结果搬进响应式 ref 并给出四态。
   *
   * @param force 装包/卸载后重取（跳过 memo）
   */
  function initContent(force = false): Promise<void> {
    if (force) contentPromise = null;
    if (contentPromise) return contentPromise;
    // 已经同步拿到内容就不画加载态（否则每次进页面都闪一下「正在加载」）
    if (contentStatus.value !== 'ready') contentStatus.value = 'loading';
    contentPromise = (async () => {
      try {
        await ensureContentRegistryLoaded();
      } catch {
        /* ensureContentRegistryLoaded 自己就永不抛；这里只兜最外层意外 */
      }
      const reg = getContentRegistry();
      catalog.value = parseCatalogData(reg.catalog);
      bloodlineSet.value = getBloodlineSet();
      era.value = getBranding().era;
      customContentVersion.value += 1;
      contentStatus.value = isCatalogPopulated(catalog.value) ? 'ready' : 'empty';
    })();
    return contentPromise;
  }

  // ═══════════════════════════════════════════════════════
  // 难度
  // ═══════════════════════════════════════════════════════
  const difficulty = ref<DifficultyPreset | null>(null);
  const reincarnationPoints = ref(1000);

  function selectDifficulty(id: string) {
    const preset = findDifficultyPreset(id);
    if (preset) {
      difficulty.value = preset;
      reincarnationPoints.value = preset.points;
    }
  }

  // ═══════════════════════════════════════════════════════
  // 角色基本信息 (→ 变量路径)
  // ═══════════════════════════════════════════════════════
  const name = ref('');
  const gender = ref('男');
  const customGender = ref('');
  const age = ref(18);
  const race = ref('人类');
  const customRace = ref('');
  const identity = ref('非贵族平民');
  const customIdentity = ref('');
  const startLocation = ref('大陆中东部区域-奥古斯提姆帝国-艾瑟嘉德');
  const customStartLocation = ref('');
  /** 角色性格描述 */
  const personality = ref('');
  /** 角色身材描述 */
  const physics = ref('');
  /** 角色身世简述 */
  const backstory = ref('');
  /** 补充说明 */
  const extra = ref('');

  /** 起始地级联树（内容侧） */
  const startLocationTree = computed(() => catalog.value.startLocations);
  /** 扁平化地点列表（叶子；树 → `{ label: '洲 > 国 > 城', value }`） */
  const flatLocationOptions = computed(() => flattenLocationTree(catalog.value.startLocations));

  // 🔴 血脉走 `bloodlineSet` 这个 ref 而不是无参 `getBloodlineList()`（D25②/T10）：
  //    后者同步读模块级注册表，而注册表不是响应式的 —— computed 会把首次求值时
  //    那份空集永久缓存住，内容加载完了种族下拉仍然只有「自定义」一项。
  const raceOptions = computed(() => {
    const bloodlines = getBloodlineList(bloodlineSet.value);
    return [
      ...bloodlines.map((b) => ({ label: b.name, value: b.name })),
      { label: '自定义', value: '自定义' },
    ];
  });

  /**
   * 身份下拉（按玩家性别过滤，2026-09-19）：内容侧 femaleOnlyIdentities 列出的
   * 身份（侍女/养女这类女性承籍身份）对男/雄性玩家隐藏；「自定义」性别不隐藏
   * （玩家可能自填任何性别）。自定义兜底项永远保留。
   */
  const identityOptions = computed(() => {
    const all = costTableOptions(catalog.value.identityCosts);
    const femaleOnly = catalog.value.femaleOnlyIdentities;
    if (femaleOnly.length === 0 || gender.value === '自定义') return all;
    if (gender.value !== '男' && gender.value !== '雄性') return all;
    return all.filter((name) => !femaleOnly.includes(name) || name === CUSTOM_OPTION_KEY);
  });

  // 性别切换时，被过滤掉的女性专属身份自动回落到「非贵族平民」（自定义兜底不消失）
  watch(gender, (g) => {
    const femaleOnly = catalog.value.femaleOnlyIdentities;
    if (
      (g === '男' || g === '雄性') &&
      femaleOnly.length > 0 &&
      femaleOnly.includes(identity.value)
    ) {
      identity.value = '非贵族平民';
    }
  });

  // ═══════════════════════════════════════════════════════
  // 等级 & 属性 (→ 变量路径) — 对齐原版 custom_start_index.html
  // ═══════════════════════════════════════════════════════
  const level = ref(1);
  /** 🆕 经验档位（简单/普通模式，2026-08-24）：创建存档时写入 SaveProfile.experienceMode，游戏内可随时切换 */
  const experienceMode = ref<ExperienceMode>('normal');
  const basePoints = ref<Record<string, number>>({ 力量: 0, 敏捷: 0, 体质: 0, 智力: 0, 精神: 0 });
  const attributePoints = ref<Record<string, number>>({
    力量: 0,
    敏捷: 0,
    体质: 0,
    智力: 0,
    精神: 0,
  });

  const tier = computed(() => getTier(level.value));
  const tierName = computed(() => TIER_NAMES[tier.value - 1]);
  const tierBonus = computed(() => tier.value - 1);

  const usedBP = computed(() => Object.values(basePoints.value).reduce((a, b) => a + b, 0));
  const remainingBP = computed(() => MAX_BP - usedBP.value);

  function addBasePoint(attr: string) {
    if (remainingBP.value > 0 && (basePoints.value[attr] || 0) < BP_PER_ATTR_MAX) {
      basePoints.value = { ...basePoints.value, [attr]: (basePoints.value[attr] || 0) + 1 };
    }
  }
  function removeBasePoint(attr: string) {
    if ((basePoints.value[attr] || 0) > 0) {
      basePoints.value = { ...basePoints.value, [attr]: (basePoints.value[attr] || 0) - 1 };
    }
  }

  const maxAP = computed(() => Math.max(0, level.value - 1));
  const usedAP = computed(() => Object.values(attributePoints.value).reduce((a, b) => a + b, 0));
  const remainingAP = computed(() => maxAP.value - usedAP.value);
  const attributesFullyAllocated = computed(
    () => remainingBP.value === 0 && remainingAP.value === 0,
  );

  function addAttributePoint(attr: string) {
    if (remainingAP.value > 0) {
      attributePoints.value = {
        ...attributePoints.value,
        [attr]: (attributePoints.value[attr] || 0) + 1,
      };
    }
  }
  function removeAttributePoint(attr: string) {
    if ((attributePoints.value[attr] || 0) > 0) {
      attributePoints.value = {
        ...attributePoints.value,
        [attr]: (attributePoints.value[attr] || 0) - 1,
      };
    }
  }

  // 原版: 等级变化时重置 AP
  // flush: 'sync' 确保预设加载时 level 赋值后 watch 立即执行完毕，
  // 再由后续 attributePoints = {...} 恢复预设值，不被异步 flush 覆盖。
  watch(
    level,
    () => {
      attributePoints.value = { 力量: 0, 敏捷: 0, 体质: 0, 智力: 0, 精神: 0 };
    },
    { flush: 'sync' },
  );

  const finalAttributes = computed(() => {
    const result: Record<string, number> = {};
    for (const attr of ATTRIBUTE_NAMES) {
      result[attr] =
        (basePoints.value[attr] || 0) + tierBonus.value + (attributePoints.value[attr] || 0);
    }
    return result;
  });

  const resourcesPreview = computed(() => {
    const a = finalAttributes.value;
    return calcResources(tier.value, {
      str: a['力量'] || 5,
      dex: a['敏捷'] || 5,
      con: a['体质'] || 5,
      int: a['智力'] || 5,
      spi: a['精神'] || 5,
    });
  });
  const hpPreview = computed(() => resourcesPreview.value.hp);
  const mpPreview = computed(() => resourcesPreview.value.mp);
  const spPreview = computed(() => resourcesPreview.value.sp);

  // ═══════════════════════════════════════════════════════
  // 经济 — 对齐原版消耗公式
  // ═══════════════════════════════════════════════════════
  const startingPoints = ref(0);
  const money = ref(0);

  const raceCost = computed(() => lookupCost(catalog.value.raceCosts, race.value));
  const identityCost = computed(() => lookupCost(catalog.value.identityCosts, identity.value));
  const cardCost = computed(() => selectedCards.value.reduce((n, c) => n + (c.cost || 0), 0));
  /** 出身天赋计价（2026-09-16 分级定价）：与声望兑换同公式（基础×品级乘数），货币为转生点 */
  const talentCost = computed(() => {
    if (!selectedCreationTalent.value) return 0;
    const tpl = getCreationCatalog().find((t) => t.name === selectedCreationTalent.value);
    return tpl ? talentExchangePrice(tpl) : 0;
  });
  const moneyCost = computed(() => Math.ceil(money.value / 100));
  const startingPointCost = computed(() => Math.ceil(startingPoints.value / 2));
  const levelCost = computed(() => Math.max(0, level.value - 1) * 5);

  const totalCost = computed(
    () =>
      raceCost.value +
      identityCost.value +
      levelCost.value +
      usedAP.value +
      cardCost.value +
      talentCost.value +
      moneyCost.value +
      startingPointCost.value,
  );
  const remainingPoints = computed(() => reincarnationPoints.value - totalCost.value);

  // ═══════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════
  // 开局购卡 (→ 开场卡面叙事 + CharacterState 卡组直落)
  // 2026-09-16 卡牌化：旧 CDN 装备/道具/技能目录（旧体系形状、经 item_gen 生成旧版
  // 物品、进不了卡组）退役。卡从内容仓 catalog.cardPool 选购，提交时确定性构造
  // CardItem 写 inventory + cardAlbum——铁律3 数值归 Code，且交锋只读背包里的
  // type:'卡牌'，卡必须直接落背包才能打出。
  // ═══════════════════════════════════════════════════════
  const selectedCards = ref<CardCatalogItem[]>([]);
  /** 出身天赋（天赋系统 T-S3：捏人第 3 步，必选 1；名字 = TALENT_CATALOG 模板键） */
  const selectedCreationTalent = ref<string | null>(null);
  /** 随机天赋_offer（2026-09-16）：洗牌捏人池取前 8（池不足 8 全出），可重抽换一批 */
  const talentOffers = ref<TalentTemplate[]>([]);
  function rollTalentOffers() {
    // 只从机制可用的池抽（2026-09-17：存量目录 54% 纯描述，强制 1 选 1 抽不实干天赋）
    const pool = [...getDrawableCatalog()];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    talentOffers.value = pool.slice(0, 8);
    // 重抽后若已选天赋不在新一批里，清空选择让玩家重新挑
    if (
      selectedCreationTalent.value &&
      !talentOffers.value.some((t) => t.name === selectedCreationTalent.value)
    ) {
      selectedCreationTalent.value = null;
    }
  }

  /** 开局购卡分栏（八类中的可购四类；召唤/军团/契约与共鸣叙事强耦合，不开局卖） */
  const CARD_CATEGORIES = ['装备', '技能', '领域', '物资'] as const;
  const activeCardCategory = ref<CardFormEntry>('装备');

  const cardPool = computed(() => {
    void customContentVersion.value; // 依赖：进页面时重读自定义注册表（见其声明处）
    return mergeCards(catalog.value.cardPool, getCustomCards()).filter((c) => !c.imitation);
  });
  const filteredCards = computed(() =>
    cardPool.value.filter((c) => c.formEntry === activeCardCategory.value),
  );

  function isCardSelected(card: CardCatalogItem): boolean {
    return selectedCards.value.some((c) => c.id === card.id);
  }

  /** 点数足够才可加购（已选中的总可以保留） */
  function canSelectCard(card: CardCatalogItem): boolean {
    if (isCardSelected(card)) return true;
    return remainingPoints.value >= (card.cost || 0);
  }

  function toggleCard(card: CardCatalogItem) {
    if (isCardSelected(card)) {
      selectedCards.value = selectedCards.value.filter((c) => c.id !== card.id);
    } else if (canSelectCard(card)) {
      selectedCards.value = [...selectedCards.value, card];
    }
  }

  function clearAllSelections() {
    selectedCards.value = [];
  }

  // ═══════════════════════════════════════════════════════
  // 背景预设目录 (4 分类: 通用/身份/种族/地区)
  // —— 2026-09-16 精简：独立「背景故事」步删除，预设选择器并入基础信息步的
  //    身世字段旁挂；选中预设只把 fullText 写进身世文本，不另设选中状态。
  // ═══════════════════════════════════════════════════════

  const activeBackgroundCategory = ref<BackgroundCategory>('universal');

  // 计数与筛选共用 `classifyBackground`（start-catalog-mechanics）：
  // 各写一套判定就会出现「侧栏写 7 条、点进去只有 5 条」那种对不上。
  const backgroundCategories = computed(() => {
    const counts = countBackgroundsByCategory(catalog.value.backgrounds);
    return [
      { key: 'universal' as const, label: '通用开局', count: counts.universal },
      { key: 'identity' as const, label: '身份限定', count: counts.identity },
      { key: 'race' as const, label: '种族限定', count: counts.race },
      { key: 'location' as const, label: '地区限定', count: counts.location },
    ];
  });

  const filteredBackgrounds = computed(() =>
    filterBackgroundsByCategory(catalog.value.backgrounds, activeBackgroundCategory.value),
  );

  /** 内容侧背景预设全表（空 = 当前包不带开局预设：CreateStepBasic 据此隐藏选择入口） */
  const backgrounds = computed(() => catalog.value.backgrounds);

  // ═══════════════════════════════════════════════════════
  // 剧情规划 — 对齐 PlotSettings 类型 (types.ts)
  // ═══════════════════════════════════════════════════════
  const plotMode = ref<'off' | 'side' | 'main'>('off');
  const plotDurationYears = ref(5);
  const plotAllowNonWorldbookNpc = ref(true);
  const plotDifficultyTier = ref<number | 'adaptive'>('adaptive');
  const plotGenrePreference = ref<
    Array<
      | 'combat'
      | 'mystery'
      | 'social'
      | 'romance'
      | 'exploration'
      | 'politics'
      | 'survival'
      | 'tragedy'
    >
  >(['combat']);
  const plotCustomPreference = ref('');
  const plotFocusRegion = ref('');
  const plotChapterCount = ref(0);
  const plotEventsPerChapter = ref(0);
  const plotTabooContent = ref('');
  const plotOutline = ref<PlotOutline | null>(null);
  /** 结构化章节（含 keyEvents）— startJourney 时经 outlineToEvents 生成事件树 */
  const plotOutlineChapters = ref<ParsedOutlineOutput['chapters']>([]);
  const isPlotGenerating = ref(false);
  /** 大纲预览是否已揭示（防剧透遮罩，捏人页本地状态） */
  const plotOutlineRevealed = ref(false);
  const plotGenerationError = ref<string | null>(null);

  /** 流式生成实时统计（捏人页统计条用；null = 非生成中） */
  const plotStreamStats = ref<{
    phase: 'connecting' | 'thinking' | 'streaming';
    round: number;
    chars: number;
    reasoningChars: number;
    charsPerSec: number;
    estimatedTotal: number;
    estimatedRemainingSec: number | null;
    elapsedSec: number;
  } | null>(null);
  /** 当前生成轮的 AbortController（取消按钮用） */
  let plotAbortController: AbortController | null = null;

  /**
   * 预计大纲总字数 —— 三档：上轮实际（正文 + 思维链）最准 → 历史版 content 膨胀 → 公式兜底。
   * 🔴 分子/分母同口径：实时统计的「已生成字数」= 正文 + 思维链，故这里也必须含思维链，
   *    否则首次/再次生成的「预计剩余」都会偏小（只算正文时思维链被丢）。
   * 公式（首次生成无历史可用）：每子态势按新提示词产出规模估算
   * （desc 200~400 + trigger/complete/fail + XML 标签开销 ≈ 520），再乘思维链系数 ≈ 0.5。
   */
  function estimateOutlineChars(): number {
    const lastMeta = lastPlotGenerationMeta.value;
    if (lastMeta) {
      const total = (lastMeta.rawResponse?.length ?? 0) + (lastMeta.reasoning?.length ?? 0);
      if (total > 0) return total;
    }
    const hist = outlineHistory.value[outlineHistory.value.length - 1];
    if (hist?.content?.length) return Math.round(hist.content.length * 1.6);
    const ps = plotSettings.value;
    const chapters = ps.main?.chapterCount || ps.side?.chapterCount || 3;
    const eventsPerCh = ps.main?.eventsPerChapter || ps.side?.eventsPerChapter || 3;
    const body = chapters * eventsPerCh * 520 + 1800;
    return Math.round(body + body * 0.5);
  }

  /** 取消当前大纲生成（用户主动中止） */
  function abortPlotGeneration(): void {
    plotAbortController?.abort();
  }
  /** 最近一次大纲生成的完整 AI 数据（供导出） */
  const lastPlotGenerationMeta = ref<{
    messages: Array<{ role: string; content: string }>;
    rawResponse: string;
    reasoning?: string;
    finishReason?: string;
    model: string;
    timestamp: number;
  } | null>(null);
  /** 会话内大纲历史（最多 5 版，重新生成/修改时旧版入栈，可回退） */
  const outlineHistory = ref<PlotOutline[]>([]);
  const chaptersHistory = ref<ParsedOutlineOutput['chapters'][]>([]);

  const plotSettings = computed<PlotSettings>(() => {
    const ps: PlotSettings = { mode: plotMode.value, tabooContent: plotTabooContent.value.trim() };
    if (plotMode.value === 'main') {
      const tier = plotDifficultyTier.value === 'adaptive' ? undefined : plotDifficultyTier.value;
      ps.main = {
        durationYears: plotDurationYears.value,
        allowNonWorldbookNpc: plotAllowNonWorldbookNpc.value,
        ...(tier !== undefined ? { difficultyTier: tier } : {}),
        genrePreference: plotGenrePreference.value,
        customPreference: plotCustomPreference.value.trim() || '',
      };
      if (plotChapterCount.value > 0) ps.main.chapterCount = plotChapterCount.value;
      if (plotEventsPerChapter.value > 0) ps.main.eventsPerChapter = plotEventsPerChapter.value;
    } else if (plotMode.value === 'side') {
      ps.side = {
        focusRegion: plotFocusRegion.value.trim() || '',
      };
      if (plotChapterCount.value > 0) ps.side.chapterCount = plotChapterCount.value;
      if (plotEventsPerChapter.value > 0) ps.side.eventsPerChapter = plotEventsPerChapter.value;
    }
    return ps;
  });

  // ═══════════════════════════════════════════════════════
  // localStorage 草稿 key — 必须定义在 initPlotDefaultsFromSettings
  // （会调用 tryRestoreDraft）之前，避免 TDZ 报错
  // ═══════════════════════════════════════════════════════
  const DRAFT_KEY = 'plotOutlineDraft_v1';

  // ═══════════════════════════════════════════════════════
  // 剧情设置默认值 — 从设置页（settings-store）读入新档默认值
  // ═══════════════════════════════════════════════════════

  function initPlotDefaultsFromSettings() {
    try {
      const s = useSettingsStore().settings;
      const mode = s.plotMode;
      if (mode === 'off' || mode === 'side' || mode === 'main') plotMode.value = mode;
      const dur = Number(s.plotDurationYears);
      if (Number.isFinite(dur) && dur > 0) plotDurationYears.value = dur;
      const tier = s.plotDifficultyTier;
      plotDifficultyTier.value =
        tier === 'adaptive' || tier === undefined || tier === null || tier === ''
          ? 'adaptive'
          : Number(tier);
      plotAllowNonWorldbookNpc.value = s.plotAllowNonWorldbookNpc !== false;
      if (Array.isArray(s.plotGenrePreference) && s.plotGenrePreference.length > 0) {
        plotGenrePreference.value = [...s.plotGenrePreference] as typeof plotGenrePreference.value;
      }
      plotCustomPreference.value =
        typeof s.plotCustomPreference === 'string' ? s.plotCustomPreference : '';
      plotFocusRegion.value = typeof s.plotFocusRegion === 'string' ? s.plotFocusRegion : '';
      plotTabooContent.value = typeof s.plotTabooContent === 'string' ? s.plotTabooContent : '';
      const cc = Number(s.plotChapterCount);
      plotChapterCount.value = Number.isFinite(cc) && cc > 0 ? cc : 0;
      const ec = Number(s.plotEventsPerChapter);
      plotEventsPerChapter.value = Number.isFinite(ec) && ec > 0 ? ec : 0;
    } catch {
      /* settings 不可用时保持内置默认 */
    }
  }

  initPlotDefaultsFromSettings();
  // 尝试恢复之前保存的大纲草稿（仅浏览器环境，Node 测试环境跳过）
  if (typeof localStorage !== 'undefined') tryRestoreDraft();

  // ═══════════════════════════════════════════════════════
  // 剧情大纲生成 — 捏人页走模板系统 (buildAgentMessagesAsync)
  // ═══════════════════════════════════════════════════════

  /**
   * 端点解析（对齐 game-pipeline.buildEndpoints + resolveAgentEndpoint）。
   * 🔴 F10：`plot_outline` 的 `model` 键存 **API 池 id**（历史命名不改），显式绑定失效时
   *    绝不回落 `pool[0]`（那会把大纲偷偷送去另一家 provider）——返回带原因的失败，
   *    调用方（runOutlineGeneration）把原因翻译成用户可见文案。
   */
  function resolvePlotOutlineEndpoint():
    | { ok: true; endpoint: ApiEndpoint }
    | { ok: false; reason: 'missing-pool' | 'stale-binding'; requestedPoolId?: string } {
    try {
      const store = useSettingsStore();
      const s = store.settings;
      const pool = ((s.apiPool ?? []) as any[]).map((entry: any) => ({
        id: entry.id || '',
        name: entry.name || '',
        provider: entry.provider || entry.apiType || 'custom',
        baseUrl: entry.baseUrl || '',
        apiKey: entry.apiKey || '',
        defaultModel: entry.defaultModel || entry.model || '',
        models: entry.models || [],
        timeout: entry.timeout ?? 60000,
        enableThinking: entry.enableThinking ?? false,
      })) as ApiEndpoint[];
      const poolId = getAgentSettings(
        s,
        'plot_outline',
        store.projectAgentDefaults?.agents ?? {},
      ).model;
      const resolution = resolveAgentEndpoint({ boundPoolId: poolId, apiPool: pool });
      if (resolution.status === 'resolved') return { ok: true, endpoint: resolution.endpoint };
      if (resolution.status === 'stale-binding') {
        return { ok: false, reason: 'stale-binding', requestedPoolId: resolution.requestedId };
      }
      return { ok: false, reason: 'missing-pool' };
    } catch {
      return { ok: false, reason: 'missing-pool' };
    }
  }

  /** 角色信息 → 最小 CharacterState（供模板系统 {{CHARACTER_STATE}} 占位符） */
  function buildOutlineCharacterState(): CharacterState {
    return buildCharacterState('create-outline');
  }

  /** 剧情配置文本（含雷点，通过 localParams['PLOT_EVENTS'] 覆盖模板占位符） */
  function buildOutlinePlotSettingsText(): string {
    const ps = plotSettings.value;
    const parts: string[] = [];
    parts.push(''); // 前导空行使合并后分隔清晰
    parts.push('# 剧情配置');
    parts.push(`模式: ${ps.mode}`);
    if (ps.main) {
      parts.push(`持续年份: ${ps.main.durationYears}`);
      parts.push(`难度层级: ${ps.main.difficultyTier ?? '自适应'}`);
      parts.push(`允许世界书外NPC: ${ps.main.allowNonWorldbookNpc ? '是' : '否'}`);
      parts.push(`剧情偏向: ${ps.main.genrePreference.join('、')}`);
      if (ps.main.customPreference) parts.push(`自定义偏好: ${ps.main.customPreference}`);
      if (ps.main.chapterCount) parts.push(`章节数量: ${ps.main.chapterCount} 章`);
      if (ps.main.eventsPerChapter) parts.push(`每章事件: ${ps.main.eventsPerChapter} 个`);
    }
    if (ps.side) {
      if (ps.side.focusRegion) parts.push(`专注区域: ${ps.side.focusRegion}`);
      if (ps.side.chapterCount) parts.push(`章节数量: ${ps.side.chapterCount} 章`);
      if (ps.side.eventsPerChapter) parts.push(`每章事件: ${ps.side.eventsPerChapter} 个`);
    }
    if (ps.tabooContent) {
      parts.push('');
      parts.push('雷点（绝对禁止出现的内容，优先级高于一切偏好）:');
      parts.push(ps.tabooContent);
    }
    return parts.join('\n');
  }

  /** 加载 agent-config.json 中的 Agent 配置 */
  async function loadOutlineAgentConfigs(): Promise<AgentConfig[]> {
    // 内容-引擎分离（波 1 T2 / D16）：经 ContentProvider 收口。
    // provider 内部 await contentReadyPromise + 上报 contentStatus；失败返回空骨架不抛。
    try {
      const { useContentStore } = await import('./content-store');
      const json = (await useContentStore().loadProjectDefaults()) as {
        agents?: Record<string, any>;
      };
      if (!json.agents) return [];
      const result: AgentConfig[] = [];
      for (const [id, cfg] of Object.entries(json.agents) as [string, any][]) {
        result.push({ ...cfg, agentId: id } as AgentConfig);
      }
      return result;
    } catch {
      return [];
    }
  }

  /** 加载剧情大纲 Agent 可见的世界书（统一数据源：store 优先 + 文件兜底；worldBookIds + 捏人勾选过滤） */
  async function loadPlotOutlineWorldBooks(agentConfigs: AgentConfig[]): Promise<WorldBook[]> {
    try {
      // 统一数据源：读 worldbook-store（Dexie，含用户在 WorldBookEditor 的 enabled 修改），
      // 不再绕过 store 读原始文件
      const wb = useWorldBookStore();
      await wb.init();
      const all = await loadWorldBooksWithFallback(wb.books as WorldBook[]);
      const cfg = agentConfigs.find((c) => c.agentId === 'plot_outline');
      let filtered = all;
      if (cfg && cfg.worldBookIds?.length) {
        filtered = all.filter((wb) => cfg.worldBookIds!.includes(wb.id));
      }
      return filtered;
    } catch {
      return [];
    }
  }

  /**
   * AI 未输出 timerange 时的兜底区间（基准 = 纪元年 488；正常路径由 createOutlineFromAgent
   * 用 AI 的 parsed.timeRange）。
   *
   * 🔴 纪元名取自内容侧（D9），**不许写死**。内容缺席时 `era` 是空串，
   * 于是这里退化成「0488年01月01日」—— 一眼看得出「纪元名没接上」，
   * 而一个看着合理的硬编码缺省会把接线漏洞伪装成正常。
   */
  function buildOutlineTimeRange(): { start: string; end: string } {
    const years = plotMode.value === 'main' ? plotDurationYears.value : 1;
    const startYear = String(GAME_EPOCH_YEAR).padStart(4, '0');
    const endYear = String(GAME_EPOCH_YEAR + Math.max(1, years)).padStart(4, '0');
    return { start: `${era.value}${startYear}年01月01日`, end: `${era.value}${endYear}年12月30日` };
  }

  /** 历史入栈（最多 5 版，超出丢最旧） */
  function pushOutlineHistory() {
    if (!plotOutline.value) return;
    outlineHistory.value = [...outlineHistory.value, plotOutline.value].slice(-5);
    chaptersHistory.value = [...chaptersHistory.value, plotOutlineChapters.value].slice(-5);
  }

  /** 从原始输出提取结构化自检（score/weaknesses/suggestions）。
   *  主路径：XML `<self_critique score="N">...<weakness>..</weakness><suggestion>..</suggestion></self_critique>`（v2 prompt 实际输出）
   *  兜底：legacy JSON `{ selfCritique: { score, weaknesses, suggestions } }`（旧格式/测试 fixture） */
  function extractSelfCritique(
    raw: string,
  ): { score: number; weaknesses: string[]; suggestions: string[] } | null {
    // 1. XML 主路径：定位 self_critique 块（自闭合 <self_critique score="N" /> 也走属性匹配）
    const blockMatch = raw.match(/<self_critique\b[^>]*>[\s\S]*?<\/self_critique\s*>/i);
    const block = blockMatch ? blockMatch[0] : '';
    const scoreMatch = (block || raw).match(/<self_critique\b[^>]*\bscore\s*=\s*"?(\d+)/i);
    if (scoreMatch) {
      const score = parseInt(scoreMatch[1], 10);
      const extractTags = (src: string, tag: string): string[] => {
        const re = new RegExp(`<\\s*${tag}\\s*>([\\s\\S]*?)<\\/\\s*${tag}\\s*>`, 'gi');
        const out: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) out.push(m[1].trim());
        return out;
      };
      const scope = block || raw;
      return {
        score,
        weaknesses: extractTags(scope, 'weakness'),
        suggestions: extractTags(scope, 'suggestion'),
      };
    }
    // 2. legacy JSON 兜底（Q-05：剥壳走 model-json，多认围栏与 <json> 标签）
    const payload = extractJsonPayload(raw);
    if (!payload) return null;
    try {
      const parsed = JSON.parse(payload);
      const sc = parsed?.selfCritique;
      if (!sc || typeof sc.score !== 'number') return null;
      return {
        score: sc.score,
        weaknesses: Array.isArray(sc.weaknesses) ? sc.weaknesses : [],
        suggestions: Array.isArray(sc.suggestions) ? sc.suggestions : [],
      };
    } catch {
      return null;
    }
  }

  /**
   * 流式调用 chatStream，一边实时更新 plotStreamStats（字数/速率/剩余估算），
   * 一边把流聚合回 Promise 结果。用户取消（abort）与真实错误用 `cancelled` 区分。
   */
  function streamOutlineChat(
    client: AgentClient,
    request: {
      model: string;
      temperature: number;
      maxTokens: number;
      topP: number;
      messages: Array<{ role: string; content: string }>;
    },
    round: number,
  ): Promise<{
    rawResponse: string;
    reasoning?: string;
    finishReason?: string;
    completionTokens?: number;
    error?: string;
    cancelled?: boolean;
  }> {
    return new Promise((resolve) => {
      const controller = new AbortController();
      plotAbortController = controller;
      const startedAt = Date.now();
      let fullText = '';
      let fullReasoning = '';
      plotStreamStats.value = {
        phase: 'connecting',
        round,
        chars: 0,
        reasoningChars: 0,
        charsPerSec: 0,
        estimatedTotal: estimateOutlineChars(),
        estimatedRemainingSec: null,
        elapsedSec: 0,
      };
      // 速率滑动窗口（近 10s 平均；开头数据少不估算）。分子记**正文 + 思维链**总字数：
      // 推理模型先流一大段思维链，只按正文算会让速率与剩余长时间停在 0 / 无。
      const window_: Array<{ ts: number; chars: number }> = [];

      const finishStats = () => {
        if (!plotStreamStats.value) return;
        plotStreamStats.value.chars = fullText.length;
        plotStreamStats.value.reasoningChars = fullReasoning.length;
        plotStreamStats.value.elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      };

      // 正文与思维链的每个增量都走这里 —— 任意流数据到达都算「已连上」。
      // 只认正文（旧实现）会让推理模型在整段思考期卡在 connecting（正文 0 字 → 永不翻态）。
      const updateStats = (phase: 'thinking' | 'streaming') => {
        const st = plotStreamStats.value;
        if (!st) return;
        const now = Date.now();
        const totalChars = fullText.length + fullReasoning.length;
        window_.push({ ts: now, chars: totalChars });
        const cutoff = now - 10000;
        while (window_.length > 0 && window_[0].ts < cutoff) window_.shift();
        const first = window_[0];
        const last = window_[window_.length - 1];
        const span = last.ts - first.ts;
        const delta = last.chars - first.chars;
        const cps = span > 0 ? (delta * 1000) / span : 0;
        st.phase = phase;
        st.chars = fullText.length;
        st.reasoningChars = fullReasoning.length;
        st.charsPerSec = Math.round(cps);
        st.elapsedSec = Math.round((now - startedAt) / 1000);
        // 数据足够（≥200 字）才给剩余估算；宁偏大不偏小（×1.15 缓冲）
        if (totalChars >= 200 && cps > 0) {
          const remaining = Math.max(0, st.estimatedTotal - totalChars);
          st.estimatedRemainingSec = Math.round((remaining / cps) * 1.15);
        } else {
          st.estimatedRemainingSec = null;
        }
      };

      void client.chatStream(
        request,
        {
          onChunk(text, _isComplete) {
            fullText += text;
            updateStats('streaming');
          },
          onReasoning(text) {
            fullReasoning += text;
            // 正文尚未开始 = 思考阶段；正文已开始（思考与正文交错）保持 streaming
            updateStats(fullText.length > 0 ? 'streaming' : 'thinking');
          },
          onComplete(result) {
            fullText = result.fullText;
            fullReasoning = result.reasoning || '';
            finishStats();
            resolve({
              rawResponse: result.fullText,
              reasoning: result.reasoning || undefined,
              completionTokens: result.completionTokens,
            });
          },
          onError(err) {
            finishStats();
            const cancelled = err === 'Request aborted';
            resolve({
              rawResponse: fullText,
              reasoning: fullReasoning || undefined,
              error: cancelled ? undefined : err,
              cancelled,
            });
          },
        },
        controller.signal,
      );
    });
  }

  /** 核心生成循环: 通过模板系统 buildAgentMessagesAsync 构建上下文，selfCritique.score < 6 时重试（最多 2 次调用） */
  async function runOutlineGeneration(initialUserMessage: string): Promise<boolean> {
    plotGenerationError.value = null;
    await useSettingsStore().initApiSecrets();
    // 🔴 F10：端点解析失败时区分「还没配」与「绑定了但已失效」——
    //    前者让人去配置，后者是设置页里那个池被删了，指引到 Agent 配置重选。
    const resolved = resolvePlotOutlineEndpoint();
    if (!resolved.ok) {
      plotGenerationError.value =
        resolved.reason === 'stale-binding'
          ? `「大纲生成」Agent 绑定的 API 池已失效（原 id: ${resolved.requestedPoolId ?? ''}），请在设置 → Agent 配置重新选择`
          : '未配置 API 端点或模型，请在设置页为「大纲生成」Agent 配置 API';
      return false;
    }
    const endpoint = resolved.endpoint;
    if (!endpoint.defaultModel) {
      plotGenerationError.value = '未配置 API 端点或模型，请在设置页为「大纲生成」Agent 配置 API';
      return false;
    }

    isPlotGenerating.value = true;
    try {
      const settingsStore = useSettingsStore();
      const settings = settingsStore.settings;

      // 加载模板系统依赖: Agent 配置 + 世界书
      // 🔴 必须用 **Async** 版（2026-08-01 修 F3）：plot_outline 可见的世界书里有 22 条含 EJS 的条目，
      //    同步的 `buildAgentMessages` 会在宿主 realm 直接 `new Function` 求值它们 ——
      //    绕开 `getEjsBackend()` 的隔离后端（无中断、无预算、构造器可逃逸），
      //    而应用此时对外报告的是「已隔离」。异步版先预渲染再灌 memo，EJS 只在后端里跑。
      const { buildAgentMessagesAsync } = await import('@engine/agent-templates');
      const agentConfigs = await loadOutlineAgentConfigs();
      const worldBooks = await loadPlotOutlineWorldBooks(agentConfigs);

      // 构建 AgentContext
      const ctx: AgentContext = {
        userInput: initialUserMessage,
        history: [],
        characters: [buildOutlineCharacterState()],
        memories: [],
        plotEvents: [],
        plotSettings: plotSettings.value,
        variables: {},
        agentOutputs: new Map(),
        worldBooks: [],
      };

      // localParams: 用剧情配置文本覆盖模板中的 {{PLOT_EVENTS}}
      const localParams: Record<string, string> = {
        PLOT_EVENTS: buildOutlinePlotSettingsText(),
      };

      const baseMessages = await buildAgentMessagesAsync(
        'plot_outline',
        ctx,
        agentConfigs,
        worldBooks,
        undefined,
        localParams,
      );
      const messages: Array<{ role: string; content: string }> = baseMessages
        ? [...baseMessages]
        : [{ role: 'system', content: '' }];

      const client = new AgentClient({
        endpoint,
        agentId: 'plot_outline',
        saveId: 'create',
        // 真机修(2026-07-21): plot_outline 一次性重操作 — 大 systemPrompt(世界书注入 ~40 万字符)
        // + 复杂产出(先 if_absent 再切 event + 多事件 desc/trigger/complete/fail) + 自检重试，
        // AI 生成稳定 >120s。提至 300s。配合 agent-client 的 AbortError 友好化。
        // 🔴 2026-08-08 再次拉满: 章节×事件规模 5×5 时输出 ~10k+ 字、慢模型 4-8 分钟，
        //    300s 会掐在生成中途。maxTokens 已拉满(384000)，这里把墙钟也放开到 30 分钟 —
        //    让「能生成完」而不是「在超时边缘赌命」。
        timeout: 1800000,
      });
      // Q-18: 默认值不再在这里重述一遍（此前 0.7 / 16384 / 1.0 三处字面量与
      // 设置页、game-pipeline 的拷贝靠人眼保持一致）
      // D44 修正 1：合默认层 —— 用户没覆写数值时取默认层（pack > 占位）给的值。
      const plotAgentCfg = getAgentSettings(
        settings,
        'plot_outline',
        settingsStore.projectAgentDefaults?.agents ?? {},
      );
      const llmParams = {
        model: endpoint.defaultModel,
        temperature: plotAgentCfg.temperature,
        maxTokens: plotAgentCfg.maxTokens,
        topP: plotAgentCfg.topP,
      };

      let best: { parsed: ParsedOutlineOutput; raw: string } | null = null;
      let userMessage = initialUserMessage;

      for (let attempt = 0; attempt < 2; attempt++) {
        // 替换最后一条 user 消息为当前 userMessage（首次用 initialUserMessage，重试带弱点）
        // 如果 baseMessages 最后一条是 user，替换它；否则追加
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'user') {
          messages[messages.length - 1] = { role: 'user', content: userMessage };
        } else {
          messages.push({ role: 'user', content: userMessage });
        }

        const result = await streamOutlineChat(client, { ...llmParams, messages }, attempt + 1);
        if (result.cancelled) {
          plotGenerationError.value = '大纲生成已取消';
          plotStreamStats.value = null;
          return false;
        }
        if (result.error || !result.rawResponse) {
          if (best) break;
          plotGenerationError.value = `大纲生成失败: ${result.error ?? 'AI 返回为空'}`;
          plotStreamStats.value = null;
          return false;
        }
        const parsed = tryParseOutline(result.rawResponse);
        if (!parsed) {
          if (best) break;
          // 🔴 2026-08-08 诊断: 解析失败必须留痕 —— 此前只有一句「解析失败」、
          // 零日志、raw 不留档，5×5 失败原因完全不可查。
          const raw = result.rawResponse ?? '';
          const hasClosing = /<\/\s*outline\s*>/i.test(raw);
          // 截断判据：API 明说截断，或「有 <outline 开头但没闭合」——后者是截断的
          // 特征形；纯垃圾输出（连 <outline 都没有）不算截断，是格式损坏。
          const hasOutlineOpen = /<\s*outline\b/i.test(raw);
          const truncated = result.finishReason === 'length' || (hasOutlineOpen && !hasClosing);
          console.error('[PlotOutline] 大纲输出解析失败', {
            finishReason: result.finishReason ?? '未知',
            rawLength: raw.length,
            hasClosingOutlineTag: hasClosing,
            completionTokens: result.completionTokens ?? 0,
            head: raw.slice(0, 200),
            tail: raw.slice(-400),
          });
          // 失败轮也留档 —— 「导出 AI 调试数据」按钮可导出原始输出
          lastPlotGenerationMeta.value = {
            messages: messages.map((m) => ({ ...m })),
            rawResponse: raw,
            reasoning: result.reasoning ?? undefined,
            model: llmParams.model,
            finishReason: result.finishReason,
            timestamp: Date.now(),
          };
          plotGenerationError.value = truncated
            ? '大纲输出被截断（输出未完整闭合），请减少章节/事件数量后重试，或检查 API 输出上限'
            : '大纲输出解析失败，请重试（失败详情已写入控制台，可导出 AI 调试数据）';
          plotStreamStats.value = null;
          return false;
        }
        best = { parsed, raw: result.rawResponse };
        // 保存本轮完整 AI 数据，供导出调试用
        lastPlotGenerationMeta.value = {
          messages: messages.map((m) => ({ ...m })),
          rawResponse: best.raw,
          reasoning: result.reasoning ?? undefined,
          finishReason: result.finishReason,
          model: llmParams.model,
          timestamp: Date.now(),
        };

        const critique = extractSelfCritique(result.rawResponse);
        if (!critique || critique.score >= 6) break;
        userMessage = [
          initialUserMessage,
          '',
          `# 上一版大纲（自检评分 ${critique.score}/10，未达标，需重写）`,
          result.rawResponse,
          '# 待改进点',
          ...(critique.weaknesses.length ? critique.weaknesses : ['（未给出）']),
          '# 改进建议',
          ...(critique.suggestions.length ? critique.suggestions : ['（未给出）']),
          '请针对以上不足重写大纲，输出完整大纲 XML（<outline>...</outline>）。',
        ].join('\n');
      }

      if (!best) {
        plotGenerationError.value = '大纲生成失败';
        return false;
      }
      plotStreamStats.value = null;

      const outline = createOutlineFromAgent(
        '',
        plotMode.value,
        best.raw,
        buildOutlineTimeRange(),
        (plotOutline.value?.version ?? 0) + 1,
      );
      if (!outline) {
        plotGenerationError.value = '大纲输出解析失败，请重试';
        return false;
      }
      pushOutlineHistory();
      plotOutline.value = outline;
      plotOutlineChapters.value = best.parsed.chapters;
      autoSaveDraft();
      return true;
    } catch (err) {
      plotGenerationError.value = `大纲生成失败: ${err instanceof Error ? err.message : String(err)}`;
      return false;
    } finally {
      isPlotGenerating.value = false;
    }
  }

  /** 导出本轮 AI 调试数据（系统提示词 + 思维链 + 正文输出） */
  function exportAIDebugDump(): boolean {
    if (!lastPlotGenerationMeta.value) return false;
    const m = lastPlotGenerationMeta.value;
    const data = {
      exportedAt: new Date().toISOString(),
      model: m.model,
      timestamp: m.timestamp,
      systemPrompt: m.messages.find((msg) => msg.role === 'system')?.content ?? '',
      userMessage: m.messages.find((msg) => msg.role === 'user')?.content ?? '',
      allMessages: m.messages,
      reasoning: m.reasoning,
      finishReason: m.finishReason,
      rawResponse: m.rawResponse,
      parsedOutline: plotOutline.value
        ? {
            title: plotOutline.value.title,
            summary: plotOutline.value.summary,
            content: plotOutline.value.content,
            timeRange: plotOutline.value.timeRange,
          }
        : null,
      plotSettings: plotSettings.value,
    };
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `AI调试数据-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch {
      return false;
    }
  }

  /** 生成剧情大纲（重新生成时旧版入栈 history 可回退） */
  async function generatePlotOutline(): Promise<boolean> {
    if (isPlotGenerating.value) return false;
    // 简单的初始 user 消息 — 模板系统的 systemPrompt 已包含完整指令
    const message = '# 剧情大纲生成请求\n\n请根据角色背景和剧情配置，生成完整剧情大纲。';
    return runOutlineGeneration(message);
  }

  /** 大纲重 roll（修改模式）: 带上一版完整 JSON + 用户修改要求让 AI 重写 */
  async function reviseOutline(userRequest: string): Promise<boolean> {
    if (isPlotGenerating.value) return false;
    if (!plotOutline.value) {
      plotGenerationError.value = '尚无大纲可修改，请先生成大纲';
      return false;
    }
    const previousJson = JSON.stringify(
      {
        title: plotOutline.value.title,
        summary: plotOutline.value.summary,
        content: plotOutline.value.content,
        chapters: plotOutlineChapters.value,
      },
      null,
      2,
    );
    const message = [
      '# 修改模式',
      '',
      '## 上一版大纲（完整 JSON）',
      previousJson,
      '',
      '## 用户的修改要求',
      userRequest.trim(),
      '',
      '请根据以上要求重写大纲。修改要求与雷点冲突时雷点优先。输出完整大纲 XML（<outline>...</outline>）。',
    ].join('\n');
    return runOutlineGeneration(message);
  }

  /** 回退到上一版大纲 */
  function rollbackOutline(): boolean {
    if (outlineHistory.value.length === 0) return false;
    const prev = outlineHistory.value[outlineHistory.value.length - 1];
    outlineHistory.value = outlineHistory.value.slice(0, -1);
    const prevChapters = chaptersHistory.value[chaptersHistory.value.length - 1] ?? [];
    chaptersHistory.value = chaptersHistory.value.slice(0, -1);
    plotOutline.value = prev;
    plotOutlineChapters.value = prevChapters;
    autoSaveDraft();
    return true;
  }

  // ═══════════════════════════════════════════════════════
  // 模板替换: <user> → 角色名
  // ═══════════════════════════════════════════════════════

  /** 将文本中的 &lt;user&gt; 替换为当前角色名（未填写时用中性占位名） */
  function substituteUser(text: string): string {
    const userName = name.value.trim() || '未命名者';
    return text.replace(/<user>/g, userName);
  }

  // ═══════════════════════════════════════════════════════
  // 提交: 变量路径
  // ═══════════════════════════════════════════════════════

  function buildCharacterState(saveId: string): CharacterState {
    const charId = crypto.randomUUID();
    const englishAttrs: Record<string, number> = {};
    for (const attr of ATTRIBUTE_NAMES) {
      englishAttrs[ATTR_CN_TO_EN[attr]] = finalAttributes.value[attr];
    }

    // ═══ 真机修（2026-07-23）: 开局装备/道具/技能不再直接结构化落库 ═══
    // 此前直接落库的 inventory 只有 effects(描述字符串) 没有 stats(战斗数值)，且会让
    // request_dispatcher 误判为「已有物品」→ 永不触发 item_gen → 战斗数值全 0。
    // 现在改为：选中项全部写进 buildOpeningPrompt 开场正文 → 开局轮 {{USER_INPUT}} 把
    // 这份开场提示词原样喂给 request_dispatcher（含「--- 初始装备 --- / --- 初始技能 ---」
    // 原始清单）→ dispatcher 按原名/原描述发 <item_gen_request> → item_gen 正式生成
    // stats+effects 落库（ADR: AI 填叙事字段，Code 补账务字段）。
    // ⚠️ 不能依赖 story 正文复述物品名 —— story 会改写名字（法师长袍→深蓝色天鹅绒长袍），
    //    dispatcher 必须从 {{USER_INPUT}} 的原始清单认物品，否则名字漂移、数值被 item_gen 重掷。
    // HP/MP/SP/五维等基础属性仍在此 Code 计算。

    // 开局卡组（2026-09-16 卡牌化）：保底白铁卡 + 购入卡，确定性构造 CardItem 直落
    // inventory + cardAlbum（铁律3 数值归 Code；交锋读背包 type:'卡牌'，卡必须在背包）。
    const starterItems: CardItem[] = STARTER_CARDS.map((c) => cardCatalogToItem(c));
    const boughtItems: CardItem[] = selectedCards.value.map((c) => cardCatalogToItem(c));
    const deckNames = [...starterItems, ...boughtItems].map((c) => c.name);

    return {
      id: charId,
      saveId,
      type: 'player',
      name: name.value.trim(),
      race: race.value === '自定义' ? customRace.value || '人类' : race.value,
      identity: [
        identity.value === '自定义' ? customIdentity.value || '非贵族平民' : identity.value,
      ],
      occupation: [],
      tier: tier.value,
      tierName: tierName.value,
      level: level.value,
      // 🆕 累计表语义（2026-08-24）：totalExp = 升到当前等级所需累计门槛（Lv1 → 0），
      //    expToNext = 当前级累计门槛。与旧 expCap 语义解耦，新档即符合累加式。
      //    level-1 ∈ [1,24] 恒为 number（Lv25 的 level-1=24 有值），as number 安全。
      totalExp: level.value <= 1 ? 0 : (getRequiredXpForLevel(level.value - 1) as number),
      expToNext: xpToNextNumber(level.value),
      attributes: englishAttrs as CharacterState['attributes'],
      freeAttrPoints: 0,
      hp: hpPreview.value,
      maxHp: hpPreview.value,
      mp: mpPreview.value,
      maxMp: mpPreview.value,
      sp: spPreview.value,
      maxSp: spPreview.value,
      // 开局卡组直落（卡面叙事在 buildOpeningPrompt；不再走 item_gen）
      inventory: [...starterItems, ...boughtItems],
      cardAlbum: { owned: deckNames, deck: deckNames, capacity: 60 },
      // 出身天赋（天赋系统 T-S3）：7 选 1 必选，条目逐字来自 TALENT_CATALOG 模板
      ...(selectedCreationTalent.value
        ? (() => {
            const tpl = getCreationCatalog().find((t) => t.name === selectedCreationTalent.value);
            if (!tpl) return {};
            return {
              talents: {
                capacity: 3,
                list: [
                  {
                    name: tpl.name,
                    description: tpl.description,
                    source: 'creation' as const,
                    entries: tpl.entries.map((e) => ({ ...e })),
                  },
                ],
              },
            };
          })()
        : {}),
      skills: [],
      statusEffects: [],
      money: money.value,
      location: startLocation.value === '自定义' ? customStartLocation.value : startLocation.value,
      present: true,
      currentAction: '',
      bloodlineIds: [],
      // 正式字段（规范 §2.1；M6 T2 双写退役完成，customFields 只留真扩展数据）
      gender: gender.value === '自定义' ? customGender.value : gender.value,
      personality: personality.value.trim(),
      appearance: physics.value.trim(),
      background: [backstory.value.trim(), extra.value.trim()].filter(Boolean).join('\n\n'),
      customFields: {
        // M6 T2: saveId/gender/personality/physics/backstory 已升一等字段停写
        age: age.value,
        extra: extra.value.trim(),
      },
    };
  }

  // ═══════════════════════════════════════════════════════
  // 提交: 开场提示词 — 组装自然语言叙事，作为首条用户消息注入管线
  // ═══════════════════════════════════════════════════════
  // 原则：
  // - name / LV / 五维 / HP / race / identity / location → 写死在 CharacterState 字段
  //   → {{CHARACTER_STATE}} system prompt 占位符自动格式化注入
  // - 装备 / 技能 / 物品 / 背景 / 性格身材身世 → 下游 Agent 需要处理
  //   → 组装为自然语言，作为开场 user 消息注入，走 story→request_dispatcher→vars_update 链路

  function buildOpeningPrompt(): string {
    const charName = name.value.trim() || '未命名';
    const lines: string[] = [];

    const openingTime = formatGameTime(createDefaultTime(era.value)).replace(
      /^(.+年)-(\d{2}月)-(\d{2}日)-(周.)-(\d{2}:\d{2})$/,
      '$1$2$3，$4$5',
    );
    lines.push(`${openingTime}，${charName}的故事由此开始。`);

    // 初始金钱（2026-08-08）：把开局经济作为**既成事实**写进开场白，与初始装备同地位。
    // 🔴 防的是「系统权威数值被 AI 叙事覆盖」：story prompt 的 CHARACTER_STATE 里明明有
    //    金钱: N G，AI 却会因为它和「前文推导的金额」对不上，主动判面板为错误、改用叙事值。
    //    保留精确金额，但用世界内语言表达，不把 G 与「开局财产」写成面板播报。
    lines.push('');
    if (money.value > 0) {
      lines.push(`${charName}随身带着 ${money.value} 枚帝冕币，除此之外再无钱财。`);
    } else {
      lines.push(`${charName}身无分文，衣袋里连一枚帝冕币也没有。`);
    }

    // 开局卡组（2026-09-16 卡牌化）：保底卡 + 购入卡，卡面叙事写进开场白。
    // 卡的实物已在 buildCharacterState 确定性落库（铁律3），这里不再给 dispatcher
    // 发清单——避免 item_gen 产出第二份旧版物品。
    const deckCards = [...STARTER_CARDS, ...selectedCards.value];
    if (deckCards.length > 0) {
      lines.push('');
      lines.push(`${charName}的卡匣里贴身放着这些铭卡，每张都已与她心意相通，交锋时可以打出：`);
      for (const c of deckCards) {
        const el = c.element ? `，铭着${c.element}行的铭文` : '';
        const desc = c.description ? `——${c.description}` : '';
        lines.push(`「${c.name}」，一张${c.cardTier}品质的${c.formEntry}卡${el}${desc}。`);
      }
      lines.push('这些卡是她的本命卡组，不是货物，不会出现在交易里。');
    }

    // 角色补充信息
    if (personality.value.trim()) {
      lines.push('');
      lines.push(`${charName}生性${personality.value.trim()}。`);
    }
    if (physics.value.trim()) {
      lines.push('');
      lines.push(`${charName}的身形与外貌给人的印象是：${physics.value.trim()}。`);
    }
    if (backstory.value.trim() || extra.value.trim()) {
      lines.push('');
      lines.push(
        `关于${charName}的来历，已知的是：\n${substituteUser(
          [backstory.value.trim(), extra.value.trim()].filter(Boolean).join('\n\n'),
        )}`,
      );
    }

    // 种族/地点/天赋定制开场（2026-09-17：按种族与出身地生成差异化开场叙事）
    const raceFlavor: Record<string, string> = {
      精灵: '你的耳尖在晨风里微微颤动——风之铭的嫡裔，天生对铭文的波动敏感。',
      兽族: '你的兽裔血脉让你在交锋时直觉比思考更快——有时这是好事，有时不是。',
      血族: '日光刺眼。你眯起眼睛，用斗篷的阴影遮住半张脸——这是血族在本国行走的标准姿态。',
      矮人: '你的矮壮身形在人群中毫不起眼，但腰间那把祖传的锻造锤比你更有名气。',
      人鱼: '你离水的日子已经超过了一年——鳞片在腿侧若隐若现，提醒你大海还在等你。',
      翼民: '你背后的羽翼收拢在斗篷下。在帝国的城市里，展翅是需要许可证的。',
      虫族: '你外骨骼的接缝处偶尔发出细微的咔嗒声——那是虫巢铭阵在远方的共鸣。',
      菌族: '你皮肤上淡绿色的孢子纹路在潮湿的天气里会微微发光——这是菌族的荣，也是被城市人侧目的原因。',
      蛛族: '你的指尖有细小的倒钩——那是蛛后血脉的印记。丝缚术你从小就会，但城市里不常用。',
      晶蜥族: '你的鳞片在阳光下折射出微弱的七彩——那是铭石矿脉赋予晶蜥族的天然庇护。',
      半人马: '你的四蹄踏在石板路上的声音比别人重一倍——但这让你在商队里永远是最可靠的护卫。',
      半身人: '你矮小的身形让你在某些场合被忽视——但在需要钻窄门、走暗巷的时候，这是天赋。',
      天族: '你的气质在人群中格外显眼——天族的铭文是正体，一笔一画都带着秩序的重量。',
      魔族: '你的瞳孔在暗处会微微泛红——魔族的连笔铭文让你天生擅长打破规则。',
      霜巨人: '你的身形比周围的人高出两个头——这既是威慑，也是你在城市里找不到合适床铺的原因。',
      巨龙: '你很少在人前显出真身。在这个大陆上，巨龙是活着的传说——而你就是传说本身。',
      古龙: '你比成文史更古老。你的记忆是碎片——但每一块碎片都比这个国家的全部历史更重。',
      亚龙: '龙血稀释后的印记在你的臂上隐约可见。你不是纯血，但你的爪子依然锋利。',
      北境龙裔: '你的竖瞳在人群中格外醒目——北境龙裔的血脉让你的吐息已经有了雏形。',
      愿灵: '你从某个强烈的祈愿中诞生。被记得多久，你就存在多久——这是你的力量，也是你的枷锁。',
      构装体:
        '你是由魔力驱动的非生命造物。你的每一个动作都精确遵循造物者铭下的指令——直到你开始产生自己的意志。',
      元素生物:
        '你的身体由纯粹元素构成。在人群中你总是保持着元素的形态——火、水、风或土，任选其一。',
      植物生物: '你的皮肤泛着草木的青绿色，指尖偶尔会长出嫩芽。你对季节和土壤的感知远超常人。',
      光翅妖精:
        '你只有巴掌大，透明的羽翅在阳光下近乎隐形。你迷恋歌声和新奇的故事——这也是你走出森林的原因。',
      不定形生物:
        '你的身体没有固定形状——你可以拟态成任何你见过的人或物。这在社交中是天赋，在自我认知中是诅咒。',
    };
    const raceKey = race.value === '自定义' ? '' : race.value;
    if (raceKey && raceFlavor[raceKey]) {
      lines.push(raceFlavor[raceKey]);
    }

    const locationFlavor: Record<string, string> = {
      艾瑟嘉德: '艾瑟嘉德的冒险者公会门口永远排着长队——你从队伍旁边走过，选择了自己的路。',
      '帝都·冕京':
        '帝都·冕京的街比你想象的宽——铭法院的尖顶在雾里若隐若现，那是这个帝国最接近天空的建筑。',
      灰笺矿区:
        '灰笺矿脉的矿工们从你身边经过，身上带着石粉和铁锈的味道。矿脉深处的铭文在山体里隐隐脉动。',
      灰笺老街: '灰笺老街的石板路被几十年的矿车压出了深深的车辙。老街上的每一块招牌都是一个故事。',
      '诺瓦·瓦伦蒂亚城':
        '诺瓦·瓦伦蒂亚城的卡匠工坊区传来火印淬卡的嘶响——这里是半个大陆的卡牌铸造中心。',
    };
    for (const [k, v] of Object.entries(locationFlavor)) {
      if (startLocation.value.includes(k)) {
        lines.push(v);
        break;
      }
    }

    // 出身天赋定制
    if (selectedCreationTalent.value) {
      const talentFlavor: Record<string, string> = {
        节俭持家: '你总能把垃圾变成不那么垃圾的东西——这是你从生活中磨出来的本能。',
        摩托小子: '你只对结构简单的双轮魔动车感兴趣——且颇有手感。',
        封印亲和: '封印物在你面前总是格外温顺——你甚至觉得它们有点可怜。',
        斗志昂扬: '你出手永远带着三分先声——不是狂妄，是习惯。',
        铜筋铁骨: '硬挨一下，不丢人——这是你的信条。',
        卡牌大师: '启封与出手，一气呵成——你的手指比你的大脑更懂卡。',
        天才卡师: '你天生就是吃这碗饭的。',
        '我来!我见!我征服!': '你来了。你见了。接下来，你要征服。',
        卡牌造物主: '你不是在制卡——你是在创造生命。',
        主角光环系统: '命运偶尔也会偏心——而你就是那个被偏心的人。',
        神性火花: '你的灵魂深处有一粒不会熄灭的火——那是天道的余烬。',
        万物皆药: '在你的手里，万物皆是药——毒草是解药，解药是毒药，全看你怎么用。',
      };
      const tf = talentFlavor[selectedCreationTalent.value];
      if (tf) lines.push(tf);
    }

    // 性别声明（2026-09-18 裁决）：**开场白明确写出玩家性别** ——
    // 此前性别完全不进开场白，而本作世界观是「除玩家外万物全雌」，于是 AI 会
    // 顺理成章地把玩家也默认成「她」（真机反馈的首条信息问题）。玩家是「读铭者」、
    // 不在铭中，性别是角色的显性身份、第一轮就该让 AI 知道。
    const genderText =
      gender.value === '自定义'
        ? customGender.value.trim()
        : gender.value === '雄性'
          ? '雄性'
          : gender.value;
    if (genderText) {
      const pronoun =
        genderText === '男' || genderText === '雄性'
          ? '他'
          : genderText === '女' || genderText === '雌性'
            ? '她'
            : null;
      lines.push('');
      lines.push(
        pronoun
          ? `${charName}是${genderText}性，叙事中以「${pronoun}」称呼${charName}。`
          : `${charName}的性别是「${genderText}」，叙事中据此称呼${charName}。`,
      );
    }

    // 收尾：约束首轮叙事流程 —— 先以开局背景为舞台重新演绎（既定事实不变），再自然续写。
    // 🔴 这一句同时是 `{{SKILL_STATE}}` 从开场消息里截取初始技能声明的结束边界
    //    （placeholder-registry 的 isNaturalOpeningSkillEnd），改措辞要同步改那里。
    lines.push('');
    lines.push(
      `以上是${charName}的角色设定与开局剧情。首轮叙事请以「开局剧情」描写的时间地点为舞台：先将这段开场以你的笔触重新演绎（可扩写细节与氛围，不可改变既定事实），再自然续写后续发展。`,
    );

    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════
  // 提交: 写入 DB + 跳转
  // ═══════════════════════════════════════════════════════

  const isCreating = ref(false);
  let creationPromise: Promise<string> | null = null;

  function startJourney(): Promise<string> {
    if (creationPromise) return creationPromise;
    isCreating.value = true;
    creationPromise = persistJourney().finally(() => {
      creationPromise = null;
      isCreating.value = false;
    });
    return creationPromise;
  }

  async function persistJourney(): Promise<string> {
    // 最终持久化边界必须重验；角色预设可以在任一步加载，不能只依赖曾经通过过 Step 1。
    if (!attributesFullyAllocated.value) {
      currentStep.value = 1;
      throw new Error('请先分配全部基础属性点和额外属性点');
    }

    const saveId = crypto.randomUUID();
    const charState = buildCharacterState(saveId);
    const openingPrompt = buildOpeningPrompt();
    console.log('[create-store] startJourney — openingPrompt:', openingPrompt.slice(0, 200));
    console.log('[create-store] startJourney — openingPrompt length:', openingPrompt.length);

    // 存档名：主角名 + 层级 + 日期
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const saveName = `${charState.name} · ${charState.tierName} · ${dateStr}`;

    const save: SaveSlot = {
      id: saveId,
      name: saveName,
      slot: 0, // TODO: 自动分配空闲槽位（多槽位属产品功能非字段规范）
      createdAt: Date.now(),
      updatedAt: Date.now(),
      activeSnapshotId: null,
      metadata: {
        characterName: charState.name,
        userName: '玩家',
        gameStartTime: new Date().toISOString(),
        totalTurns: 0,
        // 空数组 = 引擎按条目 enabled 全量注入（「启用角色」步已删除，不再做存档级收窄）
        enabledWorldBookEntries: [],
        openingPrompt: openingPrompt, // 🆕
        openingPromptConsumed: false, // 🆕
        plotSettings: JSON.parse(JSON.stringify(plotSettings.value)), // §5.2: 本档剧情配置随档落库（含雷点）
      } as any,
    };

    const confirmed =
      (plotMode.value === 'main' || plotMode.value === 'side') && !!plotOutline.value;
    const outline = plotOutline.value
      ? ({
          ...JSON.parse(JSON.stringify(plotOutline.value)),
          saveId,
          ...(confirmed ? { confirmed: true } : {}),
        } as PlotOutline)
      : undefined;
    const input = {
      character: charState,
      save,
      era: era.value,
      experienceMode: experienceMode.value === 'easy' ? ('easy' as const) : ('normal' as const),
      startingPoints: startingPoints.value,
      outline,
      events: confirmed
        ? outlineToEvents(JSON.parse(JSON.stringify(plotOutlineChapters.value)), saveId)
        : [],
    };
    const { createJourney } = await import('@engine/create-journey');
    return createJourney(input);
  }

  /** 成功开局后清除草稿 */
  async function startJourneyAndClearDraft(): Promise<string> {
    const saveId = await startJourney();
    clearDraft();
    return saveId;
  }

  // ═══════════════════════════════════════════════════════
  // localStorage 草稿 — 大纲自动保存/恢复/清除
  // ═══════════════════════════════════════════════════════

  /** 自动保存草稿（大纲生成/修改/回退后调用） */
  function autoSaveDraft() {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          outline: plotOutline.value,
          chapters: plotOutlineChapters.value,
          outlineHistory: outlineHistory.value.slice(-5),
          chaptersHistory: chaptersHistory.value.slice(-5),
          savedAt: Date.now(),
        }),
      );
    } catch {
      /* localStorage full — silently skip */
    }
  }

  /** 尝试恢复草稿，成功返回 true */
  function tryRestoreDraft(): boolean {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      const draft = JSON.parse(raw);
      if (!draft.outline?.title || !draft.chapters?.length) {
        localStorage.removeItem(DRAFT_KEY);
        return false;
      }
      plotOutline.value = draft.outline;
      plotOutlineChapters.value = draft.chapters;
      outlineHistory.value = Array.isArray(draft.outlineHistory) ? draft.outlineHistory : [];
      chaptersHistory.value = Array.isArray(draft.chaptersHistory) ? draft.chaptersHistory : [];
      return true;
    } catch {
      localStorage.removeItem(DRAFT_KEY);
      return false;
    }
  }

  /** 清除草稿（开局成功后调用） */
  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* silent */
    }
  }

  /** 清除当前大纲（回到未生成状态）+ 清草稿；不动角色捏人数据 */
  function clearOutline() {
    plotOutline.value = null;
    plotOutlineChapters.value = [];
    outlineHistory.value = [];
    chaptersHistory.value = [];
    plotGenerationError.value = null;
    isPlotGenerating.value = false;
    clearDraft();
  }

  // ═══════════════════════════════════════════════════════
  // 预设系统
  // ═══════════════════════════════════════════════════════
  const showPresetModal = ref(false);
  const presets = ref<CreatePreset[]>([]);

  function getCurrentPresetData(): Omit<CreatePreset, 'id' | 'name' | 'createdAt' | 'updatedAt'> {
    return {
      difficulty: difficulty.value?.id ?? '',
      character: {
        name: name.value,
        gender: gender.value,
        customGender: customGender.value,
        age: age.value,
        race: race.value,
        customRace: customRace.value,
        identity: identity.value,
        customIdentity: customIdentity.value,
        startLocation: startLocation.value,
        customStartLocation: customStartLocation.value,
        level: level.value,
        basePoints: { ...basePoints.value },
        attributePoints: { ...attributePoints.value },
        money: money.value,
        startingPoints: startingPoints.value,
      },
      cards: [...selectedCards.value],
      plotSettings: plotSettings.value,
      personality: personality.value,
      physics: physics.value,
      backstory: backstory.value,
      extra: extra.value,
      // 剧情大纲本体（含解析出的章节）——此前只存 plotSettings，读回预设时大纲丢失
      plotOutline: plotOutline.value
        ? (JSON.parse(JSON.stringify(plotOutline.value)) as PlotOutline)
        : null,
      plotOutlineChapters: JSON.parse(JSON.stringify(plotOutlineChapters.value)),
    };
  }

  function applyPresetData(data: CreatePreset) {
    selectDifficulty(data.difficulty);
    name.value = data.character.name;
    gender.value = data.character.gender;
    customGender.value = data.character.customGender || '';
    age.value = data.character.age;
    race.value = data.character.race;
    customRace.value = data.character.customRace || '';
    identity.value = data.character.identity;
    customIdentity.value = data.character.customIdentity || '';
    startLocation.value = data.character.startLocation;
    customStartLocation.value = data.character.customStartLocation || '';
    level.value = data.character.level;
    basePoints.value = { ...data.character.basePoints };
    attributePoints.value = { ...data.character.attributePoints };
    money.value = data.character.money;
    startingPoints.value = data.character.startingPoints;
    clearAllSelections();
    // 旧预设的 equipments/items/skills 字段已随卡牌化退役，容错忽略
    for (const card of data.cards ?? []) {
      if (!canSelectCard(card)) continue;
      selectedCards.value = [...selectedCards.value, card];
    }
    personality.value = data.personality || '';
    physics.value = data.physics || '';
    backstory.value = data.backstory || '';
    extra.value = data.extra || '';
    if (data.plotSettings) {
      plotMode.value = data.plotSettings.mode;
      plotTabooContent.value = data.plotSettings.tabooContent ?? '';
      if (data.plotSettings.main) {
        plotDurationYears.value = data.plotSettings.main.durationYears;
        plotAllowNonWorldbookNpc.value = data.plotSettings.main.allowNonWorldbookNpc;
        plotDifficultyTier.value = (data.plotSettings.main.difficultyTier ??
          'adaptive') as typeof plotDifficultyTier.value;
        plotGenrePreference.value = data.plotSettings.main
          .genrePreference as typeof plotGenrePreference.value;
        plotCustomPreference.value = data.plotSettings.main.customPreference;
        if (data.plotSettings.main.chapterCount)
          plotChapterCount.value = data.plotSettings.main.chapterCount;
        if (data.plotSettings.main.eventsPerChapter)
          plotEventsPerChapter.value = data.plotSettings.main.eventsPerChapter;
      }
      if (data.plotSettings.side) {
        plotFocusRegion.value = data.plotSettings.side.focusRegion;
        if (data.plotSettings.side.chapterCount)
          plotChapterCount.value = data.plotSettings.side.chapterCount;
        if (data.plotSettings.side.eventsPerChapter)
          plotEventsPerChapter.value = data.plotSettings.side.eventsPerChapter;
      }
    }

    // 剧情大纲本体：新预设带此字段（可能为 null = 存的时候就没大纲）；旧预设两字段都缺 →
    // 保持当前大纲不动（A 口径，避免「加载旧预设反而清掉刚生成的大纲」）。恢复后清历史并刷新草稿。
    if (data.plotOutline !== undefined || data.plotOutlineChapters !== undefined) {
      plotOutline.value = data.plotOutline
        ? (JSON.parse(JSON.stringify(data.plotOutline)) as PlotOutline)
        : null;
      plotOutlineChapters.value = data.plotOutlineChapters
        ? (JSON.parse(JSON.stringify(data.plotOutlineChapters)) as typeof plotOutlineChapters.value)
        : [];
      outlineHistory.value = [];
      chaptersHistory.value = [];
      autoSaveDraft();
    }

    // 预设入口在全部步骤都可用；晚加载的旧预设若没有完整分配属性，立即返回基础信息页。
    if (!attributesFullyAllocated.value && currentStep.value > 1) currentStep.value = 1;
  }

  // ═══════════════════════════════════════════════════════
  // 重置 — 对齐原版 resetCharacter
  // ═══════════════════════════════════════════════════════
  function resetAll() {
    currentStep.value = 0;
    difficulty.value = null;
    reincarnationPoints.value = 1000;
    name.value = '';
    gender.value = '男';
    customGender.value = '';
    age.value = 18;
    race.value = '人类';
    customRace.value = '';
    identity.value = '非贵族平民';
    customIdentity.value = '';
    startLocation.value = '大陆中东部区域-奥古斯提姆帝国-艾瑟嘉德';
    customStartLocation.value = '';
    level.value = 1;
    basePoints.value = { 力量: 0, 敏捷: 0, 体质: 0, 智力: 0, 精神: 0 };
    attributePoints.value = { 力量: 0, 敏捷: 0, 体质: 0, 智力: 0, 精神: 0 };
    startingPoints.value = 0;
    money.value = 0;
    clearAllSelections();
    plotOutline.value = null;
    isPlotGenerating.value = false;
    plotOutlineChapters.value = [];
    outlineHistory.value = [];
    chaptersHistory.value = [];
    plotGenerationError.value = null;
    plotMode.value = 'off';
    plotDurationYears.value = 5;
    plotAllowNonWorldbookNpc.value = true;
    plotDifficultyTier.value = 'adaptive';
    plotGenrePreference.value = ['combat'];
    plotCustomPreference.value = '';
    plotFocusRegion.value = '';
    plotTabooContent.value = '';
    plotChapterCount.value = 0;
    plotEventsPerChapter.value = 0;
    initPlotDefaultsFromSettings();
    showPresetModal.value = false;
    selectedCreationTalent.value = null;
    talentOffers.value = [];
  }

  return {
    // 内容加载门（D16/D24）
    contentStatus,
    initContent,
    catalog,
    era,
    // 步骤
    currentStep,
    stepValid,
    selectedCreationTalent,
    nextStep,
    prevStep,
    // 难度
    difficulty,
    selectDifficulty,
    // 角色 (→ 变量)
    name,
    gender,
    customGender,
    age,
    race,
    customRace,
    raceOptions,
    identity,
    customIdentity,
    identityOptions,
    startLocation,
    customStartLocation,
    // 起始地树：内容侧供给，名字保持 START_LOCATIONS 以免动 8 个模板消费点
    START_LOCATIONS: startLocationTree,
    flatLocationOptions,
    GENDER_OPTIONS,
    // 角色补充信息
    personality,
    physics,
    backstory,
    extra,
    // 属性 (→ 变量)
    level,
    experienceMode,
    basePoints,
    attributePoints,
    tier,
    tierName,
    tierBonus,
    finalAttributes,
    MAX_BP,
    BP_PER_ATTR_MAX,
    usedBP,
    remainingBP,
    maxAP,
    usedAP,
    remainingAP,
    attributesFullyAllocated,
    addBasePoint,
    removeBasePoint,
    addAttributePoint,
    removeAttributePoint,
    hpPreview,
    mpPreview,
    spPreview,
    // 经济
    reincarnationPoints,
    startingPoints,
    money,
    raceCost,
    identityCost,
    levelCost,
    cardCost,
    moneyCost,
    startingPointCost,
    totalCost,
    remainingPoints,
    // Phase 10h: 世界书驱动
    // P1-5: 工坊项目启用轴（项目级多选）
    // 开局购卡 (→ 卡组直落)
    selectedCards,
    CARD_CATEGORIES,
    activeCardCategory,
    cardPool,
    filteredCards,
    talentOffers,
    rollTalentOffers,
    talentCost,
    isCardSelected,
    canSelectCard,
    toggleCard,
    clearAllSelections,
    // 背景（预设目录 → 基础信息步身世旁挂选择器）
    activeBackgroundCategory,
    backgroundCategories,
    filteredBackgrounds,
    backgrounds,
    // 剧情
    plotMode,
    plotDurationYears,
    plotAllowNonWorldbookNpc,
    plotDifficultyTier,
    plotGenrePreference,
    plotCustomPreference,
    plotFocusRegion,
    plotTabooContent,
    plotChapterCount,
    plotEventsPerChapter,
    plotSettings,
    plotOutline,
    plotOutlineChapters,
    isPlotGenerating,
    plotStreamStats,
    abortPlotGeneration,
    plotOutlineRevealed,
    plotGenerationError,
    outlineHistory,
    exportAIDebugDump,
    lastPlotGenerationMeta,
    generatePlotOutline,
    reviseOutline,
    rollbackOutline,
    initPlotDefaultsFromSettings,
    // 提交
    buildCharacterState,
    buildOpeningPrompt,
    startJourney: startJourneyAndClearDraft,
    isCreating,
    // 模板
    substituteUser,
    // localStorage 草稿
    autoSaveDraft,
    tryRestoreDraft,
    clearDraft,
    clearOutline,
    // 预设
    showPresetModal,
    presets,
    getCurrentPresetData,
    applyPresetData,
    // 重置
    resetAll,
  };
});
