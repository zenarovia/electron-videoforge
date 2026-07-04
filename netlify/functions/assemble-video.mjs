// assemble-video.mjs — Background function: Fish Audio TTS + FFmpeg assembly
// Runs up to 15 minutes — well within Netlify's background function limit
// Stores finished MP4s in Netlify Blobs

import { getStore } from "@netlify/blobs";
import { execSync, spawnSync } from "child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const FISH_AUDIO_API = "https://api.fish.audio/v1/tts";
const FISH_VOICE_EN = "bf322df2096a46f18c579d0baa36f41d";
const FISH_VOICE_ES = "a1cb66db45664ddaa95043f285dbae42";

export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { jobId, imageUrls, animationUrls, enScript, esScript, language, title, session } = await req.json();

  if (!jobId || !imageUrls || !enScript) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
  }

  const fishKey = session?.isAdmin
    ? process.env.FISH_AUDIO_API_KEY
    : session?.fishApiKey;

  if (!fishKey) {
    return new Response(JSON.stringify({ error: "No Fish Audio API key" }), { status: 401 });
  }

  const tmpDir = join(tmpdir(), `vf-${jobId}`);
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  try {
    const results = {};

    // Generate EN video if needed
    if (language === "en" || language === "both") {
      console.log("Generating EN voiceover...");
      const enAudioPath = await generateVoiceover(enScript, FISH_VOICE_EN, fishKey, join(tmpDir, "en-audio.mp3"));
      console.log("Assembling EN video...");
      const enVideoPath = await assembleVideo(imageUrls, animationUrls, enAudioPath, join(tmpDir, "en-video.mp4"), tmpDir);
      console.log("Uploading EN video to Blobs...");
      const enUrl = await uploadToBlobs(enVideoPath, `${jobId}-en.mp4`, context);
      results.enUrl = enUrl;
    }

    // Generate ES video if needed
    if (language === "es" || language === "both") {
      console.log("Generating ES voiceover...");
      const esScriptText = esScript || enScript;
      const esAudioPath = await generateVoiceover(esScriptText, FISH_VOICE_ES, fishKey, join(tmpDir, "es-audio.mp3"));
      console.log("Assembling ES video...");
      const esVideoPath = await assembleVideo(imageUrls, animationUrls, esAudioPath, join(tmpDir, "es-video.mp4"), tmpDir);
      console.log("Uploading ES video to Blobs...");
      const esUrl = await uploadToBlobs(esVideoPath, `${jobId}-es.mp4`, context);
      results.esUrl = esUrl;
    }

    return new Response(JSON.stringify({ success: true, ...results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Assembly error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

// ─── Fish Audio TTS ───────────────────────────────────────────────────────────
async function generateVoiceover(script, voiceId, apiKey, outputPath) {
  const res = await fetch(FISH_AUDIO_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      text: script,
      reference_id: voiceId,
      format: "mp3",
      mp3_bitrate: 128,
    }),
  });

  if (!res.ok) throw new Error(`Fish Audio TTS failed: ${res.status} ${await res.text()}`);

  const buffer = await res.arrayBuffer();
  writeFileSync(outputPath, Buffer.from(buffer));
  return outputPath;
}

// ─── FFmpeg Assembly ──────────────────────────────────────────────────────────
async function assembleVideo(imageUrls, animationUrls, audioPath, outputPath, tmpDir) {
  // Download all images
  const imagePaths = [];
  for (let i = 0; i < imageUrls.length; i++) {
    if (!imageUrls[i]) continue;
    const imgPath = join(tmpDir, `scene-${String(i+1).padStart(2,"0")}.jpg`);
    const imgRes = await fetch(imageUrls[i]);
    const imgBuffer = await imgRes.arrayBuffer();
    writeFileSync(imgPath, Buffer.from(imgBuffer));
    imagePaths.push({ index: i, path: imgPath });
  }

  // Get audio duration using ffprobe
  const probeResult = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", audioPath
  ]);
  const audioDuration = parseFloat(probeResult.stdout?.toString() || "60");
  const perImageDuration = audioDuration / imagePaths.length;

  // Build FFmpeg input list
  const inputListPath = join(tmpDir, "input-list.txt");
  let inputList = "";

  for (const { index, path } of imagePaths) {
    // Check if this scene has an animation
    const animUrl = animationUrls?.[index];
    if (animUrl) {
      // Download animation clip
      const animPath = join(tmpDir, `anim-${index}.mp4`);
      const animRes = await fetch(animUrl);
      const animBuffer = await animRes.arrayBuffer();
      writeFileSync(animPath, Buffer.from(animBuffer));
      inputList += `file '${animPath}'\nduration 5\n`;
    } else {
      inputList += `file '${path}'\nduration ${perImageDuration.toFixed(3)}\n`;
    }
  }

  writeFileSync(inputListPath, inputList);

  // Assemble video with FFmpeg
  const ffmpegResult = spawnSync("ffmpeg", [
    "-y",
    "-f", "concat", "-safe", "0", "-i", inputListPath,
    "-i", audioPath,
    "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-shortest",
    "-movflags", "+faststart",
    outputPath
  ]);

  if (ffmpegResult.status !== 0) {
    throw new Error(`FFmpeg failed: ${ffmpegResult.stderr?.toString()}`);
  }

  return outputPath;
}

// ─── Upload to Netlify Blobs ──────────────────────────────────────────────────
async function uploadToBlobs(filePath, fileName, context) {
  const store = getStore({ name: "videoforge-videos", consistency: "strong" });
  const fileBuffer = readFileSync(filePath);
  await store.set(fileName, fileBuffer, { metadata: { contentType: "video/mp4" } });

  // Return the Netlify Blobs URL
  const siteUrl = process.env.URL || process.env.DEPLOY_URL || "";
  return `${siteUrl}/.netlify/functions/get-video?file=${fileName}`;
}

export const config = {
  path: "/api/assemble-video",
  type: "background",
};
