/**
 * option-policy.test.ts — 行动选项方案：解析回落 / 渲染底线 / off 兜底
 */
import { describe, it, expect } from 'vitest';
import {
  BUILTIN_OPTION_SCHEMES,
  OPTION_SCHEME_OFF_ID,
  OPTION_SCHEME_STANDARD_ID,
  resolveOptionScheme,
  renderOptionPolicy,
  filterOptionsForScheme,
} from './option-policy';

describe('resolveOptionScheme', () => {
  it('未记录（旧存档 undefined）→ 标准三选（升级兼容，行为与改造前一致）', () => {
    expect(resolveOptionScheme(undefined, []).id).toBe(OPTION_SCHEME_STANDARD_ID);
    expect(resolveOptionScheme(undefined, undefined).id).toBe(OPTION_SCHEME_STANDARD_ID);
  });

  it('未知 id → 标准三选（删掉的方案不炸）', () => {
    expect(resolveOptionScheme('ghost-scheme', []).id).toBe(OPTION_SCHEME_STANDARD_ID);
  });

  it('内置 id 命中；自定义库命中优先于内置', () => {
    expect(resolveOptionScheme('off', []).id).toBe(OPTION_SCHEME_OFF_ID);
    expect(resolveOptionScheme('emotive', []).name).toBe('情绪流');
    const custom = { id: 'standard', name: '我的标准', instruction: '自定义覆盖', builtin: false };
    expect(resolveOptionScheme('standard', [custom])).toBe(custom);
  });
});

describe('renderOptionPolicy', () => {
  it('off 档渲染明确禁止指令（压过静态格式示例）', () => {
    const out = renderOptionPolicy(resolveOptionScheme('off', []), '黎晚');
    expect(out).toContain('不要');
    expect(out).toContain('<option>');
  });

  it('方案档恒拼格式底线，方案文本只管风格', () => {
    const out = renderOptionPolicy(resolveOptionScheme('standard', []), '黎晚');
    expect(out).toContain('只写一个块');
    expect(out).toContain('每行一个选项');
    expect(out).toContain('一项推进当前目标');
  });

  it('{{user}} 替换为玩家名（大小写不敏感）；玩家名为空回落「你」', () => {
    const scheme = { id: 'x', name: 'x', instruction: '{{user}} 的行动 / {{USER}} 的选择', builtin: false };
    expect(renderOptionPolicy(scheme, '黎晚')).toContain('黎晚 的行动 / 黎晚 的选择');
    expect(renderOptionPolicy(scheme, '')).toContain('你 的行动');
  });
});

describe('filterOptionsForScheme', () => {
  const options = ['亮出委托书', '绕开桥头', '问对方要什么'];
  it('off 档整批丢弃（模型惯性输出的兜底）', () => {
    expect(filterOptionsForScheme(options, resolveOptionScheme('off', []))).toEqual([]);
  });
  it('非 off 档原样返回（零开销）', () => {
    const scheme = resolveOptionScheme('standard', []);
    expect(filterOptionsForScheme(options, scheme)).toBe(options);
  });
});

describe('BUILTIN_OPTION_SCHEMES', () => {
  it('四个内置：不生成/标准三选/情绪流/成人向，全部 builtin 标记', () => {
    expect(BUILTIN_OPTION_SCHEMES.map((s) => s.id)).toEqual(['off', 'standard', 'emotive', 'adult']);
    expect(BUILTIN_OPTION_SCHEMES.every((s) => s.builtin)).toBe(true);
  });
  it('情绪流与成人向带 emoji 与 font color 要求；标准三选纯文本', () => {
    const emotive = BUILTIN_OPTION_SCHEMES.find((s) => s.id === 'emotive')!;
    const adult = BUILTIN_OPTION_SCHEMES.find((s) => s.id === 'adult')!;
    const standard = BUILTIN_OPTION_SCHEMES.find((s) => s.id === OPTION_SCHEME_STANDARD_ID)!;
    expect(emotive.instruction).toContain('emoji');
    expect(emotive.instruction).toContain('<font color="">');
    expect(adult.instruction).toContain('情趣玩法');
    expect(standard.instruction).not.toContain('emoji');
  });
});
