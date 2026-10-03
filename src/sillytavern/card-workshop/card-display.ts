/**
 * card-display.ts — 卡牌战斗面展示行的组装（2026-10-02 批次A UI / 批次B 叙事注入共用）
 *
 * 口径：读侧一律过引擎门禁再显示，与交锋结算同源——
 * - 效果走 deriveCardEffects（精配覆写 > 卡面登记 > 元素派生打底，三级来源与出牌一致）
 * - 副轴走 coerceSecondaryAxes（与 game-pipeline 出卡结算同一条门禁）
 * - 战技走 cardStatusEffect（entry-status 的形状兜底口径）
 * 措辞沿用 effectLineOf（UI 与 AI 提示词共用），本模块不另起文案真源。
 *
 * 纯度约束：纯函数、无 I/O、无 Vue。UI 侧 `src/ui/lib/card-display.ts` 只是对本模块的转发。
 */
import type { CardAlbumState, CardItem, InventoryItem } from '../types';
import { deriveCardEffects, effectLineOf } from './card-effects';
import { coerceSecondaryAxes } from './multiplier';
import { AXIS_LABEL, cardAxisOf } from './derived-stats';
import { cardStatusEffect } from './entry-status';
import { isPlayableCard } from './card-kind';

/** 战技交锋效果类型 → 中文标签（对齐 entry-combat CardInPlayEffect['type']；表外回落「特殊效果」） */
const WARSKILL_TYPE_LABEL: Readonly<Record<string, string>> = {
  dot: '持续伤害',
  buff: '行动值增益',
  weaken: '威胁削弱',
  stun: '夺行动权',
  regen: '回复',
  vulnerable: '易伤',
  shield: '护盾',
  poisonPct: '百分比剧毒',
  fear: '恐惧',
  confusion: '混乱',
  sleep: '沉睡',
  bind: '束缚',
  curse: '诅咒',
};

/** 有效战斗效果行（池内定值措辞；元素打底卡也照实显示） */
export function cardEffectLines(card: CardItem): string[] {
  return deriveCardEffects(card).map((e) => effectLineOf(e));
}

/** 战技展示行（「战技附加」天赋产物）；undefined = 无战技。无量纯标记如实标注 */
export function cardWarSkillLine(card: CardItem): string | undefined {
  const s = card.战技;
  if (!s) return undefined;
  const eff = cardStatusEffect(s, card.name);
  const parts = [`战技「${s.status}」`];
  parts.push(eff ? (WARSKILL_TYPE_LABEL[eff.type] ?? '特殊效果') : '纯标记（无机械效果）');
  if (s.power > 0) parts.push(`量 ${s.power}`);
  if (s.beats > 0) parts.push(`${s.beats} 拍`);
  return parts.join('·');
}

/** 副轴加成芯片（轴中文名 + 档位%；主轴同轴/档外/超槽的门禁丢弃不显示） */
export function cardAxisChips(card: CardItem): { label: string; bonus: number }[] {
  return coerceSecondaryAxes(card.cardSecondaryAxes, cardAxisOf(card.词条), card.cardTier).map(
    (a) => ({ label: AXIS_LABEL[a.axis], bonus: a.bonus }),
  );
}

// ═══ 叙事战备简报（2026-10-02 批次B：{{CARD_DECK}} 与交锋意图解析共用） ═══

/** 单卡战备行：`【名】品阶｜效果：…｜战技…｜副轴：…｜未启封`（各段按缺省省略） */
export function cardBriefLine(card: CardItem): string {
  const parts: string[] = [];
  const effects = cardEffectLines(card);
  if (effects.length > 0) parts.push(`效果：${effects.join('；')}`);
  const war = cardWarSkillLine(card);
  if (war) parts.push(war);
  const axes = cardAxisChips(card).map((c) => `${c.label} +${c.bonus}%`);
  if (axes.length > 0) parts.push(`副轴：${axes.join('、')}`);
  return `【${card.name}】${card.cardTier}${parts.length > 0 ? `｜${parts.join('｜')}` : ''}${
    card.sealed ? '｜未启封' : ''
  }`;
}

/**
 * 卡组战备清单：按 deck 编入顺序取背包实物，只留可出战卡。
 * - 同名多张只出一行（简报讲的是「这张卡会什么」，不是张数记账）；
 * - 查不到实物（漂移位）与物资/素材卡（不可出战，派生效果永不结算）都不进简报；
 * - 空卡组/全不可出战 → []（调用方按零 token 处理）。
 */
export function deckBriefCards(player: {
  inventory?: InventoryItem[];
  cardAlbum?: CardAlbumState;
}): CardItem[] {
  const deck = player.cardAlbum?.deck ?? [];
  const byName = new Map(
    (player.inventory ?? [])
      .filter((i): i is CardItem => i.type === '卡牌')
      .map((c) => [c.name, c]),
  );
  const out: CardItem[] = [];
  for (const name of deck) {
    const card = byName.get(name);
    if (card && isPlayableCard(card) && !out.some((c) => c.name === name)) out.push(card);
  }
  return out;
}
