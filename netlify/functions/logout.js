// logout.js — ends this browser's Studio session by expiring the cookie.
//
// Needs no credential (signing out is always allowed) but refuses cross-site
// posts, so another page can't sign Twila out mid-batch. Sessions are stateless:
// see lib/session-token.js for how to cut off a cookie that was copied elsewhere.

const { isSameOrigin } = require("./lib/require-auth");
const { clearedCookie } = require("./lib/session-token");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  if (!isSameOrigin(event)) {
    return {
      statusCode: 403,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Cross-site request refused" }),
    };
  }

  return { statusCode: 204, headers: { "Set-Cookie": clearedCookie(), "Cache-Control": "no-store" }, body: "" };
};
