/**
 * Story output projection.
 *
 * The model-facing response is a structured envelope. This module is the one
 * seam that turns that envelope into player-visible prose and action options,
 * both while streaming and after completion.
 */

import { scanEventTriggers } from './marker-protocol';

export interface StoryProjection {
  content: string;
  options: string[];
  /**
   * 输出是否**未正常闭合**（2026-09-18 真机防护）。
   *
   * 判据：有 `<maintext>` 开标签但缺 `</maintext>` 闭合标签 —— 说明模型输出在正文
   * 中途断了（模型/预设不兼容、服务端截断、流式中断等）。
   *
   * 🔴 为什么要这个标志：`extractMainText` 在缺闭合时**静默返回「开标签到末尾」的全部
   *    内容** —— 于是被截断的半截正文会被当成完整正文展示，玩家看到一句莫名其妙断掉
   *    的话，排查时无从判断是模型问题还是显示问题。真机案例：story 预设混入了
   *    DeepSeek 的 `<｜User｜>`/`<｜begin▁of▁thinking｜>` 标记而模型是 MiniMax，
   *    输出停在「然后——没有」。
   *
   * 裸文本兼容路径（无 maintext 信封）不算截断 —— 那种情况本来就没有闭合契约。
   */
  truncated: boolean;
}

const LEADING_FENCE = /^\s*```[^\n]*\n?/;
const TRAILING_FENCE = /\n?\s*```\s*$/;
const MAIN_TEXT_OPEN = /<maintext\b[^>]*>/gi;
const MAIN_TEXT_CLOSE = /<\/maintext\s*>/i;
const STREAM_MAIN_TEXT_OPEN = /(?:^|\r?\n)[ \t]*<maintext\b[^>]*>/gi;
const CONTROL_TAGS = ['options', 'option', 'sum', 'vars', 'thinking', 'think', 'summary'];
const STREAM_CONTROL_TAGS = ['maintext', 'play_audio', 'event_trigger', ...CONTROL_TAGS];

/**
 * 剥掉 `<event_trigger>` 触发回执（随机事件 v1 / 设计 §5.2）。
 *
 * 这是**零渲染意义的回执标记**，漏出去就是玩家眼前的一行尖括号。
 * 结算侧（orchestrator Stage 1 → `confirmRandomEventTrigger`）读的是**未投影的原始输出**，
 * 所以这里剥干净不会让事件漏结算 —— 两条路各看各的文本。
 *
 * 🔴 扫描一律走 `scanEventTriggers`，不在这里另写一条正则：提示词教 AI 写的是自闭合形态，
 *    而那三种写法（自闭合 / 成对 / 漏写闭合）的容忍度全在 marker-protocol 那一处定义。
 *    抄一条只认成对写法的正则，症状是「结算了、但标记还留在正文里」。
 */
/** 音频/图像系统下线后残留的 <play_audio>/<scene_image> 标记照旧剥干净（旧存档的消息里可能有） */
const LEGACY_MARKER_TAGS = ['play_audio', 'scene_image'] as const;
const LEGACY_MARKER_RE = new RegExp(
  LEGACY_MARKER_TAGS.map(
    (tag) => `<${tag}[^>]*\/>|<${tag}[^>]*>[\s\S]*?<\/${tag}\s*>|<${tag}[^>]*>`,
  ).join('|'),
  'gi',
);

function stripEventTriggerMarkers(text: string): string {
  const markers = scanEventTriggers(text);
  let out = text;
  // 倒序删除：先删后面的，前面那些的 position 才不会失效
  for (let i = markers.length - 1; i >= 0; i -= 1) {
    const m = markers[i];
    out = out.slice(0, m.position) + out.slice(m.position + m.rawContent.length);
  }
  return out;
}

function stripCodeFences(text: string): string {
  return text.replace(LEADING_FENCE, '').replace(TRAILING_FENCE, '');
}

function lastMatch(text: string, pattern: RegExp): RegExpExecArray | null {
  pattern.lastIndex = 0;
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) last = match;
  return last;
}

function extractMainText(raw: string): string {
  const open = lastMatch(raw, MAIN_TEXT_OPEN);
  if (!open) return raw;

  const afterOpen = raw.slice(open.index + open[0].length);
  const close = MAIN_TEXT_CLOSE.exec(afterOpen);
  return close ? afterOpen.slice(0, close.index) : afterOpen;
}

function parseOptionLines(body: string, requireNumber: boolean): string[] {
  const options: string[] = [];
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const numbered = line.match(/^\d+\s*(?:[.、．)）:：-]\s*|\s+)(.+)$/);
    if (numbered) {
      const value = numbered[1].trim();
      if (value) options.push(value);
    } else if (!requireNumber) {
      options.push(line);
    }
  }
  return options;
}

