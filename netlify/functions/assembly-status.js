// assembly-status.js — Checks if assembled videos are ready
const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const { jobId, language } = event.queryStringParameters || {};
  if (!jobId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "jobId required" }) };
  }

  try {
    const store = getStore({ name: "videoforge-assembly", consistency: "strong", siteID: process.env.SITE_ID, token: process.env.NETLIFY_BLOBS_CONTEXT ? undefined : process.env.NETLIFY_AUTH_TOKEN });
    const result = await store.get(`result-${jobId}`, { type: "json" });

    if (!result) {
      // Still processing — tell the client to keep polling
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ allReady: false }),
      };
    }

    // Done — return the URLs
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};