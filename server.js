require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "STAFF_PASSWORD"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}
if (process.env.STAFF_PASSWORD.length < 12) {
  console.error("STAFF_PASSWORD must be at least 12 characters.");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));

// Stateless signed session tokens: safe across separate Netlify Function invocations.
const sessionSecret = crypto.createHash("sha256").update(process.env.STAFF_PASSWORD).digest();
function makeStaffToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000, nonce: crypto.randomBytes(16).toString("hex") })).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function validStaffToken(token) {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const expected = crypto.createHmac("sha256", sessionSecret).update(parts[0]).digest("base64url");
  if (!safeEqual(parts[1], expected)) return false;
  try { const data = JSON.parse(Buffer.from(parts[0], "base64url").toString()); return Number.isFinite(data.exp) && data.exp > Date.now(); }
  catch { return false; }
}
const DISPLAY_PASSWORD = process.env.DISPLAY_PASSWORD || "";
const todayBangkok = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function staffAuth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!validStaffToken(token)) {
    return res.status(401).json({ error: "กรุณาเข้าสู่ระบบพนักงานใหม่" });
  }
  next();
}
function displayAuth(req, res, next) {
  if (!DISPLAY_PASSWORD) return next();
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (token === process.env.DISPLAY_PASSWORD) return next();
  return res.status(401).json({ error: "ต้องใส่รหัสหน้าจอแสดงคิว" });
}
function clean(value, max = 300) {
  return String(value ?? "").trim().slice(0, max);
}
function apiError(res, error) {
  console.error(error);
  return res.status(500).json({ error: "ระบบทำรายการไม่สำเร็จ กรุณาตรวจสอบการตั้งค่าฐานข้อมูล" });
}

app.get("/api/health", (_req, res) => res.json({ ok: true, app: "queue-pickup-system" }));

app.post("/api/login", (req, res) => {
  const password = String(req.body?.password || "");
  if (!safeEqual(password, process.env.STAFF_PASSWORD)) {
    return res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" });
  }
  const token = makeStaffToken();
  res.json({ token, expiresInHours: 12 });
});

app.get("/api/queues", displayAuth, async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : todayBangkok();
  const { data, error } = await supabase.from("pickup_queues")
    .select("id,queue_date,queue_number,queue_code,customer_name,order_number,product_summary,note,status,created_at,called_at,completed_at")
    .eq("queue_date", date).order("queue_number", { ascending: true });
  if (error) return apiError(res, error);
  res.set("Cache-Control", "no-store");
  res.json({ date, queues: data || [] });
});

app.post("/api/queues", staffAuth, async (req, res) => {
  const prefix = clean(req.body?.prefix || "A", 1).toUpperCase();
  if (!["A", "C"].includes(prefix)) {
    return res.status(400).json({ error: "เลือกประเภทคิวได้เฉพาะ A หรือ C" });
  }
  const date = todayBangkok();
  // Queue suffixes count independently by type (A001, A002… and C001, C002…).
  // queue_number remains a unique daily ordering number for the existing schema.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: lastOrder, error: orderError } = await supabase.from("pickup_queues")
      .select("queue_number").eq("queue_date", date)
      .order("queue_number", { ascending: false }).limit(1);
    if (orderError) return apiError(res, orderError);
    const nextOrder = (lastOrder?.[0]?.queue_number || 0) + 1;

    const { data: sameType, error: typeError } = await supabase.from("pickup_queues")
      .select("queue_code").eq("queue_date", date).like("queue_code", `${prefix}%`);
    if (typeError) return apiError(res, typeError);
    const maxSuffix = (sameType || []).reduce((max, row) => {
      const match = new RegExp(`^${prefix}(\\d+)$`).exec(row.queue_code || "");
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const nextSuffix = maxSuffix + 1;
    const row = {
      queue_date: date, queue_number: nextOrder,
      queue_code: `${prefix}${String(nextSuffix).padStart(3, "0")}`,
      customer_name: "", order_number: "", product_summary: "", note: "", status: "waiting"
    };
    const { data, error } = await supabase.from("pickup_queues").insert(row).select().single();
    if (!error) return res.status(201).json({ queue: data });
    if (error.code !== "23505") return apiError(res, error);
  }
  res.status(409).json({ error: "มีการออกคิวพร้อมกันหลายรายการ กรุณาลองอีกครั้ง" });
});

app.patch("/api/queues/:id", staffAuth, async (req, res) => {
  const id = Number(req.params.id);
  const status = clean(req.body?.status, 20);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "รหัสคิวไม่ถูกต้อง" });
  if (!["waiting", "calling", "done"].includes(status)) return res.status(400).json({ error: "สถานะไม่ถูกต้อง" });
  const patch = { status };
  if (status === "calling") patch.called_at = new Date().toISOString();
  if (status === "done") patch.completed_at = new Date().toISOString();
  const { data, error } = await supabase.from("pickup_queues").update(patch)
    .eq("id", id).eq("queue_date", todayBangkok()).select().single();
  if (error) {
    if (error.code === "PGRST116") return res.status(404).json({ error: "ไม่พบคิวของวันนี้" });
    return apiError(res, error);
  }
  res.json({ queue: data });
});

app.get("/display", (_req, res) => res.sendFile(path.join(__dirname, "public", "display.html")));
app.get("/staff", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/call", (_req, res) => res.sendFile(path.join(__dirname, "public", "call.html")));

const port = Number(process.env.PORT || 3000);
if (require.main === module) app.listen(port, () => console.log(`Pickup queue server listening on port ${port}`));
module.exports = app;
