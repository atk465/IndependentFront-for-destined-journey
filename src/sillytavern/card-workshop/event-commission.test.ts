/**
 * event-commission.test.ts —— 事件委托纯函数（随机事件 × 委托板融合）
 */
import { describe, it, expect } from 'vitest';
import {
  buildEventCommission,
  eventCommissionDefs,
  isEventCommissionActive,
  pruneEventCommissions,
  EVENT_COMMISSION_DEFAULT_TTL_DAYS,
} from './event-commission';
import type { EventCommissionTemplate } from './commission';

const tpl: EventCommissionTemplate = {
  name: '讨伐盗贼团',
  description: '盗贼团袭击了商队，讨伐他们！',
  requireCard: { minTier: '白银', formEntry: '直击' },
  rewards: { gc: 120, reputation: 15 },
};

describe('buildEventCommission', () => {
  it('模板实例化：def 剥掉 ttlDays、来源事件与到期日正确', () => {
    const ec = buildEventCommission(tpl, '盗贼团袭击', 100)!;
    expect(ec.def.name).toBe('讨伐盗贼团');
    expect(ec.def).not.toHaveProperty('ttlDays');
    expect(ec.sourceEvent).toBe('盗贼团袭击');
    expect(ec.armedDay).toBe(100);
    expect(ec.expiresDay).toBe(100 + EVENT_COMMISSION_DEFAULT_TTL_DAYS);
  });

  it('ttlDays 可覆盖缺省（正整数向下取整）', () => {
    const ec = buildEventCommission({ ...tpl, ttlDays: 3 }, 'e', 10)!;
    expect(ec.expiresDay).toBe(13);
    const ec2 = buildEventCommission({ ...tpl, ttlDays: 2.9 }, 'e', 10)!;
    expect(ec2.expiresDay).toBe(12);
  });

  it('currentDay 非法 → null（按没生成处理）', () => {
    expect(buildEventCommission(tpl, 'e', Number.NaN)).toBeNull();
    expect(buildEventCommission(tpl, 'e', Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('isEventCommissionActive / pruneEventCommissions', () => {
  it('有效期 = 触发起 ttlDays 天（10 日触发 + 7 天 → 10~16 有效，17 过期）', () => {
    const ec = buildEventCommission(tpl, 'e', 10)!; // expiresDay = 17
    expect(isEventCommissionActive(ec, 10)).toBe(true);
    expect(isEventCommissionActive(ec, 16)).toBe(true);
    expect(isEventCommissionActive(ec, 17)).toBe(false);
    expect(isEventCommissionActive(ec, 18)).toBe(false);
  });

  it('prune 只摘过期，有效保留且保序', () => {
    const a = buildEventCommission(tpl, 'a', 10)!; // 到期 17
    const b = buildEventCommission({ ...tpl, name: 'b委托', ttlDays: 30 }, 'b', 10)!; // 到期 40
    const kept = pruneEventCommissions([a, b], 20);
    expect(kept.map((x) => x.def.name)).toEqual(['b委托']);
  });

  it('undefined / 空列表 → 空数组（兜底合同）', () => {
    expect(pruneEventCommissions(undefined, 10)).toEqual([]);
    expect(pruneEventCommissions([], 10)).toEqual([]);
  });
});

describe('eventCommissionDefs —— 视图转换', () => {
  it('转出 CommissionDef 形状（无 ttlDays/溯源字段）并过滤过期', () => {
    const a = buildEventCommission(tpl, 'a', 10)!;
    const b = buildEventCommission({ ...tpl, name: 'b委托', ttlDays: 1 }, 'b', 10)!; // 到期 11
    const defs = eventCommissionDefs([a, b], 12);
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('讨伐盗贼团');
    expect(defs[0].rewards).toEqual(tpl.rewards);
    expect(defs[0]).not.toHaveProperty('sourceEvent');
  });
});
