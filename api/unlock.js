// Legacy family-passcode endpoint. The private area is admin login now.
export default async function handler(req, res) {
  const next = typeof req.body === 'object' && req.body?.next ? String(req.body.next) : '';
  const q = next ? `?next=${encodeURIComponent(next)}` : '';
  res.statusCode = 302;
  res.setHeader('Location', `/login/${q}`);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}
