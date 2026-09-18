/**
 * item-card-bridge.ts — 叙事物 → 卡牌桥（2026-09-18 第二批裁决）
 *
 * 共识（主人 2026-09-18 访谈）：`item_gen` 的**装备与技能产出改为产卡**，
 * 消耗品与材料保持传统物品。
 *
 * - 装备 → **装备卡**（双身份）：既保留 `equippedSlot`/`stats`/`modifiers` 等穿戴
 *   字段（被动加成走 8 步伤害管线），又是可编组出战的卡（每拍光环）——自由共存。
 * - 技能 → **技能卡**：`CharacterState.skills` 自 combat-v3 删除后**已无任何战斗消费点**
 *   （`characterToCombatParticipant`/`createCombatState` 均已下线，交锋层只读卡），
 *   所以这一步是「把死数据修正成有战斗用途的卡」，不是功能降级。
 *
 * 数值全 Code 推导（铁律3）：
 * - `cardTier` ← item_gen 的 7 级 `quality` 映射（普通/优良→白铁 … 神话/唯一→星辉）
 * - `词条` = 形态词（装备/技能）+ 元素词（从名字/效果关键词命中九元素，复用 material.ts）
 * AI 只负责名字与叙事描述，不产出任何数值。
 */

import { CARD_TIERS, normalizeRarity, type CardTier, type Rarity } from '../field-enums';
import type { CardItem } from '../types';
import { deriveElements } from './material';
import type { ItemGenOutput } from '../types';

/** item_gen 的 7 级品质 → 卡牌 5 级 tier（两档合一的只有最低一档：普通与优良都是白铁） */
const RARITY_TO_TIER: Record<Rarity, CardTier> = {
  普通: '白铁',
  优良: '白铁',
  稀有: '青铜',
  史诗: '白银',
  传说: '鎏金',
  神话: '星辉',
  唯一: '星辉',
};

/** 品质字符串（可能是别名/脏值）→ 卡牌 tier；无法识别时落最低档 */
export function tierFromItemQuality(quality: string | undefined): CardTier {
  const r = quality ? normalizeRarity(quality) : undefined;
  return r ? RARITY_TO_TIER[r] : CARD_TIERS[0];
}

/** 元素词条推导：从名字 + 效果键名命中九元素（复用 material.ts 的单一真源） */
function elementEntries(name: string, effects: Record<string, string> | undefined): string[] {
  return deriveElements({ name, effects } as never);
}

/** 卡的 recipe 快照（非融合产物：主素材即自身名，评级按品质给「成功」） */
function snapshotRecipe(name: string, tier: CardTier): CardItem['recipe'] {
  return {
    mainMaterial: name,
    subMaterials: [],
    tier,
    fusionKind: '叠加',
    cost: 0,
    rating: '成功',
  };
}

type EquipEntry = ItemGenOutput['equipment'][number];
type SkillEntry = ItemGenOutput['skills'][number];

/**
 * item_gen 装备条目 → 装备卡（双身份）。
 *
 * 穿戴字段原样保留（`equippedSlot`/`stats`/`durability`/`effects`/`scripts`/
 * `modifiers`/`buffs`/`divinity`/`automata`）——被动加成链路不受影响；
 * 另加卡牌字段（`cardTier`/`词条`/`recipe`/`sealed`）供编组与交锋出卡。
 */
export function buildCardFromEquipment(equip: EquipEntry, slot: string | null): CardItem {
  const tier = tierFromItemQuality(equip.quality);
  return {
    name: equip.name,
    description: equip.description,
    quantity: 1,
    type: '卡牌',
    rarity: normalizeRarity(equip.quality ?? '') ?? '普通',
    cardTier: tier,
    词条: ['装备', ...elementEntries(equip.name, equip.effects)],
    recipe: snapshotRecipe(equip.name, tier),
    sealed: false,
    // ── 双身份的穿戴侧（被动加成）──
    equippedSlot: slot,
    stats: equip.stats,
    durability: equip.durability,
    maxDurability: equip.durability,
    ...(equip.effects && Object.keys(equip.effects).length > 0 ? { effects: equip.effects } : {}),
    ...(equip.scripts && Object.keys(equip.scripts).length > 0 ? { scripts: equip.scripts } : {}),
    ...(equip.modifiers?.length ? { modifiers: equip.modifiers } : {}),
    ...(equip.buffs?.length ? { buffs: equip.buffs } : {}),
    ...(equip.divinity !== undefined ? { divinity: equip.divinity } : {}),
    ...(equip.automata?.length ? { automata: equip.automata } : {}),
  };
}

/**
 * item_gen 技能条目 → 技能卡。
 *
 * 🔴 原技能的 `skillPower`/`cost`/`cooldown` 在卡战体系里没有消费点（那些字段属于已删除的
 * combat-v3 技能链），故不透传到卡上——技能卡的强度由**卡牌品质与词条**决定，
 * 与其他卡同一条规则（避免留一批读不到的字段当摆设）。
 * 但 `modifiers`/`automata`/`effects` 仍透传：它们是 v3 之外的通用战斗声明，
 * 未来若接线可直接生效。
 */
export function buildCardFromSkill(skill: SkillEntry): CardItem {
  const quality = skill.quality;
  const tier = tierFromItemQuality(quality);
  return {
    name: skill.name,
    description: skill.description,
    quantity: 1,
    type: '卡牌',
    rarity: normalizeRarity(quality ?? '') ?? '普通',
    cardTier: tier,
    词条: ['技能', ...elementEntries(skill.name, skill.effects)],
    recipe: snapshotRecipe(skill.name, tier),
    sealed: false,
    ...(skill.effects && Object.keys(skill.effects).length > 0 ? { effects: skill.effects } : {}),
    ...(skill.scripts && Object.keys(skill.scripts).length > 0 ? { scripts: skill.scripts } : {}),
    ...(skill.modifiers?.length ? { modifiers: skill.modifiers } : {}),
    ...(skill.buffs?.length ? { buffs: skill.buffs } : {}),
    ...(skill.divinity !== undefined ? { divinity: skill.divinity } : {}),
    ...(skill.automata?.length ? { automata: skill.automata } : {}),
  };
}
