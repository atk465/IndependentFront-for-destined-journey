import { describe, it, expect } from 'vitest';
import {
  EMOTIONS,
  emotionMaterialName,
  extractableEmotions,
  planEmotionExtract,
} from './emotion-material';

describe('planEmotionExtract（情绪素材提取）', () => {
  it('七种情绪齐备；提取产出对应素材', () => {
    expect(EMOTIONS).toHaveLength(7);
    const r = planEmotionExtract('傲慢', 100);
    expect(r.ok).toBe(true);
    expect(r.plan!.materialName).toBe(emotionMaterialName('傲慢'));
    expect(r.plan!.quantity).toBe(1);
  });

  it('同日同情绪限一次（异日/未记账可提）', () => {
    expect(planEmotionExtract('暴怒', 100, 100).ok).toBe(false);
    expect(planEmotionExtract('暴怒', 101, 100).ok).toBe(true);
    expect(planEmotionExtract('暴怒', 100, undefined).ok).toBe(true);
  });

  it('未知情绪拒绝；extractableEmotions 过滤已提取项', () => {
    expect(planEmotionExtract('快乐' as never, 1).ok).toBe(false);
    expect(extractableEmotions(100, { 傲慢: 100, 色欲: 99 })).not.toContain('傲慢');
    expect(extractableEmotions(100, { 傲慢: 100, 色欲: 99 })).toContain('色欲');
  });
});
