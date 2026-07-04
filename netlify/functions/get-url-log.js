// get-url-log.js — Retrieves the full URL log for a given job
// Frontend calls this to recover all URLs for a job at any time

const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const jobId = event.queryStringParameters?.jobId
      || JSON.parse(event.body || "{}").jobId;

    if (!jobId) {
      return { statusCode: 400, body: JSON.stringify({ error: "jobId required" }) };
    }

    const store = getStore({ name: "videoforge-url-log", consistency: "strong" });

    let log = [];
    try {
      const existing = await store.get(`log-${jobId}`, { type: "json" });
      if (existing) log = existing;
    } catch (e) {
      // No log found — return empty
    }

    // Organize by type for easy consumption
    const images = {};
    const animations = {};
    for (const entry of log) {
      if (entry.type === "image") images[entry.sceneIndex] = entry.url;
      if (entry.type === "animation") animations[entry.sceneIndex] = entry.url;
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, log, images, animations, count: log.length }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
