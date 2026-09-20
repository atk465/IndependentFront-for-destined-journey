/**
 * random-event-runtime.ts — 现行随机事件包的**注入缝**（随机事件系统 v1 / 设计 §3.3·§4）
 *
 * 装什么: 「当前装着哪一份事件包」这一个模块级事实。`installRandomEventPack` 由前端
 *         （内容注册表第 13 面 `randomEvents`）在存档加载 / 换包时调用，引擎侧
 *         （`state-manager` 的掷骰与首访钩子、注入块的 resolver）只读。
 * 不装什么: **任何 I/O**（不 fetch、不读 Dexie、不碰内容注册表）、任何容错解析、任何策略。
 *           容错在 `random-event-pack.coerceRandomEventPack`（调用方在装之前过一遍），
 *           调度策略在接线层（`state-manager`）。
 *
 * 为什么要一条缝而不是让引擎自己去读注册表:
 * 逐字同 `map-runtime.ts` 的理由（先例 `engine-settings.ts` / Q-06）—— 引擎要的是
 * 「当前生效的事件包」这个**能力**，不是「某张表」这个位置。让引擎去 import 前端 store
 * 就是把依赖方向反过来。
 *
 * 没装时返回**空包**（零定义 + 默认 config）—— 那是兜底合同不是异常：
 * `isEmptyRandomEventPack` 为真，于是掷骰 / 首访 / 保洁 / 注入四条钩子整段 no-op，
 * 游戏一个字节都不受影响（引擎仓零内置事件，承内容-引擎分离 v1.3）。
 *
 * 🔴 **没有索引缓存**（与 `map-runtime` 刻意不同）：调度器吃的是 `defs` 数组本身
 *    （`rollRandomEvents` / `armFirstVisitEvent` 各自按需建一次 Map），而事件包是几十条
 *    量级、不是 316 块地。加一层缓存只会多出「什么时候失效」这个必须有人记得维护的问题。
 *
 * 🔴 **本文件里不许出现任何中文字面量**（设计 §10，结构闸门 `random-event-literals-gate.test.ts`
 *    按 `random-event-*.ts` 通配自动收本文件）。注释里写中文是对的，闸门只管注释之外的代码。
 *
 * 设计全文: `docs/planning/2026-08-15-random-event-system-design.md`。
 */

import type { RandomEventPack } from './random-event-pack';
import type { RandomEventDef } from './types-random-events';
import { DEFAULT_RANDOM_EVENT_CONFIG } from './types-random-events';

/**
 * 空包工厂。
 *
 * 🔴 **每次返回新对象**，不导出一个共享常量（照 `createEmptyMapPack` /
 *    `DEFAULT_RANDOM_EVENT_CONFIG` 那条注释的同一个理由）：导出的引用被下游 push 一条
 *    定义或改一格 config，此后所有走兜底路径的调用都被污染 —— 而兜底恰恰是没人手工验的那条。
 */
function createEmptyPack(): RandomEventPack {
  return { config: { ...DEFAULT_RANDOM_EVENT_CONFIG }, defs: [] };
}

/** 现行包。没人装过时是空包（兜底合同，见文件头） */
let installedPack: RandomEventPack = createEmptyPack();

/**
 * 开发者自定义探索事件的**独立槽**（委托×地图闭环 2026-09-19：链节终点事件）。
 *
 * 🔴 为什么是独立槽而不是让调用方重装整份包：包由内容注册表第 13 面在换包/读档时装，
 *    而自定义事件随存档走 —— 两条生命周期，塞进同一个安装动作就会出现「装包时自定义
 *    还没灌回 / 灌回后换包把自定义冲掉」的时序赛。两个槽各装各的，读取时合并。
 */
let customDefs: RandomEventDef[] = [];

/**
 * 链节探索事件的隐藏名单槽（玩家删除 seed 事件时记名）。
 */
let chainEventHidden: readonly string[] = [];

export function installQuestChainEventHidden(names: readonly string[] | null): void {
  chainEventHidden = Array.isArray(names) ? [...names] : [];
}

/**
 * 装上开发者自定义探索事件（调用方先过 `coerceCustomEvents` 容错）。
 * `null` = 清空（读档/清存档时调用）。每次换包/清空注册表都必须重装。
 */
export function installCustomEventDefs(defs: readonly RandomEventDef[] | null): void {
  customDefs = Array.isArray(defs) ? [...defs] : [];
}

/** 现行包；没装过 → 空包（判据一律走 `isEmptyRandomEventPack`，不比定义条数） */
export function getRandomEventPack(): RandomEventPack {
  if (customDefs.length === 0) return installedPack;
  // 自定义覆盖同名内置（开发者显式创建的同名事件意味着「我要替换它」）
  const customNames = new Set(customDefs.map((d) => d.name));
  return {
    config: installedPack.config,
    defs: [...installedPack.defs.filter((d) => !customNames.has(d.name)), ...customDefs],
  };
}

/**
 * 装上一份包。**刻意不做容错**（keep dumb）：入参必须是已经过 `coerceRandomEventPack`
 * 的包 —— 在这里再收窄一遍就等于有两处容错口径，而两处不一致时先出错的那一处永远没人手工验。
 *
 * 两个运行时闸都只是「不是包」：
 *   · `null`（显式卸包 —— 换存档 / 内容注册表这一面缺席）
 *   · 不是对象 / `defs` 不是数组（跨模块 JSON 边界上 TS 类型拦不住 `undefined`）
 * 两者都落成空包（= 没装）比让调度钩子在读 `pack.defs` 时抛穿好 —— 随机事件整个是**可选**子系统。
 *
 * 🔴 **`config` 三种「没给」一视同仁**（`null` / `undefined` / 不是对象，2026-08-16 审查修复）：
 *    此前只挡了 `null`，于是一份手搓的 `{ defs: [...] }`（`coerceRandomEventPack` 的产物
 *    永远带 config，但跨模块边界与测试替身不受它约束）会被装进来，随后在读
 *    `config.offerTtlDays` 的地方抛 —— 而那些地方全在 try/catch 的调度钩子里，
 *    表现是**随机事件整段静默失效**，一条报错都看不到。补默认（**不碰 `defs`**）而不是
 *    整包拒收：定义是好的，缺的只是三个旋钮，而旋钮本来就有缺省。
 */
export function installRandomEventPack(pack: RandomEventPack | null): void {
  if (pack === null || typeof pack !== 'object' || !Array.isArray(pack.defs)) {
    installedPack = createEmptyPack();
    return;
  }
  const config: unknown = pack.config;
  const configUsable = config !== null && typeof config === 'object' && !Array.isArray(config);
  // 补默认时造一份新对象，**不就地改入参**（调用方那份包可能还被别处引用）
  installedPack = configUsable
    ? pack
    : { config: { ...DEFAULT_RANDOM_EVENT_CONFIG }, defs: pack.defs };
}

/**
 * 回到「没装过」（测试用）。
 *
 * 模块级状态在 vitest 里跨用例存活，装过真包的用例不还原就会让后面每一个「空包应当整段
 * no-op」的断言悄悄测在一份真包上 —— 那种失败方向是**变绿**，不是变红。
 */
export function resetRandomEventRuntime(): void {
  installedPack = createEmptyPack();
  customDefs = [];
  chainEventHidden = [];
}
