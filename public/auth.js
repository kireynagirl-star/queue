// Staff pages: confirm the login session before showing content.
fetch("/api/session", { cache: "no-store", credentials: "same-origin" })
  .then(response => {
    if (response.ok) document.body.classList.remove("auth-pending");
    else location.replace("/login");
  })
  .catch(() => location.replace("/login"));

document.addEventListener("DOMContentLoaded", () => {
  const logout = document.getElementById("logoutBtn");
  if (!logout) return;
  logout.addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    location.replace("/login");
  });
});
