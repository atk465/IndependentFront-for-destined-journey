# 交接文档 —— 伙伴实体化（批①~~⑤ + 规格裁决 R1~~R5）实机测试指南（2026-10-03）

> 写给**零上下文接手的 AI Agent**：本文件只讲「**这批改动怎么验收**」。
> 环境准备、dev 启动姿势、门禁棘轮、Agent 行为守则**全部沿用** [`2026-10-01-agent-testing-handoff.md`](2026-10-01-agent-testing-handoff.md)——先读它，再回来。
> 立项与规格：[`2026-10-02-companion-entity-design.md`](2026-10-02-companion-entity-design.md)（16 决议）＋ [`2026-10-02-companion-entity-execution-flash.md`](2026-10-02-companion-entity-execution-flash.md)（指令级任务书，**§〇-bis 裁决 R1~R5 是规格最终态，与正文冲突以此为准**）。
> 触发用例：[`../../../playtest-tools/card-craft-gap-report-2026-10-02.md`](../../../playtest-tools/card-craft-gap-report-2026-10-02.md)——「愤怨瓷心·艾拉」是全程端到端验收用例卡。

## 一、这批做了什么

把「伙伴」从一张战斗道具卡升级为**独立实体**（实体为主、卡为媒），五批全部落码：

| 批            | 一句话                                                                                                                                     | 关键字                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| ① 地基        | 获得召唤卡即按卡名诞生 type:'summon' 实体（黑铁起步/新面板公式/性格）；卡全离手→沉眠、再得→唤醒续接；**黑铁全面替换白铁**                  | companionEnsurePatches、companion-panel、normalizeCardTier        |
| ② 战斗        | 召唤卡打出后数值基座从玩家换成**伙伴面板**；挡刀（忠诚≥30 或受击时被动）、HP 归零退场+重伤（不死不销卡）、MP 走实体                        | companion-guard、companionBaseOf、companionGuard                  |
| ③ 成长        | 投喂/战斗分成经验**改道实体**（升级 +3 点按元素偏置）；忠诚=affections 视图+引擎事件（投喂+3/并肩+2/挡刀+5/重伤−4）；制卡叙事提取性格      | applyCompanionExp、LEVEL_CAP_BY_TIER、personalityFromDesc         |
| ④ 装备+天赋   | 佩戴表三槽（**佩戴面=装备卡 only**，见 R3）；装备 stats 并入面板加算区；伙伴天赋池 6 kind（复用既有 TalentEntryKind，AI 选 kind 引擎定标） | companionEquipSlotOf、companionEffectivePanel、companion-talent   |
| ⑤ 进化+元素轴 | 仪式型蜕变：倾向 archetype→嵌 3 份祭品→忠诚≥50→品阶+1/面板回满/天赋重定标；效果可选 element[] 轴（⊆词条门禁，技能轨主轴**取优**）          | ARCHETYPE_ELEMENTS、planCompanionEvolution、CardEffectDef.element |

规格裁决速记（详见任务书 §〇-bis）：R1 资源写入走 set_hp/set_mp/set_sp 专线（update_character 写资源是旧口径）；R2 session 记账缝 6 字段追认；**R3 装备物品佩戴退役（equippedSlot 非固有属性，引擎无背包装备槽位真源）→ 佩戴候选只有装备卡，别报缺**；R4 knip 基线+1；R5 弧光缝已落码（companion-evolve-narrate.ts）。

## 二、代码状态（🔴 先读，别踩）

- 分支 `card-workshop-mvp`，HEAD `eacea59`——**工作树未提交改动 = 本线全部五批**（大批量 M + 新文件，`git status` 可见；含并行线 values-table 审定标记 `M docs/planning/2026-09-30-*` 不归本线）。
- 🔴 测试 Agent **不提交**；🔴 禁止 `git add -A`；🔴 `knip:ratchet` 只读别 update（基线已 +1＝LEVEL_CAP_BY_TIER，正常）。
- 终验 gates 已绿：**374 文件 / 8385 用例全过，Errors = 2**（GamePage.abort-on-unmount 并行线既有未处理拒绝）——**此后判据＝Tests 全过 + Errors 恰为 2**，计数变化先二连跑再定性。

## 三、开工三件事

```bash
# 1. 基线（判据见 §二）
npm run test:run
# 2. 起 dev（固定 5173；cd 必须在子 shell 内）
( cd /d/BaiduNetdiskDownload/hermagent/IndependentFront-for-destined-journey && npm run dev > /tmp/dev-server.log 2>&1 & )
# 3. 内容包：本线改了 public/data/content/catalog.json（白铁→黑铁占位），运行时 fetch 即生效，无需重装；
#    但若页面文案出现「白铁」残留 → 来源是 Dexie 旧装包缓存（世界书/预设），重装 2.9.8 pack 再验；
#    仍残留则查资产仓 dist 是否需重建（build-pack 时序教训：改完内容必须重建 dist）。
```

