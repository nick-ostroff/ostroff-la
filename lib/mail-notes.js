// Filing-feedback notes for the Bots mail log.
// Same shape as the existing CORRECTION / filing-corrections.csv rows.
// Persist outside git: .data locally, official @vercel/blob on Vercel.
// Do not commit notes, mail bodies, or passwords.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, rowKey, toCsv } from './mail-log.js';

const root = fileURLToPath(new URL('..', import.meta.url));

export const NOTE_MAX = 4000;
export const CSV_HEADERS = [
  'id', 'account', 'date', 'from', 'subject', 'action', 'rule', 'labels',
  'cliff', 'nick', 'note', 'by', 'at',
  'processed', 'processedAt', 'processedBy',
];

export function notesJsonFile() {
  return process.env.MAIL_NOTES_FILE || join(root, '.data', 'filing-corrections.json');
}

export function notesCsvFile() {
  return process.env.MAIL_NOTES_CSV || join(root, '.data', 'filing-corrections.csv');
}

export function cliffCsvFile() {
  return process.env.FILING_CORRECTIONS_CSV
    || join(root, 'gmail-batch', 'logs', 'filing-corrections.csv');
}

function parseJsonNotes(raw) {
  if (!raw || !String(raw).trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.notes || parsed.corrs || [];
    return list.map(normalizeNote).filter(Boolean);
  } catch {
    return [];
  }
}

export function isNoteProcessed(note) {
  if (!note || typeof note !== 'object') return false;
  const flag = note.processed ?? note.cleared ?? note.applied;
  if (flag === true || flag === 1 || flag === '1') return true;
  if (typeof flag === 'string' && /^(true|yes|processed|cleared|applied)$/i.test(flag.trim())) {
    return true;
  }
  const status = String(note.status || '').toLowerCase();
  return status === 'processed' || status === 'cleared' || status === 'applied';
}

export function isNoteOpen(note) {
  if (!note || !String(note.note || '').trim()) return false;
  return !isNoteProcessed(note);
}

export function notesFilterStatus(query = {}) {
  const raw = String(query.status || query.filter || '').trim().toLowerCase();
  const openFlag = query.open === '1' || query.open === true || query.open === 'true';
  if (raw === 'open' || raw === 'uncleared' || raw === 'pending' || openFlag) return 'open';
  return 'all';
}

export function filterNotes(notes, query = {}) {
  const status = notesFilterStatus(query);
  const account = String(query.account || '').trim().toLowerCase();
  let list = notes || [];
  if (status === 'open') list = list.filter(isNoteOpen);
  if (account) {
    list = list.filter((n) => String(n.account || '').toLowerCase() === account);
  }
  return list;
}

export function normalizeNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const note = String(raw.note || raw.correction || raw.corr || '').trim();
  if (!note) return null;
  const account = String(raw.account || '').trim();
  const from = String(raw.from || raw.sender || '').trim();
  const subject = String(raw.subject || '').trim();
  const date = String(raw.date || '').trim();
  const action = String(raw.action || '').trim().toLowerCase();
  const row = { account, date, from, subject };
  const id = String(raw.id || '').trim();
  const processed = isNoteProcessed(raw);
  return {
    id,
    account,
    date,
    from,
    subject,
    action: action === 'kept' ? 'keep' : action === 'archived' ? 'archive' : action,
    rule: String(raw.rule || '').trim(),
    labels: String(raw.labels || '').trim(),
    cliff: String(raw.cliff || raw.action || '').trim(),
    nick: String(raw.nick || '').trim(),
    note: note.slice(0, NOTE_MAX),
    by: String(raw.by || 'nick').trim() || 'nick',
    at: String(raw.at || '').trim(),
    processed,
    processedAt: String(raw.processedAt || raw.processed_at || '').trim(),
    processedBy: String(raw.processedBy || raw.processed_by || '').trim(),
    key: String(raw.key || '').trim() || rowKey(row),
  };
}

export function notesFromCsv(text) {
  const { records } = parseCsv(text);
  return records.map(normalizeNote).filter(Boolean);
}

function assignIds(notes) {
  return notes.map((n, i) => {
    if (n.id) return n;
    const fallback = `n_${(n.at || i).toString().replace(/\W/g, '')}_${i}`;
    return { ...n, id: fallback };
  });
}

export function mergeNoteLists(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const n of assignIds(list || [])) {
      map.set(n.id, n);
    }
  }
  return [...map.values()].sort((a, b) => {
    const ta = String(a.at || '');
    const tb = String(b.at || '');
    if (ta !== tb) return ta.localeCompare(tb);
    return String(a.id).localeCompare(String(b.id));
  });
}

