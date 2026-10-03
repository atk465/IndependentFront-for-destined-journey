import { describe, it, expect } from 'vitest';
import { planGuardTransfer } from './companion-guard';

const base = {
  incoming: 10,
  con: 4,
  guardHp: 30,
  loyal: true,
  hasReceiveHitPassive: false,
  exited: false,
};

describe('planGuardTransfer（伙伴实体化 D6 挡刀，批② B2.3）', () => {
  it('忠诚达标 → 转移：玩家承 0，伙伴承 max(1, incoming−⌊con/2⌋)', () => {
    expect(planGuardTransfer(base)).toEqual({
      transferred: true,
      playerDamage: 0,
      companionDamage: 8, // 10 − ⌊4/2⌋
    });
  });

  it('带「受击时」被动（忠诚不足）→ 转移', () => {
    expect(planGuardTransfer({ ...base, loyal: false, hasReceiveHitPassive: true })).toEqual({
      transferred: true,
      playerDamage: 0,
      companionDamage: 8,
    });
  });

  it('忠诚不足且无被动 → null（照旧走玩家承伤链）', () => {
    expect(planGuardTransfer({ ...base, loyal: false, hasReceiveHitPassive: false })).toBeNull();
  });

  it('已退场 → null（重伤态不再转移）', () => {
    expect(planGuardTransfer({ ...base, exited: true })).toBeNull();
  });

  it('挡刀池打空（guardHp ≤ 0）→ null', () => {
    expect(planGuardTransfer({ ...base, guardHp: 0 })).toBeNull();
    expect(planGuardTransfer({ ...base, guardHp: -3 })).toBeNull();
  });

  it('incoming 为 0 → null（无伤可挡）', () => {
    expect(planGuardTransfer({ ...base, incoming: 0 })).toBeNull();
  });

  it('减伤下限 1：高防/低伤不出现 0 承伤与负数', () => {
    expect(planGuardTransfer({ ...base, incoming: 1, con: 100 })).toEqual({
      transferred: true,
      playerDamage: 0,
      companionDamage: 1, // max(1, 1−50)
    });
    expect(planGuardTransfer({ ...base, incoming: 3, con: 4 })).toEqual({
      transferred: true,
      playerDamage: 0,
      companionDamage: 1, // 3 − 2
    });
  });

  it('奇数防向下取整：⌊con/2⌋', () => {
    expect(planGuardTransfer({ ...base, incoming: 7, con: 3 })?.companionDamage).toBe(6);
  });
});
