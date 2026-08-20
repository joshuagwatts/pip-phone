/** Boot loader — serves localStorage code overlays via fetch hook before app starts. */

const KEY = "pip.phone.code.v1";

function overlays() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return raw.files && typeof raw.files === "object" ? raw.files : {};
  } catch {
    return {};
  }
}

const files = overlays();
if (Object.keys(files).length) {
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    try {
      const url = typeof input === "string" ? input : input.url;
      const u = new URL(url, location.href);
      if (u.origin === location.origin) {
        const name = u.pathname.split("/").pop()?.split("?")[0];
        if (name && files[name] != null) {
          const ext = name.split(".").pop() || "txt";
          const type =
            ext === "css" ? "text/css" : ext === "html" ? "text/html" : ext === "json" ? "application/json" : "text/javascript";
          return new Response(files[name], { status: 200, headers: { "Content-Type": type } });
        }
      }
    } catch {
      /* fall through */
    }
    return orig(input, init);
  };
}

if (files["style.css"]) {
  let el = document.getElementById("pip-code-overlay");
  if (!el) {
    el = document.createElement("style");
    el.id = "pip-code-overlay";
    document.head.appendChild(el);
  }
  el.textContent = files["style.css"];
}

await import("./app.js").catch((err) => {
  const root = document.getElementById("view");
  const msg = String(err?.message || err || "boot failed");
  if (root) {
    root.innerHTML = `<h3>PIP BOOT ERROR</h3><p class="muted">${msg.replace(/</g, "&lt;")}</p><p class="muted">Try UPDATE PIP from GitHub, or clear app storage.</p>`;
  }
  const st = document.getElementById("status");
  if (st) st.textContent = "BOOT FAILED";
  console.error(err);
});
