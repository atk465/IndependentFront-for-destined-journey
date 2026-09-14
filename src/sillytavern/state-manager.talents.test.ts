/**
 * state-manager.talents.test.ts —— 天赋写入门禁（T-S1）
 *
 * 钉合同：AI 零编数（条目逐字命中池，伪造参数/渠道被拒或纠正）、同名唯一、
 * 容量上限、互斥组不可共存。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initializeDatabase, clearAllData, saveCharacter, getCharacters } from './database';
import { createStateManager } from './state-manager';
import { createDefaultCharacterState } from './types';
import type { TalentEntry } from './card-workshop/talent-entry';

const SAVE = 'talents-gate';

const 品质突破摩托: TalentEntry = {
  kind: '品质突破',
  channel: 'fusion',
  params: { materialClass: '废弃', productClass: '摩托' },
};
const 命运宠儿启封: TalentEntry = {
  kind: '启封加值',
  channel: 'story',
  params: { amount: 1, excl: '命运宠儿' },
};
const 命运宠儿行动: TalentEntry = {
  kind: '行动值加成',
  channel: 'story',
  params: { amount: 1, excl: '命运宠儿' },
};

async function readTalents(): Promise<Record<string, unknown> | undefined> {
  const player = (await getCharacters(SAVE))[0];
  return (player as { talents?: Record<string, unknown> }).talents;
}

beforeEach(async () => {
  await initializeDatabase();
  await clearAllData();
  await saveCharacter(
    createDefaultCharacterState({ id: 'p', saveId: SAVE, name: 'Player', type: 'player' }),
  );
});

describe('update_character talents 写入门禁', () => {
  it('合法天赋入账，entries 回填池内规范对象（伪造渠道被纠正）', async () => {
    const manager = createStateManager(SAVE);
    const forged: TalentEntry = { ...品质突破摩托, channel: 'exchange' }; // AI 想改独占标记
    await manager.commitDomainCommand([
      {
        op: 'update_character',
        target: 'characters.Player',
        value: {
          talents: {
            capacity: 3,
            list: [
              { name: '垃圾摩托', description: '废土传说', source: 'fusion', entries: [forged] },
            ],
          },
        },
      },
    ]);
    const t = await readTalents();
    expect(t?.capacity).toBe(3);
    const list = t?.list as Array<{ name: string; entries: TalentEntry[] }>;
    expect(list[0].entries[0].channel).toBe('fusion'); // 回填池内标记
  });

  it('编数值（bonus 99 不在档位）→ 整组拒绝', async () => {
    const manager = createStateManager(SAVE);
    await expect(
      manager.commitDomainCommand([
        {
          op: 'update_character',
          target: 'characters.Player',
          value: {
            talents: {
              capacity: 3,
              list: [
                {
                  name: '作弊天赋',
                  entries: [{ kind: '成功率加成', channel: 'universal', params: { bonus: 99 } }],
                },
              ],
            },
          },
        },
      ]),
    ).rejects.toThrow('不在骨架条目池内');
  });

  it('同名唯一：重复习得 → 拒绝', async () => {
    const manager = createStateManager(SAVE);
    const 一份 = {
      name: '封印亲和',
      entries: [{ kind: '启封加值', channel: 'universal', params: { amount: 2 } }],
    };
    await expect(
      manager.commitDomainCommand([
        {
          op: 'update_character',
          target: 'characters.Player',
          value: { talents: { capacity: 3, list: [一份, { ...一份 }] } },
        },
      ]),
    ).rejects.toThrow('同名天赋不可重复习得');
  });

  it('容量上限：list 超过 capacity → 拒绝', async () => {
    const manager = createStateManager(SAVE);
    await expect(
      manager.commitDomainCommand([
        {
          op: 'update_character',
          target: 'characters.Player',
          value: {
            talents: {
              capacity: 2,
              list: [
                { name: '甲', entries: [品质突破摩托] },
                { name: '乙', entries: [命运宠儿启封] },
                { name: '丙', entries: [命运宠儿行动] },
              ],
            },
          },
        },
      ]),
    ).rejects.toThrow('天赋容量已满');
  });

  it('互斥组不可共存（两个命运宠儿系天赋 → 拒绝）', async () => {
    const manager = createStateManager(SAVE);
    await expect(
      manager.commitDomainCommand([
        {
          op: 'update_character',
          target: 'characters.Player',
          value: {
            talents: {
              capacity: 3,
              list: [
                { name: '命运宠儿', entries: [命运宠儿启封] },
                { name: '命运宠儿·二番', entries: [命运宠儿行动] },
              ],
            },
          },
        },
      ]),
    ).rejects.toThrow('互斥天赋不可共存');
  });

  it('形状非法（缺 list）→ 拒绝', async () => {
    const manager = createStateManager(SAVE);
    await expect(
      manager.commitDomainCommand([
        {
          op: 'update_character',
          target: 'characters.Player',
          value: { talents: { capacity: 3 } },
        },
      ]),
    ).rejects.toThrow('形状非法');
  });
});
