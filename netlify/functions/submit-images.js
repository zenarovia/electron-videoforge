// submit-images.js — Submits 8 image jobs to fal.ai, returns request IDs instantly
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

  const { prompts, imageModel } = JSON.parse(event.body || "{}");
  if (!prompts || prompts.length !== 8) {
    return { statusCode: 400, body: JSON.stringify({ error: "8 prompts required" }) };
  }

  // Caller proved they hold VF_API_SECRET, so the admin key is the only key.
  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "FAL_KEY not configured" }) };
  }

  // Map our model IDs to fal.ai endpoint strings
  const modelMap = {
    "nano_banana_2": "fal-ai/nano-banana-2",
    "nano_banana_flash": "fal-ai/nano-banana-flash",
    "gpt_image_2": "fal-ai/gpt-image-2",
    "seedream_v4_5": "fal-ai/seedream-v4-5",
    "cinematic_studio_2_5": "fal-ai/cinematic-studio-2-5",
  };
  const endpoint = modelMap[imageModel] || "fal-ai/nano-banana-2";

  try {
    // Submit all 8 jobs in parallel using fal.ai queue API
    const jobPromises = prompts.map(async (prompt, i) => {
      const res = await fetch(`https://queue.fal.run/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Key ${falKey}`,
        },
        body: JSON.stringify({
          prompt,
          aspect_ratio: "9:16",
          num_images: 1,
        }),
      });
      const data = await res.json();
      return {
        index: i,
        requestId: data.request_id,
        endpoint,
        statusUrl: data.status_url,
        responseUrl: data.response_url,
        status: data.status || "IN_QUEUE",
      };
    });

    const jobs = await Promise.all(jobPromises);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobs, endpoint }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
