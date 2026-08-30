import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rowKey } from './mail-log.js';
import {
  appendNote,
  buildNote,
  mergeMailWithNotes,
  mergeNoteLists,
  notesForRow,
  notesFromCsv,
  normalizeNote,
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
  process.env.MAIL_NOTES_FILE = join(dir, 'filing-corrections.json');
  process.env.MAIL_NOTES_CSV = join(dir, 'filing-corrections.csv');
  process.env.MAIL_NOTES_JSON = '';
  delete process.env.VERCEL;
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
  };
  process.env.MAIL_NOTES_FILE = join(dir, 'filing-corrections.json');
  process.env.MAIL_NOTES_CSV = join(dir, 'filing-corrections.csv');
  process.env.MAIL_NOTES_JSON = '';
  delete process.env.VERCEL;
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
