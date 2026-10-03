# 伙伴实体化执行任务书（FLASH 执行版）

> **执行模型必读**。本文档是 `2026-10-02-companion-entity-design.md`（设计真源，先通读）的**落码约束规格**。
> 你（执行模型）没有参与设计访谈。**本文档给定的数值、文件、函数签名就是全部规格——你不发明任何东西**。
> 批次节奏：一次只跑一批（批① → 停 → 真机验收 → 批② …）。当前授权批次见文末「当前授权」。

---

## 〇、你的边界与 STOP 规则（最高优先级）

**你只做本任务书「当前授权批次」明确列出的改动。**

遇到以下任一情况，**立即停止并在汇报中说明，不要自行决策、不要绕过**：

1. 规格与代码现状冲突（如行号漂移、函数签名不符——行号以函数名/代码原文定位为准，漂移不冲突；语义冲突才停）；
2. 需要本任务书未给出的数值、枚举值或文件形状；
3. 改动会触碰「禁改清单」（§一.7）；
4. `npm run gates` 失败且原因不在你本次改的代码；
5. 发现设计文档与本任务书矛盾（以本任务书为准，但必须报告）。

**禁止**：顺手重构、格式化无关文件、改注释语气、删任何既有测试、「顺手修复」路上看到的 bug（记录进汇报即可）。

---

## 〇-bis、规格修订记录（2026-10-03 执行后规划侧裁决——与正文冲突时**以本节为准**）

> 来源：批②~⑤连续执行后的「规格外情况汇总」。逐项裁决如下；正文相应条文不再回改，冲突处以本节为准。

- **R1 资源写入口（认可偏离，原口径作废）**：正文 B2.4/B2.5/B3.1/B3.2/B3.7 中所有 `update_character { hp / mp / sp / totalExp / max* }` 字样的资源写入，一律按引擎**资源专线令**（commit 4468b6b，先于本任务书存在——规划侧漏察）执行为 `set_hp / set_mp / set_sp / set_max_* / delta_*` 专线 op。执行侧已正确偏离，规格追认。后续任何批次写资源字段禁用 update_character。
- **R2 战斗记账缝（追认为正式规格）**：session / BeatOptions 增补的可选字段 `companionMpSpent`、`companionGuardTransfers`、`agility`、`threatModPct`、`guardContext`、`companionGuardSeed` 为正式规格成员（正文只定义了 `companionGuard`，其余为结算/判定必需的记账缝，设计合理）。`companionBaseOf` 签名定稿：返回形状含 `maxHp`（guard 建账需要）、第三参可选 `inventory`（B4.3 effective 面板；旧调用零改动）。
- **R3 批④佩戴通路裁决（退役，不补码）**：正文 B4.1 的「type='装备' 按 equippedSlot 映射槽位」是**规划侧规格 bug**——`equippedSlot` 是物品状态非固有属性（types.ts:1112「null/undefined = 躺背包」），卸下即失槽位类别，与 B4.2「未被玩家佩戴」资格构成死锁（执行侧记录属实）。裁决：**type='装备' 佩戴通路退役，佩戴面=装备卡（→hand）only**，`companionEquipSlotOf` 现状保留（不可达分支无害）。正确补法（unequip_item 在 data 袋记 `佩戴槽位`）属引擎 op 体改动、贴禁改清单红线，记入设计文档 D10 已知限制，**本期不做**。终验收预期：佩戴区候选只有装备卡。
- **R4 knip 基线 +1（认可）**：`LEVEL_CAP_BY_TIER` 批⑤已消费，棘轮记录有效。
- **R5 B5.2 弧光缝（规划侧补缝规格，唯一遗留码工）**：见批⑤节末 **B5.2b**。授权 FLASH 执行此一项（含测试），完成后 gates 达标即全项目收尾。

---

## 一、全局红线（每一批都适用）

1. **纯函数叶**：`src/sillytavern/card-workshop/` 下的代码零 I/O、零 `import vue/pinia/Dexie`、随机源一律由调用方注入参数（照 `companion-capture.ts` 的 `rng` 模式）。副作用只允许出现在 `game-store.ts` / `game-pipeline.ts` / `state-manager.ts`。
2. **分层**：`src/sillytavern/**` 禁止 import 前端（eslint `no-restricted-imports` 已拦，别挑战它）。
3. **单写入口**：一切持久化经 `StatePatch[]` + `createStateManager(saveId).commitChatState(patches)`；禁止直写 Dexie、禁止绕过 state-manager 改内存对象后不落库。
4. **AI 零编数**：所有数值来自本任务书的表或既有代码的表。AI 侧链只允许产出：名字、描述文本、机制 kind（白名单内）、元素子集（⊆卡词条）。
5. **测试**：每个新纯函数配同目录同名 `*.test.ts`（vitest，风格照 `companion.test.ts`：本地工厂函数 + `describe/it` + 纯值断言）。**既有测试一个不删**；只允许按本任务书明示的字面量映射（`白铁→黑铁`）同步改断言。
6. **customFields 袋纪律**：伙伴扩展数据一律放 `character.customFields.companion`（形状见 §二.1），**读写必须经 `card-workshop/companion.ts` 导出的门禁函数**，其他文件不许裸读裸写该袋。
7. **禁改清单**（本任务书未明确点名的文件里，以下绝对不动）：`state-manager.ts` 的 op 分发表结构、`placeholder-registry.ts`、`tests/` 顶层守门四件（no-world-content / ip-terms-gate / layering-gate / placeholder-content）、世界书与内容包 JSON（除 §三.A 明示的两份占位 JSON）、`agent-orchestrator.ts`、`char-gen-agent.ts`。
8. **每批收尾必跑** `npm run gates`（= typecheck + typecheck:vue + build + format:check + lint + knip:ratchet + test:run），全绿才算完成。

