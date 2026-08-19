import { httpLanGet, httpLanPostJson } from "./net.js";

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

export async function discoverDesktop(url, password = "") {
  const raw = String(url || "").trim();
  if (!raw) throw new Error("paste a desktop URL");
  const target = /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, "") : `http://${raw.replace(/\/+$/, "")}`;
  let login = {};
  try {
    login = await httpLanPostJson(`${target}/api/auth/login`, {}, { password: password || "" });
  } catch (e) {
    throw new Error(`login failed — ${String(e.message || e)}`);
  }
  const tok = login._cookie || "";
  const status = await httpLanGet(`${target}/api/auth/status`, 8000, tok ? { Cookie: `pip_gate=${tok}` } : {});
  const urls = status.urls || [];
  const pick = urls[0] || target;
  return {
    url: pick.replace(/\/+$/, ""),
    token: tok || "loopback",
    urls,
    tailscale: status.tailscale || {},
    wireguard: status.wireguard || {},
    vpn_mode: status.vpn_mode || "off",
  };
}

export async function desktopLogin(settings, password) {
  const out = await discoverDesktop(baseUrl(settings) || settings.desktop_url, password);
  return { token: out.token, loopback: out.token === "loopback", url: out.url, urls: out.urls };
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
