#!/usr/bin/env node
// Build the mail-log payload for private Vercel Blob (mail-log.json).
// Reads the per-box filing CSVs read-only (never rewrites them) and keeps
// the last MAIL_LOG_DAYS days (default 30; keeps the response well under Vercel's 4.5MB cap) by Gmail Date.
// Usage: node scripts/build-mail-blob.js <out.json>
import { writeFile } from 'node:fs/promises';
import { defaultLogDir, loadBoxesFromDir, windowPayload } from '../lib/mail-log.js';

const out = process.argv[2];
if (!out) { console.error('usage: build-mail-blob.js <out.json>'); process.exit(2); }
const days = Number(process.env.MAIL_LOG_DAYS || 30);
const boxes = await loadBoxesFromDir(defaultLogDir());
const pub = windowPayload(boxes, { days });
await writeFile(out, `${JSON.stringify(pub)}\n`, 'utf8');
const newest = pub.rows.length ? pub.rows[pub.rows.length - 1].date : '';
console.log(`rows ${pub.rows.length} (${pub.boxes.map((b) => `${b.account} ${b.filed}`).join(', ')}); last ${days}d; newest ${newest}`);
