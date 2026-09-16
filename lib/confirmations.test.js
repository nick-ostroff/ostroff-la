import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyExpiry,
  buildConfirmation,
  consumeConfirmation,
  createConfirmation,
  decideConfirmation,
  filterConfirmations,
  getConfirmation,
  loadConfirmations,
  normalizeConfirmation,
} from './confirmations.js';

function memoryBlob() {
  const store = new Map();
  return {
    store,
    async put(pathname, body, opts) {
      assert.equal(opts.access, 'private');
      assert.equal(opts.allowOverwrite, true);
      store.set(pathname, String(body));
      return { pathname };
    },
    async get(pathname, opts) {
      assert.equal(opts.access, 'private');
      const text = store.get(pathname);
      if (!text) return null;
      return { statusCode: 200, stream: new Blob([text]).stream() };
    },
  };
}

function withConfirmEnv(dir, extra = {}) {
  const prev = {
    CONFIRMATIONS_FILE: process.env.CONFIRMATIONS_FILE,
    CONFIRMATIONS_BLOB: process.env.CONFIRMATIONS_BLOB,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    VERCEL: process.env.VERCEL,
    MAIL_NOTES_FEED_TOKEN: process.env.MAIL_NOTES_FEED_TOKEN,
    ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
  };
  process.env.CONFIRMATIONS_FILE = join(dir, 'bot-confirmations.json');
  process.env.CONFIRMATIONS_BLOB = 'bot-confirmations.json';
  for (const [k, v] of Object.entries(extra)) {
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b == null ? '' : String(b); },
  };
  return res;
}

test('normalizeConfirmation keeps kind, payload, and pending status', () => {
  const c = normalizeConfirmation({
    id: 'c_1',
    kind: 'send_email',
    summary: 'Reply to Casey',
    payload: { to: 'casey@example.com' },
    requested_by: 'cliff',
  });
  assert.equal(c.status, 'pending');
  assert.equal(c.kind, 'send_email');
  assert.equal(c.action, 'send_email');
  assert.equal(c.payload.to, 'casey@example.com');
});

test('applyExpiry flips pending and approved after expires_at', () => {
  const pending = normalizeConfirmation({
    id: 'c_exp',
    kind: 'payment',
    summary: 'Pay Steve',
    status: 'pending',
    expires_at: '2026-09-15T00:00:00.000Z',
  });
  const expired = applyExpiry(pending, Date.parse('2026-09-16T00:00:00.000Z'));
  assert.equal(expired.status, 'expired');
  const still = applyExpiry(pending, Date.parse('2026-09-14T00:00:00.000Z'));
  assert.equal(still.status, 'pending');
});

test('buildConfirmation requires kind and summary and sets a 24h expiry', () => {
  const miss = buildConfirmation({ kind: 'send_email' });
  assert.equal(miss.status, 400);
  const ok = buildConfirmation({
    kind: 'todoist_create',
    summary: 'File a task for Abbey',
    requested_by: 'cliff',
  }, { at: '2026-09-16T00:00:00.000Z' });
  assert.equal(ok.confirmation.status, 'pending');
  assert.equal(ok.confirmation.expires_at, '2026-09-17T00:00:00.000Z');
  assert.match(ok.confirmation.id, /^c_/);
});

