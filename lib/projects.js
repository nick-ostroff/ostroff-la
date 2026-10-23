// Projects board snapshot. Built read-only on the box by
// /home/box/shared/projects-board/run.sh every 30 min and uploaded to the
// private Blob store as projects-snapshot.json. Vercel never sees the box,
// Todoist, GitHub or Vercel tokens. Project data is NOT committed (public repo).
// Local dev: .data/projects-snapshot.json.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const COLUMNS = ['needs', 'active', 'blocked', 'quiet'];

export function blobPathname() {
  return process.env.PROJECTS_SNAPSHOT_BLOB || 'projects-snapshot.json';
}

// Accept only the shape the board renders; drop anything unexpected.
export function normalizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.projects)) return null;
  const projects = raw.projects
    .filter((p) => p && typeof p.slug === 'string' && typeof p.name === 'string')
    .map((p) => ({ ...p, column: COLUMNS.includes(p.column) ? p.column : 'quiet',
      spark: Array.isArray(p.spark) ? p.spark.slice(-14).map((n) => Number(n) || 0) : [] }));
  const attention = Array.isArray(raw.attention)
    ? raw.attention.filter((a) => a && typeof a.text === 'string').slice(0, 20)
    : [];
  return { generated_at: raw.generated_at || null, attention, projects,
    sources: raw.sources || {}, errors: raw.errors || {} };
}

export async function loadProjects(client) {
  const token = String(process.env.BLOB_READ_WRITE_TOKEN || '').trim();
  if (client || token) {
    try {
      const { get } = client || await import('@vercel/blob');
      const r = await get(blobPathname(), { access: 'private', useCache: false, ...(token ? { token } : {}) });
      if (r && r.statusCode === 200 && r.stream) {
        return normalizeSnapshot(JSON.parse(await new Response(r.stream).text()));
      }
    } catch { /* fall through */ }
  }
  if (process.env.VERCEL) return null;
  try {
    const file = process.env.PROJECTS_SNAPSHOT_FILE || join(root, '.data', 'projects-snapshot.json');
    return normalizeSnapshot(JSON.parse(await readFile(file, 'utf8')));
  } catch { return null; }
}
