// generate-images.js — Submits 8 image jobs to Higgsfield and polls for the results
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

  const { prompts, imageModel } = JSON.parse(event.body || "{}");
  if (!prompts || prompts.length !== 8) {
    return { statusCode: 400, body: JSON.stringify({ error: "8 prompts required" }) };
  }

  // Caller passed withAuth, so the admin key is the only key.
  const higgsKey = process.env.HIGGSFIELD_API_KEY;
  if (!higgsKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "HIGGSFIELD_API_KEY not configured" }) };
  }

  const model = imageModel || "nano_banana_2";

  try {
    // Submit all 8 jobs in parallel
    const jobPromises = prompts.map(prompt =>
      fetch("https://api.higgsfield.ai/v1/image/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${higgsKey}`
        },
        body: JSON.stringify({ model, prompt, aspect_ratio: "9:16" })
      }).then(r => r.json())
    );

    const jobs = await Promise.all(jobPromises);
    const jobIds = jobs.map(j => j.id);

    // Poll for completion (max 90 seconds)
    const urls = await pollForCompletion(jobIds, higgsKey, 90000);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobIds, urls }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
});

async function pollForCompletion(jobIds, apiKey, timeout) {
  const start = Date.now();
  const urls = new Array(jobIds.length).fill(null);

  while (urls.some(u => !u) && Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 3000));
    for (let i = 0; i < jobIds.length; i++) {
      if (urls[i]) continue;
      const r = await fetch(`https://api.higgsfield.ai/v1/jobs/${jobIds[i]}`, {
        headers: { "Authorization": `Bearer ${apiKey}` }
      });
      const data = await r.json();
      if (data.status === "completed" && data.url) urls[i] = data.url;
      if (data.status === "failed") throw new Error(`Image ${i + 1} generation failed`);
    }
  }

  if (urls.some(u => !u)) throw new Error("Image generation timed out");
  return urls;
}
