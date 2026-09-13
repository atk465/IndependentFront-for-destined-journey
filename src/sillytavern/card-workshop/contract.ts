/**
 * contract.ts — 契约召唤（卡牌工坊 可玩闭环 · 名字即契约）
 *
 * 裁定（playable-loop 设计 §2 分支 3）：伙伴角色名 = 卡名；契约存在性 =
 * 角色列表存在同名角色。本模块提供结算侧的纯判定：哪些召唤卡的伙伴
 * 在战斗终局处于倒下状态（→ 卡损坏，data.damaged）。
 */

import type { DeckCardData } from '../combat-v3/types';
import { cardKindOf } from './card-kind';

/**
 * 终局损坏判定：召唤/军团卡的伙伴（spawn 意图的 unitId）在终局 HP ≤ 0
 * → 该卡损坏（修复前不可再召；快照排除 + companionPresent 双闸兜底）。
 */
export function downedSummonCards(
  deckCards: readonly DeckCardData[],
  units: ReadonlyArray<{ name: string; hp: number }>,
): string[] {
  const downed = new Set(units.filter((u) => u.hp <= 0).map((u) => u.name));
  if (downed.size === 0) return [];
  const out: string[] = [];
  for (const card of deckCards) {
    const kind = cardKindOf(card.词条);
    if (kind !== '召唤' && kind !== '军团') continue;
    const spawnUnitIds = (card.automata ?? []).flatMap((a) =>
      a.intents
        .filter(
          (i): i is { kind: 'SpawnOrDespawnIntent'; op: 'spawn'; unitId: string } =>
            i.kind === 'SpawnOrDespawnIntent' && i.op === 'spawn',
        )
        .map((i) => i.unitId),
    );
    if (spawnUnitIds.some((id) => downed.has(id))) out.push(card.name);
  }
  return out;
}
