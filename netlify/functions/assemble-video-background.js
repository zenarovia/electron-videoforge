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

// ─── Auth ────────────────────────────────────────────────────────────────────
// Every request MUST carry the `x-vf-secret` header or a signed session cookie,
// checked by withAuth (lib/require-auth.js). Anything else is refused before
// any other work happens, and the
// admin Fish Audio key (process.env.FISH_AUDIO_API_KEY) is used ONLY after that check passes.
//
// This function previously read `session.isAdmin` straight out of the request
// body to decide whether to use FISH_AUDIO_API_KEY, so anyone who knew the URL could POST
// {"session":{"isAdmin":true}} and spend the Fish Audio balance. Nothing in the body
// may ever grant the admin path again — auth comes from lib/require-auth.js alone.
const { withAuth } = require("./lib/require-auth");

exports.handler = withAuth(async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };

  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  let parsed;
  try {
    parsed = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { jobId, imageUrls, animationUrls, enScript, esScript, language } = parsed;

  if (!jobId || !imageUrls || !enScript) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields: jobId, imageUrls, enScript" }) };
  }

  // Caller passed withAuth, so the admin key is the only key.
  const fishKey = process.env.FISH_AUDIO_API_KEY;
  if (!fishKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "FISH_AUDIO_API_KEY not configured" }) };
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
});

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

  // Get audio duration
  const probe = spawnSync(ffmpegPath, [
    "-i", audioPath, "-hide_banner", "-f", "null", "-"
  ], { encoding: "utf8" });
  const durationMatch = (probe.stderr || "").match(/Duration: (\d+):(\d+):(\d+\.?\d*)/);
  let audioDuration = 60;
  if (durationMatch) {
    audioDuration = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseFloat(durationMatch[3]);
  }
  console.log(`Audio duration: ${audioDuration}s`);

  // Download animations
  const ANIM_DURATION = 5;
  const downloadedAnims = {};
  for (const { index } of imagePaths) {
    const animUrl = animationUrls?.[index];
    if (animUrl) {
      const animRes = await fetch(animUrl);
      if (animRes.ok) {
        const animPath = join(tmpDir, `anim-raw-${index}.mp4`);
        writeFileSync(animPath, Buffer.from(await animRes.arrayBuffer()));
        downloadedAnims[index] = animPath;
      }
    }
  }

  // Calculate per-still duration
  const animCount = Object.keys(downloadedAnims).length;
  const stillCount = imagePaths.length - animCount;
  const remainingTime = audioDuration - (animCount * ANIM_DURATION);
  const perStillDuration = stillCount > 0 ? remainingTime / stillCount : audioDuration / imagePaths.length;
  console.log(`Anim scenes: ${animCount}, still scenes: ${stillCount}, per-still: ${perStillDuration.toFixed(3)}s`);

  // Convert every scene to a standardized MP4 clip (no audio, same resolution)
  // This ensures FFmpeg only ever concats MP4s — mixing JPGs and MP4s causes stream issues
  const clipPaths = [];
  for (const { index, path: imgPath } of imagePaths) {
    const clipPath = join(tmpDir, `clip-${index}.mp4`);

    if (downloadedAnims[index]) {
      // Re-encode animation clip to standard format, trim to ANIM_DURATION
      const r = spawnSync(ffmpegPath, [
        "-y",
        "-i", downloadedAnims[index],
        "-t", String(ANIM_DURATION),
        "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-an",
        clipPath
      ], { timeout: 120000 });
      if (r.status !== 0) {
        console.warn(`Anim encode failed for scene ${index}, falling back to still`);
        // Fall back to still image if animation encode fails
        const fbFps = 25;
        const fbFrames = Math.ceil(perStillDuration * fbFps);
        const fbKenBurns = `scale=8000:-1,zoompan=z='1.0+${(0.05/fbFrames).toFixed(6)}*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${fbFrames}:s=1080x1920:fps=${fbFps},setsar=1`;
        const fallback = spawnSync(ffmpegPath, [
          "-y",
          "-loop", "1", "-i", imgPath,
          "-t", perStillDuration.toFixed(3),
          "-vf", fbKenBurns,
          "-c:v", "libx264", "-preset", "fast", "-crf", "23",
          "-an",
          clipPath
        ], { timeout: 120000 });
        if (fallback.status !== 0) throw new Error(`Still encode failed for scene ${index}`);
      }
    } else {
      // Convert still image to video clip with Ken Burns zoom effect
      const fps = 25;
      const totalFrames = Math.ceil(perStillDuration * fps);
      // Alternate between zoom-in and zoom-out based on scene index for variety
      const zoomDir = index % 2 === 0 ? 1 : -1;
      const zoomStart = zoomDir === 1 ? 1.0 : 1.05;
      const zoomEnd = zoomDir === 1 ? 1.05 : 1.0;
      const kenBurns = `scale=8000:-1,zoompan=z='${zoomStart}+${((zoomEnd-zoomStart)/totalFrames).toFixed(6)}*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps},setsar=1`;
      const r = spawnSync(ffmpegPath, [
        "-y",
        "-loop", "1", "-i", imgPath,
        "-t", perStillDuration.toFixed(3),
        "-vf", kenBurns,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-an",
        clipPath
      ], { timeout: 120000 });
      if (r.status !== 0) throw new Error(`Still encode failed for scene ${index}: ${r.stderr?.toString()?.slice(-200)}`);
    }

    clipPaths.push(clipPath);
    console.log(`Scene ${index} encoded → ${clipPath}`);
  }

  // Concat all MP4 clips
  const concatListPath = join(tmpDir, `concat-${Date.now()}.txt`);
  const concatList = clipPaths.map(p => `file '${p}'`).join("\n");
  writeFileSync(concatListPath, concatList);
  console.log("Concat list:\n" + concatList);

  // Final merge: concat video clips + audio
  const result = spawnSync(ffmpegPath, [
    "-y",
    "-f", "concat", "-safe", "0", "-i", concatListPath,
    "-i", audioPath,
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-shortest",
    "-movflags", "+faststart",
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
