import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let p = normalize(decodeURIComponent(url.pathname));
  if (p === '/' || p === '') p = '/index.html';
  const full = join(root, p);
  if (!full.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(full);
    const target = info.isDirectory() ? join(full, 'index.html') : full;
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': MIME[extname(target)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}

function mockVercelRes(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res; };
  return res;
}

async function handleApi(req, res, pathname, query) {
  const file = pathToFileURL(join(root, 'api', pathname + '.js')).href;
  try {
    const mod = await import(file);
    const handler = mod.default;
    if (typeof handler !== 'function') throw new Error('no default export');
    req.query = query;
    await handler(req, mockVercelRes(res));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(e.message || e) }));
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/\/$/, '');
    const query = Object.fromEntries(url.searchParams.entries());
    await handleApi(req, res, name, query);
    return;
  }
  await serveStatic(req, res);
}).listen(port, () => {
  console.log(`dev server: http://localhost:${port}`);
});
