/**
 * build-portable.mjs — 打包「一键启动包」（Windows 优先，跨平台通用）
 *
 * 产物结构（输出到 ../hermagent-dist/铭刻录-便携版/）：
 *   《铭刻录》启动.bat        ← 双击这个
 *   启动游戏.sh               ← macOS / Linux
 *   server.mjs                ← 独立服务器（esbuild bundle，依赖内联）
 *   dist-ui/                  ← 前端产物 + 内容数据 + 地图图片
 *   使用说明.txt
 *
 * 目标机器只需装 Node.js 20+，无需 npm install（依赖已内联进 server.mjs）。
 *
 * 用法：node scripts/build-portable.mjs [--out <目录>]
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CONTENT_REPO = resolve(ROOT, '..', 'fated_poem_independent_assets');

function argOf(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const OUT = resolve(argOf('--out', join(ROOT, '..', 'hermagent-dist', '铭刻录-便携版')));

function run(cmd, args, opts = {}) {
  console.log(`[pack] $ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, {
    stdio: 'inherit',
    cwd: ROOT,
    shell: process.platform === 'win32',
    ...opts,
  });
}

function sizeOf(p) {
  let total = 0;
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const fp = join(p, e.name);
    if (e.isDirectory()) total += sizeOf(fp);
    else total += statSync(fp).size;
  }
  return total;
}

console.log('=== 1/6 清理输出目录 ===');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log('=== 2/6 构建前端（vite build）===');
run('npm', ['run', 'build']);

console.log('=== 3/6 复制前端产物 ===');
cpSync(join(ROOT, 'dist-ui'), join(OUT, 'dist-ui'), { recursive: true });

console.log('=== 4/6 用内容仓内容覆盖占位数据 ===');
// 🔴 `vite build` 把 `public/data`（占位内容）复制进 dist-ui —— 必须用真实内容仓
//    整体覆盖，否则打出来的包只有 8 张卡、4 个起始地（dev 靠 POEM_CONTENT_DIR
//    overlay 规避，生产构建没有这层，只能显式同步）。
//    目录形状差异：内容仓 `worldbooks/` 对 dist 的 `data/worldbooks/`。
const CONTENT_MAP = [
  [join(CONTENT_REPO, 'worldbooks'), join(OUT, 'dist-ui', 'data', 'worldbooks')],
  [join(CONTENT_REPO, 'data', 'content'), join(OUT, 'dist-ui', 'data', 'content')],
  [join(CONTENT_REPO, 'data', 'defaults'), join(OUT, 'dist-ui', 'data', 'defaults')],
];
if (!existsSync(CONTENT_REPO)) {
  console.error(`[pack] ✗ 找不到内容仓：${CONTENT_REPO}`);
  console.error('       便携包必须带真实内容（世界书/卡池/事件），不能打占位版。');
  process.exit(1);
}
for (const [src, dst] of CONTENT_MAP) {
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
  const n = readdirSync(dst).length;
  console.log(`  ✓ ${src.replace(CONTENT_REPO, '内容仓')} → ${dst.replace(OUT, '包')} (${n} 项)`);
}

console.log('=== 5/6 复制内容仓图片资源（内容包不含图，必须随包带）===');
const imgDir = join(OUT, 'dist-ui', 'data', 'content');
mkdirSync(imgDir, { recursive: true });
const IMAGES = [
  ['data/content/provinces.png', 'provinces.png'],
  ['data/content/base-map.png', 'base-map.png'],
  ['data/content/base-map-procedural.png', 'base-map-procedural.png'],
];
let copied = 0;
for (const [srcRel, dstName] of IMAGES) {
  const src = join(CONTENT_REPO, srcRel);
  if (existsSync(src)) {
    cpSync(src, join(imgDir, dstName));
    copied += 1;
    console.log(`  ✓ ${dstName}`);
  } else {
    console.log(`  - 跳过（不存在）：${srcRel}`);
  }
}

console.log('=== 5/6 打包独立服务器（esbuild bundle）===');
const { build } = await import('esbuild');
await build({
  entryPoints: [join(ROOT, 'scripts', 'portable-server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: join(OUT, 'server.mjs'),
  banner: { js: '// Mingke portable server (auto-generated; source: scripts/portable-server.ts)' },
  logLevel: 'info',
});

console.log('=== 6/6 写入启动脚本与说明 ===');
// bat 保持纯 ASCII：项目 dev.bat 的血泪教训是 `chcp 65001` 会让 cmd 的字节偏移
// 批解析器与多字节文本错位，注释/命令里的中文会被当成命令执行。中文指引一律放在
// 「使用说明.txt」与 Node 程序输出里 —— 那里不受 cmd 解析器约束。
writeFileSync(
  join(OUT, '《铭刻录》启动.bat'),
  [
    '@echo off',
    'cd /d "%~dp0"',
    '',
    'where node >nul 2>&1',
    'if errorlevel 1 goto NONODE',
    '',
    'node server.mjs',
    'if errorlevel 1 goto FAILED',
    'exit /b 0',
    '',
    ':NONODE',
    'echo.',
    'echo   Node.js not found. Please install Node.js 20 LTS first:',
    'echo       https://nodejs.org/',
    'echo.',
    'echo   Then double-click this file again.',
    'echo   (Chinese guide: open the .txt file in this folder)',
    'echo.',
    'start "" "%~dp0"',
    'pause',
    'exit /b 1',
    '',
    ':FAILED',
    'echo.',
    'echo   The game server exited unexpectedly.',
    'echo   See the messages above, or read the .txt guide in this folder.',
    'echo.',
    'pause',
    'exit /b 1',
    '',
  ].join('\r\n'),
  'ascii',
);

writeFileSync(
  join(OUT, '启动游戏.sh'),
  [
    '#!/usr/bin/env bash',
    'cd "$(dirname "$0")" || exit 1',
    'if ! command -v node >/dev/null 2>&1; then',
    '  echo "[需要 Node.js] 请先安装 LTS 版本：https://nodejs.org/"',
    '  exit 1',
    'fi',
    'exec node server.mjs',
    '',
  ].join('\n'),
  'utf8',
);

writeFileSync(
  join(OUT, '使用说明.txt'),
  [
    '《铭刻录》便携版 —— 使用说明',
    '============================',
    '',
    '【怎么启动】',
    '  Windows：双击「《铭刻录》启动.bat」',
    '  macOS / Linux：终端里执行 ./启动游戏.sh',
    '',
    '  启动后浏览器会自动打开 http://127.0.0.1:5173/',
    '  关闭那个黑色命令行窗口即退出。',
    '',
    '【前置要求】',
    '  需要 Node.js 20 或更高版本（https://nodejs.org/ 下载 LTS 版，一路下一步）。',
    '  除此之外不需要安装任何东西 —— 程序依赖已全部打包在内。',
    '',
    '【首次游玩要做什么】',
    '  1. 进游戏后到「设置 → API 设置」，填入你自己的 AI 服务地址与密钥',
    '     （本作不自带模型，需要你自己的 OpenAI 兼容端点）。',
    '  2. 到「设置 → Agent 配置」，为各 Agent 选择 API 池。',
    '  3. 回首页「新建存档」开始捏人。',
    '',
    '【内容说明】',
    '  本包已内置《铭刻录》世界书、卡池、地图与事件内容（构建时从内容仓同步）。',
    '  地图图片（provinces.png / base-map.png）已随包附带。',
    '',
    '【存档在哪】',
    '  浏览器本地 IndexedDB（跟着浏览器走）。换电脑游玩请用游戏内的存档导出/导入。',
    '',
    '【出问题怎么办】',
    '  - 端口被占用：程序会自动改用 5174、5175…（看命令行窗口里打印的地址）。',
    '  - 提示找不到 node：装 Node.js LTS 后重新双击。',
    '  - 页面空白：确认 dist-ui 文件夹与 server.mjs 在同一目录。',
    '',
  ].join('\r\n'),
  'utf8',
);

const mb = (sizeOf(OUT) / 1024 / 1024).toFixed(1);
console.log('');
console.log(`[pack] 完成 —— ${OUT}`);
console.log(`[pack] 体积约 ${mb} MB（含地图图片；目标机器只需 Node.js 20+）`);
console.log(`[pack] 图片复制了 ${copied}/${IMAGES.length} 个`);
