/**
 * opponent-blueprints.ts — 支配者倒影的技能蓝本（S「支配者倒影」）
 *
 * 天赋描述：「你崇拜着将你踩在脚下的强者。被敌人击败后，你可以复制对方的一个技能，
 * 并以此为蓝本，在制卡时创造出一张全新的技能卡。」
 *
 * 落地口径：
 *  - **复制来源**：战败（败北）时，从敌方预提交的招式里挑**威胁最高**的那一式
 *    ——「崇拜把你踩在脚下的强者」就是崇拜他最强的那一手，确定性可复算。
 *  - **蓝本用途**：制卡时选用一份蓝本，产物**定格为技能卡**（词条加「技能」），
 *    且评级**上浮一档**——照着别人的成名招式做，比凭空摸索稳。
 *  - **消耗**：一份蓝本用一次（用完即从账上扣掉）。上限由 `ENEMY_HOLDS` 限。
 *
 * 为什么自动复制而不是弹窗问玩家：结算发生在一次原子提交里，中途插交互会打断
 * 「一股气算完」的体验；而复制本身没有代价（用不用在制卡时决定），所以自动记下
 * 并给出可见提示，是这条天赋最不啰嗦的形态。
 *
 * 纯度约束：纯函数、不 mutate。
 */

import type { CardTier } from '../field-enums';

/** 一份技能蓝本（worldFlags.skillBlueprints） */
export interface SkillBlueprint {
  /** 招式名（= 敌方意图的 move） */
  name: string;
  /** 从谁身上抄来的 */
  from: string;
  /** 结缘的 gameDay（展示用） */
  day?: number;
  /** 那一式的威胁值（越高的越值得抄，也用来分档） */
  threat?: number;
}

/** 同时最多留几份蓝本（超出丢最旧的） */
export const ENEMY_HOLDS = 5;

/** 宽读：脏值逐条丢弃，绝不抛 */
export function coerceBlueprints(raw: unknown): SkillBlueprint[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillBlueprint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { name, from, day, threat } = item as Partial<SkillBlueprint>;
    if (typeof name !== 'string' || !name.trim()) continue;
    out.push({
      name: name.trim(),
      from: typeof from === 'string' && from.trim() ? from.trim() : '无名者',
      ...(typeof day === 'number' && Number.isFinite(day) ? { day: Math.floor(day) } : {}),
      ...(typeof threat === 'number' && Number.isFinite(threat)
        ? { threat: Math.round(threat) }
        : {}),
    });
  }
  return out;
}

/**
 * 从敌方预提交的招式里挑出**值得抄的那一式**（纯函数）。
 *
 * 口径：威胁最高者；并列时取序列里靠前的（确定性）。没有可用招式 → undefined。
 */
export function pickCopyTarget(intents: unknown): { move: string; threat: number } | undefined {
  if (!Array.isArray(intents)) return undefined;
  let best: { move: string; threat: number } | undefined;
  for (const raw of intents) {
    if (!raw || typeof raw !== 'object') continue;
    const { move, threat } = raw as { move?: unknown; threat?: unknown };
    if (typeof move !== 'string' || !move.trim()) continue;
    const t = typeof threat === 'number' && Number.isFinite(threat) ? Math.round(threat) : 0;
    if (!best || t > best.threat) best = { move: move.trim(), threat: t };
  }
  return best;
}

/** 记一份蓝本（返回新表，不改入参；同名不重复记，超出上限丢最旧的） */
export function addBlueprint(
  list: readonly SkillBlueprint[] | undefined,
  bp: SkillBlueprint,
): SkillBlueprint[] {
  const base = [...(list ?? [])];
  if (base.some((b) => b.name === bp.name)) return base;
  const next = [...base, bp];
  return next.length > ENEMY_HOLDS ? next.slice(next.length - ENEMY_HOLDS) : next;
}

/** 消耗一份蓝本（返回新表；不需要写回失败态——找不到就是没消耗） */
export function consumeBlueprint(
  list: readonly SkillBlueprint[] | undefined,
  name: string,
): SkillBlueprint[] {
  return (list ?? []).filter((b) => b.name !== name);
}

/** 蓝本 → 展示一行 */
export function describeBlueprints(list: readonly SkillBlueprint[]): string {
  if (list.length === 0) return '还没有从败仗里学到什么。';
  return list.map((b) => `${b.name}（抄自 ${b.from}）`).join('；');
}

/**
 * 蓝本带来的制卡收益（纯函数）。
 *
 * 两条：产物定格为**技能卡**（形态不是数值），以及评级**上浮一档**
 * （「照着成名招式做」的兑现）。档位不动——档位仍由素材与融合内核决定。
 */
export function blueprintCraftBonus(): { formEntry: string; ratingLift: number; note: string } {
  return {
    formEntry: '技能',
    ratingLift: 1,
    note: '【支配者倒影】照着他的成名招式来——产物定格为技能卡，评级上浮一档',
  };
}

/** 蓝本威胁值 → 展示用的档位提示（不参与数值，只帮玩家判断值不值得抄） */
export function threatTierOf(threat: number | undefined): CardTier | undefined {
  const t = typeof threat === 'number' && Number.isFinite(threat) ? threat : 0;
  if (t <= 0) return undefined;
  if (t <= 8) return '白铁';
  if (t <= 14) return '青铜';
  if (t <= 20) return '白银';
  if (t <= 30) return '鎏金';
  return '星辉';
}
