/**
 * companion-guard.ts — 挡刀承伤转移（伙伴实体化 D6，批②任务书 B2.3）
 *
 * 语义（任务书定稿，零发明空间）：
 * - 转移条件：!exited && guardHp > 0 && (loyal || hasReceiveHitPassive)
 *   loyal = saveProfile.affections[guardName] ≥ 30（忠诚门槛，负值怨怼侧永不挡刀）；
 *   hasReceiveHitPassive = 同名卡 cardEffects 存在 trigger === '受击时' 的条目。
 * - 转移结算：companionDamage = max(1, incoming − ⌊con/2⌋)，玩家承 0
 *   （承伤减伤对齐玩家公式形状：威胁 − ⌊防御/2⌋，下限 1）。
 * - 不满足条件返回 null（调用方照旧走玩家承伤链）。
 *
 * 纯函数；hp 归零 → exited 的会话维护在调用方（skirmish-session 拍结算）。
 */

export interface GuardTransferInput {
  /** 本拍 incoming 伤害（resolveBeat 的 playerDamage） */
  incoming: number;
  /** 伙伴防（= con，B2.1 基座面板） */
  con: number;
  /** 挡刀池余量（guard.hp） */
  guardHp: number;
  /** 忠诚门槛（affections ≥ 30） */
  loyal: boolean;
  /** 同名卡带「受击时」被动 */
  hasReceiveHitPassive: boolean;
  /** 已退场（重伤态）不再转移 */
  exited: boolean;
}

export interface GuardTransferPlan {
  transferred: boolean;
  /** 玩家实承（转移后恒 0） */
  playerDamage: number;
  /** 伙伴实承（减伤下限 1） */
  companionDamage: number;
}

/** 挡刀承伤转移裁定（纯函数）：不满足转移条件返回 null */
export function planGuardTransfer(input: GuardTransferInput): GuardTransferPlan | null {
  const incoming = Math.max(0, Math.round(input.incoming));
  if (input.exited || input.guardHp <= 0 || incoming <= 0) return null;
  if (!(input.loyal === true || input.hasReceiveHitPassive === true)) return null;
  const companionDamage = Math.max(1, incoming - Math.floor(Math.max(0, input.con) / 2));
  return { transferred: true, playerDamage: 0, companionDamage };
}
