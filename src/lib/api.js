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

export async function submitImages(prompts, imageModel, session) {
  const res = await fetch(`${BASE}/submit-images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompts, imageModel, session }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Updated: accepts jobId for URL logging
export async function checkJobs(jobs, session, jobId) {
  const res = await fetch(`${BASE}/check-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobs, session, jobId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function submitAnimations(imageUrls, animatedSceneIndexes, motionPrompt, videoModel, session) {
  const res = await fetch(`${BASE}/submit-animations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrls, animatedSceneIndexes, motionPrompt, videoModel, session }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Updated: calls assemble-video-background for 15-minute timeout
export async function assembleVideo(jobData, session) {
  const res = await fetch(`${BASE}/assemble-video-background`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...jobData, session }),
  });
  // 202 = background function accepted — this is correct, not an error
  if (res.status !== 202 && res.status !== 200) throw new Error(await res.text());
  return { accepted: true };
}

export async function checkAssemblyStatus(jobId, session) {
  const res = await fetch(`${BASE}/assembly-status?jobId=${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// New: retrieve all saved URLs for a job
export async function getUrlLog(jobId) {
  const res = await fetch(`${BASE}/get-url-log?jobId=${encodeURIComponent(jobId)}`);
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

// New: auto-save job JSON to Netlify Blobs + Google Drive on export
// Fire-and-forget — does not throw; logs errors to console only
export async function saveExport(jobData) {
  try {
    const res = await fetch(`${BASE}/save-export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jobData),
    });
    if (!res.ok) {
      console.error("saveExport: server returned", res.status, await res.text());
      return null;
    }
    return res.json();
  } catch (err) {
    console.error("saveExport: fetch failed", err.message);
    return null;
  }
}
