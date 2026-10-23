// GET /api/projects — projects board snapshot (admin session only; gated in middleware.js).
import { json } from '../lib/http.js';
import { loadProjects } from '../lib/projects.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405; res.setHeader('Allow', 'GET'); return res.end('Method Not Allowed');
  }
  const snap = await loadProjects();
  if (!snap) return json(res, 200, { empty: true });
  return json(res, 200, snap);
}
