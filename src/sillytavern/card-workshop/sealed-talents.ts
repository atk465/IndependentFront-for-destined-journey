/**
 * 无名河封印天赋账（委托×地图七链 2026-09-21）。
 *
 * 存档落点：`worldFlags.sealedTalents` —— 天赋名 → 剩余场数（number）。
 * 语义：打出【禁忌卡·无名河】随机卷走一个天赋三场；被封印的天赋在**交锋结算面**
 * 全程无效（战斗动作/开战评估/拍结算/免死/战后结算），战斗外（制卡流/叙事）照常；
 * 每场战斗终局递减一场，归零归还。
 *
 * 纯函数叶：零 I/O、零时钟、零 Math.random —— 随机选取与落库由 pipeline 接线层负责。
 * 旧档/脏值一律由 coerceSealedTalents 兜底（与 coerceCounters 同款容错哲学）。
 */

export type SealedTalentLedger = Record<string, number>;

/** 任意脏值 → 合法账（非对象/数组 → 空；非正数/非有限数条目丢弃） */
export function coerceSealedTalents(raw: unknown): SealedTalentLedger {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: SealedTalentLedger = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!name) continue;
    const n = typeof value === 'number' ? Math.floor(value) : Number.NaN;
    if (Number.isFinite(n) && n > 0) out[name] = n;
  }
  return out;
}

/** 交锋结算面读的天赋表：去掉封印中的天赋（账>0 即视为不在场）；空账原样拷贝 */
export function filterSealedTalents<T extends { name: string }>(
  list: readonly T[] | undefined,
  ledger: SealedTalentLedger,
): T[] {
  const safe = Array.isArray(list) ? list : [];
  if (Object.keys(ledger).length === 0) return [...safe];
  return safe.filter((t) => !(ledger[t.name] > 0));
}

/** 每场战斗终局递减一场；归零条目移除并记入 returned（归还名单） */
export function decrementSealedTalents(ledger: SealedTalentLedger): {
  ledger: SealedTalentLedger;
  returned: string[];
} {
  const next: SealedTalentLedger = {};
  const returned: string[] = [];
  for (const [name, left] of Object.entries(ledger)) {
    if (left <= 1) returned.push(name);
    else next[name] = left - 1;
  }
  return { ledger: next, returned };
}
