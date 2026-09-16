import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rowKey } from './mail-log.js';
import {
  ackNote,
  appendNote,
  buildNote,
  filterNotes,
  isAckBody,
  loadNotes,
  mergeMailWithNotes,
  mergeNoteLists,
  noteStatus,
  notesForRow,
  notesFromCsv,
  normalizeNote,
  saveNotes,
} from './mail-notes.js';

test('normalizeNote accepts correction-shaped rows', () => {
  const n = normalizeNote({
    from: 'Forrest, Conor',
    subject: 'AP Contact',
    cliff: 'archive',
    nick: 'keep',
    note: 'Cliff archive -> Nick keep. Named human billing.',
    account: 'ostroff',
  });
  assert.equal(n.from, 'Forrest, Conor');
  assert.equal(n.cliff, 'archive');
  assert.equal(n.nick, 'keep');
  assert.match(n.key, /Forrest, Conor/);
  assert.equal(n.status, 'open');
  assert.equal(n.processed, false);
});

test('normalizeNote treats processed=true as processed when status is missing', () => {
  const n = normalizeNote({
    id: 'n_zombie',
    from: 'Vercel',
    note: 'This one in Vercel.',
    processed: true,
  });
  assert.equal(n.status, 'processed');
  assert.equal(n.processed, true);
});

test('filterNotes ?status=open excludes terminal notes', () => {
  const open = normalizeNote({ id: 'n_open', note: 'keep', from: 'a' });
  const done = normalizeNote({
    id: 'n_done', note: 'This one in Vercel.', from: 'Vercel', status: 'processed',
  });
  const failed = normalizeNote({ id: 'n_fail', note: 'nope', from: 'b', status: 'failed' });
  const list = [open, done, failed];
  assert.equal(filterNotes(list, 'open').map((n) => n.id).join(','), 'n_open');
  assert.equal(filterNotes(list, 'processed').map((n) => n.id).join(','), 'n_done');
  assert.equal(filterNotes(list, '').length, 3);
  assert.equal(noteStatus({ note: 'x' }), 'open');
});

test('isAckBody accepts processed=true and explicit statuses', () => {
  assert.equal(isAckBody({ id: 'n_1', processed: true }), true);
  assert.equal(isAckBody({ id: 'n_1', status: 'deduped' }), true);
  assert.equal(isAckBody({ account: 'ostroff', note: 'Keep this' }), false);
});

test('notesFromCsv reads filing-corrections.csv columns', () => {
  const csv = `from,subject,cliff,nick,note,account
"Forrest, Conor",AP Contact,archive,keep,Named human billing,ostroff
`;
  const notes = notesFromCsv(csv);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].subject, 'AP Contact');
  assert.equal(notes[0].note, 'Named human billing');
});

test('notesForRow matches key, then legacy from+subject', () => {
  const row = {
    account: 'ostroff',
    date: 'Mon, 3 Aug 2026 16:37:00 -0700',
    from: 'Westside Golf Collective',
    subject: 'Tee time',
  };
  row.key = rowKey(row);
  const keyed = normalizeNote({ ...row, note: 'Move to keep', id: 'a' });
  const legacy = normalizeNote({
    from: 'Westside Golf Collective',
    subject: 'Tee time',
    note: 'Old corr',
    id: 'b',
  });
  assert.equal(notesForRow([keyed], row)[0].id, 'a');
  assert.equal(notesForRow([legacy], row)[0].id, 'b');
});

test('mergeMailWithNotes attaches notes and keeps corrs', () => {
  const row = {
    account: 'ostroff',
    date: 'Thu, 28 Aug 2026 09:00:00 -0700',
    from: 'first@example.com',
    subject: 'Older archive',
    action: 'archive',
    rule: 'promo',
  };
  const note = normalizeNote({ ...row, note: 'Should keep', id: 'n1', by: 'nick', at: '2026-08-30T00:00:00.000Z' });
  const merged = mergeMailWithNotes({
    rows: [row],
    corrs: [{ from: 'Forrest, Conor', subject: 'AP Contact', cliff: 'archive', nick: 'keep', note: 'legacy' }],
    boxes: [],
  }, [note]);
  assert.equal(merged.rows[0].notes.length, 1);
  assert.equal(merged.rows[0].notes[0].note, 'Should keep');
  assert.equal(merged.corrs.length, 1);
  assert.equal(merged.notes.length, 1);
});