---

## 二、公共规格（五批共用，一次定死）

### 2.1 伙伴实体数据挂载（架构决策，不许偏离）

**能复用的 CharacterState 既有字段，一律复用，零新增顶层字段**：

| 语义      | 字段（既有）                       | 说明                                            |
| --------- | ---------------------------------- | ----------------------------------------------- |
| 等级/经验 | `level` / `totalExp` / `expToNext` | 伙伴经验满 `expToNext` → `level+1`，管容见 §2.5 |
| 五维面板  | `attributes.{str,dex,con,int,spi}` | 攻/防/敏为派生值（§2.3）                        |
| HP/MP/SP  | `hp/maxHp/mp/maxMp/sp/maxSp`       | HP 语义＝挡刀池＋退场条（设计 D6）              |
| 性格      | `personality`                      | 制卡叙事提取，AI 叙事面                         |
| 天赋      | `talents`                          | 骨架池复用（批④）                               |

**伙伴扩展袋**（新增，形状定死）——`customFields.companion`：

```ts
/** 伙伴扩展袋（customFields.companion）。读写仅经 companion.ts 门禁函数。 */
export interface CompanionBag {
  /** 出生品阶快照（进化仪式升档后同步更新） */
  bornTier: CardTier;
  /** 佩戴表（批④落码；批①只建袋留空对象） */
  equip: { hand?: string; body?: string; charm?: string };
  /** 进化进度（批⑤落码；批①只建袋留默认值） */
  evolution: {
    archetype?: '炽野' | '贯城' | '镜影';
    routeName?: string;
    routeDesc?: string;
    unlocked: boolean;
    offerings: string[];
  };
}
```

`origin: 'summon_card'` 与 `ownerName` 维持在 `customFields` 顶层（既有约定键，不动）。

**沉眠（D4）不存储、纯派生**：`isCompanionDormant(cardName, inventory)` ＝ 玩家 inventory 中同名卡（type:'卡牌'）数量为 0。沉眠的叙事出口＝`update_character { present: false }`；唤醒＝重新获得同名卡时 `ensure` 已存在同名实体则 `update_character { present: true }`。判定与触发时机见 §三.D。

### 2.2 黑铁替换（D14）总规格

- `CARD_TIERS = ['黑铁', '青铜', '白银', '鎏金', '星辉'] as const`（`field-enums.ts:29-30`）。
- **值全部不变，只换键名/字面量**：`'白铁'` → `'黑铁'`。
- 需同步的位置（完整清单，逐项打勾）：
  - 枚举：`field-enums.ts:30`；
  - 显式 `Record<CardTier,…>` 表 14 张：card-dismantle.ts:28、deck-power.ts:17、card-craft-plan.ts:45、defeat-compensation.ts:68（含 :64 缺省参数）、card-fusion.ts:42 与 :53 `TIER_ORDER`、fortune-draw.ts:32/:38、repair.ts:38、multiplier.ts:202、partner-alchemy.ts:38（含 :70）、skirmish.ts:50（含 :397 读侧兜底）、unsealing.ts:19/:31/:44、companion.ts:21；
  - 宽类型同形表 2 张：card-strip.ts:22（含 :79 兜底）、entry-combat.ts:227；
  - 兜底/分界字面量约 20 处（`?? '白铁'`、`lv<=4→'白铁'`、`普通/优良→'白铁'` 等）：card-devour.ts:55/57/58/88、card-smelt.ts:101-103/115/184/243/256-258/359、craft-talent-bonus.ts:65、companion-capture.ts:26-33/136-138/211、item-card-bridge.ts:24-27、opponent-blueprints.ts:119、unequal-exchange.ts:79、soul-weapon.ts:92、CardAlbumPanel.vue:51、fortune-draw.ts:55；
  - 文案（玩家/AI 可见）：talent-entry.ts:7876（「白铁卡牌」→「黑铁卡牌」）、content-templates.ts:56/59（计价文案）、start-catalog-mechanics.ts:119/:183 注释；
  - 注释里的「白铁」（模块头注释一批：card-devour/card-dismantle/card-fusion/deck-power/entry-combat/fortune-draw/item-card-bridge/material-gacha/defeat-compensation/companion-growth/multiplier、ItemsPanel.vue:137、CreateStepSelections.vue:7、create-store.ts:1379、quality-colors.ts:74/77）；
  - 数据：`public/data/content/catalog.json:331/349/358/366/384` 的 `"cardTier": "白铁"`、`commissions.json:2` 的 $comment；
  - 测试断言（全表/字面量）：field-enums.test.ts:46、deck-power.test.ts:28/41-96、skirmish.test.ts:45、unsealing.test.ts:26/29/32、fortune-draw.test.ts:17-19/42-44、item-card-bridge.test.ts:9-22、craft-card.test.ts:50/101/131/139、craft-rank.test.ts:28-29、repair.test.ts:41-45、card-devour.test.ts:37/43-50、card-strip.test.ts:32-35、companion-capture.test.ts:29/99、companion-growth.test.ts:139-165、card-effects.test.ts:39/514、card-fusion.test.ts:27/32、card-smelt.test.ts:107-126、card-craft-narrate.test.ts:100、commission-runtime.test.ts:16、content-pack-plan.test.ts:561、catalog-effects.test.ts:59、defeat-compensation.test.ts:16、free-card-play.test.ts:28-133、entry-combat.test.ts:78-142、mental-resources.test.ts:62、multiplier.test.ts:153-206、opponent-blueprints.test.ts:94、s-batch2.test.ts:137-138、s-batch3.test.ts:84-85、ss-batch3.test.ts:190-210、ss-finale.test.ts:25-50、talent-strength.test.ts:135/186/247、item-gen-chain.test.ts:139、state-manager.add-item-card.test.ts:71、create-store.test.ts:41、game-pipeline.test.ts:1502、CardAlbumPanel.test.ts:153-155、card-display.test.ts:82-86、CraftBench.test.ts:66-181。
  - **不在影响面**：`tests/` 顶层守门（grep '白铁' 零命中）、世界书、内容包主体。
