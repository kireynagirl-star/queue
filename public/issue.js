const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
async function api(url, options={}) {
  const headers={"Content-Type":"application/json", ...(options.headers||{})};
  const response=await fetch(url,{...options,headers,cache:"no-store"});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error||`เกิดข้อผิดพลาด (${response.status})`);
  return data;
}
async function refreshQueues(){
  try{const result=await api("/api/queues");const queues=result.queues||[];
    $("waitingCount").textContent=queues.filter(q=>q.status==="waiting").length;
    $("callingCount").textContent=queues.filter(q=>q.status==="calling").length;
    $("doneCount").textContent=queues.filter(q=>q.status==="done").length;
    $("lastUpdated").textContent=`วันที่ ${result.date} · อัปเดต ${new Date().toLocaleTimeString("th-TH")}`;
    const recent=[...queues].reverse().slice(0,8);
    $("recentIssued").innerHTML=recent.length?recent.map(q=>`<span class="recent-ticket">${esc(q.queue_code)}</span>`).join(""):'<p class="muted">ยังไม่มีคิววันนี้</p>';
    $("globalError").textContent="";
  }catch(err){$("globalError").textContent=err.message;}
}
async function createQueue(prefix){
  $("formMessage").textContent="";$("globalError").textContent="";
  document.querySelectorAll(".queue-type-button").forEach(b=>b.disabled=true);
  try{const result=await api("/api/queues",{method:"POST",body:JSON.stringify({prefix})});$("formMessage").textContent=`ออกคิว ${result.queue.queue_code} สำเร็จ`;await refreshQueues();}
  catch(err){$("globalError").textContent=err.message;}
  finally{document.querySelectorAll(".queue-type-button").forEach(b=>b.disabled=false);}
}
document.querySelectorAll(".queue-type-button").forEach(b=>b.addEventListener("click",()=>createQueue(b.dataset.prefix)));
refreshQueues();
setInterval(refreshQueues,5000);
