exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { script, session } = JSON.parse(event.body || "{}");
  if (!script) return { statusCode: 400, body: JSON.stringify({ error: "Script is required" }) };

  const apiKey = session?.isAdmin
    ? process.env.CLAUDE_API_KEY
    : session?.claudeApiKey;

  if (!apiKey) return { statusCode: 401, body: JSON.stringify({ error: "No Claude API key available" }) };

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
