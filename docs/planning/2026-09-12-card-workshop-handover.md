# 交接档案 · 卡牌工坊（卡兰大陆）改造项目

- 生成日期：2026-09-12
- 用途：**跨工具交接**。本文档自包含，新接手的开发者或 AI 工具无需任何历史上下文即可继续。
- 上游设计文档：`docs/planning/2026-09-12-card-workshop-mvp-design.md`、`docs/planning/2026-09-12-card-workshop-mvp-adr.md`

---

## 0. 30 秒速览

| 项               | 值                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------- |
| 项目             | 命定之诗前端（`package.json` 的 name 是 `narrative-engine`）                              |
| 本地路径         | `C:\Users\admin\WorkBuddy\2026-08-31-05-19-25\IndependentFront-for-destined-journey`      |
| 你的 fork        | `https://github.com/atk465/IndependentFront-for-destined-journey`                         |
| 上游             | `https://github.com/The-poem-of-destiny/IndependentFront-for-destined-journey`            |
| 工作分支         | `card-workshop-mvp`（**无斜杠**，原因见 §3.1）                                            |
| 分支基点         | `0cad0b9`（`feat: improve opening narration and add persona editing (#127)`）             |
| 最新**代码**提交 | `f18e747`（Phase 1 代码），其父 `fecd35f`（规划文档）                                     |
| 分支 HEAD        | 在 `f18e747` 之上还有文档提交（含本档案本身），以 `git log` 实测为准                      |
| 进度             | **Phase 1 部分完成**（数据模型 + 确定性融合内核 + 单测已过）；UI 未做；未跑全量闸门       |
| 技术栈           | Vue 3 + Pinia + Vite + TypeScript + Dexie(IndexedDB)；Node `^20.19 \|\| ^22.13 \|\| >=24` |
| 跑起来           | `npm run dev` → `http://localhost:5173`（**必须配 LLM API 才能跑剧情**）                  |

---

## 1. 这个项目在做什么（业务背景）

目标是让命定之诗前端承载一套**真正的卡牌制作玩法**，世界观为「**卡兰大陆**」：

> 万物皆可成素材；远古巨兽可化为伙伴；山川河流可被封入卡牌；少数禁忌卡能颠覆法则。

玩法闭环：**采集素材 → 拆解词条 → 炼制卡牌 → 编入卡组 → 完成委托 → 赚取货币 → 解锁高阶素材**。

有**两条并行路线**，注意区分，别混做：

