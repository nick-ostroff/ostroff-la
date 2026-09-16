// GET /api/mail-notes — Cap/Cliff/Proto feed of filing notes.
//   Admin session cookie, or Authorization: Bearer MAIL_NOTES_FEED_TOKEN.
//   ?status=open returns only open notes (excludes processed/failed/deduped).
// POST /api/mail-notes — Nick saves a per-row note. Admin session only.
// POST or PATCH /api/mail-notes — terminal ACK. Session or same feed Bearer.
//   Body: { id, processed: true } or { id, status: "processed"|"failed"|"deduped", detail? }
//   Re-ACK of an already-terminal note is 200 + the same note (idempotent).
//   Missing id → 404. Missing/wrong auth → 401. Bearer cannot create notes.
// Persist: @vercel/blob (private) in production, .data locally. Not git.
// Curl (after deploy; token is the Vercel env, never commit it):
//   curl -sS -H "Authorization: Bearer $MAIL_NOTES_FEED_TOKEN" \
//     "https://ostroff.la/api/mail-notes?status=open"
//   curl -sS -X PATCH -H "Authorization: Bearer $MAIL_NOTES_FEED_TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{"id":"n_5bf65643-ebc6-4f16-992a-097d878f021c","processed":true}' \
//     https://ostroff.la/api/mail-notes
import { queryValue, readBody, json } from '../lib/http.js';
import { mailNotesFeedAuthorized, readSession } from '../lib/session.js';
import {
  ackNote,
  appendNote,
  filterNotes,
  isAckBody,
  loadNotes,
  notifyAgentMail,
  notifyWebhook,
} from '../lib/mail-notes.js';

function authorization(req) {
  return req.headers?.authorization || req.headers?.Authorization || '';
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const notes = await loadNotes();
    return json(res, 200, { notes: filterNotes(notes, queryValue(req, 'status')) });
  }

  if (req.method !== 'POST' && req.method !== 'PATCH') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.end('Method Not Allowed');
  }

  const session = await readSession(req.headers.cookie || '');
  const feed = mailNotesFeedAuthorized(authorization(req));
  const body = await readBody(req);

  if (req.method === 'PATCH' || isAckBody(body)) {
    if (!session && !feed) return json(res, 401, { error: 'auth required' });
    const result = await ackNote(body, { by: session?.username || 'feed' });
    if (result.error) return json(res, result.status || 400, { error: result.error });
    return json(res, 200, {
      ok: true,
      note: result.note,
      notes: result.notes,
      persisted: result.persisted,
      idempotent: Boolean(result.idempotent),
    });
  }

  if (feed && !session) {
    return json(res, 401, { error: 'admin session required to create notes' });
  }

  const by = session?.username || process.env.MORNING_BASIC_USER || 'nick';
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
