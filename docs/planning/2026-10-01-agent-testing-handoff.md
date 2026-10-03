# 交接文档 —— Agent 测试指南（2026-10-01）

> 🔴 **2026-10-02 状态更新**：本文第八节快照已过时——HEAD 已至 `eacea59`（批次 6①压场倍率化已提交，剩真机三场验收），且工作树有卡牌六批（A–F）未提交改动。**本批测试入口**：[`2026-10-02-agent-testing-handoff-cards-a-f.md`](2026-10-02-agent-testing-handoff-cards-a-f.md)。本文的環境/守则/门禁/噪音章节仍然有效。
>
> 写给**零上下文接手的 AI Agent**：读完这一份，你就能跑自动化测试、开真机测试页、查内容仓门禁，并知道哪些「错误」其实不是失败。  
> 它与 [`2026-09-16-handoff-next-session.md`](2026-09-16-handoff-next-session.md)（批次交接，讲「上一批做了什么」）互补；本文只讲「**怎么验证这个项目**」。  
> 当前在办规格：[`2026-09-30-card-skill-multiplier-values-table.md`](2026-09-30-card-skill-multiplier-values-table.md)（技能倍率 v2 共识数值总表）。

## 一、项目与双仓布局

**项目一句话**：《铭刻录》——独立的、兼容 SillyTavern 的文字 RPG 引擎 + 前端 UI 一体化项目（Vue 3 + Pinia + Dexie + Vite + Vitest），世界内容以外挂内容包（pack）形式由私有内容仓构建注入。

| 仓                       | 本机路径                                                                  | 分支                | 作用                                                                            |
| ------------------------ | ------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------- |
| **引擎仓**（主工作对象） | `D:\BaiduNetdiskDownload\hermagent\IndependentFront-for-destined-journey` | `card-workshop-mvp` | 引擎 + 前端 + 全部测试；origin = `atk465/IndependentFront-for-destined-journey` |
| **资产仓**（私有内容仓） | `D:\BaiduNetdiskDownload\hermagent\fated_poem_independent_assets`         | `main`              | 世界书真源、`docs/canon.md` 写作正典、`tools/`（check-lore / build-pack）       |
| 便携版产物               | `D:\BaiduNetdiskDownload\hermagent\hermagent-dist\铭刻录-便携版`          | —                   | 玩家侧双击产物，**不是测试对象**                                                |

