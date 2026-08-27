// POST /api/unlock — checks the family passcode and sets the access cookie.
// Env: FAMILY_PASSCODE (what the family types), FAMILY_TOKEN (random secret stored in the cookie).
const SAFE_NEXT = /^\/(trips|tickets)(\/[A-Za-z0-9\-\/]*)?$/;

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const raw = typeof req.body === 'string' ? req.body : await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
  return Object.fromEntries(new URLSearchParams(raw));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end('Method Not Allowed');
  }
  const body = await readBody(req);
  const next = SAFE_NEXT.test(body.next || '') ? body.next : '/trips/';
  const passcode = process.env.FAMILY_PASSCODE;
  const token = process.env.FAMILY_TOKEN;

  if (passcode && token && (body.code || '').trim() === passcode) {
    const secure = process.env.VERCEL ? '; Secure' : '';
    res.setHeader('Set-Cookie', `ostroff_family=${token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`);
    res.statusCode = 302;
    res.setHeader('Location', next);
    return res.end();
  }
  res.statusCode = 302;
  res.setHeader('Location', `/unlock/?err=1&next=${encodeURIComponent(next)}`);
  return res.end();
}
