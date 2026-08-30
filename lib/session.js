// HMAC session cookies for admin login. Edge-safe (Web Crypto only).
export const COOKIE = 'ostroff_admin';
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

export function timingSafeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  if (left.length !== right.length) return false;
  let out = 0;
  for (let i = 0; i < left.length; i++) out |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return out === 0;
}

export function mailNotesFeedToken() {
  return String(process.env.MAIL_NOTES_FEED_TOKEN || '').trim();
}

export function mailNotesFeedAuthorized(authorizationHeader) {
  const expected = mailNotesFeedToken();
  if (!expected) return false;
  const header = String(authorizationHeader || '');
  if (!header.startsWith('Bearer ')) return false;
  return timingSafeEqual(header.slice('Bearer '.length), expected);
}

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return hex(new Uint8Array(sig));
}

export function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || '';
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export async function signSession(username, exp = 0) {
  const secret = sessionSecret();
  if (!secret) return '';
  const expiry = exp || Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `v1.${username}.${expiry}`;
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

export async function readSession(cookieHeader) {
  const secret = sessionSecret();
  if (!secret) return null;
  const raw = parseCookies(cookieHeader)[COOKIE] || '';
  const parts = raw.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const [, username, exp, sig] = parts;
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(username)) return null;
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;
  const expected = await hmacHex(secret, `v1.${username}.${expiry}`);
  if (!timingSafeEqual(sig, expected)) return null;
  return { username, exp: expiry };
}

export function cookieFlags() {
  const secure = process.env.VERCEL ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function setSessionCookie(value) {
  const max = SESSION_DAYS * 24 * 60 * 60;
  return `${COOKIE}=${value}; ${cookieFlags()}; Max-Age=${max}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; ${cookieFlags()}; Max-Age=0`;
}

export function safeNext(next, fallback = '/tickets/') {
  const value = String(next || '');
  return /^\/(trips|tickets|bots|morning|login)(\/[A-Za-z0-9._\-]+)*\/?$/.test(value) ? value : fallback;
}
