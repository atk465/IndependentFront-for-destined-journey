/**
 * landscape.test.ts — 地景卡识别（阶段4）
 */
import { describe, it, expect } from 'vitest';
import { LANDSCAPE_ENTRY, isLandscapeCard } from './landscape';

describe('isLandscapeCard（词条含「地景」）', () => {
  it('地景词条命中', () => {
    expect(isLandscapeCard({ 词条: ['火', '地景'] })).toBe(true);
    expect(isLandscapeCard({ 词条: [LANDSCAPE_ENTRY] })).toBe(true);
  });
  it('普通元素/复合卡不是地景', () => {
    expect(isLandscapeCard({ 词条: ['火', '风', '燎原'] })).toBe(false);
    expect(isLandscapeCard({ 词条: [] })).toBe(false);
  });
});
