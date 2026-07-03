// /api/models — Returns available models from Higgsfield catalog
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = req.headers["x-session"] ? JSON.parse(req.headers["x-session"]) : null;
  const type = req.query.type || "image"; // "image" or "video"

  const higgsKey = session?.isAdmin
    ? process.env.HIGGSFIELD_API_KEY
    : session?.higgsfieldApiKey;

  if (!higgsKey) return res.status(401).json({ error: "No Higgsfield API key" });

  try {
    const r = await fetch(`https://api.higgsfield.ai/v1/models?type=${type}`, {
      headers: { "Authorization": `Bearer ${higgsKey}` }
    });
    const data = await r.json();
    res.json({ models: data.models || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
