/**
 * true-name.ts — 真名看破（S「真名看破系统」）
 *
 * 天赋描述：「你可以看穿一切伪装，洞悉他人的真名和部分真实信息。念出对方的真名，
 * 可以对其造成一次强大的精神冲击。」
 *
 * 落地口径：
 *  - **念真名**＝每场一次的战斗动作，按「基础威力 + 每级追加 × 玩家等级」造成
 *    精神冲击。刻意**不用敌方 HP 百分比**——那是「倒也可斩」的口径；
 *    固定值让它在打小怪时过剩、打大怪时不足，两条大招因此有各自的适用面。
 *  - **看破**＝念过的名字会被记住（`worldFlags.trueNames`）。再次对上同一个名字时，
 *    冲击威力加成——「洞悉真名」这件事一旦发生就不会忘。
 *
 * 「看穿伪装」由叙事承担（引擎没有伪装/真相这两层数据），机械侧只做「念名字造成冲击」。
 *
 * 纯度约束：纯函数、不 mutate。
 */

/** 已记住的真名（worldFlags.trueNames：名字列表） */
export function coerceTrueNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** 这个名字认过了吗 */
export function hasTrueName(names: readonly string[], name: string): boolean {
  return names.includes(String(name ?? '').trim());
}

/** 记住一个真名（返回新表，不改入参） */
export function rememberTrueName(names: readonly string[] | undefined, name: string): string[] {
  const base = [...(names ?? [])];
  const n = String(name ?? '').trim();
  if (!n || base.includes(n)) return base;
  return [...base, n];
}

/**
 * 精神冲击威力（纯函数）。
 *
 * @param alreadyKnown 这个名字之前念过（**看破**的兑现：记住的名字威力更高）
 * @param knownBonus 已认过的名字追加的倍率（缺省 ×1.5）
 */
export function trueNameShockPower(input: {
  base: number;
  perLevel: number;
  playerLevel: number;
  alreadyKnown: boolean;
  knownBonus?: number;
}): { power: number; note: string } {
  const base = Math.max(0, Math.round(input.base) || 0);
  const perLevel = Math.max(0, Math.round(input.perLevel) || 0);
  const level = Number.isFinite(input.playerLevel) ? Math.max(1, Math.round(input.playerLevel)) : 1;
  const raw = base + perLevel * level;
  if (!input.alreadyKnown) {
    return { power: raw, note: `念出真名——精神冲击 ${raw}` };
  }
  const bonus = input.knownBonus && input.knownBonus > 1 ? input.knownBonus : 1.5;
  return {
    power: Math.round(raw * bonus),
    note: `这个名字你早就认下了——精神冲击 ×${bonus} → ${Math.round(raw * bonus)}`,
  };
}
