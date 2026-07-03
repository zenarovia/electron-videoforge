// check-jobs.js — Checks status of fal.ai queue jobs
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { jobs, session } = JSON.parse(event.body || "{}");
  if (!jobs || !Array.isArray(jobs)) {
    return { statusCode: 400, body: JSON.stringify({ error: "jobs array required" }) };
  }

  const falKey = session?.isAdmin
    ? process.env.FAL_KEY
    : session?.falApiKey;

  if (!falKey) return { statusCode: 401, body: JSON.stringify({ error: "No fal.ai API key" }) };

  try {
    const statusPromises = jobs.map(async (job) => {
      if (!job.requestId) return { ...job, status: "FAILED", url: null };

      // Check status
      const statusRes = await fetch(
        `https://queue.fal.run/${job.endpoint}/requests/${job.requestId}/status`,
        { headers: { "Authorization": `Key ${falKey}` } }
      );
      const statusData = await statusRes.json();

      if (statusData.status === "COMPLETED") {
        // Get result
        const resultRes = await fetch(
          `https://queue.fal.run/${job.endpoint}/requests/${job.requestId}`,
          { headers: { "Authorization": `Key ${falKey}` } }
        );
        const resultData = await resultRes.json();
        const url = resultData.images?.[0]?.url || resultData.image?.url || null;
        return { ...job, status: "COMPLETED", url };
      }

      return {
        ...job,
        status: statusData.status, // IN_QUEUE | IN_PROGRESS | COMPLETED | FAILED
        url: null,
      };
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
