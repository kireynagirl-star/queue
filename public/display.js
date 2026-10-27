const $ = id => document.getElementById(id);
const statusText = { waiting: "รอเรียก", calling: "กำลังเรียก", done: "รับสินค้าแล้ว" };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
let displayPassword = sessionStorage.getItem("pickupDisplayPassword") || "";
async function fetchQueues() {
  const headers = {};
  if (displayPassword) headers.Authorization = displayPassword;
  const response = await fetch("/api/queues", { headers, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    displayPassword = prompt("กรุณาใส่รหัสหน้าจอแสดงคิว");
    if (displayPassword) sessionStorage.setItem("pickupDisplayPassword", displayPassword);
    else throw new Error("ต้องใส่รหัสหน้าจอแสดงคิว");
    return fetchQueues();
  }
  if (!response.ok) throw new Error(data.error || "โหลดคิวไม่สำเร็จ");
  return data;
}
async function refresh() {
  try {
    const result = await fetchQueues();
    const queues = result.queues || [];
    const calling = queues.filter(q => q.status === "calling");
    const waiting = queues.filter(q => q.status === "waiting");
    const done = queues.filter(q => q.status === "done");
    $("currentQueues").innerHTML = calling.length ? calling.map(q => `<div class="current-ticket"><strong>${esc(q.queue_code)}</strong></div>`).join("") : `<div class="empty-current">ยังไม่มีคิวที่เรียก · กรุณารอสักครู่</div>`;
    $("waitingQueues").innerHTML = waiting.length ? waiting.slice(0, 12).map(q => `<div class="waiting-ticket"><strong>${esc(q.queue_code)}</strong></div>`).join("") : `<p class="muted">ไม่มีคิวรอเรียก</p>`;
    $("waitTotal").textContent = `${waiting.length} คิว`;
    $("completedCount").textContent = done.length;
    $("displayError").textContent = "";
  } catch (e) { $("displayError").textContent = e.message; }
}
function tickClock() { $("clock").textContent = new Date().toLocaleString("th-TH",{timeZone:"Asia/Bangkok",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",second:"2-digit"}); }
tickClock(); refresh(); setInterval(tickClock,1000); setInterval(refresh,5000);
