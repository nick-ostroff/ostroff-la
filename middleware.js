// Vercel Routing Middleware
// - Existing subdomains 301 onto ostroff.la (tickets.ostroff.la is kept; do not delete).
// - Old Bots paths (/bots, /morning, /mail.html) 301 onto the portal (/today, /approvals, /mail).
// - Private paths: /today, /approvals, /mail, /projects, /tickets, /trips + mail/confirm/Tesla/projects APIs
// - GET/POST/PATCH /api/mail-notes also allows Authorization: Bearer MAIL_NOTES_FEED_TOKEN
//   (handler: Bearer may ACK; create still needs an admin session)
// - GET/POST/PATCH /api/confirmations also allows the same mail-notes feed Bearer
// - GET/POST /api/tesla-morning also allows Authorization: Bearer TESLA_MORNING_FEED_TOKEN
// - Admin session cookie (ostroff_admin) once ADMIN_SESSION_SECRET is set.
// - Until then, nick / MORNING_BASIC_PASSWORD basic auth is the fail-closed stopgap.

import { mailNotesFeedAuthorized, readSession, sessionSecret, teslaMorningFeedAuthorized } from './lib/session.js';

export const config = {
  matcher: [
    '/',
    '/mail',
    '/mail.html',
    '/robots.txt',
    '/favicon.svg',
    '/favicon.ico',
    '/((?!assets/|images/|tickets/teams/|favicon\\.svg).*)',
  ],
};

function hostOf(req) {
  const header = (req.headers.get('host') || '').split(':')[0].toLowerCase();
  if (header) return header;
  try { return new URL(req.url).hostname.toLowerCase(); } catch { return ''; }
}

function apex(path, search = '') {
  return `https://ostroff.la${path}${search}`;
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

function gateMorning(req) {
  const pass = process.env.MORNING_BASIC_PASSWORD || '';
  const user = process.env.MORNING_BASIC_USER || 'nick';
  if (!pass) {
    return new Response('Private pages are locked until admin login or the stopgap password is set.', {
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

function isPrivatePath(path) {
  return (
    path === '/api/morning-mail' ||
    path === '/api/mail-notes' ||
    path === '/api/confirmations' ||
    path === '/api/tesla-morning' ||
    path === '/api/projects' ||
    path === '/today' || path.startsWith('/today/') ||
    path === '/approvals' || path.startsWith('/approvals/') ||
    path === '/mail' || path.startsWith('/mail/') ||
    path === '/projects' || path.startsWith('/projects/') ||
    path === '/trips' || path.startsWith('/trips/') ||
    path === '/tickets' || path.startsWith('/tickets/')
  );
}

// Old Bots/Morning paths → portal paths. Returns null when the path is not a legacy one.
function legacyRedirect(path) {
  if (path === '/mail.html') return '/mail/';
  if (path === '/bots/mail' || path.startsWith('/bots/mail/')) return '/mail/';
  if (path === '/bots/confirm' || path.startsWith('/bots/confirm/')) return '/approvals/';
  if (path === '/bots' || path.startsWith('/bots/')) return '/today/';
  if (path === '/morning/mail.html' || path === '/morning/mail') return '/mail/';
  if (path === '/morning' || path.startsWith('/morning/')) return '/today/';
  return null;
}

function deny(req, url, path) {
  if (path.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'auth required' }), {
      status: 401,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }
  const to = new URL('/login/', url.origin);
  to.searchParams.set('next', path.endsWith('/') ? path : `${path}/`);
  return Response.redirect(to.toString(), 302);
}

function subdomainTarget(host, path) {
  if (host === 'grok.ostroff.la') {
    if (path === '/mail' || path === '/mail/' || path === '/mail.html' || path === '/morning/mail.html' || path === '/morning/mail') {
      return '/mail/';
    }
    if (path.startsWith('/api/')) return path;
    const legacy = legacyRedirect(path);
    if (legacy) return legacy;
    if (isPrivatePath(path)) return path;
    return '/today/';
  }
  if (host === 'tickets.ostroff.la') {
    if (path === '/' || path === '') return '/tickets/';
    if (path.startsWith('/tickets') || path.startsWith('/api/')) return path;
    return `/tickets${path.startsWith('/') ? path : `/${path}`}`;
  }
  if (host === 'trips.ostroff.la') {
    if (path === '/' || path === '') return '/trips/';
    if (path.startsWith('/trips') || path.startsWith('/api/')) return path;
    return `/trips${path.startsWith('/') ? path : `/${path}`}`;
  }
  return null;
}

export default async function middleware(req) {
  const url = new URL(req.url);
  const path = url.pathname;
  const dest = subdomainTarget(hostOf(req), path);
  if (dest) return Response.redirect(apex(dest, url.search), 301);

  const legacy = legacyRedirect(path);
  if (legacy) return Response.redirect(new URL(legacy, url.origin).toString(), 301);

  if (!isPrivatePath(path)) return;

  const session = await readSession(req.headers.get('cookie') || '');
  if (session) return;

  // Proto/Cliff/Cap may GET notes and ACK them with the feed token.
  // Creating a note still requires an admin session (enforced in the handler).
  if (
    path === '/api/mail-notes'
    && mailNotesFeedAuthorized(req.headers.get('authorization'))
  ) {
    return;
  }

  // Binding confirm-gate: same feed token for create/list/consume; Cap may approve.
  if (
    path === '/api/confirmations'
    && mailNotesFeedAuthorized(req.headers.get('authorization'))
  ) {
    return;
  }

  // Otto may GET/POST the Tesla snapshot with a dedicated feed token.
  if (
    path === '/api/tesla-morning'
    && teslaMorningFeedAuthorized(req.headers.get('authorization'))
  ) {
    return;
  }

  if (sessionSecret()) return deny(req, url, path);

  const blocked = gateMorning(req);
  if (blocked) return blocked;
}