## 四、测试存档与数据准备（一次造好）

1. **捏人**：智力拉高（制卡轴）；天赋 12 抽选 2 **最好含【调教大师系统】**（调教 trainCompanion 门槛；**投喂 feedCompanion 不需要**，CMP-06 勘误）＋【最终兵器：她】可选（最终兵器自动进化线回归用；**不再 gate 常规仪式**——没抽到不影响批⑤验收）。GC 留足（祭品素材/仪式/购卡）。
2. **召唤卡来源（三条路，任选其一即可开链）**：
   - 开局卡池选 1 张召唤卡（最快）；
   - `game.seedDemoCards()` 种演示卡（历史行为含召唤卡「远古巨兽·岩爪」，以实测 dump 为准——见 §五 API）；
   - 制卡直产：`game.craftCard({ mainName:'地脉髓', subNames:['炎心草'], intent:'<艾拉 intent 原文，见 card-craft-gap-report §2.1>' })`——⚠️ 产物是否带「召唤」形态词条由融合推导决定；**若产物无召唤词条 → 该卡不触发实体化，记观察项，不算 bug**（形态推导规则不在本线范围）。
3. **素材**：龙血草×3（投喂同源 ×2）；祭品素材若干（见 §五.⑤ 门槛表：炽野要火、贯城要金/土、镜影要水/冰/光/暗，素材品质档 ≥ 当前卡档）；一张**装备卡**（词条含「装备」形态，佩戴验收用）。
4. **页面进入可靠路径**（首页「继续」若有问题，NAV-1 修复是并行线）：`Page.reload` → `game.loadSave(id)` → `ui.navigate('game', id)`。

## 五、API 速查（CDP 取句柄 + store 函数签名）

```js
// 每个脚本开头（照 R8-craft-direct.js 同款）：
const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
const g = pinia._s.get('game'); // game store；ui store 同理 _s.get('ui')
```

| API                        | 签名                             | 说明                                                         |
| -------------------------- | -------------------------------- | ------------------------------------------------------------ |
| `g.craftCard`              | `({mainName, subNames, intent})` | 制卡主路（真 LLM）                                           |
| `g.seedDemoCards`          | `()`                             | 种演示卡/素材                                                |
| `g.setEvolutionDirection`  | `(cardName, routeId)`            | 倾向三选一：'炽野'\|'贯城'\|'镜影'                           |
| `g.feedCompanion`          | `(cardName, materialName)`       | 投喂（无需天赋；需天赋的是调教 trainCompanion——CMP-06 勘误） |
| `g.equipCompanionItem`     | `(cardName, itemName)`           | 佩戴（装备卡→hand；候选=装备卡 only）                        |
| `g.unequipCompanionItem`   | `(cardName, slot)`               | slot: 'hand'\|'body'\|'charm'                                |
| `g.embedCompanionOffering` | `(cardName, materialName)`       | 嵌祭品（元素∩+档位≥卡档+上限3）                              |
| `g.evolveCompanion`        | `(cardName, arcImpl?)`           | 进化仪式（UI 走无 arc 缺省；弧光句跳过=正常）                |

**实体检视样例**（所有断言的取数口）：

```js
const c = g.characters.find((x) => x.type === 'summon' && x.name === '<卡名>');
// 期待字段：c.level / c.totalExp / c.expToNext / c.attributes{str..spi} / c.hp,c.maxHp / c.present / c.personality / c.talents?.list[0]
const bag = c.customFields.companion;
// bag 形状：{ bornTier, equip:{hand?,body?,charm?}, evolution:{archetype?,routeName?,routeDesc?,unlocked,offerings[]}, injured? }
g.player.inventory.filter((i) => i.type === '卡牌' && i.词条.includes('召唤')); // 召唤卡清单
g.saveProfile.affections['<卡名>']; // 忠诚账本（同一账本）
```

## 六、逐批验收清单（步骤 → 预期；括号 = 改坏先跑的测试）

### ① 地基：获得即诞生 / 黑铁 / 沉眠唤醒（companion.test.ts / companion-panel.test.ts / field-enums.test.ts）