test('mergeNoteLists de-dupes by id and sorts by time', () => {
  const a = normalizeNote({ id: '1', note: 'first', at: '2026-08-29T00:00:00.000Z', from: 'a' });
  const b = normalizeNote({ id: '2', note: 'second', at: '2026-08-30T00:00:00.000Z', from: 'b' });
  const again = normalizeNote({ id: '1', note: 'first updated', at: '2026-08-29T00:00:00.000Z', from: 'a' });
  const merged = mergeNoteLists([a, b], [again]);
  assert.equal(merged.map((n) => n.note).join('|'), 'first updated|second');
});

test('buildNote rejects empty text', () => {
  const miss = buildNote({ account: 'ostroff', from: 'a', subject: 'b' });
  assert.equal(miss.status, 400);
  const ok = buildNote({ account: 'ostroff', from: 'a', subject: 'b', note: 'Keep this' }, { by: 'nick' });
  assert.equal(ok.note.note, 'Keep this');
  assert.equal(ok.note.by, 'nick');
  assert.match(ok.note.id, /^n_/);
});

test('appendNote writes json and csv outside git', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mail-notes-'));
  const prevFile = process.env.MAIL_NOTES_FILE;
  const prevCsv = process.env.MAIL_NOTES_CSV;
  const prevEnv = process.env.MAIL_NOTES_JSON;
  const prevVercel = process.env.VERCEL;
  const prevBlob = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.MAIL_NOTES_FILE = join(dir, 'filing-corrections.json');
  process.env.MAIL_NOTES_CSV = join(dir, 'filing-corrections.csv');
  process.env.MAIL_NOTES_JSON = '';
  delete process.env.VERCEL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const first = await appendNote({
      account: 'ostroff',
      from: 'Westside Golf Collective',
      subject: 'Welcome',
      date: 'Mon, 3 Aug 2026 16:37:00 -0700',
      action: 'archive',
      rule: 'archive:default-promo',
      note: 'Cliff archive -> Nick keep. Named human.',
    }, { by: 'nick', at: '2026-08-30T19:00:00.000Z' });
    assert.equal(first.persisted, 'file');
    assert.equal(first.notes.length, 1);

    const json = JSON.parse(await readFile(process.env.MAIL_NOTES_FILE, 'utf8'));
    assert.equal(json.notes[0].note.includes('Named human'), true);
    const csv = await readFile(process.env.MAIL_NOTES_CSV, 'utf8');
    assert.match(csv, /Named human/);
    assert.match(csv, /ostroff/);

    const second = await appendNote({
      account: 'pixelocity',
      from: 'Google Analytics',
      subject: 'Report',
      date: 'Tue, 4 Aug 2026 09:00:00 -0700',
      action: 'keep',
      note: 'Wrong folder. Put in 2. Clients.',
    }, { by: 'nick', at: '2026-08-30T19:05:00.000Z' });
    assert.equal(second.notes.length, 2);
    assert.equal(second.notes[1].account, 'pixelocity');
  } finally {
    if (prevFile == null) delete process.env.MAIL_NOTES_FILE;
    else process.env.MAIL_NOTES_FILE = prevFile;
    if (prevCsv == null) delete process.env.MAIL_NOTES_CSV;
    else process.env.MAIL_NOTES_CSV = prevCsv;
    if (prevEnv == null) delete process.env.MAIL_NOTES_JSON;
    else process.env.MAIL_NOTES_JSON = prevEnv;
    if (prevVercel == null) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
    if (prevBlob == null) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = prevBlob;
    await rm(dir, { recursive: true, force: true });
  }
});

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

