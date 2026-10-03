# 交接文档 —— 卡牌六批（A–F）实机测试指南（2026-10-02）

> 写给**零上下文接手的 AI Agent**：本文件只讲「**这批改动怎么验收**」。
> 环境准备、dev 启动姿势、门禁棘轮、Agent 行为守则**全部沿用** [`2026-10-01-agent-testing-handoff.md`](2026-10-01-agent-testing-handoff.md)——先读它，再回来。
> 本批的立项与落地记录：[`2026-10-02-card-display-borrow-backlog.md`](2026-10-02-card-display-borrow-backlog.md)（六批待办全文，含每批的落地记录与证据指针）。

## 一、这批做了什么

对标一款竞品截图做的六批改造，全部已落码：

| 批次 | 一句话                                                              | 关键字                              |
| ---- | ------------------------------------------------------------------- | ----------------------------------- |
| A    | 卡册详情渲染卡牌战斗面（效果/战技/副轴）                            | CardAlbumPanel、card-display        |
| B    | 卡组内容进叙事 AI（`{{CARD_DECK}}` 占位符＋交锋意图解析带定值简报） | 内容包 2.9.8                        |
| C    | 伙伴养成：进化倾向三选一（炽野/贯城/镜影）＋投喂素材                | data.倾向、同源×2/相生×1.5/相克×0.5 |
| D    | 素材词条池 8 条（正负各半）＋主/副素材位差                          | material-entries、planCardCraft ①.5 |
| E    | 效果分槽扩容：主动 ≤2＋被动（每拍/受击时）≤2，合计 ≤4               | **对旧门禁严格超集，存档零回归**    |
| F    | 战报明细折叠＋关系网面板＋复制卡面（F3 捏人拆栏**有意跳过**）       | SkirmishPanel、RelationsPanel       |

## 二、代码状态（🔴 先读，别踩）

- 分支 `card-workshop-mvp`，HEAD `eacea59`——**并行会话的 values-table 六批（1/6~6/6）已全部提交**（`4496145`→`eacea59`），效果池域是安静的已提交状态。
- **工作树未提交改动 = 本线 A–F**（约 21 个 M ＋ 10 个新文件，`git status` 可见），另有 `M docs/planning/2026-09-30-card-skill-multiplier-values-table.md` 是并行线的审定标记——**不归本线**。
- 🔴 禁止 `git add -A`；🔴 提交/推送要主人确认（守则 §九.5）；🔴 `knip:ratchet` 只读别 update。
- 资产仓已重建 `dist/narrative-pack-2.9.8.json`（B 批需要）。

## 三、开工三件事

```bash
# 1. 重跑基线（2026-10-02 实测 369 文件全绿；Errors 2~4 = 已知噪音，判据看 passed 行）
npm run test:run

# 2. 起 dev（固定 5173，启动姿势见 2026-10-01 §六——cd 写子 shell）
( cd /d/BaiduNetdiskDownload/hermagent/IndependentFront-for-destined-journey && npm run dev > /tmp/dev-server.log 2>&1 & )

# 3. 装 2.9.8 内容包（B 批前置；页面开着时执行，等价设置页导入）
node /d/BaiduNetdiskDownload/hermagent/playtest-tools/install-pack.mjs \
  /d/BaiduNetdiskDownload/hermagent/fated_poem_independent_assets/dist/narrative-pack-2.9.8.json
```

## 四、测试存档准备（一次造好，覆盖六批）

1. **捏人**：智力拉高（智力=制卡轴，`insightMod` 影响制卡掷骰）；GC 留足（附魔单条 60＋定值×2）。
2. **天赋 12 抽选 2**：最好抽到【最终兵器：她】（C 批倾向选择的门槛）——没抽到就重捏，或先测无门槛项（倾向块不渲染本身也是门槛正确的证据）。
3. **开局卡池（上限 6 张）**：至少 1 张召唤（伙伴）＋ 2~3 张战斗卡；再进游戏用制台自产几张。
4. **素材**：采集/商店凑齐下表——带内建词条的 8 种是 D 批主角：

