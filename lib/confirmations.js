// Binding confirm-gate for Cliff. Approvals live on ostroff.la (private
// Blob / .data), not Gmail. Cap/Nick approve; Cliff consumes a fresh id.
// Do not commit confirmation payloads.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export const CONFIRM_STATUSES = ['pending', 'approved', 'denied', 'expired', 'consumed'];
export const CONFIRM_KINDS = ['send_email', 'todoist_create', 'payment'];
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const SUMMARY_MAX = 2000;
export const DETAIL_MAX = 2000;
export const PAYLOAD_MAX = 32_000;

export function confirmationsFile() {
  return process.env.CONFIRMATIONS_FILE || join(root, '.data', 'bot-confirmations.json');
}

export function blobPathname() {
  return process.env.CONFIRMATIONS_BLOB || 'bot-confirmations.json';
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

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `c_${crypto.randomUUID()}`;
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parsePayload(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : { value: parsed };
    } catch {
      return { value: raw };
    }
  }
  if (typeof raw === 'object') return raw;
  return { value: raw };
}

export function normalizeConfirmation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const kind = String(raw.kind || raw.action || '').trim();
  const summary = String(raw.summary || '').trim();
  if (!kind && !summary) return null;
  let status = String(raw.status || 'pending').trim().toLowerCase();
  if (!CONFIRM_STATUSES.includes(status)) status = 'pending';
  return {
    id,
    status,
    kind,
    action: String(raw.action || kind).trim(),
    summary: summary.slice(0, SUMMARY_MAX),
    payload: parsePayload(raw.payload),
    requested_by: String(raw.requested_by || '').trim(),
    requested_at: String(raw.requested_at || '').trim(),
    expires_at: String(raw.expires_at || '').trim(),
    decided_by: String(raw.decided_by || '').trim(),
    decided_at: String(raw.decided_at || '').trim(),
    consumed_at: String(raw.consumed_at || '').trim(),
    detail: String(raw.detail || '').trim().slice(0, DETAIL_MAX),
  };
}

export function applyExpiry(item, now = Date.now()) {
  const confirmation = normalizeConfirmation(item);
  if (!confirmation) return null;
  if (
    (confirmation.status === 'pending' || confirmation.status === 'approved')
    && confirmation.expires_at
  ) {
    const exp = Date.parse(confirmation.expires_at);
    if (Number.isFinite(exp) && exp <= now) {
      return { ...confirmation, status: 'expired' };
    }
  }
  return confirmation;
}

function parseJsonConfirmations(raw) {
  if (!raw || !String(raw).trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.confirmations || [];
    return list.map((item) => applyExpiry(item)).filter(Boolean);
  } catch {
    return [];
  }
}

export function mergeConfirmations(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const item of list || []) {
      const confirmation = applyExpiry(item);
      if (confirmation) map.set(confirmation.id, confirmation);
    }
  }
  return [...map.values()].sort((a, b) => {
    const ta = String(a.requested_at || '');
    const tb = String(b.requested_at || '');
    if (ta !== tb) return ta.localeCompare(tb);
    return String(a.id).localeCompare(String(b.id));
  });
}

export function filterConfirmations(list, status) {
  const want = String(status || '').trim().toLowerCase();
  if (!want || want === 'all') return list || [];
  return (list || []).filter((item) => item.status === want);
}

async function readText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

export async function readBlobConfirmations(client) {
  if (!client && !blobConfigured()) return [];
  const { get } = client || await blobSdk();
  try {
    const result = await get(blobPathname(), {
      access: 'private',
      useCache: false,
      ...blobAuth(),
    });
    if (!result || result.statusCode !== 200 || !result.stream) return [];
    return parseJsonConfirmations(await new Response(result.stream).text());
  } catch {
    return [];
  }
}

export async function writeBlobConfirmations(confirmations, client) {
  if (!client && !blobConfigured()) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not set');
  }
  const { put } = client || await blobSdk();
  await put(blobPathname(), `${JSON.stringify({ confirmations }, null, 2)}\n`, {
    access: 'private',
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json',
    ...blobAuth(),
  });
  return true;
}

export async function loadConfirmations(opts = {}) {
  const fromJson = parseJsonConfirmations(await readText(confirmationsFile()));
  const fromBlob = await readBlobConfirmations(opts.blob);
  return mergeConfirmations(fromJson, fromBlob);
}

