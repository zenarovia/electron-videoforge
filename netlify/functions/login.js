// login.js — trades a Studio login name + password for a session cookie.
//
// The cookie is the whole mechanism: httpOnly (page script can't read it),
// Secure, SameSite=Strict, and signed — see lib/session-token.js. The response
// body carries no token. Every other function accepts the cookie through
// lib/require-auth.js, alongside the x-vf-secret header scripts use.
//
// Logins come from env VF_LOGIN_USERS, built with scripts/make-login-user.js.
// There is no signup and no user store to write to.
//
// There is no lockout either (functions keep no state between requests), so
// each attempt costs a deliberate scrypt run. Use long passwords.

const { isSameOrigin } = require("./lib/require-auth");
const session = require("./lib/session-token");

const MAX_PASSWORD_LENGTH = 1024;

function reply(statusCode, body, headers) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "Method not allowed" });

  // Refuse cross-site posts, so another page can't sign this browser in to an
  // account of its choosing.
  if (!isSameOrigin(event)) return reply(403, { error: "Cross-site request refused" });

  if (!session.isConfigured()) return reply(503, { error: "Login is not configured" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return reply(400, { error: "Invalid JSON body" });
  }

  const name = typeof body?.name === "string" ? body.name.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" && body.password.length <= MAX_PASSWORD_LENGTH
    ? body.password
    : "";

  const user = await session.checkPassword(name, password);
  const at = session.now();
  const issued = user && session.issue(name, at, at);
  if (!issued) return reply(401, { error: "Wrong name or password" });

  return reply(200, { user: { name, admin: user.admin }, expiresAt: issued.exp }, { "Set-Cookie": issued.cookie });
};
