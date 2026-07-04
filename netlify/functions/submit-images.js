// submit-images.js — Submits 8 image jobs to fal.ai, returns request IDs instantly
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { prompts, imageModel, session } = JSON.parse(event.body || "{}");
  if (!prompts || prompts.length !== 8) {
    return { statusCode: 400, body: JSON.stringify({ error: "8 prompts required" }) };
  }

  const falKey = session?.isAdmin
    ? process.env.FAL_KEY
    : session?.falApiKey;

  if (!falKey) return { statusCode: 401, body: JSON.stringify({ error: "No fal.ai API key available" }) };

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
