// /api/animate — Animates an image via Kling through Higgsfield
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { imageUrl, motionPrompt, videoModel, session } = req.body;
  if (!imageUrl) return res.status(400).json({ error: "Image URL required" });

  const higgsKey = getHiggsKey(session);
  if (!higgsKey) return res.status(401).json({ error: "No Higgsfield API key available" });

  const model = videoModel || "kling3_0_turbo";

  try {
    // Submit animation job
    const submitRes = await fetch("https://api.higgsfield.ai/v1/video/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${higgsKey}` },
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

    // Poll for completion (max 3 minutes for video)
    const url = await pollForVideoCompletion(job.id, higgsKey, 180000);
    res.json({ jobId: job.id, url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

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

function getHiggsKey(session) {
  if (session?.isAdmin) return process.env.HIGGSFIELD_API_KEY;
  return session?.higgsfieldApiKey || null;
}
