// translate.js — Translates a video script to US Hispanic Spanish via the Claude API
// ─── Auth ────────────────────────────────────────────────────────────────────
// Every request MUST carry the `x-vf-secret` header or a signed session cookie,
// checked by withAuth (lib/require-auth.js). Anything else is refused before
// any other work happens, and the
// admin Claude key (process.env.CLAUDE_API_KEY) is used ONLY after that check passes.
//
// This function previously read `session.isAdmin` straight out of the request
// body to decide whether to use CLAUDE_API_KEY, so anyone who knew the URL could POST
// {"session":{"isAdmin":true}} and bill tokens to the Claude account. Nothing in the body
// may ever grant the admin path again — auth comes from lib/require-auth.js alone.
const { withAuth } = require("./lib/require-auth");

exports.handler = withAuth(async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { script } = JSON.parse(event.body || "{}");
  if (!script) return { statusCode: 400, body: JSON.stringify({ error: "Script is required" }) };

  // Caller passed withAuth, so the admin key is the only key.
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
});