async function writeLocalConfirmations(confirmations) {
  if (process.env.VERCEL) return false;
  const path = confirmationsFile();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ confirmations }, null, 2)}\n`, 'utf8');
  return true;
}

export async function saveConfirmations(confirmations, opts = {}) {
  const useBlob = Boolean(opts.blob || blobConfigured());

  if (useBlob) {
    try {
      await writeBlobConfirmations(confirmations, opts.blob);
    } catch (err) {
      return {
        error: `Could not save confirmations to Blob: ${err.message || err}`,
        status: 502,
      };
    }
    if (!process.env.VERCEL) {
      try { await writeLocalConfirmations(confirmations); } catch { /* local copy is extra */ }
    }
    return { persisted: 'blob' };
  }

  if (process.env.VERCEL) {
    return {
      error: 'Confirmations cannot persist: BLOB_READ_WRITE_TOKEN is not set',
      status: 503,
    };
  }

  try {
    const local = await writeLocalConfirmations(confirmations);
    if (!local) {
      return { error: 'Could not persist confirmations to local file', status: 500 };
    }
  } catch (err) {
    return { error: `Could not persist confirmations: ${err.message || err}`, status: 500 };
  }
  return { persisted: 'file' };
}

export function buildConfirmation(input, { by = 'feed', at } = {}) {
  const kind = String(input?.kind || input?.action || '').trim();
  const summary = String(input?.summary || '').trim();
  if (!kind) return { error: 'kind is required', status: 400 };
  if (!summary) return { error: 'summary is required', status: 400 };
  if (summary.length > SUMMARY_MAX) {
    return { error: `summary must be ${SUMMARY_MAX} characters or fewer`, status: 400 };
  }
  const payload = parsePayload(input.payload);
  if (JSON.stringify(payload).length > PAYLOAD_MAX) {
    return { error: 'payload is too large', status: 400 };
  }
  const requestedAt = at || new Date().toISOString();
  let expiresAt = String(input.expires_at || '').trim();
  if (expiresAt) {
    const exp = Date.parse(expiresAt);
    if (!Number.isFinite(exp)) return { error: 'expires_at must be an ISO timestamp', status: 400 };
  } else {
    expiresAt = new Date(Date.parse(requestedAt) + DEFAULT_TTL_MS).toISOString();
  }
  return {
    confirmation: normalizeConfirmation({
      id: newId(),
      status: 'pending',
      kind,
      action: String(input.action || kind).trim(),
      summary,
      payload,
      requested_by: String(input.requested_by || by).trim() || by,
      requested_at: requestedAt,
      expires_at: expiresAt,
    }),
  };
}

export async function createConfirmation(input, meta = {}) {
  const built = buildConfirmation(input, meta);
  if (built.error) return built;
  const confirmations = mergeConfirmations(await loadConfirmations(meta), [built.confirmation]);
  const saved = await saveConfirmations(confirmations, meta);
  if (saved.error) return saved;
  return { confirmation: built.confirmation, confirmations, ...saved };
}

export function findConfirmation(list, id) {
  const want = String(id || '').trim();
  if (!want) return null;
  return (list || []).find((item) => item.id === want) || null;
}

export async function getConfirmation(id, opts = {}) {
  const want = String(id || '').trim();
  if (!want) return { error: 'confirmation not found', status: 404 };
  const confirmation = findConfirmation(await loadConfirmations(opts), want);
  if (!confirmation) return { error: 'confirmation not found', status: 404 };
  return { confirmation };
}

function persistUpdate(existing, next, list, meta) {
  const confirmations = mergeConfirmations(list, [next]);
  return saveConfirmations(confirmations, meta).then((saved) => {
    if (saved.error) return saved;
    return { confirmation: next, confirmations, ...saved };
  });
}

export async function decideConfirmation(input, meta = {}) {
  const id = String(input?.id || '').trim();
  if (!id) return { error: 'confirmation not found', status: 404 };
  const decision = String(input.status || input.decision || '').trim().toLowerCase();
  if (decision !== 'approved' && decision !== 'denied') {
    return { error: 'status must be approved or denied', status: 400 };
  }
  const list = await loadConfirmations(meta);
  const existing = findConfirmation(list, id);
  if (!existing) return { error: 'confirmation not found', status: 404 };
  if (existing.status === 'expired') {
    return { error: 'confirmation expired', status: 409, confirmation: existing };
  }
  if (existing.status === decision) {
    return { confirmation: existing, confirmations: list, persisted: 'dedup', idempotent: true };
  }
  if (existing.status !== 'pending') {
    return { error: `cannot ${decision} a ${existing.status} confirmation`, status: 409, confirmation: existing };
  }
  const at = meta.at || new Date().toISOString();
  const next = {
    ...existing,
    status: decision,
    decided_by: meta.by || 'cap',
    decided_at: at,
    detail: input.detail != null ? String(input.detail).trim().slice(0, DETAIL_MAX) : existing.detail,
  };
  return persistUpdate(existing, next, list, meta);
}

export async function consumeConfirmation(input, meta = {}) {
  const id = String(input?.id || '').trim();
  if (!id) return { error: 'confirmation not found', status: 404 };
  const list = await loadConfirmations(meta);
  const existing = findConfirmation(list, id);
  if (!existing) return { error: 'confirmation not found', status: 404 };
  if (existing.status === 'consumed') {
    return { confirmation: existing, confirmations: list, persisted: 'dedup', idempotent: true };
  }
  if (existing.status === 'expired') {
    return { error: 'confirmation expired', status: 409, confirmation: existing };
  }
  if (existing.status !== 'approved') {
    return { error: `cannot consume a ${existing.status} confirmation`, status: 409, confirmation: existing };
  }
  const at = meta.at || new Date().toISOString();
  const next = {
    ...existing,
    status: 'consumed',
    consumed_at: at,
    detail: input.detail != null ? String(input.detail).trim().slice(0, DETAIL_MAX) : existing.detail,
  };
  return persistUpdate(existing, next, list, meta);
}

export function isConsumeBody(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.consumed === true || body.consumed === 'true') return true;
  const status = String(body.status || '').trim().toLowerCase();
  return status === 'consumed';
}

export function isDecideBody(body) {
  if (!body || typeof body !== 'object') return false;
  const status = String(body.status || body.decision || '').trim().toLowerCase();
  return status === 'approved' || status === 'denied';
}
