// submit-images.js — Submits image jobs to fal.ai, returns request IDs instantly.
//
// Two callers, one endpoint:
//   • the narrated-video pipeline, which needs a scene count derived from how
//     long the narration runs (see lib/scene-count.js), and
//   • the daily image-batch skills, which post 1..60 prompts at a per-channel
//     aspect ratio and have no narration at all.
//
// Everything in the body is optional and defaults to the previous behaviour, so
// the old `{prompts: [8 items], imageModel}` call submits exactly what it always
// did: 8 jobs, 9:16, nano-banana-2.
//
// ─── Shared-secret auth ──────────────────────────────────────────────────────
// Every request MUST send the header `x-vf-secret` matching env VF_API_SECRET.
// A missing or wrong secret gets a 401 before any other work happens, and the
// admin fal key (process.env.FAL_KEY) is used ONLY after that check passes.
//
// This function previously read `session.isAdmin` straight out of the request
// body to decide whether to use FAL_KEY, so anyone who knew the URL could POST
// {"session":{"isAdmin":true}} and spend the fal balance. Nothing in the body
// may ever grant the admin path again — auth comes from the header alone.
//
// NOTE: the Studio web UI does NOT send this header, so it cannot call this
// function as-is. If the UI is ever brought back, add
// `"x-vf-secret": <VF_API_SECRET>` to the fetch headers in src/lib/api.js.
function isAuthorized(event) {
  const expected = process.env.VF_API_SECRET;
  const provided = event.headers?.["x-vf-secret"];
  if (!expected || typeof provided !== "string") return false;

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return require("crypto").timingSafeEqual(a, b);
}

const { resolveSceneCount, MAX_SECONDS_ON_SCREEN, PacingError } = require("./lib/scene-count");

const MAX_PROMPTS = 60;

// Our model IDs -> fal.ai endpoint strings.
// fal publishes GPT Image 2 under the openai/ namespace, not fal-ai/.
const MODEL_MAP = {
  "nano_banana_2": "fal-ai/nano-banana-2",
  "nano_banana_flash": "fal-ai/nano-banana-flash",
  "gpt_image_2": "openai/gpt-image-2",
  "seedream_v4_5": "fal-ai/seedream-v4-5",
  "cinematic_studio_2_5": "fal-ai/cinematic-studio-2-5",
};
const DEFAULT_MODEL = "nano_banana_2";

// A raw fal endpoint id may be passed instead of an alias, so a new fal model
// can be used without a redeploy. fal namespaces models by owner (fal-ai/...,
// openai/...), so any owner is accepted. Kept to a strict shape so a typo fails
// here rather than as a confusing error from fal: every path segment must start
// with a letter or digit, so there is no "..", no empty segment, no scheme.
const RAW_ENDPOINT = /^[a-z0-9][a-z0-9-]{0,39}(\/[a-z0-9][a-z0-9._-]{0,80}){1,5}$/;

// Which endpoints actually accept a `quality` field. Sending it to one that does
// not is a 422 from fal, so it is dropped (and reported) rather than forwarded.
// Note fal's own default for gpt-image-2 is "high", its most expensive tier, so
// omitting quality there does not mean cheap — pass "medium" or "low" for that.
const QUALITY_MODELS = new Set(["openai/gpt-image-2"]);
const QUALITY_VALUES = new Set(["low", "medium", "high", "auto"]);

const ASPECT_RATIOS = new Set([
  "9:16", "3:4", "4:5", "1:1", "4:3", "16:9", "2:3", "3:2", "21:9",
]);
const DEFAULT_ASPECT_RATIO = "9:16";

// Endpoints that are sized by `image_size`, not `aspect_ratio`. fal ignores an
// aspect_ratio a model does not have, so sending one here would silently return
// the model's default shape (landscape 4:3 for gpt-image-2): MBL's 3:4 portraits
// would come back sideways. For these, aspectRatio becomes an explicit size.
//
// gpt-image-2's limits per fal's docs: both edges multiples of 16, long edge
// <= 3840, ratio <= 3:1, 655,360..8,294,400 pixels. Every size below is the exact
// ratio inside those limits, at about 1-2 MP (long edge 1536 where the ratio
// allows), the same class as OpenAI's own 1024x1536 portrait.
const IMAGE_SIZE_MODELS = {
  "openai/gpt-image-2": {
    "9:16": { width: 864, height: 1536 },
    "3:4": { width: 1152, height: 1536 },
    "4:5": { width: 1024, height: 1280 },
    "1:1": { width: 1024, height: 1024 },
    "4:3": { width: 1536, height: 1152 },
    "16:9": { width: 1536, height: 864 },
    "2:3": { width: 1024, height: 1536 },
    "3:2": { width: 1536, height: 1024 },
    "21:9": { width: 2016, height: 864 },
  },
};

const DEFAULT_CONCURRENCY = 8;
const MAX_CONCURRENCY = 16;
const MAX_ATTEMPTS = 3;

const json = (statusCode, payload) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run `worker` over `items` with at most `limit` in flight. fal has been fine
// with bursts, but a 60-prompt batch firing at once is asking for 429s.
async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

