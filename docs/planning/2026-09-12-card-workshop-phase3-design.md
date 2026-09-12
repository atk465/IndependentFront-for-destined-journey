# 卡牌工坊 阶段 3：卡组战力 + 制卡桥 + 委托系统设计

- 日期：2026-09-12
- 分支：`card-workshop-mvp`
- 承接：`2026-09-12-card-workshop-mvp-design.md` / 交接档案 §9 阶段 3
- 状态：**3a / 3b 引擎半已实施（本文同日）**；3b 委托内容面为后续工作（§4）

## 1. 卡组战力（3a，已实施）

`card-workshop/deck-power.ts`，纯函数：

```
单卡战力 = 品质权重（白铁1 青铜2 白银3 鎏金4 星辉5）+ 2 × 复合词条数
卡组战力 = Σ 编入卡（同名多张逐张计；查不到实物的名字按 0 跳过）
```

- 复合词条 = 相生产物（燎原/霜冻/磁暴/虹耀/焚影），集合由 `card-fusion.ts`
  导出的 `SYNERGY_PRODUCTS` 派生（不许手抄第二份）。
- 用途：委托难度档的对照值（§4）；卡册面板摘要行常驻显示。
- 公式刻意简单且全部可复现 —— 委托叙事只需要一个稳定的档位锚点。

## 2. 制卡桥（3b 引擎半，已实施）

「制卡」行业走既有 craft 链（`<craft_request>` marker / craft_gen Agent /
craft_check → craft_settle 工具，骰带与 DC 全部既有），唯一变化是**主产物的组装方式**：

```
industry=制卡 且 craft 成功
  → 解析 craftParams.materials 名单（顿号/逗号/分号/换行；首个=主素材）
  → 对照制卡师背包解析成 MaterialSpec（material.ts：品质→tier、data.price 优先估价、
     元素字面推导；查不到的名字静默跳过 —— 不让一次拼写失误炸掉制作链）
  → fuse() 确定性组装 CardItem（tier/词条/造价/封印）
  → buildCraftPatches 第 4 参 cardProduct：主产物 add_item 原样落库
```

- **AI 只做两件叙事事**：提名素材、给卡起名。数值一个都不碰（ADR-11 / 铁律3）。
- craft 链的评级（DC+骰带，既有确定性）仍是**成败判官**；融合内核决定**这张卡是什么**。
  两层正交：`rating`（成败）写进 recipe；`cardTier`（品质）来自素材。
- 失败路径完全不变（item_gen 残料链）。
- item_gen 产出与卡同名的 equipment/inventory 条目让位（防同名双份落库）。
- 封印规则：鎏金/星辉产物 `sealed: true`（types.ts CardItem.sealed「高阶卡封印物」语义），
  启封判定见 `2026-09-12-card-workshop-phase2-unsealing-design.md`。

实现：`card-workshop/craft-card.ts`（纯函数）+ `craft-gen-chain.ts` 接线
（`buildCraftPatches` 第 4 参 + `runCraftGenChain` 组装点）。

## 3. craft_settle 工具路径的口径（未改，说明为什么）

craft_settle（agent-tools）只提交消耗/奖励 patch，主产物由 runCraftGenChain 的
buildCraftPatches 落库 —— 制卡桥因此**只改链上这一处**就同时覆盖 marker 路径与
Agent 循环路径。若未来发现某条生产路径绕过 buildCraftPatches 落产物，届时把
buildCardItem 挪进共享层即可（桥是纯函数，搬家零成本）。

## 4. 委托系统（3b 内容半，设计定案、后续实施）

世界观：冒险公会发布制卡委托；制卡师接单炼卡，交付赚 GC 与声望。

- **委托承载 = 任务系统条目**（复用既有 quests：按名寻址、reward 提示词、手动/自动
  完成），**不新造实体**（铁律④）。委托板 UI（后续）：从任务列表筛 `制卡委托` 分组。
- **难度档 = 卡组战力对照**：委托按战力分档（例：白银档委托要求战力 ≥ 15 才接），
  档位表随内容包/世界书携带，引擎不写死数值。
- **交付链路（复用 marker 协议，零新协议）**：
  玩家接单 → story 演绎炼制过程 → 输出 `<craft_request industry="制卡" ...>` →
  §2 制卡桥产卡（确定性字段）→ 交付与结算由既有任务/vars_update 管线捕获。
- **开放问题（实施前需拍板）**：
  1. 委托数据进内容包第几分节 vs 世界书条目（倾向前者，照随机事件先例）；
  2. 委托奖励里「指定卡牌」的验收判据（按名？按 tier 档？倾向 tier 档）；
  3. 声望账本挂 profile 变量还是新字段。
- 以上拍板前**不动 quests / content-pack 结构** —— 委托叙事现在就能跑通
  （世界书写委托 + 制卡桥产卡 + 手动交付），结构化是锦上添花。

## 5. 边界（不变）

- 不碰 `combat-v3/`（阶段 4 地景卡除外，届时独立开发独立提交）。
- 不做真抽牌；随机性只在启封判定（阶段 2）与 craft 骰带（既有）。
- 枚举中文集中 field-enums；逻辑键=名字；每类数据唯一真源。
