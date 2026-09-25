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
import type { CompanionSeed } from '../start-catalog-mechanics';
import { buildSummonCompanion, isSummonCard, needsFirstSummon } from './companion';
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
  /** 首召入库（2026-09-17 巨兽召唤池）：卡名 → 伙伴种子（内容仓 cardPool 供给；未命中走缺省「铭灵」口径） */
  summonSeedOf?: (name: string) => CompanionSeed | undefined;
  /** 存档内已有角色名（首召判定；不传=按「全部首召」处理） */
  existingCharacterNames?: readonly string[];
  /** 伙伴出生地（缺省跟随主角所在地） */
  playerLocation?: string;
  saveId?: string;
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
  // 首召入库（2026-09-17 巨兽召唤池）：本场打出召唤卡且存档内无同名角色 →
  // 结算 commit 里 add_character 一名 type:'summon' 伙伴实体（确定性，军团排除）
  for (const name of input.session.playedCards) {
    const card = input.cardOf(name);
    if (!card || !isSummonCard(card)) continue;
    if (!needsFirstSummon(name, input.existingCharacterNames ?? [])) continue;
    patches.push({
      op: 'add_character',
      target: 'characters',
      value: buildSummonCompanion({
        card,
        seed: input.summonSeedOf?.(name),
        saveId: input.saveId ?? '',
        playerName: input.playerName,
        location: input.playerLocation ?? '',
      }),
    } as StatePatch);
  }
  return patches;
}
