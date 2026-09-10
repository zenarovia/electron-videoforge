// translate.js — Translates a video script to US Hispanic Spanish via the Claude API
// ─── Shared-secret auth ──────────────────────────────────────────────────────
// Every request MUST send the header `x-vf-secret` matching env VF_API_SECRET.
// A missing or wrong secret gets a 401 before any other work happens, and the
// admin Claude key (process.env.CLAUDE_API_KEY) is used ONLY after that check passes.
//
// This function previously read `session.isAdmin` straight out of the request
// body to decide whether to use CLAUDE_API_KEY, so anyone who knew the URL could POST
// {"session":{"isAdmin":true}} and bill tokens to the Claude account. Nothing in the body
// may ever grant the admin path again — auth comes from the header alone.
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

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { script } = JSON.parse(event.body || "{}");
  if (!script) return { statusCode: 400, body: JSON.stringify({ error: "Script is required" }) };

  // Caller proved they hold VF_API_SECRET, so the admin key is the only key.
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "CLAUDE_API_KEY not configured" }) };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: `Translate the following video script to US Hispanic Spanish.
Rules:
- Natural, conversational tone — not Castilian Spanish
- Numbers written as words (e.g. "two thousand nine" → "dos mil nueve")
- Preserve all line breaks exactly
- Preserve the emotional tone and pacing
- Do not add or remove sentences
- Return ONLY the translated script, nothing else

Script to translate:
${script}`
        }]
      })
    });

    const data = await response.json();
    const spanish = data.content?.[0]?.text;
    if (!spanish) throw new Error("No translation returned");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spanish }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
