exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { script, channelStyle, session } = JSON.parse(event.body || "{}");
  if (!script) return { statusCode: 400, body: JSON.stringify({ error: "Script is required" }) };

  const apiKey = session?.isAdmin
    ? process.env.CLAUDE_API_KEY
    : session?.claudeApiKey;

  if (!apiKey) return { statusCode: 401, body: JSON.stringify({ error: "No Claude API key available" }) };

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
