#!/usr/bin/env node
// scripts/make-login-user.js — builds the env values Studio login reads.
//
//   node scripts/make-login-user.js twila --admin      prompts for a password
//   node scripts/make-login-user.js genesis            a non-admin login
//   node scripts/make-login-user.js --session-secret   a fresh VF_SESSION_SECRET
//
// Prints one VF_LOGIN_USERS entry as JSON. For several users, merge the entries
// into one object — {"twila":{...},"genesis":{...}} — and paste that into the
// Netlify environment variables. See netlify/functions/lib/session-token.js.
//
// The password is read from the terminal (or from stdin when piped), never from
// argv, so it stays out of shell history. Only its scrypt hash is printed. In
// Git Bash, run it through `winpty node ...` or use PowerShell, so the prompt
// gets a real terminal.

const crypto = require("crypto");
const { hashPassword } = require("../netlify/functions/lib/session-token");

const CTRL_C = String.fromCharCode(3);
const BACKSPACE = String.fromCharCode(8);
const DELETE = String.fromCharCode(127);

function readPassword(prompt) {
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { data += chunk; });
      process.stdin.on("end", () => resolve(data.replace(/\r?\n$/, "")));
    });
  }

  return new Promise((resolve) => {
    process.stderr.write(prompt);
    let value = "";
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.off("data", onData);
          process.stdin.pause();
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (ch === CTRL_C) {
          process.stderr.write("\n");
          process.exit(130);
        }
        if (ch === DELETE || ch === BACKSPACE) value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stdin.on("data", onData);
    process.stdin.resume();
  });
}

(async () => {
  const args = process.argv.slice(2);

  if (args.includes("--session-secret")) {
    console.log(crypto.randomBytes(32).toString("base64url"));
    return;
  }

  const name = (args.find((a) => !a.startsWith("--")) || "").toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(name)) {
    console.error("usage: node scripts/make-login-user.js <name> [--admin]");
    console.error("       name is 1-32 of a-z 0-9 _ -");
    process.exit(2);
  }

  const password = await readPassword(`Password for ${name}: `);
  if (password.length < 12) {
    console.error("Use at least 12 characters: login has no lockout.");
    process.exit(2);
  }

  const entry = { [name]: { hash: await hashPassword(password), admin: args.includes("--admin") } };
  console.log(JSON.stringify(entry));
})();
