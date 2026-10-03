/**
 * emotion-material.ts — 情绪素材（SSS「七宗罪之主」的机制兑现，2026-09-17）
 *
 * 天赋描述：「进行【欲望主导】制卡时，无视精神侵蚀，且你可以从精神侵蚀中提取
 * 傲慢、色欲、嫉妒、暴怒、懒惰、暴食、贪婪七种情绪力量化为素材……这些卡拥有特殊
 * 情绪能力，并能通过情绪力量得到强化升级。」
 *
 * 本模块实现**提取侧**：持天赋者可在制卡台提取一种情绪素材（材料）。
 * 产出的素材为普通 `type:'材料'`，可直接用于制卡（走既有炼制链）；
 * 卡片的情绪词条由天赋自身的 `词条加权` 条目承担（内容侧已配）。
 *
 * 限频：同一天（gameDay）内每种情绪最多提取一次——用 `lastExtractDay` 记账，
 * 由调用方传入当天 gameDay（纯函数不读时钟）。
 */

export const EMOTIONS = ['傲慢', '色欲', '嫉妒', '暴怒', '懒惰', '暴食', '贪婪'] as const;
export type Emotion = (typeof EMOTIONS)[number];

/** 情绪素材名（逻辑键=名字；内容侧可再命名文案） */
export function emotionMaterialName(e: Emotion): string {
  return `情绪素材·${e}`;
}

export interface EmotionExtractPlan {
  emotion: Emotion;
  /** 产出的材料名（add_item 用） */
  materialName: string;
  quantity: number;
  summary: string;
}

export interface EmotionExtractValidation {
  ok: boolean;
  reason?: string;
}

/**
 * 规划一次情绪提取（纯函数）。
 *
 * @param emotion 目标情绪
 * @param today 当前 gameDay（调用方从 gameTime 折算）
 * @param lastExtractDay 该情绪的最近提取日（存档记账；缺省从未提取）
 */
export function planEmotionExtract(
  emotion: Emotion,
  today: number,
  lastExtractDay?: number,
): EmotionExtractValidation & { plan?: EmotionExtractPlan } {
  if (!EMOTIONS.includes(emotion)) {
    return { ok: false, reason: `未知情绪「${emotion}」` };
  }
  if (typeof lastExtractDay === 'number' && lastExtractDay === today) {
    return { ok: false, reason: `【${emotion}】今日已提取过——每天每种情绪一次` };
  }
  const materialName = emotionMaterialName(emotion);
  return {
    ok: true,
    plan: {
      emotion,
      materialName,
      quantity: 1,
      summary: `自精神侵蚀中提取【${emotion}】——得「${materialName}」×1（可用于制卡）`,
    },
  };
}

/** 由存档记账反查「今天还能提取哪些情绪」（全部可提 = 未记账） */
export function extractableEmotions(
  today: number,
  lastExtractByEmotion: Partial<Record<Emotion, number>> | undefined,
): Emotion[] {
  return EMOTIONS.filter((e) => lastExtractByEmotion?.[e] !== today);
}