export function notesForRow(notes, row) {
  const k = row?.key || rowKey(row || {});
  const exact = (notes || []).filter((n) => (n.key || rowKey(n)) === k);
  if (exact.length) return exact;
  return (notes || []).filter((n) => {
    if (n.date) return false;
    if (n.from && n.from !== row.from) return false;
    if (n.subject && n.subject !== row.subject) return false;
    if (n.account && row.account && n.account !== row.account) return false;
    return !!(n.from || n.subject);
  });
}

export function mergeMailWithNotes(payload, notes) {
  const list = notes || [];
  const rows = (payload.rows || []).map((r) => {
    const key = r.key || rowKey(r);
    return { ...r, key, notes: notesForRow(list, { ...r, key }) };
  });
  return {
    rows,
    corrs: payload.corrs || [],
    boxes: payload.boxes || [],
    notes: list,
  };
}

export function noteToCorr(note) {
  return {
    from: note.from,
    subject: note.subject,
    cliff: note.cliff || note.action || '',
    nick: note.nick || '',
    note: note.note,
    account: note.account,
    date: note.date,
    by: note.by,
    at: note.at,
    id: note.id,
  };
}

async function readText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

export function blobPathname() {
  return process.env.MAIL_NOTES_BLOB || 'filing-corrections.json';
}

export function blobToken() {
  return String(process.env.BLOB_READ_WRITE_TOKEN || '').trim();
}

export function blobConfigured() {
  return Boolean(blobToken());
}

function blobAuth(extra = {}) {
  const token = blobToken();
  return token ? { token, ...extra } : extra;
}

async function blobSdk() {
  return import('@vercel/blob');
}

export async function readBlobNotes(client) {
  if (!client && !blobConfigured()) return [];
  const { get } = client || await blobSdk();
  try {
    const result = await get(blobPathname(), {
      access: 'private',
      useCache: false,
      ...blobAuth(),
    });
    if (!result || result.statusCode !== 200 || !result.stream) return [];
    return parseJsonNotes(await new Response(result.stream).text());
  } catch {
    return [];
  }
}

export async function writeBlobNotes(notes, client) {
  if (!client && !blobConfigured()) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not set');
  }
  const { put } = client || await blobSdk();
  await put(blobPathname(), `${JSON.stringify({ notes }, null, 2)}\n`, {
    access: 'private',
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json',
    ...blobAuth(),
  });
  return true;
}

export async function loadNotes(opts = {}) {
  const fromEnv = parseJsonNotes(
    process.env.MAIL_NOTES_JSON || process.env.FILING_CORRECTIONS_JSON || '',
  );
  const fromJson = parseJsonNotes(await readText(notesJsonFile()));
  const fromCsv = notesFromCsv(await readText(notesCsvFile()));
  const fromCliff = notesFromCsv(await readText(cliffCsvFile()));
  const fromBlob = await readBlobNotes(opts.blob);
  return mergeNoteLists(fromEnv, fromCliff, fromCsv, fromJson, fromBlob);
}

