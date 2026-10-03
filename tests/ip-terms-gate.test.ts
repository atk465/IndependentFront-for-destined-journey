/**
 * ip-terms-gate.test.ts — 全仓源码 IP 专名门禁（2026-09-20 通用前端改造 · 决议 4/9）
 *
 * 目标：**非测试源码里不允许出现任何旧作品的专名**。两档管控：
 *
 * 1. **HARD_ZERO —— 零容忍**。世界 IP 专名（作品名/地名/纪元名等）在非测试源码里
 *    一个都不许有。历史上它们藏在首页页脚、WorldBookEditor placeholder、7 个
 *    `.standalone.html` 设计原型的标题里——全都是「代码里不许有世界 IP 专名」
 *    （D26/D41，见 `src/ui/branding-defaults.ts` 头注释）的违例，2026-09-20 已清零。
 *    真实品牌文案的唯一出口是内容包 `branding` 分节（branding-defaults 的解析链）。
 *
 * 2. **RATCHET —— 棘轮**。`fated-poem-*` / `poem-of-destiny` / `destinyPoints` 是
 *    **运行时兼容层**的合法成员（旧 localStorage 键迁移、旧备份 kind 导入、旧 packId
 *    映射、EJS 旧引擎名别名、预设字段归一化）——它们必须存在，否则老用户数据读不出来。
 *    棘轮只许往下拧：每清掉一处兼容层引用，就把下面的基线数字改小并提交。
 *    数字变大 = 新的残留进了源码，直接红。
 *
 * 豁免口径（与决议 7 一致，**不在本闸门扫描范围**）：
 *   - `*.test.ts` / `*.spec.*`：测试夹具里的旧词是迁移路径的测试数据，且
 *     `branding-defaults.test.ts` 的 IP_TERMS 黑名单本身就要写这些词才能防回归。
 *   - `docs/`、CHANGELOG、授权协议、canon.md：历史记录与二创出处声明，刻意保留旧名。
 *
 * 用 `node:fs` 直接扫盘（先例：layering-gate / no-world-content），与 eslint 的
 * no-restricted-imports 互补——后者只认 import 语句，本闸门扫一切字符串。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..');

/** 扫描根目录（非测试源码的全部可能藏身处） */
const SCAN_ROOTS = ['src', 'server', 'scripts'];

/** 扫描的文件扩展名 */
const SCAN_EXTENSIONS = ['.ts', '.vue', '.mjs', '.js', '.html', '.css'];

const isTestFile = (p: string) => /\.test\.|\.spec\.|__tests__/.test(p);

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else if (SCAN_EXTENSIONS.some((ext) => name.endsWith(ext)) && !isTestFile(full)) yield full;
  }
}

function scanTargets(): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    try {
      files.push(...walk(join(REPO_ROOT, root)));
    } catch {
      // 根目录不存在（如 scripts 被裁撤）→ 跳过
    }
  }
  const indexHtml = join(REPO_ROOT, 'index.html');
  try {
    if (statSync(indexHtml).isFile()) files.push(indexHtml);
  } catch {
    /* index.html 不存在则不扫 */
  }
  return files;
}

// ──────────────────────────────────────────────────────────────────────────────
// 判据
// ──────────────────────────────────────────────────────────────────────────────

/** 零容忍词（不区分大小写）。命中即违规，无豁免。 */
const HARD_ZERO_TERMS = [
  '命定之诗',
  '黄昏之歌',
  '阿斯塔利亚',
  '复兴纪元',
  'fated poem',
  'destined',
];

/**
 * 棘轮词 → 当前允许的基线（2026-09-20 改名后的兼容层存量）。
 * 🔴 每删一处兼容层引用，就把数字减一并提交；只许降，不许涨。
 */
const RATCHET_TERMS: Record<string, number> = {
  'fated-poem': 16,
  'poem-of-destiny': 2,
  destinyPoints: 6,
};

function countOccurrences(haystack: string, needle: string, caseInsensitive: boolean): number {
  const hay = caseInsensitive ? haystack.toLowerCase() : haystack;
  const ndl = caseInsensitive ? needle.toLowerCase() : needle;
  let count = 0;
  let idx = hay.indexOf(ndl);
  while (idx !== -1) {
    count += 1;
    idx = hay.indexOf(ndl, idx + ndl.length);
  }
  return count;
}

// ──────────────────────────────────────────────────────────────────────────────
// 闸门
// ──────────────────────────────────────────────────────────────────────────────

describe('IP 专名门禁（去 fated-poem 化）', () => {
  const files = scanTargets();

  it('扫描范围不为空（目录布局变化时本闸门要跟着改）', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('零容忍词在非测试源码中绝迹', () => {
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const term of HARD_ZERO_TERMS) {
        if (countOccurrences(content, term, true) > 0) violations.push(`${file} → ${term}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('棘轮词不超过基线（清掉一处就往下拧一格）', () => {
    const counts = new Map<string, number>(Object.keys(RATCHET_TERMS).map((t) => [t, 0]));
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const term of Object.keys(RATCHET_TERMS)) {
        counts.set(term, counts.get(term)! + countOccurrences(content, term, false));
      }
    }
    const violations: string[] = [];
    for (const [term, baseline] of Object.entries(RATCHET_TERMS)) {
      const actual = counts.get(term)!;
      if (actual > baseline) violations.push(`${term}: 现有 ${actual} > 基线 ${baseline}`);
    }
    expect(violations).toEqual([]);
  });

  it('棘轮基线与实际存量一致（防止基线被抬高后没人发现可以往下拧）', () => {
    const counts = new Map<string, number>(Object.keys(RATCHET_TERMS).map((t) => [t, 0]));
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const term of Object.keys(RATCHET_TERMS)) {
        counts.set(term, counts.get(term)! + countOccurrences(content, term, false));
      }
    }
    const drift: string[] = [];
    for (const [term, baseline] of Object.entries(RATCHET_TERMS)) {
      if (counts.get(term)! < baseline) {
        drift.push(`${term}: 实际 ${counts.get(term)} < 基线 ${baseline} → 请把基线下调到实际值`);
      }
    }
    expect(drift).toEqual([]);
  });
});
