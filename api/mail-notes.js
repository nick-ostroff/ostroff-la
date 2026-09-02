// GET /api/mail-notes — Cap/Cliff/Proto feed of filing notes.
//   Admin session cookie, or Authorization: Bearer MAIL_NOTES_FEED_TOKEN.
//   Filter with ?status=open (uncleared) or ?status=all (default). Optional ?account=.
// POST /api/mail-notes — Nick saves a per-row note (admin session), or
//   Cliff/Nick marks a note processed ({ id|key, processed: true }).
//   Feed bearer may POST processed; creating a note still prefers a session.
// Persist: @vercel/blob (private) in production, .data locally. Not git.
import { readBody, json } from '../lib/http.js';
import { mailNotesFeedAuthorized, readSession } from '../lib/session.js';
import {
  appendNote,
  filterNotes,
  loadNotes,
  markNotesProcessed,
  notesFilterStatus,
  notifyAgentMail,
  notifyWebhook,
  wantsProcessed,
} from '../lib/mail-notes.js';

function readQuery(req) {
  if (req.query && typeof req.query === 'object' && !Array.isArray(req.query)) {
    return req.query;
  }
  try {
    return Object.fromEntries(new URL(req.url || '', 'http://localhost').searchParams);
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const query = readQuery(req);
    const status = notesFilterStatus(query);
    const all = await loadNotes();
    const notes = filterNotes(all, query);
    return json(res, 200, { notes, status, count: notes.length });
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST');
    return res.end('Method Not Allowed');
  }

  const session = await readSession(req.headers.cookie || '');
  const feed = mailNotesFeedAuthorized(req.headers.authorization || req.headers.Authorization);
  const body = await readBody(req);

  if (wantsProcessed(body)) {
    const by = session?.username || (feed ? 'cliff' : process.env.MORNING_BASIC_USER || 'nick');
    const result = await markNotesProcessed(body, { by });
    if (result.error) return json(res, result.status || 400, { error: result.error });
    return json(res, 200, {
      ok: true,
      note: result.note,
      notes: result.notes,
      persisted: result.persisted,
    });
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
