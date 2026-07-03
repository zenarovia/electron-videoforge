exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { imageModel, videoModel, animationCount, session } = JSON.parse(event.body || "{}");

  const higgsKey = session?.isAdmin
    ? process.env.HIGGSFIELD_API_KEY
    : session?.higgsfieldApiKey;

  if (!higgsKey) return { statusCode: 401, body: JSON.stringify({ error: "No Higgsfield API key available" }) };

  try {
    const imgRes = await fetch("https://api.higgsfield.ai/v1/image/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${higgsKey}` },
      body: JSON.stringify({ model: imageModel || "nano_banana_2", prompt: "test", aspect_ratio: "9:16", get_cost: true })
    });
    const imgData = await imgRes.json();
    const perImageCost = imgData.cost || 1.5;
    const imageCredits = perImageCost * 8;

    const vidRes = await fetch("https://api.higgsfield.ai/v1/video/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${higgsKey}` },
      body: JSON.stringify({ model: videoModel || "kling3_0_turbo", prompt: "test", aspect_ratio: "9:16", duration: 5, get_cost: true })
    });
    const vidData = await vidRes.json();
    const perAnimationCost = vidData.cost || 7.5;
    const animationCredits = perAnimationCost * (animationCount || 1);
    const total = Math.round((imageCredits + animationCredits) * 10) / 10;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageCredits: imageCredits.toFixed(1),
        animationCredits: animationCredits.toFixed(1),
        total,
        imageModel: imageModel || "nano_banana_2",
        videoModel: videoModel || "kling3_0_turbo",
        animationCount: animationCount || 1,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