- **旧档读入映射**：`field-enums.ts` 新增导出
  ```ts
  /** 旧档兼容：'白铁' 读入即映射为 '黑铁'（D14 全面替换）；非法值兜底最低档。 */
  export function normalizeCardTier(v: unknown): CardTier;
  ```
  实现规格：`v === '白铁' → '黑铁'`；`CARD_TIERS.includes(v) → v`；否则 `'黑铁'`。接线两处：①`state-manager.ts` add_item/update_item 卡牌字段直通段对 `cardTier` 调用之；②读侧不做全量遍历（依赖写侧归一，旧档在首次任意写入时自然改写；若验收发现旧档显示旧词，记入汇报，不得自行加全量迁移）。

### 2.3 面板公式（D7 定稿数值——FLASH 零发明空间）

> 艾拉卡面数字（HP320/攻72…）是**风味参照**，不是验收数字；以本公式产出为准。

**初始面板**（获得即诞生时，纯函数 `companion-panel.ts`，新建于 card-workshop/）：

```ts
/** 品阶基数（五维点总量基数） */
const PANEL_BASE: Record<CardTier, number> = { 黑铁: 20, 青铜: 28, 白银: 36, 鎏金: 46, 星辉: 58 };
/** 评级系数 */
const RATING_COEF: Record<CraftRating, number> = {
  大失败: 0.8,
  失败: 0.9,
  成功: 1.0,
  精益求精: 1.15,
};
/** 元素轴权重：命中轴 +3/元素，未命中轴 1（按卡词条内全部元素累计；无元素全 1） */
const AXIS_BONUS = 3;
```

- 五维点总量 `T = round(PANEL_BASE[品阶] × RATING_COEF[评级]) + Σ(素材 tier) × 2`（素材 tier 取 recipe 内主/副素材的品质档，读不到按 1）；
- 权重：初始全 1，卡词条每命中一个元素，`CARD_ELEMENT_AXIS[元素]` 对应轴 +3（双元素=双轴加权）；
- 各维 `= max(1, floor(T × 该维权重 / Σ权重))`；余数按权重降序逐维 +1 分完；
- `maxHp = 30 + con × 8`；`maxMp = 15 + int × 6 + spi × 4`；`maxSp = 20 + con × 4`；hp/mp/sp 初始=满值；
- 评级取 `recipe.rating`（无 recipe——购卡/捕获等目录入口——按 `'成功'`，素材项取 0）；
- `tier/tierName` 沿用 `buildSummonCompanion` 现有推导（TIER_INDEX 黑铁=0）；`level = 1`；`expToNext` 见 §2.5。

**升级成长**（批③用，此处定死）：每级 +3 五维点（按当前权重比分进各维）、`level+1` 后按上面 HP/MP/SP 公式**重算** max 值并等比抬当前值。

**忠诚事件表**（批③用）：投喂成功 +3、并肩战斗结算 +2、挡刀 +5、HP<30% 仍强制出战 −4；经 `delta_affection` op 落账（target=`affections.<伙伴名>`，amount=表值）。

### 2.4 攻/防/敏派生（批②用，此处定死）

复用既有派生形状（`derived-stats.ts`），基座换成伙伴实体：

- 攻（直击/技能基座）`= 2 × 主轴五维 + level`（主轴＝卡首元素经 `CARD_ELEMENT_AXIS`，无元素兜底 str——即 `deriveCardAtk` 语义，基座换伙伴五维与伙伴 level）；
- 防（挡刀承伤减伤）`= con`（承伤 `= 转移伤害 − floor(防/2)`，对齐玩家公式形状）；
- 敏（先攻/克制修正）`= dex`（具体接入点批②任务书细化）。

### 2.5 经验管容（批③用，此处定死）

伙伴 `expToNext` ＝ `CARD_EXP_CAP[品阶]`（黑铁 200 … 星辉 3200，沿用现有表）。满管：`totalExp` 清管累计、`level+1`、按 §2.3 升级成长重算、`expToNext` 重取当前品阶。

### 2.6 效果元素轴（批⑤用，此处定死）

- `CardEffectDef` 加 `element?: string[]`；
- `coerceCardEffects` 校验：若带 `element`，必须非空数组且 ⊆ 该卡词条元素集（校验时需把卡词条传入门禁——签名变更是预期内的，全仓调用点同步）；违规整条丢弃（不剪裁、不救）；
- 克制取优：结算时混合元素 `克制加成 = max(各元素克制加成)`，不叠加；
- 无 `element` 字段的行为与现状完全一致。

