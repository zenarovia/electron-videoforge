// /api/save-job — Saves completed job to VideoForge Operations Airtable
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { jobData, session } = req.body;

  // Get Airtable credentials — admins use backend key, users use their own
  const airtableKey = session?.isAdmin
    ? process.env.AIRTABLE_API_KEY
    : session?.airtableApiKey;

  const baseId = session?.isAdmin
    ? process.env.AIRTABLE_JOBS_BASE
    : session?.airtableBase;

  const tableId = session?.isAdmin
    ? process.env.AIRTABLE_JOBS_TABLE
    : session?.airtableTable;

  if (!airtableKey || !baseId || !tableId) {
    // If no Airtable configured, just return success (job is saved in frontend state)
    return res.json({ saved: false, message: "No Airtable configured — job logged locally only" });
  }

  try {
    const fields = {
      "Title": jobData.title,
      "Channel": jobData.channel,
      "Client": jobData.client || "",
      "Language": jobData.language === "both" ? "EN + ES" : jobData.language === "es" ? "ES" : "EN",
      "Producer": jobData.producer,
      "Image Model": jobData.imageModel,
      "Video Model": jobData.videoModel,
      "Animations": jobData.animationCount,
      "Credits Used": jobData.credits,
      "Status": "Ready to Assemble",
      "Date": new Date().toLocaleDateString("en-US"),
    };

    // Add scene URLs if present
    if (jobData.sceneUrls) {
      jobData.sceneUrls.forEach((url, i) => {
        fields[`Scene ${String(i + 1).padStart(2, "0")} URL`] = url;
      });
    }
    if (jobData.klingUrl) fields["Kling URL"] = jobData.klingUrl;

    const airtableRes = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${airtableKey}`,
      },
      body: JSON.stringify({ fields }),
    });

    const data = await airtableRes.json();
    if (data.error) throw new Error(data.error.message);

    res.json({ saved: true, recordId: data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
