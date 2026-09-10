// prompts.js — Turns a script into scene image prompts via the Claude API.
//
// The number of prompts is derived from how long the narration will run, not
// fixed at 8 — see lib/scene-count.js for the rule and for why the duration is
// estimated from the script rather than measured. Pass sceneCount or durationSec
// to override. A ~90s script still yields 8, which is what it always yielded.
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
const { resolveSceneCount, PacingError } = require("./lib/scene-count");

// Matches the per-request prompt cap in submit-images.js — no point writing more
// prompts than the submitter will accept.
const MAX_SCENES = 60;

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

  const { script, channelStyle, sceneCount, durationSec } = JSON.parse(event.body || "{}");
  if (typeof script !== "string" || !script.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "Script is required" }) };
  }

  let pacing;
  try {
    pacing = resolveSceneCount({ sceneCount, durationSec, script });
  } catch (err) {
    if (err instanceof PacingError) {
      return { statusCode: 400, body: JSON.stringify({ error: err.message, pacing: err.pacing }) };
    }
    throw err;
  }
  const count = pacing.sceneCount;
  if (count > MAX_SCENES) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: `${count} scenes needed for this script, over the ${MAX_SCENES} per-request maximum. Split the script.`,
        pacing,
      }),
    };
  }

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
        // Roughly 220 tokens of headroom per prompt; a 60-scene script needs far
        // more room than the 8-scene fixed budget this used to have.
        max_tokens: Math.min(16000, Math.max(2000, count * 220)),
        messages: [{
          role: "user",
          content: `You are writing image generation prompts for a narrated slideshow video.

Given this script, write exactly ${count} scene image prompts. The narration runs
about ${Math.round(pacing.durationSec)} seconds, so each image is on screen for roughly
${pacing.secondsPerScene.toFixed(0)} seconds — pace the scenes to cover the whole script evenly.

RULES:
1. Scene 01 must be dynamic/action — it becomes a 5-second animation
2. The middle scenes progress through the emotional arc of the script, in order, covering it end to end
3. The final scene (${count}) is wide, warm, hopeful or contemplative — a closing shot
4. Vary shot types: wide establishing, medium, close-up, low angle, silhouette, intimate
5. If any character appears in multiple scenes, lock their physical description and repeat it VERBATIM in every prompt they appear in
6. Every prompt must end with: ${styleAnchor}
7. Return ONLY a JSON array of ${count} strings, no other text

Script:
${script}

Return format (JSON array of exactly ${count} strings, nothing else):
[${Array.from({ length: count }, (_, i) => `"prompt ${i + 1}"`).join(", ")}]`
        }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text?.trim();
    if (!text) throw new Error("No prompts returned");

    const clean = text.replace(/```json|```/g, "").trim();
    const prompts = JSON.parse(clean);
    if (!Array.isArray(prompts) || prompts.length !== count) {
      throw new Error(`Expected ${count} prompts, got ${Array.isArray(prompts) ? prompts.length : typeof prompts}`);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompts,
        sceneCount: count,
        pacing: {
          durationSec: pacing.durationSec,
          durationSource: pacing.source,
          secondsPerScene: pacing.secondsPerScene,
        },
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
