// GET /api/me — current admin session, or 401.
import { json } from '../lib/http.js';
import { readSession } from '../lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end('Method Not Allowed');
  }
  const session = await readSession(req.headers.cookie || '');
  if (!session) return json(res, 401, { error: 'not signed in' });
  return json(res, 200, { username: session.username });
}