function extractOptions(raw: string): string[] {
  const options: string[] = [];
  const block = /<(options|option)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = block.exec(raw)) !== null) {
    options.push(...parseOptionLines(match[2], match[1].toLowerCase() === 'options'));
  }

  const lastOpen = lastMatch(raw, /<(options|option)\b[^>]*>/gi);
  if (lastOpen) {
    const tag = lastOpen[1].toLowerCase();
    const tail = raw.slice(lastOpen.index + lastOpen[0].length);
    if (!new RegExp(`<\\/${tag}\\s*>`, 'i').test(tail)) {
      options.push(...parseOptionLines(tail.split(/<\/?[a-z]/i)[0], tag === 'options'));
    }
  }
  return options;
}

function stripControlSection(text: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const complete = new RegExp(`<${escaped}\\b[^>]*>[\\s\\S]*?<\\/${escaped}\\s*>`, 'gi');
  let result = text.replace(complete, '');

  const open = new RegExp(`<${escaped}\\b[^>]*>`, 'gi');
  const close = new RegExp(`<\\/${escaped}\\s*>`, 'gi');
  const lastOpen = lastMatch(result, open);
  const lastClose = lastMatch(result, close);
  if (lastOpen && (!lastClose || lastOpen.index > lastClose.index)) {
    result = result.slice(0, lastOpen.index);
  }

  return result.replace(new RegExp(`<\\/?${escaped}\\b[^>]*>`, 'gi'), '');
}

function stripTrailingPartialControlTag(text: string): string {
  const start = text.lastIndexOf('<');
  if (start < 0 || text.indexOf('>', start) >= 0) return text;

  const fragment = text.slice(start).toLowerCase();
  const isControlFragment = STREAM_CONTROL_TAGS.some((tag) => {
    const open = `<${tag}`;
    const close = `</${tag}`;
    return open.startsWith(fragment) || close.startsWith(fragment) || fragment.startsWith(open);
  });
  return isControlFragment || fragment === '<' || fragment === '</' ? text.slice(0, start) : text;
}

/**
 * 输出是否未闭合（2026-09-18 真机防护）。
 *
 * 判据分两层，**不能只看 `</maintext>`**：
 * 1. 有 `<maintext>` 开标签且缺闭合 → 疑似截断；
 * 2. 但**写出了 `<option>`/`<sum>` 区块的，一律算完整** —— 那些是契约里排在正文
 *    之后的必填块，能写到它们说明模型走完了整个输出契约。
 *
 * 🔴 第 2 层是 2026-09-18 真机补的：用户导入的第三方预设教模型用 `</正文>` 收尾
 *    （而不是 `</maintext>`），于是内容完整（正文 + option + sum，6150 tokens）
 *    却被判成截断 —— 假警报比没有警报更糟，它会让玩家以为模型坏了。
 *
 * 裸文本兼容路径（无 maintext 信封）不算截断 —— 那种情况本来就没有闭合契约。
 */
function detectTruncated(raw: string): boolean {
  const text = stripCodeFences(raw);
  const open = lastMatch(text, MAIN_TEXT_OPEN);
  if (!open) return false;
  if (MAIN_TEXT_CLOSE.test(text)) return false;
  // 写出了正文之后的**完整**必填块 → 完整（无论正文用什么标记收尾）。
  // 🔴 必须要求成对闭合：只有开标签的 `<options>` 自身也可能是被截断的残片
  //    （既有用例 'unclosed options envelope' 钉住这条边界）。
  if (/<option(s)?\b[^>]*>[\s\S]*?<\/\1\s*>/i.test(text)) return false;
  if (/<sum\b[^>]*>[\s\S]*?<\/sum\s*>/i.test(text)) return false;
  return true;
}

/**
 * 剥掉第三方预设惯用的「正文」收尾标记（2026-09-18 真机）。
 *
 * 我们的输出契约用 `<maintext>`/`</maintext>`，但外部预设可能教模型输出 `</正文>`
 * ——它是模型给自己画的句号，不该漏进玩家看到的正文。非契约标签，故只在清洗链里
 * 顺带剥除，不进 CONTROL_TAGS（那张表是「控制区块」，语义不同）。
 */
const ALTERNATE_PROSE_CLOSE = /<\/?正文\s*>/g;

function project(raw: string, partial: boolean): StoryProjection {
  const truncated = !partial && detectTruncated(raw);
  const options = extractOptions(raw);
  let content = extractMainText(stripCodeFences(raw));

  for (const tag of CONTROL_TAGS) content = stripControlSection(content, tag);

  if (partial) content = stripTrailingPartialControlTag(content);

  content = stripEventTriggerMarkers(content)
    .replace(LEGACY_MARKER_RE, '')
    .replace(ALTERNATE_PROSE_CLOSE, '')
    .replace(/<\/?maintext\b[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { content, options, truncated };
}

/** Normalize a completed story response for persistence and rendering. */
export function projectStoryOutput(raw: string): StoryProjection {
  return project(raw, false);
}

/** Normalize the accumulated raw response while it is still streaming. */
export function projectStreamingStory(raw: string): string {
  // The story prompt requires a <maintext> envelope. Buffer everything before its
  // opener so content-channel reasoning cannot flash in the player-facing preview.
  // Completed output still keeps the bare-text compatibility fallback above.
  if (!lastMatch(stripCodeFences(raw), STREAM_MAIN_TEXT_OPEN)) return '';
  return project(raw, true).content;
}
