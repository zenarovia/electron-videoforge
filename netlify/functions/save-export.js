// netlify/functions/save-export.js
// Saves VideoForge job JSON to Netlify Blobs (store: videoforge-jobs, key: job-{jobId})

const { getStore } = require("@netlify/blobs");

// ─── Auth ────────────────────────────────────────────────────────────────────
// Every request MUST carry the `x-vf-secret` header or a signed session cookie,
// checked by withAuth (lib/require-auth.js). Anything else is refused before
// any other work happens, and the
// videoforge-jobs store is written ONLY after that check passes.
//
// This function previously wrote to Blobs with no auth at all, so anyone who
// knew the URL could create or overwrite any job-{id} entry in videoforge-jobs,
// with the id taken straight from the request body. It spends no API credits,
// but it is still an unauthenticated write.
const { withAuth } = require("./lib/require-auth");

exports.handler = withAuth(async (event) => {
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
    const store = getStore({
      name: "videoforge-jobs",
      consistency: "strong",
      siteID: process.env.SITE_ID,
      token: process.env.NETLIFY_BLOBS_CONTEXT ? undefined : process.env.NETLIFY_AUTH_TOKEN,
    });
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
});
