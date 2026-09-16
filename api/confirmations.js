// GET /api/confirmations — list or fetch one binding confirmation.
//   Admin session cookie, or Authorization: Bearer MAIL_NOTES_FEED_TOKEN.
//   ?status=pending  ?id=c_…
// POST /api/confirmations — Cliff/Cap create a pending approval.
// PATCH /api/confirmations — approve/deny (Nick session or Cap Bearer)
//   or consume (Cliff Bearer). Cliff must never auto-approve.
// Persist: private @vercel/blob (CONFIRMATIONS_BLOB or bot-confirmations.json).
// Confirm channel is Cap chat / AgentMail Cap / /bots/confirm/ — not Gmail.
// Curl (after deploy; token is the Vercel env, never commit it):
//   curl -sS -X POST -H "Authorization: Bearer $MAIL_NOTES_FEED_TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{"kind":"send_email","summary":"Reply to Casey","payload":{"to":"casey@example.com"},"requested_by":"cliff"}' \
//     https://ostroff.la/api/confirmations
//   curl -sS -X PATCH -H "Authorization: Bearer $MAIL_NOTES_FEED_TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{"id":"c_…","status":"approved"}' \
//     https://ostroff.la/api/confirmations
//   curl -sS -X PATCH -H "Authorization: Bearer $MAIL_NOTES_FEED_TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{"id":"c_…","consumed":true}' \
//     https://ostroff.la/api/confirmations
import { queryValue, readBody, json } from '../lib/http.js';
import { mailNotesFeedAuthorized, readSession } from '../lib/session.js';
import {
  consumeConfirmation,
  createConfirmation,
  decideConfirmation,
  filterConfirmations,
  getConfirmation,
  isConsumeBody,
  isDecideBody,
  loadConfirmations,
} from '../lib/confirmations.js';

function authorization(req) {
  return req.headers?.authorization || req.headers?.Authorization || '';
}

async function requireAuth(req) {
  const session = await readSession(req.headers.cookie || '');
  const feed = mailNotesFeedAuthorized(authorization(req));
  if (!session && !feed) return { error: 'auth required', status: 401 };
  return {
    session,
    feed,
    by: session?.username || (feed ? 'feed' : ''),
  };
}

function sendResult(res, result, extra = {}) {
  if (result.error) {
    const body = { error: result.error };
    if (result.confirmation) body.confirmation = result.confirmation;
    return json(res, result.status || 400, body);
  }
  return json(res, extra.status || 200, {
    ok: true,
    confirmation: result.confirmation,
    confirmations: result.confirmations,
    persisted: result.persisted,
    idempotent: Boolean(result.idempotent),
    ...extra.fields,
  });
}

export default async function handler(req, res) {
  const auth = await requireAuth(req);
  if (auth.error) return json(res, auth.status, { error: auth.error });

  if (req.method === 'GET') {
    const id = queryValue(req, 'id');
    if (id) {
      const result = await getConfirmation(id);
      if (result.error) return json(res, result.status || 404, { error: result.error });
      return json(res, 200, { confirmation: result.confirmation });
    }
    const confirmations = filterConfirmations(
      await loadConfirmations(),
      queryValue(req, 'status'),
    );
    return json(res, 200, { confirmations });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    if (isConsumeBody(body) || isDecideBody(body)) {
      return json(res, 405, { error: 'use PATCH to approve, deny, or consume' });
    }
    const result = await createConfirmation(body, {
      by: body.requested_by || (auth.session ? auth.session.username : 'cliff'),
    });
    return sendResult(res, result, { status: result.error ? result.status : 201 });
  }

  if (req.method !== 'PATCH') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST, PATCH');
    return res.end('Method Not Allowed');
  }

  const body = await readBody(req);
  if (isConsumeBody(body)) {
    const result = await consumeConfirmation(body, { by: auth.by });
    return sendResult(res, result);
  }
  if (isDecideBody(body)) {
    const result = await decideConfirmation(body, {
      by: auth.session?.username || 'cap',
    });
    return sendResult(res, result);
  }
  return json(res, 400, { error: 'status must be approved, denied, or consumed' });
}
