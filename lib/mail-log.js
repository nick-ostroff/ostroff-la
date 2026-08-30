// Build the Bots mail-log payload from per-box filing CSVs.
// Per-box files are the source of truth. Combined CSV is a rebuild.
// Do not commit CSVs or MORNING_MAIL_JSON. Sort by Gmail Date, oldest first.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export const BOXES = [
  { account: 'ostroff', file: 'filing-log-ostroff.csv', label: 'ostroff.la' },
  { account: 'pixelocity', file: 'filing-log-pixelocity.csv', label: 'Pixelocity' },
];

export function defaultLogDir() {
  return process.env.MAIL_LOG_DIR || join(root, 'gmail-batch', 'logs');
}

export function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let quoted = false;
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') { quoted = true; i += 1; continue; }
    if (c === ',') { row.push(field); field = ''; i += 1; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (quoted || field || row.length) {
    row.push(field);
    if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
  }
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => String(h || '').trim());
  const records = rows.slice(1).map((cells) => {
    const fixed = stitchGmailDate(headers, cells);
    const rec = {};
    headers.forEach((h, idx) => { rec[h] = fixed[idx] == null ? '' : String(fixed[idx]); });
    return rec;
  });
  return { headers, records };
}

const WEEKDAY = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/i;

function stitchGmailDate(headers, cells) {
  if (cells.length === headers.length) return cells;
  if (cells.length === headers.length + 1 && WEEKDAY.test(String(cells[0] || '').trim())) {
    return [`${cells[0]}, ${cells[1]}`, ...cells.slice(2)];
  }
  return cells;
}

function pick(rec, names) {
  const keys = Object.keys(rec);
  for (const name of names) {
    const hit = keys.find((k) => k.toLowerCase() === name.toLowerCase());
    if (hit && String(rec[hit]).trim()) return String(rec[hit]).trim();
  }
  return '';
}

export function parseMailDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return NaN;
  const ms = Date.parse(s);
  if (!Number.isNaN(ms)) return ms;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (m) return Date.parse(`${m[1]}T${m[2]}`);
  return NaN;
}

const DATE_PREFER = ['gmail date', 'gmail_date', 'date', 'internaldate', 'internal_date', 'received', 'when'];
const DATE_AVOID = /file|mtime|modified|ctime|written/;

export function dateField(rec) {
  const keys = Object.keys(rec || {});
  for (const name of DATE_PREFER) {
    const hit = keys.find((k) => k.toLowerCase() === name && !DATE_AVOID.test(k.toLowerCase()));
    if (hit && String(rec[hit]).trim()) return String(rec[hit]).trim();
  }
  for (const k of keys) {
    if (DATE_AVOID.test(k.toLowerCase())) continue;
    if (!/date|received|when/i.test(k)) continue;
    if (String(rec[k]).trim()) return String(rec[k]).trim();
  }
  return '';
}

export function arrivalMs(rec) {
  return parseMailDate(dateField(rec));
}

export function sortByArrival(records) {
  return [...records].sort((a, b) => {
    const da = arrivalMs(a);
    const db = arrivalMs(b);
    if (Number.isNaN(da) && Number.isNaN(db)) return 0;
    if (Number.isNaN(da)) return 1;
    if (Number.isNaN(db)) return -1;
    if (da !== db) return da - db;
    return pick(a, ['subject']).localeCompare(pick(b, ['subject']));
  });
}

function normalizeAction(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'keep' || v === 'kept' || v === 'inbox') return 'keep';
  if (v === 'archive' || v === 'archived') return 'archive';
  return v;
}

export function recordToRow(rec, account) {
  const action = normalizeAction(pick(rec, ['action', 'decision', 'status']));
  return {
    account,
    from: pick(rec, ['from', 'sender', 'from_email']),
    subject: pick(rec, ['subject', 'title']),
    action,
    rule: pick(rec, ['rule', 'matched_rule', 'reason']),
    date: dateField(rec),
    labels: pick(rec, ['labels', 'label', 'gmail_labels']),
  };
}

export function recordToCorr(rec) {
  const note = pick(rec, ['note', 'correction', 'corr']);
  const cliff = pick(rec, ['cliff']);
  const nick = pick(rec, ['nick']);
  if (!note && !cliff && !nick) return null;
  if (!note && !cliff) return null;
  return {
    from: pick(rec, ['from', 'sender']),
    subject: pick(rec, ['subject']),
    cliff: cliff || 'keep',
    nick: nick || 'keep',
    note,
  };
}

export function rowsFromBox(text, account) {
  const { headers, records } = parseCsv(text);
  const sorted = sortByArrival(records);
  const rows = sorted.map((rec) => recordToRow(rec, account));
  const corrs = sorted.map(recordToCorr).filter(Boolean);
  return { headers, records: sorted, rows, corrs };
}

function csvEscape(value) {
  const s = String(value == null ? '' : value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers, records) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const rec of records) {
    lines.push(headers.map((h) => csvEscape(rec[h] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function mergeHeaders(...headerLists) {
  const seen = new Set();
  const out = [];
  for (const list of headerLists) {
    for (const h of list) {
      if (!h || seen.has(h)) continue;
      seen.add(h);
      out.push(h);
    }
  }
  if (!seen.has('account')) out.push('account');
  return out;
}

export function buildPayload(boxes) {
  const rows = [];
  const corrs = [];
  const combinedRecords = [];
  let headers = [];
  for (const box of boxes) {
    headers = mergeHeaders(headers, box.headers || []);
    for (const rec of box.records || []) {
      combinedRecords.push({ ...rec, account: rec.account || box.account });
    }
    rows.push(...(box.rows || []));
    corrs.push(...(box.corrs || []));
  }
  const sortedRecords = sortByArrival(combinedRecords);
  const sortedRows = sortByArrival(rows);
  return {
    rows: sortedRows,
    corrs,
    boxes: boxes.map((b) => ({
      account: b.account,
      label: b.label,
      filed: (b.rows || []).length,
      keep: (b.rows || []).filter((r) => r.action === 'keep').length,
      archive: (b.rows || []).filter((r) => r.action === 'archive').length,
    })),
    combined: { headers, records: sortedRecords },
  };
}

export async function loadBoxesFromDir(dir = defaultLogDir()) {
  const boxes = [];
  for (const spec of BOXES) {
    const raw = await readFile(join(dir, spec.file), 'utf8');
    const parsed = rowsFromBox(raw, spec.account);
    boxes.push({ ...spec, ...parsed });
  }
  return boxes;
}

export async function writeCombinedCsv(dir, payload) {
  const target = join(dir, 'filing-log.csv');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, toCsv(payload.combined.headers, payload.combined.records), 'utf8');
  return target;
}

export function publicPayload(payload) {
  return {
    rows: payload.rows,
    corrs: payload.corrs,
    boxes: payload.boxes,
  };
}