test('mail-notes and morning-mail handlers share persisted notes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mail-api-'));
  const prev = {
    MAIL_NOTES_FILE: process.env.MAIL_NOTES_FILE,
    MAIL_NOTES_CSV: process.env.MAIL_NOTES_CSV,
    MAIL_NOTES_JSON: process.env.MAIL_NOTES_JSON,
    MORNING_MAIL_JSON: process.env.MORNING_MAIL_JSON,
    VERCEL: process.env.VERCEL,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
  };
  process.env.MAIL_NOTES_FILE = join(dir, 'filing-corrections.json');
  process.env.MAIL_NOTES_CSV = join(dir, 'filing-corrections.csv');
  process.env.MAIL_NOTES_JSON = '';
  delete process.env.VERCEL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  process.env.MORNING_MAIL_JSON = JSON.stringify({
    rows: [{
      account: 'ostroff',
      from: 'Westside Golf Collective',
      subject: 'Welcome',
      date: 'Mon, 3 Aug 2026 16:37:00 -0700',
      action: 'archive',
      rule: 'archive:default-promo',
      labels: '',
    }],
    corrs: [{
      from: 'Forrest, Conor',
      subject: 'AP Contact',
      cliff: 'archive',
      nick: 'keep',
      note: 'Named human billing.',
    }],
    boxes: [{ account: 'ostroff', label: 'ostroff.la', filed: 1, keep: 0, archive: 1 }],
  });
  try {
    const { default: notesHandler } = await import('../api/mail-notes.js');
    const { default: mailHandler } = await import('../api/morning-mail.js');
    const postReq = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: {
        account: 'ostroff',
        from: 'Westside Golf Collective',
        subject: 'Welcome',
        date: 'Mon, 3 Aug 2026 16:37:00 -0700',
        action: 'archive',
        rule: 'archive:default-promo',
        note: 'Cliff archive -> Nick keep.',
      },
    };
    const postRes = mockRes();
    await notesHandler(postReq, postRes);
    assert.equal(postRes.statusCode, 201);
    const saved = JSON.parse(postRes.body);
    assert.equal(saved.note.note, 'Cliff archive -> Nick keep.');

    const getNotes = mockRes();
    await notesHandler({ method: 'GET', headers: {} }, getNotes);
    assert.equal(getNotes.statusCode, 200);
    assert.equal(JSON.parse(getNotes.body).notes.length, 1);

    const getMail = mockRes();
    await mailHandler({ method: 'GET', headers: {} }, getMail);
    const mail = JSON.parse(getMail.body);
    assert.equal(mail.corrs[0].from, 'Forrest, Conor');
    assert.equal(mail.rows[0].notes[0].note, 'Cliff archive -> Nick keep.');
    assert.equal(mail.notes.length, 1);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

function memoryBlob() {
  const store = new Map();
  return {
    store,
    async put(pathname, body, opts) {
      assert.equal(opts.access, 'private');
      assert.equal(opts.allowOverwrite, true);
      assert.equal(opts.addRandomSuffix, false);
      store.set(pathname, String(body));
      return { pathname, url: `https://example.private.blob.vercel-storage.com/${pathname}` };
    },
    async get(pathname, opts) {
      assert.equal(opts.access, 'private');
      assert.equal(opts.useCache, false);
      const text = store.get(pathname);
      if (!text) return null;
      return {
        statusCode: 200,
        stream: new Blob([text]).stream(),
        blob: { pathname, contentType: 'application/json' },
      };
    },
  };
}

