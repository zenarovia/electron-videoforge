// session.js — who is signed in. The Studio UI asks on load, because page script
// can't see the httpOnly cookie to find out for itself. Like any authenticated
// call, it also refreshes the cookie.

const { withAuth } = require("./lib/require-auth");

exports.handler = withAuth(async (event, context, auth) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ via: auth.via, user: auth.user, expiresAt: auth.exp ?? null }),
  };
});
