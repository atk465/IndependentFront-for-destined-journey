/**
 * state-manager.resource-guard.test.ts — 资源写入脏值门禁回归
 *
 * 背景（2026-10-01 新档 HP 归零实测）：vars_update 模型输出 value:null 时，
 * `Math.min(null, max)` 按 JS 规格把 null/"" 归零成 0 → hp/mp/sp 静默清零落库，
 * 刷新也不恢复。修复后三层拦截：翻译层源头跳过、set_* 拒写、update_character
 * 资源字段原子拒绝；delta 脏增量按 0 处理并留 warn。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initializeDatabase, clearAllData, saveCharacter, getCharacters } from './database';
import { createStateManager } from './state-manager';
import { createDefaultCharacterState } from './types';

beforeEach(async () => {
  await initializeDatabase();
  await clearAllData();
  await saveCharacter(
    createDefaultCharacterState({
      id: 'p',
      saveId: 'resguard',
      name: 'Player',
      type: 'player',
    }),
  );
});

/** 默认角色：hp 100 / mp 50 / sp 50 */
async function readHp(): Promise<{ hp: number; maxHp: number; mp: number; sp: number }> {
  const c = (await getCharacters('resguard'))[0];
  return { hp: c.hp, maxHp: c.maxHp, mp: c.mp, sp: c.sp };
}

describe('set_hp/set_mp/set_sp 脏值拒写', () => {
  it('value=null / "" / undefined 一律不改资源（修复前 null 会被归零成 0 落库）', async () => {
    const sm = createStateManager('resguard');

    const r1 = await sm.commitChatState([
      { op: 'set_hp', target: 'characters.Player', value: null },
    ]);
    expect(r1.success).toBe(true);
    expect((await readHp()).hp).toBe(100);

    await sm.commitChatState([{ op: 'set_mp', target: 'characters.Player', value: '' }]);
    expect((await readHp()).mp).toBe(50);

    await sm.commitChatState([{ op: 'set_sp', target: 'characters.Player', value: undefined }]);
    expect((await readHp()).sp).toBe(50);
  });

  it('合法数值照常写入（守卫不误伤）', async () => {
    const sm = createStateManager('resguard');
    const result = await sm.commitChatState([
      { op: 'set_hp', target: 'characters.Player', value: 88 },
    ]);
    expect(result.success).toBe(true);
    expect((await readHp()).hp).toBe(88);
  });
});

describe('update_character 资源字段强校验', () => {
  it('🔴 资源专线令：update_character 写资源一律原子拒绝（含合法数值）', async () => {
    const sm = createStateManager('resguard');
    const r = await sm.commitChatState([
      { op: 'update_character', target: 'characters.Player', value: { hp: null, money: 10 } },
    ]);
    expect(r.success).toBe(false);
    expect(r.errors.join('; ')).toContain('禁止写资源');

    const r2 = await sm.commitChatState([
      { op: 'update_character', target: 'characters.Player', value: { maxHp: '' } },
    ]);
    expect(r2.success).toBe(false);

    // 合法数值同样拒绝——资源只有一个语义家（set_*/delta_*/set_max_* 专线）
    const r3 = await sm.commitChatState([
      { op: 'update_character', target: 'characters.Player', value: { hp: 77, maxHp: 625 } },
    ]);
    expect(r3.success).toBe(false);

    // 原子性：money 也不落地
    expect((await getCharacters('resguard'))[0].money).toBe(0);
  });

  it('set_max_hp 专线：降上限且当前 HP 跟着收口（称心秤路径）', async () => {
    const sm = createStateManager('resguard');
    await sm.commitChatState([{ op: 'set_hp', target: 'characters.Player', value: 90 }]);
    const r = await sm.commitChatState([
      { op: 'set_max_hp', target: 'characters.Player', value: 500 },
    ]);
    expect(r.success).toBe(true);
    const c = await readHp();
    expect(c.maxHp).toBe(500);
    expect(c.hp).toBe(90); // 未超上限的当前值不动
    await sm.commitChatState([{ op: 'set_max_hp', target: 'characters.Player', value: 60 }]);
    const c2 = await readHp();
    expect(c2.maxHp).toBe(60);
    expect(c2.hp).toBe(60); // 超上限的当前值被钳回新上限
  });

  it('🔴 开局轮归零回归：满血时的「回复量差值=0」经 delta 专线是无害 no-op', async () => {
    // 修复前：applyDayRolloverRegen 把差值当绝对值发 update_character {hp:0,mp:0,sp:0}
    // → 赋值落库 → 新档三资源全零。现在差值走 delta_hp(0)——不改资源。
    const sm = createStateManager('resguard');
    const r = await sm.commitChatState([
      { op: 'delta_hp', target: 'characters.Player', amount: 0 },
      { op: 'delta_mp', target: 'characters.Player', amount: 0 },
      { op: 'delta_sp', target: 'characters.Player', amount: 0 },
    ]);
    expect(r.success).toBe(true);
    const c = await readHp();
    expect(c).toEqual({ hp: 100, maxHp: 100, mp: 50, sp: 50 });
  });
});

describe('delta_* 脏增量按 0 处理', () => {
  it('amount 字符串/ null 不改资源；合法负 delta 照常结算', async () => {
    const sm = createStateManager('resguard');

    await sm.commitChatState([
      { op: 'delta_hp', target: 'characters.Player', amount: '5' as unknown as number },
    ]);
    expect((await readHp()).hp).toBe(100);

    await sm.commitChatState([
      { op: 'delta_mp', target: 'characters.Player', amount: null as unknown as number },
    ]);
    expect((await readHp()).mp).toBe(50);

    await sm.commitChatState([{ op: 'delta_hp', target: 'characters.Player', amount: -30 }]);
    expect((await readHp()).hp).toBe(70);
  });
});
