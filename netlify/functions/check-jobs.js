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

// ─── Auth ────────────────────────────────────────────────────────────────────
// Every request MUST carry the `x-vf-secret` header or a signed session cookie,
// checked by withAuth (lib/require-auth.js). Anything else is refused before
// any other work happens, and the
// admin fal key (process.env.FAL_KEY) is used ONLY after that check passes.
//
// This function previously read `session.isAdmin` straight out of the request
// body to decide whether to use FAL_KEY, so anyone who knew the URL could POST
// {"session":{"isAdmin":true}} and spend the fal balance. Nothing in the body
// may ever grant the admin path again — auth comes from lib/require-auth.js alone.
const { withAuth } = require("./lib/require-auth");

// ─── Main Handler ────────────────────────────────────────────────────────────
exports.handler = withAuth(async (event) => {
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
  const { jobs, jobId } = parsed;

  if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "jobs array required" }) };
  }

  // Caller passed withAuth, so the admin key is the only key.
  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "FAL_KEY not configured" }) };
  }

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
});
