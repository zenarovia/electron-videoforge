// /api/check-cost — Returns credit cost estimate using Higgsfield get_cost:true
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { imageModel, videoModel, animationCount, session } = req.body;
  const higgsKey = getHiggsKey(session);
  if (!higgsKey) return res.status(401).json({ error: "No Higgsfield API key available" });

  try {
    // Check image cost (1 image × 8)
    const imgRes = await fetch("https://api.higgsfield.ai/v1/image/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${higgsKey}` },
      body: JSON.stringify({
        model: imageModel || "nano_banana_2",
        prompt: "test",
        aspect_ratio: "9:16",
        get_cost: true,
      })
    });
    const imgData = await imgRes.json();
    const perImageCost = imgData.cost || 1.5;
    const imageCredits = perImageCost * 8;

    // Check video cost (1 animation)
    const vidRes = await fetch("https://api.higgsfield.ai/v1/video/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${higgsKey}` },
      body: JSON.stringify({
        model: videoModel || "kling3_0_turbo",
        prompt: "test",
        aspect_ratio: "9:16",
        duration: 5,
        get_cost: true,
      })
    });
    const vidData = await vidRes.json();
    const perAnimationCost = vidData.cost || 7.5;
    const animationCredits = perAnimationCost * (animationCount || 1);

    const total = Math.round((imageCredits + animationCredits) * 10) / 10;

    res.json({
      imageCredits: imageCredits.toFixed(1),
      animationCredits: animationCredits.toFixed(1),
      total,
      imageModel: imageModel || "nano_banana_2",
      videoModel: videoModel || "kling3_0_turbo",
      animationCount: animationCount || 1,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function getHiggsKey(session) {
  if (session?.isAdmin) return process.env.HIGGSFIELD_API_KEY;
  return session?.higgsfieldApiKey || null;
}
