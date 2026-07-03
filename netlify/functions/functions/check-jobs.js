// check-jobs.js — Checks status of multiple Higgsfield jobs, returns completed URLs
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { jobIds, session } = JSON.parse(event.body || "{}");
  if (!jobIds || !Array.isArray(jobIds)) {
    return { statusCode: 400, body: JSON.stringify({ error: "jobIds array required" }) };
  }

  const higgsKey = session?.isAdmin
    ? process.env.HIGGSFIELD_API_KEY
    : session?.higgsfieldApiKey;

  if (!higgsKey) return { statusCode: 401, body: JSON.stringify({ error: "No Higgsfield API key" }) };

  try {
    // Check all jobs in parallel
    const statusPromises = jobIds.map((jobId, i) => {
      if (!jobId) return Promise.resolve({ index: i, status: "failed", url: null });
      
      return fetch(`https://api.higgsfield.ai/v1/jobs/${jobId}`, {
        headers: { "Authorization": `Bearer ${higgsKey}` }
      })
      .then(r => r.json())
      .then(data => ({
        index: i,
        jobId,
        status: data.status, // "pending" | "processing" | "completed" | "failed"
        url: data.status === "completed" ? (data.url || data.result_url || data.output_url) : null,
      }))
      .catch(() => ({ index: i, jobId, status: "failed", url: null }));
    });

    const results = await Promise.all(statusPromises);
    const allDone = results.every(r => r.status === "completed" || r.status === "failed");
    const completedCount = results.filter(r => r.status === "completed").length;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results, allDone, completedCount }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
