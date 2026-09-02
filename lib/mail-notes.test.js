import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rowKey } from './mail-log.js';
import {
  appendNote,
  buildNote,
  filterNotes,
  isNoteOpen,
  isNoteProcessed,
  loadNotes,
  markNotesProcessed,
  mergeMailWithNotes,
  mergeNoteLists,
  notesFilterStatus,
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

test('normalizeNote keeps processed fields and treats missing as open', () => {
  const open = normalizeNote({ from: 'a', subject: 'b', note: 'Keep this', account: 'ostroff' });
  assert.equal(open.processed, false);
  assert.equal(isNoteOpen(open), true);
  const done = normalizeNote({
    from: 'a',
    subject: 'b',
    note: 'This one in Vercel.',
    account: 'pixelocity',
    processed: true,
    processedAt: '2026-08-30T21:00:00.000Z',
    processedBy: 'cliff',
  });
  assert.equal(done.processed, true);
  assert.equal(done.processedBy, 'cliff');
  assert.equal(isNoteProcessed(done), true);
  assert.equal(isNoteOpen(done), false);
  const flagged = normalizeNote({ from: 'a', note: 'x', status: 'applied' });
  assert.equal(isNoteProcessed(flagged), true);
});

test('filterNotes and notesFilterStatus support open vs all', () => {
  const open = normalizeNote({ id: 'n1', from: 'a', note: 'open', account: 'ostroff' });
  const done = normalizeNote({
    id: 'n2', from: 'b', note: 'done', account: 'pixelocity', processed: true,
  });
  assert.equal(notesFilterStatus({}), 'all');
  assert.equal(notesFilterStatus({ status: 'open' }), 'open');
  assert.equal(notesFilterStatus({ open: '1' }), 'open');
  const all = filterNotes([open, done], { status: 'all' });
  assert.equal(all.length, 2);
  const pending = filterNotes([open, done], { status: 'open' });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, 'n1');
  const pixel = filterNotes([open, done], { status: 'all', account: 'pixelocity' });
  assert.equal(pixel.length, 1);
  assert.equal(pixel[0].id, 'n2');
});

test('mergeNoteLists keeps processed updates and mergeMailWithNotes still attaches them', () => {
  const open = normalizeNote({
    id: 'n1',
    account: 'pixelocity',
    from: 'Vercel',
    subject: 'Deploy',
    date: 'Sun, 30 Aug 2026 14:02:00 -0700',
    note: 'This one in Vercel.',
  });
  const processed = { ...open, processed: true, processedAt: '2026-08-30T21:00:00.000Z', processedBy: 'cliff' };
  const merged = mergeNoteLists([open], [processed]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].processed, true);
  assert.equal(merged[0].note, 'This one in Vercel.');
  const mail = mergeMailWithNotes({
    rows: [{
      account: 'pixelocity',
      from: 'Vercel',
      subject: 'Deploy',
      date: 'Sun, 30 Aug 2026 14:02:00 -0700',
      action: 'archive',
    }],
    corrs: [],
    boxes: [],
  }, merged);
  assert.equal(mail.rows[0].notes[0].processed, true);
  assert.equal(mail.rows[0].notes[0].note, 'This one in Vercel.');
});

test('markNotesProcessed writes processed without deleting the note text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mail-processed-'));
  const restore = withNoteEnv(dir, {
    BLOB_READ_WRITE_TOKEN: '',
    VERCEL: '',
  });
  try {
    const first = await appendNote({
      account: 'pixelocity',
      from: 'Vercel',
      subject: 'Deploy',
      date: 'Sun, 30 Aug 2026 14:02:00 -0700',
      action: 'archive',
      note: 'This one in Vercel.',
    }, { by: 'nick', at: '2026-08-30T19:00:00.000Z' });
    assert.equal(first.note.processed, false);

    const marked = await markNotesProcessed(
      { id: first.note.id, processed: true },
      { by: 'cliff', at: '2026-08-30T21:00:00.000Z' },
    );
    assert.equal(marked.note.processed, true);
    assert.equal(marked.note.note, 'This one in Vercel.');
    assert.equal(marked.note.processedBy, 'cliff');
    assert.equal(filterNotes(marked.notes, { status: 'open' }).length, 0);

    const json = JSON.parse(await readFile(process.env.MAIL_NOTES_FILE, 'utf8'));
    assert.equal(json.notes[0].processed, true);
    assert.match(json.notes[0].note, /Vercel/);
    const csv = await readFile(process.env.MAIL_NOTES_CSV, 'utf8');
    assert.match(csv, /processed/);
    assert.match(csv, /This one in Vercel/);

    const missing = await markNotesProcessed({ id: 'n_missing', processed: true });
    assert.equal(missing.status, 404);
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('GET /api/mail-notes filters open vs all and POST processed=true clears the note', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mail-api-processed-'));
  const prev = {
    MAIL_NOTES_FILE: process.env.MAIL_NOTES_FILE,
    MAIL_NOTES_CSV: process.env.MAIL_NOTES_CSV,
    MAIL_NOTES_JSON: process.env.MAIL_NOTES_JSON,
    VERCEL: process.env.VERCEL,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
  };
  process.env.MAIL_NOTES_FILE = join(dir, 'filing-corrections.json');
  process.env.MAIL_NOTES_CSV = join(dir, 'filing-corrections.csv');
  process.env.MAIL_NOTES_JSON = '';
  delete process.env.VERCEL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const { default: notesHandler } = await import('../api/mail-notes.js');
    const postRes = mockRes();
    await notesHandler({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: {
        account: 'ostroff',
        from: 'Westside Golf Collective',
        subject: 'Welcome',
        date: 'Mon, 3 Aug 2026 16:37:00 -0700',
        action: 'archive',
        note: 'Cliff archive -> Nick keep.',
      },
    }, postRes);
    assert.equal(postRes.statusCode, 201);
    const saved = JSON.parse(postRes.body);
    assert.equal(saved.note.processed, false);

    const getAll = mockRes();
    await notesHandler({ method: 'GET', headers: {}, query: {} }, getAll);
    const allBody = JSON.parse(getAll.body);
    assert.equal(allBody.status, 'all');
    assert.equal(allBody.notes.length, 1);

    const getOpen = mockRes();
    await notesHandler({ method: 'GET', headers: {}, query: { status: 'open' } }, getOpen);
    assert.equal(JSON.parse(getOpen.body).notes.length, 1);

    const clearRes = mockRes();
    await notesHandler({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { id: saved.note.id, processed: true },
    }, clearRes);
    assert.equal(clearRes.statusCode, 200);
    const cleared = JSON.parse(clearRes.body);
    assert.equal(cleared.note.processed, true);
    assert.equal(cleared.note.note, 'Cliff archive -> Nick keep.');

    const getOpenAfter = mockRes();
    await notesHandler({ method: 'GET', headers: {}, query: { status: 'open' } }, getOpenAfter);
    assert.equal(JSON.parse(getOpenAfter.body).notes.length, 0);

    const getAllAfter = mockRes();
    await notesHandler({ method: 'GET', headers: {}, query: { status: 'all' } }, getAllAfter);
    assert.equal(JSON.parse(getAllAfter.body).notes.length, 1);
    assert.equal(JSON.parse(getAllAfter.body).notes[0].processed, true);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
