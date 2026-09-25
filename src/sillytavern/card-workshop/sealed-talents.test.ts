/**
 * sealed-talents.test.ts — 无名河封印天赋账纯函数合同
 *
 * 钉住 coerce 容错（旧档/脏值不炸）、filter 的封印语义（账>0 即不在场、空账原样拷贝
 * 不共享引用）、decrement 的归还语义（归零移除并记入 returned）。
 */
import { describe, it, expect } from 'vitest';
import { coerceSealedTalents, decrementSealedTalents, filterSealedTalents } from './sealed-talents';

describe('coerceSealedTalents（脏值兜底）', () => {
  it('null/undefined/数组/原始值一律空账', () => {
    expect(coerceSealedTalents(null)).toEqual({});
    expect(coerceSealedTalents(undefined)).toEqual({});
    expect(coerceSealedTalents(['体魄'])).toEqual({});
    expect(coerceSealedTalents('体魄')).toEqual({});
    expect(coerceSealedTalents(42)).toEqual({});
  });

  it('非正数/非有限数/非数字条目丢弃；小数向下取整', () => {
    expect(
      coerceSealedTalents({
        好的: 3,
        零: 0,
        负: -1,
        小数: 2.9,
        非数字: '三',
        空键: '',
      }),
    ).toEqual({ 好的: 3, 小数: 2 });
  });
});

describe('filterSealedTalents（交锋结算面过滤）', () => {
  const talents = [{ name: '体魄' }, { name: '免死' }, { name: '真名' }] as const;

  it('账>0 的天赋不在场；空账原样拷贝且不共享引用', () => {
    const out = filterSealedTalents([...talents], { 免死: 3 });
    expect(out.map((t) => t.name)).toEqual(['体魄', '真名']);

    const passthrough = filterSealedTalents([...talents], {});
    expect(passthrough).toEqual([...talents]);
    expect(passthrough).not.toBe(talents);
  });

  it('undefined/非数组输入安全返回空数组', () => {
    expect(filterSealedTalents(undefined, { 免死: 1 })).toEqual([]);
    expect(filterSealedTalents(undefined, {})).toEqual([]);
  });
});

describe('decrementSealedTalents（每场终局递减）', () => {
  it('剩余>1 递减一场；归零移除并记入归还名单', () => {
    const tick = decrementSealedTalents({ 体魄: 3, 免死: 1 });
    expect(tick.ledger).toEqual({ 体魄: 2 });
    expect(tick.returned).toEqual(['免死']);
  });

  it('全归零 → 空账；空账递减是 no-op', () => {
    expect(decrementSealedTalents({ 体魄: 1 })).toEqual({ ledger: {}, returned: ['体魄'] });
    expect(decrementSealedTalents({})).toEqual({ ledger: {}, returned: [] });
  });
});
