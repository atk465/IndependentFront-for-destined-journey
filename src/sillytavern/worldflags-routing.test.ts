/**
 * worldflags-routing.test.ts — worldFlags 前缀路由回归（2026-09-19 双袋修复）
 *
 * 背景：`set_variable worldFlags.x` 此前落进 `variables.sys.worldFlags`——零读者的死袋
 * （读侧全部走 `profile.worldFlags`），宿敌/败犬烙印/每日账本/排查足迹/委托闭环等全部
 * 写路径从未真正落库生效。修复后：worldFlags. 前缀的写 op 路由进 `profile.worldFlags`
 * 子树（variables 通道不再收 worldFlags 数据）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initializeDatabase, clearAllData, saveSaveProfile } from './database';
import { getProfile } from './save-profile';
import { createStateManager } from './state-manager';
import { createDefaultSaveProfile } from './database';

beforeEach(async () => {
  await initializeDatabase();
  await clearAllData();
  await saveSaveProfile(createDefaultSaveProfile('probe'));
});

describe('worldFlags 前缀路由（set/delta/remove 写 profile.worldFlags）', () => {
  it('set_variable 落 profile.worldFlags 子树，variables 侧不再收 worldFlags', async () => {
    const sm = createStateManager('probe');
    const r = await sm.commitChatState([
      { op: 'set_variable', target: 'worldFlags.probe', value: 1 },
    ]);
    expect(r.success).toBe(true);
    const profile = await getProfile('probe');
    expect((profile.worldFlags as Record<string, unknown>).probe).toBe(1);
    expect(
      (profile.variables as Record<string, any>)?.sys?.worldFlags?.probe,
    ).toBeUndefined();
  });

  it('嵌套子路径（fired.事件名 形态）正确落树', async () => {
    const sm = createStateManager('probe');
    await sm.commitChatState([
      { op: 'set_variable', target: 'worldFlags.randomEvents.fired.事件A', value: { count: 1 } },
    ]);
    const profile = await getProfile('probe');
    const bag = profile.worldFlags as Record<string, any>;
    expect(bag.randomEvents.fired['事件A']).toEqual({ count: 1 });
  });

  it('delta_variable 在 worldFlags 上累加', async () => {
    const sm = createStateManager('probe');
    await sm.commitChatState([
      { op: 'set_variable', target: 'worldFlags.counters.烙印', value: 2 },
      { op: 'delta_variable', target: 'worldFlags.counters.烙印', amount: 3 },
    ]);
    const profile = await getProfile('probe');
    const bag = profile.worldFlags as Record<string, any>;
    expect(bag.counters.烙印).toBe(5);
  });

  it('remove_variable 从 worldFlags 删除', async () => {
    const sm = createStateManager('probe');
    await sm.commitChatState([
      { op: 'set_variable', target: 'worldFlags.taunted', value: { by: 'x' } },
      { op: 'remove_variable', target: 'worldFlags.taunted' },
    ]);
    const profile = await getProfile('probe');
    expect((profile.worldFlags as Record<string, unknown>).taunted).toBeUndefined();
  });

  it('非 worldFlags target 不受路由影响（variables 正常）', async () => {
    const sm = createStateManager('probe');
    await sm.commitChatState([
      { op: 'set_variable', target: 'variables.sys.天气', value: '雨' },
    ]);
    const profile = await getProfile('probe');
    expect((profile.variables as Record<string, any>).sys.天气).toBe('雨');
  });
});
