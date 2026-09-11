// tests/image-batch.test.js — regression test for submit-images.js:
//   • the scene count derived from narration length (lib/scene-count.js)
//   • the 15-seconds-per-image acceptance standard
//   • variable-length prompt batches, aspect ratios, model + quality passthrough
//   • gpt-image-2 sized by image_size (it has no aspect_ratio), raw endpoint ids
//   • the x-vf-secret guard, which none of the above may weaken
//
// Run with:  node tests/image-batch.test.js
// No test framework needed; exits non-zero on failure.
//
// NOTHING HERE SPENDS MONEY. global.fetch is replaced by a stub that answers as
// fal's queue API would; a request that escapes to the real fal is impossible
// because the real fetch is never reachable from inside a test.
//
// ─── Negative control ────────────────────────────────────────────────────────
// Point VF_FUNCTIONS_DIR at a checkout of the pre-change functions and these
// tests must FAIL — that is what proves they are testing something:
//
//   node tests/image-batch.test.js                    # against this working tree
//   VF_FUNCTIONS_DIR=/tmp/old node tests/...test.js   # against the old code

const fs = require("fs");
const path = require("path");

const FUNCTIONS_DIR = process.env.VF_FUNCTIONS_DIR || path.join(__dirname, "..", "netlify", "functions");
const SUBMIT_IMAGES = path.join(FUNCTIONS_DIR, "submit-images.js");
const SECRET = "test-secret-value-123";

const ENV = { VF_API_SECRET: SECRET, FAL_KEY: "fake-fal-key" };

let pass = 0;
let fail = 0;

