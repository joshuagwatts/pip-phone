/** Boot loader — serves localStorage code overlays via fetch hook, then:
 *   1. biometric gate (real auth) when secrets exist worth protecting
 *   2. secrets vault init (migrates legacy plaintext keys -> secure storage)
 *   3. memory engine init (DEK from vault, decrypt store, migrate moments)
 *   4. app.js
 */

import { requireBootAuth } from "./biometric.js";
import { initSecrets } from "./secrets.js";
import { initMemoryEngine } from "./memory-engine.js";

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

function bootFail(msg, hint) {
  const root = document.getElementById("view");
  const h = String(hint || "Try UPDATE PIP from GitHub, or clear app storage.");
  if (root) {
    root.innerHTML = `<h3>PIP BOOT ERROR</h3><p class="muted">${String(msg).replace(/</g, "&lt;")}</p><p class="muted">${h.replace(/</g, "&lt;")}</p>`;
  }
  const st = document.getElementById("status");
  if (st) st.textContent = "BOOT FAILED";
}

try {
  // 1. Auth gate — real biometric / vault passphrase — before secrets load.
  await requireBootAuth().catch((e) => {
    throw new Error(`Unlock needed: ${e?.message || e}`);
  });
  // 2. Secrets vault — migrates legacy plaintext keys, loads memory map.
  await initSecrets().catch((e) => {
    throw new Error(`Secrets vault failed: ${e?.message || e}`);
  });
  // 3. Memory engine — DEK from the vault, decrypt store, migrate old moments.
  //    Fails boot loudly on crypto failure: an unencrypted engine would
  //    silently break the security promise.
  await initMemoryEngine().catch((e) => {
    throw new Error(`Memory engine failed: ${e?.message || e}`);
  });
} catch (e) {
  console.error(e);
  bootFail(e?.message || e, "PIP stays locked until you authenticate.");
  throw e;
}

await import("./app.js").catch((err) => {
  const msg = String(err?.message || err || "boot failed");
  bootFail(msg);
  console.error(err);
});
