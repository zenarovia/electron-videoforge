// check-jobs.js — Checks status of fal.ai queue jobs
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

  const { jobs, session } = parsed;
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
        // Check status using fal.ai queue status endpoint
        const statusRes = await fetch(
          `https://queue.fal.run/${job.endpoint}/requests/${job.requestId}/status`,
          {
            headers: {
              "Authorization": `Key ${falKey}`,
              "Content-Type": "application/json",
            }
          }
        );

        if (!statusRes.ok) {
          const errText = await statusRes.text();
          console.error(`Status check failed for ${job.requestId}: ${errText}`);
          return { ...job, status: "IN_QUEUE", url: null };
        }

        const statusText = await statusRes.text();
        if (!statusText) return { ...job, status: "IN_QUEUE", url: null };

        const statusData = JSON.parse(statusText);
        const status = statusData.status || "IN_QUEUE";

        if (status === "COMPLETED") {
          // Get result from fal.ai
          const resultRes = await fetch(
            `https://queue.fal.run/${job.endpoint}/requests/${job.requestId}`,
            {
              headers: {
                "Authorization": `Key ${falKey}`,
                "Content-Type": "application/json",
              }
            }
          );
          const resultText = await resultRes.text();
          if (!resultText) return { ...job, status: "COMPLETED", url: null };

          const resultData = JSON.parse(resultText);
          // Try multiple possible URL locations in fal.ai response
          const url = resultData.images?.[0]?.url
            || resultData.image?.url
            || resultData.output?.url
            || resultData.video?.url
            || null;

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