function check(label, cond, detail) {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`); }
}

function section(name) {
  console.log(`\n${name}`);
}

// ─── Harness ─────────────────────────────────────────────────────────────────
// Every outbound call is captured. The stub returns a plausible fal queue
// response so the handler's success path runs end to end without a network.
async function invoke(bodyObj, { headers, httpMethod, env, falStatus } = {}) {
  delete require.cache[require.resolve(SUBMIT_IMAGES)];

  const calls = [];
  const realFetch = global.fetch;
  let n = 0;
  global.fetch = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url: String(url), headers: (opts && opts.headers) || {}, body });
    if (falStatus && falStatus !== 200) {
      return { ok: false, status: falStatus, text: async () => "stub upstream error", json: async () => ({}) };
    }
    const id = `req-${n++}`;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        request_id: id,
        status: "IN_QUEUE",
        status_url: `https://queue.fal.run/x/requests/${id}/status`,
        response_url: `https://queue.fal.run/x/requests/${id}`,
      }),
    };
  };

  const effectiveEnv = env || ENV;
  const saved = {};
  for (const [k, v] of Object.entries(effectiveEnv)) { saved[k] = process.env[k]; process.env[k] = v; }

  const event = {
    httpMethod: httpMethod || "POST",
    headers: headers === undefined ? { "x-vf-secret": SECRET } : headers,
    body: bodyObj === undefined ? undefined : JSON.stringify(bodyObj),
  };

  try {
    const res = await require(SUBMIT_IMAGES).handler(event, {});
    let parsed = null;
    try { parsed = JSON.parse(res.body); } catch { /* non-JSON body */ }
    return { res, json: parsed, calls };
  } catch (err) {
    return { err, calls };
  } finally {
    global.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

// Safe accessors. Against the pre-change code these response fields do not
// exist, and a negative-control run has to report that as a row of failures
// rather than crash on the first one.
const J = (json) => (json && Array.isArray(json.jobs) ? json.jobs : [{}]);
const P = (json) => (json && json.pacing ? json.pacing : {});

const promptsOf = (n) => Array.from({ length: n }, (_, i) => `scene ${i + 1} prompt`);

// A script of exactly `words` words, so the word-count estimator is exercised
// the way the real pipeline exercises it.
const scriptOf = (words) => Array.from({ length: words }, () => "word").join(" ");

(async () => {
  // ─── 1. The scene-count rule ───────────────────────────────────────────────
  section("scene-count math (lib/scene-count.js)");
  let sc = null;
  try {
    sc = require(path.join(FUNCTIONS_DIR, "lib", "scene-count.js"));
  } catch (err) {
    check("lib/scene-count.js is present", false, err.message);
  }

  if (sc) {
    check("SECONDS_PER_SCENE is 12", sc.SECONDS_PER_SCENE === 12, String(sc.SECONDS_PER_SCENE));
    check("MIN_SCENES is 8", sc.MIN_SCENES === 8, String(sc.MIN_SCENES));
    check("MAX_SECONDS_ON_SCREEN is 15", sc.MAX_SECONDS_ON_SCREEN === 15, String(sc.MAX_SECONDS_ON_SCREEN));

    // The table from the acceptance standard.
    for (const [durationSec, expected] of [[90, 8], [120, 10], [180, 15]]) {
      const got = sc.resolveSceneCount({ durationSec }).sceneCount;
      check(`${durationSec}s -> ${expected} scenes`, got === expected, `got ${got}`);
    }

    // Short videos floor at the minimum rather than dropping below it.
    for (const [durationSec, expected] of [[1, 8], [30, 8], [96, 8], [97, 9], [300, 25], [600, 50]]) {
      const got = sc.resolveSceneCount({ durationSec }).sceneCount;
      check(`${durationSec}s -> ${expected} scenes`, got === expected, `got ${got}`);
    }

    // The 15s ceiling must hold for every duration, not just the sampled ones.
    let worst = 0;
    let worstAt = 0;
    for (let d = 1; d <= 3600; d++) {
      const { sceneCount } = sc.resolveSceneCount({ durationSec: d });
      const perScene = d / sceneCount;
      if (perScene > worst) { worst = perScene; worstAt = d; }
    }
    check(
      "no duration 1..3600s ever exceeds 15s per image",
      worst <= sc.MAX_SECONDS_ON_SCREEN,
      `worst ${worst.toFixed(2)}s at ${worstAt}s`
    );
    check("worst case stays at or under the 12s target", worst <= 12, `worst ${worst.toFixed(2)}s at ${worstAt}s`);

    // Duration estimated from the script at 2.5 words/sec.
    check("250 words -> 100s estimate", sc.estimateDurationSec(scriptOf(250)) === 100, String(sc.estimateDurationSec(scriptOf(250))));
    check("225-word script -> 8 scenes", sc.resolveSceneCount({ script: scriptOf(225) }).sceneCount === 8);
    check("750-word script -> 25 scenes", sc.resolveSceneCount({ script: scriptOf(750) }).sceneCount === 25);
    check(
      "script estimate is labelled as an estimate",
      sc.resolveSceneCount({ script: scriptOf(225) }).source === "estimated-from-script"
    );

    // Overrides.
    check("durationSec beats the script estimate", sc.resolveSceneCount({ script: scriptOf(225), durationSec: 180 }).sceneCount === 15);
    check("explicit sceneCount wins", sc.resolveSceneCount({ durationSec: 180, sceneCount: 20 }).sceneCount === 20);
    check("no duration info falls back to the minimum", sc.resolveSceneCount({}).sceneCount === 8);
    check("no duration info reports a null duration", sc.resolveSceneCount({}).durationSec === null);

    // The hard assertion: an override that breaches 15s must throw, not warn.
    let threw = null;
    try { sc.resolveSceneCount({ durationSec: 300, sceneCount: 8 }); } catch (e) { threw = e; }
    check("under-scened override throws", threw instanceof sc.PacingError, threw && threw.name);
    check("the throw names the shortfall", threw && /15s maximum/.test(threw.message), threw && threw.message);
    check("the throw carries the numbers", threw && threw.pacing && threw.pacing.secondsPerScene === 37.5);

    let ok = null;
    try { sc.resolveSceneCount({ durationSec: 300, sceneCount: 20 }); } catch (e) { ok = e; }
    check("an adequately-scened override does not throw", ok === null, ok && ok.message);

    let bad = null;
    try { sc.resolveSceneCount({ sceneCount: 0 }); } catch (e) { bad = e; }
    check("sceneCount 0 is rejected", bad instanceof sc.PacingError);
  }

  // ─── 2. Auth still holds ───────────────────────────────────────────────────
  section("auth guard (must not be weakened by any of the above)");
  const base = { prompts: promptsOf(8) };
  for (const [desc, headers] of [
    ["no header", {}],
    ["wrong secret, same length", { "x-vf-secret": "X".repeat(SECRET.length) }],
    ["wrong secret, different length", { "x-vf-secret": "short" }],
    ["empty secret", { "x-vf-secret": "" }],
    ["non-string secret", { "x-vf-secret": 12345 }],
  ]) {
    const { res, err, calls } = await invoke(base, { headers });
    check(`${desc}: 401`, !err && res && res.statusCode === 401, err ? err.message : res && `got ${res.statusCode}`);
    check(`${desc}: zero outbound calls`, calls.length === 0, `made ${calls.length}`);
  }
  {
    // Privilege claimed in the body must not resurrect the old admin path.
    const { res, calls } = await invoke({ ...base, session: { isAdmin: true } }, { headers: {} });
    check("isAdmin in body: 401", res && res.statusCode === 401, res && `got ${res.statusCode}`);
    check("isAdmin in body: zero outbound calls", calls.length === 0, `made ${calls.length}`);
  }
  {
    const { res, calls } = await invoke(base, { env: { ...ENV, VF_API_SECRET: "" } });
    check("VF_API_SECRET unset: 401", res && res.statusCode === 401, res && `got ${res.statusCode}`);
    check("VF_API_SECRET unset: zero outbound calls", calls.length === 0, `made ${calls.length}`);
  }
  {
    const { res, calls } = await invoke(base, { httpMethod: "DELETE" });
    check("wrong method: not 401, no spend", res && res.statusCode === 405, res && `got ${res.statusCode}`);
    check("wrong method: zero outbound calls", calls.length === 0, `made ${calls.length}`);
  }

  // ─── 3. Batches of any length ──────────────────────────────────────────────
  section("variable-length prompt batches");
  for (const n of [1, 2, 8, 11, 30, 60]) {
    const { res, json, calls } = await invoke({ prompts: promptsOf(n) });
    check(`${n} prompts: 200`, res && res.statusCode === 200, res && `${res.statusCode} ${res.body}`);
    check(`${n} prompts: ${n} jobs returned`, json && json.jobs && json.jobs.length === n, json && json.jobs && `got ${json.jobs.length}`);
    check(`${n} prompts: ${n} fal submissions`, calls.length === n, `made ${calls.length}`);
    check(`${n} prompts: sceneCount reported`, json && json.sceneCount === n, json && String(json.sceneCount));
    check(
      `${n} prompts: every job has a requestId`,
      json && J(json).every((j) => typeof j.requestId === "string" && j.requestId)
    );
    check(
      `${n} prompts: each prompt submitted exactly once`,
      new Set(calls.map((c) => c.body.prompt)).size === n
    );
  }
  {
    const { res, json, calls } = await invoke({ prompts: promptsOf(61) });
    check("61 prompts: 400", res && res.statusCode === 400, res && `got ${res.statusCode}`);
    check("61 prompts: no spend", calls.length === 0, `made ${calls.length}`);
    check("61 prompts: says why", json && /60/.test(json.error), json && json.error);
  }
  for (const [desc, body] of [
    ["empty array", { prompts: [] }],
    ["missing prompts", {}],
    ["prompts not an array", { prompts: "a" }],
    ["a non-string prompt", { prompts: ["ok", 42] }],
    ["a blank prompt", { prompts: ["ok", "   "] }],
  ]) {
    const { res, calls } = await invoke(body);
    check(`${desc}: 400`, res && res.statusCode === 400, res && `got ${res.statusCode}`);
    check(`${desc}: no spend`, calls.length === 0, `made ${calls.length}`);
  }

  // ─── 4. Backward compatibility ─────────────────────────────────────────────
  section("backward compatibility: the existing 8-prompt call");
  {
    const { res, json, calls } = await invoke({ prompts: promptsOf(8), imageModel: "nano_banana_2" });
    check("8 prompts: 200", res && res.statusCode === 200, res && `${res.statusCode} ${res.body}`);
    check("8 prompts: 8 submissions", calls.length === 8, `made ${calls.length}`);
    check("8 prompts: all in one batch (concurrency >= 8)", calls.length === 8);
    check("default endpoint unchanged", json && json.endpoint === "fal-ai/nano-banana-2", json && json.endpoint);
    check("default aspect ratio unchanged", calls.every((c) => c.body.aspect_ratio === "9:16"));
    check("num_images unchanged", calls.every((c) => c.body.num_images === 1));
    check("no quality sent when not asked for", calls.every((c) => c.body.quality === undefined));
    check(
      "payload byte-identical to the old call",
      calls.every((c, i) => JSON.stringify(c.body) === JSON.stringify({ prompt: `scene ${i + 1} prompt`, aspect_ratio: "9:16", num_images: 1 })),
      calls[0] && JSON.stringify(calls[0].body)
    );
    check("response still carries jobs + endpoint", json && Array.isArray(json.jobs) && typeof json.endpoint === "string");
    check("jobs still carry index for the Studio UI", json && J(json).every((j, i) => j.index === i));
    check("fal key sent as a fal Key header", calls.every((c) => c.headers.Authorization === "Key fake-fal-key"));
  }
  {
    // Model default when imageModel is omitted entirely.
    const { json } = await invoke({ prompts: promptsOf(8) });
    check("omitted imageModel defaults to nano-banana-2", json && json.endpoint === "fal-ai/nano-banana-2", json && json.endpoint);
  }

  // ─── 5. check-jobs compatibility ───────────────────────────────────────────
  section("job shape matches submit-animations so check-jobs polls it unchanged");
  {
    const { json } = await invoke({ prompts: promptsOf(3) });
    const keys = ["sceneIndex", "requestId", "endpoint", "statusUrl", "responseUrl", "status"];
    for (const k of keys) {
      check(`job has ${k}`, json && J(json).every((j) => k in j));
    }
    check("sceneIndex matches position", json && J(json).every((j, i) => j.sceneIndex === i));
    check("statusUrl passed through from fal", json && J(json).every((j) => /\/status$/.test(j.statusUrl)));
    check("status defaults to IN_QUEUE", json && J(json).every((j) => j.status === "IN_QUEUE"));
  }

  // ─── 6. Aspect ratios ──────────────────────────────────────────────────────
  section("aspect ratios");
  for (const ratio of ["9:16", "3:4", "4:5", "1:1", "16:9", "4:3"]) {
    const { res, json, calls } = await invoke({ prompts: promptsOf(2), aspectRatio: ratio });
    check(`${ratio}: 200`, res && res.statusCode === 200, res && `${res.statusCode} ${res.body}`);
    check(`${ratio}: forwarded to fal on every job`, calls.length === 2 && calls.every((c) => c.body.aspect_ratio === ratio),
      calls.map((c) => c.body.aspect_ratio).join(","));
    check(`${ratio}: echoed in the response`, json && json.aspectRatio === ratio, json && json.aspectRatio);
  }
  {
    const { res, calls } = await invoke({ prompts: promptsOf(2), aspectRatio: "banana" });
    check("bad aspect ratio: 400", res && res.statusCode === 400, res && `got ${res.statusCode}`);
    check("bad aspect ratio: no spend", calls.length === 0, `made ${calls.length}`);
  }

  // ─── 7. Model + quality ────────────────────────────────────────────────────
  section("imageModel and quality passthrough");
  for (const [id, endpoint] of [
    ["nano_banana_2", "fal-ai/nano-banana-2"],
    ["gpt_image_2", "openai/gpt-image-2"],
    ["seedream_v4_5", "fal-ai/seedream-v4-5"],
  ]) {
    const { json, calls } = await invoke({ prompts: promptsOf(1), imageModel: id });
    check(`${id} -> ${endpoint}`, json && json.endpoint === endpoint, json && json.endpoint);
    check(`${id}: fal URL uses that endpoint`, calls[0] && calls[0].url === `https://queue.fal.run/${endpoint}`, calls[0] && calls[0].url);
  }
  {
    const { res, calls } = await invoke({ prompts: promptsOf(1), imageModel: "not a model" });
    check("unknown imageModel: 400", res && res.statusCode === 400, res && `got ${res.statusCode}`);
    check("unknown imageModel: no spend", calls.length === 0, `made ${calls.length}`);
  }
  {
    // MBL needs on-image text to render legibly.
    const { json, calls } = await invoke({ prompts: promptsOf(2), imageModel: "gpt_image_2", quality: "high" });
    check("quality high reaches fal for gpt_image_2", calls.every((c) => c.body.quality === "high"));
    check("quality high reported as applied", json && json.qualityApplied === true);
  }
  {
    // A model with no quality parameter must not be sent one (fal 422s on it).
    const { json, calls } = await invoke({ prompts: promptsOf(2), imageModel: "nano_banana_2", quality: "high" });
    check("quality not forwarded to a model that lacks it", calls.every((c) => c.body.quality === undefined));
    check("and the response says so", json && json.qualityApplied === false);
  }
  {
    const { res, calls } = await invoke({ prompts: promptsOf(1), quality: "ultra" });
    check("bad quality: 400", res && res.statusCode === 400, res && `got ${res.statusCode}`);
    check("bad quality: no spend", calls.length === 0, `made ${calls.length}`);
  }

  // ─── 7b. gpt-image-2 is sized by image_size, not aspect_ratio ─────────────
  // fal serves GPT Image 2 as openai/gpt-image-2 and it has no aspect_ratio
  // field: one sent to it is ignored and the image comes back in the model's
  // default landscape 4:3. Every ratio must arrive as an explicit size inside
  // fal's documented limits (multiples of 16, long edge <= 3840, ratio <= 3:1,
  // 655,360..8,294,400 pixels).
  section("gpt-image-2: aspectRatio becomes image_size");
  for (const ratio of ["9:16", "3:4", "4:5", "1:1", "4:3", "16:9", "2:3", "3:2", "21:9"]) {
    const { res, json, calls } = await invoke({ prompts: promptsOf(2), imageModel: "gpt_image_2", aspectRatio: ratio });
    const size = calls[0] && calls[0].body.image_size;
    const sized = !!size && Number.isInteger(size.width) && Number.isInteger(size.height);
    const [rw, rh] = ratio.split(":").map(Number);
    check(`gpt ${ratio}: 200`, res && res.statusCode === 200, res && `${res.statusCode} ${res.body}`);
    check(`gpt ${ratio}: posted to openai/gpt-image-2`,
      calls.length === 2 && calls.every((c) => c.url === "https://queue.fal.run/openai/gpt-image-2"), calls[0] && calls[0].url);
    check(`gpt ${ratio}: no aspect_ratio sent`, calls.length === 2 && calls.every((c) => !("aspect_ratio" in c.body)));
    check(`gpt ${ratio}: image_size is {width, height}`, sized, JSON.stringify(size));
    if (sized) {
      const { width: w, height: h } = size;
      check(`gpt ${ratio}: exact ratio`, w * rh === h * rw, `${w}x${h}`);
      check(`gpt ${ratio}: multiples of 16`, w % 16 === 0 && h % 16 === 0, `${w}x${h}`);
      check(`gpt ${ratio}: long edge <= 3840`, Math.max(w, h) <= 3840, `${w}x${h}`);
      check(`gpt ${ratio}: ratio <= 3:1`, Math.max(w, h) / Math.min(w, h) <= 3, `${w}x${h}`);
      check(`gpt ${ratio}: pixel count within fal's bounds`, w * h >= 655360 && w * h <= 8294400, String(w * h));
    }
    check(`gpt ${ratio}: same size on every job`, sized && calls.every((c) => JSON.stringify(c.body.image_size) === JSON.stringify(size)));
    check(`gpt ${ratio}: size echoed in the response`, sized && json && JSON.stringify(json.imageSize) === JSON.stringify(size),
      json && JSON.stringify(json.imageSize));
  }
  {
    // MBL: portrait 3:4, high quality so on-image text renders legibly.
    const { json, calls } = await invoke({ prompts: promptsOf(11), imageModel: "gpt_image_2", aspectRatio: "3:4", quality: "high" });
    check("MBL call: 11 submissions", calls.length === 11, `made ${calls.length}`);
    check(
      "MBL call: exact payload",
      calls[0] && JSON.stringify(calls[0].body) ===
        JSON.stringify({ prompt: "scene 1 prompt", image_size: { width: 1152, height: 1536 }, num_images: 1, quality: "high" }),
      calls[0] && JSON.stringify(calls[0].body)
    );
    check("MBL call: quality reported as applied", json && json.qualityApplied === true);
  }
  {
    const { json, calls } = await invoke({ prompts: promptsOf(1), imageModel: "gpt_image_2" });
    check("gpt with no aspectRatio: 9:16 portrait",
      calls[0] && JSON.stringify(calls[0].body.image_size) === JSON.stringify({ width: 864, height: 1536 }), calls[0] && JSON.stringify(calls[0].body));
    check("gpt with no quality: none sent, fal's default applies", calls[0] && !("quality" in calls[0].body));
    check("nano-banana-2 reports no imageSize", (await invoke({ prompts: promptsOf(1) })).json?.imageSize === null);
    check("gpt response reports the endpoint", json && json.endpoint === "openai/gpt-image-2", json && json.endpoint);
  }

  // ─── 7c. Raw endpoint ids ──────────────────────────────────────────────────
  section("raw fal endpoint ids");
  for (const raw of ["fal-ai/nano-banana-2", "openai/gpt-image-2", "fal-ai/bytedance/seedream/v4.5/text-to-image"]) {
    const { res, calls } = await invoke({ prompts: promptsOf(1), imageModel: raw });
    check(`raw ${raw}: 200`, res && res.statusCode === 200, res && `${res.statusCode} ${res.body}`);
    check(`raw ${raw}: posted to that endpoint`, calls[0] && calls[0].url === `https://queue.fal.run/${raw}`, calls[0] && calls[0].url);
  }
  {
    const { calls } = await invoke({ prompts: promptsOf(1), imageModel: "openai/gpt-image-2", aspectRatio: "3:4" });
    check("raw openai/gpt-image-2 is sized too",
      calls[0] && JSON.stringify(calls[0].body.image_size) === JSON.stringify({ width: 1152, height: 1536 }), calls[0] && JSON.stringify(calls[0].body));
  }
  for (const bad of ["fal-ai/a/../../x", "openai/../fal-ai/x", "fal-ai/./x", "fal-ai//x", "https://evil.example/x", "fal-ai", "/fal-ai/x", "fal-ai/X"]) {
    const { res, calls } = await invoke({ prompts: promptsOf(1), imageModel: bad });
    check(`raw ${JSON.stringify(bad)}: 400`, res && res.statusCode === 400, res && `got ${res.statusCode}`);
    check(`raw ${JSON.stringify(bad)}: no spend`, calls.length === 0, `made ${calls.length}`);
  }

  // ─── 8. The 15-second standard, enforced at the endpoint ───────────────────
  section("15-second acceptance standard");
  {
    // 300s of narration across 8 images is 37.5s each — the exact bug this task
    // exists to close. It must fail, and fail for free.
    const { res, json, calls } = await invoke({ prompts: promptsOf(8), durationSec: 300 });
    check("8 images for 300s: 400", res && res.statusCode === 400, res && `got ${res.statusCode}`);
    check("8 images for 300s: no spend", calls.length === 0, `made ${calls.length}`);
    check("8 images for 300s: names the 15s ceiling", json && /15s maximum/.test(json.error), json && json.error);
    check("8 images for 300s: says how many are needed", json && json.recommendedSceneCount === 25, json && String(json.recommendedSceneCount));
  }
  {
    const { res, json } = await invoke({ prompts: promptsOf(25), durationSec: 300 });
    check("25 images for 300s: 200", res && res.statusCode === 200, res && `${res.statusCode} ${res.body}`);
    check("25 images for 300s: 12s per image", json && Math.abs(P(json).secondsPerImage - 12) < 1e-9, json && String(P(json).secondsPerImage));
  }
  {
    // Same failure reached via the script estimate rather than an explicit duration.
    const { res, json, calls } = await invoke({ prompts: promptsOf(8), script: scriptOf(750) });
    check("8 images for a 750-word script: 400", res && res.statusCode === 400, res && `got ${res.statusCode}`);
    check("8 images for a 750-word script: no spend", calls.length === 0, `made ${calls.length}`);
    check("8 images for a 750-word script: recommends 25", json && json.recommendedSceneCount === 25, json && String(json.recommendedSceneCount));
  }
  {
    const { res, json } = await invoke({ prompts: promptsOf(8), durationSec: 90 });
    check("8 images for 90s: 200 (the standard's own example)", res && res.statusCode === 200, res && `${res.statusCode} ${res.body}`);
    check("8 images for 90s: 11.25s per image", json && Math.abs(P(json).secondsPerImage - 11.25) < 1e-9, json && String(P(json).secondsPerImage));
    check("8 images for 90s: duration source recorded", json && P(json).durationSource === "durationSec", json && P(json).durationSource);
  }
  {
    // Exactly at the boundary: 120s over 8 images is 15.0s — allowed, not over.
    const { res } = await invoke({ prompts: promptsOf(8), durationSec: 120 });
    check("exactly 15.0s per image is allowed", res && res.statusCode === 200, res && `got ${res.statusCode}`);
    const over = await invoke({ prompts: promptsOf(8), durationSec: 120.8 });
    check("15.1s per image is not", over.res && over.res.statusCode === 400, over.res && `got ${over.res.statusCode}`);
  }
  {
    // The image-batch skills send no narration at all — nothing to pace against.
    const { res, json } = await invoke({ prompts: promptsOf(11), aspectRatio: "3:4" });
    check("no narration: 200", res && res.statusCode === 200, res && `got ${res.statusCode}`);
    check("no narration: duration reported as null", json && P(json).durationSec === null);
    check("no narration: still recommends the minimum", json && json.recommendedSceneCount === 8, json && String(json.recommendedSceneCount));
  }
  {
    // A script alone, with no prompts, tells the caller how many to write.
    const { res, json, calls } = await invoke({ script: scriptOf(300) });
    check("script with no prompts: 400", res && res.statusCode === 400, res && `got ${res.statusCode}`);
    check("script with no prompts: no spend", calls.length === 0, `made ${calls.length}`);
    check("script with no prompts: reports the count to write", json && json.recommendedSceneCount === 10, json && String(json.recommendedSceneCount));
  }

  // ─── 9. Concurrency and retry ──────────────────────────────────────────────
  section("concurrency cap and retry");
  {
    const { res, calls } = await invoke({ prompts: promptsOf(30), concurrency: 4 });
    check("concurrency 4 with 30 prompts: 200", res && res.statusCode === 200, res && `got ${res.statusCode}`);
    check("concurrency 4: all 30 still submitted", calls.length === 30, `made ${calls.length}`);
  }
  for (const bad of [0, 17, 2.5, "8"]) {
    const { res, calls } = await invoke({ prompts: promptsOf(2), concurrency: bad });
    check(`concurrency ${JSON.stringify(bad)}: 400`, res && res.statusCode === 400, res && `got ${res.statusCode}`);
    check(`concurrency ${JSON.stringify(bad)}: no spend`, calls.length === 0, `made ${calls.length}`);
  }
  {
    // A 500 from fal is retried; a failed job is reported, not thrown away, and
    // does not take the rest of the batch down with it.
    const { res, json, calls } = await invoke({ prompts: promptsOf(2) }, { falStatus: 500 });
    check("fal 500: still 200 overall", res && res.statusCode === 200, res && `got ${res.statusCode}`);
    check("fal 500: retried 3x per prompt", calls.length === 6, `made ${calls.length}`);
    check("fal 500: jobs marked FAILED", json && J(json).every((j) => j.status === "FAILED"));
    check("fal 500: failure count reported", json && json.failed === 2 && json.submitted === 0);
    check("fal 500: error text kept", json && J(json).every((j) => /500/.test(j.error || "")));
  }
  {
    // A 400 from fal is the request being wrong — retrying just wastes time.
    const { calls } = await invoke({ prompts: promptsOf(2) }, { falStatus: 400 });
    check("fal 400: not retried", calls.length === 2, `made ${calls.length}`);
  }

  // ─── 10. Misconfiguration ──────────────────────────────────────────────────
  section("misconfiguration");
  {
    const { res, calls } = await invoke({ prompts: promptsOf(2) }, { env: { VF_API_SECRET: SECRET } });
    check("FAL_KEY unset: 500", res && res.statusCode === 500, res && `got ${res.statusCode}`);
    check("FAL_KEY unset: no outbound call", calls.length === 0, `made ${calls.length}`);
  }
  {
    const { res, calls } = await invoke(undefined, {});
    check("no body at all: 400 or 401, never a submission", res && res.statusCode !== 200);
    check("no body at all: no spend", calls.length === 0, `made ${calls.length}`);
  }

  // ─── 11. Nothing here reintroduces the body-granted admin path ─────────────
  section("static scan");
  {
    const code = fs.readFileSync(SUBMIT_IMAGES, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    check("no isAdmin in submit-images.js", !/isAdmin/.test(code));
    check("timingSafeEqual still used", /timingSafeEqual/.test(code));
    check("guard is the first statement in the handler", /handler = async \(event\) => \{\s*if \(!isAuthorized\(event\)\)/.test(code));
  }

  // ─── 12. prompts.js asks Claude for the derived number of scenes ───────────
  // Without this the scene count is inert for the video pipeline: submit-images
  // would accept 25 prompts, but nothing would ever write more than 8.
  section("prompts.js derives the same count");
  {
    const PROMPTS_FN = path.join(FUNCTIONS_DIR, "prompts.js");

    async function invokePrompts(body) {
      delete require.cache[require.resolve(PROMPTS_FN)];
      const calls = [];
      const realFetch = global.fetch;
      global.fetch = async (url, opts) => {
        const sent = JSON.parse(opts.body);
        calls.push({ url: String(url), sent });
        // Answer with exactly as many prompts as the message asked for, so the
        // handler's own length check is what decides pass/fail.
        const asked = /write exactly (\d+) scene image prompts/.exec(sent.messages[0].content);
        const n = asked ? Number(asked[1]) : 0;
        const arr = Array.from({ length: n }, (_, i) => `p${i + 1}`);
        return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(arr) }] }) };
      };
      const saved = {};
      const env = { VF_API_SECRET: SECRET, CLAUDE_API_KEY: "fake-claude-key" };
      for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }
      try {
        const res = await require(PROMPTS_FN).handler(
          { httpMethod: "POST", headers: { "x-vf-secret": SECRET }, body: JSON.stringify(body) }, {}
        );
        let parsed = null;
        try { parsed = JSON.parse(res.body); } catch { /* non-JSON */ }
        return { res, json: parsed, calls };
      } catch (err) {
        return { err, calls };
      } finally {
        global.fetch = realFetch;
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
      }
    }

    // 225 words ≈ 90s ≈ the standard's own example, and still 8 — unchanged.
    {
      const { res, json, calls } = await invokePrompts({ script: scriptOf(225) });
      check("90s-equivalent script: 200", res && res.statusCode === 200, res && `${res.statusCode} ${res.body}`);
      check("90s-equivalent script: 8 prompts", json && json.prompts && json.prompts.length === 8, json && json.prompts && String(json.prompts.length));
      check("90s-equivalent script: asked Claude for 8", calls[0] && /write exactly 8 scene image prompts/.test(calls[0].sent.messages[0].content));
      check("90s-equivalent script: reports sceneCount", json && json.sceneCount === 8, json && String(json.sceneCount));
    }
    // 750 words ≈ 300s, which is where the old hard-coded 8 was wrong.
    {
      const { res, json, calls } = await invokePrompts({ script: scriptOf(750) });
      check("300s-equivalent script: 200", res && res.statusCode === 200, res && `${res.statusCode} ${res.body}`);
      check("300s-equivalent script: 25 prompts", json && json.prompts && json.prompts.length === 25, json && json.prompts && String(json.prompts.length));
      check("300s-equivalent script: asked Claude for 25", calls[0] && /write exactly 25 scene image prompts/.test(calls[0].sent.messages[0].content));
      check("300s-equivalent script: token budget scaled up", calls[0] && calls[0].sent.max_tokens > 2000, calls[0] && String(calls[0].sent.max_tokens));
    }
    // Overrides reach prompts.js too.
    {
      const { json } = await invokePrompts({ script: scriptOf(225), sceneCount: 12 });
      check("sceneCount override honoured", json && json.sceneCount === 12, json && String(json.sceneCount));
    }
    {
      const { json } = await invokePrompts({ script: scriptOf(225), durationSec: 180 });
      check("durationSec override honoured", json && json.sceneCount === 15, json && String(json.sceneCount));
    }
    // An override that breaches the standard is refused before Claude is billed.
    {
      const { res, calls } = await invokePrompts({ script: scriptOf(750), sceneCount: 8 });
      check("under-scened override: 400", res && res.statusCode === 400, res && `got ${res.statusCode}`);
      check("under-scened override: Claude never called", calls.length === 0, `made ${calls.length}`);
    }
    {
      const { res, calls } = await invokePrompts({ script: "   " });
      check("blank script: 400", res && res.statusCode === 400, res && `got ${res.statusCode}`);
      check("blank script: Claude never called", calls.length === 0, `made ${calls.length}`);
    }
  }

  console.log(`\n${"=".repeat(50)}\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
