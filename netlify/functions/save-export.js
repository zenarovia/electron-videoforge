// netlify/functions/save-export.js
// Saves VideoForge job JSON to Netlify Blobs (store: videoforge-jobs, key: job-{jobId})

const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let jobData;
  try {
    jobData = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "Invalid JSON body" };
  }

  const jobId = jobData?.id;
  if (!jobId) {
    return { statusCode: 400, body: "Missing job id" };
  }

  const jsonContent = JSON.stringify(jobData, null, 2);
  const results = { blobSaved: false, errors: [] };

  try {
    const store = getStore({ name: "videoforge-jobs", consistency: "strong" });
    await store.set(`job-${jobId}`, jsonContent);
    results.blobSaved = true;
    console.log("Blob save success for job:", jobId);
  } catch (err) {
    results.errors.push(`Blob save failed: ${err.message}`);
    console.error("Blob save error:", err.message);
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(results),
  };
};
