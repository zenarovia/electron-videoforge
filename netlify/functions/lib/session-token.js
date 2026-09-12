// lib/session-token.js — the signed session cookie that lib/require-auth.js accepts.
//
// Studio logins are configured, not stored. Two env vars, neither ever sent to
// the browser:
//   VF_LOGIN_USERS     {"twila":{"hash":"scrypt$...","admin":true}, ...}
//                      built with scripts/make-login-user.js
//   VF_SESSION_SECRET  HMAC key the cookie is signed with, 32+ characters
// If either is missing or malformed, nobody can log in and no cookie verifies.
//
// Token: base64url(JSON payload) "." base64url(HMAC-SHA256 of the payload part)
//   sub   login name — looked up in VF_LOGIN_USERS on every request, so deleting
//         a user there ends their sessions immediately
//   iat   when this cookie was issued; it is re-issued as it gets used
//   auth  when the password was actually typed; no refresh extends a session
//         past auth + MAX_SESSION_SEC
//   exp   idle expiry
//   pv    fingerprint of the password hash the user logged in against, so
//         changing someone's password ends their existing sessions
// The payload grants nothing on its own: whether a user is an admin is read
// from VF_LOGIN_USERS at verify time, never from the token or the request.
//
// Sessions are stateless. Logging out expires the cookie in that browser, but a
// copied cookie stays valid until it expires. To cut every session off at once,
// rotate VF_SESSION_SECRET.

const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);

const COOKIE_NAME = "__Host-vf_session";
const IDLE_TTL_SEC = 12 * 60 * 60;
const MAX_SESSION_SEC = 7 * 24 * 60 * 60;
const REFRESH_AFTER_SEC = 10 * 60;
const MIN_SECRET_LENGTH = 32;
const MAX_TOKEN_LENGTH = 1024;
const USER_NAME = /^[a-z0-9_-]{1,32}$/;

// Password hashes: scrypt$<log2 N>$<r>$<p>$<salt>$<hash>, salt and hash base64url.
const SCRYPT_LOG_N = 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

function now() {
  return Math.floor(Date.now() / 1000);
}

function signingKey() {
  const key = process.env.VF_SESSION_SECRET;
  return typeof key === "string" && key.length >= MIN_SECRET_LENGTH ? key : null;
}

function parseHash(stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [logN, r, p] = parts.slice(1, 4).map(Number);
  if (!Number.isInteger(logN) || logN < 14 || logN > 17) return null;
  if (!Number.isInteger(r) || r < 1 || r > 16 || p !== 1) return null;
  const salt = Buffer.from(parts[4], "base64url");
  const hash = Buffer.from(parts[5], "base64url");
  if (salt.length < 16 || hash.length < 32) return null;
  return { N: 2 ** logN, r, p, salt, hash };
}

// A Map of name -> { hash, admin }, or null if VF_LOGIN_USERS is unset, empty or
// malformed in any entry. Callers treat null as "log nobody in".
function loadUsers() {
  const raw = process.env.VF_LOGIN_USERS;
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const users = new Map();
  for (const [name, entry] of Object.entries(parsed)) {
    if (!USER_NAME.test(name) || !entry || typeof entry.hash !== "string" || !parseHash(entry.hash)) return null;
    users.set(name, { hash: entry.hash, admin: entry.admin === true });
  }
  return users.size ? users : null;
}

function isConfigured() {
  return Boolean(signingKey() && loadUsers());
}

function derive(password, { N, r, p, salt, hash }) {
  return scrypt(password, salt, hash.length, { N, r, p, maxmem: 256 * N * r });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const params = { N: 2 ** SCRYPT_LOG_N, r: SCRYPT_R, p: SCRYPT_P, salt, hash: Buffer.alloc(KEY_LENGTH) };
  const key = await derive(password, params);
  return ["scrypt", SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

// Runs the same scrypt work whether or not the name exists, so response time
// doesn't reveal which login names are real.
const DUMMY_HASH = { N: 2 ** SCRYPT_LOG_N, r: SCRYPT_R, p: SCRYPT_P, salt: Buffer.alloc(16), hash: Buffer.alloc(KEY_LENGTH) };

// The user entry if name + password are right, else null.
async function checkPassword(name, password) {
  const users = loadUsers();
  const user = users && typeof name === "string" ? users.get(name) : undefined;
  const params = user ? parseHash(user.hash) : DUMMY_HASH;
  const pw = typeof password === "string" ? password : "";
  const key = await derive(pw, params);
  const match = crypto.timingSafeEqual(key, params.hash);
  return user && match && pw.length > 0 ? user : null;
}

function passwordVersion(hash) {
  return crypto.createHash("sha256").update(hash).digest("base64url").slice(0, 16);
}

function sign(part, key) {
  return crypto.createHmac("sha256", key).update(part).digest("base64url");
}

// A fresh cookie for `name`, as { cookie, exp }. Null if the signing key or the
// user is gone, or the login is past its maximum age — no session should exist.
function issue(name, authTime, at = now()) {
  const key = signingKey();
  const users = loadUsers();
  const user = users && users.get(name);
  if (!key || !user) return null;

  const exp = Math.min(at + IDLE_TTL_SEC, authTime + MAX_SESSION_SEC);
  if (exp <= at) return null;

  const claims = { v: 1, sub: name, iat: at, auth: authTime, exp, pv: passwordVersion(user.hash) };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const token = `${payload}.${sign(payload, key)}`;
  return {
    exp,
    cookie: `${COOKIE_NAME}=${token}; Path=/; Max-Age=${exp - at}; HttpOnly; Secure; SameSite=Strict`,
  };
}

function clearedCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

// The session token from a Cookie header, or undefined.
function readCookie(cookieHeader) {
  if (typeof cookieHeader !== "string") return undefined;
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq !== -1 && pair.slice(0, eq).trim() === COOKIE_NAME) return pair.slice(eq + 1).trim();
  }
  return undefined;
}

// { name, admin, iat, auth, exp } for a genuine, unexpired session, else null.
function verify(token, at = now()) {
  const key = signingKey();
  const users = loadUsers();
  if (!key || !users || typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = Buffer.from(sign(parts[0], key));
  const provided = Buffer.from(parts[1]);
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null;

  let claims;
  try { claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return null; }
  if (!claims || claims.v !== 1 || typeof claims.sub !== "string") return null;

  const { iat, auth, exp } = claims;
  if (![iat, auth, exp].every(Number.isInteger)) return null;
  if (at >= exp || at >= auth + MAX_SESSION_SEC || iat > at + 60 || auth > iat) return null;

  const user = users.get(claims.sub);
  if (!user || claims.pv !== passwordVersion(user.hash)) return null;
  return { name: claims.sub, admin: user.admin, iat, auth, exp };
}

module.exports = {
  COOKIE_NAME,
  IDLE_TTL_SEC,
  MAX_SESSION_SEC,
  REFRESH_AFTER_SEC,
  now,
  isConfigured,
  hashPassword,
  checkPassword,
  issue,
  verify,
  readCookie,
  clearedCookie,
};
