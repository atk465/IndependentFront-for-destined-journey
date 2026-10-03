/**
 * material-entries.test.ts — 素材词条池的性质（2026-10-02 批次D）
 *
 * 1. **池内定值**：读侧门禁——池外名字丢弃、去重、最多 3 条（聚合面有界）。
 * 2. **位差**：主位/副位词条换位就不生效，「通用」恒生效——同一素材两个位两种价值。
 * 3. **内建基线**：正典风味指派，刻意避开测试夹具用的素材名（已钉死的评级不漂）。
 */
import { describe, it, expect } from 'vitest';
import type { InventoryItem } from '../types';
import {
  BUILTIN_MATERIAL_ENTRIES,
  MATERIAL_ENTRY_POOL,
  aggregateMaterialEntries,
  materialEntriesOf,
  visibleMaterialEntries,
} from './material-entries';

const mat = (name: string, data?: unknown): InventoryItem =>
  ({ name, quantity: 1, type: '材料', ...(data ? { data } : {}) }) as InventoryItem;

describe('素材词条池', () => {
  it('池 8 条：正负兼备，生效位只取三值，负向至少 3 条（低阶素材非严格更差）', () => {
    expect(MATERIAL_ENTRY_POOL).toHaveLength(8);
    for (const def of MATERIAL_ENTRY_POOL) {
      expect(['主位', '副位', '通用']).toContain(def.slot);
      expect(['正', '负']).toContain(def.polarity);
      expect(def.text.length).toBeGreaterThan(0);
    }
    expect(MATERIAL_ENTRY_POOL.filter((d) => d.polarity === '负').length).toBeGreaterThanOrEqual(3);
  });

  it('读侧门禁：data.词条 池外丢弃、去重、最多 3 条', () => {
    const entries = materialEntriesOf(
      mat('无名', { 词条: ['灵光', '池外词条', '灵光', '受潮', '浑成', '凝萃'] }),
    );
    expect(entries.map((d) => d.name)).toEqual(['灵光', '受潮', '浑成']);
    expect(materialEntriesOf(mat('无名'))).toEqual([]);
    expect(materialEntriesOf(mat('无名', { 词条: '不是数组' }))).toEqual([]);
  });

  it('位差：主位词条换到副位就不生效，「通用」恒生效', () => {
    const inv = [
      mat('千年树心', { 词条: ['浑成'] }), // 浑成=主位 power+1
      mat('水草', { 词条: ['受潮'] }), // 受潮=主位 dc−2
      mat('河蚌', { 词条: ['杂质'] }), // 杂质=副位 dc−1
    ];
    const asMain = aggregateMaterialEntries(inv, '千年树心', ['水草']);
    expect(asMain.power).toBe(1); // 浑成主位生效
    expect(asMain.dc).toBe(0); // 受潮是主位词条，水草在副位 → 不生效
    const asSub = aggregateMaterialEntries(inv, '水草', ['千年树心', '河蚌']);
    expect(asSub.dc).toBe(-3); // 水草受潮（主位）+ 河蚌杂质（副位）
    expect(asSub.power).toBe(0); // 浑成在副位不生效
    const notes = asSub.notes.join('；');
    expect(notes).toContain('受潮');
    expect(notes).toContain('杂质');
    expect(notes).not.toContain('浑成');
  });

  it('引韵：副位把素材首个元素写给产物', () => {
    const inv = [mat('赤铁矿'), mat('精灵花', { 词条: ['引韵'] })];
    const mods = aggregateMaterialEntries(inv, '赤铁矿', ['精灵花']);
    expect(mods.bonus词条).toEqual(['光']); // 精灵花内建档案 = 光
  });

  it('内建基线就位，且不碰测试夹具用的素材名（已钉死的评级不漂）', () => {
    expect(BUILTIN_MATERIAL_ENTRIES['月光苔']).toEqual(['灵光']);
    expect(BUILTIN_MATERIAL_ENTRIES['铜矿']).toEqual(['残瑕']);
    for (const used in { 火晶: 1, 赤铁矿: 1, 风羽: 1, 寒水珠: 1, 止血草: 1 }) {
      expect(BUILTIN_MATERIAL_ENTRIES[used]).toBeUndefined();
    }
  });
});

describe('visibleMaterialEntries —— UI 与结算同源（D-1）', () => {
  it('数据袋缺词条时回落名字映射（月光苔→灵光），与结算入口一致', () => {
    const noBag = mat('月光苔'); // 不写 data.词条
    expect(materialEntriesOf(noBag)).toEqual([]); // 严格数据袋口：空
    const vis = visibleMaterialEntries(noBag);
    expect(vis.map((e) => e.name)).toEqual(['灵光']);
  });

  it('数据袋有词条时优先数据袋；对照素材两口皆空', () => {
    const withBag = mat('火晶', { 词条: ['灵光'] });
    expect(visibleMaterialEntries(withBag).map((e) => e.name)).toEqual(['灵光']);
    expect(visibleMaterialEntries(mat('疾风羽'))).toEqual([]);
  });
});
