// ─── VideoForge API Client ────────────────────────────────────────────────────
// All API calls go through Vercel serverless functions in /api/
// This keeps API keys off the client side

export async function translateScript(script, session) {
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script, session }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // { spanish: "..." }
}

export async function generatePrompts(script, channelStyle, session) {
  const res = await fetch("/api/prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script, channelStyle, session }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // { prompts: [...8 prompts] }
}

export async function generateImages(prompts, imageModel, session) {
  const res = await fetch("/api/generate-images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompts, imageModel, session }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // { jobIds: [...], urls: [...] }
}

export async function animateScene(imageUrl, motionPrompt, videoModel, session) {
  const res = await fetch("/api/animate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl, motionPrompt, videoModel, session }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // { jobId, url }
}

export async function checkCost(imageModel, videoModel, animationCount, session) {
  const res = await fetch("/api/check-cost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageModel, videoModel, animationCount, session }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // { imageCredits, animationCredits, total }
}

export async function saveToAirtable(jobData, session) {
  const res = await fetch("/api/save-job", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobData, session }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getModels(type, session) {
  const res = await fetch(`/api/models?type=${type}`, {
    headers: { "Content-Type": "application/json", "x-session": JSON.stringify(session) },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // { models: [...] }
}
