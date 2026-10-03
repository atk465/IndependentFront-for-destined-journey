# 通用前端改造 · 改名映射表（2026-09-20）

> 用途：`universal-frontend` 分支与功能线（`card-workshop-mvp`）**合并时解析冲突的机械对照表**。
> 功能线在改造期间新写的代码若引用了旧名，合并时按下表逐项替换即可，无语义判断成本。
> 背景与决议见各分支提交：引擎仓 `universal-frontend`（34c392b）、内容仓 `universal-frontend-sync`（841b840）。

## 一、代码标识符

| 旧名                                                         | 新名                                   | 说明                                                                                 |
| ------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------ |
| `destinyPoints`（CreatePreset.character 字段，types.ts）     | `startingPoints`                       | 存档持久化字段；旧预设数据经 `database.normalizeCreatePresetData` 读写归一化         |
| `destinyPoints`（createJourney 输入字段）                    | `startingPoints`                       | 瞬态；转换为 FP 后不残留                                                             |
| `destinyPoints` / `destinyCost`（create-store ref/computed） | `startingPoints` / `startingPointCost` | UI 显示文案「命运点」保留                                                            |
| `DESTINY_CORE_WORLDBOOK_MAP`（start-catalog.ts）             | （已删除）                             | 零引用死符号                                                                         |
| `SESSION_BACKUP_KIND = 'fated-poem-session-save'`            | `'narrative-session-save'`             | 导入侧永久接受旧 kind（`LEGACY_SESSION_BACKUP_KINDS`）                               |
| `BEAUTIFIER_FRAME_MESSAGE_SOURCE = 'fated-poem-beautifier'`  | `'narrative-beautifier'`               | postMessage 双端都在仓内，同步改                                                     |
| BFF `service: 'fated-poem-bff'`                              | `'narrative-bff'`                      | server/routes/status.ts                                                              |
| EJS `engine.name = 'poem-of-destiny'`                        | `'narrative-engine'`                   | `engine.legacyName` 永久保留旧名（@deprecated，能力路径 `engine.legacyName` 已注册） |

## 二、localStorage 键（启动自动迁移，见 `src/ui/lib/storage-migration.ts`）

| 旧键                               | 新键                                      |
| ---------------------------------- | ----------------------------------------- |
| `fated-poem-settings`              | `narrative-engine-settings`               |
| `fated-poem-font-body`             | `narrative-engine-font-body`              |
| `fated-poem-font-title`            | `narrative-engine-font-title`             |
| `fated-poem-font-size`             | `narrative-engine-font-size`              |
| `fated-poem-theme`                 | `narrative-engine-theme`                  |
| `fated-poem-fonts`（三档单选墓碑） | 保留旧值只读（`LS_FONTS_LEGACY`），无新键 |

## 三、内容包身份（跨仓）

| 旧                                   | 新                             | 兼容                                                                                                      |
| ------------------------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| packId `fated-poem-official`         | `narrative-official`           | 已装旧 id 记录在 hydrate 时键+载荷同步改名；旧备份依赖检查经 `LEGACY_PACK_ID_MAP`（types-content.ts）映射 |
| 产物 `fated-poem-pack-<semver>.json` | `narrative-pack-<semver>.json` | 内容仓 build-pack.mjs                                                                                     |
| packVersion 2.8.0                    | 2.9.0（默认值）                | 引擎升级判定按 packId 走，改名后首包即 2.9.0                                                              |

## 四、面向用户的导出文件名前缀

| 旧                                                     | 新                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `fated-poem-save-*.json`（单存档备份）                 | `narrative-save-*.json`                                    |
| `fated-poem-debug-*.json`（DebugPanel）                | `narrative-debug-*.json`                                   |
| `fated-poem-<ts>.json`（整库备份）                     | `narrative-backup-<ts>.json`                               |
| `destiny_*.preset.json` / `destiny_all_*.presets.json` | `narrative_*.preset.json` / `narrative_all_*.presets.json` |

## 五、刻意保留的旧名（不是残留，勿"清理"）

- 两仓 README 的**二创授权声明**、`docs/《命定之诗》内容二创与素材使用授权协议.md`、
  `docs/canon.md` 的出处规范与参考书清单——法律/伦理层面的出处声明。
- `docs/` 历史归档与 CHANGELOG 约 500 处旧名——历史记录，不改写。
- `tests/`（含 `branding-defaults.test.ts` 的 IP_TERMS 黑名单）——防回归门禁本身要写旧词。
- Dexie 主库名 `SillyTavernWebDB`——上游生态名，无命定词汇，IndexedDB 无法改名。
- **门禁**：`tests/ip-terms-gate.test.ts`——零容忍词 + 兼容层棘轮
  （`fated-poem`≤16 / `poem-of-destiny`≤2 / `destinyPoints`≤6），棘轮只许往下拧。

## 六、合并操作要点

1. 功能线新代码引用 `destinyPoints` → 按 §一 改 `startingPoints`。
2. 功能线新测试造备份夹具用旧 kind → 仍能过（导入兼容），但断言导出 kind 的要改 `narrative-session-save`。
3. 合并后跑 `npm run test:run` + `npx vitest run tests/ip-terms-gate.test.ts`；
   棘轮若报"实际 < 基线"，说明兼容层又被清了，顺手把基线下调。
