/**
 * game-store.skirmish.test.ts — 交锋拍状态桥测试
 *
 * 钉三件事：pipeline 经 setter 写账本/busy；三个 UI 入口经 controller 句柄委托；
 * busy 与终局态守卫（防双击、防交锋结束后继续反制）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useGameStore } from './game-store';
import type { SkirmishSession } from '@engine/card-workshop/skirmish-session';

const session = (finished: null | '胜利' = null): SkirmishSession => ({
  enemyName: '岩爪兽',
  enemyLevel: 12,
  intents: [],
  beat: 1,
  playerHp: 155,
  playerMaxHp: 155,
  enemyHp: 320,
  enemyMaxHp: 320,
  guard: 10,
  log: [],
  playedCards: [],
  counteredBeats: 1,
  finished,
});

describe('交锋拍状态桥', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('setter 写账本与 busy（pipeline 唯一写入口）', () => {
    const game = useGameStore();
    expect(game.skirmishSession).toBeNull();
    expect(game.skirmishBusy).toBe(false);
    game.setSkirmishSession(session());
    game.setSkirmishBusy(true);
    expect(game.skirmishSession?.enemyName).toBe('岩爪兽');
    expect(game.skirmishBusy).toBe(true);
    game.setSkirmishSession(null);
    expect(game.skirmishSession).toBeNull();
  });

  it('三入口经 controller 句柄委托', async () => {
    const game = useGameStore();
    const start = vi.fn(async () => {});
    const counter = vi.fn(async () => {});
    const flee = vi.fn(async () => {});
    game.setSkirmishController({ start, counter, flee });
    game.setSkirmishSession(session());

    await game.startSkirmish('熔岩巨兽', '灼热盆地');
    await game.submitSkirmishCounter({ kind: '应对', move: '防御' });
    await game.fleeSkirmish();

    expect(start).toHaveBeenCalledWith('熔岩巨兽', '灼热盆地');
    expect(counter).toHaveBeenCalledWith({ kind: '应对', move: '防御' });
    expect(flee).toHaveBeenCalled();
    expect(game.skirmishBusy).toBe(false); // finally 解除
  });

  it('busy 守卫：进行中拒新请求；无句柄静默', async () => {
    const game = useGameStore();
    const counter = vi.fn(async () => {
      // 模拟重入：委托执行期间再次点反制 → 守卫拦截
      await game.submitSkirmishCounter({ kind: '应对', move: '闪避' });
    });
    game.setSkirmishController({ start: vi.fn(), counter, flee: vi.fn() });
    game.setSkirmishSession(session());

    await game.submitSkirmishCounter({ kind: '应对', move: '防御' });
    expect(counter).toHaveBeenCalledTimes(1); // 重入那次被 busy 拦下
  });

  it('终局态 / 无账本拒反制与撤退', async () => {
    const game = useGameStore();
    const counter = vi.fn(async () => {});
    const flee = vi.fn(async () => {});
    game.setSkirmishController({ start: vi.fn(), counter, flee });

    await game.submitSkirmishCounter({ kind: '卡', name: '燎原符卡' });
    expect(counter).not.toHaveBeenCalled(); // 无账本

    game.setSkirmishSession(session('胜利'));
    await game.submitSkirmishCounter({ kind: '卡', name: '燎原符卡' });
    expect(counter).not.toHaveBeenCalled(); // 已终局
  });

  it('controller 缺位时入口静默返回，不抛', async () => {
    const game = useGameStore();
    game.setSkirmishSession(session());
    await expect(game.startSkirmish()).resolves.toBeUndefined();
    await expect(
      game.submitSkirmishCounter({ kind: '应对', move: '强攻' }),
    ).resolves.toBeUndefined();
    await expect(game.fleeSkirmish()).resolves.toBeUndefined();
  });
});
