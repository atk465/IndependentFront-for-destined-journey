/**
 * game-store.skirmish.test.ts — 交锋拍状态桥测试
 *
 * 钉四件事：pipeline 经 setter 写账本/busy；三个 UI 入口经 controller 句柄委托；
 * busy 与终局态守卫；**守卫明示不静默**（start 返回 {ok, reason}）+ controller
 * 未就绪时挂起请求、attach 后自动补发（消灭「点了没反应」的时序窗）。
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
  activeEffects: [],
  unsealedCards: [],
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

  it('三入口经 controller 句柄委托；start 透传结果', async () => {
    const game = useGameStore();
    const start = vi.fn(async () => ({ ok: true }));
    const counter = vi.fn(async () => {});
    const flee = vi.fn(async () => {});
    const nuke = vi.fn(async () => {});
    const duel = vi.fn(async () => {});
    const sacrifice = vi.fn(async () => {});
    const trueName = vi.fn(async () => {});
    const hotSwap = vi.fn(async () => {});
    game.setSkirmishController({
      start,
      counter,
      flee,
      nuke,
      duel,
      sacrifice,
      trueName,
      hotSwap,
      castForbidden: vi.fn(async () => {}),
    });
    game.setSkirmishSession(session());

    const r = await game.startSkirmish('熔岩巨兽', '灼热盆地');
    await game.submitSkirmishCounter({ kind: '应对', move: '防御' });
    await game.fleeSkirmish();

    expect(r).toEqual({ ok: true });
    expect(start).toHaveBeenCalledWith('熔岩巨兽', '灼热盆地');
    expect(counter).toHaveBeenCalledWith({ kind: '应对', move: '防御' });
    expect(flee).toHaveBeenCalled();
    expect(game.skirmishBusy).toBe(false); // finally 解除
  });

  it('controller 未就绪：start 明示失败原因并挂起请求，attach 后自动补发', async () => {
    const game = useGameStore();
    const r = await game.startSkirmish('熔岩巨兽');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('尚未就绪');

    const start = vi.fn(async () => ({ ok: true }));
    game.setSkirmishController({
      start,
      counter: vi.fn(),
      flee: vi.fn(),
      duel: vi.fn(),
      sacrifice: vi.fn(),
      trueName: vi.fn(),
      hotSwap: vi.fn(),
      nuke: vi.fn(),
      castForbidden: vi.fn(),
    });
    // 挂起请求在 attach 时自动补发（异步触发，不阻塞 attach）
    await vi.waitFor(() => expect(start).toHaveBeenCalledWith('熔岩巨兽', undefined));
  });

  it('busy 守卫：进行中拒新请求并明示原因', async () => {
    const game = useGameStore();
    let releaseFirstStart: (() => void) | undefined;
    const start = vi.fn(async () => {
      // 第一个 start 挂起不返回，制造 busy 窗口
      await new Promise<void>((resolve) => {
        releaseFirstStart = resolve;
      });
      return { ok: true };
    });
    game.setSkirmishController({
      start,
      counter: vi.fn(),
      flee: vi.fn(),
      duel: vi.fn(),
      sacrifice: vi.fn(),
      trueName: vi.fn(),
      hotSwap: vi.fn(),
      nuke: vi.fn(),
      castForbidden: vi.fn(),
    });

    const first = game.startSkirmish();
    const second = await game.startSkirmish(); // busy 窗口内的重入
    expect(second).toEqual({ ok: false, reason: '上一场交锋还在处理中，稍候片刻' });

    releaseFirstStart?.();
    await expect(first).resolves.toEqual({ ok: true });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('终局态 / 无账本拒反制与撤退', async () => {
    const game = useGameStore();
    const counter = vi.fn(async () => {});
    const flee = vi.fn(async () => {});
    const nuke = vi.fn(async () => {});
    const duel = vi.fn(async () => {});
    const sacrifice = vi.fn(async () => {});
    const trueName = vi.fn(async () => {});
    const hotSwap = vi.fn(async () => {});
    game.setSkirmishController({
      start: vi.fn(),
      counter,
      flee,
      nuke,
      duel,
      sacrifice,
      trueName,
      hotSwap,
      castForbidden: vi.fn(async () => {}),
    });

    await game.submitSkirmishCounter({ kind: '卡', name: '燎原符卡' });
    expect(counter).not.toHaveBeenCalled(); // 无账本

    game.setSkirmishSession(session('胜利'));
    await game.submitSkirmishCounter({ kind: '卡', name: '燎原符卡' });
    expect(counter).not.toHaveBeenCalled(); // 已终局
  });

  it('controller 缺位时反制/撤退入口静默返回，不抛', async () => {
    const game = useGameStore();
    game.setSkirmishSession(session());
    await expect(
      game.submitSkirmishCounter({ kind: '应对', move: '强攻' }),
    ).resolves.toBeUndefined();
    await expect(game.fleeSkirmish()).resolves.toBeUndefined();
  });
});

describe('toPlainCardAlbum —— UI 侧真响应式回归（IDB 结构化克隆）', () => {
  it('Pinia reactive 专辑净化后可被 structuredClone（真机 DataCloneError 钉死）', async () => {
    const { reactive } = await import('vue');
    const { toPlainCardAlbum } = await import('@engine/card-workshop/album');
    const proxyAlbum = reactive({
      owned: ['灼热盆地', '苍穹之翼'],
      deck: ['灼热盆地'],
      capacity: 60,
    });
    // 响应式 Proxy 本体过不了结构化克隆（真机炸点）
    expect(() => structuredClone(proxyAlbum)).toThrow();
    const plain = toPlainCardAlbum(proxyAlbum);
    const cloned = structuredClone(plain); // 净化后必须可克隆
    expect(cloned.owned).toEqual(['灼热盆地', '苍穹之翼']);
    expect(cloned.deck).toEqual(['灼热盆地']);
  });
});
