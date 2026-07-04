// get-video.mjs — Serves stored videos from Netlify Blobs
import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  const url = new URL(req.url);
  const fileName = url.searchParams.get("file");

  if (!fileName) {
    return new Response("Missing file parameter", { status: 400 });
  }

  try {
    const store = getStore({ name: "videoforge-videos", consistency: "strong", siteID: process.env.SITE_ID, token: process.env.NETLIFY_BLOBS_CONTEXT ? undefined : process.env.NETLIFY_AUTH_TOKEN });
    const { data, metadata } = await store.getWithMetadata(fileName, { type: "arrayBuffer" });

    if (!data) {
      return new Response("Video not found", { status: 404 });
    }

    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": metadata?.contentType || "video/mp4",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    return new Response(`Error: ${err.message}`, { status: 500 });
  }
};

export const config = { path: "/.netlify/functions/get-video" };
