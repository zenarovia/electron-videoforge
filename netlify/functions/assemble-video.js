// assemble-video.js — Assembles video with Fish Audio TTS
// Uses regular function with extended timeout via netlify.toml
const { getStore } = require("@netlify/blobs");
const { spawnSync } = require("child_process");
const { writeFileSync, readFileSync, mkdirSync, existsSync } = require("fs");
const { join } = require("path");
const { tmpdir } = require("os");

const FISH_AUDIO_API = "https://api.fish.audio/v1/tts";
const FISH_VOICE_EN = "bf322df2096a46f18c579d0baa36f41d";
const FISH_VOICE_ES = "a1cb66db45664ddaa95043f285dbae42";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { jobId, imageUrls, animationUrls, enScript, esScript, language, session } = JSON.parse(event.body || "{}");

  if (!jobId || !imageUrls || !enScript) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };
  }

  const fishKey = session?.isAdmin
    ? process.env.FISH_AUDIO_API_KEY
    : session?.fishApiKey;

  if (!fishKey) {
    return { statusCode: 401, body: JSON.stringify({ error: "No Fish Audio API key" }) };
  }

  const tmpDir = join(tmpdir(), `vf-${jobId}`);
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  try {
    const results = {};

    if (language === "en" || language === "both") {
      console.log("Generating EN voiceover...");
      const enAudioPath = await generateVoiceover(enScript, FISH_VOICE_EN, fishKey, join(tmpDir, "en-audio.mp3"));
      console.log("Assembling EN video...");
      const enVideoPath = await assembleVideo(imageUrls, animationUrls, enAudioPath, join(tmpDir, "en-video.mp4"), tmpDir);
      console.log("Uploading EN to Blobs...");
      const enUrl = await uploadToBlobs(enVideoPath, `${jobId}-en.mp4`);
      results.enUrl = enUrl;
      results.enReady = true;
    }

    if (language === "es" || language === "both") {
      console.log("Generating ES voiceover...");
      const esAudioPath = await generateVoiceover(esScript || enScript, FISH_VOICE_ES, fishKey, join(tmpDir, "es-audio.mp3"));
      console.log("Assembling ES video...");
      const esVideoPath = await assembleVideo(imageUrls, animationUrls, esAudioPath, join(tmpDir, "es-video.mp4"), tmpDir);
      console.log("Uploading ES to Blobs...");
      const esUrl = await uploadToBlobs(esVideoPath, `${jobId}-es.mp4`);
      results.esUrl = esUrl;
      results.esReady = true;
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, allReady: true, ...results }),
    };
  } catch (err) {
    console.error("Assembly error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

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
  if (!res.ok) throw new Error(`Fish Audio failed: ${res.status} ${await res.text()}`);
  const buffer = await res.arrayBuffer();
  writeFileSync(outputPath, Buffer.from(buffer));
  return outputPath;
}

async function assembleVideo(imageUrls, animationUrls, audioPath, outputPath, tmpDir) {
  // Download all images
  const imagePaths = [];
  for (let i = 0; i < imageUrls.length; i++) {
    if (!imageUrls[i]) continue;
    const imgPath = join(tmpDir, `scene-${String(i+1).padStart(2,"0")}.jpg`);
    const imgRes = await fetch(imageUrls[i]);
    writeFileSync(imgPath, Buffer.from(await imgRes.arrayBuffer()));
    imagePaths.push({ index: i, path: imgPath });
  }

  // Get audio duration
  const probe = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", audioPath
  ]);
  const audioDuration = parseFloat(probe.stdout?.toString() || "60");
  const perImageDuration = audioDuration / imagePaths.length;

  // Build input list
  const inputListPath = join(tmpDir, `input-${Date.now()}.txt`);
  let inputList = "";

  for (const { index, path } of imagePaths) {
    const animUrl = animationUrls?.[index];
    if (animUrl) {
      const animPath = join(tmpDir, `anim-${index}.mp4`);
      const animRes = await fetch(animUrl);
      writeFileSync(animPath, Buffer.from(await animRes.arrayBuffer()));
      inputList += `file '${animPath}'\nduration 5\n`;
    } else {
      inputList += `file '${path}'\nduration ${perImageDuration.toFixed(3)}\n`;
    }
  }

  writeFileSync(inputListPath, inputList);

  // Run FFmpeg
  const result = spawnSync("ffmpeg", [
    "-y",
    "-f", "concat", "-safe", "0", "-i", inputListPath,
    "-i", audioPath,
    "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-shortest", "-movflags", "+faststart",
    outputPath
  ], { timeout: 600000 });

  if (result.status !== 0) {
    throw new Error(`FFmpeg failed: ${result.stderr?.toString()?.slice(0, 500)}`);
  }
  return outputPath;
}

async function uploadToBlobs(filePath, fileName) {
  const store = getStore({ name: "videoforge-videos", consistency: "strong" });
  const fileBuffer = readFileSync(filePath);
  await store.set(fileName, fileBuffer, { metadata: { contentType: "video/mp4" } });
  const siteUrl = process.env.URL || "";
  return `${siteUrl}/.netlify/functions/get-video?file=${fileName}`;
}
