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

export async function desktopLogin(settings, password) {
  const url = baseUrl(settings);
  if (!url) throw new Error("set desktop URL first");
  const res = await httpLanPostJson(`${url}/api/auth/login`, {}, { password: password || "" });
  const cookie = res._cookie || "";
  if (!cookie && !res.loopback) throw new Error("login failed — check password and Phone LAN on desktop");
  return { token: cookie, loopback: Boolean(res.loopback) };
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
  const url = baseUrl(settings);
  const tok = token(settings);
  if (!url || !tok) throw new Error("desktop not paired");
  // Phone drafts stay local/cloud first; desktop proxy is a future lane.
  throw new Error("desktop draft proxy not wired yet");
}
