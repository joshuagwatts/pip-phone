import { httpLanGet, httpLanPostJson } from "./net.js";

const PORT = 7420;
const SUBNETS = ["192.168.1", "192.168.0", "10.0.0", "192.168.50", "192.168.2", "10.0.1"];
const PRIORITY_HOSTS = [
  ...Array.from({ length: 40 }, (_, i) => i + 2),
  100, 101, 102, 103, 104, 105, 106, 107, 108,
  200, 201, 202, 203,
  254,
];

/** Always force port 7420 — http://IP alone was hitting port 80. */
export function normalizeUrl(raw) {
  const s = String(raw || "").trim().replace(/\/+$/, "");
  if (!s) return "";
  let candidate = s;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = candidate.includes(":") ? `http://${candidate}` : `http://${candidate}:${PORT}`;
  }
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (!u.port) u.port = String(PORT);
    return u.origin;
  } catch {
    return "";
  }
}

function baseUrl(settings) {
  return normalizeUrl(settings.desktop_url);
}

function token(settings) {
  return String(settings.desktop_token || "").trim();
}

export function desktopConfigured(settings) {
  const tok = token(settings);
  return Boolean(baseUrl(settings) && tok && tok !== "loopback");
}

function authHeaders(settings) {
  const tok = token(settings);
  if (!tok || tok === "loopback") return {};
  return {
    Cookie: `pip_gate=${tok}`,
    "X-Pip-Token": tok,
    Authorization: `Bearer ${tok}`,
  };
}

async function probeDesktop(url, timeoutMs = 2200) {
  const base = normalizeUrl(url);
  if (!base) return null;
  try {
    const ready = await httpLanGet(`${base}/api/ready`, Math.min(timeoutMs, 2000));
    if (!ready || ready.ok === false) return null;
    const st = await httpLanGet(`${base}/api/auth/status`, timeoutMs);
    if (!st.phone_lan && !st.on) {
      /* still try login — older builds */
    }
    const login = await httpLanPostJson(`${base}/api/auth/login`, {}, { password: "" }, timeoutMs);
    const tok = String(login.token || login._cookie || "").trim();
    if (!tok && !login.ok && !login.loopback) return null;
    return {
      url: base,
      token: tok || "",
      listen: st.listen || "",
      phone_lan: Boolean(st.phone_lan || st.on),
      urls: (st.urls || []).map(normalizeUrl).filter(Boolean),
    };
  } catch {
    return null;
  }
}

export async function desktopLogin(settings, password = "") {
  const url = baseUrl(settings);
  if (!url) throw new Error("set desktop URL first");
  const res = await httpLanPostJson(`${url}/api/auth/login`, {}, { password: password || "" }, 10000);
  const cookie = String(res.token || res._cookie || "").trim();
  if (!cookie) throw new Error(res.detail || "login failed — turn ON LAN on desktop DATA");
  return { token: cookie, loopback: Boolean(res.loopback), open_lan: Boolean(res.open_lan) };
}

export async function ensureDesktopSession(settings) {
  if (!baseUrl(settings)) throw new Error("set desktop URL first");
  const tok = token(settings);
  if (tok && tok !== "loopback") return tok;
  const out = await desktopLogin(settings, "");
  const next = String(out.token || "").trim();
  if (!next) throw new Error("desktop login returned no token");
  settings.desktop_token = next;
  settings.desktop_paired = true;
  return next;
}

