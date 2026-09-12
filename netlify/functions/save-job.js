// save-job.js — Writes a finished job row to the Airtable Jobs base
// ─── Auth ────────────────────────────────────────────────────────────────────
// Every request MUST carry the `x-vf-secret` header or a signed session cookie,
// checked by withAuth (lib/require-auth.js). Anything else is refused before
// any other work happens, and the
// admin Airtable credentials (AIRTABLE_API_KEY / AIRTABLE_JOBS_BASE / AIRTABLE_JOBS_TABLE)
// are used ONLY after that check passes.
//
// This function previously read `session.isAdmin` straight out of the request
// body to decide whether to use AIRTABLE_API_KEY / AIRTABLE_JOBS_BASE, so anyone
// who knew the URL could POST {"session":{"isAdmin":true}} and write arbitrary
// rows into the Jobs base. Nothing in the body may ever grant the admin path
// again — auth comes from lib/require-auth.js alone.
const { withAuth } = require("./lib/require-auth");

exports.handler = withAuth(async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { jobData } = JSON.parse(event.body || "{}");

  // Caller passed withAuth, so the admin credentials are the only ones.
  const airtableKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_JOBS_BASE;
  const tableId = process.env.AIRTABLE_JOBS_TABLE;

  // Log what we have for debugging
  console.log("Save job — hasKey:", !!airtableKey, "hasBase:", !!baseId, "hasTable:", !!tableId, "baseId:", baseId);

  if (!airtableKey || !baseId || !tableId) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved: false, message: "No Airtable configured — job logged locally only" }),
    };
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

    if (jobData.sceneUrls) {
      jobData.sceneUrls.forEach((url, i) => {
        fields[`Scene ${String(i + 1).padStart(2, "0")} URL`] = url;
      });
    }
    if (jobData.klingUrl) fields["Kling URL"] = jobData.klingUrl;

    const airtableRes = await fetch(`https://api.airtable.com/v0/${baseId}/Jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${airtableKey}` },
      body: JSON.stringify({ fields, typecast: true }),
    });

    const data = await airtableRes.json();
    console.log("Airtable response:", JSON.stringify(data).substring(0, 500));
    if (data.error) throw new Error(data.error.message);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved: true, recordId: data.id }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
});