---

## 三、批①任务书（指令级——当前授权批次）

> 目标：黑铁替换全链 + 伙伴实体新地基（新面板公式/扩展袋/获得即诞生主通道/休眠—唤醒）。
> 顺序：A → B → C → D，每个任务完成后跑 `npx vitest --run 相关测试文件` 自检，最后跑 `npm run gates`。

### 任务 A：黑铁替换（§2.2 全清单）

**改动**：按 §2.2 清单逐项替换 + `normalizeCardTier` 新增与两处接线 + 测试断言同步。
**DoD**：`grep -r '白铁' src/ public/data/content/catalog.json public/data/content/commissions.json` 零命中（docs/ 与 CHANGELOG 不算）；`field-enums.test.ts` 的全表断言已改为黑铁版且绿。
**新测试**：`field-enums.test.ts` 补 `normalizeCardTier` 三分支（'白铁'→'黑铁'、合法透传、非法兜底）。

### 任务 B：companion.ts 改造 + companion-panel.ts 新建

**B1** `card-workshop/companion-panel.ts`（新建，纯函数）：按 §2.3 实现

```ts
export function buildCompanionPanel(input: {
  cardTier: CardTier;
  rating: CraftRating;
  词条: string[];
  materialTiers: number[];   // 素材品质档合计的来源数组；空=目录入口
}): { attributes: {...五维}; maxHp: number; maxMp: number; maxSp: number; auditLine: string };
```

`auditLine` 格式：`面板：{品阶}基数 × 评级「{rating}」{coef} + 素材{S}×2 → 力{str}/敏{dex}/体{con}/智{int}/神{spi}，HP{}/MP{}/SP{}`（进制卡审计与战报）。
**B2** `companion.ts` 改造 `buildSummonCompanion`：保留签名与 seed/personality/appearance/background 逻辑；面板段（attributes/hp/mp/sp/tier/level/expToNext）换成 `buildCompanionPanel` 产出（level=1）；`TIER_INDEX` 黑铁=0；`customFields` 增 `companion: CompanionBag`（bornTier=卡品阶、equip 空对象、evolution 默认 `{unlocked:false, offerings:[]}`）。
**B3** `companion.ts` 新增门禁导出：

```ts
export function companionBagOf(entity: CharacterState): CompanionBag | null; // 读：缺袋/形状非法返回 null，不抛
export function isCompanionDormant(cardName: string, inventory: InventoryItem[]): boolean;
```

**新测试**：`companion-panel.test.ts`（双元素加权、无元素、评级系数、余数分配、目录入口缺省四组）；`companion.test.ts` 改造既有断言（新面板）+ 补 companionBagOf 门禁三分支 + isCompanionDormant 两分支。
**DoD**：旧断言中与旧公式（2+idx 五维、40+idx×30 HP）绑定的用例改为新公式期望值；`grep 40 + idx` 在 companion.ts 零命中。

### 任务 C：获得即诞生——主通道接线（8 处）

统一模式（每处同构，禁止发明变体）：

```ts
// 在该入口「卡牌 add_item patch」的同一次 commitChatState 数组里，追加：
...(needsFirstSummon(card.name, this.game.characters.map(c => c.name))
    ? [{ op: 'add_character', target: 'characters',
         value: buildSummonCompanion({ card, seed?, saveId: activeSaveId.value,
           playerName: playerChar.name, location: playerChar.location }) } as StatePatch]
    : []),
// 已存在同名实体（沉眠唤醒）：追加 update_character { name?, present: true } 的 patch
//（update_character 的定位键规格：读 game-store 内既有 update_character 用法照抄口径）
```

**接线矩阵**（8 处主通道；未列的入口靠任务 D 的兜底保留覆盖）：

| #   | 入口           | 位置                                                                                         | seed 来源                                             |
| --- | -------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | 制卡主路       | game-store.ts craftCard patch 组装段（~:2183-2260）                                          | 无（personality 走 fallback，批③接叙事提取）          |
| 2   | 制卡 AI 链     | craft-gen-chain.ts :741-790（制卡 industry 分支）                                            | 无                                                    |
| 3   | 开局保底+购卡  | create-store.ts :1381-1382（STARTER_CARDS / selectedCards）                                  | catalog 的 companion 字段（`cardCatalogToItem` 上游） |
| 4   | 命运祭坛抽卡   | game-store.ts :1524-1533                                                                     | fortunePool 的 companion                              |
| 5   | 命运骰 card 面 | game-store.ts :2879-2890                                                                     | 同上                                                  |
| 6   | 捕获敌人       | game-store.ts :3228 附近（已有 add_character——**改为 ensure 语义**：查重后构造，替代原直调） | plan 内 CompanionSeed                                 |
| 7   | 孕育子嗣       | game-store.ts :3288-3309（已有 add_character——同上改 ensure）                                | plan 内                                               |
| 8   | 多卡融合       | game-store.ts :3065-3080（fuseCards）                                                        | 无                                                    |

