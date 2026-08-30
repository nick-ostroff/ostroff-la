// GET /api/morning-mail — filing log JSON. Production source is the Vercel
// secret MORNING_MAIL_JSON. Locally, fall back to .data/morning-mail.json or
// a rebuild from gmail-batch/logs per-box CSVs. Never commit those files.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPayload, defaultLogDir, loadBoxesFromDir, publicPayload } from '../lib/mail-log.js';

const root = fileURLToPath(new URL('..', import.meta.url));

function send(res, status, body, raw = false) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(raw ? body : JSON.stringify(body));
}

async function loadLocal() {
  try {
    const raw = await readFile(join(root, '.data', 'morning-mail.json'), 'utf8');
    if (raw.trim()) return raw;
  } catch {}
  try {
    const boxes = await loadBoxesFromDir(defaultLogDir());
    return JSON.stringify(publicPayload(buildPayload(boxes)));
  } catch {
    return '';
  }
}

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    return res.end('Method Not Allowed');
  }
  const fromEnv = process.env.MORNING_MAIL_JSON || '';
  if (fromEnv.trim()) return send(res, 200, fromEnv, true);
  if (!process.env.VERCEL) {
    const local = await loadLocal();
    if (local) return send(res, 200, local, true);
  }
  return send(res, 503, { error: 'mail log not loaded' });
}