| 素材       | 内建词条                   | 用途                                |
| ---------- | -------------------------- | ----------------------------------- |
| 月光苔     | 灵光（通用，掷骰+2）       | D 边界翻档（主位 d20 低骰看翻成功） |
| 千年树心   | 浑成（主位，战力+1）       | D 位差（换到副位不生效）            |
| 精灵花     | 引韵（副位，产物得首元素） | D 引韵（产物多一个元素词条）        |
| 世界树嫩芽 | 凝萃（副位，掷骰+1）       | D 副位正向                          |
| 铜矿       | 残瑕（主位，战力−1）       | D 负面瑕疵（产物战力 −1）           |
| 水草       | 受潮（主位，掷骰−2）       | D 负面                              |
| 河蚌       | 杂质（副位，掷骰−1）       | D 负面                              |
| 沙粒       | 涩纹（副位，战力−1）       | D 负面                              |

另备：龙血草×3（C 投喂同源 ×2）、一件 `rarity: 传说` 的火系素材（C 满管溢出＝卡面战力 +1）、无词条对照素材（火晶/赤铁矿/风羽/寒水珠——这四个**刻意不带词条**）。5. **好感**：与任意 NPC 叙事互动几次（F2 需要账本有数据；空态也要测一次）。

## 五、逐批验收清单

> 每批格式：**步骤 → 预期**。改坏先跑对应测试文件（括号内）。

### A 卡册展示（CardAlbumPanel.test.ts / card-display.test.ts）

1. 卡册 → 点一张有元素词条的战斗卡 → 详情出现「效果」行（如 `【灼烧】每拍 65% 主属性伤害（2 拍）`）、「战技」行（有则显）、副轴芯片。
2. 物资/素材卡详情 → **无**效果/战技/副轴三节（不可出战卡的派生效果永不结算，整节隐藏防误导）。
3. 无元素无登记的卡 → 「无战斗效果」空态，不硬造。

### B 卡组进叙事 AI（placeholder-registry.test.ts / free-card-play.test.ts）

1. **验 prompt 注入**：`node playtest-tools/mock-llm.mjs`（端口 19222）起假 LLM → 设置里把 story/skirmish_eval 端点指到它 → 编组几张卡随便说一句话 → 看 `playtest-tools/mock-llm-log.jsonl`：story 请求里应有 `<卡组战备>` 块（卡名｜品阶｜效果定值｜禁编数纪律），skirmish_eval 请求的卡名单行应带定值简报。空卡组时两处都不出现（零 token）。
2. **验演出**：换回真模型打一场，AI 出卡宣言应按 `<卡组战备>` 定值演绎、不报结算数字（结算数字归战报）。
3. **验意图解析**：交锋中用效果名自由提名（「用灼烧那招」）→ 应命中对应卡（简报让效果名可匹配）。

### C 投喂＋倾向（companion-growth.test.ts / card-fusion.test.ts）

1. 制台「投喂（素材 → 伙伴成长）」区：选伙伴＋龙血草 → 预览「火·同源共鸣 ×2」，提交后回执「卡面经验 +50」；重复投喂到满管 → 「卡面战力 +1」。
2. 相克素材（止血草喂火卡）→ 预览「相克相冲 ×0.5」。
3. 持【最终兵器：她】时倾向区出现三枚 chip（炽野/贯城/镜影）→ 点选后「当前「炽野」」高亮、再点另一枚出转向措辞。
4. 定倾向后打一场**无克制敌人**（敌名不含 龙/虫/尸/魔/兽/机/海/焰 字样）→ 战报/叙事里伙伴进化出倾向铭文（炽野铭/贯城铭/镜影铭）；有克制敌人时仍优先克制铭（倾向只补空档）。

### D 素材词条＋位差（material-entries.test.ts / card-craft-plan.test.ts）

1. 制台背包素材区：月光苔/铜矿等 8 种带词条角标，悬浮看逐条说明；火晶/赤铁矿等对照素材**无**角标。
2. 铜矿做**主素材**制卡 → 产物卡面战力 −1（卡册可见负数）；审计链（制卡回执/战报）出现「素材词条」行。
3. 月光苔做主素材、故意低骰（预览按中位骰不可控——真机验证以回执评级轨迹为准）→ 灵光 +2 写进审计「检定：d20=X +N（理解）+2（素材词条）」。
4. 千年树心主位 → 产物战力 +1；换到副位 → 无战力修正（**位差**，预览行同步变化）。
5. 精灵花做副素材 → 产物词条多「光」。

