// netlify/functions/save-export.js
// Saves VideoForge job JSON to Netlify Blobs (store: videoforge-jobs, key: job-{jobId})

const { getStore } = require("@netlify/blobs");

// ─── Shared-secret auth ──────────────────────────────────────────────────────
// Every request MUST send the header `x-vf-secret` matching env VF_API_SECRET.
// A missing or wrong secret gets a 401 before any other work happens, and the
// videoforge-jobs store is written ONLY after that check passes.
//
// This function previously wrote to Blobs with no auth at all, so anyone who
// knew the URL could create or overwrite any job-{id} entry in videoforge-jobs,
// with the id taken straight from the request body. It spends no API credits,
// but it is still an unauthenticated write.
//
// NOTE: the Studio web UI does NOT send this header, so it cannot call this
// function as-is. saveExport() in src/lib/api.js is fire-and-forget: it logs
// the 401 and returns null, and handleExport's local JSON download still runs.
// If the UI is ever brought back, add
// `"x-vf-secret": <VF_API_SECRET>` to the fetch headers in src/lib/api.js.
function isAuthorized(event) {
  const expected = process.env.VF_API_SECRET;
  const provided = event.headers?.["x-vf-secret"];
  if (!expected || typeof provided !== "string") return false;

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return require("crypto").timingSafeEqual(a, b);
}

exports.handler = async (event) => {
  if (!isAuthorized(event)) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

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
};
