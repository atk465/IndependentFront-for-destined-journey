/**
 * craft-flow-hooks.ts — 制卡流程挂钩（2026-09-17）
 *
 * 两条天赋介入的是**制卡流程的成败判定**，而不是数值：
 *  - **赌运**（S「赌徒谬论」）：对冲融合（相克）大失败 → 叠一层厄运；
 *    厄运在下一次对冲融合时按层数把评级往上抬（用掉即清空）。
 *  - **回溯**（S「时间回溯」）：制卡失败时可回溯重裁一次，代价是大量精神力。
 *
 * ⚠️ **必须说清的一件事**：引擎的制卡**不扣素材**（`buildCraftPatches` 全程没有
 * `remove_item`），所以「所有素材和状态返回至制卡前」这一半没有落地对象——
 * 能落地的只有「重来一次」。这条已记入 backlog，等制卡真的消耗素材时再补完。
 *
 * 为什么这两条都落在「评级」上：**评级是制卡唯一的成败信号**（`CraftRating`）。
 * 引擎不做 Code 侧掷骰（`rollCraftRating` 没有生产调用方），评级由 craft_gen 声明，
 * 所以「提高成功率」在现有架构里只能表达为「把评级往上抬」。
 *
 * 纯度约束：纯函数、不 mutate。
 */

import type { CraftRating } from '../types';

/** 厄运计数在 worldFlags.counters 里的 key */
export const MISFORTUNE_KEY = '厄运';

/** 厄运：一次大失败叠几层（初稿） */
export const MISFORTUNE_PER_FAILURE = 1;

/** 只有这些评级算「大失败」（赌徒谬论叠厄运的触发条件） */
export function isGreatFailure(rating: CraftRating | undefined): boolean {
  return rating === '大失败';
}

/**
 * 厄运 → 本次制卡的评级上浮档数（纯函数）。
 *
 * 口径：按层数上浮、单次封顶 `maxLift`；**用掉即清空**（描述里是「提高下一次」）。
 * 层数为 0 或不是对冲融合 → 0（不给）。
 */
export function liftFromMisfortune(input: {
  /** 当前厄运层数 */
  layers: number;
  /** 本次是不是对冲融合（相克）——只在相克流派生效 */
  isClashFusion: boolean;
  /** 单次最多上浮档数（条目 `赌运{maxLift}`） */
  maxLift: number;
}): { lift: number; consumed: number; note?: string } {
  if (!input.isClashFusion) return { lift: 0, consumed: 0 };
  const layers = Math.max(0, Math.floor(input.layers) || 0);
  if (layers <= 0) return { lift: 0, consumed: 0 };
  const cap = Math.max(1, Math.round(input.maxLift) || 1);
  const lift = Math.min(layers, cap);
  return {
    lift,
    consumed: layers, // 用掉即清空——描述是「下一次」
    note: `【赌徒谬论】${layers} 层厄运一次押上——对冲融合评级上浮 ${lift} 档`,
  };
}

// ════════════════════════════════════════════════════════════════════
// 调教（调教大师系统）
// ════════════════════════════════════════════════════════════════════

/** 调教方向（描述里「培养成忠犬还是女王，都由你决定」） */
export const TRAIN_DIRECTIONS = ['忠犬', '女王'] as const;
export type TrainDirection = (typeof TRAIN_DIRECTIONS)[number];

/** 调教信息存在卡的 `data.调教`（卡的自定义数据袋，旧档缺省 = 未调教） */
export interface TrainingState {
  level: number;
  direction?: TrainDirection;
}

/** 从卡的 data 里读调教状态（脏值兜底成未调教） */
export function trainingOf(data: unknown): TrainingState {
  if (!data || typeof data !== 'object') return { level: 0 };
  const raw = (data as Record<string, unknown>).调教;
  if (typeof raw === 'number') return { level: Math.max(0, Math.round(raw)) };
  if (raw && typeof raw === 'object') {
    const { level, direction } = raw as Partial<TrainingState>;
    const lv =
      typeof level === 'number' && Number.isFinite(level) ? Math.max(0, Math.round(level)) : 0;
    const dir =
      typeof direction === 'string' && (TRAIN_DIRECTIONS as readonly string[]).includes(direction)
        ? (direction as TrainDirection)
        : undefined;
    return { level: lv, ...(dir ? { direction: dir } : {}) };
  }
  return { level: 0 };
}

export interface TrainPlan {
  from: TrainingState;
  to: TrainingState;
  /** 本次提升带来的卡面战力增量（每级 +1） */
  powerGain: number;
  summary: string;
}

/**
 * 规划一次调教（纯函数）。
 *
 * 口径：每调教一级 **+1 卡面战力**（走既有的 `cardPowerBonus`，不新开成长轴）；
 * 方向词条只在第一次调教时写入（之后再调不再改方向——“性格一旦定了”）。
 * 到顶则拒绝，不静默吞掉动作。
 */
export function planTrain(
  card: { name: string; data?: unknown },
  direction: TrainDirection,
  maxLevel = 3,
): { ok: boolean; reason?: string; plan?: TrainPlan } {
  const from = trainingOf(card.data);
  const cap = Math.max(1, Math.round(maxLevel) || 1);
  if (from.level >= cap) {
    return { ok: false, reason: `【${card.name}】已经调教到顶（${from.level}/${cap}）` };
  }
  if (!(TRAIN_DIRECTIONS as readonly string[]).includes(direction)) {
    return { ok: false, reason: `未知的调教方向「${direction}」` };
  }
  const to: TrainingState = {
    level: from.level + 1,
    direction: from.direction ?? direction,
  };
  const first = from.level === 0;
  return {
    ok: true,
    plan: {
      from,
      to,
      powerGain: 1,
      summary: first
        ? `调教【${card.name}】——往后她朝「${to.direction}」的方向长（调教 0 → 1，战力 +1）`
        : `继续调教【${card.name}】——调教 ${from.level} → ${to.level}（战力 +1）`,
    },
  };
}

/** 调教度 → 展示一行（面板与战报共用） */
export function describeTraining(card: { name: string; data?: unknown }): string {
  const t = trainingOf(card.data);
  if (t.level === 0) return `${card.name}：未调教`;
  return `${card.name}：调教 ${t.level} 级${t.direction ? `（${t.direction}）` : ''}`;
}
