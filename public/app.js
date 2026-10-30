const $ = (id) => document.getElementById(id);
let queues = [];
const statusText = { waiting: "รอเรียก", calling: "กำลังเรียก", done: "รับสินค้าแล้ว" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
async function api(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const response = await fetch(url, { ...options, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { location.href = "/login"; throw new Error(data.error || "กรุณาเข้าสู่ระบบ"); }
  if (!response.ok) throw new Error(data.error || `เกิดข้อผิดพลาด (${response.status})`);
  return data;
}
function render() {
  $("waitingCount").textContent = queues.filter(q => q.status === "waiting").length;
  $("callingCount").textContent = queues.filter(q => q.status === "calling").length;
  $("doneCount").textContent = queues.filter(q => q.status === "done").length;
  const query = $("search").value.trim().toLowerCase();
  const found = queues.filter(q => [q.queue_code].join(" ").toLowerCase().includes(query));
  if (!found.length) { $("queueList").innerHTML = `<div class="empty">${queues.length ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีคิววันนี้"}</div>`; return; }
  $("queueList").innerHTML = found.map(q => {
    let action = "";
    if (q.status === "waiting") action = `<button class="primary" data-id="${q.id}" data-status="calling">📣 เรียกคิว</button>`;
    else if (q.status === "calling") action = `<button class="primary" data-id="${q.id}" data-status="done">✓ รับสินค้าแล้ว</button><button class="secondary" data-id="${q.id}" data-status="waiting">กลับไปรอ</button>`;
    else action = `<button class="secondary" data-id="${q.id}" data-status="calling">เรียกอีกครั้ง</button>`;
    return `<article class="queue-card"><div><div class="queue-title-row"><strong class="queue-code">${esc(q.queue_code)}</strong><span class="status status-${q.status}">${statusText[q.status]}</span></div><div class="queue-meta">ออกคิวเวลา ${new Date(q.created_at).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Bangkok"})} น.</div></div><div class="actions">${action}</div></article>`;
  }).join("");
  $("queueList").querySelectorAll("button[data-id]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try { await api(`/api/queues/${button.dataset.id}`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.status }) }); await refreshQueues(); }
    catch (err) { $("globalError").textContent = err.message; button.disabled = false; }
  }));
}
async function refreshQueues() {
  
  try {
    const result = await api("/api/queues");
    queues = result.queues || [];
    $("lastUpdated").textContent = `วันที่ ${result.date} · อัปเดต ${new Date().toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}`;
    $("globalError").textContent = ""; render();
  } catch (err) { $("globalError").textContent = err.message; }
}
$("refreshBtn").addEventListener("click", refreshQueues);
$("search").addEventListener("input", render);
refreshQueues();
setInterval(refreshQueues, 5000);
