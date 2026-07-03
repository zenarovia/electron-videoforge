// ─── VideoForge API Client ────────────────────────────────────────────────────
// Netlify functions are available at /.netlify/functions/[name]

const BASE = "/.netlify/functions";

export async function translateScript(script, session) {
  const res = await fetch(`${BASE}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script, session }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function generatePrompts(script, channelStyle, session) {
  const res = await fetch(`${BASE}/prompts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script, channelStyle, session }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function generateImages(prompts, imageModel, session) {
  const res = await fetch(`${BASE}/generate-images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompts, imageModel, session }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function animateScene(imageUrl, motionPrompt, videoModel, session) {
  const res = await fetch(`${BASE}/animate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl, motionPrompt, videoModel, session }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function checkCost(imageModel, videoModel, animationCount, session) {
  const res = await fetch(`${BASE}/check-cost`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageModel, videoModel, animationCount, session }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function saveToAirtable(jobData, session) {
  const res = await fetch(`${BASE}/save-job`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobData, session }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getModels(type, session) {
  const res = await fetch(`${BASE}/models?type=${type}`, {
    headers: { "Content-Type": "application/json", "x-session": JSON.stringify(session) },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