注意：只有「产物词条含 `cardKindOf(词条)==='召唤'`」才 ensure（用 `isSummonCard`，军团卡自然排除）。**等价交换/魂武器/物品桥/测试种子四类入口本批不接**（兜底覆盖）。
**新测试**：game-store 层若无既有测试基建则不硬写 store 测试，改为在 craft-gen-chain / companion 侧补纯函数用例；接线正确性进真机验收清单。
**DoD**：8 处接线后 `npm run typecheck` 绿；兜底段（skirmish-settlement.ts:98-115）原样保留未删。

### 任务 D：休眠—唤醒触发

- **出口**：game-store 新增私有 helper `checkCompanionDormancy(cardName: string)`：inventory 同名卡计数（Σ quantity）== 0 且存在同名 type:'summon' 实体 → 同窗提交 `update_character { present: false }`。接线三处：出售通道、拆解通道（card-dismantle 的 store 调用处）、战斗消耗（skirmish-settlement patches 组装处——若该处在纯构建器内，则在 game-pipeline 接线侧加 patch）。
- **入口**：任务 C 的 ensure 分支已覆盖唤醒（present:true）。
- **新测试**：`isCompanionDormant` 用例已在 B3；出口接线进真机验收。
- **DoD**：卖光一张召唤卡 → `game.characters` 中该实体 `present === false`（真机）。

### 批①验收清单（真机，验收者执行）

- [ ] 制卡（地脉髓+炎心草，召唤类 intent）→ 产物卡可用（CRAFT-1/2 已修前提）→ **同窗**出现 add_character：type:'summon'、黑铁、level 1、面板=新公式、customFields.companion 在位
- [ ] 旧档读入：cardTier:'白铁' 的卡在任意写入后变 '黑铁'；不做写入则显示旧词（记录，不算失败）
- [ ] `grep -r 白铁 src/` 零命中；`npm run gates` 全绿（含 8000+ 用例）
- [ ] 卖光同名召唤卡 → 实体 present:false；重新购回 → present:true、等级/经验未丢
- [ ] 普通卡（无召唤词条）制卡/购卡 → **不**诞生实体
- [ ] 既有普通卡 cardExp/cardPowerBonus 行为不变（skirmish 分成用例绿）

---

## 四、批②~⑤ 指令级任务书（2026-10-03 规划侧全量刷新，连续执行）

### 批① 验收记录（2026-10-03 规划侧，代码级）

- ✅ DoD 全过：`白铁` 全仓零残留（含测试）；`normalizeCardTier` 三分支 + state-manager 双接线（add :1525 / update :1604）；`companion-panel.ts` 常量与公式逐值吻合（PANEL_BASE{20/28/36/46/58}、RATING_COEF、AXIS_BONUS=3、HP/MP/SP 公式、审计行）；`CompanionBag` + `companionBagOf` 门禁 + `isCompanionDormant`；获得即诞生接线（game-store/craft-gen-chain/create-store）；休眠出口 `checkCompanionDormancy` 已接出售（game-store:4525）与拆解（:3112）。
- ✅ `npm run gates` 全绿：Test Files 372 passed、Tests 8346 passed | 8 skipped、exit 0。**Errors 2 = 并行线 `GamePage.abort-on-unmount.test.ts` 既有未处理拒绝**，与本批无关，作为基线记录——后续批次该计数变化即停。
- ✅ 休眠三出口全部在位：出售/删除（game-store `checkCompanionDormancy`）、拆解（同 helper）、**战斗消耗（game-pipeline:4149-4169 内联 `isCompanionDormant`，按 patch 后库存口径）**——初验时按 helper 名 grep 漏检了第三出口，已复核纠正；消耗类与召唤类 kind 互斥致其今日不触发，属面向未来的正确接线，保持勿动。
- 真机验收项（实体诞生/沉眠唤醒/黑铁显示）留待终验收统一执行。
- 附注（执行会话自查）：docs/templates 三件的白铁替换是 card-pool.test.ts 守门强制（任务书清单未列，执行方正确扩展）；CapturePlan/OffspringPlan 无 seed 字段，按缺省铭灵接线（与规格「plan 内 CompanionSeed」的偏差，可接受）；corruptCompanion/devour 燃料/smelt 三条召唤卡离手通道未接沉眠检查——**折入批② B2.0 一并补齐**。

---

### 批② 战斗接入（指令级）

**B2.0 补齐残余离手通道**：批①三出口已全覆盖在售通道（出售/删除、拆解、战斗消耗 game-pipeline:4149-4169），但 `corruptCompanion` / card-devour 燃料 / card-smelt 三条召唤卡离手通道未接沉眠检查——照 `checkCompanionDormancy(cardName, removingQty)` 同一语义（patch 后库存口径 + 同窗 `update_character { present: false }`）补接三处；战斗结算接线已在，本批改动 settlement 时保持其不被回归。

**B2.1 基座改道**：`card-workshop/companion-panel.ts` 新增纯函数

```ts
export function companionBaseOf(
  card: Pick<CardItem, 'name' | '词条'>,
  characters: CharacterState[],
): { attributes; level; mp; maxMp; hp; name } | null;
```

条件：`isSummonCard(card)` && 按名找到实体 && `present === true` && `companionBagOf(entity)?.injured !== true`。接线三处（game-pipeline.ts 出卡 `cardPlayPlan` 直击 power 与 MP 门槛段、`skillContextOf` mainDerivation、entry-combat.ts 召唤直击/压场的 stats 来源）：命中时用实体的 `attributes/level/mp` 替代玩家值，未命中照旧。军团/装备/领域不受影响（isSummonCard 已排除军团）。玩家其余派生（`deriveCombatStats` 等）一律不动。

