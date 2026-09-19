/**
 * portable-server.ts — 便携版独立服务器（一键启动包用）
 *
 * 设计意图（见 server/app.ts 注释）：dev 用 vite middleware，**prod 用独立 server**，
 * 两者共享同一份 BFF 路由代码（buildHonoApp）。本文件就是那个 prod 入口。
 *
 * 职责：
 * 1. 静态服务前端产物（dist-ui/，含 data/ 内容树与地图图片）
 * 2. 挂载 BFF（/api/*）—— AI 调用代理
 * 3. SPA fallback（未知路径回 index.html，交给前端路由）
 * 4. 自动选端口 + 自动开浏览器
 *
 * 打包：scripts/build-portable.mjs 用 esbuild 把它 bundle 成单文件 server.mjs
 * （依赖全部内联，目标机器只需 Node runtime，无需 npm install）。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { exec } from 'node:child_process';
import { getRequestListener } from '@hono/node-server';
import { buildHonoApp, isBffRoute } from '../server/app';

/** 前端产物目录（server.mjs 同级的 dist-ui） */
const ROOT = resolve(import.meta.dirname ?? __dirname, 'dist-ui');
const PORT_START = 5173;
const PORT_MAX = 5200;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/** 路径穿越守卫（与 vite.config.ts 的 SEC-03 同口径） */
function safeJoin(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const rel = normalize(decoded).replace(/^([/\\])+/, '');
  const full = resolve(root, rel);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

function sendFile(res: ServerResponse, filePath: string): boolean {
  try {
    const st = statSync(filePath);
    if (!st.isFile()) return false;
    const mime = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': st.size,
      'Cache-Control': filePath.includes(`${sep}assets${sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

function handleStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url || '/';
  const target = safeJoin(ROOT, url);
  if (target && sendFile(res, target)) return;
  // 目录请求 → 该目录下的 index.html
  if (target && existsSync(target) && statSync(target).isDirectory()) {
    if (sendFile(res, join(target, 'index.html'))) return;
  }
  // SPA fallback
  if (sendFile(res, join(ROOT, 'index.html'))) return;
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 —— 前端产物缺失（dist-ui/index.html 不存在）');
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {
    /* 打不开就算了，手动访问也行 */
  });
}

function listen(server: ReturnType<typeof createServer>, port: number): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('error', onError);
      if (err.code === 'EADDRINUSE' && port < PORT_MAX) {
        // 端口占用 → 顺延（便携包不该因为别人占了 5173 就起不来）
        listen(server, port + 1).then(resolvePromise, reject);
        return;
      }
      reject(err);
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolvePromise(port);
    });
  });
}

async function main(): Promise<void> {
  if (!existsSync(join(ROOT, 'index.html'))) {
    console.error(`[铭刻录] 找不到前端产物：${ROOT}`);
    console.error('        请确认 dist-ui/ 与 server.mjs 在同一目录下。');
    process.exit(1);
  }

  // BFF：contentDir = null（便携包不含内容仓写回能力，只读已构建进 dist-ui/data 的内容）
  const honoListener = getRequestListener(buildHonoApp({ contentDir: null }).fetch);

  const server = createServer((req, res) => {
    if (isBffRoute(req.url || '')) {
      honoListener(req, res);
      return;
    }
    handleStatic(req, res);
  });

  const port = await listen(server, PORT_START);
  const url = `http://127.0.0.1:${port}/`;
  console.log('');
  console.log('  ==============================');
  console.log('     《铭刻录》 已启动');
  console.log('  ==============================');
  console.log('');
  console.log(`  访问地址：${url}`);
  console.log('  关闭这个窗口即退出游戏服务。');
  console.log('');
  if (process.argv.includes('--no-open') === false) openBrowser(url);
}

main().catch((err) => {
  console.error('[铭刻录] 启动失败：', err);
  process.exit(1);
});
