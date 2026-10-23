import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot, loadProjects } from './projects.js';

test('normalize rejects junk', () => {
  assert.equal(normalizeSnapshot(null), null);
  assert.equal(normalizeSnapshot({ projects: 'x' }), null);
});

test('normalize clamps column and spark', () => {
  const s = normalizeSnapshot({ projects: [{ slug: 'a', name: 'A', column: 'weird', spark: [1, 'x', 3] }, { slug: 1 }], attention: [{ text: 'hi' }, {}] });
  assert.equal(s.projects.length, 1);
  assert.equal(s.projects[0].column, 'quiet');
  assert.deepEqual(s.projects[0].spark, [1, 0, 3]);
  assert.equal(s.attention.length, 1);
});

test('loadProjects reads private blob via client', async () => {
  const body = JSON.stringify({ projects: [{ slug: 'o', name: 'Orbit', column: 'needs' }] });
  const client = { get: async (path, opts) => {
    assert.equal(path, 'projects-snapshot.json'); assert.equal(opts.access, 'private');
    return { statusCode: 200, stream: new Response(body).body };
  } };
  const s = await loadProjects(client);
  assert.equal(s.projects[0].column, 'needs');
});