test('create → approve → consume; replay consume is idempotent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'confirm-'));
  const restore = withConfirmEnv(dir);
  try {
    const created = await createConfirmation({
      kind: 'send_email',
      summary: 'Reply to Casey',
      payload: { to: 'casey@example.com', subject: 'Re: call' },
      requested_by: 'cliff',
    }, { by: 'cliff', at: '2026-09-16T00:00:00.000Z' });
    assert.equal(created.persisted, 'file');
    assert.equal(created.confirmation.status, 'pending');
    const id = created.confirmation.id;

    const pendingOnly = filterConfirmations(created.confirmations, 'pending');
    assert.equal(pendingOnly.length, 1);

    const tooSoon = await consumeConfirmation({ id, consumed: true });
    assert.equal(tooSoon.status, 409);
    assert.equal(tooSoon.confirmation.status, 'pending');

    const approved = await decideConfirmation({ id, status: 'approved' }, { by: 'nick', at: '2026-09-16T00:05:00.000Z' });
    assert.equal(approved.confirmation.status, 'approved');
    assert.equal(approved.confirmation.decided_by, 'nick');

    const againApprove = await decideConfirmation({ id, status: 'approved' }, { by: 'cap' });
    assert.equal(againApprove.idempotent, true);
    assert.equal(againApprove.confirmation.decided_by, 'nick');

    const consumed = await consumeConfirmation({ id, consumed: true }, { at: '2026-09-16T00:10:00.000Z' });
    assert.equal(consumed.confirmation.status, 'consumed');
    assert.equal(consumed.confirmation.consumed_at, '2026-09-16T00:10:00.000Z');

    const replay = await consumeConfirmation({ id, status: 'consumed' });
    assert.equal(replay.idempotent, true);
    assert.equal(replay.confirmation.consumed_at, '2026-09-16T00:10:00.000Z');

    const got = await getConfirmation(id);
    assert.equal(got.confirmation.status, 'consumed');
    const missing = await getConfirmation('c_nope');
    assert.equal(missing.status, 404);

    const json = JSON.parse(await readFile(process.env.CONFIRMATIONS_FILE, 'utf8'));
    assert.equal(json.confirmations[0].status, 'consumed');
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('cannot approve an expired confirmation; deny is terminal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'confirm-exp-'));
  const restore = withConfirmEnv(dir);
  try {
    const created = await createConfirmation({
      kind: 'payment',
      summary: 'Pay Steve',
      expires_at: '2026-09-15T00:00:00.000Z',
    }, { by: 'cliff', at: '2026-09-14T00:00:00.000Z' });
    const expired = await decideConfirmation({
      id: created.confirmation.id,
      status: 'approved',
    }, { by: 'nick' });
    assert.equal(expired.status, 409);
    assert.equal(expired.confirmation.status, 'expired');

    const live = await createConfirmation({
      kind: 'payment',
      summary: 'Pay Michael',
    }, { by: 'cliff', at: '2026-09-16T00:00:00.000Z' });
    const denied = await decideConfirmation({
      id: live.confirmation.id,
      status: 'denied',
    }, { by: 'nick' });
    assert.equal(denied.confirmation.status, 'denied');
    const consumeDenied = await consumeConfirmation({ id: live.confirmation.id, consumed: true });
    assert.equal(consumeDenied.status, 409);
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('confirmations persist on Blob when the token is set', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'confirm-blob-'));
  const restore = withConfirmEnv(dir, {
    BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test_token',
    VERCEL: '1',
  });
  const blob = memoryBlob();
  try {
    const created = await createConfirmation({
      kind: 'todoist_create',
      summary: 'Task for Abbey',
    }, { by: 'cliff', blob });
    assert.equal(created.persisted, 'blob');
    const loaded = await loadConfirmations({ blob });
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].kind, 'todoist_create');
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('confirmations handler requires auth and enforces consume rules', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'confirm-api-'));
  const restore = withConfirmEnv(dir, {
    MAIL_NOTES_FEED_TOKEN: 'feed-token-for-proto',
    ADMIN_SESSION_SECRET: 'test-secret-please-rotate',
  });
  try {
    const { default: handler } = await import('../api/confirmations.js');

    const denied = mockRes();
    await handler({ method: 'GET', headers: {}, query: {} }, denied);
    assert.equal(denied.statusCode, 401);

    const createdRes = mockRes();
    await handler({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer feed-token-for-proto',
      },
      body: {
        kind: 'send_email',
        summary: 'Reply to Casey',
        payload: { to: 'casey@example.com' },
        requested_by: 'cliff',
      },
    }, createdRes);
    assert.equal(createdRes.statusCode, 201);
    const created = JSON.parse(createdRes.body);
    const id = created.confirmation.id;

    const listPending = mockRes();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer feed-token-for-proto' },
      query: { status: 'pending' },
    }, listPending);
    assert.equal(JSON.parse(listPending.body).confirmations.length, 1);

    const consumeEarly = mockRes();
    await handler({
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer feed-token-for-proto',
      },
      body: { id, consumed: true },
    }, consumeEarly);
    assert.equal(consumeEarly.statusCode, 409);

    const approved = mockRes();
    await handler({
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer feed-token-for-proto',
      },
      body: { id, status: 'approved' },
    }, approved);
    assert.equal(approved.statusCode, 200);
    assert.equal(JSON.parse(approved.body).confirmation.status, 'approved');
    assert.equal(JSON.parse(approved.body).confirmation.decided_by, 'cap');

    const consumed = mockRes();
    await handler({
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer feed-token-for-proto',
      },
      body: { id, consumed: true },
    }, consumed);
    assert.equal(consumed.statusCode, 200);
    assert.equal(JSON.parse(consumed.body).confirmation.status, 'consumed');

    const replay = mockRes();
    await handler({
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer feed-token-for-proto',
      },
      body: { id, consumed: true },
    }, replay);
    assert.equal(replay.statusCode, 200);
    assert.equal(JSON.parse(replay.body).idempotent, true);

    const byId = mockRes();
    await handler({
      method: 'GET',
      headers: { authorization: 'Bearer feed-token-for-proto' },
      query: { id },
    }, byId);
    assert.equal(JSON.parse(byId.body).confirmation.status, 'consumed');
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('confirmations handler allows the basic-auth stopgap when session secret is unset', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'confirm-stopgap-'));
  const restore = withConfirmEnv(dir, {
    MAIL_NOTES_FEED_TOKEN: '',
    ADMIN_SESSION_SECRET: '',
    MORNING_BASIC_USER: 'nick',
  });
  try {
    const { default: handler } = await import('../api/confirmations.js');
    const created = await createConfirmation({
      kind: 'payment',
      summary: 'Pay Steve',
    }, { by: 'cliff' });
    const listed = mockRes();
    await handler({ method: 'GET', headers: {}, query: { status: 'pending' } }, listed);
    assert.equal(listed.statusCode, 200);
    assert.equal(JSON.parse(listed.body).confirmations.length, 1);

    const approved = mockRes();
    await handler({
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: { id: created.confirmation.id, status: 'approved' },
    }, approved);
    assert.equal(approved.statusCode, 200);
    assert.equal(JSON.parse(approved.body).confirmation.decided_by, 'nick');
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});
