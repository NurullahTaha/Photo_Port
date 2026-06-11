import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { DATA_DIR, ensureDirs } from './paths.js';

const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const COOKIE_NAME = 'pp_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let secret = null;

function getSecret() {
  if (secret) return secret;
  if (process.env.SESSION_SECRET) {
    secret = process.env.SESSION_SECRET;
    return secret;
  }
  ensureDirs();
  if (fs.existsSync(SECRET_FILE)) {
    secret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } else {
    secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  }
  return secret;
}

export function ensureAdmin() {
  ensureDirs();
  if (fs.existsSync(AUTH_FILE)) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'changeme';
  const passwordHash = bcrypt.hashSync(password, 10);
  fs.writeFileSync(
    AUTH_FILE,
    JSON.stringify({ username, passwordHash }, null, 2),
    { mode: 0o600 }
  );
  if (!process.env.ADMIN_PASSWORD) {
    console.warn(
      '[auth] Created default admin account (admin / changeme). ' +
        'Change the password from the admin dashboard or set ADMIN_PASSWORD.'
    );
  }
}

export function getAdmin() {
  ensureAdmin();
  return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
}

export function setAdminPassword(newPassword) {
  const admin = getAdmin();
  admin.passwordHash = bcrypt.hashSync(newPassword, 10);
  fs.writeFileSync(AUTH_FILE, JSON.stringify(admin, null, 2), { mode: 0o600 });
}

export function verifyCredentials(username, password) {
  const admin = getAdmin();
  if (username !== admin.username) {
    // Burn comparable time so usernames can't be probed via timing.
    bcrypt.compareSync(password || '', admin.passwordHash);
    return false;
  }
  return bcrypt.compareSync(password || '', admin.passwordHash);
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function signSession(username) {
  const payload = b64url(
    JSON.stringify({ u: username, exp: Date.now() + SESSION_TTL_MS })
  );
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto
    .createHmac('sha256', getSecret())
    .update(payload)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function setSessionCookie(res, token) {
  const secure = process.env.TRUST_PROXY === '1' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
      SESSION_TTL_MS / 1000
    }${secure}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function getSession(req) {
  return verifySession(parseCookies(req)[COOKIE_NAME]);
}

export function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  req.session = session;
  next();
}

// --- naive in-memory login rate limit -------------------------------------
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function loginRateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = attempts.get(ip);
  if (entry && now < entry.resetAt && entry.count >= MAX_ATTEMPTS) {
    res.status(429).json({ error: 'Too many attempts. Try again later.' });
    return;
  }
  if (!entry || now >= entry.resetAt) {
    attempts.set(ip, { count: 0, resetAt: now + WINDOW_MS });
  }
  next();
}

export function recordFailedLogin(req) {
  const ip = req.ip || 'unknown';
  const entry = attempts.get(ip) || { count: 0, resetAt: Date.now() + WINDOW_MS };
  entry.count += 1;
  attempts.set(ip, entry);
}

export function resetLoginAttempts(req) {
  attempts.delete(req.ip || 'unknown');
}
