// tests/auth-guard.test.js — regression test for the auth guard (lib/require-auth.js).
//
// Run with:  node tests/auth-guard.test.js
// No test framework needed; exits non-zero on failure.
//
// Every Netlify function that reaches for an admin credential in process.env
// must refuse a request that carries neither the shared secret nor a valid
// session cookie, and must refuse it BEFORE making any outbound call. These
// functions used to decide that from `session.isAdmin` in the unverified request
// body, so a stranger who knew the URL could spend the account's fal / Higgsfield
// / Claude / Fish Audio balance or write to Airtable. global.fetch is stubbed so
// any outbound attempt is recorded and fails loudly.
//
// log-url.js and save-export.js spend no credits but write to Netlify Blobs
// under a caller-supplied id. @netlify/blobs is pointed at a fake site below,
// so an unguarded write shows up here as a recorded fetch.
//
// Session cookies are minted HERE, from the format documented in
// lib/session-token.js, not by calling that library. That pins the format, and
// lets these tests run (and fail) against code with no session support at all.
//
// ─── Negative control ──────────────────────────────────────────────────
// Point VF_FUNCTIONS_DIR at a checkout of the pre-guard functions and these
// tests must FAIL — that is what proves they are testing something:
//
//   node tests/auth-guard.test.js                       # against this working tree
//   VF_FUNCTIONS_DIR=/tmp/old node tests/auth-guard.test.js   # against the old code
//
// Without this, FUNCTIONS_DIR was pinned to the working tree and an old-code run
// silently re-tested the new code, reporting a pass that meant nothing.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// @netlify/blobs retries a failed fetch 5 times, 5 s apart, unless NODE_ENV is
// "test" (1 ms). It reads this once at load, so set it before any require.
process.env.NODE_ENV = "test";

const FUNCTIONS_DIR = process.env.VF_FUNCTIONS_DIR || path.join(__dirname, "..", "netlify", "functions");
const SECRET = "test-secret-value-123";
const SESSION_SECRET = "test-session-signing-key-0123456789abcdef";
const PASSWORD = "correct horse battery staple";
const HOST = "studio.example";
const COOKIE = "__Host-vf_session";

function scryptHash(password, saltText) {
  const salt = Buffer.from(saltText.padEnd(16, "."));
  const key = crypto.scryptSync(password, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 256 * 2 ** 15 * 8 });
  return ["scrypt", 15, 8, 1, salt.toString("base64url"), key.toString("base64url")].join("$");
}

const TWILA_HASH = scryptHash(PASSWORD, "twila-salt");

const ENV = {
  VF_API_SECRET: SECRET,
  VF_SESSION_SECRET: SESSION_SECRET,
  VF_LOGIN_USERS: JSON.stringify({ twila: { hash: TWILA_HASH, admin: true } }),
  FAL_KEY: "fake-fal-key",
  HIGGSFIELD_API_KEY: "fake-higgs-key",
  CLAUDE_API_KEY: "fake-claude-key",
  AIRTABLE_API_KEY: "fake-airtable-key",
  AIRTABLE_JOBS_BASE: "appFAKEBASE",
  AIRTABLE_JOBS_TABLE: "tblFAKETABLE",
  FISH_AUDIO_API_KEY: "fake-fish-key",
  NETLIFY_BLOBS_CONTEXT: Buffer.from(JSON.stringify({
    siteID: "fake-site",
    token: "fake-blobs-token",
    edgeURL: "https://blobs.invalid",
    uncachedEdgeURL: "https://blobs.invalid",
  })).toString("base64"),
};