### E 分槽扩容（card-effects.test.ts）

1. 制卡让 AI 选 3~4 条效果（主动 2＋持续 2）→ 不再整批作废，产物卡册「效果」节全量显示。
2. 附魔一张已有 2 条主动效果的卡 → 提示「主动槽已满」；改附一条持续（每拍/受击时）效果 → 成功；被动槽也满后再附 → 「被动槽已满（2 条）」。
3. 旧档旧卡效果显示与升级前一致（严格超集，零回归）。

### F 战报明细/关系网/复制卡面（RelationsPanel.test.ts / CardAlbumPanel.test.ts）

1. 打一场交锋 → 面板底部「战报明细（N 行）」展开 → 逐行审计（`▸ 【公式】伤害基数…`、共鸣/暴击行）与正文流一致。
2. 侧栏「关系」→ 空账本空态；有数据后一行一人（名字＋11 级标签＋数值条），最深的排最前。
3. 卡册选有描述的卡 → 「复制卡面」→ 粘贴到任意编辑器 = 卡面描述全文。

## 六、顺带：values-table 批次 6（并行线，别混报告）

并行线剩的验收 = **真机三场战斗**对照导演时长锚（爽战 3~~5 拍 / 标准 4~~8 拍 / 长战 6~~10 拍，杂兵 1~~2 拍清）＋ 压场倍率化（Q11，`eacea59` 已提交）落场感。测试时**与 A–F 分开记录**——两条线的 bug 清单分开放。

## 七、已知噪音（本轮补充）

- 沿用 2026-10-01 §四全部条目（teardown errors、content-store memo 偶发、别用 Math.random 断言分布）。
- 本轮观察：全量跑偶发一次 **worker 中断假象**（总数对不上 passed+skipped）——**两连跑确认**，两连全绿即不是回归。
- `ejs-scrambled-corpus.test.ts` 的 stderr 打印是测试自身的语料输出，非失败。

## 八、bug 记录约定

- 新建 `playtest-tools/bug-list-for-fix-2026-10-02.md`，体例照抄 [`bug-list-for-fix-2026-10-01.md`](../../../playtest-tools/bug-list-for-fix-2026-10-01.md)（编号/级别/问题/主责文件/证据链）。
- **A–F 的 bug 与 values-table 批次 6 的 bug 分两张表**；每条注明复现步骤与当时的内容包版本（2.9.8）。

## 九、测试红线（这批特有）

1. **数值纪律观察点**：AI 全程不得编数——制卡效果必须逐字池内定值、正文不报结算数字、`<卡组战备>` 引用不添数。发现 AI 编数直接记 🔴。
2. **有意不做清单**（别报缺）：E 的「常驻被动」型**动作条目**（session 结算域，归并行线批次 6 验收后另批——本批被动槽填的是池内既有持续型条目）；F3 捏人拆栏。
3. 战技仍是单条槽（「战技附加」天赋授予）——这是现状设计，不是漏做。
4. 守则 §九全部沿用；测试 Agent **不提交**，发现即止。

## 十、本轮相关命令速查

```bash
npm run test:run                                   # 基线（369 文件，~25s）
npx vitest --run src/sillytavern/card-workshop/card-display.test.ts      # A/B 引擎侧
npx vitest --run src/sillytavern/card-workshop/companion-growth.test.ts  # C
npx vitest --run src/sillytavern/card-workshop/material-entries.test.ts  # D
npx vitest --run src/sillytavern/card-workshop/card-effects.test.ts      # E
npx vitest --run src/ui/components/game/RelationsPanel.test.ts           # F
node ../playtest-tools/install-pack.mjs <pack.json>  # 装 2.9.8 包（页面开着）
node ../playtest-tools/mock-llm.mjs                  # 假 LLM（19222），验 prompt 注入
```
