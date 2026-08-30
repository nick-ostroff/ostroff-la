#!/usr/bin/env node
// Rebuild MORNING_MAIL_JSON from per-box filing CSVs. Do not commit the CSVs
// or the JSON. Combined filing-log.csv is a rebuild, oldest Gmail Date first.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPayload, defaultLogDir, loadBoxesFromDir, publicPayload, writeCombinedCsv } from '../lib/mail-log.js';

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

const counts = payload.boxes.map((b) => `${b.account} ${b.filed}`).join(', ');
console.log(`wrote ${payload.rows.length} rows (${counts})`);
console.log(`combined: ${join(dir, 'filing-log.csv')}`);
console.log(`local:    ${local}`);
console.log('Set Vercel secret MORNING_MAIL_JSON to the local JSON. Do not commit it.');
