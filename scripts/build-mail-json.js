#!/usr/bin/env node
// Rebuild MORNING_MAIL_JSON from per-box filing CSVs. Do not commit the CSVs
// or the JSON. Combined filing-log.csv is a rebuild, oldest Gmail Date first.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPayload,
  defaultLogDir,
  encodeMailEnv,
  ENV_VALUE_MAX,
  loadBoxesFromDir,
  publicPayload,
  writeCombinedCsv,
} from '../lib/mail-log.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = defaultLogDir();

const boxes = await loadBoxesFromDir(dir);
const payload = buildPayload(boxes);
const pub = publicPayload(payload);
const json = `${JSON.stringify(pub)}\n`;

await writeCombinedCsv(dir, payload);
await mkdir(join(root, '.data'), { recursive: true });
const local = join(root, '.data', 'morning-mail.json');
await writeFile(local, json, 'utf8');

// Keep labels on every row. Vercel Hobby is 64KB across all env vars; raw
// JSON already overflowed around 58KB before labels. Always write a gzip
// + base64 env value. /api/morning-mail decompresses before serving.
const encoded = encodeMailEnv(json.trim(), { force: true });
const envFile = join(root, '.data', 'morning-mail.env');
await writeFile(envFile, encoded.value, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
const counts = payload.boxes.map((b) => `${b.account} ${b.filed}`).join(', ');
const labeled = payload.rows.filter((r) => r.labels).length;
console.log(`wrote ${payload.rows.length} rows (${counts}); ${labeled} with labels`);
console.log(`combined: ${join(dir, 'filing-log.csv')}`);
console.log(`local:    ${local} (${kb(encoded.bytes)})`);
console.log(`env:      ${envFile} (${kb(encoded.encodedBytes)} gzip+base64 — paste into MORNING_MAIL_JSON)`);
if (encoded.encodedBytes > ENV_VALUE_MAX) {
  console.log(`warning: compressed env is ${kb(encoded.encodedBytes)}, over the 64KB cap`);
}
console.log('Set Vercel secret MORNING_MAIL_JSON from the env file. Do not commit it.');
