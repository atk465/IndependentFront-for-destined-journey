/**
 * partner-alchemy.ts — 伙伴踩踏炼金（S「足之炼金术」）
 *
 * 天赋描述：「制作出的女性伙伴卡能通过踩踏不同的素材，将其转化为全新的道具卡。
 * 例如踩踏矿石可能炼出金属，踩踏草药可能炼出药剂。」
 *
 * 落地口径：**一张伙伴卡 + 一件素材 → 一张全新的道具卡**。
 *  - 产物形态由**素材的类别**决定（矿石→金属、草药→药剂……），走一张类别表；
 *  - 产物档位取「伙伴卡档位与素材稀有度里较高的那个」，再按 `炼金{maxTier}` 夹逼；
 *  - 伙伴卡**不消耗**（她是踩踏者不是原料），素材被消耗——这是这条天赋的成本。
 *
 * 与「融合」的分工：融合吃的是素材、出的是同系卡；炼金吃的是**素材 + 伙伴**，
 * 出的是与素材类别绑定的道具卡。所以它有自己的类别表，不挤进融合内核。
 *
 * 纯度约束：纯函数、不 mutate、随机源由调用方注入。
 */

import type { CardItem, InventoryItem } from '../types';
import { CARD_TIERS, RARITY_LEVELS, type CardTier } from '../field-enums';

/** 素材类别 → 炼出的道具形态（加一类 = 加一行数据） */
export const ALCHEMY_FORMS: readonly { match: readonly string[]; form: string; 词条: string[] }[] =
  [
    { match: ['矿', '铁', '铜', '银', '金', '晶', '石'], form: '金属锭', 词条: ['金属', '导能'] },
    { match: ['草', '药', '花', '叶', '根'], form: '药剂', 词条: ['药性', '愈合'] },
    { match: ['骨', '牙', '爪', '角'], form: '骨器', 词条: ['坚硬', '锋利'] },
    { match: ['血', '肉', '脏'], form: '血肉膏', 词条: ['生机', '腥烈'] },
    { match: ['丝', '布', '皮', '羽'], form: '织料', 词条: ['柔韧', '轻捷'] },
    { match: ['火', '焰'], form: '火种', 词条: ['火', '炽热'] },
    { match: ['水', '冰', '霜'], form: '霜露', 词条: ['水', '凛冽'] },
    { match: ['雷', '电'], form: '雷精', 词条: ['雷', '暴烈'] },
  ];

/** 认不出的素材 → 通用形态（不猜，但也不空手） */
const FALLBACK_FORM = { form: '炼物', 词条: ['炼成'] };

/** 卡档 → 对应的稀有度（与拆解同源的那张表；这里只用于比较） */
const TIER_RANK: Record<CardTier, number> = {
  白铁: 0,
  青铜: 1,
  白银: 2,
  鎏金: 3,
  星辉: 4,
};

export interface AlchemyPlan {
  /** 被消耗的素材名 */
  consumedMaterial: string;
  /** 踩踏者（伙伴卡名，不消耗） */
  partner: string;
  /** 产出的道具卡 */
  product: CardItem;
  summary: string;
}

/**
 * 素材 → 炼金形态（纯函数，认不出走通用形态）。
 */
export function alchemyFormOf(materialName: string): { form: string; 词条: string[] } {
  const name = String(materialName ?? '');
  for (const row of ALCHEMY_FORMS) {
    if (row.match.some((k) => name.includes(k))) return { form: row.form, 词条: [...row.词条] };
  }
  return { form: FALLBACK_FORM.form, 词条: [...FALLBACK_FORM.词条] };
}

/** 稀有度 → 卡档（产物落档用；传说以上封顶星辉） */
function tierOfRarity(rarity: string | undefined): CardTier {
  const idx = (RARITY_LEVELS as readonly string[]).indexOf(rarity ?? '');
  if (idx <= 0) return '白铁';
  if (idx === 1) return '青铜';
  if (idx === 2) return '白银';
  if (idx === 3) return '鎏金';
  return '星辉';
}

/**
 * 规划一次炼金（纯函数）。
 *
 * @param partner 踩踏者（伙伴卡；**不消耗**）
 * @param material 被踩踏的素材（**消耗**）
 * @param maxTierIndex 产物档位上限（条目 `炼金{maxTier}` 换算；缺省 3 = 鎏金）
 */
export function planFootAlchemy(
  partner: Pick<CardItem, 'name' | 'cardTier'>,
  material: Pick<InventoryItem, 'name' | 'type' | 'rarity'>,
  maxTierIndex = 3,
): { ok: boolean; reason?: string; plan?: AlchemyPlan } {
  if (material.type !== '材料') {
    return { ok: false, reason: `【${material.name}】不是素材——她踩不动别的东西` };
  }
  const matTier = tierOfRarity(material.rarity);
  const partnerRank = TIER_RANK[partner.cardTier ?? '白铁'];
  const matRank = TIER_RANK[matTier];
  // 取两者较高的那一档（她踩得动的东西决定了成色上限）
  const cap = Math.max(0, Math.min(CARD_TIERS.length - 1, Math.round(maxTierIndex)));
  const pickRank = Math.min(cap, Math.max(partnerRank, matRank));
  const tier = CARD_TIERS[pickRank];

  const { form, 词条 } = alchemyFormOf(material.name);
  const name = `${material.name}·${form}`;
  const product: CardItem = {
    name,
    quantity: 1,
    type: '卡牌',
    rarity: '普通',
    cardTier: tier,
    // 形态词条给「物资」（道具卡），素材类别词条照抄
    词条: [...new Set(['物资', ...词条])],
    sealed: false,
    recipe: {
      mainMaterial: material.name,
      subMaterials: [partner.name],
      tier,
      fusionKind: '相生',
      cost: 0,
      rating: '成功',
    },
  };
  return {
    ok: true,
    plan: {
      consumedMaterial: material.name,
      partner: partner.name,
      product,
      summary: `【${partner.name}】踩过「${material.name}」——炼出道具卡【${name}】（${tier}）`,
    },
  };
}