1. 获得一张召唤卡（任一路径）→ **同窗**出现 `type:'summon'` 实体：`cardTier` 同卡档（黑铁起步）、`level 1`、`customFields.companion` 袋在位（bornTier=卡档、offerings:[]）、personality 有值（制卡路径=AI 叙事提取；目录路径=种子/兜底文案）。
2. 全 UI 与卡册 grep「白铁」→ 零出现；品阶显示一律黑铁/青铜/白银/鎏金/星辉。
3. 卖/拆/耗光全部同名卡 → `entity.present === false`（沉眠，实体还在）；重新获得同名卡 → `present === true` 且等级/经验/忠诚原样接回（唤醒续接）。
4. 获得普通卡（无召唤词条）→ **不**诞生实体。
5. （可降级为代码检视，真机构造难）corruptCompanion / devour 燃料 / smelt 三条离手通道同接沉眠检查——单测已绿（B2.0）。

### ② 战斗：面板基座 / 挡刀 / 退场（companion-guard.test.ts / skirmish.test.ts）

1. 组一张召唤卡进卡组 → 打一场（强敌 hint 触发，照 WT6 做法）→ 打出召唤卡那拍的战报：直击/技能数值基座 = **伙伴面板**（自算对照：`2×主轴五维 + level`，主轴=卡首元素经 火/金→力、水/冰→神、雷/风→敏、土→体、光/暗→智）。
2. 战报出现敏捷修行（`+ 敏捷X`，X=min(3, ⌊敏/10⌋)）。
3. **挡刀**：先让忠诚 ≥30（投喂几次即可）→ 敌方高威胁拍 → 战报出现 `▸ 【名】挡刀：承伤X −⌊防Y/2⌋ = Z`、玩家该拍不掉血、伙伴 HP 下降；忠诚 <30 且卡无受击时被动 → 不转移（玩家正常承伤）。
4. **退场**：把伙伴 HP 打空（低防伙伴吃几场，或直接改实体 hp=1 再打）→ 战报「【名】退场」；战后实体 `hp===0`、`bag.injured===true`、忠诚 −4；**卡不被销毁**；下一场该卡打出受 MP/重伤限制（injured 实体不接管基座）。
5. MP：带 cost 的技能效果 → 扣的是实体 mp（`set_mp` 专线）；实体 mp 不足 → 走玩家 MP 不足同款拒绝语义。

### ③ 成长：经验改道 / 忠诚 / 性格（companion-growth.test.ts / companion-panel.test.ts）

1. 投喂（龙血草喂火系伙伴）→ 回执同源 ×2；实体 `totalExp` 增、满 `expToNext` → `level+1` 且面板 +3 点按元素偏置分布（火系攻涨得快）、maxHp/MP/SP 重算；**卡面 cardExp/cardPowerBonus 不动**（普通卡机制零回归——同时用一张普通卡打一场确认分成照旧走卡面）。
2. 投喂一次 → `affections[卡名]` +3；并肩打赢一场（召唤卡出场且存活）→ +2；每次挡刀 → +5。
3. **伤愈**：injured 实体投喂 → `injured` 清除、hp/mp/sp 回满。
4. 战斗分成：召唤卡参战 → 实体 totalExp 增（=玩家战斗经验×50% 同额）。
5. 制卡新产一张召唤卡（带性格 intent）→ 实体 `personality` ≈ 意图性格（AI `<personality>` 段；失败回落 desc 首句 40 字——两种都算通过）。
6. `{{CHARACTER_STATE}}`（story prompt 探针照 B-probe-prompt.js）可见伙伴性格段；交锋意图解析的卡简报带 `｜性：…`（≤24 字）。

### ④ 装备 + 天赋（companion-panel.test.ts / companion-talent.test.ts / CardAlbumPanel.test.ts）

1. 卡册详情佩戴区：三槽 chip（手部/身位/灵位）；**候选列表 = 装备卡 only**（`type='装备'` 物品不可佩戴是 R3 裁决的既定限制，**别报缺**）。
2. 装备卡给伙伴佩戴 → `bag.equip.hand` 有值；effective 面板 = 实体五维 + 装备 stats 五维键；卸下 → 回落。
3. 佩戴中的装备卡：出售/拆解/祭出全部被拦（`'伙伴佩戴中——先卸下'`）。
4. 天赋：实体 `talents.list[0]` 恰 1 条——制卡路径名字来自 AI（`<talent_name>`≤12 字）、kind 在 6 kind 池内（行动值加成/防御加值/体魄/威压/嗜血/暴击）；AI 未给时按元素回落（火→嗜血/暗→暴击/土→体魄/金→防御加值/雷风→行动值加成/水冰光→威压），名字=`${品阶}·${kind}`。
5. 落场观察（任选其二）：威压→敌方威胁降低；嗜血→伙伴 HP<30% 行动值提升；暴击→战报暴击行；体魄→maxHp 抬升。

