import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPayload, parseCsv, rowKey, rowsFromBox, sortByArrival, toCsv } from './mail-log.js';

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
