// assemble-video.js — Assembles video with Fish Audio TTS + FFmpeg
// Uses ffmpeg-static for bundled FFmpeg binary on Netlify

const { getStore } = require("@netlify/blobs");
const { spawnSync } = require("child_process");
const { writeFileSync, readFileSync, mkdirSync, existsSync } = require("fs");
const { join } = require("path");
const { tmpdir } = require("os");

// Use bundled ffmpeg-static binary
const ffmpegPath = require("ffmpeg-static");

const FISH_AUDIO_API = "https://api.fish.audio/v1/tts";
const FISH_VOICE_EN = "bf322df2096a46f18c579d0baa36f41d";
const FISH_VOICE_ES = "a1cb66db45664ddaa95043f285dbae42";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  let parsed;
  try {
    parsed = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { jobId, imageUrls, animationUrls, enScript, esScript, language, session } = parsed;

  if (!jobId || !imageUrls || !enScript) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields: jobId, imageUrls, enScript" }) };
  }

  const fishKey = session?.isAdmin
    ? process.env.FISH_AUDIO_API_KEY
    : session?.fishApiKey;

  if (!fishKey) {
    return { statusCode: 401, body: JSON.stringify({ error: "No Fish Audio API key" }) };
  }

  const tmpDir = join(tmpdir(), `vf-${jobId}`);
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  console.log(`FFmpeg path: ${ffmpegPath}`);
  console.log(`Job: ${jobId}, language: ${language}, images: ${imageUrls.filter(Boolean).length}`);

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
      console.log("EN done:", enUrl);
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
      console.log("ES done:", esUrl);
    }

  // Save result record so assembly-status.js can find it via polling
    const assemblyStore = getStore({ name: "videoforge-assembly", consistency: "strong", siteID: process.env.SITE_ID, token: process.env.NETLIFY_BLOBS_CONTEXT ? undefined : process.env.NETLIFY_AUTH_TOKEN });
    await assemblyStore.set(`result-${jobId}`, JSON.stringify({
      allReady: true,
      enUrl: results.enUrl || null,
      esUrl: results.esUrl || null,
    }));
    console.log(`Saved assembly result for jobId: ${jobId}`);

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
    body: JSON.stringify({ text: script, reference_id: voiceId, format: "mp3", mp3_bitrate: 128 }),
  });
  if (!res.ok) throw new Error(`Fish Audio failed: ${res.status} ${await res.text()}`);
  writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
  return outputPath;
}

async function assembleVideo(imageUrls, animationUrls, audioPath, outputPath, tmpDir) {
  const imagePaths = [];
  for (let i = 0; i < imageUrls.length; i++) {
    if (!imageUrls[i]) continue;
    const imgPath = join(tmpDir, `scene-${String(i+1).padStart(2,"0")}.jpg`);
    const imgRes = await fetch(imageUrls[i]);
    if (!imgRes.ok) throw new Error(`Failed to download image ${i+1}: ${imgRes.status}`);
    writeFileSync(imgPath, Buffer.from(await imgRes.arrayBuffer()));
    imagePaths.push({ index: i, path: imgPath });
  }

  if (imagePaths.length === 0) throw new Error("No images to assemble");

  // Get audio duration using bundled ffmpeg
  const probe = spawnSync(ffmpegPath, [
    "-i", audioPath,
    "-hide_banner",
    "-f", "null", "-"
  ], { encoding: "utf8" });

  // Parse duration from stderr
  const durationMatch = (probe.stderr || "").match(/Duration: (\d+):(\d+):(\d+\.?\d*)/);
  let audioDuration = 60;
  if (durationMatch) {
    audioDuration = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseFloat(durationMatch[3]);
  }
  console.log(`Audio duration: ${audioDuration}s`);
  const perImageDuration = audioDuration / imagePaths.length;

  // Build input list
  const inputListPath = join(tmpDir, `input-${Date.now()}.txt`);
  let inputList = "";

  for (const { index, path: imgPath } of imagePaths) {
    const animUrl = animationUrls?.[index];
    if (animUrl) {
      const animPath = join(tmpDir, `anim-${index}.mp4`);
      const animRes = await fetch(animUrl);
      if (animRes.ok) {
        writeFileSync(animPath, Buffer.from(await animRes.arrayBuffer()));
        inputList += `file '${animPath}'\nduration 5\n`;
      } else {
        inputList += `file '${imgPath}'\nduration ${perImageDuration.toFixed(3)}\n`;
      }
    } else {
      inputList += `file '${imgPath}'\nduration ${perImageDuration.toFixed(3)}\n`;
    }
  }

  writeFileSync(inputListPath, inputList);
  console.log("Input list:\n" + inputList);

  // Run FFmpeg with bundled binary
  const result = spawnSync(ffmpegPath, [
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
    const stderr = result.stderr?.toString()?.slice(-1000) || "unknown error";
    console.error("FFmpeg stderr:", stderr);
    throw new Error(`FFmpeg failed: ${stderr.slice(-200)}`);
  }

  return outputPath;
}

async function uploadToBlobs(filePath, fileName) {
  const store = getStore({ name: "videoforge-videos", consistency: "strong", siteID: process.env.SITE_ID, token: process.env.NETLIFY_BLOBS_CONTEXT ? undefined : process.env.NETLIFY_AUTH_TOKEN });
  const fileBuffer = readFileSync(filePath);
  await store.set(fileName, fileBuffer, { metadata: { contentType: "video/mp4" } });
  const siteUrl = process.env.URL || "";
  return `${siteUrl}/.netlify/functions/get-video?file=${fileName}`;
}
