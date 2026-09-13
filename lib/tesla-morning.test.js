import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  composeLine,
  loadSnapshot,
  normalizeSnapshot,
  saveSnapshot,
  validateSnapshot,
} from './tesla-morning.js';

const OTTO = {
  as_of_pt: '2026-09-12 23:28',
  vin_last4: '1907',
  display_name: 'Model Y',
  battery_level_pct: 53,
  battery_range_mi: 160.9,
  charge_limit_soc: 80,
  charging_state: 'Disconnected',
  locked: true,
  car_version: '2026.26.100.1',
  sentry_mode: false,
  line: '53% · 160.9 mi · limit 80% · Disconnected · locked',
};

test('normalizeSnapshot keeps Otto fields and ignores charge_pct / range_mi', () => {
  const snap = normalizeSnapshot({
    ...OTTO,
    charge_pct: 99,
    range_mi: 1,
  });
  assert.equal(snap.battery_level_pct, 53);
  assert.equal(snap.battery_range_mi, 160.9);
  assert.equal(snap.charge_limit_soc, 80);
  assert.equal(snap.display_name, 'Model Y');
  assert.equal(snap.vin_last4, '1907');
  assert.equal(snap.car_version, '2026.26.100.1');
  assert.equal(snap.sentry_mode, false);
  assert.equal(snap.locked, true);
  assert.equal(snap.line, OTTO.line);
  assert.equal(snap.charge_pct, undefined);
  assert.equal(snap.range_mi, undefined);
});

test('composeLine builds Otto-shaped text when line is missing', () => {
  const { line, ...fields } = OTTO;
  assert.equal(composeLine(fields), line);
  const unlocked = composeLine({ ...fields, locked: false });
  assert.match(unlocked, /unlocked$/);
});

test('validateSnapshot accepts Otto schema and rejects bad types', () => {
  const ok = validateSnapshot(OTTO);
  assert.equal(ok.snapshot.battery_level_pct, 53);
  assert.equal(ok.error, undefined);

  const composed = validateSnapshot({
    battery_level_pct: 40,
    battery_range_mi: 120,
    charge_limit_soc: 80,
    charging_state: 'Charging',
    locked: false,
  });
  assert.equal(composed.snapshot.line, '40% · 120 mi · limit 80% · Charging · unlocked');

  assert.equal(validateSnapshot(null).status, 400);
  assert.equal(validateSnapshot({ battery_level_pct: 'full' }).status, 400);
  assert.equal(validateSnapshot({ locked: 'maybe' }).status, 400);
  assert.equal(validateSnapshot({ display_name: 'Model Y' }).status, 400);
});

function withSnapEnv(dir, extra = {}) {
  const prev = {
    TESLA_MORNING_FILE: process.env.TESLA_MORNING_FILE,
    TESLA_MORNING_BLOB: process.env.TESLA_MORNING_BLOB,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    VERCEL: process.env.VERCEL,
    TESLA_MORNING_FEED_TOKEN: process.env.TESLA_MORNING_FEED_TOKEN,
  };
  process.env.TESLA_MORNING_FILE = join(dir, 'tesla-morning.json');
  process.env.TESLA_MORNING_BLOB = 'tesla-morning.json';
  for (const [k, v] of Object.entries(extra)) {
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

test('saveSnapshot/loadSnapshot round-trip to a local file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tesla-file-'));
  const restore = withSnapEnv(dir, {
    BLOB_READ_WRITE_TOKEN: '',
    VERCEL: null,
  });
  try {
    const saved = await saveSnapshot(OTTO);
    assert.equal(saved.persisted, 'file');
    assert.equal(saved.snapshot.battery_level_pct, 53);

    const json = JSON.parse(await readFile(process.env.TESLA_MORNING_FILE, 'utf8'));
    assert.equal(json.display_name, 'Model Y');
    assert.equal(json.battery_range_mi, 160.9);

    const loaded = await loadSnapshot();
    assert.equal(loaded.as_of_pt, OTTO.as_of_pt);
    assert.equal(loaded.line, OTTO.line);
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

function memoryBlob() {
  const store = new Map();
  return {
    store,
    async put(pathname, body, opts) {
      assert.equal(opts.access, 'private');
      assert.equal(opts.allowOverwrite, true);
      assert.equal(opts.addRandomSuffix, false);
      store.set(pathname, String(body));
      return { pathname, url: `https://example.private.blob.vercel-storage.com/${pathname}` };
    },
    async get(pathname, opts) {
      assert.equal(opts.access, 'private');
      assert.equal(opts.useCache, false);
      const text = store.get(pathname);
      if (!text) return null;
      return {
        statusCode: 200,
        stream: new Blob([text]).stream(),
        blob: { pathname, contentType: 'application/json' },
      };
    },
  };
}

test('saveSnapshot/loadSnapshot round-trip on Blob when the token is set', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tesla-blob-'));
  const restore = withSnapEnv(dir, {
    BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test_token',
    VERCEL: '1',
  });
  const blob = memoryBlob();
  try {
    const saved = await saveSnapshot(OTTO, { blob });
    assert.equal(saved.persisted, 'blob');
    assert.ok(blob.store.has('tesla-morning.json'));

    const loaded = await loadSnapshot({ blob });
    assert.equal(loaded.vin_last4, '1907');
    assert.equal(loaded.sentry_mode, false);
    assert.equal(loaded.battery_level_pct, 53);
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

test('saveSnapshot errors on Vercel when Blob token is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tesla-blob-none-'));
  const restore = withSnapEnv(dir, {
    BLOB_READ_WRITE_TOKEN: '',
    VERCEL: '1',
  });
  try {
    const saved = await saveSnapshot(OTTO);
    assert.equal(saved.persisted, undefined);
    assert.match(saved.error, /BLOB_READ_WRITE_TOKEN/);
    assert.equal(saved.status, 503);
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b == null ? '' : String(b); },
  };
}

test('tesla-morning handler GET empty, POST bearer upsert, GET snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tesla-api-'));
  const restore = withSnapEnv(dir, {
    BLOB_READ_WRITE_TOKEN: '',
    VERCEL: null,
    TESLA_MORNING_FEED_TOKEN: 'otto-feed-secret',
  });
  try {
    const { default: handler } = await import('../api/tesla-morning.js');
    const emptyRes = mockRes();
    await handler({ method: 'GET', headers: {} }, emptyRes);
    assert.equal(emptyRes.statusCode, 200);
    assert.deepEqual(JSON.parse(emptyRes.body), { empty: true });

    const noAuth = mockRes();
    await handler({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: OTTO,
    }, noAuth);
    assert.equal(noAuth.statusCode, 401);

    const postRes = mockRes();
    await handler({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer otto-feed-secret',
      },
      body: OTTO,
    }, postRes);
    assert.equal(postRes.statusCode, 200);
    const posted = JSON.parse(postRes.body);
    assert.equal(posted.ok, true);
    assert.equal(posted.snapshot.display_name, 'Model Y');
    assert.equal(posted.snapshot.battery_level_pct, 53);

    const getRes = mockRes();
    await handler({ method: 'GET', headers: {} }, getRes);
    assert.equal(getRes.statusCode, 200);
    const got = JSON.parse(getRes.body);
    assert.equal(got.empty, undefined);
    assert.equal(got.line, OTTO.line);
    assert.equal(got.charge_limit_soc, 80);
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});
