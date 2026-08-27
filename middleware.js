// Vercel Routing Middleware — gates the family sections behind the passcode cookie set by /api/unlock.
export const config = { matcher: ['/trips/:path*', '/tickets/:path*'] };

export default function middleware(req) {
  const token = process.env.FAMILY_TOKEN;
  const cookie = req.headers.get('cookie') || '';
  const ok = Boolean(token) && cookie.split(';').some((c) => c.trim() === `ostroff_family=${token}`);
  if (ok) return;
  const url = new URL(req.url);
  const to = new URL('/unlock/', url.origin);
  to.searchParams.set('next', url.pathname);
  return Response.redirect(to.toString(), 302);
}
