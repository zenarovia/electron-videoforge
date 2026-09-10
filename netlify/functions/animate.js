// animate.js — Submits one animation job to Higgsfield and polls for the result
// ─── Shared-secret auth ──────────────────────────────────────────────────────
// Every request MUST send the header `x-vf-secret` matching env VF_API_SECRET.
// A missing or wrong secret gets a 401 before any other work happens, and the
// admin Higgsfield key (process.env.HIGGSFIELD_API_KEY) is used ONLY after that check passes.
//
// This function previously read `session.isAdmin` straight out of the request
// body to decide whether to use HIGGSFIELD_API_KEY, so anyone who knew the URL could POST
// {"session":{"isAdmin":true}} and spend the Higgsfield balance. Nothing in the body
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

exports.handler = async (event) => {
  if (!isAuthorized(event)) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { imageUrl, motionPrompt, videoModel } = JSON.parse(event.body || "{}");
  if (!imageUrl) return { statusCode: 400, body: JSON.stringify({ error: "Image URL required" }) };

  // Caller proved they hold VF_API_SECRET, so the admin key is the only key.
  const higgsKey = process.env.HIGGSFIELD_API_KEY;
  if (!higgsKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "HIGGSFIELD_API_KEY not configured" }) };
  }

  const model = videoModel || "kling3_0_turbo";

  try {
    const submitRes = await fetch("https://api.higgsfield.ai/v1/video/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${higgsKey}`
      },
      body: JSON.stringify({
        model,
        prompt: motionPrompt || "Slow, cinematic camera drift. Gentle natural movement. Warm atmospheric light.",
        medias: [{ role: "start_image", value: imageUrl }],
        aspect_ratio: "9:16",
        duration: 5,
      })
    });

    const job = await submitRes.json();
    if (!job.id) throw new Error("Failed to submit animation job");

    // Poll for completion (max 3 minutes)
    const url = await pollForVideoCompletion(job.id, higgsKey, 180000);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, url }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function pollForVideoCompletion(jobId, apiKey, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 5000));
    const r = await fetch(`https://api.higgsfield.ai/v1/jobs/${jobId}`, {
      headers: { "Authorization": `Bearer ${apiKey}` }
    });
    const data = await r.json();
    if (data.status === "completed" && data.url) return data.url;
    if (data.status === "failed") throw new Error("Animation failed");
  }
  throw new Error("Animation timed out");
}
