// assembly-status.js — Checks if assembled videos are ready in Blobs
const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const { jobId, language } = JSON.parse(event.body || "{}");
  if (!jobId) return { statusCode: 400, body: JSON.stringify({ error: "jobId required" }) };

  try {
    const store = getStore({ name: "videoforge-videos", consistency: "strong" });
    const results = {};

    const siteUrl = process.env.URL || process.env.DEPLOY_URL || "";

    if (language === "en" || language === "both") {
      const enFile = `${jobId}-en.mp4`;
      try {
        await store.get(enFile, { type: "arrayBuffer" });
        results.enUrl = `${siteUrl}/.netlify/functions/get-video?file=${enFile}`;
        results.enReady = true;
      } catch {
        results.enReady = false;
      }
    }

    if (language === "es" || language === "both") {
      const esFile = `${jobId}-es.mp4`;
      try {
        await store.get(esFile, { type: "arrayBuffer" });
        results.esUrl = `${siteUrl}/.netlify/functions/get-video?file=${esFile}`;
        results.esReady = true;
      } catch {
        results.esReady = false;
      }
    }

    const allReady = language === "both"
      ? results.enReady && results.esReady
      : language === "en" ? results.enReady : results.esReady;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...results, allReady }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
