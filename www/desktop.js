import { httpLanGet, httpLanPostJson } from "./net.js";
import { vpnSystemActive, openProtonVpn } from "./proton.js";
import { getSecret, setSecret, clearSecret } from "./secrets.js";

const PORT = 7420;
const FALLBACK_SUBNETS = ["192.168.1", "192.168.0", "10.0.0", "192.168.50", "192.168.2", "10.0.1"];

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
  // Desktop pairing token lives in the secrets vault, never in settings.
  return getSecret("desktop_token").trim();
}

/** Synchronous vault read for the desktop pairing token ("" when unpaired). */
export function desktopToken() {
  return getSecret("desktop_token").trim();
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

/** Host octets in DHCP-friendly order (covers .162 etc.). */
function hostOrder() {
  const mid = [];
  for (let i = 100; i <= 200; i++) mid.push(i);
  const low = [];
  for (let i = 2; i <= 99; i++) low.push(i);
  const high = [];
  for (let i = 201; i <= 254; i++) high.push(i);
  return [...mid, ...low, ...high, 1];
}

/** Guess phone Wi‑Fi subnet via WebRTC local candidates (works in Capacitor WebView). */
async function guessSubnets() {
  const out = [];
  const add = (subnet) => {
    if (subnet && !out.includes(subnet)) out.push(subnet);
  };
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel("pip");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 700);
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) {
          clearTimeout(t);
          resolve();
        }
      };
    });
    const sdp = String(pc.localDescription?.sdp || "");
    pc.close();
    for (const m of sdp.matchAll(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g)) {
      const ip = m[1];
      if (/^127\.|^0\.|^255\./.test(ip)) continue;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) {
        add(ip.split(".").slice(0, 3).join("."));
      }
    }
  } catch {
    /* ignore */
  }
  for (const s of FALLBACK_SUBNETS) add(s);
  return out;
}

async function pingReady(url, timeoutMs = 700) {
  const base = normalizeUrl(url);
  if (!base) return null;
  try {
    const ready = await httpLanGet(`${base}/api/ready`, timeoutMs);
    if (!ready || ready.ok === false) return null;
    return base;
  } catch {
    return null;
  }
}

async function probeDesktop(url, timeoutMs = 4000) {
  const base = normalizeUrl(url);
  if (!base) return null;
  let lastErr = "";
  try {
    const ready = await pingReady(base, Math.min(timeoutMs, 2500));
    if (!ready) {
      lastErr = `no response from ${base}`;
      const err = new Error(lastErr);
      err.hard = true;
      throw err;
    }
    // H2: discovery NEVER sends a credential. If we paired before, the status
    // check rides on the STORED token; a fresh pairing mints its token later
    // via desktopLogin with a typed password — never an empty one.
    const tok = token();
    const hdr = tok && tok !== "loopback" ? authHeaders() : {};
    let st = {};
    try {
      st = await httpLanGet(`${base}/api/auth/status`, timeoutMs, hdr);
    } catch (e) {
      lastErr = String(e.message || e);
    }
    return {
      url: base,
      token: "",
      listen: st.listen || "",
      phone_lan: Boolean(st.phone_lan || st.on),
      urls: (st.urls || []).map(normalizeUrl).filter(Boolean),
      tokenValid: Boolean(tok && tok !== "loopback"),
    };
  } catch (e) {
    // Surface auth/LAN problems; keep scanning on dead sockets.
    const msg = String(e.message || e || "");
    if (e && e.hard && /LAN|password|login|Wi-?Fi|firewall|VPN/i.test(msg)) throw e;
    return null;
  }
}

export async function desktopLogin(settings, password = "") {
  const url = baseUrl(settings);
  if (!url) throw new Error("set desktop URL first");
  const pw = String(password || "");
  // H2: never send an empty credential — the old probe POSTed {password:""}.
  if (!pw) throw new Error("Type your desktop password — Pip never sends an empty credential, and never stores the password.");
  const res = await httpLanPostJson(`${url}/api/auth/login`, {}, { password: pw }, 10000);
  const cookie = String(res.token || res._cookie || "").trim();
  if (!cookie) throw new Error(res.detail || "login failed — turn ON LAN on desktop DATA");
  return { token: cookie, loopback: Boolean(res.loopback), open_lan: Boolean(res.open_lan) };
}

