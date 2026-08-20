import { httpLanGet, httpLanPostJson } from "./net.js";

const PORT = 7420;
const SUBNETS = ["192.168.1", "192.168.0", "10.0.0", "192.168.50", "192.168.2"];
const PRIORITY_HOSTS = [
  ...Array.from({ length: 40 }, (_, i) => i + 2),
  100, 101, 102, 103, 104, 105, 106, 107, 108,
  200, 201, 202, 203,
  254,
];

function normalizeUrl(raw) {
  const s = String(raw || "").trim().replace(/\/+$/, "");
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.includes(":")) return `http://${s}`;
  return `http://${s}:${PORT}`;
}

function baseUrl(settings) {
  return normalizeUrl(settings.desktop_url);
}

function token(settings) {
  return String(settings.desktop_token || "").trim();
}

export function desktopConfigured(settings) {
  return Boolean(baseUrl(settings) && token(settings));
}

/** Build candidate desktop URLs — saved, VPN paste, note, Tailscale host, WireGuard default. */
export function vpnTargets(settings) {
  const out = [];
  const add = (raw) => {
    const url = normalizeUrl(raw);
    if (url && !out.includes(url)) out.push(url);
  };

  add(settings.desktop_url);
  add(settings.vpn_url);

  const note = String(settings.vpn_note || "").trim();
  for (const m of note.matchAll(/https?:\/\/[^\s,)]+/gi)) add(m[0]);
  for (const m of note.matchAll(/\b(?:100\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.8\.0\.\d+)\b/g)) {
    add(`http://${m[0]}:${PORT}`);
  }

  const host = String(settings.vpn_host || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (host) {
    if (host.includes(":")) add(`http://${host}`);
    else add(`http://${host}:${PORT}`);
  }

  add(`http://10.8.0.1:${PORT}`);
  return out;
}

async function probeDesktop(url, password, timeoutMs = 2200) {
  const base = normalizeUrl(url);
  if (!base) return null;
  try {
    const st = await httpLanGet(`${base}/api/auth/status`, timeoutMs);
    if (!st.password_set && !st.phone_lan && !st.phone_vpn) return null;
    const login = await httpLanPostJson(`${base}/api/auth/login`, {}, { password: password || "" }, timeoutMs);
    const tok = String(login.token || login._cookie || "").trim();
    if (!tok && !login.ok && !login.loopback) return null;
    const urls = (st.urls || []).map((u) => normalizeUrl(u)).filter(Boolean);
    const pick = urls[0] || base;
    return {
      url: pick,
      token: tok || "loopback",
      urls: urls.length ? urls : [pick],
      via: base,
      vpn: Boolean(st.phone_vpn),
      tailscale: st.tailscale || {},
      wireguard: st.wireguard || {},
    };
  } catch {
    return null;
  }
}

export async function pairAtUrl(settings, password, url, onProgress) {
  const pass = password || "";
  const target = normalizeUrl(url);
  if (!target) throw new Error("need a desktop URL");
  if (onProgress) onProgress(`TRYING ${target}…`);
  const hit = await probeDesktop(target, pass, 6000);
  if (!hit) throw new Error(`no Pip at ${target} — check password, LAN/VPN on desktop DATA`);
  return hit;
}

export async function findDesktop(settings, password, onProgress) {
  const pass = password || "";

  for (const url of vpnTargets(settings)) {
    if (onProgress) onProgress(`TRYING ${url}…`);
    const hit = await probeDesktop(url, pass, 2800);
    if (hit) return hit;
  }

  if (onProgress) onProgress("SCANNING Wi‑Fi…");
  const seen = new Set(vpnTargets(settings));
  const targets = [];
  for (const subnet of SUBNETS) {
    for (const host of PRIORITY_HOSTS) {
      const ip = `${subnet}.${host}`;
      const url = `http://${ip}:${PORT}`;
      if (seen.has(url)) continue;
      seen.add(url);
      targets.push(url);
    }
  }

  const batch = 20;
  for (let i = 0; i < targets.length; i += batch) {
    const chunk = targets.slice(i, i + batch);
    if (onProgress) onProgress(`SCAN ${i + 1}–${Math.min(i + batch, targets.length)}…`);
    const hits = await Promise.all(chunk.map((url) => probeDesktop(url, pass, 1400)));
    const found = hits.find(Boolean);
    if (found) return found;
  }

  throw new Error("no desktop Pip — set VPN URL from PC DATA or use same Wi‑Fi + Phone LAN");
}

export async function desktopLogin(settings, password) {
  const url = baseUrl(settings);
  if (!url) throw new Error("set desktop URL first");
  const res = await httpLanPostJson(`${url}/api/auth/login`, {}, { password: password || "" });
  const cookie = String(res.token || res._cookie || "").trim();
  if (!cookie && !res.loopback) throw new Error("login failed — check password and Phone LAN on desktop");
  return { token: cookie || "loopback", loopback: Boolean(res.loopback) };
}

export async function findAndPair(settings, password, onProgress) {
  const hit = await findDesktop(settings, password, onProgress);
  return {
    url: hit.url,
    token: hit.token,
    urls: hit.urls || [hit.url],
    via: hit.via,
    vpn: hit.vpn,
  };
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

export async function desktopStatus(settings) {
  const url = baseUrl(settings);
  if (!url) return { ok: false, error: "no url" };
  try {
    const hdr = authHeaders(settings);
    const data = await httpLanGet(`${url}/api/auth/status`, 5000, hdr);
    const health = await httpLanGet(`${url}/api/health`, 5000, hdr);
    return {
      ok: true,
      auth: Boolean(data.auth),
      phone_lan: Boolean(data.phone_lan),
      phone_vpn: Boolean(data.phone_vpn),
      vpn_mode: data.vpn_mode || "off",
      urls: data.urls || [],
      tailscale: data.tailscale || {},
      wireguard: data.wireguard || {},
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
  const raw = await httpLanPostJson(
    `${url}/api/chat`,
    authHeaders(settings),
    { text },
    12000,
  );
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

export async function desktopDraft(settings, payload) {
  throw new Error("desktop draft proxy not wired yet");
}