export async function desktopReachable(settings, timeoutMs = 2500) {
  const url = baseUrl(settings);
  if (!url) return { ok: false, error: "no url" };
  try {
    const ready = await httpLanGet(`${url}/api/ready`, timeoutMs);
    if (!ready || ready.ok === false) return { ok: false, error: "not ready" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

export async function desktopStatus(settings) {
  const url = baseUrl(settings);
  if (!url) return { ok: false, error: "no url" };
  try {
    const reach = await desktopReachable(settings, 2500);
    if (!reach.ok) return { ok: false, error: reach.error || "offline", offline: true };
    await ensureDesktopSession(settings).catch(() => {});
    const hdr = authHeaders(settings);
    const data = await httpLanGet(`${url}/api/auth/status`, 5000, hdr);
    let health = {};
    try {
      health = await httpLanGet(`${url}/api/health`, 8000, hdr);
    } catch {
      health = {};
    }
    return {
      ok: true,
      auth: Boolean(data.auth),
      phone_lan: Boolean(data.phone_lan),
      listen: data.listen || "",
      urls: data.urls || [],
      ollama: health.ollama || {},
      router: health.router || {},
      restart: Boolean(data.restart),
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function postChat(settings, text, timeoutMs) {
  const url = baseUrl(settings);
  return httpLanPostJson(`${url}/api/chat`, authHeaders(settings), { text }, timeoutMs);
}

export async function desktopChat(settings, text, timeoutMs = 60000) {
  const url = baseUrl(settings);
  if (!url) throw new Error("desktop not paired");
  const reach = await desktopReachable(settings, 2500);
  if (!reach.ok) throw new Error(`desktop offline (${reach.error || "no route"})`);
  await ensureDesktopSession(settings);

  let raw;
  try {
    raw = await postChat(settings, text, timeoutMs);
  } catch (e) {
    const msg = String(e.message || e);
    const status = e.status || 0;
    if (status === 401 || /401|login required/i.test(msg)) {
      const out = await desktopLogin(settings, "");
      settings.desktop_token = String(out.token || "").trim();
      if (!settings.desktop_token) throw new Error("re-login failed — tap CONNECT again");
      raw = await postChat(settings, text, timeoutMs);
    } else {
      throw e;
    }
  }

  const reply = String(raw.reply || raw.content || "").trim();
  if (!reply) throw new Error("desktop empty reply");
  return {
    text: reply,
    provider: "desktop",
    model: String((raw.router && raw.router.model) || (raw.ollama && raw.ollama.using) || "ollama"),
    theme: raw.theme || null,
    theme_name: raw.theme_name || "",
  };
}

export async function desktopGpuPing(settings) {
  const out = await desktopChat(settings, "Reply with exactly: PIP GPU OK", 45000);
  return {
    ok: /pip\s*gpu\s*ok|gpu\s*ok/i.test(out.text),
    text: out.text,
    model: out.model,
  };
}

async function scanLan(onProgress) {
  if (onProgress) onProgress("SCANNING Wi‑Fi…");
  const targets = [];
  const seen = new Set();
  for (const subnet of SUBNETS) {
    for (const host of PRIORITY_HOSTS) {
      const url = `http://${subnet}.${host}:${PORT}`;
      if (seen.has(url)) continue;
      seen.add(url);
      targets.push(url);
    }
  }
  const batch = 24;
  for (let i = 0; i < targets.length; i += batch) {
    const chunk = targets.slice(i, i + batch);
    if (onProgress) onProgress(`SCAN ${i + 1}–${Math.min(i + batch, targets.length)}…`);
    const hits = await Promise.all(chunk.map((url) => probeDesktop(url, 1100)));
    const found = hits.find(Boolean);
    if (found) return found;
  }
  return null;
}

/**
 * One-shot connect: use typed URL if present, else scan Wi‑Fi.
 * Keeps the URL that actually worked (never swaps to a wrong NIC).
 */
export async function connectDesktop(settings, onProgress) {
  const typed = normalizeUrl(settings.desktop_url);
  let hit = null;

  if (typed) {
    if (onProgress) onProgress(`CONNECTING ${typed}…`);
    hit = await probeDesktop(typed, 6000);
    if (!hit) {
      throw new Error(
        `no Pip at ${typed} — desktop DATA → TURN ON LAN, allow Python firewall, same Wi‑Fi`,
      );
    }
  } else {
    hit = await scanLan(onProgress);
    if (!hit) {
      throw new Error("no desktop Pip on Wi‑Fi — turn ON LAN on desktop, same network, try again");
    }
  }

  if (!hit.token) {
    settings.desktop_url = hit.url;
    const login = await desktopLogin(settings, "");
    hit.token = login.token;
  }

  settings.desktop_url = hit.url;
  settings.desktop_token = hit.token;
  settings.desktop_paired = true;
  settings.desktop_password = "";
  settings.desktop_live = true;

  if (onProgress) onProgress("TESTING GPU…");
  const ping = await desktopGpuPing(settings);
  return {
    url: hit.url,
    token: hit.token,
    ping,
    model: ping.model,
  };
}

/** @deprecated — use connectDesktop */
export async function findAndPair(settings, password, onProgress) {
  return connectDesktop(settings, onProgress);
}

export async function desktopDraft() {
  throw new Error("desktop draft proxy not wired yet");
}
