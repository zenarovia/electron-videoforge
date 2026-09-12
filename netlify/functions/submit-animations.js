// submit-animations.js — Submits animation jobs to fal.ai
// ─── Auth ────────────────────────────────────────────────────────────────────
// Every request MUST carry the `x-vf-secret` header or a signed session cookie,
// checked by withAuth (lib/require-auth.js). Anything else is refused before
// any other work happens, and the
// admin fal key (process.env.FAL_KEY) is used ONLY after that check passes.
//
// This function previously read `session.isAdmin` straight out of the request
// body to decide whether to use FAL_KEY, so anyone who knew the URL could POST
// {"session":{"isAdmin":true}} and spend the fal balance. Nothing in the body
// may ever grant the admin path again — auth comes from lib/require-auth.js alone.
const { withAuth } = require("./lib/require-auth");

exports.handler = withAuth(async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { imageUrls, animatedSceneIndexes, motionPrompt, videoModel } = JSON.parse(event.body || "{}");

  // Caller passed withAuth, so the admin key is the only key.
  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "FAL_KEY not configured" }) };
  }

  // Map our video model IDs to fal.ai endpoints
  const modelMap = {
    "kling3_0_turbo": "fal-ai/kling-video/v2.1/standard/image-to-video",
    "kling3_0": "fal-ai/kling-video/v3.0/pro/image-to-video",
    "seedance_2_0": "fal-ai/bytedance/seedance-2-0/image-to-video",
    "cinematic_studio_video_v2": "fal-ai/cinematic-studio-video-v2/image-to-video",
    "cinematic_studio_3_0": "fal-ai/cinematic-studio-3-0/image-to-video",
  };
  const endpoint = modelMap[videoModel] || "fal-ai/kling-video/v2.1/standard/image-to-video";
  const prompt = motionPrompt || "Slow, cinematic camera drift. Gentle natural movement. Warm atmospheric light.";

  try {
    const jobPromises = animatedSceneIndexes.map(async (idx) => {
      const res = await fetch(`https://queue.fal.run/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Key ${falKey}`,
        },
        body: JSON.stringify({
          prompt,
          image_url: imageUrls[idx],
          duration: "5",
          aspect_ratio: "9:16",
        }),
      });
      const data = await res.json();
      return {
        sceneIndex: idx,
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
      body: JSON.stringify({ jobs }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
});
