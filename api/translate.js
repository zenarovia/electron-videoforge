// /api/translate — Translates English script to US Hispanic Spanish via Claude
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { script, session } = req.body;
  if (!script) return res.status(400).json({ error: "Script is required" });

  const apiKey = getApiKey(session);
  if (!apiKey) return res.status(401).json({ error: "No Claude API key available" });

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

    res.json({ spanish });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function getApiKey(session) {
  // Admin users use the backend Claude key
  if (session?.isAdmin) return process.env.CLAUDE_API_KEY;
  // Regular users provide their own (stored in session from their settings)
  return session?.claudeApiKey || null;
}
