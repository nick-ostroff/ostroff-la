import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, normalizeUsername, validUsername, verifyPassword } from './users.js';
import { safeNext, signSession, readSession, COOKIE } from './session.js';

test('safeNext only allows admin paths', () => {
  assert.equal(safeNext('/tickets/'), '/tickets/');
  assert.equal(safeNext('/bots/mail/'), '/bots/mail/');
  assert.equal(safeNext('/trips/japan/'), '/trips/japan/');
  assert.equal(safeNext('/tickets/g/chargers-cardinals/'), '/tickets/g/chargers-cardinals/');
  assert.equal(safeNext('https://evil.test/'), '/tickets/');
  assert.equal(safeNext('/api/feed'), '/tickets/');
  assert.equal(safeNext('/'), '/tickets/');
});

test('username rules', () => {
  assert.equal(normalizeUsername('Nick'), 'nick');
  assert.equal(validUsername('nick'), true);
  assert.equal(validUsername('peter-o'), true);
  assert.equal(validUsername('x'), false);
  assert.equal(validUsername('Nick O'), false);
});

test('password hash verifies', async () => {
  const { hash, salt } = await hashPassword('correct-horse');
  assert.equal(await verifyPassword({ hash, salt }, 'correct-horse'), true);
  assert.equal(await verifyPassword({ hash, salt }, 'wrong-password'), false);
});

test('session cookie round-trip', async () => {
  process.env.ADMIN_SESSION_SECRET = 'test-secret-please-rotate';
  const value = await signSession('nick');
  const session = await readSession(`${COOKIE}=${value}`);
  assert.equal(session.username, 'nick');
  assert.equal(await readSession(`${COOKIE}=${value}tampered`), null);
});

test('middleware 301s old hosts onto ostroff.la', async () => {
  const { default: middleware } = await import('../middleware.js');
  const grok = await middleware(new Request('https://grok.ostroff.la/mail'));
  assert.equal(grok.status, 301);
  assert.equal(grok.headers.get('location'), 'https://ostroff.la/bots/mail/');

  const grokNotes = await middleware(new Request('https://grok.ostroff.la/api/mail-notes'));
  assert.equal(grokNotes.status, 301);
  assert.equal(grokNotes.headers.get('location'), 'https://ostroff.la/api/mail-notes');

  const tickets = await middleware(new Request('https://tickets.ostroff.la/g/rams-giants/'));
  assert.equal(tickets.status, 301);
  assert.equal(tickets.headers.get('location'), 'https://ostroff.la/tickets/g/rams-giants/');
});

test('middleware sends strangers to login when session secret is set', async () => {
  process.env.ADMIN_SESSION_SECRET = 'test-secret-please-rotate';
  const { default: middleware } = await import('../middleware.js');
  const res = await middleware(new Request('https://ostroff.la/tickets/'));
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/login\/\?next=/);

  const notes = await middleware(new Request('https://ostroff.la/api/mail-notes'));
  assert.equal(notes.status, 401);
  assert.match(await notes.text(), /auth required/);
});