function withNoteEnv(dir, extra = {}) {
  const prev = {
    MAIL_NOTES_FILE: process.env.MAIL_NOTES_FILE,
    MAIL_NOTES_CSV: process.env.MAIL_NOTES_CSV,
    MAIL_NOTES_JSON: process.env.MAIL_NOTES_JSON,
    MAIL_NOTES_BLOB: process.env.MAIL_NOTES_BLOB,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    VERCEL: process.env.VERCEL,
  };
  process.env.MAIL_NOTES_FILE = join(dir, 'filing-corrections.json');
  process.env.MAIL_NOTES_CSV = join(dir, 'filing-corrections.csv');
  process.env.MAIL_NOTES_JSON = '';
  process.env.MAIL_NOTES_BLOB = 'filing-corrections.json';
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

test('saveNotes/loadNotes round-trip on Blob when the token is set', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mail-blob-'));
  const restore = withNoteEnv(dir, {
    BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test_token',
    VERCEL: '1',
  });
  const blob = memoryBlob();
  try {
    const first = await appendNote({
      account: 'ostroff',
      from: 'Westside Golf Collective',
      subject: 'Welcome',
      date: 'Mon, 3 Aug 2026 16:37:00 -0700',
      action: 'archive',
      note: 'Cliff archive -> Nick keep.',
    }, { by: 'nick', at: '2026-08-30T19:00:00.000Z', blob });
    assert.equal(first.persisted, 'blob');
    assert.equal(first.error, undefined);
    assert.ok(blob.store.has('filing-corrections.json'));

    const loaded = await loadNotes({ blob });
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].note, 'Cliff archive -> Nick keep.');
    assert.equal(loaded[0].from, 'Westside Golf Collective');
    assert.equal(loaded[0].id, first.note.id);

    const second = await appendNote({
      account: 'pixelocity',
      from: 'Google Analytics',
      subject: 'Report',
      date: 'Tue, 4 Aug 2026 09:00:00 -0700',
      action: 'keep',
      note: 'Wrong folder.',
    }, { by: 'nick', at: '2026-08-30T19:05:00.000Z', blob });
    assert.equal(second.persisted, 'blob');
    assert.equal(second.notes.length, 2);
    assert.equal((await loadNotes({ blob })).length, 2);
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('saveNotes errors when Blob is configured but write fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mail-blob-fail-'));
  const restore = withNoteEnv(dir, {
    BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test_token',
    VERCEL: '1',
  });
  const blob = {
    async put() { throw new Error('blob 403'); },
    async get() { return null; },
  };
  try {
    const saved = await saveNotes([{
      id: 'n_test',
      account: 'ostroff',
      from: 'a',
      subject: 'b',
      note: 'keep this',
      by: 'nick',
      at: '2026-08-30T19:00:00.000Z',
      key: 'k',
    }], { blob });
    assert.equal(saved.persisted, undefined);
    assert.match(saved.error, /Could not save notes to Blob/);
    assert.equal(saved.status, 502);
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('saveNotes errors on Vercel when Blob token is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mail-blob-none-'));
  const restore = withNoteEnv(dir, {
    BLOB_READ_WRITE_TOKEN: '',
    VERCEL: '1',
  });
  try {
    const saved = await saveNotes([{
      id: 'n_test',
      account: 'ostroff',
      from: 'a',
      subject: 'b',
      note: 'keep this',
      by: 'nick',
      at: '2026-08-30T19:00:00.000Z',
      key: 'k',
    }]);
    assert.equal(saved.persisted, undefined);
    assert.match(saved.error, /BLOB_READ_WRITE_TOKEN/);
    assert.equal(saved.status, 503);
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('ackNote marks a note processed and is idempotent on re-ACK', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mail-ack-'));
  const restore = withNoteEnv(dir);
  try {
    const created = await appendNote({
      account: 'ostroff',
      from: 'Vercel',
      subject: 'Domain',
      date: 'Mon, 15 Sep 2026 08:00:00 -0700',
      action: 'archive',
      note: 'This one in Vercel.',
    }, { by: 'nick', at: '2026-09-15T19:00:00.000Z' });
    const id = created.note.id;
    assert.equal(created.note.status, 'open');

    const first = await ackNote({
      id,
      processed: true,
    }, { by: 'feed', at: '2026-09-16T02:00:00.000Z' });
    assert.equal(first.note.status, 'processed');
    assert.equal(first.note.processed, true);
    assert.equal(first.note.processed_by, 'feed');
    assert.equal(first.note.processed_at, '2026-09-16T02:00:00.000Z');
    assert.equal(first.idempotent, false);
    assert.equal(filterNotes(first.notes, 'open').length, 0);

    const again = await ackNote({ id, processed: true }, { by: 'feed', at: '2026-09-16T03:00:00.000Z' });
    assert.equal(again.idempotent, true);
    assert.equal(again.persisted, 'dedup');
    assert.equal(again.note.processed_at, '2026-09-16T02:00:00.000Z');
    assert.equal(again.note.status, 'processed');

    const missing = await ackNote({ id: 'n_does-not-exist', processed: true });
    assert.equal(missing.status, 404);
    const noId = await ackNote({ processed: true });
    assert.equal(noId.status, 404);
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('ackNote persists status on Blob', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mail-ack-blob-'));
  const restore = withNoteEnv(dir, {
    BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test_token',
    VERCEL: '1',
  });
  const blob = memoryBlob();
  try {
    const created = await appendNote({
      id: 'n_5bf65643-ebc6-4f16-992a-097d878f021c',
      account: 'ostroff',
      from: 'Vercel',
      subject: 'This one',
      note: 'This one in Vercel.',
    }, { by: 'nick', at: '2026-09-15T19:00:00.000Z', blob });
    const acked = await ackNote({
      id: created.note.id,
      status: 'processed',
    }, { by: 'feed', at: '2026-09-16T02:10:00.000Z', blob });
    assert.equal(acked.persisted, 'blob');
    const loaded = await loadNotes({ blob });
    assert.equal(loaded[0].status, 'processed');
    assert.equal(filterNotes(loaded, 'open').length, 0);
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('mail-notes handler ACKs with feed bearer and rejects missing auth', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mail-ack-api-'));
  const prevFeed = process.env.MAIL_NOTES_FEED_TOKEN;
  const restore = withNoteEnv(dir);
  process.env.MAIL_NOTES_FEED_TOKEN = 'feed-token-for-proto';
  try {
    const { default: notesHandler } = await import('../api/mail-notes.js');
    const created = await appendNote({
      account: 'pixelocity',
      from: 'Vercel',
      subject: 'Failed deployment',
      note: 'This one in Vercel.',
    }, { by: 'nick', at: '2026-09-15T19:00:00.000Z' });

    const denied = mockRes();
    await notesHandler({
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: { id: created.note.id, processed: true },
    }, denied);
    assert.equal(denied.statusCode, 401);

    const acked = mockRes();
    await notesHandler({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer feed-token-for-proto',
      },
      body: { id: created.note.id, processed: true },
    }, acked);
    assert.equal(acked.statusCode, 200);
    const first = JSON.parse(acked.body);
    assert.equal(first.note.status, 'processed');
    assert.equal(first.idempotent, false);

    const again = mockRes();
    await notesHandler({
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer feed-token-for-proto',
      },
      body: { id: created.note.id, processed: true },
    }, again);
    assert.equal(again.statusCode, 200);
    assert.equal(JSON.parse(again.body).idempotent, true);

    const missing = mockRes();
    await notesHandler({
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer feed-token-for-proto',
      },
      body: { id: 'n_5bf65643-missing', processed: true },
    }, missing);
    assert.equal(missing.statusCode, 404);

    const open = mockRes();
    await notesHandler({
      method: 'GET',
      headers: {},
      query: { status: 'open' },
    }, open);
    assert.equal(open.statusCode, 200);
    assert.equal(JSON.parse(open.body).notes.length, 0);

    const createDenied = mockRes();
    await notesHandler({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer feed-token-for-proto',
      },
      body: {
        account: 'ostroff',
        from: 'a',
        subject: 'b',
        note: 'Bearer must not create notes',
      },
    }, createDenied);
    assert.equal(createDenied.statusCode, 401);
  } finally {
    restore();
    if (prevFeed == null) delete process.env.MAIL_NOTES_FEED_TOKEN;
    else process.env.MAIL_NOTES_FEED_TOKEN = prevFeed;
    await rm(dir, { recursive: true, force: true });
  }
});
