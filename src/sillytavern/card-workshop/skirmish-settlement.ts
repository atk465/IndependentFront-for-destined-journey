/**
 * skirmish-settlement.ts — 交锋拍终局持久化补丁（纯构建器）
 *
 * settleSkirmish 只算账不落库；本模块把账本翻译成 StatePatch[]，由集成层
 * createStateManager(saveId).commitChatState(...) **同窗原子提交**（照 v3 消耗卡
 * 结算先例：一次 commit，部分失败只 warn 不回滚——补丁彼此独立，天然可重放）。
 *
 * 落库口径：
 * - 主角：update_character **绝对值**语义——totalExp = 现值 + 战斗经验（触及
 *   totalExp 后 state-manager 的 applyPlayerProgression 自动跑 resolveLevelUps
 *   升级级联，ADR-11）；hp = 账本终局 HP（state-manager 自带 [0,max] 钳制）。
 * - 参战卡：非消耗卡 → update_item 写 cardExp / cardPowerBonus（applyCardExp
 *   满管转战力，主人裁定 A）；**消耗卡打出即逝 → remove_item**（拍内效果已兑现，
 *   经验随卡而去）。查不到实物的名字静默跳过（对齐 deck-power 健壮性口径）。
 */

import type { CardItem, StatePatch } from '../types';
import { cardKindOf, isConsumableKind } from './card-kind';
import { applyCardExp } from './skirmish';
import type { SkirmishSession, SkirmishSettlement } from './skirmish-session';

export interface SkirmishPersistInput {
  playerName: string;
  /** 主角当前累计经验（绝对值语义，调用方从存档读现值） */
  playerTotalExp: number;
  /** 交锋账本（终局 HP / 审计在账上） */
  session: SkirmishSession;
  /** settleSkirmish 的结算数据（exp.total / cardExp 分成名单） */
  settlement: SkirmishSettlement;
  /** 卡名 → 实物（背包查找；查不到的名字跳过） */
  cardOf: (name: string) => CardItem | undefined;
}

/** 终局 → StatePatch[]（主角经验/HP + 参战卡经验/消耗）。纯函数，不落库 */
export function buildSkirmishSettlementPatches(input: SkirmishPersistInput): StatePatch[] {
  const target = `characters.${input.playerName}`;
  const patches: StatePatch[] = [
    {
      op: 'update_character',
      target,
      value: {
        totalExp:
          Math.max(0, Math.round(input.playerTotalExp)) +
          Math.max(0, Math.round(input.settlement.exp.total)),
        hp: Math.max(0, Math.round(input.session.playerHp)),
      },
    },
  ];
  // 本场破封的卡 → sealed:false 持久化（哑火不破不记；先于消耗/经验补丁执行）
  for (const name of input.session.unsealedCards ?? []) {
    if (!input.cardOf(name)) continue;
    patches.push({
      op: 'update_item',
      target,
      value: { name, changes: { sealed: false } },
    });
  }
  for (const share of input.settlement.cardExp) {
    const card = input.cardOf(share.name);
    if (!card) continue;
    if (isConsumableKind(cardKindOf(card.词条))) {
      patches.push({
        op: 'remove_item',
        target,
        value: { name: share.name, quantity: 1 },
      });
      continue;
    }
    // applyCardExp 入参 = 玩家战斗总经验（内部自做 50% 分成；share.gain 已是分成后
    // 的展示值，传进来会双重折半——真 bug，测试钉住）
    const next = applyCardExp(
      { cardTier: card.cardTier, cardExp: card.cardExp, cardPowerBonus: card.cardPowerBonus },
      input.settlement.exp.total,
    );
    patches.push({
      op: 'update_item',
      target,
      value: {
        name: share.name,
        changes: { cardExp: next.cardExp, cardPowerBonus: next.cardPowerBonus },
      },
    });
  }
  return patches;
}
