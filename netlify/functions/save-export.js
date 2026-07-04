// netlify/functions/save-export.js
// Automatically saves VideoForge job JSON to:
//   1. Netlify Blobs (store: videoforge-jobs, key: job-{jobId})
//   2. Google Drive (folder: 157fBxWHDt7efT_kmBVRbgEwo0_BWISGs)
//
// Required Netlify env vars:
//   NETLIFY_AUTH_TOKEN  — already set (used by Blobs)
//   GOOGLE_SERVICE_ACCOUNT_JSON — paste the full service account JSON as a single-line string

import { getStore } from "@netlify/blobs";

const DRIVE_FOLDER_ID = "157fBxWHDt7efT_kmBVRbgEwo0_BWISGs";

// ── Google Drive upload via service account ────────────────────────────────────
// We use the Drive REST API directly (no SDK needed) with a JWT-signed bearer token.

async function getGoogleAccessToken(serviceAccountJson) {
  const sa = JSON.parse(serviceAccountJson);

  // Build JWT header + claim
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  // Base64url encode
  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

  const headerB64 = b64url(header);
  const claimB64 = b64url(claim);
  const unsigned = `${headerB64}.${claimB64}`;

  // Sign with RSA private key using Web Crypto (available in Netlify Edge-compatible functions)
  const pemKey = sa.private_key;
  const pemBody = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyBuffer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );

  const signatureB64 = Buffer.from(signatureBuffer).toString("base64url");
  const jwt = `${unsigned}.${signatureB64}`;

  // Exchange JWT for access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Google token exchange failed: ${err}`);
  }

  const { access_token } = await tokenRes.json();
  return access_token;
}

async function uploadToDrive(accessToken, fileName, jsonContent, folderId) {
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: "application/json",
  };

  // Multipart upload
  const boundary = "vf-boundary-" + Date.now();
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json",
    "",
    jsonContent,
    `--${boundary}--`,
  ].join("\r\n");

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Drive upload failed: ${err}`);
  }

  return uploadRes.json(); // { id, name, mimeType, ... }
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req, context) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let jobData;
  try {
    jobData = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const jobId = jobData?.id;
  if (!jobId) {
    return new Response("Missing job id", { status: 400 });
  }

  const jsonContent = JSON.stringify(jobData, null, 2);
  const fileName = `${jobData.title || jobId}.json`;
  const results = { blobSaved: false, driveSaved: false, driveFileId: null, errors: [] };

  // ── 1. Save to Netlify Blobs ─────────────────────────────────────────────────
  try {
    const store = getStore({
      name: "videoforge-jobs",
      siteID: process.env.SITE_ID || process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN,
    });
    await store.set(`job-${jobId}`, jsonContent);
    results.blobSaved = true;
  } catch (err) {
    results.errors.push(`Blob save failed: ${err.message}`);
    console.error("Blob save error:", err);
  }

  // ── 2. Upload to Google Drive ────────────────────────────────────────────────
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    results.errors.push("GOOGLE_SERVICE_ACCOUNT_JSON env var not set");
  } else {
    try {
      const accessToken = await getGoogleAccessToken(saJson);
      const driveFile = await uploadToDrive(accessToken, fileName, jsonContent, DRIVE_FOLDER_ID);
      results.driveSaved = true;
      results.driveFileId = driveFile.id;
    } catch (err) {
      results.errors.push(`Drive upload failed: ${err.message}`);
      console.error("Drive upload error:", err);
    }
  }

  // Return 200 even if one destination failed — don't break the export UX
  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const config = { path: "/api/save-export" };
