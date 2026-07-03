// /api/prompts — Generates 8 scene image prompts from script via Claude
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { script, channelStyle, session } = req.body;
  if (!script) return res.status(400).json({ error: "Script is required" });

  const apiKey = getApiKey(session);
  if (!apiKey) return res.status(401).json({ error: "No Claude API key available" });

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
1. Scene 01 must be dynamic/action — it becomes a 5-second Kling animation
2. Scenes 02-07 progress through the emotional arc of the script  
3. Scene 08 is wide, warm, hopeful or contemplative — a closing shot
4. Vary shot types: wide establishing, medium, close-up, low angle, silhouette, intimate
5. If any character (human, animal, dog) appears in multiple scenes, lock their physical description and repeat it VERBATIM in every prompt they appear in
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

    // Parse JSON array from response
    const clean = text.replace(/```json|```/g, "").trim();
    const prompts = JSON.parse(clean);
    if (!Array.isArray(prompts) || prompts.length !== 8) throw new Error("Expected 8 prompts");

    res.json({ prompts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function getApiKey(session) {
  if (session?.isAdmin) return process.env.CLAUDE_API_KEY;
  return session?.claudeApiKey || null;
}
