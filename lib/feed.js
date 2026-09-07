// Upstream RSS fetch helpers for /api/feed.
// Bypass intermediate caches so a frozen Vercel/CDN body on peterostroff
// (or nickostroff) does not stick to ostroff.la. The /api/feed response
// itself may still be edge-cached briefly.

export const UPSTREAM_FETCH = {
  cache: 'no-store',
  headers: {
    'user-agent': 'ostroff.la/1.0 (+https://ostroff.la)',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
  },
};

export function freshUpstreamUrl(feed, now = Date.now()) {
  const url = new URL(feed);
  url.searchParams.set('_', String(now));
  return url.href;
}
