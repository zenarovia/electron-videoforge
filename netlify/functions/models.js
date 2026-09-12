// models.js — Lists available Higgsfield image/video models
// ─── Auth ────────────────────────────────────────────────────────────────────
// Every request MUST carry the `x-vf-secret` header or a signed session cookie,
// checked by withAuth (lib/require-auth.js). Anything else is refused before
// any other work happens, and the
// admin Higgsfield key (process.env.HIGGSFIELD_API_KEY) is used ONLY after that check passes.
//
// This function previously read `isAdmin` out of the caller-supplied `x-session`
// header to decide whether to use HIGGSFIELD_API_KEY, so anyone who knew the URL
// could send x-session: {"isAdmin":true} and bill model lookups to the Higgsfield
// account. Nothing the caller supplies may ever grant the admin path again —
// auth comes from lib/require-auth.js alone.
const { withAuth } = require("./lib/require-auth");

exports.handler = withAuth(async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const type = event.queryStringParameters?.type || "image";

  // Caller passed withAuth, so the admin key is the only key.
  const higgsKey = process.env.HIGGSFIELD_API_KEY;
  if (!higgsKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "HIGGSFIELD_API_KEY not configured" }) };
  }

  try {
    const r = await fetch(`https://api.higgsfield.ai/v1/models?type=${type}`, {
      headers: { "Authorization": `Bearer ${higgsKey}` }
    });
    const data = await r.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models: data.models || [] }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
});
