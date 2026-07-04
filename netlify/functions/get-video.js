// get-video.js — Serves stored videos from Netlify Blobs
const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const fileName = event.queryStringParameters?.file;
  if (!fileName) return { statusCode: 400, body: "Missing file parameter" };

  try {
    const store = getStore({ name: "videoforge-videos", consistency: "strong" });
    const result = await store.getWithMetadata(fileName, { type: "arrayBuffer" });

    if (!result || !result.data) {
      return { statusCode: 404, body: "Video not found" };
    }

    const buffer = Buffer.from(result.data);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "public, max-age=86400",
      },
      body: buffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    return { statusCode: 500, body: `Error: ${err.message}` };
  }
};
