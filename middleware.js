// Vercel Routing Middleware
// - /trips and /tickets: family passcode cookie (FAMILY_TOKEN)
// - /morning: HTTP basic auth (user nick, password MORNING_BASIC_PASSWORD)
// Password is env-only. Never commit it. Fail closed if unset.

export const config = {
  matcher: [
    '/trips/:path*',
    '/tickets/:path*',
    '/morning',
    '/morning/:path*',
    '/api/morning-mail',
  ],
};

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

export default function middleware(req) {
  const url = new URL(req.url);
  const path = url.pathname;
  if (path === '/morning' || path.startsWith('/morning/') || path === '/api/morning-mail') {
    const blocked = gateMorning(req);
    if (blocked) return blocked;
    return;
  }

  const token = process.env.FAMILY_TOKEN;
  const cookie = req.headers.get('cookie') || '';
  const ok = Boolean(token) && cookie.split(';').some((c) => c.trim() === `ostroff_family=${token}`);
  if (ok) return;
  const to = new URL('/unlock/', url.origin);
  to.searchParams.set('next', url.pathname);
  return Response.redirect(to.toString(), 302);
}
