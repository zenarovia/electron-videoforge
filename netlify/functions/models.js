exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const session = event.headers["x-session"] ? JSON.parse(event.headers["x-session"]) : null;
  const type = event.queryStringParameters?.type || "image";

  const higgsKey = session?.isAdmin
    ? process.env.HIGGSFIELD_API_KEY
    : session?.higgsfieldApiKey;

  if (!higgsKey) return { statusCode: 401, body: JSON.stringify({ error: "No Higgsfield API key" }) };

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
