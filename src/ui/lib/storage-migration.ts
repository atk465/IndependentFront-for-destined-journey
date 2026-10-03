/**
 * storage-migration.ts —— localStorage 键改名的一次性迁移。
 *
 * ## 背景（2026-09-20 去 fated-poem 化）
 *
 * 应用 localStorage 键前缀由旧名改为 `narrative-engine-*`。旧键里是用户的真实
 * 设置（设置项/主题/字号/字体），改名不迁移 = 全员重置。这里提供**唯一的迁移入口**：
 * 读方向自愈——新键缺席而旧键在场时，把旧值搬到新键并清掉旧键；此后每次启动
 * 只是空转几次 `getItem`，无副作用。
 *
 * 为什么不做启动全量扫描：各 store 各自持有自己的键组，集中扫描要维护第二份
 * 键清单。各 store 在自己的 init 路径调用本模块，键清单只在该 store 出现一次。
 */

/**
 * 把 `legacyKeys` 里的旧值迁到 `key` 下（幂等）。
 *
 * - 新键已有值：不动值，只清理旧键（新值永远赢——用户改过设置就不能被旧值顶回去）。
 * - 新键缺席：按 `legacyKeys` 顺序取第一个非空旧值搬过来，然后清掉全部旧键。
 * - localStorage 不可用（隐私模式/配额满）：静默放弃，调用方按缺省值走。
 */
export function migrateLegacyKeys(key: string, legacyKeys: readonly string[]): void {
  try {
    const current = localStorage.getItem(key);
    if (current === null) {
      for (const legacy of legacyKeys) {
        const saved = localStorage.getItem(legacy);
        if (saved !== null) {
          localStorage.setItem(key, saved);
          break;
        }
      }
    }
    for (const legacy of legacyKeys) {
      if (localStorage.getItem(legacy) !== null) localStorage.removeItem(legacy);
    }
  } catch {
    // 迁不动就用默认值，不值得打断用户
  }
}
