// check-jobs.js — Checks status of fal.ai queue jobs
// UPDATED: Auto-logs every CDN URL to Netlify Blobs the moment it's received
// URLs are never lost again even if Airtable save fails

const { getStore } = require("@netlify/blobs");

// ─── URL Logger ─────────────────────────────────────────────────────────────
async function logUrl(jobId, type, sceneIndex, url, requestId, endpoint) {
  if (!jobId || !url) return; // Silent no-op if missing params
  try {
    const store = getStore({ name: "videoforge-url-log", consistency: "strong" });

    // Read existing log
    let log = [];
    try {
      const existing = await store.get(`log-${jobId}`, { type: "json" });
      if (existing) log = existing;
    } catch (e) { /* No existing log */ }

    // Check if already logged (avoid duplicates)
    const alreadyLogged = log.some(
      e => e.type === type && e.sceneIndex === sceneIndex && e.url === url
    );
    if (alreadyLogged) return;

    // Append and save
    log.push({
      type,
      sceneIndex,
      url,
      requestId,
      endpoint,
      timestamp: new Date().toISOString(),
    });

    await store.set(`log-${jobId}`, JSON.stringify(log), {
      metadata: { contentType: "application/json" }
    });

    console.log(`[URL-LOG] Saved ${type} scene ${sceneIndex} for job ${jobId}`);
  } catch (err) {
    // NEVER let logging failure break the main flow
    console.error(`[URL-LOG] Failed to log URL for job ${jobId}:`, err.message);
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let parsed;
  try {
    parsed = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  // jobId is now passed from the frontend so we can log URLs to the right bucket
  const { jobs, session, jobId } = parsed;

  if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "jobs array required" }) };
  }

  const falKey = session?.isAdmin
    ? process.env.FAL_KEY
    : session?.falApiKey;

  if (!falKey) return { statusCode: 401, body: JSON.stringify({ error: "No fal.ai API key" }) };

  try {
    const statusPromises = jobs.map(async (job) => {
      if (!job.requestId) return { ...job, status: "FAILED", url: null };

      try {
        // Use status_url if available, otherwise construct it
        const statusUrl = job.statusUrl ||
          `https://queue.fal.run/${job.endpoint}/requests/${job.requestId}/status`;

        const statusRes = await fetch(statusUrl, {
          headers: { "Authorization": `Key ${falKey}` }
        });

        if (!statusRes.ok) {
          return { ...job, status: "IN_QUEUE", url: null };
        }

        const statusData = await statusRes.json();
        const status = statusData.status || "IN_QUEUE";

        if (status === "COMPLETED") {
          // Use response_url if available, otherwise construct it
          const resultUrl = job.responseUrl || statusData.response_url ||
            `https://queue.fal.run/${job.endpoint}/requests/${job.requestId}`;

          const resultRes = await fetch(resultUrl, {
            headers: { "Authorization": `Key ${falKey}` }
          });

          if (!resultRes.ok) return { ...job, status: "COMPLETED", url: null };

          const resultData = await resultRes.json();
          const url = resultData.images?.[0]?.url
            || resultData.image?.url
            || resultData.video?.url
            || resultData.output?.url
            || null;

          // ✅ AUTO-LOG THE URL — this is the key addition
          if (url && jobId) {
            const sceneIndex = job.sceneIndex !== undefined ? job.sceneIndex : job.index;
            const type = job.endpoint?.includes("video") ? "animation" : "image";
            // Fire-and-forget — don't await so it doesn't slow down the response
            logUrl(jobId, type, sceneIndex, url, job.requestId, job.endpoint).catch(() => {});
          }

          return { ...job, status: "COMPLETED", url };
        }

        return { ...job, status, url: null };

      } catch (jobErr) {
        console.error(`Error checking job ${job.requestId}:`, jobErr.message);
        return { ...job, status: "IN_QUEUE", url: null };
      }
    });

    const results = await Promise.all(statusPromises);
    const allDone = results.every(r => r.status === "COMPLETED" || r.status === "FAILED");
    const completedCount = results.filter(r => r.status === "COMPLETED").length;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results, allDone, completedCount }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
