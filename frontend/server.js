/**
 * Sakura Tracker — Backend (file-based, Railway Volume friendly)
 * - Uses /data/users/<sha256(email)>.json for persistent storage (place /data on Railway Volume)
 * - Register / Login (bcrypt + JWT)
 * - Sync endpoints: /sync/upload (replace) and /sync/download
 *
 * NOTE: This simple file-based approach is great for small projects and personal apps.
 * If you want multi-instance concurrency / scalability later, consider PostgreSQL.
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Config
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "please-set-a-real-secret";
const DATA_DIR = process.env.DATA_DIR || "/data"; // Railway volume should mount here
const USERS_DIR = path.join(DATA_DIR, "users");

// Make sure data directories exist
async function ensureDirs() {
  try {
    await fs.mkdir(USERS_DIR, { recursive: true });
    console.log("Data dir ready:", USERS_DIR);
  } catch (err) {
    console.error("Failed to create data dir:", err);
    process.exit(1);
  }
}

// Utility: deterministically generate user id from email
function userIdFromEmail(email) {
  return crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}
function userFilePath(idHex) {
  return path.join(USERS_DIR, `${idHex}.json`);
}

// Load user by email (returns null if no user)
async function loadUserByEmail(email) {
  const id = userIdFromEmail(email);
  const p = userFilePath(id);
  try {
    const raw = await fs.readFile(p, "utf8");
    const obj = JSON.parse(raw);
    return obj;
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

// Save user object (overwrites)
async function saveUser(userObj) {
  const p = userFilePath(userObj.id);
  // Ensure safe JSON and atomic write pattern: write temp then rename
  const tmp = p + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(userObj, null, 2), { encoding: "utf8" });
  await fs.rename(tmp, p);
}

// Basic sanitization for transactions (returns sanitized list)
function sanitizeTransactions(list) {
  if (!Array.isArray(list)) return [];
  return list.map((t) => {
    return {
      id: String(t.id ?? crypto.randomUUID()),
      title: String(t.title ?? "Untitled"),
      description: String(t.description ?? ""),
      type: String(t.type ?? "purchase"),
      amount: Number(t.amount ?? 0),
      date: String(t.date ?? new Date().toISOString()),
    };
  });
}

// Auth: create JWT
function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

// Middleware: require Authorization: Bearer <token>
async function authMiddleware(req, res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" });
    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    // load user file
    const user = await loadUserByEmail(decoded.email);
    if (!user) return res.status(401).json({ error: "Invalid token (user not found)" });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Auth failed" });
  }
}

/* -----------------------
   Public endpoints
   ----------------------- */

// Health
app.get("/health", (req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

// REGISTER
// body: { email, password }
app.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const existing = await loadUserByEmail(email);
    if (existing) return res.status(400).json({ error: "Account already exists" });

    const id = userIdFromEmail(email);
    const passwordHash = await bcrypt.hash(String(password), 12);

    const userObj = {
      id,
      email: String(email).toLowerCase(),
      passwordHash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // store transactions as an array
      transactions: [],
      meta: {}
    };

    await saveUser(userObj);
    return res.json({ success: true });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// LOGIN
// body: { email, password }
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const user = await loadUserByEmail(email);
    if (!user) return res.status(400).json({ error: "Invalid login" });

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(400).json({ error: "Invalid login" });

    const token = createToken({ id: user.id, email: user.email });
    return res.json({ token });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* -----------------------
   Authenticated sync endpoints
   ----------------------- */

// DOWNLOAD server -> client
// GET /sync/download
// returns { transactions: [...] }
app.get("/sync/download", authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    return res.json({ transactions: user.transactions ?? [] });
  } catch (err) {
    console.error("Download error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// UPLOAD client -> server (replace entire transactions list)
// POST /sync/upload { transactions: [...] }
app.post("/sync/upload", authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const incoming = req.body?.transactions;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ error: "transactions must be an array" });
    }

    const sanitized = sanitizeTransactions(incoming);
    user.transactions = sanitized;
    user.updatedAt = new Date().toISOString();

    await saveUser(user);
    return res.json({ success: true });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// OPTIONAL: merge endpoint that attempts to merge arrays by id (client-side may prefer this)
app.post("/sync/merge", authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const incoming = req.body?.transactions;
    if (!Array.isArray(incoming)) return res.status(400).json({ error: "transactions must be array" });

    const current = Array.isArray(user.transactions) ? user.transactions : [];
    const map = new Map();
    for (const t of current) map.set(String(t.id), t);
    for (const t of incoming) map.set(String(t.id), {
      id: String(t.id ?? crypto.randomUUID()),
      title: String(t.title ?? "Untitled"),
      description: String(t.description ?? ""),
      type: String(t.type ?? "purchase"),
      amount: Number(t.amount ?? 0),
      date: String(t.date ?? new Date().toISOString())
    });

    const merged = Array.from(map.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
    user.transactions = merged;
    user.updatedAt = new Date().toISOString();
    await saveUser(user);
    return res.json({ success: true, transactions: merged });
  } catch (err) {
    console.error("Merge error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Delete account (dangerous — leaving for dev use only)
// POST /account/delete { confirm: true }
// requires auth
app.post("/account/delete", authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const confirm = req.body?.confirm === true;
    if (!confirm) return res.status(400).json({ error: "Missing confirm flag" });

    const p = userFilePath(user.id);
    await fs.unlink(p);
    return res.json({ success: true });
  } catch (err) {
    console.error("Delete account error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* -----------------------
   Startup
   ----------------------- */
async function start() {
  await ensureDirs();
  app.listen(PORT, () => {
    console.log(`Sakura backend listening on ${PORT} (DATA_DIR=${DATA_DIR})`);
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});


