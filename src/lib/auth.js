// ─── VideoForge Auth ──────────────────────────────────────────────────────────
const STORAGE_KEY = "videoforge:session";

// Hardcoded admin emails — always admin regardless of env vars
const HARDCODED_ADMINS = ["twilag@gmail.com", "the.focused.system@gmail.com"];

const ADMIN_EMAILS = [
  ...HARDCODED_ADMINS,
  ...(import.meta.env.VITE_ADMIN_EMAILS || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean)
];

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "videoforge_salt_2026");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getUsers() {
  try { return JSON.parse(localStorage.getItem("videoforge:users") || "{}"); }
  catch { return {}; }
}

function saveUsers(users) {
  localStorage.setItem("videoforge:users", JSON.stringify(users));
}

export async function register({ name, email, password }) {
  const users = getUsers();
  const key = email.toLowerCase();
  if (users[key]) throw new Error("An account with this email already exists.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  const hash = await hashPassword(password);
  const isAdmin = ADMIN_EMAILS.includes(key);
  users[key] = { name, email: key, hash, tier: isAdmin ? "admin" : "user", createdAt: new Date().toISOString() };
  saveUsers(users);
  return createSession(users[key]);
}

export async function login({ email, password }) {
  const users = getUsers();
  const key = email.toLowerCase();
  const user = users[key];
  if (!user) throw new Error("No account found with this email.");
  const hash = await hashPassword(password);
  if (hash !== user.hash) throw new Error("Incorrect password.");
  const isAdmin = ADMIN_EMAILS.includes(key);
  if (user.tier !== (isAdmin ? "admin" : "user")) {
    users[key].tier = isAdmin ? "admin" : "user";
    saveUsers(users);
  }
  return createSession({ ...user, tier: isAdmin ? "admin" : "user" });
}

function createSession(user) {
  const session = { name: user.name, email: user.email, tier: user.tier, isAdmin: user.tier === "admin", loggedInAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function getSession() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
  catch { return null; }
}

export function logout() { localStorage.removeItem(STORAGE_KEY); }
export function isAdmin(session) { return session?.tier === "admin"; }