**B2.2 敏捷修**：`agilityBonus = min(3, floor(dex / 10))`（dex = 基座命中的伙伴敏捷）。`skirmish.ts` `resolveBeat` 反制掷骰加可选参（默认 0，零回归）；audit 行追加 ` + 敏捷X`；基座未命中不生效。

**B2.3 挡刀**：新建 `card-workshop/companion-guard.ts` 纯函数：

```ts
export function planGuardTransfer(input: {
  incoming: number;
  con: number;
  guardHp: number;
  loyal: boolean;
  hasReceiveHitPassive: boolean;
  exited: boolean;
}): { transferred: boolean; playerDamage: number; companionDamage: number } | null;
```

- 转移条件：`!exited && guardHp > 0 && (loyal || hasReceiveHitPassive)`；loyal = `saveProfile.affections[guardName] >= 30`；hasReceiveHitPassive = 同名卡 `cardEffects` 存在 `trigger === '受击时'` 的条目。
- 转移结算：`companionDamage = max(1, incoming − floor(con / 2))`，玩家承 0；audit `▸ 【名】挡刀：承伤X −⌊防Y/2⌋ = Z`。
- 接线：`skirmish-session.ts` session 增可选字段 `companionGuard?: { name; hp; maxHp; con; exited }`——基座命中的召唤卡首次打出时建立（`cardPlayPlan` 传入，同名卡重复打出不重建）；玩家承伤落账处（resolveBeat 结果应用点）插 planGuardTransfer，维护 guard.hp。
  **新测试**：`companion-guard.test.ts`（条件矩阵：忠诚/passive/exited/hp 边界；减伤下限 1）。

**B2.4 退场与重伤**：guard.hp ≤ 0 → `exited = true`（此后拍不再转移、敏捷修失效、该实体压场停止，audit「【名】退场」）。settlement（`buildSkirmishSettlementPatches`）：guard 存在时——`hp > 0` → `update_character { hp: guard.hp }` + `delta_affection +2`；`hp ≤ 0` → `bag.injured = true` + `hp: 0` + `delta_affection −4`（audit「重伤」）。`CompanionBag` 增 `injured?: boolean`（companion.ts 接口 + `buildSummonCompanion` 缺省 false + `companionBagOf` 不因缺该键判非法）。

**B2.5 MP**：B2.1 命中时，出卡 MP 门槛与扣费对象 = 实体 mp（不足走既有玩家 MP 不足同分支语义）；settlement 时 `update_character { mp: entity.mp − cost }`（下限 0）。压场/直击不耗 MP（照玩家现状）。

**批② DoD**：`npm run gates` 全绿（Errors 计数 = 基线 2）；companion-guard/panel 新测试绿；战报明细含「挡刀/退场/敏捷」审计行（真机项，留终验收）。

---

### 批③ 成长（指令级）

**B3.1 升级内核**：`companion-panel.ts` 新增纯函数 `applyCompanionExp(entityLite, rawExp, cardTier)`（entityLite = {level, totalExp, attributes, maxHp, maxMp, maxSp, hp, mp, sp, 词条}）：

- `LEVEL_CAP_BY_TIER = { 黑铁: 10, 青铜: 14, 白银: 18, 鎏金: 22, 星辉: 25 }`（新表，export）；
- `expToNext = CARD_EXP_CAP[cardTier]`（复用 skirmish 既有表，import）；
- 循环：`totalExp ≥ expToNext && level < cap` → `level+1`、`totalExp −= expToNext`、**+3 五维点**按当前词条元素权重比分入（照 §2.3 权重算法）、`maxHp/maxMp/maxSp` 按公式重算、`hp/mp/sp` 抬升同 Δmax（不超新 max）；
- 到 cap：溢出经验丢弃，auditNote「已达品阶上限——需进化蜕变」；
- 返回全量 update_character 字段 + auditLines。

**B3.2 投喂改道**：`game-store.ts` `feedCompanion`（:2502，函数名锚定，行号可漂移）：`planFeedCompanion` 的 rawExp/matchLabel/summary 照旧；实体在（按卡名查）→ patch 改为 `update_character(applyCompanionExp(...))` + `delta_affection +3` + **injured 清除**（若 injured：清标记、hp/mp/sp 回满，audit「伤愈」）；实体缺 → 旧路 `update_item {cardExp…}`（零回归兜底）。`trainCompanion`（:2425 调教）**不改**（卡面战力语义，非实体成长）。

**B3.3 战斗分成改道**：`skirmish-settlement.ts:72-97`：召唤卡且同名实体存在 → `update_character(applyCompanionExp(gain))`；否则旧 `applyCardExp`。`cardExpGain`（50% 折半）不变。

**B3.4 旧档迁移**：批① ensure/唤醒分支补：实体在且 `card.cardExp > 0` → 同窗 `applyCompanionExp(card.cardExp)` + `update_item { cardExp: 0 }`（幂等：迁后 cardExp=0 不再触发）。

**B3.5 性格提取**：`card-craft-narrate.ts` prompt 增 `<personality>` 段（一句话 ≤40 字，性格+对主人的依恋倾向）；解析失败回落 `desc 首句截 40 字`；`craft-gen-chain` 与 `game-store.craftCard` 两路把 `personalityOverride` 传入 `buildSummonCompanion`（input 增可选字段，缺省回落既有兜底文案）。

