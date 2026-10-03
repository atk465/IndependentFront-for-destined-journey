import { describe, it, expect } from 'vitest';
import { buildEvolutionArcMessages, parseEvolutionArc } from './companion-evolve-narrate';

describe('parseEvolutionArc（B5.2b 弧光句解析）', () => {
  it('正常：<arc> 内文 trim 返回', () => {
    expect(parseEvolutionArc('<arc>瓷裂处生出新铭，她低头认了认新的自己。</arc>')).toBe(
      '瓷裂处生出新铭，她低头认了认新的自己。',
    );
    expect(parseEvolutionArc('前言\n<arc>  铭火重铸其身。 </arc>\n后记')).toBe('铭火重铸其身。');
  });
  it('无标签/空 → null', () => {
    expect(parseEvolutionArc('没有标签的一句话')).toBeNull();
    expect(parseEvolutionArc('<arc></arc>')).toBeNull();
    expect(parseEvolutionArc('')).toBeNull();
  });
  it('超长 → 截断到 30 字', () => {
    const long = '一'.repeat(50);
    const got = parseEvolutionArc(`<arc>${long}</arc>`);
    expect(got).toHaveLength(30);
  });
});

describe('buildEvolutionArcMessages（B5.2b 文风红线入 prompt）', () => {
  it('两条消息（system+user）；system 带四条红线；user 带性格/倾向/品阶跃迁', () => {
    const msgs = buildEvolutionArcMessages({
      name: '愤怨瓷心·艾拉',
      personality: '冷酷寡言，对主人极度顺从',
      archetype: '炽野',
      routeName: '熔岩炼狱',
      routeDesc: '群体爆裂',
      fromTier: '黑铁',
      toTier: '青铜',
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
    const sys = msgs[0].content;
    expect(sys).toContain('30 字');
    expect(sys).toContain('强大');
    expect(sys).toContain('<arc>');
    const user = msgs[1].content;
    expect(user).toContain('愤怨瓷心·艾拉');
    expect(user).toContain('冷酷寡言');
    expect(user).toContain('黑铁 → 青铜');
  });
  it('缺省字段落「（未记）/（未定）」占位，不抛', () => {
    const msgs = buildEvolutionArcMessages({ name: '无名', fromTier: '黑铁', toTier: '青铜' });
    expect(msgs[1].content).toContain('（未记）');
    expect(msgs[1].content).toContain('（未定）');
  });
});