> 工作区根 `hermagent\` 下还有 LibreTranslate 等无关目录，别进去找测试。

## 二、环境准备

- Windows + Git Bash；Node 要求 `^20.19.0 || ^22.13.0 || >=24.0.0`（2026-10-01 实测本机 v24.15.0 / npm 11.12.1）。
- 依赖已装（`node_modules` 在）；新环境先 `npm install`。
- 本地可以跑完全部验收，不依赖 CI 凭据。

## 三、自动化测试（第一道验收）

**一键闸门 = CI 全部步骤，交代码前必须全绿：**

```bash
npm run gates
# 展开后八道：typecheck → typecheck:vue → typecheck:tools → build
#            → format:check → lint → knip:ratchet → test:run
```

**常用分解动作：**

```bash
npm run test:run                          # 全量 Vitest 单次运行（watch 模式是 npm test，别挂着忘关）
npx vitest --run src/sillytavern/card-workshop/multiplier.test.ts   # 单文件
npx vitest --run -t "测试名关键字"        # 按测试名过滤
npm run typecheck:vue                     # 改 .vue 必跑（裸 tsc 不解析 SFC）
```

**当前基线（2026-10-01 本地实测，HEAD `d6a3c5b`，工作树干净）：**

```
Test Files  364 passed (364)
Tests       8253 passed | 8 skipped (8261)
Errors      2 errors        ← 已知噪音，见下节，不是失败
Duration    ~26s，exit code 0
```

> 按 AGENTS.md 文档守则第 5 条：数字会过期。接手当天自己重跑一遍 `npm run test:run` 记录新基线，别抄本文的数。

## 四、已知噪音与 flaky（不是失败，别去「修」它们）

1. **全量跑必出现的 `Errors 2 errors`**：`GamePage.abort-on-unmount.test.ts` 的 `ui.toast is not a function` unhandled rejection（beautifier 预设 fetch 失败是另一处同类噪音）。**测试本身全绿、exit 0**。判据看 vitest 汇总的 `passed/failed` 行，不看 Errors 行。
2. **`content-store-registry.test.ts` 的 memo 断言偶发 flaky**——重跑即过，不是回归。
3. **写新测试禁止用 `Math.random` 断言分布**（必 flaky）：随机源用引擎的 ejs-rng（同种子同结果）或确定性循环伪随机。
4. DB 测试用 fake-indexeddb，属性测试用 fast-check——基建都是现成的，照邻近测试抄即可。

## 五、机器门禁棘轮（改代码前必知，碰了就挂红）

| 闸门        | 位置                                                            | 契约                                                                                                                                        |
| ----------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| IP 专名棘轮 | `tests/ip-terms-gate.test.ts`                                   | `fated-poem` ≤16 / `poem-of-destiny` ≤2 / `destinyPoints` ≤6，**只许往下拧**；新增代码严禁回升计数                                          |
| 死代码棘轮  | `npm run knip:ratchet`                                          | 基线 121 条（`bf058d9` 111→121），只减不增；新增未用导出要么删掉接上，要么 `knip:update` 并说明理由                                         |
| 分层闸门    | `tests/layering-gate.test.ts` + eslint `no-restricted-imports`  | 引擎（`src/sillytavern/**`）禁止 import `vue`/`pinia`/`src/ui/**`，**type-only 也算**；方向只有一个：前端 → 引擎                            |
| 编码闸门    | `tests/encoding-invariants.test.ts`                             | U+FFFD=0、控制字符=0、JSON 可解析三判据。🔴 它**不扫 `docs/` 和资产仓**——批量改那两处中文后必须手工跑 AGENTS.md 里那条 `node -e` 三判据命令 |
| 内容纯净    | `tests/no-world-content.test.ts` / `no-external-assets.test.ts` | 引擎仓零 IP 内容、零外链资产；真实内容只住资产仓                                                                                            |

## 六、真机测试（GUI 测试页）

### 启动 dev 服务器

```bash
# 🔴 cd 必须写在子 shell 内部：会话重置后 cwd 会丢回上级目录 hermagent/
( cd /d/BaiduNetdiskDownload/hermagent/IndependentFront-for-destined-journey && npm run dev > /tmp/dev-server.log 2>&1 & )
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173   # 200 即可用
```

- 端口**固定 5173**，被占用时报错退出、不杀已有进程。
- 后台任务外壳可能以 exit 127 报死，但 Vite 子进程存活——以 curl 200 为准，别急着重起。

### 浏览器验收

- 用 ZCode 的 `browser-use` / `web-gui-tester` 能力做黑盒点击 + 截图验证；页内状态可用 domSnapshot 汇报。
- **主人的验收模式**：主人说「打开测试页」→ 起服务 + 开页 + 汇报状态，**主人实玩说通过才继续下一项**；Agent 自己点过不算验收。

### 当前版本的主流程验收路径（2026-10-01）

1. **首页 → 新建存档 → 捏人**：性别固定男（无下拉）；天赋 12 抽选 2（F-SSS 各保底 1）；开局无预设背景路线（背景表已清空，机制保留）。
2. **转生点经济**：天赋指数定价 F=5 → SSS=2500；属性购买 100/点、单项上限 20；卡池四档上限 6 张；总可花约 10000 对预算 5000（**超载两倍是设计**，不是 bug）。
3. **交锋（当前最大验收面，v2 共识 5 批新代码都在这）**：
   - 常规拍走**技能公式轨**：出卡 = 主轴派生 × 主倍率 + 副轴项，难度档开战锁定；
   - 三套难度表（爽战/标准/长战）+ 导演时长锚：爽战 3~~5 拍 / 标准 4~~8 拍 / 长战 6~~10 拍，杂兵 1~~2 拍清；
   - 特殊拍（真名/献祭/nuke/禁忌）走**直接伤害轨**（power 即天赋伤害值）——这是永久语义，不是过渡；
   - 破防/穿透已重诠释为「敌方威胁 −4/−8（本场）」，**玩家打破防卡不再削自己防护**（Q22 倒挂已止血）；
   - 卡面显示「X% 主属性」倍率句式，结算拆公式展示。
4. **周边系统**：委托板（事件委托动态生成/交付）、地图移动与天气、随机事件回执、世界书注入、DebugPanel 看内部状态。
5. **存读档**：存档/读档/单档导出导入往返，世界书与自定义内容不丢。

### 引擎侧对应测试文件（改动后先跑这几个）

`src/sillytavern/card-workshop/` 下：`multiplier.test.ts`（纯函数叶）、`skirmish-skill.test.ts`（公式轨）、`skirmish-session.test.ts`、`skirmish-settlement.test.ts`；前端接线在 `src/ui/stores/game-store.skirmish.test.ts`。

## 七、内容仓（资产仓）的测试

```bash
cd /d/BaiduNetdiskDownload/hermagent/fated_poem_independent_assets
python tools/check-lore.py                     # 全部世界书过九道门
python tools/check-lore.py <书名>.json         # 单本
node tools/build-pack.mjs                      # 改完内容必须重建 dist 包
```

- **九道门**：①禁词 35+空洞形容四禁（强大/神秘/古老/极其危险）②长度 ③④随批次启用 ⑤标题 ⑥非常驻条目必须 EJS 自门控 ⑦句式限频 ⑧8 字片段复读 ⑨起始地对表 map-pack 真实地块。
- 挂账书（cot/dlc/quick_feature/extra_setting 等）的问题**不阻塞门禁**，输出里标注「挂账」。
- 禁则真源 = 资产仓 `docs/canon.md`「七、写作正典」；checker 是机器执法副本，**改禁则两处同步**。
- 🔴 **build-pack 时序教训**：dist 构建早于内容键写入 = 该键缺失于 pack。改完内容必须重建 dist，不能依赖旧构建产物。
- 引擎侧门控语义由 `src/sillytavern/lore-self-gate.test.ts` 钉死（252 条全 EJS 自门控，`enabled` 是注入唯一主宰）。

## 八、当前状态快照（2026-10-01）

- 分支 `card-workshop-mvp`，工作树干净，HEAD `d6a3c5b`。最近 5 个提交 = 技能倍率 v2 共识批次 1~5（`4496145` 纯函数叶 → `11ed4ce` 双轨+Q22 止血 → `12f115b` 替换制接线 → `0a25b5e` 效果池倍率化 → `d6a3c5b` 微差轨三向接线）。
- **批次 6 未做**（下一步工作面）：①召唤/领域压场倍率化（Q11：entry-combat 登记处 2×卡力 → 主轴派生×30%；`playMultiEnemyBeat` 多敌路径不走 `translateCardEffects`，待公式化）②真机三场验收（对照导演时长锚）。
- 🔴 **`docs/CHANGELOG.md` 停在 2026-09-12**——之后的工作以 `git log` + `docs/planning/` 设计文档为准，别拿 CHANGELOG 判断项目现状（文档债，接手人可顺手补）。
- 测试规模 364 文件 / 8253+ 项（见第三节基线）；knip 基线 121。

## 九、Agent 行为守则（测试/修复时同样生效）

1. **收到「xx 有问题」禁止直接改码**：先四问——哪个页面、哪个操作、预期 vs 实际、什么数据；确认后一次只修一个。
2. **声称「缺/没做/已接线」前必须查证**——8 千+ 测试的大仓，凭印象断言会错；查证手段：grep + 跑对应测试。
3. **汇报三段式**：做了什么 / 顺手修了什么 / 遗留什么；不夸大完成度。
4. **并行会话共存**：本工作区可能有并行会话在写码。提交前 `git status` 分辨哪些改动是自己这批的，**禁止无脑 `git add -A`**；发现混入先核实再如实报告。
5. **Prettier**：新文件写完必须 `npx prettier --write <该文件>`（否则 format:check 一直红）；只 write 自己改过的文件，仓库级 `npm run format` 别随手跑（无关 churn）。纯 `.md` 改动可直推 master，但推前先 prettier 且**提交/推送要主人确认**；push 后必须查 GitHub Actions CI，红了要修。
6. **批次交付**：做一批停一下等主人检查，等「下一批」指令再继续；Phase 完成跑 `bash scripts/notify.sh "<名称> 完成!" "<关键指标>"`。
7. **必读文档入口**（按需读，别一次全读）：根 `AGENTS.md`（全部约定）→ 改引擎读 `src/sillytavern/AGENTS.md`、改 UI 读 `src/ui/AGENTS.md`、写 UI 先读 `docs/design.md`；数据字段改动读 `docs/superpowers/specs/2026-07-16-data-field-conventions-design.md`；世界观/数值改动读资产仓 `reference/world_book_index.md`。

## 十、命令速查

```bash
# ── 引擎仓 ──
npm run gates            # 八道闸门一键（交码前必须全绿）
npm run test:run         # 全量测试（~26s）
npx vitest --run <file>  # 单文件测试
npm run dev              # 开发服务器（固定 5173；启动姿势见第六节）
npm run knip             # 死代码原始报告（人看）
npm run knip:update      # 清理后收紧基线（需说明理由）
npm run lint:fix         # lint 自动修（会删未引用导入，慎用）

# ── 资产仓 ──
python tools/check-lore.py        # 世界书九道门
node tools/build-pack.mjs         # 重建内容包 dist（改内容后必跑）

# ── 收尾 ──
bash scripts/notify.sh "<名称> 完成!" "<指标>"   # Phase 完成通知（横幅+托盘+响铃）
```
