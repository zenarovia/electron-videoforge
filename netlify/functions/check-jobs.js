// check-jobs.js — Checks status of fal.ai queue jobs using status_url and response_url
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
