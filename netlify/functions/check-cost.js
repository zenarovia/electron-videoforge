// check-cost.js — Returns cost estimate based on fal.ai pricing
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { imageModel, videoModel, animationCount } = JSON.parse(event.body || "{}");

  // fal.ai pricing (per image / per 5-second clip)
  const imagePricing = {
    "nano_banana_2": 0.08,
    "nano_banana_flash": 0.04,
    "gpt_image_2": 0.08,
    "seedream_v4_5": 0.03,
    "cinematic_studio_2_5": 0.15,
  };

  const videoPricing = {
    "kling3_0_turbo": 0.35,   // $0.07/s × 5s
    "kling3_0": 0.50,          // $0.10/s × 5s
    "seedance_2_0": 0.25,      // $0.05/s × 5s
    "cinematic_studio_video_v2": 0.50,
    "cinematic_studio_3_0": 0.75,
  };

  const perImage = imagePricing[imageModel] || 0.08;
  const perAnimation = videoPricing[videoModel] || 0.35;
  const imageTotal = perImage * 8;
  const animationTotal = perAnimation * (animationCount || 1);
  const total = Math.round((imageTotal + animationTotal) * 100) / 100;

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageCredits: imageTotal.toFixed(2),
      animationCredits: animationTotal.toFixed(2),
      total,
      currency: "USD",
      imageModel: imageModel || "nano_banana_2",
      videoModel: videoModel || "kling3_0_turbo",
      animationCount: animationCount || 1,
    }),
  };
};
