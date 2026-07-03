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
};

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
