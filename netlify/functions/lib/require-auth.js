// lib/require-auth.js — the one auth check every Studio function runs first.
//
// Two ways in, and nothing else:
//   1. The `x-vf-secret` header matching env VF_API_SECRET — for scripts and CI.
//   2. A signed session cookie from login.js (see lib/session-token.js) — for the
//      Studio UI, and for a chat driving Twila's logged-in browser, which then
//      never has to hold a credential.
//
// Wrap the handler so the check runs before the method check, before JSON.parse,
// before anything:
//
//   exports.handler = withAuth(async (event) => { ... });
//
// Rules this file has to keep:
//   • Identity never comes from the request body or any caller-supplied claim —
//     no `session`, `isAdmin`, `x-session`, or key in the body. These functions
//     used to trust `session.isAdmin` from the body, and anyone who knew the URL
//     could spend the fal balance. This file never reads event.body.
//   • Fail closed. VF_API_SECRET unset: no header gets in. VF_SESSION_SECRET or
//     VF_LOGIN_USERS unset or malformed: no cookie gets in. The two paths are
//     independent, so a session misconfiguration can't lock scripts out.
//   • The browser attaches a cookie on its own, so a cookie-authenticated request
//     must also prove it came from the Studio's own pages (CSRF). The header path
//     needs no such check: a cross-site page can't set a custom header without a
//     CORS preflight, and these functions never grant one.
//   • A header that is present but wrong is a 401, even next to a valid cookie.

const crypto = require("crypto");
const session = require("./session-token");

function getHeader(event, name) {
  const headers = event && event.headers;
  if (!headers || typeof headers !== "object") return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

function secretMatches(provided) {
  const expected = process.env.VF_API_SECRET;
  if (!expected || typeof provided !== "string") return false;

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// True only for a request the browser says came from this site's own pages.
// Sec-Fetch-Site is set by the browser, page script can't forge it, and every
// current browser sends it. Without it, fall back to Origin matching Host. With
// neither, refuse: a request that can't show where it came from doesn't get to
// ride on a cookie.
function isSameOrigin(event) {
  const site = getHeader(event, "sec-fetch-site");
  if (site !== undefined) return site === "same-origin";

  const origin = getHeader(event, "origin");
  const host = getHeader(event, "host");
  if (typeof origin !== "string" || typeof host !== "string") return false;
  try {
    return new URL(origin).host === host.toLowerCase();
  } catch {
    return false;
  }
}

function deny(statusCode, error, extraHeaders) {
  return {
    ok: false,
    response: {
      statusCode,
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify({ error }),
    },
  };
}

function requireAuth(event) {
  const provided = getHeader(event, "x-vf-secret");
  if (provided !== undefined) {
    if (!secretMatches(provided)) return deny(401, "Unauthorized");
    return { ok: true, via: "header", user: { name: "api", admin: true } };
  }

  const token = session.readCookie(getHeader(event, "cookie"));
  if (token === undefined) return deny(401, "Unauthorized");

  const at = session.now();
  const current = session.verify(token, at);
  if (!current) return deny(401, "Unauthorized", { "Set-Cookie": session.clearedCookie() });
  if (!isSameOrigin(event)) return deny(403, "Cross-site request refused");

  // Refresh on use: once the cookie is a few minutes old, re-issue it with a
  // later idle expiry (same login time), rather than on every poll.
  const refreshed = at - current.iat >= session.REFRESH_AFTER_SEC
    ? session.issue(current.name, current.auth, at)
    : null;

  return {
    ok: true,
    via: "cookie",
    user: { name: current.name, admin: current.admin },
    exp: refreshed ? refreshed.exp : current.exp,
    setCookie: refreshed ? refreshed.cookie : undefined,
  };
}

// The handler receives (event, context, auth) and runs only for an authorized
// request. A refreshed session cookie is attached to whatever it returns.
function withAuth(handler) {
  return async (event, context) => {
    const auth = requireAuth(event);
    if (!auth.ok) return auth.response;

    const res = await handler(event, context, auth);
    if (auth.setCookie && res && typeof res === "object") {
      res.headers = { ...res.headers, "Set-Cookie": auth.setCookie };
    }
    return res;
  };
}

module.exports = { withAuth, requireAuth, isSameOrigin };
