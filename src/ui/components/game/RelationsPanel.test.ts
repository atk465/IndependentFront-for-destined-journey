/**
 * RelationsPanel.test.ts — 关系网面板的性质（2026-10-02 批次F2）
 *
 * 1. 账本全览：一人一行——名字 + 11 级标签 + 数值（标签仅展示，不驱动行为）。
 * 2. 按 |好感| 降序——最深的羁绊/仇恨排最前。
 * 3. 空账本可见空态，不渲染空壳。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { mount } from '@vue/test-utils';

const mockGame: { saveProfile: { affections: Record<string, number> } | null } = reactive({
  saveProfile: null,
});

vi.mock('../../stores/game-store', () => ({ useGameStore: () => mockGame }));

import RelationsPanel from './RelationsPanel.vue';

beforeEach(() => {
  vi.clearAllMocks();
  mockGame.saveProfile = null;
});

describe('关系网面板', () => {
  it('空账本 → 空态可见', () => {
    mockGame.saveProfile = { affections: {} };
    const w = mount(RelationsPanel);
    expect(w.text()).toContain('好感账本还空着');
  });

  it('一人一行：标签随区间（≥90 誓死追随 / 负值敌意系），数值带符号', () => {
    mockGame.saveProfile = {
      affections: { 卡莲: 92, 阿尔弗雷德: 12, 夜枭: -40 },
    };
    const w = mount(RelationsPanel);
    expect(w.text()).toContain('卡莲');
    expect(w.text()).toContain('誓死追随');
    expect(w.text()).toContain('+92');
    expect(w.text()).toContain('阿尔弗雷德');
    expect(w.text()).toContain('略有善意');
    expect(w.text()).toContain('夜枭');
    expect(w.text()).toContain('厌恶');
    expect(w.text()).toContain('-40');
  });

  it('按 |好感| 降序：最深的排最前', () => {
    mockGame.saveProfile = {
      affections: { 甲: 10, 乙: -95, 丙: 50 },
    };
    const w = mount(RelationsPanel);
    const names = w.findAll('.rel-name').map((n) => n.text());
    expect(names).toEqual(['乙', '丙', '甲']);
  });
});