### ⑤ 进化仪式 + 元素轴（companion-growth.test.ts / card-effects.test.ts / CraftBench.test.ts）

1. 倾向三选一（制台倾向区）→ `bag.evolution.archetype/routeName` 写入；`setEvolutionDirection` 返回 ok。
2. 祭品嵌入：符合元素∩（炽野=火 / 贯城=金·土 / 镜影=水·冰·光·暗）且素材档 ≥ 卡档 → `bag.evolution.offerings` 增；违规组合被拒；第 4 份被拒（上限 3）。
3. 四门槛 UI 实时显示（等级达 LEVEL_CAP：黑铁10/青铜14/白银18/鎏金22/星辉25；倾向已选；祭品 n/3；忠诚≥50）——未满时仪式按钮 disabled 带原因。
4. 仪式（可用 API 直接调 `g.evolveCompanion('<名>')`）→ 卡 `cardTier`+1、实体 +6 点按权重分入、hp/mp/sp 回满、`bag.bornTier` 更新、offerings 清空、`talents` params 按新品阶系数重算（黑铁1.0→青铜1.25…）；升到鎏金/星辉 → 卡 `sealed:true`（照高阶封印规则）。
5. 弧光句：仪式后 `background` 可能多一句（AI 生成，失败=跳过）——**跳过不算 bug**；有则须 ≤30 字白描、无「强大/神秘/古老」类空洞词（文风红线）。
6. **最终兵器回归**：持该天赋打一场 → 战后自动进化线照旧（克制铭文），不被仪式改动破坏。
7. 元素轴：制卡/精配产出的效果带 element[] → 技能轨按「混合轴」取优结算（战报 `混合轴` 审计行）；门禁（element ⊆ 卡词条元素集，违规整条丢）单测已绿，真机观察制卡产物即可、构造违规用例可降级为代码检视。

## 七、已知噪音与测试红线

1. 沿用 2026-10-01 §四全部噪音条目；ENV-1（dev 长跑进不去游戏页 → 重启 dev）；ENV-2（headless 先 `window.confirm = () => true`）。
2. **战斗克制是标签制**（行动标签命中意图反制标签 → ⌈威胁/2⌉）——**别用「元素克制」的直觉预期战斗数值**；元素只进技能轨派生与微差轨。
3. **数值纪律观察点**：AI 全程不得编数（效果逐字池内定值、正文不报结算数字）；天赋/性格/弧光只产文本与 kind，params 必须等于品阶系数表值。
4. **有意不做清单（别报缺）**：R3 装备物品佩戴；性格不入引擎数值（只叙事+L2 软贴合）；调教 trainCompanion 不改（卡面战力语义）；伙伴永久死亡不进引擎（重伤−不死）；忠诚负值=怨怼侧（黑化叙事空间，非 bug）。
5. 星辉已无更高档 → 星辉满级实体经验溢出丢弃 + 提示「需进化蜕变」是**预期行为**（进化到顶后自然停止成长）。
6. 守则 §九全部沿用；测试 Agent 不提交；两连跑再定性 flaky。

## 八、bug 记录约定

- 新建 `playtest-tools/bug-list-for-fix-2026-10-03.md`，体例照抄 [`bug-list-for-fix-2026-10-02.md`](../../../playtest-tools/bug-list-for-fix-2026-10-02.md)（编号/级别/现象/复现/证据链/主责候选/验收）。
- **与并行线（values-table 批次 6 真机三场）分两张表**；每条注明复现步骤与当时内容包版本。
- 涉及规格争议的（如「我觉得装备物品应该能佩戴」）→ 先查任务书 §〇-bis 裁决，**裁决过的不要当 bug 报**。

## 九、命令速查

```bash
npm run test:run                                                    # 基线（374 文件，判据 Tests 全过+Errors=2）
npx vitest --run src/sillytavern/card-workshop/companion.test.ts    # ① 实体/沉眠
npx vitest --run src/sillytavern/card-workshop/companion-panel.test.ts  # ①②④ 面板/基座/佩戴
npx vitest --run src/sillytavern/card-workshop/companion-guard.test.ts  # ② 挡刀
npx vitest --run src/sillytavern/card-workshop/companion-growth.test.ts # ③⑤ 成长/进化
npx vitest --run src/sillytavern/card-workshop/companion-talent.test.ts # ④ 天赋池
npx vitest --run src/sillytavern/card-workshop/companion-evolve-narrate.test.ts  # ⑤ 弧光缝
npx vitest --run src/sillytavern/card-workshop/card-effects.test.ts     # ⑤ 元素轴门禁
node ../playtest-tools/cdp.mjs evalfile <脚本>.js                   # CDP 取证主通道
```
