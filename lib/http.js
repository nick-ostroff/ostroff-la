export async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = typeof req.body === 'string'
    ? req.body
    : await new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => resolve(data));
    });
  const text = String(raw || '');
  const type = String(req.headers?.['content-type'] || '');
  if (type.includes('application/json')) {
    try { return JSON.parse(text || '{}'); } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

export function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

export function redirect(res, location, cookies) {
  if (cookies) res.setHeader('Set-Cookie', cookies);
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

export function wantsJson(req) {
  const accept = String(req.headers?.accept || '');
  const type = String(req.headers?.['content-type'] || '');
  return type.includes('application/json') || accept.includes('application/json');
}
