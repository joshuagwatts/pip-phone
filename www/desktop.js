import { httpLanGet, httpLanPostJson } from "./net.js";

const PORT = 7420;
const SUBNETS = ["192.168.1", "192.168.0", "10.0.0", "192.168.50", "192.168.2"];
const PRIORITY_HOSTS = [
  ...Array.from({ length: 40 }, (_, i) => i + 2),
  100, 101, 102, 103, 104, 105, 106, 107, 108,
  200, 201, 202, 203,
  254,
];

function baseUrl(settings) {
  const raw = String(settings.desktop_url || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) return `http://${raw}`;
  return raw;
}

function token(settings) {
  return String(settings.desktop_token || "").trim();
}

export function desktopConfigured(settings) {
  return Boolean(baseUrl(settings) && token(settings));
}

async function probeDesktop(url, password, timeoutMs = 1800) {
  const base = String(url || "").replace(/\/+$/, "");
  if (!base) return null;
  try {
    const st = await httpLanGet(`${base}/api/auth/status`, timeoutMs);
    if (!st.password_set && !st.phone_lan) return null;
    const login = await httpLanPostJson(`${base}/api/auth/login`, {}, { password: password || "" }, timeoutMs);
    const tok = login._cookie || "";
    if (!tok && !login.ok && !login.loopback) return null;
    const urls = (st.urls || []).map((u) => String(u).replace(/\/+$/, ""));
    const pick = urls[0] || base;
    return {
      url: pick,
      token: tok || "loopback",
      urls: urls.length ? urls : [pick],
    };
  } catch {
    return null;
  }
}

export async function findDesktop(settings, password, onProgress) {
  const pass = password || "";
  const saved = baseUrl(settings);
  if (saved) {
    if (onProgress) onProgress("TRYING SAVED URL…");
    const hit = await probeDesktop(saved, pass);
    if (hit) return hit;
  }

  const seen = new Set();
  const targets = [];
  for (const subnet of SUBNETS) {
    for (const host of PRIORITY_HOSTS) {
      const ip = `${subnet}.${host}`;
      if (seen.has(ip)) continue;
      seen.add(ip);
      targets.push(`http://${ip}:${PORT}`);
    }
  }

  if (onProgress) onProgress("SCANNING Wi‑Fi…");
  const batch = 20;
  for (let i = 0; i < targets.length; i += batch) {
    const chunk = targets.slice(i, i + batch);
    if (onProgress) onProgress(`SCAN ${i + 1}–${Math.min(i + batch, targets.length)}…`);
    const hits = await Promise.all(chunk.map((url) => probeDesktop(url, pass, 1400)));
    const found = hits.find(Boolean);
    if (found) return found;
  }

  throw new Error("no desktop Pip on this Wi‑Fi — enable Phone LAN + password on PC DATA");
}

export async function desktopLogin(settings, password) {
  const url = baseUrl(settings);
  if (!url) throw new Error("set desktop URL first");
  const res = await httpLanPostJson(`${url}/api/auth/login`, {}, { password: password || "" });
  const cookie = res._cookie || "";
  if (!cookie && !res.loopback) throw new Error("login failed — check password and Phone LAN on desktop");
  return { token: cookie, loopback: Boolean(res.loopback) };
}

export async function findAndPair(settings, password, onProgress) {
  const hit = await findDesktop(settings, password, onProgress);
  return {
    url: hit.url,
    token: hit.token,
    urls: hit.urls || [hit.url],
  };
}

export async function desktopStatus(settings) {
  const url = baseUrl(settings);
  if (!url) return { ok: false, error: "no url" };
  const tok = token(settings);
  try {
    const data = await httpLanGet(`${url}/api/auth/status`, 8000, tok ? { Cookie: `pip_gate=${tok}` } : {});
    const health = await httpLanGet(`${url}/api/health`, 8000, tok ? { Cookie: `pip_gate=${tok}` } : {});
    return {
      ok: true,
      auth: Boolean(data.auth),
      phone_lan: Boolean(data.phone_lan),
      urls: data.urls || [],
      ollama: health.ollama || {},
      router: health.router || {},
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

export async function desktopChat(settings, text) {
  const url = baseUrl(settings);
  const tok = token(settings);
  if (!url || !tok) throw new Error("desktop not paired");
  const data = await httpLanPostJson(
    `${url}/api/chat`,
    { Cookie: `pip_gate=${tok}` },
    { text },
    120000,
  );
  const reply = String(data.reply || data.content || "").trim();
  if (!reply) throw new Error("desktop empty reply");
  return {
    text: reply,
    provider: "desktop",
    model: String((data.router && data.router.model) || (data.ollama && data.ollama.using) || "ollama"),
  };
}

export async function desktopDraft(settings, payload) {
  throw new Error("desktop draft proxy not wired yet");
}
