// submit-animations.js — Submits animation jobs, returns job IDs instantly
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { imageUrls, animatedSceneIndexes, motionPrompt, videoModel, session } = JSON.parse(event.body || "{}");

  const higgsKey = session?.isAdmin
    ? process.env.HIGGSFIELD_API_KEY
    : session?.higgsfieldApiKey;

  if (!higgsKey) return { statusCode: 401, body: JSON.stringify({ error: "No Higgsfield API key" }) };

  const model = videoModel || "kling3_0_turbo";
  const prompt = motionPrompt || "Slow, cinematic camera drift. Gentle natural movement. Warm atmospheric light.";

  try {
    const jobPromises = animatedSceneIndexes.map(idx =>
      fetch("https://api.higgsfield.ai/v1/video/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${higgsKey}`
        },
        body: JSON.stringify({
          model,
          prompt,
          medias: [{ role: "start_image", value: imageUrls[idx] }],
          aspect_ratio: "9:16",
          duration: 5,
        })
      })
      .then(r => r.json())
      .then(data => ({ sceneIndex: idx, jobId: data.id, status: "pending" }))
      .catch(err => ({ sceneIndex: idx, jobId: null, status: "failed", error: err.message }))
    );

    const jobs = await Promise.all(jobPromises);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobs }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
