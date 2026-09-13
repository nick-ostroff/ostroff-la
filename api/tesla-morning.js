// GET /api/tesla-morning — latest Tesla charge snapshot for the briefing UI.
//   Admin session cookie (same-origin fetch with credentials), or
//   Authorization: Bearer TESLA_MORNING_FEED_TOKEN.
// POST /api/tesla-morning — Otto upserts the full snapshot. Bearer token only.
// Persist: private @vercel/blob pathname tesla-morning.json (override with
// TESLA_MORNING_BLOB). Local: .data/tesla-morning.json. Vercel cannot read
// /home/box/shared/tesla-morning.json — Otto must POST a copy here.
// Env:
//   TESLA_MORNING_FEED_TOKEN — Otto feeder + optional GET. Empty/unset
//     keeps GET session-only and rejects POST.
//   BLOB_READ_WRITE_TOKEN — same private Blob store as mail-notes. Required
//     on Vercel so the snapshot survives deploys.
// Optional: TESLA_MORNING_BLOB, TESLA_MORNING_FILE.
import { readBody, json } from '../lib/http.js';
import { teslaMorningFeedAuthorized } from '../lib/session.js';
import { loadSnapshot, saveSnapshot } from '../lib/tesla-morning.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const snapshot = await loadSnapshot();
    if (!snapshot) return json(res, 200, { empty: true });
    return json(res, 200, snapshot);
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST');
    return res.end('Method Not Allowed');
  }

  if (!teslaMorningFeedAuthorized(req.headers.authorization || '')) {
    return json(res, 401, { error: 'auth required' });
  }

  const body = await readBody(req);
  const result = await saveSnapshot(body);
  if (result.error) return json(res, result.status || 400, { error: result.error });
  return json(res, 200, { ok: true, snapshot: result.snapshot });
}
