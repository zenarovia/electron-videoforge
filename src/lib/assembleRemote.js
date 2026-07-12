// assembleRemote.js — drop-in replacement for browser-assembler's assembleBrowser().
// Same inputs/outputs, but the heavy FFmpeg work happens on the render worker
// instead of on the tablet. Put this file in the web app at: src/lib/assembleRemote.js
//
// Requires two Netlify environment variables:
//   VITE_RENDER_WORKER_URL     e.g. https://zenarovia-render-worker.up.railway.app
//   VITE_RENDER_WORKER_SECRET  the same WORKER_SECRET you set on the worker

const WORKER_URL = import.meta.env.VITE_RENDER_WORKER_URL;
const WORKER_SECRET = import.meta.env.VITE_RENDER_WORKER_SECRET || "";

export async function assembleRemote({
  imageUrls,
  animationUrls,
  enScript,
  esScript,
  language,
  title,        // <-- pass the video title so output files are named after it (not a UUID)
  id,           // <-- optional: keep the app's vf- job id instead of a random UUID
  channel,      // <-- optional: available to the worker if needed
  fishApiKey,
  onProgress,
}) {
  if (!WORKER_URL) throw new Error("VITE_RENDER_WORKER_URL is not set (add it in Netlify env vars)");

  onProgress?.("Sending job to the render server...");

  const submit = await fetch(`${WORKER_URL}/assemble`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-worker-secret": WORKER_SECRET },
    body: JSON.stringify({
      jobData: { id, title, channel, imageUrls, animationUrls, enScript, esScript, language },
      // captions ON by default. fishApiKey is optional here — if the worker has its
      // own FISH_AUDIO_API_KEY set, you can omit it. We pass it through for per-user keys.
      assemblyOptions: { captions: true, fishApiKey },
    }),
  });
  if (!submit.ok) throw new Error(`Render submit failed: ${submit.status} ${await submit.text()}`);
  const { jobId } = await submit.json();

  // Poll until the render finishes (a few minutes). The tablet just waits — no CPU work.
  while (true) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${WORKER_URL}/status/${jobId}`, {
      headers: { "x-worker-secret": WORKER_SECRET },
    });
    if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
    const data = await res.json();
    if (data.latest) onProgress?.(data.latest);

    if (data.status === "done") {
      const abs = (u) => (u ? `${WORKER_URL}${u}` : null);
      return { enUrl: abs(data.result?.enUrl), esUrl: abs(data.result?.esUrl) };
    }
    if (data.status === "error") throw new Error(data.error || "Render failed on the server");
  }
}
