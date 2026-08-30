import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPayload,
  decodeMailEnv,
  encodeMailEnv,
  ENV_GZIP_PREFIX,
  ENV_VALUE_MAX,
  parseCsv,
  recordToRow,
  rowKey,
  rowsFromBox,
  sortByArrival,
  splitLabels,
  toCsv,
} from './mail-log.js';
import handler from '../api/morning-mail.js';

const ostroffCsv = `date,from,subject,action,rule,labels
"Fri, 29 Aug 2026 10:00:00 -0700",later@example.com,Newer keep,keep,family,inbox
Thu, 28 Aug 2026 09:00:00 -0700,first@example.com,Older archive,archive,promo,
`;

const pixelCsv = `Date,from,subject,action,rule
"Sat, 30 Aug 2026 08:00:00 -0700",z@example.com,Pixel late,keep,client
"Thu, 28 Aug 2026 08:00:00 -0700",a@example.com,Pixel early,archive,noise
`;

test('parseCsv keeps rule and quoted commas', () => {
  const { records } = parseCsv('from,subject,rule\n"Ann, MD",Hello,family-keep\n');
  assert.equal(records.length, 1);
  assert.equal(records[0].from, 'Ann, MD');
  assert.equal(records[0].rule, 'family-keep');
});

test('per-box rows sort by Gmail Date, oldest first', () => {
  const { rows } = rowsFromBox(ostroffCsv, 'ostroff');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].subject, 'Older archive');
  assert.equal(rows[1].subject, 'Newer keep');
  assert.equal(rows[0].account, 'ostroff');
  assert.equal(rows[0].rule, 'promo');
  assert.equal(rows[0].key, rowKey(rows[0]));
});

test('combined rebuild merges boxes and sorts by arrival, not file order', () => {
  const ostroff = { ...rowsFromBox(ostroffCsv, 'ostroff'), account: 'ostroff', label: 'ostroff.la' };
  const pixel = { ...rowsFromBox(pixelCsv, 'pixelocity'), account: 'pixelocity', label: 'Pixelocity' };
  const payload = buildPayload([ostroff, pixel]);
  assert.equal(payload.rows.map((r) => r.subject).join('|'), 'Pixel early|Older archive|Newer keep|Pixel late');
  assert.equal(payload.boxes[0].filed, 2);
  assert.equal(payload.boxes[1].filed, 2);
  assert.equal(payload.combined.records[0].account, 'pixelocity');
});

test('combined csv rebuild includes account and rule', () => {
  const ostroff = { ...rowsFromBox(ostroffCsv, 'ostroff'), account: 'ostroff' };
  const payload = buildPayload([ostroff]);
  const csv = toCsv(payload.combined.headers, payload.combined.records);
  assert.match(csv, /rule/);
  assert.match(csv, /account/);
  assert.match(csv, /family/);
});

test('sort uses Gmail Date, not file time', () => {
  const { rows } = rowsFromBox(`date,mtime,from,subject,action,rule
"Fri, 29 Aug 2026 10:00:00 -0700",2026-08-01T00:00:00Z,later@example.com,Newer,keep,family
"Thu, 28 Aug 2026 09:00:00 -0700",2026-08-31T00:00:00Z,first@example.com,Older,archive,promo
`, 'ostroff');
  assert.equal(rows.map((r) => r.subject).join('|'), 'Older|Newer');
  assert.match(rows[0].date, /28 Aug/);
});

test('sortByArrival puts undated rows last', () => {
  const sorted = sortByArrival([
    { date: '', subject: 'none' },
    { date: 'Thu, 28 Aug 2026 09:00:00 -0700', subject: 'old' },
  ]);
  assert.equal(sorted[0].subject, 'old');
});

test('recordToRow copies Gmail labels, not the filer rule id', () => {
  const row = recordToRow({
    date: 'Sun, 30 Aug 2026 11:15:00 -0700',
    from: 'Los Angeles Apparel <noreply@losangelesapparel.net>',
    subject: 'Back to School',
    action: 'archive',
    rule: 'archive:default-promo',
    labels: '4. Notifications/Promo',
  }, 'ostroff');
  assert.equal(row.labels, '4. Notifications/Promo');
  assert.equal(row.rule, 'archive:default-promo');
  assert.notEqual(row.labels, row.rule);
});

test('splitLabels keeps pipe-joined Gmail labels', () => {
  assert.deepEqual(
    splitLabels('4. Notifications/Promo|3. Services/DoorDash'),
    ['4. Notifications/Promo', '3. Services/DoorDash'],
  );
  assert.deepEqual(splitLabels(''), []);
});

test('rowsFromBox keeps labels on each row', () => {
  const { rows } = rowsFromBox(ostroffCsv, 'ostroff');
  assert.equal(rows[1].labels, 'inbox');
  assert.equal(rows[0].labels, '');
});

test('decodeMailEnv accepts raw JSON and gzip+base64', () => {
  const payload = {
    rows: [{
      account: 'ostroff',
      from: 'DoorDash <noreply@doordash.com>',
      subject: 'Your order',
      action: 'archive',
      rule: 'archive:receipt:doordash',
      labels: '3. Services/DoorDash',
    }],
    corrs: [],
    boxes: [],
  };
  const raw = JSON.stringify(payload);
  assert.equal(decodeMailEnv(raw), raw);
  const gz = encodeMailEnv(payload, { force: true });
  assert.equal(gz.compressed, true);
  assert.ok(gz.value.startsWith(ENV_GZIP_PREFIX));
  assert.deepEqual(JSON.parse(decodeMailEnv(gz.value)), payload);
});

test('encodeMailEnv gzips when the JSON exceeds the 64KB env cap', () => {
  const rows = Array.from({ length: 400 }, (_, i) => ({
    account: 'ostroff',
    from: `Sender ${i} <promo${i}@example.com>`,
    subject: `Promo ${i} with a longer subject line for size`,
    action: 'archive',
    rule: 'archive:default-promo',
    labels: '4. Notifications/Promo',
    date: `Sun, 30 Aug 2026 11:${String(i % 60).padStart(2, '0')}:00 -0700`,
  }));
  const json = JSON.stringify({ rows, corrs: [], boxes: [] });
  assert.ok(Buffer.byteLength(json, 'utf8') > ENV_VALUE_MAX);
  const encoded = encodeMailEnv(json);
  assert.equal(encoded.compressed, true);
  assert.ok(encoded.encodedBytes < ENV_VALUE_MAX);
  const decoded = JSON.parse(decodeMailEnv(encoded.value));
  assert.equal(decoded.rows[0].labels, '4. Notifications/Promo');
  assert.equal(decoded.rows.length, 400);
});

test('/api/morning-mail decompresses gz env and keeps labels', async () => {
  const payload = {
    rows: [{
      account: 'ostroff',
      from: 'Los Angeles Apparel <noreply@losangelesapparel.net>',
      subject: 'Back to School',
      action: 'archive',
      rule: 'archive:default-promo',
      labels: '4. Notifications/Promo',
      date: 'Sun, 30 Aug 2026 11:15:00 -0700',
    }],
    corrs: [],
    boxes: [],
  };
  const prev = process.env.MORNING_MAIL_JSON;
  process.env.MORNING_MAIL_JSON = encodeMailEnv(payload, { force: true }).value;
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b == null ? '' : String(b); },
  };
  try {
    await handler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.rows[0].labels, '4. Notifications/Promo');
    assert.equal(body.rows[0].rule, 'archive:default-promo');
  } finally {
    if (prev == null) delete process.env.MORNING_MAIL_JSON;
    else process.env.MORNING_MAIL_JSON = prev;
  }
});
