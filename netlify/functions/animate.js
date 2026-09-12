// animate.js — Submits one animation job to Higgsfield and polls for the result
// ─── Auth ────────────────────────────────────────────────────────────────────
// Every request MUST carry the `x-vf-secret` header or a signed session cookie,
// checked by withAuth (lib/require-auth.js). Anything else is refused before
// any other work happens, and the
// admin Higgsfield key (process.env.HIGGSFIELD_API_KEY) is used ONLY after that check passes.
//
// This function previously read `session.isAdmin` straight out of the request
// body to decide whether to use HIGGSFIELD_API_KEY, so anyone who knew the URL could POST
// {"session":{"isAdmin":true}} and spend the Higgsfield balance. Nothing in the body
// may ever grant the admin path again — auth comes from lib/require-auth.js alone.
const { withAuth } = require("./lib/require-auth");

exports.handler = withAuth(async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { imageUrl, motionPrompt, videoModel } = JSON.parse(event.body || "{}");
  if (!imageUrl) return { statusCode: 400, body: JSON.stringify({ error: "Image URL required" }) };

  // Caller passed withAuth, so the admin key is the only key.
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
});

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