async function writeLocalNotes(notes) {
  if (process.env.VERCEL) return false;
  const jsonPath = notesJsonFile();
  const csvPath = notesCsvFile();
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify({ notes }, null, 2)}\n`, 'utf8');
  await mkdir(dirname(csvPath), { recursive: true });
  const records = notes.map((n) => ({
    id: n.id,
    account: n.account,
    date: n.date,
    from: n.from,
    subject: n.subject,
    action: n.action,
    rule: n.rule,
    labels: n.labels,
    cliff: n.cliff,
    nick: n.nick,
    note: n.note,
    by: n.by,
    at: n.at,
    processed: n.processed ? 'true' : '',
    processedAt: n.processedAt || '',
    processedBy: n.processedBy || '',
  }));
  await writeFile(csvPath, toCsv(CSV_HEADERS, records), 'utf8');
  return true;
}

export function envSnippet(notes) {
  return JSON.stringify({ notes });
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `n_${crypto.randomUUID()}`;
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildNote(input, { by = 'nick', at } = {}) {
  const note = String(input.note || '').trim();
  if (!note) return { error: 'note is required', status: 400 };
  if (note.length > NOTE_MAX) return { error: `note must be ${NOTE_MAX} characters or fewer`, status: 400 };
  const account = String(input.account || '').trim();
  const from = String(input.from || '').trim();
  const subject = String(input.subject || '').trim();
  const date = String(input.date || '').trim();
  if (!account && !from && !subject && !date) {
    return { error: 'row identity is required', status: 400 };
  }
  const action = String(input.action || '').trim().toLowerCase();
  const row = { account, date, from, subject };
  const built = normalizeNote({
    id: newId(),
    account,
    date,
    from,
    subject,
    action,
    rule: input.rule,
    labels: input.labels,
    cliff: input.cliff || action,
    nick: input.nick,
    note,
    by,
    at: at || new Date().toISOString(),
    processed: false,
    processedAt: '',
    processedBy: '',
    key: input.key || rowKey(row),
  });
  return { note: built };
}

export async function saveNotes(notes, opts = {}) {
  const snippet = envSnippet(notes);
  const useBlob = Boolean(opts.blob || blobConfigured());

  if (useBlob) {
    try {
      await writeBlobNotes(notes, opts.blob);
    } catch (err) {
      return {
        error: `Could not save notes to Blob: ${err.message || err}`,
        status: 502,
        envSnippet: snippet,
      };
    }
    if (!process.env.VERCEL) {
      try { await writeLocalNotes(notes); } catch { /* local copy is extra */ }
    }
    return { persisted: 'blob', envSnippet: snippet };
  }

  if (process.env.VERCEL) {
    return {
      error: 'Notes cannot persist: BLOB_READ_WRITE_TOKEN is not set',
      status: 503,
      envSnippet: snippet,
    };
  }

  try {
    const local = await writeLocalNotes(notes);
    if (!local) {
      return { error: 'Could not persist notes to local file', status: 500, envSnippet: snippet };
    }
  } catch (err) {
    return { error: `Could not persist notes: ${err.message || err}`, status: 500, envSnippet: snippet };
  }
  return { persisted: 'file', envSnippet: snippet };
}

export async function appendNote(input, meta = {}) {
  const built = buildNote(input, meta);
  if (built.error) return built;
  const notes = mergeNoteLists(await loadNotes(meta), [built.note]);
  const saved = await saveNotes(notes, meta);
  if (saved.error) return saved;
  return { note: built.note, notes, ...saved };
}

export function wantsProcessed(input) {
  const flag = input?.processed ?? input?.cleared ?? input?.applied;
  return flag === true || flag === 1 || flag === '1'
    || (typeof flag === 'string' && /^(true|yes|processed|cleared|applied)$/i.test(flag.trim()));
}

export async function markNotesProcessed(input, meta = {}) {
  const id = String(input?.id || input?.noteId || '').trim();
  const key = String(input?.key || '').trim();
  if (!id && !key) return { error: 'id or key is required', status: 400 };
  const notes = await loadNotes(meta);
  const at = meta.at || new Date().toISOString();
  const by = String(meta.by || 'cliff').trim() || 'cliff';
  let matched = 0;
  const next = notes.map((n) => {
    const hit = key
      ? (n.key === key && isNoteOpen(n))
      : n.id === id;
    if (!hit) return n;
    matched += 1;
    if (isNoteProcessed(n)) return n;
    return { ...n, processed: true, processedAt: at, processedBy: by };
  });
  if (!matched) return { error: 'note not found', status: 404 };
  const saved = await saveNotes(next, meta);
  if (saved.error) return saved;
  const note = id
    ? next.find((n) => n.id === id)
    : next.filter((n) => n.key === key).find((n) => n.processed) || next.find((n) => n.key === key);
  return { note, notes: next, ...saved };
}

export async function notifyWebhook(note) {
  const url = String(process.env.MAIL_NOTES_WEBHOOK_URL || '').trim();
  if (!url) return { sent: false, reason: 'webhook not configured' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(note),
    });
    if (!res.ok) return { sent: false, reason: `webhook ${res.status}` };
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: String(err.message || err) };
  }
}

export async function notifyAgentMail(note) {
  const key = process.env.AGENTMAIL_API_KEY || '';
  const inbox = process.env.AGENTMAIL_INBOX_ID || '';
  const to = process.env.AGENTMAIL_NOTIFY_TO || 'nick.ostroff@agentmail.to';
  if (!key || !inbox) return { sent: false, reason: 'agentmail not configured' };
  const label = note.account === 'pixelocity' ? 'Pixelocity' : (note.account || 'mail');
  const subject = `Mail log note: ${note.from || '(no sender)'}`.slice(0, 180);
  const text = [
    `${note.by || 'nick'} left a filing note.`,
    '',
    `Inbox: ${label}`,
    `From: ${note.from || ''}`,
    `Subject: ${note.subject || ''}`,
    `Cliff filed: ${note.action || note.cliff || ''}`,
    `Rule: ${note.rule || ''}`,
    `When: ${note.date || ''}`,
    '',
    note.note,
    '',
    `Saved ${note.at || ''} · id ${note.id || ''}`,
  ].join('\n');
  try {
    const res = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: [to], subject, text }),
    });
    if (!res.ok) return { sent: false, reason: `agentmail ${res.status}` };
    return { sent: true, to };
  } catch (err) {
    return { sent: false, reason: String(err.message || err) };
  }
}
