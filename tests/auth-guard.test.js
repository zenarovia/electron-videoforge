// tests/auth-guard.test.js — regression test for the x-vf-secret guard.
//
// Run with:  node tests/auth-guard.test.js
// No test framework needed; exits non-zero on failure.
//
// Every Netlify function that reaches for an admin credential in process.env
// must refuse a request that does not carry the shared secret, and must refuse
// it BEFORE making any outbound call. These functions used to decide that from
// `session.isAdmin` in the unverified request body, so a stranger who knew the
// URL could spend the account's fal / Higgsfield / Claude / Fish Audio balance
// or write to Airtable. global.fetch is stubbed so any outbound attempt is
// recorded and fails loudly.
//
// log-url.js and save-export.js spend no credits but write to Netlify Blobs
// under a caller-supplied id. @netlify/blobs is pointed at a fake site below,
// so an unguarded write shows up here as a recorded fetch.

const fs = require("fs");
const path = require("path");

// @netlify/blobs retries a failed fetch 5 times, 5 s apart, unless NODE_ENV is
// "test" (1 ms). It reads this once at load, so set it before any require.
process.env.NODE_ENV = "test";

const FUNCTIONS_DIR = path.join(__dirname, "..", "netlify", "functions");
const SECRET = "test-secret-value-123";

const ENV = {
  VF_API_SECRET: SECRET,
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

// A leaked admin credential is the failure that actually costs money.
function assertNoLeak(calls, label) {
  const leaked = calls.find((c) => c.auth && /fake-(fal|higgs|claude|airtable|fish|blobs)/.test(String(c.auth)));
  check(`${label}: admin credential not sent upstream`, !leaked, leaked && String(leaked.auth));
}

async function testFunction(name, base) {
  const file = path.join(FUNCTIONS_DIR, name);
  if (!fs.existsSync(file)) return;
  if (fs.readFileSync(file, "utf8").includes("DEPRECATED")) {
    console.log(`\nSKIP ${name} (410 deprecation stub)`);
    return;
  }
  console.log(`\n${name}`);

  const rejected = [
    ["no header", { ...base, headers: {} }],
    ["no headers object", { ...base }],
    ["wrong secret, same length", { ...base, headers: { "x-vf-secret": "X".repeat(SECRET.length) } }],
    ["wrong secret, different length", { ...base, headers: { "x-vf-secret": "short" } }],
    ["empty secret", { ...base, headers: { "x-vf-secret": "" } }],
    ["non-string secret", { ...base, headers: { "x-vf-secret": 12345 } }],
    // The pattern this fix removed: privilege claimed in the request body.
    ["isAdmin in body", { ...base, headers: {}, body: JSON.stringify({ ...JSON.parse(base.body || "{}"), session: { isAdmin: true } }) }],
  ];

  for (const [desc, event] of rejected) {
    const { res, err, calls } = await invoke(file, event, ENV);
    check(`${desc}: no throw`, !err, err && err.message);
    check(`${desc}: 401`, res && res.statusCode === 401, res && `got ${res.statusCode}`);
    check(`${desc}: zero outbound calls`, calls.length === 0, `made ${calls.length}: ${calls.map((c) => c.url).join(", ")}`);
    assertNoLeak(calls, desc);
  }

  // The guard must not block a correctly-signed caller. Use a method the handler
  // rejects immediately after the guard, so no real work is attempted.
  const good = { ...base, httpMethod: "DELETE", headers: { "x-vf-secret": SECRET } };
  {
    const { res, err, calls } = await invoke(file, good, ENV);
    check("correct secret: not 401", !err && res && res.statusCode !== 401, err ? err.message : res && `got ${res.statusCode}`);
    check("correct secret: no outbound call (rejected on method)", calls.length === 0, `made ${calls.length}`);
  }

  // Misconfiguration must fail closed, never open.
  {
    const { res, err, calls } = await invoke(file, { ...base, headers: { "x-vf-secret": SECRET } }, { ...ENV, VF_API_SECRET: "" });
    check("VF_API_SECRET unset: 401", !err && res && res.statusCode === 401, err ? err.message : res && `got ${res.statusCode}`);
    check("VF_API_SECRET unset: zero outbound calls", calls.length === 0, `made ${calls.length}`);
    assertNoLeak(calls, "VF_API_SECRET unset");
  }
}

(async () => {
  for (const [name, base] of Object.entries(CASES)) await testFunction(name, base);

  // Nothing left in the deployed functions may grant privilege from the body.
  console.log("\nstatic scan: no session.isAdmin left in deployed functions");
  for (const f of fs.readdirSync(FUNCTIONS_DIR)) {
    if (!/\.(js|mjs)$/.test(f)) continue;
    const code = fs.readFileSync(path.join(FUNCTIONS_DIR, f), "utf8")
      .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    check(`${f}: no isAdmin in code`, !/isAdmin/.test(code));
  }

  console.log(`\n${"=".repeat(50)}\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
