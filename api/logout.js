// POST /api/logout — clears the admin session cookie.
import { redirect, json, wantsJson } from '../lib/http.js';
import { clearSessionCookie } from '../lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST, GET');
    return res.end('Method Not Allowed');
  }
  res.setHeader('Set-Cookie', clearSessionCookie());
  if (wantsJson(req)) return json(res, 200, { ok: true });
  return redirect(res, '/');
}
