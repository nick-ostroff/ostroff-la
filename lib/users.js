// Admin user store. Seed from ADMIN_USERS_JSON (Vercel env). Extra users
// persist to .data/users.json locally. Never commit that file or raw passwords.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from './session.js';

const enc = new TextEncoder();
const ITERATIONS = 100_000;
const root = fileURLToPath(new URL('..', import.meta.url));
const FILE = join(root, '.data', 'users.json');

const NAME = /^[a-z][a-z0-9_-]{1,31}$/;

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function fromB64(s) {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

export function normalizeUsername(raw) {
  return String(raw || '').trim().toLowerCase();
}

export function validUsername(raw) {
  return NAME.test(normalizeUsername(raw));
}

export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    key,
    256,
  );
  return { hash: hex(new Uint8Array(bits)), salt: b64(salt), iter: ITERATIONS };
}

function parseList(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((u) => ({
        username: normalizeUsername(u.username || u.u),
        hash: String(u.hash || u.h || ''),
        salt: String(u.salt || u.s || ''),
        iter: Number(u.iter || ITERATIONS),
        createdAt: u.createdAt || null,
      }))
      .filter((u) => NAME.test(u.username) && u.hash && u.salt);
  } catch {
    return [];
  }
}

function mergeUsers(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const u of list) map.set(u.username, u);
  }
  return [...map.values()];
}

async function readFileUsers() {
  if (process.env.VERCEL) return [];
  try {
    return parseList(await readFile(FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function writeFileUsers(users) {
  if (process.env.VERCEL) return false;
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, `${JSON.stringify(users, null, 2)}\n`, 'utf8');
  return true;
}

export async function loadUsers() {
  return mergeUsers(parseList(process.env.ADMIN_USERS_JSON || ''), await readFileUsers());
}

export async function publicUsers() {
  const users = await loadUsers();
  return users.map((u) => ({ username: u.username, createdAt: u.createdAt }));
}

export function envSnippet(users) {
  return JSON.stringify(users.map((u) => ({
    username: u.username,
    hash: u.hash,
    salt: u.salt,
    iter: u.iter,
    createdAt: u.createdAt,
  })));
}

export async function verifyPassword(user, password) {
  if (!user || !password) return false;
  const got = await hashPassword(password, user.salt);
  return timingSafeEqual(got.hash, user.hash);
}

export async function findUser(username) {
  const name = normalizeUsername(username);
  return (await loadUsers()).find((u) => u.username === name) || null;
}

export function setupCode() {
  return process.env.ADMIN_SETUP_TOKEN
    || process.env.MORNING_BASIC_PASSWORD
    || process.env.FAMILY_PASSCODE
    || '';
}

export function setupCodeOk(code) {
  const expected = setupCode();
  if (!expected) return false;
  return timingSafeEqual(String(code || '').trim(), expected);
}

export async function createUser({ username, password, createdAt }) {
  const name = normalizeUsername(username);
  if (!NAME.test(name)) return { error: 'username must be 2–32 letters, numbers, _ or -', status: 400 };
  if (String(password || '').length < 8) return { error: 'password must be at least 8 characters', status: 400 };
  const users = await loadUsers();
  if (users.some((u) => u.username === name)) return { error: 'that user already exists', status: 409 };
  const creds = await hashPassword(password);
  const row = {
    username: name,
    hash: creds.hash,
    salt: creds.salt,
    iter: creds.iter,
    createdAt: createdAt || new Date().toISOString(),
  };
  users.push(row);
  const persisted = await writeFileUsers(users);
  return {
    user: { username: name, createdAt: row.createdAt },
    persisted: persisted ? 'file' : 'none',
    envSnippet: envSnippet(users),
  };
}
