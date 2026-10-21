#!/usr/bin/env node
/**
 * Zero-dependency static server for local development.
 *   node scripts/serve.mjs        → http://localhost:4173
 *   PORT=8080 node scripts/serve.mjs
 *
 * It exists so contributors do not need npm install just to open the studio.
 * Any static host (GitHub Pages, Netlify, Cloudflare Pages) can serve the repo
 * root as-is.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.zip': 'application/zip',
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const cleaned = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const joined = resolve(join(ROOT, cleaned));
  // Refuse anything that escapes the project root.
  if (joined !== ROOT && !joined.startsWith(ROOT + sep)) return null;
  return joined;
}

const server = createServer(async (req, res) => {
  try {
    let target = safePath(req.url || '/');
    if (!target) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    let info = await stat(target).catch(() => null);
    if (info?.isDirectory()) {
      target = join(target, 'index.html');
      info = await stat(target).catch(() => null);
    }

    if (!info?.isFile()) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>404</title>
        <body style="font:16px/1.6 system-ui;padding:48px;background:#05060a;color:#f4f7f6">
        <h1 style="font-size:20px">404 — 这里没有文件</h1>
        <p style="color:#a8b2c1"><a style="color:#5ceebd" href="/">回到 PicMint 首页</a></p>`);
      return;
    }

    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`500 ${error.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  PicMint  →  http://${HOST}:${PORT}\n  root: ${ROOT}\n`);
});