// A request well-formed enough to get past validation and reach real work,
// so a missing guard would actually spend money or write a blob.
const CASES = {
  "submit-images.js": { httpMethod: "POST", body: JSON.stringify({ prompts: new Array(8).fill("p") }) },
  "submit-animations.js": { httpMethod: "POST", body: JSON.stringify({ imageUrls: ["u"], animatedSceneIndexes: [0] }) },
  "check-jobs.js": { httpMethod: "POST", body: JSON.stringify({ jobs: [{ requestId: "r1", endpoint: "fal-ai/x" }], jobId: "j1" }) },
  "animate.js": { httpMethod: "POST", body: JSON.stringify({ imageUrl: "https://fal.media/a.png" }) },
  "generate-images.js": { httpMethod: "POST", body: JSON.stringify({ prompts: new Array(8).fill("p") }) },
  "models.js": { httpMethod: "GET", queryStringParameters: { type: "image" } },
  "prompts.js": { httpMethod: "POST", body: JSON.stringify({ script: "hello" }) },
  "translate.js": { httpMethod: "POST", body: JSON.stringify({ script: "hello" }) },
  "save-job.js": { httpMethod: "POST", body: JSON.stringify({ jobData: { title: "t", channel: "c" } }) },
  "tts.js": { httpMethod: "POST", body: JSON.stringify({ script: "hello" }) },
  "assemble-video-background.js": {
    httpMethod: "POST",
    body: JSON.stringify({ jobId: "j1", imageUrls: ["https://fal.media/a.png"], enScript: "hi", language: "en" }),
  },
  "log-url.js": { httpMethod: "POST", body: JSON.stringify({ jobId: "j1", url: "https://fal.media/a.png", type: "image", sceneIndex: 0 }) },
  "save-export.js": { httpMethod: "POST", body: JSON.stringify({ id: "j1", title: "t" }) },
  "session.js": { httpMethod: "GET" },
};

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`); }
}

async function invoke(file, event, env) {
  delete require.cache[require.resolve(file)];

  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const h = (opts && opts.headers) || {};
    calls.push({ url: String(url), auth: h.Authorization || h.authorization || h["x-api-key"] });
    throw new Error("TEST: outbound fetch attempted");
  };

  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }

  try {
    const res = await require(file).handler(event, {});
    return { res, calls };
  } catch (err) {
    return { err, calls };
  } finally {
    global.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

// ─── Session cookie helpers ──────────────────────────────────────────────────
const nowSec = () => Math.floor(Date.now() / 1000);
const passwordVersion = (hash) => crypto.createHash("sha256").update(hash).digest("base64url").slice(0, 16);

function mintToken(overrides = {}, key = SESSION_SECRET) {
  const at = nowSec();
  const claims = { v: 1, sub: "twila", iat: at, auth: at, exp: at + 3600, pv: passwordVersion(TWILA_HASH), ...overrides };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = crypto.createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

const decodeClaims = (token) => {
  try { return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8")); } catch { return {}; }
};
const cookieHeader = (token) => `theme=dark; ${COOKIE}=${token}`;
const sameOrigin = (extra) => ({ host: HOST, "sec-fetch-site": "same-origin", ...extra });
const setCookieOf = (res) => (res && res.headers && (res.headers["Set-Cookie"] || res.headers["set-cookie"])) || "";
const issuedToken = (res) => (setCookieOf(res).match(/^__Host-vf_session=([^;\s]+)/) || [])[1];

// A leaked admin credential is the failure that actually costs money.
function assertNoLeak(calls, label) {
  const leaked = calls.find((c) => c.auth && /fake-(fal|higgs|claude|airtable|fish|blobs)/.test(String(c.auth)));
  check(`${label}: admin credential not sent upstream`, !leaked, leaked && String(leaked.auth));
}

async function expectRefused(file, desc, event, status, env = ENV) {
  const { res, err, calls } = await invoke(file, event, env);
  check(`${desc}: no throw`, !err, err && err.message);
  check(`${desc}: ${status}`, res && res.statusCode === status, res && `got ${res.statusCode}`);
  check(`${desc}: zero outbound calls`, calls.length === 0, `made ${calls.length}: ${calls.map((c) => c.url).join(", ")}`);
  check(`${desc}: no session cookie issued`, !issuedToken(res), setCookieOf(res));
  assertNoLeak(calls, desc);
}

async function testFunction(name, base) {
  const file = path.join(FUNCTIONS_DIR, name);
  if (!fs.existsSync(file)) return;
  if (fs.readFileSync(file, "utf8").includes("DEPRECATED")) {
    console.log(`\nSKIP ${name} (410 deprecation stub)`);
    return;
  }
  console.log(`\n${name}`);

  const at = nowSec();
  const good = mintToken();
  const [goodPayload, goodSig] = good.split(".");
  const swappedPayload = Buffer.from(JSON.stringify({ ...decodeClaims(good), sub: "genesis" })).toString("base64url");

  // No credential, a bad header, or privilege claimed by the caller.
  const noCredential = [
    ["no header", { ...base, headers: {} }],
    ["no headers object", { ...base }],
    ["wrong secret, same length", { ...base, headers: { "x-vf-secret": "X".repeat(SECRET.length) } }],
    ["wrong secret, different length", { ...base, headers: { "x-vf-secret": "short" } }],
    ["empty secret", { ...base, headers: { "x-vf-secret": "" } }],
    ["non-string secret", { ...base, headers: { "x-vf-secret": 12345 } }],
    // The pattern the Sep 9 fix removed: privilege claimed in the request body.
    ["isAdmin in body", { ...base, headers: {}, body: JSON.stringify({ ...JSON.parse(base.body || "{}"), session: { isAdmin: true } }) }],
    ["isAdmin in body, same-origin", { ...base, headers: sameOrigin(), body: JSON.stringify({ ...JSON.parse(base.body || "{}"), session: { isAdmin: true } }) }],
    ["x-session header claiming admin", { ...base, headers: sameOrigin({ "x-session": JSON.stringify({ name: "Twila", isAdmin: true }) }) }],
    ["valid cookie next to a wrong x-vf-secret", { ...base, headers: sameOrigin({ cookie: cookieHeader(good), "x-vf-secret": "wrong" }) }],
    ["valid token under a cookie name without __Host-", { ...base, headers: sameOrigin({ cookie: `vf_session=${good}` }) }],
  ];
  for (const [desc, event] of noCredential) await expectRefused(file, desc, event, 401);

  // Session cookies that must not get in. Each rides a same-origin request, so
  // the only thing wrong with it is the cookie.
  const badCookies = [
    ["tampered cookie signature", `${goodPayload}.${goodSig[0] === "A" ? "B" : "A"}${goodSig.slice(1)}`],
    ["tampered cookie payload (sub swapped, old signature)", `${swappedPayload}.${goodSig}`],
    ["unsigned cookie (payload only)", goodPayload],
    ["cookie with an empty signature", `${goodPayload}.`],
    ["cookie signed with the wrong key", mintToken({}, "some-other-signing-key-0123456789abcdef")],
    ["expired cookie", mintToken({ iat: at - 7200, auth: at - 7200, exp: at - 60 })],
    ["cookie past the 7-day login cap", mintToken({ iat: at - 60, auth: at - 8 * 86400, exp: at + 3600 })],
    ["cookie for a user not in VF_LOGIN_USERS", mintToken({ sub: "mallory" })],
    ["cookie from before a password change", mintToken({ pv: passwordVersion("scrypt$15$8$1$old$old") })],
    ["cookie issued in the future", mintToken({ iat: at + 3600, auth: at + 3600, exp: at + 7200 })],
    ["cookie with a non-numeric exp", mintToken({ exp: "never" })],
  ];
  for (const [desc, token] of badCookies) {
    await expectRefused(file, desc, { ...base, headers: sameOrigin({ cookie: cookieHeader(token) }) }, 401);
  }

  // CSRF: a genuine cookie on a request that isn't from the Studio's own pages.
  const crossSite = [
    ["Sec-Fetch-Site: cross-site", { host: HOST, "sec-fetch-site": "cross-site", origin: "https://evil.example" }],
    ["Sec-Fetch-Site: same-site", { host: HOST, "sec-fetch-site": "same-site", origin: `https://sub.${HOST}` }],
    ["Sec-Fetch-Site: none", { host: HOST, "sec-fetch-site": "none" }],
    ["no Sec-Fetch-Site, foreign Origin", { host: HOST, origin: "https://evil.example" }],
    ["no Sec-Fetch-Site, Origin: null", { host: HOST, origin: "null" }],
    ["no Sec-Fetch-Site and no Origin", { host: HOST }],
  ];
  for (const [desc, headers] of crossSite) {
    await expectRefused(file, `valid cookie, ${desc}`, { ...base, headers: { ...headers, cookie: cookieHeader(good) } }, 403);
  }

  // Misconfiguration must fail closed, never open.
  const failClosed = [
    ["VF_API_SECRET unset, correct secret sent", { "x-vf-secret": SECRET }, { ...ENV, VF_API_SECRET: "" }],
    ["VF_SESSION_SECRET unset, valid cookie", sameOrigin({ cookie: cookieHeader(good) }), { ...ENV, VF_SESSION_SECRET: "" }],
    ["VF_SESSION_SECRET too short, cookie signed with it", sameOrigin({ cookie: cookieHeader(mintToken({}, "short-key")) }), { ...ENV, VF_SESSION_SECRET: "short-key" }],
    ["VF_LOGIN_USERS unset, valid cookie", sameOrigin({ cookie: cookieHeader(good) }), { ...ENV, VF_LOGIN_USERS: "" }],
    ["VF_LOGIN_USERS malformed, valid cookie", sameOrigin({ cookie: cookieHeader(good) }), { ...ENV, VF_LOGIN_USERS: "{not json" }],
  ];
  for (const [desc, headers, env] of failClosed) await expectRefused(file, desc, { ...base, headers }, 401, env);

  // The guard must not block a correctly-credentialed caller. Use a method the
  // handler rejects immediately after the guard, so no real work is attempted.
  const letThrough = [
    ["correct secret", { "x-vf-secret": SECRET }, ENV],
    ["correct secret, session login not configured", { "x-vf-secret": SECRET }, { ...ENV, VF_SESSION_SECRET: "", VF_LOGIN_USERS: "" }],
    ["valid cookie, Sec-Fetch-Site: same-origin", sameOrigin({ cookie: cookieHeader(good) }), ENV],
    ["valid cookie, no Sec-Fetch-Site, Origin matches Host", { host: HOST, origin: `https://${HOST}`, cookie: cookieHeader(good) }, ENV],
    ["valid cookie, Title-Case header names", { Host: HOST, "Sec-Fetch-Site": "same-origin", Cookie: cookieHeader(good) }, ENV],
  ];
  for (const [desc, headers, env] of letThrough) {
    const { res, err, calls } = await invoke(file, { ...base, httpMethod: "DELETE", headers }, env);
    check(`${desc}: let through`, !err && res && res.statusCode !== 401 && res.statusCode !== 403,
      err ? err.message : res && `got ${res.statusCode}`);
    check(`${desc}: no outbound call (rejected on method)`, calls.length === 0, `made ${calls.length}`);
  }
}

