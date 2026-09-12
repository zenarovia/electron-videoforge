// log-url.js — Appends a URL entry to the VideoForge URL log in Netlify Blobs
// check-jobs.js does NOT call this endpoint; it logs URLs server-side through
// its own logUrl(). Nothing in src/ calls it either — it is for manual appends.

const { getStore } = require("@netlify/blobs");

// ─── Auth ────────────────────────────────────────────────────────────────────
// Every request MUST carry the `x-vf-secret` header or a signed session cookie,
// checked by withAuth (lib/require-auth.js). Anything else is refused before
// any other work happens, and the
// videoforge-url-log store is read or written ONLY after that check passes.
//
// This function previously wrote to Blobs with no auth at all, so anyone who
// knew the URL could create log-{jobId} entries, or append junk to a real job's
// log, by guessing or reusing its jobId. It spends no API credits, but it is
// still an unauthenticated write into the same store check-jobs.js relies on.
const { withAuth } = require("./lib/require-auth");

exports.handler = withAuth(async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const { jobId, type, sceneIndex, url, requestId, endpoint, timestamp } = JSON.parse(event.body || "{}");

    if (!jobId || !url) {
      return { statusCode: 400, body: JSON.stringify({ error: "jobId and url required" }) };
    }

    const store = getStore({ name: "videoforge-url-log", consistency: "strong" });

    // Read existing log for this job, or start fresh
    let log = [];
    try {
      const existing = await store.get(`log-${jobId}`, { type: "json" });
      if (existing) log = existing;
    } catch (e) {
      // No existing log — start fresh
    }

    // Append new entry
    log.push({
      type,           // "image" | "animation"
      sceneIndex,     // 0-7 for images, scene index for animations
      url,
      requestId,
      endpoint,
      timestamp: timestamp || new Date().toISOString(),
    });

    // Save back
    await store.set(`log-${jobId}`, JSON.stringify(log), {
      metadata: { contentType: "application/json" }
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved: true, count: log.length }),
    };
  } catch (err) {
    console.error("log-url error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
});
