import { describe, expect, it } from 'vitest';
import { projectStoryOutput, projectStreamingStory } from './story-output';

describe('projectStoryOutput', () => {
  it('extracts main text and numbered options through one interface', () => {
    const result = projectStoryOutput(
      `<maintext>第一段。\n\n第二段。</maintext>\n<options>\n1. 前进\n2、等待\n</options>`,
    );

    expect(result).toEqual({
      content: '第一段。\n\n第二段。',
      options: ['前进', '等待'],
      truncated: false,
    });
  });

  it('supports the legacy singular option envelope', () => {
    const result = projectStoryOutput('<maintext>正文。</maintext><option>观察\n离开</option>');
    expect(result).toEqual({ content: '正文。', options: ['观察', '离开'], truncated: false });
  });

  it('does not duplicate options when the closing tag contains whitespace', () => {
    const result = projectStoryOutput(
      '<maintext>正文。</maintext><options>1. 观察\n2. 离开</options   >',
    );
    expect(result.options).toEqual(['观察', '离开']);
  });

  it('ignores explanatory lines inside the numbered options envelope', () => {
    const result = projectStoryOutput(
      '<maintext>正文。</maintext><options>以下是可选行动：\n1. 观察\n2、离开</options>',
    );
    expect(result.options).toEqual(['观察', '离开']);
  });

  it('handles an unclosed options envelope without leaking it into prose', () => {
    const result = projectStoryOutput('<maintext>正文。\n<options>\n1. 观察\n2. 离开');
    // 有 <maintext> 开标签、无闭合 → 同时标记 truncated（2026-09-18 防护）
    expect(result).toEqual({
      content: '正文。',
      options: ['观察', '离开'],
      truncated: true,
    });
  });

  it('keeps narrative formatting tags but removes non-rendering audio markers', () => {
    const result = projectStoryOutput(
      '<maintext><dalian name="妲丽安">你好</dalian><play_audio mood="安静"/></maintext>',
    );
    expect(result.content).toBe('<dalian name="妲丽安">你好</dalian>');
  });

  // 随机事件 v1：`<event_trigger>` 与 `<play_audio>` 同类 —— 零渲染意义的回执标记。
  // 结算侧读的是未投影的原始输出，所以这里剥干净不会让事件漏结算。
  it('removes non-rendering random-event trigger markers', () => {
    const result = projectStoryOutput(
      '<maintext>商人拦住去路。<event_trigger name="神秘商人"/></maintext>',
    );
    expect(result.content).toBe('商人拦住去路。');
  });

  it('removes structured sections from bare legacy output', () => {
    const result = projectStoryOutput(
      '正文。\n<thinking>不展示</thinking>\n<sum>摘要</sum>\n<vars>{"x":1}</vars>',
    );
    expect(result.content).toBe('正文。');
  });
});

describe('projectStreamingStory', () => {
  it('suppresses wrapper and option tags from partial output', () => {
    expect(projectStreamingStory('<main')).toBe('');
    expect(projectStreamingStory('<maintext>正在生成')).toBe('正在生成');
    expect(projectStreamingStory('<maintext>正文。</main')).toBe('正文。');
    expect(projectStreamingStory('<maintext>正文。</maintext>\n<options>\n1. 选')).toBe('正文。');
  });

  it('replaces leaked preamble once the maintext envelope arrives', () => {
    expect(projectStreamingStory('先分析格式……')).toBe('');
    expect(projectStreamingStory('先分析格式……\n<maintext>玩家可见正文')).toBe('玩家可见正文');
  });

  it('does not treat an inline format mention as the streaming envelope', () => {
    expect(projectStreamingStory('要用 <maintext> 包裹正文哦……')).toBe('');
  });

  it('keeps completed and streamed prose in parity', () => {
    const raw = '<maintext>夜色渐深。\n\n门被推开。</maintext><options>\n1. 查看\n</options>';
    expect(projectStreamingStory(raw)).toBe(projectStoryOutput(raw).content);
  });
});

describe('截断检测（2026-09-18 真机防护）', () => {
  it('正常闭合 → truncated=false', () => {
    const r = projectStoryOutput(
      '<maintext>正文。</maintext><option>走\n留</option><sum>一句话</sum>',
    );
    expect(r.truncated).toBe(false);
  });

  it('有 maintext 开标签但缺闭合 → truncated=true（真机案例：输出停在「然后——没有」）', () => {
    const r = projectStoryOutput('<maintext>他把卡拿起来，贴在自己胸口，然后——没有');
    expect(r.truncated).toBe(true);
    // 内容仍照常返回（半截正文可见），但调用方已拿到标志可提示
    expect(r.content).toContain('然后——没有');
  });

  it('裸文本（无 maintext 信封）不算截断 —— 本来就没有闭合契约', () => {
    const r = projectStoryOutput('就是一段没有标签的正文。');
    expect(r.truncated).toBe(false);
  });
});