// ─── login.js ─────────────────────────────────────────────────────────────────
async function testLogin() {
  console.log("\nlogin.js");
  const file = path.join(FUNCTIONS_DIR, "login.js");
  if (!fs.existsSync(file)) { check("login.js exists", false); return; }

  const post = (body, headers = sameOrigin()) => ({
    httpMethod: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

  for (const [desc, name] of [["correct login", "twila"], ["correct login, name typed as ' Twila '", " Twila "]]) {
    const { res, err, calls } = await invoke(file, post({ name, password: PASSWORD }), ENV);
    const cookie = setCookieOf(res);
    const token = issuedToken(res);
    const attrs = cookie.split(/;\s*/);
    const maxAge = Number((cookie.match(/Max-Age=(\d+)/) || [])[1]);

    check(`${desc}: 200`, !err && res && res.statusCode === 200, err ? err.message : res && `got ${res.statusCode} ${res.body}`);
    check(`${desc}: sets a signed __Host-vf_session cookie`, Boolean(token) && token.split(".").length === 2, cookie);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) {
      check(`${desc}: cookie has ${attr}`, attrs.includes(attr), cookie);
    }
    check(`${desc}: no Domain attribute`, !/Domain=/i.test(cookie), cookie);
    check(`${desc}: Max-Age within 12 h`, maxAge > 0 && maxAge <= 12 * 3600, cookie);
    check(`${desc}: token is not in the body`, Boolean(token) && !String(res && res.body).includes(token));
    check(`${desc}: no outbound calls`, calls.length === 0, `made ${calls.length}`);

    const used = await invoke(path.join(FUNCTIONS_DIR, "check-jobs.js"),
      { httpMethod: "DELETE", headers: sameOrigin({ cookie: cookieHeader(token) }) }, ENV);
    check(`${desc}: the issued cookie gets past check-jobs' guard`,
      used.res && used.res.statusCode !== 401 && used.res.statusCode !== 403, used.res && `got ${used.res.statusCode}`);
  }

  const refused = [
    ["wrong password", post({ name: "twila", password: "wrong password entirely" }), 401],
    ["unknown user", post({ name: "mallory", password: PASSWORD }), 401],
    ["empty password", post({ name: "twila", password: "" }), 401],
    ["non-string password", post({ name: "twila", password: 12345 }), 401],
    ["password in an array", post({ name: "twila", password: [PASSWORD] }), 401],
    ["no body", { httpMethod: "POST", headers: sameOrigin() }, 401],
    ["isAdmin in body, no password", post({ name: "twila", session: { isAdmin: true } }), 401],
    ["API secret header instead of a password", post({ name: "twila" }, sameOrigin({ "x-vf-secret": SECRET })), 401],
    ["malformed JSON", post("{nope"), 400],
    ["GET", { httpMethod: "GET", headers: sameOrigin() }, 405],
    ["cross-site POST with correct credentials", post({ name: "twila", password: PASSWORD }, { host: HOST, "sec-fetch-site": "cross-site", origin: "https://evil.example" }), 403],
    ["POST with no origin signal", post({ name: "twila", password: PASSWORD }, { host: HOST }), 403],
  ];
  for (const [desc, event, status] of refused) await expectRefused(file, `login, ${desc}`, event, status);

  const misconfigured = [
    ["VF_SESSION_SECRET unset", { ...ENV, VF_SESSION_SECRET: "" }],
    ["VF_SESSION_SECRET too short", { ...ENV, VF_SESSION_SECRET: "short-key" }],
    ["VF_LOGIN_USERS unset", { ...ENV, VF_LOGIN_USERS: "" }],
    ["VF_LOGIN_USERS not an object", { ...ENV, VF_LOGIN_USERS: "[]" }],
    ["VF_LOGIN_USERS entry with a bad hash", { ...ENV, VF_LOGIN_USERS: JSON.stringify({ twila: { hash: "plaintext", admin: true } }) }],
  ];
  for (const [desc, env] of misconfigured) {
    const { res, err, calls } = await invoke(file, post({ name: "twila", password: PASSWORD }), env);
    check(`login, ${desc}: refused`, !err && res && res.statusCode >= 400, err ? err.message : res && `got ${res.statusCode}`);
    check(`login, ${desc}: no session cookie issued`, !issuedToken(res), setCookieOf(res));
    check(`login, ${desc}: no outbound calls`, calls.length === 0);
  }
}

// ─── session.js: the one guarded function that returns 200 with no upstream ──
async function testSessionInfo() {
  console.log("\nsession.js (who is signed in)");
  const file = path.join(FUNCTIONS_DIR, "session.js");
  if (!fs.existsSync(file)) { check("session.js exists", false); return; }

  const token = mintToken();
  {
    const { res, err } = await invoke(file, { httpMethod: "GET", headers: sameOrigin({ cookie: cookieHeader(token) }) }, ENV);
    let json = {};
    try { json = JSON.parse(res.body); } catch { /* checked below */ }
    check("valid cookie: 200", !err && res && res.statusCode === 200, err ? err.message : res && `got ${res.statusCode}`);
    check("valid cookie: names the user", json.user && json.user.name === "twila" && json.via === "cookie", res && res.body);
    check("valid cookie: admin comes from VF_LOGIN_USERS", json.user && json.user.admin === true, res && res.body);
    check("valid cookie: token is not echoed", !String(res && res.body).includes(token));
  }
  {
    const env = { ...ENV, VF_LOGIN_USERS: JSON.stringify({ twila: { hash: TWILA_HASH, admin: false } }) };
    const { res } = await invoke(file, { httpMethod: "GET", headers: sameOrigin({ cookie: cookieHeader(token) }) }, env);
    let json = {};
    try { json = JSON.parse(res.body); } catch { /* checked below */ }
    check("user demoted in VF_LOGIN_USERS: admin false on the same cookie", json.user && json.user.admin === false, res && res.body);
  }
  {
    const { res, err } = await invoke(file, { httpMethod: "GET", headers: { "x-vf-secret": SECRET } }, ENV);
    let json = {};
    try { json = JSON.parse(res.body); } catch { /* checked below */ }
    check("correct secret: 200", !err && res && res.statusCode === 200, err ? err.message : res && `got ${res.statusCode}`);
    check("correct secret: via header", json.via === "header", res && res.body);
  }
}

// ─── Refresh on use ───────────────────────────────────────────────────────────
async function testRefresh() {
  console.log("\ncookie refresh on use (through check-jobs.js)");
  const file = path.join(FUNCTIONS_DIR, "check-jobs.js");
  const at = nowSec();
  const call = (headers) => invoke(file, { httpMethod: "DELETE", headers }, ENV);

  const aging = mintToken({ iat: at - 3600, auth: at - 3600, exp: at + 600 });
  const { res } = await call(sameOrigin({ cookie: cookieHeader(aging) }));
  const renewed = issuedToken(res);
  const claims = renewed ? decodeClaims(renewed) : {};
  check("aging cookie: re-issued on use", Boolean(renewed), setCookieOf(res));
  check("aging cookie: new idle expiry is later", claims.exp > at + 600, JSON.stringify(claims));
  check("aging cookie: login time is kept, not reset", claims.auth === at - 3600, JSON.stringify(claims));
  for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) {
    check(`re-issued cookie has ${attr}`, setCookieOf(res).split(/;\s*/).includes(attr), setCookieOf(res));
  }
  if (renewed) {
    const again = await call(sameOrigin({ cookie: cookieHeader(renewed) }));
    check("re-issued cookie is accepted", again.res && again.res.statusCode !== 401 && again.res.statusCode !== 403,
      again.res && `got ${again.res.statusCode}`);
  }

  const nearCap = mintToken({ iat: at - 3600, auth: at - 7 * 86400 + 300, exp: at + 200 });
  const capped = issuedToken((await call(sameOrigin({ cookie: cookieHeader(nearCap) }))).res);
  check("refresh never extends past the 7-day login cap",
    Boolean(capped) && decodeClaims(capped).exp <= at - 7 * 86400 + 300 + 7 * 86400, capped && JSON.stringify(decodeClaims(capped)));

  const fresh = await call(sameOrigin({ cookie: cookieHeader(mintToken()) }));
  check("fresh cookie: not re-issued on every call", !setCookieOf(fresh.res), setCookieOf(fresh.res));

  const header = await call({ "x-vf-secret": SECRET });
  check("header auth: no cookie issued", !setCookieOf(header.res), setCookieOf(header.res));
}