export async function ensureDesktopSession(settings) {
  if (!baseUrl(settings)) throw new Error("set desktop URL first");
  const tok = token(settings);
  if (tok && tok !== "loopback") return tok;
  // H2: no silent empty-password login — re-pairing needs the typed password.
  throw new Error("Desktop session expired — tap CONNECT and enter your desktop password.");
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
      // H2: no silent empty-password re-login — the user re-pairs with a typed password.
      await clearSecret("desktop_token").catch(() => {});
      throw new Error("Desktop session expired — tap CONNECT and enter your desktop password.");
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
  if (onProgress) onProgress("FINDING YOUR Wi‑Fi…");
  const subnets = await guessSubnets();
  const hosts = hostOrder();
  const batch = 32;

  for (const subnet of subnets) {
    if (onProgress) onProgress(`SCAN ${subnet}.* …`);
    for (let i = 0; i < hosts.length; i += batch) {
      const chunk = hosts.slice(i, i + batch).map((h) => `http://${subnet}.${h}:${PORT}`);
      if (onProgress) {
        onProgress(`SCAN ${subnet}.${hosts[i]}–${subnet}.${hosts[Math.min(i + batch - 1, hosts.length - 1)]}…`);
      }
      const pings = await Promise.all(chunk.map((url) => pingReady(url, 650)));
      const alive = pings.filter(Boolean);
      for (const base of alive) {
        if (onProgress) onProgress(`FOUND ${base} — pairing…`);
        try {
          const hit = await probeDesktop(base, 6000);
          if (hit) return hit;
        } catch (e) {
          if (e && e.hard) throw e;
        }
      }
    }
  }
  return null;
}

async function protonBlockHint() {
  try {
    if (await vpnSystemActive()) {
      return (
        "Proton VPN is ON and blocking LAN. Proton → Settings → Features → Allow LAN connections (ON), " +
        "then CONNECT again. Same Wi‑Fi as the PC."
      );
    }
  } catch {
    /* ignore */
  }
  return "";
}

/**
 * One-shot connect: use typed URL if present, else scan full Wi‑Fi subnet.
 */
export async function connectDesktop(settings, onProgress, opts = {}) {
  const typed = normalizeUrl(settings.desktop_url);
  let hit = null;
  const protonHint = await protonBlockHint();

  if (typed) {
    if (onProgress) onProgress(`CONNECTING ${typed}…`);
    try {
      hit = await probeDesktop(typed, 8000);
    } catch (e) {
      const msg = String(e.message || e);
      if (protonHint) throw new Error(protonHint);
      throw new Error(
        `${msg} — OFF phone VPN or enable Proton Allow LAN · same Wi‑Fi · Open-Firewall.bat · Chrome: ${typed}/api/ready`,
      );
    }
    if (!hit) {
      if (protonHint) throw new Error(protonHint);
      throw new Error(`can't reach ${typed} — enable Proton Allow LAN, or turn VPN off briefly`);
    }
  } else {
    hit = await scanLan(onProgress);
    if (!hit) {
      if (protonHint) throw new Error(protonHint);
      throw new Error(
        "scan found nothing — desktop DATA → COPY URL → paste → CONNECT. Or Proton → Allow LAN connections.",
      );
    }
  }

  // H2: pairing mints a token only via a TYPED desktop password — the old
  // probe POSTed {password:""} and the server must reject empty logins.
  const password = String((opts && opts.password) || "");
  if (!password) {
    throw new Error("Enter your desktop password to pair — it is never stored on this phone.");
  }
  settings.desktop_url = hit.url;
  const login = await desktopLogin(settings, password);
  hit.token = login.token;

  settings.desktop_url = hit.url;
  await setSecret("desktop_token", hit.token);
  settings.desktop_paired = true;
  // desktop_password is never persisted — re-pairing requires re-entering it.
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
  return connectDesktop(settings, onProgress, { password });
}

export async function desktopDraft() {
  throw new Error("desktop draft proxy not wired yet");
}
