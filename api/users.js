// GET /api/users — list admin usernames (session required).
// POST /api/users — create an admin. Session required, unless this is the first user
// (then the existing Morning / family / ADMIN_SETUP_TOKEN code is required).
import { readBody, json } from '../lib/http.js';
import { readSession, sessionSecret, setSessionCookie, signSession } from '../lib/session.js';
import { createUser, loadUsers, publicUsers, setupCode, setupCodeOk } from '../lib/users.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const existing = await loadUsers();
    if (!existing.length) return json(res, 200, { users: [], empty: true });
    const session = await readSession(req.headers.cookie || '');
    if (!session) return json(res, 401, { error: 'not signed in', empty: false });
    return json(res, 200, { users: await publicUsers(), empty: false });
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST');
    return res.end('Method Not Allowed');
  }

  if (!sessionSecret()) {
    return json(res, 503, { error: 'admin login is locked until ADMIN_SESSION_SECRET is set' });
  }

  const body = await readBody(req);
  const existing = await loadUsers();
  const session = await readSession(req.headers.cookie || '');

  if (!existing.length) {
    if (!setupCode()) {
      return json(res, 503, { error: 'set ADMIN_SETUP_TOKEN or MORNING_BASIC_PASSWORD before creating the first admin' });
    }
    if (!setupCodeOk(body.setup || body.code)) {
      return json(res, 401, { error: 'setup code did not match' });
    }
  } else if (!session) {
    return json(res, 401, { error: 'not signed in' });
  }

  const result = await createUser({ username: body.username, password: body.password });
  if (result.error) return json(res, result.status, { error: result.error });

  const headers = [];
  if (!session) {
    headers.push(setSessionCookie(await signSession(result.user.username)));
  }
  if (headers.length) res.setHeader('Set-Cookie', headers);

  return json(res, 201, {
    ok: true,
    user: result.user,
    users: (await publicUsers()),
    persisted: result.persisted,
    envSnippet: result.envSnippet,
  });
}