// ─── logout.js ────────────────────────────────────────────────────────────────
async function testLogout() {
  console.log("\nlogout.js");
  const file = path.join(FUNCTIONS_DIR, "logout.js");
  if (!fs.existsSync(file)) { check("logout.js exists", false); return; }

  {
    const { res, err } = await invoke(file, { httpMethod: "POST", headers: sameOrigin({ cookie: cookieHeader(mintToken()) }) }, ENV);
    const cookie = setCookieOf(res);
    check("same-origin logout: 2xx", !err && res && res.statusCode >= 200 && res.statusCode < 300, err ? err.message : res && `got ${res.statusCode}`);
    check("same-origin logout: expires the cookie", /^__Host-vf_session=;/.test(cookie) && /Max-Age=0/.test(cookie), cookie);
  }
  await expectRefused(file, "cross-site logout",
    { httpMethod: "POST", headers: { host: HOST, "sec-fetch-site": "cross-site", cookie: cookieHeader(mintToken()) } }, 403);
  await expectRefused(file, "GET logout", { httpMethod: "GET", headers: sameOrigin() }, 405);
}

// ─── Static scans ─────────────────────────────────────────────────────────────
function codeOf(file) {
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
}

function staticScan() {
  // Nothing left in the deployed functions may grant privilege from the body.
  console.log("\nstatic scan: no isAdmin in deployed functions or their lib");
  const libDir = path.join(FUNCTIONS_DIR, "lib");
  const deployed = [
    ...fs.readdirSync(FUNCTIONS_DIR).filter((f) => /\.(js|mjs)$/.test(f)).map((f) => [f, path.join(FUNCTIONS_DIR, f)]),
    ...(fs.existsSync(libDir) ? fs.readdirSync(libDir).filter((f) => /\.js$/.test(f)).map((f) => [`lib/${f}`, path.join(libDir, f)]) : []),
  ];
  for (const [f, file] of deployed) check(`${f}: no isAdmin in code`, !/isAdmin/.test(codeOf(file)));

  console.log("\nstatic scan: every guarded function runs withAuth before its own code");
  for (const name of Object.keys(CASES)) {
    const file = path.join(FUNCTIONS_DIR, name);
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8").includes("DEPRECATED")) continue;
    const code = codeOf(file);
    check(`${name}: handler wrapped in withAuth`, /exports\.handler = withAuth\(async \(event(, context, auth)?\) => \{/.test(code));
    check(`${name}: no private isAuthorized copy`, !/function isAuthorized/.test(code));
  }

  console.log("\nstatic scan: lib/require-auth.js takes nothing from the body");
  const guardFile = path.join(libDir, "require-auth.js");
  const guard = fs.existsSync(guardFile) ? codeOf(guardFile) : "";
  check("require-auth.js exists", Boolean(guard));
  check("require-auth.js never reads event.body or parses JSON", guard && !/\.body\b|JSON\.parse/.test(guard));
  check("require-auth.js never reads x-session", guard && !/x-session/.test(guard));
  check("require-auth.js compares the secret with timingSafeEqual", /timingSafeEqual/.test(guard));

  // The browser bundle must never learn a verifying secret.
  console.log("\nstatic scan: no server secret referenced from src/");
  const srcDir = path.join(__dirname, "..", "src");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : /\.(js|jsx|ts|tsx)$/.test(d.name) ? [path.join(dir, d.name)] : []);
  if (fs.existsSync(srcDir)) {
    for (const file of walk(srcDir)) {
      const hit = fs.readFileSync(file, "utf8").match(/VF_API_SECRET|VF_SESSION_SECRET|VF_LOGIN_USERS|FAL_KEY|scrypt\$/);
      check(`${path.relative(srcDir, file)}: no server secret`, !hit, hit && hit[0]);
    }
  }
}

(async () => {
  for (const [name, base] of Object.entries(CASES)) await testFunction(name, base);
  await testLogin();
  await testSessionInfo();
  await testRefresh();
  await testLogout();
  staticScan();

  console.log(`\n${"=".repeat(50)}\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
