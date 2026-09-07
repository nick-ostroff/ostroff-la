import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UPSTREAM_FETCH, freshUpstreamUrl } from './feed.js';
import handler from '../api/feed.js';

const nickXml = `<?xml version="1.0"?><rss><channel>
<title>Nick</title>
<item>
  <title>No Scoreboard</title>
  <link>https://nickostroff.com/no-scoreboard</link>
  <pubDate>Mon, 01 Sep 2026 12:00:00 GMT</pubDate>
  <description>Nick column</description>
</item>
</channel></rss>`;

const peterXml = `<?xml version="1.0"?><rss><channel>
<title>Peter</title>
<item>
  <title>BHUSD Gems</title>
  <link>https://www.peterostroff.com/bhusd-gems</link>
  <pubDate>Wed, 03 Sep 2026 12:00:00 GMT</pubDate>
  <description>Peter column</description>
</item>
<item>
  <title>BHHS Academic Rankings</title>
  <link>https://www.peterostroff.com/bhhs-academic-rankings</link>
  <pubDate>Tue, 02 Sep 2026 12:00:00 GMT</pubDate>
  <description>Rankings</description>
</item>
</channel></rss>`;

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
  };
}

test('freshUpstreamUrl appends a cache-bust query without dropping the path', () => {
  assert.equal(
    freshUpstreamUrl('https://www.peterostroff.com/feed.xml', 1_788_823_200_000),
    'https://www.peterostroff.com/feed.xml?_=1788823200000',
  );
  assert.equal(
    freshUpstreamUrl('https://nickostroff.com/feed.xml', 99),
    'https://nickostroff.com/feed.xml?_=99',
  );
});

test('freshUpstreamUrl keeps existing query params', () => {
  assert.equal(
    freshUpstreamUrl('https://example.test/feed.xml?fmt=rss', 7),
    'https://example.test/feed.xml?fmt=rss&_=7',
  );
});

test('UPSTREAM_FETCH bypasses fetch and HTTP caches', () => {
  assert.equal(UPSTREAM_FETCH.cache, 'no-store');
  assert.equal(UPSTREAM_FETCH.headers['cache-control'], 'no-cache');
  assert.equal(UPSTREAM_FETCH.headers.pragma, 'no-cache');
});

test('GET /api/feed cache-busts each upstream and still merges nick + peter', async () => {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    calls.push({ href, init });
    const xml = href.includes('peterostroff.com') ? peterXml : nickXml;
    return { ok: true, status: 200, text: async () => xml };
  };
  try {
    const res = mockRes();
    await handler({ query: { who: 'nick,peter' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 's-maxage=60, stale-while-revalidate=300');
    assert.deepEqual(res.body.items.map((it) => it.title), [
      'BHUSD Gems',
      'BHHS Academic Rankings',
      'No Scoreboard',
    ]);
    assert.deepEqual(res.body.items.map((it) => it.authorKey), ['peter', 'peter', 'nick']);
    assert.equal(calls.length, 2);
    const hosts = calls.map((c) => new URL(c.href).host).sort();
    assert.deepEqual(hosts, ['nickostroff.com', 'www.peterostroff.com']);
    for (const call of calls) {
      assert.match(call.href, /[?&]_=\d+/);
      assert.equal(call.init.cache, 'no-store');
      assert.equal(call.init.headers['cache-control'], 'no-cache');
    }
  } finally {
    globalThis.fetch = orig;
  }
});

test('GET /api/feed?who=peter returns only Peter items', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => peterXml });
  try {
    const res = mockRes();
    await handler({ query: { who: 'peter' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.items.map((it) => it.title), [
      'BHUSD Gems',
      'BHHS Academic Rankings',
    ]);
    assert.ok(res.body.items.every((it) => it.authorKey === 'peter'));
  } finally {
    globalThis.fetch = orig;
  }
});

test('unknown who is 400', async () => {
  const res = mockRes();
  await handler({ query: { who: 'cliff' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'unknown source');
});
