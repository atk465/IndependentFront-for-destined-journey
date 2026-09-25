/**
 * demo.test.ts — 演示卡注入与卡组种子
 */
import { describe, it, expect } from 'vitest';
import { buildDemoCardsPatches, buildDemoDeckPatches } from './demo';

describe('buildDemoCardsPatches（演示卡+素材）', () => {
  it('4 张卡 + 3 份素材；卡牌类型限定为「卡牌」、素材为「材料」', () => {
    const patches = buildDemoCardsPatches('艾拉');
    const addItem = patches.filter((p) => p.op === 'add_item');
    expect(addItem).toHaveLength(7);
    const cards = addItem.filter((p) => (p.value as { type: string }).type === '卡牌');
    expect(cards).toHaveLength(4);
    expect(cards.map((p) => (p.value as { name: string }).name)).toEqual([
      '灼热盆地',
      '远古巨兽·岩爪',
      '燃魂打击',
      '苍穹之翼',
    ]);
    const materials = addItem.filter((p) => (p.value as { type: string }).type === '材料');
    expect(materials.map((p) => (p.value as { name: string }).name).sort()).toEqual([
      '地脉髓',
      '火晶',
      '疾风羽',
    ]);
    expect(addItem.every((p) => p.target === 'characters.艾拉')).toBe(true);
  });
});

describe('buildDemoDeckPatches（演示种子：重置卡组为演示卡全集）', () => {
  it('owned 与 deck 同为 4 张演示卡名；capacity 60', () => {
    const patches = buildDemoDeckPatches('艾拉');
    expect(patches).toHaveLength(1);
    const p = patches[0];
    expect(p.op).toBe('update_character');
    expect(p.target).toBe('characters.艾拉');
    const v = p.value as { cardAlbum: { owned: string[]; deck: string[]; capacity: number } };
    expect(v.cardAlbum.owned).toEqual(['灼热盆地', '远古巨兽·岩爪', '燃魂打击', '苍穹之翼']);
    expect(v.cardAlbum.deck).toEqual(v.cardAlbum.owned);
    expect(v.cardAlbum.capacity).toBe(60);
  });
});