**B3.6 L2 意图 brief**：`game-pipeline.ts` 意图解析 cards brief 组装处：召唤卡 brief 追加 `｜性：${personality.slice(0, 24)}`（只影响 L2 选择倾向，不入数值）。

**B3.7 忠诚事件表**（全部 `delta_affection` op，target `affections.<伙伴名>`）：投喂 +3（B3.2）；战斗有召唤卡出场且 guard 存活 +2（B2.4 settlement 已计）；每次挡刀 +5（B2.3 转移成功计数，settlement 汇总）；战斗结束 guard.hp < 30% → −4（与 B2.4 重伤 −4 去重：单场单次，取最重一档）。

**批③ DoD**：gates 全绿；applyCompanionExp 测试（多级连升/cap 钳制/权重分布/Δmax 抬升）、迁移幂等、性格回落各成组。

---

### 批④ 装备+天赋（指令级）

**B4.1 槽位映射**：`card-workshop` 新纯函数 `companionEquipSlotOf(item): 'hand'|'body'|'charm'|null`——`type==='装备'`：武器/副手→hand；头部/身体/手部/脚部/腰带→body；饰品→charm；`type==='卡牌' && cardKindOf(词条)==='装备'` → hand；其余 null。

**B4.2 佩戴 ops**：`game-store` 新增 `equipCompanionItem(cardName, itemName)` / `unequipCompanionItem(cardName, slot)`：校验物品在玩家 inventory、slotOf 非 null、**未被玩家佩戴**（`equippedSlot` 为空）；目标槽旧物自动卸回（bag.equip 覆写即卸）；写 `bag.equip`（`companionBagOf` → 改 → `update_character { customFields: {...customFields, companion: bag} }` 整袋写回）。物品不转移、quantity 不动（背借用）。

**B4.3 面板加算**：`companion-panel.ts` 新增 `companionEffectivePanel(entity, inventory)`：attributes = 实体五维 + Σ 佩戴装备物品 `stats` 中 `str/dex/con/int/spi` 数值键（其余键忽略）；装备卡佩戴仅语义位不加算。B2.1 `companionBaseOf` 改用 effective 面板（内部替换，签名不变）。

**B4.4 佩戴拦截**：`companionWearingNames(characters): Set<string>`；三入口前置校验：出售（game-store:4525 附近）、拆解（:3112 附近）、祭出（cardPlayPlan）——命中返回 `{ ok: false, reason: '伙伴佩戴中——先卸下' }`。

**B4.5 UI**：`CardAlbumPanel.vue` 详情节新增佩戴区（三槽 chip + 背包候选下拉 + 卸下按钮），照 E 批附魔区交互模式；disabled 态给原因文案。

**B4.6 伙伴天赋池**：`card-workshop/companion-talent.ts` 新纯表（kind 全部取**既有** TalentEntryKind，channel 全 `'universal'`，Code 路径直写、**不经 state-manager 天赋门禁**）：

| kind       | params 基数   | 语义（引擎消费点）                     |
| ---------- | ------------- | -------------------------------------- |
| 行动值加成 | bonus 4       | 基座行动值 +bonus                      |
| 防御加值   | bonus 3       | 伙伴防派生 +bonus                      |
| 体魄       | bonus 10（%） | maxHp ×(1+pct/100)                     |
| 威压       | bonus 8（%）  | session 威胁 ×(1−pct/100)              |
| 嗜血       | bonus 15（%） | guard.hp<30% 时行动值 ×(1+pct/100)     |
| 暴击       | bonus 8（%）  | 反制掷骰暴击判定（照玩家既有暴击语义） |

品阶系数：黑铁1.0 / 青铜1.25 / 白银1.5 / 鎏金1.8 / 星辉2.2，round 取整。`companionTalentOf(entity)`：读 `talents.list[0]` entries 命中池返回 {kind, params}。
**AI 选 kind**：craft narrate 增 `<talent_kind>`（限池内 kind 名）与 `<talent_name>`（≤12 字）；回落表：火→嗜血 / 暗→暴击 / 土→体魄 / 金→防御加值 / 雷·风→行动值加成 / 水·冰·光→威压 / 无元素→行动值加成；name 回落 `${品阶}·${kind}`。`buildSummonCompanion` 写 `talents: { capacity: 1, list: [{ name, description, source: 'universal', entries: [{ kind, channel: 'universal', params }] }] }`。

**B4.7 天赋消费接线**：B2.1/guard 建立处与 `resolveBeat` 组装处读 `companionTalentOf`，按上表消费（行动值/防御/体魄/威压在基座与 guard 建立；嗜血/暴击在 roll 组装）。

**批④ DoD**：gates 全绿；slotOf 表 / effective 加算 / pool 系数 / 消费纯件测试成组。

---

### 批⑤ 进化仪式+混合伤害（指令级）

**B5.1 祭品与门槛**：`companion-growth.ts` 新纯函数与表：

- `ARCHETYPE_ELEMENTS = { 炽野: ['火'], 贯城: ['金','土'], 镜影: ['水','冰','光','暗'] }`（export）；
- `planEmbedOffering(card, material, archetype)`：材料元素（`toMaterial(material).elements`）与 ARCHETYPE_ELEMENTS[archetype] 有交集 且 素材品质档 index ≥ 当前卡档 index → 通过；上限 3 份（`bag.offerings.length < 3`）；通过 → `remove_item` + bag.offerings append；
- `planCompanionEvolution(entity, card, affections)`：四门槛 `level ≥ LEVEL_CAP_BY_TIER[cardTier] && archetype 已选 && offerings.length === 3 && affections[cardName] ≥ 50` → plan（否则逐项 reason）。

