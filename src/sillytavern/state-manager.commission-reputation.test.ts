/**
 * state-manager.commission-reputation.test.ts —— 委托声望的写路径门禁（切片 C）
 *
 * 钉两条：
 * ① AI 零写路径：vars_update 直接 delta profile.reputation（无 commission 来源）→ 拒绝；
 * ② 引擎委托结算：metadata.source='commission' 的 delta → 声望入账（clamp ≥ 0）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  initializeDatabase,
  clearAllData,
  saveCharacter,
  createDefaultSaveProfile,
  saveSaveProfile,
} from './database';
import { getProfile } from './save-profile';
import { createStateManager } from './state-manager';
import { createDefaultCharacterState } from './types';

const SAVE = 'commission-rep';

async function seedProfile(reputation?: number): Promise<void> {
  const profile = createDefaultSaveProfile(SAVE);
  if (reputation !== undefined) profile.reputation = reputation;
  await saveSaveProfile(profile);
  await saveCharacter(
    createDefaultCharacterState({
      id: 'p',
      saveId: SAVE,
      name: 'Player',
      type: 'player',
    }),
  );
}

beforeEach(async () => {
  await initializeDatabase();
  await clearAllData();
});

describe('delta_variable profile.reputation —— 委托声望门禁', () => {
  it('🔴 AI 直接 delta（无 commission 来源）→ 拒绝，声望不动', async () => {
    await seedProfile(10);
    const manager = createStateManager(SAVE);
    await expect(
      manager.commitDomainCommand([
        { op: 'delta_variable', target: 'profile.reputation', amount: 999 },
      ]),
    ).rejects.toThrow('声望只能由委托交付或天赋兑换变更');
    expect((await getProfile(SAVE)).reputation).toBe(10);
  });

  it('引擎委托结算（source=commission）→ 正负皆入账且 clamp ≥ 0', async () => {
    await seedProfile(10);
    const manager = createStateManager(SAVE);
    await manager.commitDomainCommand([
      {
        op: 'delta_variable',
        target: 'profile.reputation',
        amount: 8,
        metadata: { source: 'commission' },
      },
    ]);
    expect((await getProfile(SAVE)).reputation).toBe(18);

    await manager.commitDomainCommand([
      {
        op: 'delta_variable',
        target: 'profile.reputation',
        amount: -999,
        metadata: { source: 'commission' },
      },
    ]);
    expect((await getProfile(SAVE)).reputation).toBe(0);
  });

  it('旧档缺 reputation 字段 → 首次结算从 0 起算', async () => {
    await seedProfile();
    const profile = await getProfile(SAVE);
    delete (profile as { reputation?: number }).reputation; // 模拟旧档
    await saveSaveProfile(profile);
    const manager = createStateManager(SAVE);
    await manager.commitDomainCommand([
      {
        op: 'delta_variable',
        target: 'profile.reputation',
        amount: 5,
        metadata: { source: 'commission' },
      },
    ]);
    expect((await getProfile(SAVE)).reputation).toBe(5);
  });
});
