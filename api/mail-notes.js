// GET /api/mail-notes — Cap/Cliff/Proto feed of filing notes.
//   Admin session cookie, or Authorization: Bearer MAIL_NOTES_FEED_TOKEN.
// POST /api/mail-notes — Nick saves a per-row note. Admin session only.
// Persist: @vercel/blob (private) in production, .data locally. Not git.
import { readBody, json } from '../lib/http.js';
import { readSession } from '../lib/session.js';
import { appendNote, loadNotes, notifyAgentMail, notifyWebhook } from '../lib/mail-notes.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return json(res, 200, { notes: await loadNotes() });
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST');
    return res.end('Method Not Allowed');
  }

  const session = await readSession(req.headers.cookie || '');
  const by = session?.username || process.env.MORNING_BASIC_USER || 'nick';
  const body = await readBody(req);
  const result = await appendNote(body, { by });
  if (result.error) return json(res, result.status || 400, { error: result.error });

  const notify = await notifyAgentMail(result.note);
  const webhook = await notifyWebhook(result.note);
  return json(res, 201, {
    ok: true,
    note: result.note,
    notes: result.notes,
    persisted: result.persisted,
    envSnippet: result.envSnippet,
    notify,
    webhook,
  });
}
