/**
 * soul-weapon.ts — 本名武器（SS「天生剑骨（东方）」/「战意破苍穹」）
 *
 * 两条 SS 共用同一条管道，只是武器类型不同：
 *  - 天生剑骨：本名**剑**，与角色同步成长；制作剑类装备必良性进化
 *  - 战意破苍穹：本源**弓**「麒麟殒天弓」，因果绑定，无法被夺
 *
 * 落地口径：
 *  - **生成**：`planSoulWeapon` 按持有者与武器类型生成一张绑定装备卡
 *    （词条含「本名」+ 武器类型，档位按 `tierForLevel` 从等级换算）。
 *  - **成长**：等级提升后再次调用 `ensureSoulWeapon` → 档位随 `tierForLevel`
 *    重算（只升不降——「同步成长」的兑现）。
 *  - **绑定**：`data.soulBound = 持有者名`——因果绑定的机械锚点，
 *    「无法被夺」「只有认可的人能用」由 AI 据此演绎。
 *  - **武器限制**：天生剑骨「不能装备其他武器」——引擎尚无装备校验器，
 *    限制本身记 backlog（引擎缺量清单）。
 *  - **武器技能**：战意破苍穹的五种【击伤】各自是独立战斗效果，记 backlog，
 *    本批落地武器本体 + 绑定。
 *
 * 纯度约束：纯函数、不 mutate。
 */

import type { CardItem } from '../types';
import { CARD_TIERS, type CardTier } from '../field-enums';
import { tierForLevel } from './companion-capture';

/** 本名武器类型（加类型 = 加一行数据） */
export const SOUL_WEAPON_TYPES = ['剑', '弓'] as const;
export type SoulWeaponType = (typeof SOUL_WEAPON_TYPES)[number];

/** 武器类型 → 卡面词条 */
const WEAPON_ENTRIES: Record<SoulWeaponType, readonly string[]> = {
  剑: ['装备', '剑', '本名'],
  弓: ['装备', '弓', '本名', '因果'],
};

/** 武器类型 → 预设名（持有者可用 AI 命名覆盖） */
const WEAPON_DEFAULT_NAMES: Record<SoulWeaponType, string> = {
  剑: '本名剑',
  弓: '麒麟殒天弓',
};

/** 等级 → 本名武器档位（与伙伴卡 tierForLevel 同一条映射） */
export function soulWeaponTierForLevel(level: number): CardTier {
  return tierForLevel(level);
}

/**
 * 规划本名武器（纯函数）。
 *
 * @param ownerName 持有者（绑定锚点，写进 `data.soulBound`）
 * @param weaponType 武器类型
 * @param level 当前等级（档位由此换算）
 * @param customName 自定名（AI 叙事命名后传入；缺省用预设名）
 */
export function planSoulWeapon(
  ownerName: string,
  weaponType: SoulWeaponType,
  level: number,
  customName?: string,
): CardItem {
  const tier = soulWeaponTierForLevel(level);
  const entries = WEAPON_ENTRIES[weaponType] ?? ['装备', '本名'];
  return {
    name: customName?.trim() || WEAPON_DEFAULT_NAMES[weaponType] || '本名武器',
    quantity: 1,
    type: '卡牌',
    cardTier: tier,
    词条: [...entries],
    sealed: false,
    data: { soulBound: ownerName, weaponType },
    recipe: {
      mainMaterial: ownerName,
      subMaterials: [],
      tier,
      fusionKind: '相生',
      cost: 0,
      rating: '成功',
    },
  };
}

/**
 * 是否需要升档（纯函数）：已有本名武器的档位低于当前等级应给的档位 → 升。
 */
export function shouldUpgradeSoulWeapon(
  current: Pick<CardItem, 'cardTier'> | undefined,
  level: number,
): boolean {
  if (!current) return false;
  const want = soulWeaponTierForLevel(level);
  return CARD_TIERS.indexOf(want) > CARD_TIERS.indexOf(current.cardTier ?? '白铁');
}

/** 从背包里找本名武器（按 `data.soulBound` 或「本名」词条判定） */
export function findSoulWeapon<T extends object>(
  inventory: readonly T[],
  ownerName: string,
): T | undefined {
  return inventory.find((i) => {
    const item = i as { type?: string; data?: unknown; 词条?: string[]; name?: string };
    if (item.type !== '卡牌') return false;
    const d = item.data as Record<string, unknown> | undefined;
    if (d?.soulBound === ownerName) return true;
    return (item.词条 ?? []).includes('本名');
  });
}
