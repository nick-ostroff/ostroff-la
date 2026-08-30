// POST /api/login — username + password. Sets ostroff_admin session cookie.
import { readBody, redirect, json, wantsJson } from '../lib/http.js';
import { findUser, verifyPassword } from '../lib/users.js';
import { safeNext, sessionSecret, setSessionCookie, signSession } from '../lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end('Method Not Allowed');
  }
  if (!sessionSecret()) {
    if (wantsJson(req)) return json(res, 503, { error: 'admin login is locked until ADMIN_SESSION_SECRET is set' });
    return redirect(res, '/login/?err=locked');
  }

  const body = await readBody(req);
  const next = safeNext(body.next);
  const user = await findUser(body.username);
  const ok = user && await verifyPassword(user, body.password);
  if (!ok) {
    if (wantsJson(req)) return json(res, 401, { error: 'username or password did not match' });
    return redirect(res, `/login/?err=1&next=${encodeURIComponent(next)}`);
  }

  const cookie = setSessionCookie(await signSession(user.username));
  if (wantsJson(req)) {
    res.setHeader('Set-Cookie', cookie);
    return json(res, 200, { ok: true, username: user.username, next });
  }
  return redirect(res, next, cookie);
}
