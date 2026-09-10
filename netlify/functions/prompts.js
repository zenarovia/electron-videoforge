// prompts.js — Turns a script into 8 scene image prompts via the Claude API
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

  const { script, channelStyle } = JSON.parse(event.body || "{}");
  if (!script) return { statusCode: 400, body: JSON.stringify({ error: "Script is required" }) };

  // Caller proved they hold VF_API_SECRET, so the admin key is the only key.
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "CLAUDE_API_KEY not configured" }) };
  }

  const styleAnchor = channelStyle || "cinematic film grain, muted warm golden-brown palette, shallow depth of field, photorealistic, 9:16 vertical";

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
          content: `You are writing image generation prompts for a narrated slideshow video.

Given this script, write exactly 8 scene image prompts.

RULES:
1. Scene 01 must be dynamic/action — it becomes a 5-second animation
2. Scenes 02-07 progress through the emotional arc of the script
3. Scene 08 is wide, warm, hopeful or contemplative — a closing shot
4. Vary shot types: wide establishing, medium, close-up, low angle, silhouette, intimate
5. If any character appears in multiple scenes, lock their physical description and repeat it VERBATIM in every prompt they appear in
6. Every prompt must end with: ${styleAnchor}
7. Return ONLY a JSON array of 8 strings, no other text

Script:
${script}

Return format (JSON array only):
["prompt 1", "prompt 2", "prompt 3", "prompt 4", "prompt 5", "prompt 6", "prompt 7", "prompt 8"]`
        }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text?.trim();
    if (!text) throw new Error("No prompts returned");

    const clean = text.replace(/```json|```/g, "").trim();
    const prompts = JSON.parse(clean);
    if (!Array.isArray(prompts) || prompts.length !== 8) throw new Error("Expected 8 prompts");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompts }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