| 路线                     | 形态                                 | 状态                        | 产物位置                                         |
| ------------------------ | ------------------------------------ | --------------------------- | ------------------------------------------------ |
| **A. 世界书/提示词玩法** | AI 扮演游戏系统，数值靠 LLM 文本维持 | ✅ **已交付可用**           | `D:\BaiduNetdiskDownload\yue\卡牌工坊-冒险公会\` |
| **B. 引擎级真系统**      | 改 TS 源码，真数值/真随机/真 UI      | 🚧 **进行中**（本档案主题） | 本仓库 `card-workshop-mvp` 分支                  |

路线 A 是"能用但不精确"，路线 B 是"精确但要写码"。两者独立，互不干扰。

---

## 2. 仓库坐标与分支状态

```
origin    → atk465/IndependentFront-for-destined-journey          (你的 fork，推送目标)
upstream  → The-poem-of-destiny/IndependentFront-for-destined-journey  (上游，只拉不推)
```

**提交链**（`card-workshop-mvp` 分支）：

```
HEAD      docs(planning): 新增跨工具交接档案（+ 本文件所在提交）
f18e747   feat(card-workshop): Phase1 数据模型 + 确定性融合内核     ← 最新代码提交
fecd35f   docs(planning): 卡牌工坊 MVP 设计与战斗路线 ADR
0cad0b9   feat: improve opening narration and add persona editing (#127)   ← 分支基点
```

**⚠️ 已知状态偏差（接手请先处理）**：

- 本地 `master` = `0cad0b9`，但 fork 的 `master` 已经是 `d4fc8d4` —— **本地落后于远端**。
- 接手第一步建议：`git fetch --all` 后确认是否需要 rebase 到最新 `upstream/master`，避免分支基于过旧基点。
- 工作树有 3 个**既有的未跟踪文件**（非本项目产物，**不要提交**）：
  `scripts/build-portable.mjs`、`scripts/bundle-entry.mjs`、`scripts/prod-server.mjs`

---

## 3. ⚠️ 本机环境坑（血泪教训，会重复踩）

这一节是接手时**最容易浪费时间**的地方。以下均为实测结论。

### 3.1 git 分支名**不能用斜杠**

沙箱会**跨命令丢弃 `.git` 下新建的子目录**。分支名带 `/`（如 `feature/card-workshop-mvp`）时 git 需要新建 `.git/refs/heads/feature/` 目录 → 目录被丢 → 分支永远建不出来，且 `git branch` **静默失败**（无报错、无退出码异常）。

- ✅ 正确：`git update-ref refs/heads/card-workshop-mvp <SHA>`（写在已存在的 `refs/heads/` 里，可持久化）
- ❌ 错误：`git checkout -b feature/xxx`

### 3.2 `HEAD` 悬空会让 git 静默失效

曾出现 `git checkout -b` 创建的分支 ref 没落盘，导致 `HEAD` 指向不存在的 ref（`not a valid SHA1`）。此时 `git branch` 建分支会**静默失败**。

**修复**：`git symbolic-ref HEAD refs/heads/master`

**判据**：如果 `git rev-parse HEAD` 报错但 `git log --oneline -3` 正常，就是这个问题。

### 3.3 其他

- **`/tmp` 有写隔离**：`curl` 写的文件，Python/`ls` 可能看不到。需要落盘时**用 Python 一条命令完成下载+解压**，别跨命令。
- **后台长任务活不过 ~60 秒**：`run_in_background` 的轮询进程会被沙箱杀掉。长等待要放前台。
- **直连 GitHub release CDN 会失败**（`http=000`）：用镜像 `https://ghfast.top/https://github.com/...`。
- **`winget` 在 PowerShell 里调不到**（App Execution Alias 限制）。

### 3.4 可用工具路径

```bash
# Node（托管版，优先）
C:/Users/admin/.workbuddy/binaries/node/versions/22.22.2-2/node.exe
# Python（托管版）
C:/Users/admin/.workbuddy/binaries/python/versions/3.13.12/python.exe
# GitHub CLI（本次装的便携版）
C:/Users/admin/.workbuddy/binaries/gh/bin/gh.exe
```

跑测试/类型检查时若 `npm` 有问题，可直接调二进制：

```bash
cd <repo>
NODE="C:/Users/admin/.workbuddy/binaries/node/versions/22.22.2-2/node.exe"
"$NODE" node_modules/vitest/vitest.mjs run src/sillytavern/card-workshop/card-fusion.test.ts
"$NODE" node_modules/typescript/bin/tsc --noEmit
```

### 3.5 git 凭据（安全，见 §7）

`.git/config` 里通过 `url.*.insteadOf` 内嵌了一个 OAuth token，所以 `git remote -v` 回显里会带 `gho_...`。**这是本机凭据，不要外传、不要截图分享**。

---

## 4. 已完成的工作

### 4.1 提交清单（`git diff --stat master..HEAD`，7 文件 +558/-3）

| 文件                                                   | 变更   | 说明                                                                                                            |
| ------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------- |
| `src/sillytavern/field-enums.ts`                       | +11/-1 | `ITEM_TYPES` 加 `'卡牌'`；新增 `CARD_TIERS`(5级)、`CARD_ENTRY_TYPES`(四类)                                      |
| `src/sillytavern/types.ts`                             | +52/-2 | `CraftIndustry` 加 `'制卡'`(属性=灵感)；`CardItem`/`FusionRecipe`/`CardAlbumState`；`CharacterState.cardAlbum?` |
| `src/sillytavern/craft-quality.ts`                     | +16    | `keywords` 表补 `'制卡'`（否则 `Record<CraftIndustry, string[]>` 不完整 → 编译失败）                            |
| `src/sillytavern/card-workshop/card-fusion.ts`         | +190   | **确定性融合内核**（纯函数，零 AI 参与）                                                                        |
| `src/sillytavern/card-workshop/card-fusion.test.ts`    | +140   | 23 个单测                                                                                                       |
| `docs/planning/2026-09-12-card-workshop-mvp-design.md` | +118   | 设计文档                                                                                                        |
| `docs/planning/2026-09-12-card-workshop-mvp-adr.md`    | +34    | 路线决策 ADR                                                                                                    |

### 4.2 数据模型（关键：**卡牌不是新实体，是 `InventoryItem` 子类型**）

```typescript
// types.ts:974
export interface CardItem extends InventoryItem {
  type: '卡牌';
  cardTier: CardTier;      // 白铁|青铜|白银|鎏金|星辉
  词条: string[];           // 元素/形态/效果/稀有
  recipe: FusionRecipe;    // 主+副素材名（逻辑键）
  sealed: boolean;         // 未启封
}

// types.ts:1003
export interface CardAlbumState {
  owned: string[];         // 卡牌名（逻辑键）
  deck: string[];          // 当前卡组
  capacity: number;
}

// types.ts:1145  CharacterState 内嵌
cardAlbum?: CardAlbumState;
```

**为什么挂 `InventoryItem`**：它**已有** `material` 类型、`effects` 词条、`automata`（可执行效果 DSL，18 个触发窗口）、`modifiers`、7 级 `rarity`。卡牌需要的一切它都能装，新造实体会违反数据规范铁律④。

### 4.3 确定性融合内核（`card-fusion.ts`）

纯函数，**AI 永不参与数值**：

- **同类叠加升级**：火 + 火 = 烈焰
- **相生复合**：火 + 风 = 燎原（品质 +1，评级「精益求精」）
- **相克不稳定**：冲突元素 → 造价 ×0.7，基础失败率上升
- **造价** = Σ素材售价 × 稀有度系数
- **评级**：走既有 `CraftRating`（大失败/失败/成功/精益求精）

**⚠️ 实现陷阱（已修复，改表时务必注意）**：`pairKey` 用 **UTF-16 code point 排序**元素名。`火`(U+706B) < `风`(U+98CE)，所以 key 是 **`火+风`** 而不是 `风+火`。**查表的 key 写反会导致相生/复合词条全部静默查不到**——单测就是这样抓到这个 bug 的。

### 4.4 验证状态（**诚实声明**）

| 项                                                      | 状态        |
| ------------------------------------------------------- | ----------- |
| `card-fusion.test.ts` 23 个单测                         | ✅ 全过     |
| `tsc --noEmit`（类型检查）                              | ✅ exit 0   |
| `npm run gates`（八道闸门全量）                         | ❌ **未跑** |
| Vue 类型检查（`vue-tsc`）/ ESLint / knip / `vite build` | ❌ **未跑** |
| 7400+ 全量测试                                          | ❌ **未跑** |
| 浏览器实机运行验证                                      | ❌ **未做** |

**接手第一件事建议**：在真机跑 `npm run gates`，确认基线 + 新代码都绿。

---

## 5. 关键设计决策（接手前必读，避免推翻重来）

### 5.1 战斗路线 = **A++「启封式卡组战斗」**

技术形态 = 路线 A（不碰 `reducer`/`phases` 主干），表现力向路线 B 靠拢。

**决策依据是源码勘察，不是偏好**——世界观四条设定往引擎通道上映射：

| 世界观原句       | 引擎现有通道                                                                                     | 改动量     |
| ---------------- | ------------------------------------------------------------------------------------------------ | ---------- |
| 巨兽化为伙伴     | `SpawnOrDespawnIntent` → 冻结 spawn frame → `CharGenRequest` → `SupplyUnit` → 插进 `state.units` | **零**     |
| 禁忌卡颠覆法则   | `Adjudicate` + `requestedRuleOverride`                                                           | **零**     |
| 万物皆可成素材   | `craft-gen-chain` → `item-gen-chain` → `buildCraftPatches`                                       | **零**     |
| 山川河流封入卡牌 | 引擎**无地形/环境概念**（关键词 grep 零命中）                                                    | **需新增** |

四条里**三条的通道现成**，且质量很高（引擎把召唤做成了「AI 生成 + 内核接管」：参战时机由 AI 判，先攻/扣血/到期移除/槽位记账由确定性内核管）。

### 5.2 **不做真抽牌**（重要，别自作主张加回来）

不是工作量问题，是**设定上不成立**：

> 卡是制卡师**亲手炼制**的，他当然知道卡册里装着什么。
> 「抽牌」的随机性前提是"我不知道会拿到什么"。
> **制卡师与卡册之间不存在信息不对称。**

真抽牌会让玩家问出那句蠢话："卡是我自己做的，为什么我抽不到？"

### 5.3 随机性放哪：**启封判定**

> 卡牌是被封印的**有意志的存在**。启封高阶卡时，封印物会**抗拒**。

意志对抗失败 → **抗命**：哑火 / 暴走（打自己人）/ 反噬。三个好处：保留骰子随机性、**直接复用现有确定性骰带**（`dice-tape.ts`，可回放）、契合设定——一张会造反的卡才叫禁忌卡。副产品：「稀有度越高越危险」天然成为平衡杠杆。

**资源系统同理用「启封槽位」**（复用 `unit-turn.ts:165` 的 `consumeSlot`），不是蓝条。

---

## 6. 引擎关键坐标（省去重新勘察）

写新功能时直接改这些地方，不用再满仓库找：

| 模块        | 位置                                                                                                  | 用途                         |
| ----------- | ----------------------------------------------------------------------------------------------------- | ---------------------------- |
| 制作链路    | `src/sillytavern/craft-gen-chain.ts` → `item-gen-chain.ts` → `buildCraftPatches` → `add_item` patches | 制卡应复用此链，**不要新造** |
| Marker 协议 | `<craft_request>` 被引擎拦截结算                                                                      | 卡牌请求走同一协议           |
| 制作枚举    | `types.ts` 的 `CraftIndustry`/`CraftRating`/`CRAFT_RATING_VALUE_RANGE`                                | 已有确定性数值区间           |
| 确定性骰带  | `combat-v3/dice-tape.ts`                                                                              | 启封判定接入点               |
| 召唤池      | `combat-v3/summon-pool.ts` + `SummonedUnitDefinition`                                                 | 巨兽参战                     |
| 规则覆写    | `combat-v3/adjudication.ts` 的 `requestedRuleOverride`                                                | 禁忌卡                       |
| 行动槽位    | `combat-v3/phases/unit-turn.ts:165` `consumeSlot`                                                     | 启封槽位                     |
| 行动类型    | `combat-v3/phases/action.ts` `TacticalActionType = 'item'\|'move'\|'focus'\|'defend'`                 | 卡牌"启封"可挂 `item`        |
| 已有卡 UI   | `src/ui/components/game/cards/`                                                                       | 布局参考，**别重复造**       |
| 数据库版本  | `DB_VERSION = 24`                                                                                     | 加表/迁移要动这里            |
| 物品模型    | `types.ts:936` `InventoryItem`                                                                        | 卡牌基类                     |

---

## 7. ⚠️ 安全与凭据

1. **`.git/config` 内嵌了 GitHub OAuth token**（通过 `url.*.insteadOf`）。`git remote -v` 会回显 `gho_...`。
   - 迁移/分享/打包这个仓库前，务必清理：`git config --unset-all url."https://<token>@github.com/".insteadOf`（或整份重写 `.git/config`）。
   - 建议本阶段工作完成后，去 GitHub Settings → Applications **revoke** 这个 token。
2. WorkBuddy 工作区（`C:\Users\admin\WorkBuddy\2026-08-31-05-53-42\`）存有中间凭据文件：`.gh-token.txt`、`.gh-device-flow.json`、`.gh-fork-info.json`。**不要提交到任何仓库**。
3. token 权限范围：`repo` + `workflow`（够 fork/push，但 `gh auth login` 曾因缺 `read:org` 拒绝，改用 `GH_TOKEN` 环境变量绕过）。

---

## 8. 仓库工程纪律（**必须遵守，否则 PR 会被拒**）

这个仓库的测试与流程文化极重（7400+ 测试用例），以下是硬要求：

1. **改代码前先写 planning 文档**：`docs/planning/YYYY-MM-DD-<主题>-design.md`（本仓库有 ADR + planning 传统）。
2. **每个新模块必须配 `.test.ts`**。几乎所有模块都有对应测试文件。
3. **提交前跑八道闸门**：
   ```bash
   npm run gates
   # = typecheck && typecheck:vue && typecheck:tools && build
   #   && format:check && lint && knip:ratchet && test:run
   ```
   `lint` 带 `--max-warnings 0`，**任何 warning 都会失败**。
4. **分层方向只有「前端 → 引擎」**，禁止反向依赖。
5. **代码改动走分支 + PR**，不直接推 `master`。
6. 动手前读：根 `AGENTS.md`、`src/sillytavern/AGENTS.md`、`CLAUDE.md`/`CONTEXT.md`。
7. **数据字段五铁律**（`docs/superpowers/specs/2026-07-16-data-field-conventions-design.md`）：
   - ① 逻辑键 = **名字**，AI 永不产 `id`
   - ② 名字解析唯一入口
   - ③ AI 填叙事字段，Code 补账务字段
   - ④ 每类数据**唯一真源**
   - ⑤ 枚举**中文集中定义**在 `field-enums.ts`

   > 既有偏差：`CraftIndustry` 当前定义在 `types.ts` 而非 `field-enums.ts`，违反铁律⑤。计划中已安排顺手收口。

---

## 9. 下一步待办（按优先级）

### Phase 1 收尾

> 📌 **2026-09-12 已完成**（同日第二会话）：
>
> - [x] **卡册读写辅助**：`card-workshop/album.ts` + `.test.ts`（`canAddToDeck()` 同名≤2、
>       增删卡、容量校验，全纯函数）+ `card-workshop/material.ts`（库存物品 → MaterialSpec
>       的唯一映射：品质→tier、data.price 优先估价、元素字面推导）。
> - [x] **最小 UI 面板**：`src/ui/components/game/cards/CardAlbumPanel.vue`（卡组/卡包/详情
>       三栏；落库走 `game.updateCardAlbum` → `update_character.cardAlbum`）+
>       `CraftBench.vue`（制台**只做确定性实时预览**，实际炼制仍走 `<craft_request>` 叙事流程）。
>       入口：游戏页侧栏「卡册 / 制台」两个工具按钮（`activeModal` 新增
>       `cardAlbum` / `craftBench` 两取值）。
> - [x] **`CraftIndustry` 收口到 `field-enums.ts`**（`CRAFT_INDUSTRIES` + 属性映射 +
>       `normalizeCraftIndustry()`；`types.ts` re-export 保住既有 import 面，三处
>       `as CraftIndustry` 强转点已改走归一化）。
> - 配套：`state-manager.ts` 的 `update_character` 白名单加 `cardAlbum`（整份替换，
>   沿 `customFields` 先例）；`src/ui/AGENTS.md` GamePage 条目已同步。

### 后续阶段（MVP 之后）

| 阶段 | 内容                                                         | 风险                           | 状态                                                                                                                                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2    | 启封判定接入 `dice-tape.ts` 确定性骰带                       | 低                             | ✅ 2026-09-12（`unsealing.ts`；骰带是 combat-v3 internal，判定做成「骰值调用方传入」的纯函数对齐其契约，阶段5 战斗内接线点见 phase2 设计 §5）                                                                                                                                                                                                              |
| 3    | 卡组战力 + 委托系统（复用 `<craft_request>` marker 协议）    | 中                             | ✅/🚧 2026-09-12：3a 战力 + 3b 制卡桥（craft 链产物→确定性 CardItem）已实施（phase3 设计文档）；委托内容面（难度档表/委托板 UI）待内容侧拍板，设计定案在同一份 §4                                                                                                                                                                                          |
| 4    | **地景卡** `CombatState.landscape`                           | **高——唯一必须碰战斗内核的项** | ✅ 2026-09-13 独立提交（内核可选字段沿 frozenSlots 先例 + DeclareAction(item).payload.landscape 通道 + automata 注册；顺手修 action.declared 非 spawn 意图被丢弃的既有缺口——spawn 在场保持原延迟语义，case-06 契约 eventHash 逐字节不变；会话层装配点待接，见 phase4 设计 §6）                                                                             |
| 5    | 召唤接入 `summon-pool.ts` + 规则覆写 `requestedRuleOverride` | 中                             | ✅ 2026-09-13（战斗内接线：玩卡通道统一为 `payload.card`〔phase4 的 landscape 更名扩形〕+ 启封判定接 `intentCheck` 骰带〔哑火/暴走/反噬各有机械后果，REBOUND_DAMAGE 反噬表收口〕+ 召唤卡打出即发动〔M3.5 冻结链〕+ 禁忌卡 OverrideIntent〔freezeSlot 落地〕；深覆写走既有 Adjudicate 六步验证〔会话层〕；召唤池填充仍靠离线脚本；card-play.test.ts 17 例） |

**⚠️ 阶段 4 必须独立开发、独立提交**：`combat-v3/coordinator.test.ts` 有 3387 行，replay 确定性闸门很严，混做会分不清回归来源。

### 最终收尾

- [ ] 真机跑 `npm run gates` 全绿
- [ ] 提 PR 到 `upstream`（从你的 fork 的 `card-workshop-mvp` 分支）

---

## 10. 相关产物索引（路线 A，已交付）

位置：`D:\BaiduNetdiskDownload\yue\卡牌工坊-冒险公会\`

| 文件                     | 说明                                              |
| ------------------------ | ------------------------------------------------- |
| `README_使用说明.md`     | 两平台装载步骤 + 兼容性表                         |
| `核心协议_全文.md`       | 协议正文约 4900 字，可直接粘进预设主提示词        |
| `世界书_命定之诗版.json` | 命定之诗前端导入用（15 条目）                     |
| `世界书_酒馆ST版.json`   | SillyTavern 导入用（15 条目：11 常驻 + 4 关键词） |
| `build_worldbook.py`     | **单一真源**，改内容后重跑即可重新生成上面三份    |
| `引擎大改计划.md`        | 7 阶段改造计划（11~18 天估时）                    |
| `战斗路线决策.md`        | 路线 A++ 的完整论证                               |

另有世界书源文件（内置 15 本的 `.txt/.yaml`）：`D:\BaiduNetdiskDownload\yue\命定之诗世界书\`

> **路线 A 的两个已知技术坑**（写档案时保留，避免回头踩）：
>
> 1. 命定之诗前端导入器写的是 `Array.isArray(raw.entries)` —— 喂标准 ST 世界书（`entries` 为**对象**）会**静默导入 0 条目**。所以必须两份 JSON，不能合并。
> 2. 前端的关键词激活**失效**：`worldbook-loader.ts` 的 `filterActiveEntries` 只 `filter(e => e.enabled)`，`key` 不参与判定。所以命定之诗版把 15 条全设为常驻。

---

## 11. 给新接手工具的开工提示词（可直接复制）

> 你接手一个进行中的 TypeScript 项目改造。请先读 `docs/planning/2026-09-12-card-workshop-handover.md`（本档案）、`2026-09-12-card-workshop-mvp-design.md`、`2026-09-12-card-workshop-mvp-adr.md` 三份文档，以及根目录与 `src/sillytavern/` 的 `AGENTS.md`。
>
> 项目：命定之诗前端（`narrative-engine`），本地路径 `C:\Users\admin\WorkBuddy\2026-08-31-05-19-25\IndependentFront-for-destined-journey`，工作分支 `card-workshop-mvp`，已推到 `atk465/IndependentFront-for-destined-journey`。
>
> 已完成 Phase 1 的数据模型与确定性融合内核。请先跑 `npm run gates` 确认基线，然后继续 Phase 1 收尾（卡册读写辅助 + 最小 UI 面板）。
>
> **必须遵守**：扩散优先于修改（不碰 `combat-v3/`）；每个新模块配 `.test.ts`；枚举集中在 `field-enums.ts`；逻辑键用名字而非 id；分支名**不能用斜杠**（沙箱限制）；提交前跑 `npm run gates`。
>
> **不要做**：真抽牌（设定上不成立）、碰战斗内核（阶段 4 才做，且要独立提交）。

---

## 12. 快速自检清单

接手后按顺序跑一遍，确认环境可用：

```bash
# 1. 进项目
cd "C:/Users/admin/WorkBuddy/2026-08-31-05-19-25/IndependentFront-for-destined-journey"

# 2. 确认分支与提交
git branch                    # 应在 card-workshop-mvp
git log --oneline -4          # 应见 f18e747（Phase 1 代码）与 0cad0b9（分支基点）

# 3. 同步远端（本地 master 落后）
git fetch --all
git ls-remote --heads origin

# 4. 确认依赖在位
ls -d node_modules && node -v && npm -v

# 5. 跑融合内核单测（应 23 passed）
NODE="C:/Users/admin/.workbuddy/binaries/node/versions/22.22.2-2/node.exe"
"$NODE" node_modules/vitest/vitest.mjs run src/sillytavern/card-workshop/card-fusion.test.ts

# 6. 类型检查
"$NODE" node_modules/typescript/bin/tsc --noEmit

# 7. 起点：全量闸门
npm run gates
```
