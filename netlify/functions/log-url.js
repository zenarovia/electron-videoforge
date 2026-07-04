// log-url.js — Appends a URL entry to the VideoForge URL log in Netlify Blobs
// Called automatically by check-jobs.js whenever a URL is returned
// Also callable manually from the frontend

const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
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
};
