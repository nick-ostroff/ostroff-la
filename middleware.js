// Vercel Routing Middleware
// - ostroff.la /trips and /tickets: family passcode cookie (FAMILY_TOKEN)
// - grok.ostroff.la: HTTP basic auth (user nick, password MORNING_BASIC_PASSWORD)
//   Pages: / and /mail. Password is env-only. Never commit it. Fail closed if unset.
// - ostroff.la /morning is not public (404).

export const config = {
  matcher: [
    '/',
    '/mail',
    '/mail.html',
    '/robots.txt',
    '/favicon.svg',
    '/favicon.ico',
    '/api/morning-mail',
    '/morning',
    '/morning/:path*',
    '/trips/:path*',
    '/tickets/:path*',
  ],
};

function hostOf(req) {
  return (req.headers.get('host') || '').split(':')[0].toLowerCase();
}

function isGrok(req) {
  return hostOf(req) === 'grok.ostroff.la';
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function unauthorized() {
  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Morning"',
      'Cache-Control': 'no-store',
    },
  });
}

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function gateMorning(req) {
  const pass = process.env.MORNING_BASIC_PASSWORD || '';
  const user = process.env.MORNING_BASIC_USER || 'nick';
  if (!pass) {
    return new Response('Morning dash is locked until the password is set.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  const header = req.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return unauthorized();
  let decoded = '';
  try {
    decoded = atob(header.slice(6));
  } catch {
    return unauthorized();
  }
  const colon = decoded.indexOf(':');
  if (colon < 0) return unauthorized();
  const u = decoded.slice(0, colon);
  const p = decoded.slice(colon + 1);
  if (!timingSafeEqual(u, user) || !timingSafeEqual(p, pass)) return unauthorized();
}

function grokAllowed(path) {
  return (
    path === '/' ||
    path === '/mail' ||
    path === '/mail.html' ||
    path === '/robots.txt' ||
    path === '/favicon.svg' ||
    path === '/favicon.ico' ||
    path === '/api/morning-mail' ||
    path === '/morning' ||
    path.startsWith('/morning/')
  );
}

export default function middleware(req) {
  const url = new URL(req.url);
  const path = url.pathname;

  if (isGrok(req)) {
    if (!grokAllowed(path)) return notFound();
    const blocked = gateMorning(req);
    if (blocked) return blocked;
    return;
  }

  if (path === '/morning' || path.startsWith('/morning/') || path === '/api/morning-mail') {
    return notFound();
  }

  if (!(path.startsWith('/trips') || path.startsWith('/tickets'))) return;

  const token = process.env.FAMILY_TOKEN;
  const cookie = req.headers.get('cookie') || '';
  const ok = Boolean(token) && cookie.split(';').some((c) => c.trim() === `ostroff_family=${token}`);
  if (ok) return;
  const to = new URL('/unlock/', url.origin);
  to.searchParams.set('next', url.pathname);
  return Response.redirect(to.toString(), 302);
}
