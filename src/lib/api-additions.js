// ─── UPDATED checkJobs — now passes jobId for URL logging ───────────────────
// Replace the existing checkJobs function in src/lib/api.js with this version

export async function checkJobs(jobs, session, jobId) {
  const res = await fetch(`${BASE}/check-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobs, session, jobId }), // <-- jobId added
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─── NEW: getUrlLog — retrieve all saved URLs for a job ─────────────────────
// Add this to src/lib/api.js

export async function getUrlLog(jobId, session) {
  const res = await fetch(`${BASE}/get-url-log?jobId=${encodeURIComponent(jobId)}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // { jobId, log, images: {0: url, 1: url...}, animations: {0: url...}, count }
}