// Retry transient failures only: a network error, a 429, or a 5xx. A 4xx is the
// request being wrong, and retrying it just wastes time.
async function submitOne(endpoint, falKey, payload) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`https://queue.fal.run/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Key ${falKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) return { data: await res.json() };

      const detail = await res.text().catch(() => "");
      lastError = `fal responded ${res.status}${detail ? ": " + detail.slice(0, 300) : ""}`;
      if (res.status !== 429 && res.status < 500) break; // caller's fault, don't retry
    } catch (err) {
      lastError = err.message;
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200));
    }
  }

  return { error: lastError || "submission failed" };
}

exports.handler = async (event) => {
  if (!isAuthorized(event)) {
    return json(401, { error: "Unauthorized" });
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const { prompts, script, durationSec, sceneCount, aspectRatio, imageModel, quality, concurrency } = body;

  // ─── Scene count ───────────────────────────────────────────────────────────
  // Resolved first so a caller that sends only a script gets the number back in
  // the error and knows how many prompts to write.
  let pacing;
  try {
    pacing = resolveSceneCount({ sceneCount, durationSec, script });
  } catch (err) {
    if (err instanceof PacingError) return json(400, { error: err.message, pacing: err.pacing });
    throw err;
  }

  // ─── Validation (all of it free — nothing reaches fal until this passes) ───
  if (!Array.isArray(prompts) || prompts.length === 0) {
    return json(400, {
      error: "prompts must be a non-empty array",
      recommendedSceneCount: pacing.sceneCount,
    });
  }
  if (prompts.length > MAX_PROMPTS) {
    return json(400, { error: `at most ${MAX_PROMPTS} prompts per request, got ${prompts.length}` });
  }
  if (!prompts.every((p) => typeof p === "string" && p.trim())) {
    return json(400, { error: "every prompt must be a non-empty string" });
  }

  // The acceptance standard, enforced against what is actually being submitted:
  // no single image may sit on screen longer than MAX_SECONDS_ON_SCREEN. Only
  // checkable when the caller told us how long the narration is, which the
  // image-batch skills never do — they have no narration.
  if (pacing.durationSec !== null) {
    const secondsPerImage = pacing.durationSec / prompts.length;
    if (secondsPerImage > MAX_SECONDS_ON_SCREEN) {
      return json(400, {
        error:
          `${prompts.length} prompt(s) for ${pacing.durationSec.toFixed(1)}s of narration is ` +
          `${secondsPerImage.toFixed(1)}s per image, over the ${MAX_SECONDS_ON_SCREEN}s maximum. ` +
          `Send at least ${pacing.sceneCount}.`,
        recommendedSceneCount: pacing.sceneCount,
        pacing: { secondsPerImage, maxSecondsOnScreen: MAX_SECONDS_ON_SCREEN },
      });
    }
  }

  const ratio = aspectRatio === undefined ? DEFAULT_ASPECT_RATIO : aspectRatio;
  if (!ASPECT_RATIOS.has(ratio)) {
    return json(400, {
      error: `unsupported aspectRatio "${ratio}"`,
      supported: [...ASPECT_RATIOS],
    });
  }

  const modelId = imageModel || DEFAULT_MODEL;
  const endpoint = MODEL_MAP[modelId] || (RAW_ENDPOINT.test(modelId) ? modelId : null);
  if (!endpoint) {
    return json(400, {
      error: `unknown imageModel "${modelId}"`,
      supported: Object.keys(MODEL_MAP),
    });
  }

  if (quality !== undefined && !QUALITY_VALUES.has(quality)) {
    return json(400, { error: `unsupported quality "${quality}"`, supported: [...QUALITY_VALUES] });
  }
  const qualityApplied = quality !== undefined && QUALITY_MODELS.has(endpoint);
  const imageSize = IMAGE_SIZE_MODELS[endpoint]?.[ratio] || null;

  let inFlight = DEFAULT_CONCURRENCY;
  if (concurrency !== undefined) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
      return json(400, { error: `concurrency must be an integer 1-${MAX_CONCURRENCY}` });
    }
    inFlight = concurrency;
  }

  // Caller proved they hold VF_API_SECRET, so the admin key is the only key.
  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    return json(500, { error: "FAL_KEY not configured" });
  }

  try {
    const jobs = await runPool(prompts, inFlight, async (prompt, i) => {
      const payload = imageSize
        ? { prompt, image_size: imageSize, num_images: 1 }
        : { prompt, aspect_ratio: ratio, num_images: 1 };
      if (qualityApplied) payload.quality = quality;

      const { data, error } = await submitOne(endpoint, falKey, payload);

      // Same shape as submit-animations, so check-jobs polls it unchanged.
      // `index` is kept alongside `sceneIndex` because the Studio UI reads it.
      const job = { index: i, sceneIndex: i, requestId: null, endpoint, statusUrl: null, responseUrl: null };

      if (error) return { ...job, status: "FAILED", error };
      return {
        ...job,
        requestId: data.request_id,
        statusUrl: data.status_url,
        responseUrl: data.response_url,
        status: data.status || "IN_QUEUE",
      };
    });

    return json(200, {
      jobs,
      endpoint,
      imageModel: modelId,
      aspectRatio: ratio,
      imageSize,
      quality: quality === undefined ? null : quality,
      qualityApplied,
      submitted: jobs.filter((j) => j.requestId).length,
      failed: jobs.filter((j) => !j.requestId).length,
      sceneCount: prompts.length,
      recommendedSceneCount: pacing.sceneCount,
      pacing: {
        durationSec: pacing.durationSec,
        durationSource: pacing.source,
        secondsPerImage: pacing.durationSec === null ? null : pacing.durationSec / prompts.length,
        maxSecondsOnScreen: MAX_SECONDS_ON_SCREEN,
      },
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
