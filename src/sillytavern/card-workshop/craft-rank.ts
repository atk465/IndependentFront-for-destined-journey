/**
 * craft-rank.ts — 制卡师等级 = 冒险者等级的纯派生（2026-09-17）
 *
 * 世界观里「制卡师等级」是个被反复引用的量：吞噬/拆解/融合的描述都写着
 * 「等级不高于你制卡师等级（+1）的…」，但引擎里从来没有这个量——只有
 * 冒险者等级（`CharacterState.level`）。本模块把两者**对应**起来。
 *
 * 口径（主人裁定 2026-09-17）：**制卡师等级 = 冒险者等级，1:1**。
 * 战斗等级涨、制卡等级跟着涨——不引入第二条成长线，也不落库。
 *
 * 为什么是派生而不是字段：与 `adventurer-rank.ts` 同款铁律——唯一真相来源是
 * `level`，派生天然同步、无第二真相来源。要改成别的口径（例如「制卡师等级单独
 * 靠制卡次数成长」），**只改本模块**，全部消费点跟着走。
 *
 * 纯度约束：纯函数、无 I/O。
 */

import { CARD_TIERS, type CardTier } from '../field-enums';
import { tierForLevel } from './companion-capture';

/**
 * 制卡师等级（= 冒险者等级，1:1）。
 *
 * 脏数据兜底与 `deriveCombatStats` 同口径：非有限值/缺省按 1，绝不抛。
 */
export function craftLevelOf(adventurerLevel: number | undefined): number {
  return typeof adventurerLevel === 'number' && Number.isFinite(adventurerLevel)
    ? Math.max(1, Math.round(adventurerLevel))
    : 1;
}

/**
 * 制卡师可处理的**最高卡档**：制卡师等级 + 等级差上限 → 卡档。
 *
 * 与 `tierForLevel`（等级 → 卡档的唯一映射）同源，所以「吞噬等级不高于你制卡师
 * 等级一级的卡」这句话在引擎里就落成 `craftTierCeiling(level, 1)`。
 *
 * @param levelBonus 等级差上限（条目强度档；吞噬/拆解基准 1，融合基准 0）
 */
export function craftTierCeiling(adventurerLevel: number | undefined, levelBonus = 1): CardTier {
  const bonus = Math.max(0, Math.round(levelBonus) || 0);
  return tierForLevel(craftLevelOf(adventurerLevel) + bonus);
}

/**
 * 同 `craftTierCeiling`，但返回 `CARD_TIERS` 索引——`planDevour` / `planDismantle`
 * 的 `maxTierIndex` 参数就是这个口径。
 */
export function craftTierCeilingIndex(adventurerLevel: number | undefined, levelBonus = 1): number {
  return Math.max(0, CARD_TIERS.indexOf(craftTierCeiling(adventurerLevel, levelBonus)));
}