**B5.2 仪式 commit**：`game-store` 新增 `evolveCompanion(cardName)`：

- `update_item { cardTier: newTier, recipe: {...recipe, tier: newTier}, sealed: isHighTierCard(newTier) }`（升到鎏金/星辉按既有规则封印）；
- `update_character`：+6 五维点按权重分入、maxHp/maxMp/maxSp 重算、hp/mp/sp 回满、`bag.bornTier = newTier`、offerings 清空、`evolution.unlocked = false`（下轮循环）、talents params 按新品阶系数重算（B4.6）；
- `background` 追加弧光句（narrate 缝 `<evolved>` 一句话，失败跳过不阻塞）；
- audit 行：品阶/面板/天赋标号/忠诚检查。

**B5.3 UI**：`CraftBench.vue` 倾向区扩展——祭品嵌入按钮（背包材料按 ARCHETYPE_ELEMENTS+档位过滤）+ 仪式按钮 + 四门槛实时显示（等级上限/倾向/祭品 n/3/忠诚）。

**B5.4 效果元素轴**：`CardEffectDef` 增 `element?: string[]`；`coerceCardEffects(effects, allowedElements)`——带 element 时须非空数组 && ⊆ allowedElements（= 卡词条元素集），违规**整条丢弃**；全仓调用点 `grep -rn "coerceCardEffects("` 同步签名（start-catalog-mechanics:163 / card-enchant / craft-gen-chain / registerCardEffects / 读侧门禁）；无 element 字段行为完全不变。

**B5.5 技能轨取优**（对设计文档 D15 的显式重锚）：效果带 `element[]` 时，该效果的技能轨主轴派生 = **max(各元素对应五维值)**（不叠加）；audit「混合轴」。**roll 的克制不参与**——战斗克制是标签制（行动标签命中意图反制标签 → ⌈威胁/2⌉，skirmish.ts:224），元素不在 roll 克制内。设计文档 D15 已同步修订。

**B5.6 最终兵器回归**：`game-pipeline.ts:3840-3867` 战后自动进化线**不改动**；跑 free-card-play / companion-growth 相关测试确认绿。

**批⑤ DoD**：gates 全绿；planEmbedOffering 矩阵（元素/档位/上限）/ planCompanionEvolution 四门槛 / coerce element 子集 / 技能轴取优测试成组。

**B5.2b 弧光缝（R5，规划侧补缝——原 B5.2 中「narrate 缝 `<evolved>`」未给形状，现补齐）**

- 新纯函数叶 `card-workshop/companion-evolve-narrate.ts`：
  - `buildEvolutionArcMessages(input: { name: string; personality?: string; archetype?: string; routeName?: string; routeDesc?: string; fromTier: CardTier; toTier: CardTier })` → messages。system 纪律（文风红线要点，逐条写入 prompt）：**一句话白描、≤30 字、禁空洞形容词（强大/神秘/古老）、从蜕变机制与既有性格推导、只输出 `<arc>…</arc>` 标签**。
  - `parseEvolutionArc(response: string): string | null`——`tagInner` 取 `<arc>`，trim，超 30 字截断，空 → null（照 craft-gen-chain 的 tagInner 既有工具口径）。
- `game-store.ts` `evolveCompanion(cardName, arcImpl?)`：`arcImpl?: (input) => Promise<string | null>`，**缺省 null＝跳过（与现状行为一致）**；arc 非空时并入同一个 `update_character` patch（`background = background ? background + '\n' + arc : arc`），不另开提交窗。
- `game-pipeline.ts` 装配处接线（照 `craftNarrateImpl` 注入缝同款）：用 clientFactory.chat 调 messages；失败/超时/空一律返回 null，**绝不阻塞仪式 commit**。
- **DoD**：纯函数测试（parse 三分支：正常/无标签/超长截断）＋ gates 全绿。此为全项目最后一个码工，完成即收尾待终验收。

---

## 五、汇报模板（每批结束时输出）

```
## 批 N 汇报
- 改动文件清单（路径 + 每文件一句话）
- 新增测试文件与用例数；改动断言的既有测试清单
- npm run gates 结果（原样贴尾部）
- 规格外情况记录（STOP 触发/绕行/发现的 bug——只记录不修）
- 自检清单勾选（DoD 逐条）
```

---

## 当前授权：**B5.2b 弧光缝（R5）——全项目最后一个码工**

- 批②~⑤已连续执行完毕（合并汇报已交）。剩余授权仅一项：**B5.2b**（§四 批⑤节末，R5 补缝规格），含纯函数测试；完成后 `npm run gates` 达标（Tests 全过 + Errors=基线）即收尾，输出一小节汇报（照 §五 模板裁剪）。
- 之后的流程：**主人真机终验收**（一次性）——制卡→实体诞生→面板/审计→战斗基座/挡刀/退场→投喂升级/忠诚→佩戴（预期候选只有装备卡，见 R3）→祭品/仪式进化→「裂牙炎斩」混合轴；用例卡「愤怨瓷心·艾拉」。终验收后由主人处置工作树提交。
- 行号漂移不冲突：所有 `文件:行号` 锚以函数名/代码原文定位为准。
