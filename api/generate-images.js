// /api/generate-images — Generates 8 images via Higgsfield API
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { prompts, imageModel, session } = req.body;
  if (!prompts || prompts.length !== 8) return res.status(400).json({ error: "8 prompts required" });

  const higgsKey = getHiggsKey(session);
  if (!higgsKey) return res.status(401).json({ error: "No Higgsfield API key available" });

  const model = imageModel || "nano_banana_2";

  try {
    // Submit all 8 jobs in parallel
    const jobPromises = prompts.map(prompt =>
      fetch("https://api.higgsfield.ai/v1/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${higgsKey}` },
        body: JSON.stringify({ model, prompt, aspect_ratio: "9:16" })
      }).then(r => r.json())
    );

    const jobs = await Promise.all(jobPromises);
    const jobIds = jobs.map(j => j.id);

    // Poll for completion (max 60 seconds)
    const urls = await pollForCompletion(jobIds, higgsKey, 60000);
    res.json({ jobIds, urls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

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

function getHiggsKey(session) {
  if (session?.isAdmin) return process.env.HIGGSFIELD_API_KEY;
  return session?.higgsfieldApiKey || null;
}
