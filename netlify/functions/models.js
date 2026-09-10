// models.js — Lists available Higgsfield image/video models
// ─── Shared-secret auth ──────────────────────────────────────────────────────
// Every request MUST send the header `x-vf-secret` matching env VF_API_SECRET.
// A missing or wrong secret gets a 401 before any other work happens, and the
// admin Higgsfield key (process.env.HIGGSFIELD_API_KEY) is used ONLY after that check passes.
//
// This function previously read `isAdmin` out of the caller-supplied `x-session`
// header to decide whether to use HIGGSFIELD_API_KEY, so anyone who knew the URL
// could send x-session: {"isAdmin":true} and bill model lookups to the Higgsfield
// account. Nothing the caller supplies may ever grant the admin path again —
// auth comes from x-vf-secret alone.
//
// NOTE: the Studio web UI does NOT send this header, so it cannot call this
// function as-is. If the UI is ever brought back, add
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

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const type = event.queryStringParameters?.type || "image";

  // Caller proved they hold VF_API_SECRET, so the admin key is the only key.
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
};
