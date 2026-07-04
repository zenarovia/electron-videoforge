// netlify/functions/save-export.js
// Saves VideoForge job JSON to:
//   1. Netlify Blobs (store: videoforge-jobs, key: job-{jobId})
//   2. Google Drive (folder: 157fBxWHDt7efT_kmBVRbgEwo0_BWISGs)
//
// Required Netlify env vars:
//   NETLIFY_AUTH_TOKEN          — already set
//   NETLIFY_SITE_ID             — already set
//   GOOGLE_SERVICE_ACCOUNT_JSON — paste full service account JSON as one-line string

const { getStore } = require("@netlify/blobs");

const DRIVE_FOLDER_ID = "157fBxWHDt7efT_kmBVRbgEwo0_BWISGs";

async function getGoogleAccessToken(serviceAccountJson) {
  const sa = JSON.parse(serviceAccountJson);

  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${b64url(header)}.${b64url(claim)}`;

  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyBuffer = Buffer.from(pemBody, "base64");

  const crypto = require("crypto");
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign({ key: `-----BEGIN PRIVATE KEY-----\n${pemBody}\n-----END PRIVATE KEY-----`, format: "pem" }, "base64url");

  const jwt = `${unsigned}.${signature}`;

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
  const metadata = { name: fileName, parents: [folderId], mimeType: "application/json" };
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

  return uploadRes.json();
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let jobData;
  try {
    jobData = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "Invalid JSON body" };
  }

  const jobId = jobData?.id;
  if (!jobId) {
    return { statusCode: 400, body: "Missing job id" };
  }

  const jsonContent = JSON.stringify(jobData, null, 2);
  const fileName = `${jobData.title || jobId}.json`;
  const results = { blobSaved: false, driveSaved: false, driveFileId: null, errors: [] };

  // 1. Save to Netlify Blobs
  try {
    const store = getStore({
      name: "videoforge-jobs",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN,
    });
    await store.set(`job-${jobId}`, jsonContent);
    results.blobSaved = true;
    console.log("Blob save success for job:", jobId);
  } catch (err) {
    results.errors.push(`Blob save failed: ${err.message}`);
    console.error("Blob save error:", err.message);
  }

  // 2. Upload to Google Drive
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!saJson) {
    results.errors.push("GOOGLE_SERVICE_ACCOUNT_JSON env var not set");
  } else {
    try {
      const accessToken = await getGoogleAccessToken(saJson);
      const driveFile = await uploadToDrive(accessToken, fileName, jsonContent, DRIVE_FOLDER_ID);
      results.driveSaved = true;
      results.driveFileId = driveFile.id;
      console.log("Drive upload success:", driveFile.id);
    } catch (err) {
      results.errors.push(`Drive upload failed: ${err.message}`);
      console.error("Drive upload error:", err.message);
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(results),
  };
};
