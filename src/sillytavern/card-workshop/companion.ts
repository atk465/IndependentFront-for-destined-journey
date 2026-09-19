/**
 * companion.ts — 巨兽召唤池 · 首召实体化（2026-09-17，路线图分支 3）
 *
 * 共识裁定（主人 2026-09-17 访谈）：
 * - 池的形态：内容仓 cardPool 预写召唤卡目录（鎏金/星辉档，每张带 CompanionSeed），
 *   抽封铭卡高阶档可出、开局购卡不卖——伙伴要在故事里相遇。
 * - 何时填：实体化延迟到**首召**——召唤卡在交锋中打出且存档内无同名角色时，
 *   结算 commit 里 add_character 一名 type:'summon' 的伙伴实体。
 * - 生成方式：**确定性**（种族/性情取卡种子，属性按 cardTier 推导，零 AI 零延迟）；
 *   叙事演出交给 story 自由发挥。AI 补全可作二期。
 * - 军团卡不个体化（群像，canon：一窝低阶铭灵的协同阵）。
 *
 * 全部纯函数；落库由调用方（skirmish-settlement）产 add_character patch 同窗提交。
 */

import type { CardItem, CharacterState } from '../types';
import { cardKindOf } from './card-kind';
import type { CompanionSeed } from '../start-catalog-mechanics';

/** cardTier → 伙伴档位（0 起；决定 tier/level/属性的确定性推导基数） */
const TIER_INDEX: Record<CardItem['cardTier'], number> = {
  白铁: 0,
  青铜: 1,
  白银: 2,
  鎏金: 3,
  星辉: 4,
};

/** 召唤卡判定（军团卡排除——群像不个体化） */
export function isSummonCard(card: Pick<CardItem, '词条'>): boolean {
  return cardKindOf(card.词条) === '召唤';
}

/** 首召判定：存档内还没有同名角色 */
export function needsFirstSummon(cardName: string, existingNames: readonly string[]): boolean {
  return !existingNames.includes(cardName);
}

/**
 * 由召唤卡（+可选种子）确定性构造伙伴实体。
 *
 * - 名字 = 卡名（铁律1；好感共鸣 bondForCard 按同名查 affection，天然接通）
 * - 强度锚在卡上（C' 制：损伤由卡承载）——属性 = 2 + 档位基数，HP/MP/SP 线性
 * - 种族/性情优先取内容仓种子；缺省落「铭灵」通用口径（显世皆女性形貌）
 */
export function buildSummonCompanion(input: {
  card: Pick<CardItem, 'name' | 'cardTier' | '词条' | 'description'>;
  seed?: CompanionSeed;
  saveId: string;
  playerName: string;
  location: string;
}): CharacterState {
  const { card, seed } = input;
  const idx = TIER_INDEX[card.cardTier] ?? 0;
  const attr = 2 + idx;
  return {
    id: crypto.randomUUID(),
    saveId: input.saveId,
    type: 'summon',
    name: card.name,
    race: seed?.race ?? '铭灵',
    identity: ['召唤伙伴'],
    occupation: [],
    tier: idx + 1,
    tierName: ['普通', '中坚', '精英', '史诗', '传说'][idx] ?? '普通',
    level: 1 + idx * 5,
    totalExp: 0,
    expToNext: 100,
    attributes: { str: attr, dex: attr, con: attr, int: attr, spi: attr },
    freeAttrPoints: 0,
    hp: 40 + idx * 30,
    maxHp: 40 + idx * 30,
    mp: 20 + idx * 15,
    maxMp: 20 + idx * 15,
    sp: 20 + idx * 15,
    maxSp: 20 + idx * 15,
    skills: [],
    inventory: [],
    statusEffects: [],
    money: 0,
    location: input.location,
    present: true,
    currentAction: '',
    bloodlineIds: [],
    gender: '女',
    personality: seed?.temperament ?? '像一段有了性情的文字，偏执而押韵',
    appearance: `铭灵显世的女性形貌，铭色随词条：${card.词条.join('、')}`,
    background: seed
      ? `由制卡师首召入库的${seed.race}铭灵，性情：${seed.temperament}`
      : '由制卡师首召入库的铭灵伙伴',
    customFields: { origin: 'summon_card', ownerName: input.playerName },
  };
}
