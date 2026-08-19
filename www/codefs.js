/** Virtual overlay FS for phone www — persisted edits survive reload via boot.js fetch hook. */

export const KEY = "pip.phone.code.v1";

export const EDITABLE = [
  "style.css",
  "theme.js",
  "app.js",
  "index.html",
  "crew.js",
  "brain.js",
  "store.js",
  "motivation.js",
  "calendar.js",
  "memory.js",
  "cloud.js",
  "desktop.js",
  "net.js",
  "opp.js",
  "kind.js",
  "digest.js",
  "vibe.js",
  "shaders.js",
  "boot.js",
];

const TEXT_EXT = new Set(["css", "js", "html", "json", "md", "txt", "webmanifest"]);

function loadRaw() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw || typeof raw !== "object") return { files: {}, chat: [] };
    return {
      files: raw.files && typeof raw.files === "object" ? raw.files : {},
      chat: Array.isArray(raw.chat) ? raw.chat : [],
    };
  } catch {
    return { files: {}, chat: [] };
  }
}

function saveRaw(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function overlayFiles() {
  return { ...loadRaw().files };
}

export function listEntries() {
  const ov = overlayFiles();
  const names = new Set([...EDITABLE, ...Object.keys(ov)]);
  return [...names].sort().map((name) => ({
    name,
    path: name,
    overlay: Boolean(ov[name]),
    editable: EDITABLE.includes(name) || TEXT_EXT.has(name.split(".").pop() || ""),
  }));
}

export async function readFile(name) {
  const clean = String(name || "").replace(/^\.?\//, "").split(/[\\/]/).pop();
  if (!clean) throw new Error("bad path");
  const ov = loadRaw().files[clean];
  if (ov != null) return { path: clean, name: clean, body: String(ov), overlay: true };
  const res = await fetch(`./${clean}?v=${encodeURIComponent(clean)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`missing ${clean}`);
  const body = await res.text();
  return { path: clean, name: clean, body, overlay: false };
}

export function writeFile(name, body) {
  const clean = String(name || "").replace(/^\.?\//, "").split(/[\\/]/).pop();
  if (!clean) throw new Error("bad path");
  const data = loadRaw();
  data.files[clean] = String(body ?? "");
  saveRaw(data);
  applyLive(clean, data.files[clean]);
  return { path: clean, name: clean, bytes: data.files[clean].length, overlay: true };
}

export function deleteOverlay(name) {
  const clean = String(name || "").replace(/^\.?\//, "").split(/[\\/]/).pop();
  const data = loadRaw();
  delete data.files[clean];
  saveRaw(data);
}

export function clearOverlays() {
  const data = loadRaw();
  data.files = {};
  saveRaw(data);
  const el = document.getElementById("pip-code-overlay");
  if (el) el.remove();
}

export function loadCodeChat() {
  return loadRaw().chat.slice(-40);
}

export function pushCodeChat(role, text, tools = []) {
  const data = loadRaw();
  data.chat.push({ role, text: String(text || ""), tools: tools || [], at: Date.now() });
  data.chat = data.chat.slice(-60);
  saveRaw(data);
}

export function clearCodeChat() {
  const data = loadRaw();
  data.chat = [];
  saveRaw(data);
}

export function grepFiles(pattern, limit = 40) {
  const re = new RegExp(pattern, "i");
  const hits = [];
  const ov = overlayFiles();
  const names = new Set([...EDITABLE, ...Object.keys(ov)]);
  for (const name of names) {
    if (!re.test(name)) continue;
    hits.push({ path: name, line: 0, text: name });
  }
  return hits.slice(0, limit);
}

export async function grepContent(pattern, limit = 40) {
  const re = new RegExp(pattern, "i");
  const hits = [];
  for (const name of EDITABLE) {
    try {
      const f = await readFile(name);
      const lines = f.body.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          hits.push({ path: name, line: i + 1, text: lines[i].trim().slice(0, 200) });
          if (hits.length >= limit) return hits;
        }
      }
    } catch {
      /* skip */
    }
  }
  return hits;
}

export function applyLive(name, body) {
  if (name === "style.css") {
    let el = document.getElementById("pip-code-overlay");
    if (!el) {
      el = document.createElement("style");
      el.id = "pip-code-overlay";
      document.head.appendChild(el);
    }
    el.textContent = body;
  }
}

export function applyAllOverlays() {
  const ov = overlayFiles();
  if (ov["style.css"]) applyLive("style.css", ov["style.css"]);
}

export function needsReload(written = []) {
  return written.some((p) => /\.(js|html|webmanifest)$/.test(String(p)));
}
