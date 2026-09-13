// Tesla charge snapshot for the Bots morning briefing.
// Otto writes a clipped snapshot on a schedule. The box file
// /home/box/shared/tesla-morning.json is for Cap's local brief —
// Vercel cannot read that path. Persist a copy via private @vercel/blob
// (same store as mail-notes) and .data/tesla-morning.json off-Vercel.
// Do not commit snapshots.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export function snapshotFile() {
  return process.env.TESLA_MORNING_FILE || join(root, '.data', 'tesla-morning.json');
}

export function blobPathname() {
  return process.env.TESLA_MORNING_BLOB || 'tesla-morning.json';
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

function takeString(raw, key, out) {
  if (raw[key] == null) return;
  const value = String(raw[key]).trim();
  if (value) out[key] = value;
}

function takeNumber(raw, key, out, errors) {
  if (raw[key] == null || raw[key] === '') return;
  const n = typeof raw[key] === 'number' ? raw[key] : Number(raw[key]);
  if (!Number.isFinite(n)) {
    errors.push(`${key} must be a number`);
    return;
  }
  out[key] = n;
}

function takeBool(raw, key, out, errors) {
  if (raw[key] == null || raw[key] === '') return;
  if (typeof raw[key] === 'boolean') {
    out[key] = raw[key];
    return;
  }
  if (raw[key] === 'true' || raw[key] === 1 || raw[key] === '1') {
    out[key] = true;
    return;
  }
  if (raw[key] === 'false' || raw[key] === 0 || raw[key] === '0') {
    out[key] = false;
    return;
  }
  errors.push(`${key} must be a boolean`);
}

export function composeLine(snap) {
  if (!snap || typeof snap !== 'object') return '';
  const parts = [];
  if (snap.battery_level_pct != null) parts.push(`${snap.battery_level_pct}%`);
  if (snap.battery_range_mi != null) parts.push(`${snap.battery_range_mi} mi`);
  if (snap.charge_limit_soc != null) parts.push(`limit ${snap.charge_limit_soc}%`);
  if (snap.charging_state) parts.push(snap.charging_state);
  if (snap.locked === true) parts.push('locked');
  else if (snap.locked === false) parts.push('unlocked');
  return parts.join(' · ');
}

function snapshotFields(raw) {
  const errors = [];
  const snap = {};
  takeString(raw, 'as_of_pt', snap);
  takeString(raw, 'vin_last4', snap);
  takeString(raw, 'display_name', snap);
  takeNumber(raw, 'battery_level_pct', snap, errors);
  takeNumber(raw, 'battery_range_mi', snap, errors);
  takeNumber(raw, 'charge_limit_soc', snap, errors);
  takeString(raw, 'charging_state', snap);
  takeBool(raw, 'locked', snap, errors);
  takeString(raw, 'car_version', snap);
  takeBool(raw, 'sentry_mode', snap, errors);
  takeString(raw, 'line', snap);
  return { snap, errors };
}

export function normalizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { snap, errors } = snapshotFields(raw);
  if (errors.length) return null;
  if (!snap.line) {
    const line = composeLine(snap);
    if (line) snap.line = line;
  }
  if (
    snap.line
    || snap.battery_level_pct != null
    || snap.battery_range_mi != null
    || snap.as_of_pt
    || snap.display_name
  ) {
    return snap;
  }
  return null;
}

export function validateSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'snapshot object is required', status: 400 };
  }
  const { snap, errors } = snapshotFields(raw);
  if (errors.length) return { error: errors[0], status: 400 };
  if (!snap.line) {
    const line = composeLine(snap);
    if (line) snap.line = line;
  }
  if (snap.battery_level_pct == null && !snap.line) {
    return { error: 'battery_level_pct or line is required', status: 400 };
  }
  return { snapshot: snap };
}

async function readText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

export async function readBlobSnapshot(client) {
  if (!client && !blobConfigured()) return null;
  const { get } = client || await blobSdk();
  try {
    const result = await get(blobPathname(), {
      access: 'private',
      useCache: false,
      ...blobAuth(),
    });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const parsed = JSON.parse(await new Response(result.stream).text());
    return normalizeSnapshot(parsed);
  } catch {
    return null;
  }
}

export async function writeBlobSnapshot(snapshot, client) {
  if (!client && !blobConfigured()) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not set');
  }
  const { put } = client || await blobSdk();
  await put(blobPathname(), `${JSON.stringify(snapshot, null, 2)}\n`, {
    access: 'private',
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json',
    ...blobAuth(),
  });
  return true;
}

export async function loadSnapshot(opts = {}) {
  const fromBlob = await readBlobSnapshot(opts.blob);
  if (fromBlob) return fromBlob;
  if (process.env.VERCEL) return null;
  const raw = await readText(snapshotFile());
  if (!raw.trim()) return null;
  try {
    return normalizeSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writeLocalSnapshot(snapshot) {
  if (process.env.VERCEL) return false;
  const path = snapshotFile();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return true;
}

export async function saveSnapshot(input, opts = {}) {
  const checked = validateSnapshot(input);
  if (checked.error) return checked;
  const snapshot = checked.snapshot;
  const useBlob = Boolean(opts.blob || blobConfigured());

  if (useBlob) {
    try {
      await writeBlobSnapshot(snapshot, opts.blob);
    } catch (err) {
      return {
        error: `Could not save Tesla snapshot to Blob: ${err.message || err}`,
        status: 502,
      };
    }
    if (!process.env.VERCEL) {
      try { await writeLocalSnapshot(snapshot); } catch { /* local copy is extra */ }
    }
    return { persisted: 'blob', snapshot };
  }

  if (process.env.VERCEL) {
    return {
      error: 'Tesla snapshot cannot persist: BLOB_READ_WRITE_TOKEN is not set',
      status: 503,
    };
  }

  try {
    const local = await writeLocalSnapshot(snapshot);
    if (!local) {
      return { error: 'Could not persist Tesla snapshot to local file', status: 500 };
    }
  } catch (err) {
    return { error: `Could not persist Tesla snapshot: ${err.message || err}`, status: 500 };
  }
  return { persisted: 'file', snapshot };
}
