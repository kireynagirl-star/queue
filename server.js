require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
// On Netlify, serverless-http pre-fills req.body with a raw Buffer, so express.json() skips it.
app.use((req, _res, next) => {
  if (Buffer.isBuffer(req.body)) {
    try { req.body = req.body.length ? JSON.parse(req.body.toString("utf8")) : {}; }
    catch { req.body = {}; }
  }
  next();
});
app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));

const DISPLAY_PASSWORD = process.env.DISPLAY_PASSWORD || "";
const STAFF_PASSWORD = "kireynagirl";
const SESSION_COOKIE = "staff_session";
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const todayBangkok = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());

function displayAuth(req, res, next) {
  if (!DISPLAY_PASSWORD) return next();
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (token === process.env.DISPLAY_PASSWORD) return next();
  return res.status(401).json({ error: "ต้องใส่รหัสหน้าจอแสดงคิว" });
}
function sign(value) {
  return crypto.createHmac("sha256", STAFF_PASSWORD).update(value).digest("base64url");
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function readCookie(req, name) {
  const pair = (req.headers.cookie || "").split(";").map(c => c.trim()).find(c => c.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : "";
}
function hasStaffSession(req) {
  const [expires, signature] = readCookie(req, SESSION_COOKIE).split(".");
  return Boolean(expires && signature) && Number(expires) > Date.now() && safeEqual(signature, sign(expires));
}
function staffAuth(req, res, next) {
  if (hasStaffSession(req)) return next();
  return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ" });
}
function sessionCookie(req, value, maxAgeSeconds) {
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
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
  if (!safeEqual(clean(req.body?.password, 100), STAFF_PASSWORD)) {
    return res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" });
  }
  const expires = String(Date.now() + SESSION_MAX_AGE_MS);
  res.set("Set-Cookie", sessionCookie(req, `${expires}.${sign(expires)}`, SESSION_MAX_AGE_MS / 1000));
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => {
  res.set("Set-Cookie", sessionCookie(req, "", 0));
  res.json({ ok: true });
});
app.get("/api/session", staffAuth, (_req, res) => res.json({ ok: true }));


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
  const prefix = clean(req.body?.prefix || "F", 1).toUpperCase();
  if (!["F", "N"].includes(prefix)) {
    return res.status(400).json({ error: "เลือกประเภทคิวได้เฉพาะ F หรือ N" });
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
app.get("/login", (_req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/call", (_req, res) => res.sendFile(path.join(__dirname, "public", "call.html")));

const port = Number(process.env.PORT || 3000);
if (require.main === module) app.listen(port, () => console.log(`Pickup queue server listening on port ${port}`));
module.exports = app;
