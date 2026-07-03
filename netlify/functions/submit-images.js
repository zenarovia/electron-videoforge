// submit-images.js — Submits 8 image jobs to Higgsfield, returns job IDs instantly
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { prompts, imageModel, session } = JSON.parse(event.body || "{}");
  if (!prompts || prompts.length !== 8) {
    return { statusCode: 400, body: JSON.stringify({ error: "8 prompts required" }) };
  }

  const higgsKey = session?.isAdmin
    ? process.env.HIGGSFIELD_API_KEY
    : session?.higgsfieldApiKey;

  if (!higgsKey) return { statusCode: 401, body: JSON.stringify({ error: "No Higgsfield API key available" }) };

  const model = imageModel || "nano_banana_2";

  try {
    // Submit all 8 jobs in parallel — returns immediately with job IDs
    const jobPromises = prompts.map((prompt, i) =>
      fetch("https://api.higgsfield.ai/v1/image/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${higgsKey}`
        },
        body: JSON.stringify({ model, prompt, aspect_ratio: "9:16" })
      })
      .then(r => r.json())
      .then(data => ({ index: i, jobId: data.id, status: "pending" }))
      .catch(err => ({ index: i, jobId: null, status: "failed", error: err.message }))
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
