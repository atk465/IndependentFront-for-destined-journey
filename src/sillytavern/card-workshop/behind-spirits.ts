/**
 * behind-spirits.ts — 身后灵（S「瓦尔哈拉的门票」）
 *
 * 天赋描述：「当你的女性伙伴卡战死时，她的灵魂不会消散，而是化作半透明的女武神
 * 幽灵永远绑定在你的身体，成为身后灵。」
 *
 * **必须说清的一个裁断**：引擎里伙伴卡不会在战斗中「战死」（没有卡的生命值，
 * 也没有战死结算通道）。所以这条天赋落地为**玩家可以主动送她成灵**——
 * 一张伙伴卡退场，换一枚永久守护。语义上仍然是「她的灵魂从此跟着你」，
 * 只是触发权交回玩家手里，而不是等一个不存在的战死事件。
 *
 * 身后灵存 `worldFlags.behindSpirits`，每枚提供固定防御加成（档位在条目 `成灵{guardPerSpirit}`）。
 *
 * 纯度约束：纯函数、不 mutate。
 */

export interface BehindSpirit {
  /** 化灵的伙伴卡名（记账与展示用） */
  name: string;
  /** 她生前的卡面战力（留个念想，也便于日后按强度分档加成） */
  power: number;
}

/** 宽读：从存档里取出身后灵表（脏值丢弃，绝不抛） */
export function coerceSpirits(raw: unknown): BehindSpirit[] {
  if (!Array.isArray(raw)) return [];
  const out: BehindSpirit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { name, power } = item as Partial<BehindSpirit>;
    if (typeof name !== 'string' || !name.trim()) continue;
    out.push({
      name: name.trim(),
      power:
        typeof power === 'number' && Number.isFinite(power) ? Math.max(0, Math.round(power)) : 0,
    });
  }
  return out;
}

/** 追加一枚身后灵（返回新表，不改入参；同名不重复记） */
export function addSpirit(list: BehindSpirit[] | undefined, spirit: BehindSpirit): BehindSpirit[] {
  const base = list ?? [];
  if (base.some((s) => s.name === spirit.name)) return [...base];
  return [...base, spirit];
}

/** 汇总文案（制卡台与战报共用一行） */
export function describeSpirits(list: readonly BehindSpirit[]): string {
  if (list.length === 0) return '还没有身后灵。';
  return `${list.length} 位身后灵：${list.map((s) => s.name).join('、')}`;
}
